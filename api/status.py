import os
import json
import requests
from http.server import BaseHTTPRequestHandler

# Переменные окружения из настроек Vercel.
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")
SUPABASE_ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")


def is_authenticated(headers):
    """Проверяет токен входа модератора через Supabase Auth."""
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        return False

# Допустимые статусы
ALLOWED_STATUSES = {"new", "in_progress", "done", "cancelled"}

# Текст уведомления клиенту в зависимости от нового статуса.
# Для "new" уведомление не шлём (это исходный статус).
CLIENT_MESSAGES = {
    "in_progress": "🔧 Ваша заявка взята в работу. Скоро с вами свяжется мастер.",
    "done": "✅ Ваша заявка выполнена. Спасибо, что обратились!",
    "cancelled": "❌ Ваша заявка отменена. Если это ошибка — напишите нам ещё раз.",
}


def update_ticket_status(ticket_id, status):
    """Меняет статус заявки и возвращает обновлённую строку."""
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",  # вернёт обновлённую строку
    }
    resp = requests.patch(url, headers=headers, json={"status": status}, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def notify_client(chat_id, status):
    """Шлёт клиенту сообщение в Telegram о новом статусе."""
    text = CLIENT_MESSAGES.get(status)
    if not text:
        return
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage",
        json={"chat_id": chat_id, "text": text},
        timeout=10,
    )


class handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        # CORS preflight (на всякий случай)
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
            ticket_id = body.get("id")
            status = body.get("status")

            if not ticket_id or status not in ALLOWED_STATUSES:
                self._send(400, {"ok": False, "error": "bad request"})
                return

            ticket = update_ticket_status(ticket_id, status)
            if ticket and ticket.get("client_tg_id"):
                notify_client(ticket["client_tg_id"], status)

            self._send(200, {"ok": True})

        except Exception as e:
            print(f"Error: {e}")
            self._send(500, {"ok": False, "error": "server error"})
