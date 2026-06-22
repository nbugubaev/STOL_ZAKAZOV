import os
import json
import time
import hmac
import hashlib
from urllib.parse import parse_qsl
import requests
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")  # подпись формы = токен КЛИЕНТСКОГО бота

MAX_AGE = 24 * 3600

DB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


def verify_init_data(init_data):
    """Проверяет подпись initData токеном клиентского бота и возвращает пользователя."""
    if not init_data:
        return None
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        return None
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None
    data_check = "\n".join(f"{k}={parsed[k]}" for k in sorted(parsed))
    secret = hmac.new(b"WebAppData", TG_BOT_TOKEN.encode(), hashlib.sha256).digest()
    computed = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, received_hash):
        return None
    try:
        auth_date = int(parsed.get("auth_date", "0"))
        if MAX_AGE and (time.time() - auth_date) > MAX_AGE:
            return None
    except Exception:
        pass
    try:
        return json.loads(parsed["user"])
    except Exception:
        return None


def get_client(tg_id):
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/clients?tg_id=eq.{tg_id}&select=name,phone,address", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


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
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            user = verify_init_data(body.get("init_data"))
            if not user or not user.get("id"):
                self._send(401, {"ok": False, "error": "unauthorized"}); return

            profile = None
            try:
                profile = get_client(user["id"])
            except Exception as e:
                print(f"get client error: {e}")

            self._send(200, {"ok": True, "profile": profile})
        except Exception as e:
            print(f"Error: {e}")
            self._send(500, {"ok": False, "error": "server error"})
