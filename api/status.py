import os
import json
import requests
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")                # клиентский бот
TG_MASTER_BOT_TOKEN = os.environ.get("TG_MASTER_BOT_TOKEN")  # бот мастеров
CABINET_URL = os.environ.get("CABINET_URL")

ALLOWED_STATUSES = {"new", "pool", "in_progress", "done", "cancelled"}

CLIENT_MESSAGES = {
    "in_progress": "🔧 Ваша заявка взята в работу. Скоро с вами свяжется мастер.",
    "done": "✅ Ваша заявка выполнена. Спасибо, что обратились!",
    "cancelled": "❌ Ваша заявка отменена. Если это ошибка — напишите нам ещё раз.",
}

DONE_TEXT = "✅ Ваша заявка выполнена. Спасибо, что обратились!\n\nОцените работу мастера 👇"


def review_markup(tid):
    return {"inline_keyboard": [[
        {"text": "1⭐", "callback_data": f"rate:{tid}:1"},
        {"text": "2⭐", "callback_data": f"rate:{tid}:2"},
        {"text": "3⭐", "callback_data": f"rate:{tid}:3"},
        {"text": "4⭐", "callback_data": f"rate:{tid}:4"},
        {"text": "5⭐", "callback_data": f"rate:{tid}:5"},
    ]]}

DB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


def is_authenticated(headers):
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    try:
        resp = requests.get(f"{SUPABASE_URL}/auth/v1/user",
                            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY}, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False


def update_ticket(ticket_id, fields):
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}"
    headers = dict(DB_HEADERS); headers["Prefer"] = "return=representation"
    resp = requests.patch(url, headers=headers, json=fields, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def fetch_master_ids():
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/masters?select=tg_id", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    return [r["tg_id"] for r in resp.json() if r.get("tg_id")]


def tg_send(token, chat_id, text, reply_markup=None):
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json=body, timeout=10)


def notify_pool(ticket):
    """При отправке в общий пул уведомляем всех мастеров."""
    meta = ticket.get("metadata") or {}
    text = f"🆕 Новая заявка №{ticket.get('ticket_no')} в пуле" if ticket.get("ticket_no") else "🆕 Новая заявка в пуле"
    if ticket.get("category"):
        text += f"\nКатегория: {ticket['category']}"
    if meta.get("description"):
        text += f"\nПроблема: {meta['description']}"
    if meta.get("urgency"):
        text += f"\nСрочность: {meta['urgency']}"
    if meta.get("photo_url"):
        text += f"\n📷 Фото: {meta['photo_url']}"
    markup = {"inline_keyboard": [[{"text": "🧰 Открыть кабинет", "web_app": {"url": CABINET_URL}}]]} if CABINET_URL else None
    try:
        for mid in fetch_master_ids():
            try:
                tg_send(TG_MASTER_BOT_TOKEN, mid, text, markup)
            except Exception as e:
                print(f"pool notify error {mid}: {e}")
    except Exception as e:
        print(f"fetch masters error: {e}")


def fetch_master(master_id):
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/masters?id=eq.{master_id}&select=tg_id,name", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def notify_master_task(ticket):
    """Возврат в работу: если у заявки есть мастер — снова шлём ему задачу."""
    mid = ticket.get("assigned_master_id")
    if not mid:
        return
    m = fetch_master(mid)
    if not m or not m.get("tg_id"):
        return
    meta = ticket.get("metadata") or {}
    parts = [f"🔄 Заявка №{ticket.get('ticket_no')} снова в работе" if ticket.get("ticket_no") else "🔄 Заявка снова в работе"]
    if ticket.get("category"): parts.append(f"Категория: {ticket['category']}")
    if meta.get("name"): parts.append(f"Клиент: {meta['name']}")
    if meta.get("phone"): parts.append(f"Телефон: {meta['phone']}")
    if meta.get("address"): parts.append(f"Адрес: {meta['address']}")
    if meta.get("description"): parts.append(f"Проблема: {meta['description']}")
    if meta.get("photo_url"): parts.append(f"📷 Фото: {meta['photo_url']}")
    inline = {"inline_keyboard": [[
        {"text": "✅ Выполнено", "callback_data": f"done:{ticket['id']}"},
        {"text": "↩️ Отклонить", "callback_data": f"reject:{ticket['id']}"},
    ]]}
    try:
        tg_send(TG_MASTER_BOT_TOKEN, m["tg_id"], "\n".join(parts), inline)
    except Exception as e:
        print(f"master re-notify error: {e}")


class handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            if not is_authenticated(self.headers):
                self._send(401, {"ok": False, "error": "unauthorized"}); return
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            ticket_id = body.get("id")
            status = body.get("status")
            category = body.get("category")

            if not ticket_id:
                self._send(400, {"ok": False, "error": "bad request"}); return

            fields = {}
            if status is not None:
                if status not in ALLOWED_STATUSES:
                    self._send(400, {"ok": False, "error": "bad status"}); return
                fields["status"] = status
                if status == "pool":
                    # в пуле заявка без мастера — снимаем назначение
                    fields["assigned_master_id"] = None
                    fields["assigned_master_name"] = None
            if category is not None:
                fields["category"] = category
            if not fields:
                self._send(400, {"ok": False, "error": "nothing to update"}); return

            ticket = update_ticket(ticket_id, fields)

            if status == "pool" and ticket:
                notify_pool(ticket)
            elif status == "in_progress" and ticket:
                if ticket.get("client_tg_id"):
                    try:
                        tg_send(TG_BOT_TOKEN, ticket["client_tg_id"], CLIENT_MESSAGES["in_progress"])
                    except Exception as e:
                        print(f"client notify error: {e}")
                notify_master_task(ticket)
            elif status == "done" and ticket and ticket.get("client_tg_id"):
                try:
                    tg_send(TG_BOT_TOKEN, ticket["client_tg_id"], DONE_TEXT, review_markup(ticket_id))
                except Exception as e:
                    print(f"client notify error: {e}")
            elif status in CLIENT_MESSAGES and ticket and ticket.get("client_tg_id"):
                try:
                    tg_send(TG_BOT_TOKEN, ticket["client_tg_id"], CLIENT_MESSAGES[status])
                except Exception as e:
                    print(f"client notify error: {e}")

            self._send(200, {"ok": True})
        except Exception as e:
            print(f"Error: {e}")
            self._send(500, {"ok": False, "error": "server error"})
