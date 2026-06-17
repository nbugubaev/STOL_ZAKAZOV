import os
import json
import requests
from datetime import datetime
from http.server import BaseHTTPRequestHandler

# Переменные окружения из настроек Vercel.
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")        # форма клиента (.../form.html)
CABINET_URL = os.environ.get("CABINET_URL")      # кабинет мастера (.../master.html)

BTN_NEW = "📝 Оставить заявку"
BTN_MY = "📋 Мои заявки"

STATUS_LABELS = {
    "new": "🟡 Новая",
    "in_progress": "🔵 В работе",
    "done": "🟢 Выполнена",
    "cancelled": "⚪ Отменена",
}

CLIENT_STATUS_MESSAGES = {
    "done": "✅ Ваша заявка выполнена. Спасибо, что обратились!",
    "cancelled": "❌ Ваша заявка отменена. Если это ошибка — напишите нам ещё раз.",
}

DB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


# ---------- база ----------

def insert_ticket(chat_id, form):
    url = f"{SUPABASE_URL}/rest/v1/tickets"
    headers = dict(DB_HEADERS)
    headers["Prefer"] = "return=minimal"
    payload = {"client_tg_id": chat_id, "status": "new", "metadata": form}
    resp = requests.post(url, headers=headers, json=payload, timeout=10)
    resp.raise_for_status()


def fetch_my_tickets(chat_id):
    url = (
        f"{SUPABASE_URL}/rest/v1/tickets"
        f"?client_tg_id=eq.{chat_id}&order=created_at.desc&limit=10&select=*"
    )
    resp = requests.get(url, headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    return resp.json()


def patch_ticket_status(ticket_id, status):
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}"
    headers = dict(DB_HEADERS)
    headers["Prefer"] = "return=representation"
    resp = requests.patch(url, headers=headers, json={"status": status}, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


# ---------- Telegram ----------

def send_message(chat_id, text, reply_markup=None):
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage",
        json=body,
        timeout=10,
    )


def answer_callback(cq_id, text=""):
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/answerCallbackQuery",
        json={"callback_query_id": cq_id, "text": text},
        timeout=10,
    )


def edit_master_message(cq, status):
    msg = cq.get("message", {})
    chat_id = msg.get("chat", {}).get("id")
    message_id = msg.get("message_id")
    original = msg.get("text", "")
    note = "\n\n✅ Заявка закрыта (выполнена)" if status == "done" else "\n\n❌ Заявка отменена"
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/editMessageText",
        json={"chat_id": chat_id, "message_id": message_id, "text": original + note},
        timeout=10,
    )


def main_keyboard():
    return {
        "keyboard": [
            [{"text": BTN_NEW, "web_app": {"url": WEBAPP_URL}}],
            [{"text": BTN_MY}],
        ],
        "resize_keyboard": True,
    }


def send_cabinet_button(chat_id):
    if not CABINET_URL:
        send_message(chat_id, "Кабинет временно недоступен.")
        return
    markup = {"inline_keyboard": [[{"text": "🧰 Открыть кабинет мастера", "web_app": {"url": CABINET_URL}}]]}
    send_message(chat_id, "Кабинет мастера. Если вы ещё не зарегистрированы — внутри будет форма.", reply_markup=markup)


# ---------- вспомогательное ----------

def fmt_date(iso):
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return dt.strftime("%d.%m.%Y %H:%M")
    except Exception:
        return str(iso)


def build_my_tickets_text(tickets):
    if not tickets:
        return f"У вас пока нет заявок. Нажмите «{BTN_NEW}», чтобы создать."
    blocks = ["Ваши заявки:"]
    for i, t in enumerate(tickets, 1):
        meta = t.get("metadata") or {}
        status = STATUS_LABELS.get(t.get("status"), t.get("status"))
        desc = (meta.get("description") or "без описания").strip()
        if len(desc) > 100:
            desc = desc[:100] + "…"
        block = f"{i}. {status} · {fmt_date(t.get('created_at'))}\n{desc}"
        master = t.get("assigned_master_name")
        if master:
            block += f"\nМастер: {master}"
        blocks.append(block)
    return "\n\n".join(blocks)


def handle_callback(cq):
    data = cq.get("data", "")
    cq_id = cq.get("id")
    if ":" not in data:
        answer_callback(cq_id)
        return
    action, ticket_id = data.split(":", 1)
    new_status = {"done": "done", "cancel": "cancelled"}.get(action)
    if not new_status:
        answer_callback(cq_id)
        return
    row = patch_ticket_status(ticket_id, new_status)
    if row and row.get("client_tg_id"):
        text = CLIENT_STATUS_MESSAGES.get(new_status)
        if text:
            send_message(row["client_tg_id"], text)
    answer_callback(cq_id, "Готово" if new_status == "done" else "Отменено")
    edit_master_message(cq, new_status)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            update = json.loads(post_data.decode('utf-8'))

            if "callback_query" in update:
                handle_callback(update["callback_query"])

            elif "message" in update:
                message = update["message"]
                chat_id = message["chat"]["id"]

                if "web_app_data" in message:
                    form = json.loads(message["web_app_data"]["data"])
                    insert_ticket(chat_id, form)
                    send_message(
                        chat_id,
                        "✅ Заявка принята! Передали модератору, скоро назначим мастера.",
                        reply_markup=main_keyboard(),
                    )

                elif "text" in message:
                    text = message["text"]
                    if text in ("/cabinet", "/master") or text.startswith("/master"):
                        send_cabinet_button(chat_id)
                    elif text in (BTN_MY, "/my"):
                        send_message(chat_id, build_my_tickets_text(fetch_my_tickets(chat_id)), reply_markup=main_keyboard())
                    else:
                        send_message(
                            chat_id,
                            "Здравствуйте! Выберите действие на клавиатуре ниже.",
                            reply_markup=main_keyboard(),
                        )

            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"OK")

        except Exception as e:
            print(f"Error: {e}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Error ignored")
