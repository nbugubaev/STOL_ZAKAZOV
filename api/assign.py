import os
import json
import requests
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")                # клиентский бот
TG_MASTER_BOT_TOKEN = os.environ.get("TG_MASTER_BOT_TOKEN")  # бот мастеров
SUPABASE_ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")

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


def get_master(master_id):
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/masters?id=eq.{master_id}&select=*", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def assign_ticket(ticket_id, master_id, master_name):
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}"
    headers = dict(DB_HEADERS); headers["Prefer"] = "return=representation"
    payload = {"assigned_master_id": master_id, "assigned_master_name": master_name, "status": "in_progress"}
    resp = requests.patch(url, headers=headers, json=payload, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def tg_send(token, chat_id, text, reply_markup=None):
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json=body, timeout=10)


def build_task_text(ticket):
    meta = ticket.get("metadata") or {}
    parts = ["🛠 Новая задача"]
    if meta.get("name"): parts.append(f"Клиент: {meta['name']}")
    if meta.get("phone"): parts.append(f"Телефон: {meta['phone']}")
    if meta.get("address"): parts.append(f"Адрес: {meta['address']}")
    if meta.get("urgency"): parts.append(f"Срочность: {meta['urgency']}")
    if meta.get("description"): parts.append(f"Проблема: {meta['description']}")
    return "\n".join(parts)


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
                self._send(401, {"ok": False, "error": "unauthorized"})
                return
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            ticket_id = body.get("ticket_id")
            master_id = body.get("master_id")
            if not ticket_id or not master_id:
                self._send(400, {"ok": False, "error": "bad request"}); return

            master = get_master(master_id)
            if not master:
                self._send(404, {"ok": False, "error": "master not found"}); return

            ticket = assign_ticket(ticket_id, master_id, master.get("name"))

            # Задача мастеру — через бот мастеров, с кнопками закрытия
            inline = {"inline_keyboard": [[
                {"text": "✅ Выполнено", "callback_data": f"done:{ticket_id}"},
                {"text": "❌ Отменить", "callback_data": f"cancel:{ticket_id}"},
            ]]}
            try:
                tg_send(TG_MASTER_BOT_TOKEN, master["tg_id"], build_task_text(ticket), inline)
            except Exception as e:
                print(f"master notify error: {e}")

            # Клиенту — через клиентский бот
            if ticket and ticket.get("client_tg_id"):
                try:
                    tg_send(TG_BOT_TOKEN, ticket["client_tg_id"], f"🔧 Вам назначен мастер: {master.get('name')}. Скоро свяжется с вами.")
                except Exception as e:
                    print(f"client notify error: {e}")

            self._send(200, {"ok": True})
        except Exception as e:
            print(f"Error: {e}")
            self._send(500, {"ok": False, "error": "server error"})
