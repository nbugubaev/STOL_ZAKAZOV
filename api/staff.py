import os
import json
import requests
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_MASTER_BOT_TOKEN = os.environ.get("TG_MASTER_BOT_TOKEN")  # ЭТОТ бот
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")                # клиентский бот
CABINET_URL = os.environ.get("CABINET_URL")

CLIENT_STATUS_MESSAGES = {
    "done": "✅ Ваша заявка выполнена. Спасибо, что обратились!",
    "cancelled": "❌ Ваша заявка отменена. Если это ошибка — напишите нам ещё раз.",
}

DB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


def patch_ticket(ticket_id, fields):
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}"
    headers = dict(DB_HEADERS); headers["Prefer"] = "return=representation"
    resp = requests.patch(url, headers=headers, json=fields, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def fetch_moderator_ids():
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/moderators?select=tg_id", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    return [r["tg_id"] for r in resp.json() if r.get("tg_id")]


def tg_send(token, chat_id, text, reply_markup=None):
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json=body, timeout=10)


def answer_callback(cq_id, text=""):
    requests.post(f"https://api.telegram.org/bot{TG_MASTER_BOT_TOKEN}/answerCallbackQuery",
                  json={"callback_query_id": cq_id, "text": text}, timeout=10)


def edit_task_message(cq, note):
    msg = cq.get("message", {})
    requests.post(f"https://api.telegram.org/bot{TG_MASTER_BOT_TOKEN}/editMessageText",
                  json={"chat_id": msg.get("chat", {}).get("id"), "message_id": msg.get("message_id"),
                        "text": msg.get("text", "") + note}, timeout=10)


def send_cabinet_button(chat_id):
    if not CABINET_URL:
        tg_send(TG_MASTER_BOT_TOKEN, chat_id, "Кабинет временно недоступен.")
        return
    markup = {"inline_keyboard": [[{"text": "🧰 Открыть кабинет мастера", "web_app": {"url": CABINET_URL}}]]}
    tg_send(TG_MASTER_BOT_TOKEN, chat_id, "Кабинет мастера. Если вы ещё не зарегистрированы — внутри будет форма.", markup)


def notify_moderators(text):
    try:
        for mid in fetch_moderator_ids():
            try:
                tg_send(TG_MASTER_BOT_TOKEN, mid, text)
            except Exception as e:
                print(f"moderator notify error {mid}: {e}")
    except Exception as e:
        print(f"fetch moderators error: {e}")


def handle_callback(cq):
    data = cq.get("data", "")
    cq_id = cq.get("id")
    if ":" not in data:
        answer_callback(cq_id); return
    action, ticket_id = data.split(":", 1)

    if action == "done":
        row = patch_ticket(ticket_id, {"status": "done"})
        if row and row.get("client_tg_id"):
            tg_send(TG_BOT_TOKEN, row["client_tg_id"], CLIENT_STATUS_MESSAGES["done"])
        answer_callback(cq_id, "Готово")
        edit_task_message(cq, "\n\n✅ Заявка закрыта (выполнена)")

    elif action == "cancel":
        row = patch_ticket(ticket_id, {"status": "cancelled"})
        if row and row.get("client_tg_id"):
            tg_send(TG_BOT_TOKEN, row["client_tg_id"], CLIENT_STATUS_MESSAGES["cancelled"])
        answer_callback(cq_id, "Отменено")
        edit_task_message(cq, "\n\n❌ Заявка отменена")

    elif action == "reject":
        # мастер отклонил — возвращаем заявку модератору (снова «Новая», без мастера)
        row = patch_ticket(ticket_id, {"status": "new", "assigned_master_id": None, "assigned_master_name": None})
        name = (row.get("metadata") or {}).get("description", "заявка") if row else "заявка"
        notify_moderators(f"↩️ Мастер отклонил заявку. Вернулась на распределение.\nПроблема: {name}")
        answer_callback(cq_id, "Отклонено")
        edit_task_message(cq, "\n\n↩️ Вы отклонили заявку")

    else:
        answer_callback(cq_id)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers['Content-Length'])
            update = json.loads(self.rfile.read(length).decode('utf-8'))

            if "callback_query" in update:
                handle_callback(update["callback_query"])
            elif "message" in update:
                message = update["message"]
                chat_id = message["chat"]["id"]
                text = message.get("text", "")
                if text == "/myid":
                    tg_send(TG_MASTER_BOT_TOKEN, chat_id, f"Ваш Telegram ID: {chat_id}")
                else:
                    send_cabinet_button(chat_id)

            self.send_response(200); self.send_header('Content-type', 'text/plain'); self.end_headers()
            self.wfile.write(b"OK")
        except Exception as e:
            print(f"Error: {e}")
            self.send_response(200); self.end_headers(); self.wfile.write(b"Error ignored")
