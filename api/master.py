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
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")
MASTER_CODE = os.environ.get("MASTER_REGISTER_CODE")
TG_MASTER_BOT_TOKEN = os.environ.get("TG_MASTER_BOT_TOKEN")  # подпись кабинета = токен бота мастеров

# Сколько времени данные входа считаются свежими (защита от переиспользования)
MAX_AGE = 24 * 3600

DB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


# ---------- проверка подписи Telegram ----------

def verify_init_data(init_data):
    """Проверяет подпись initData бот-токеном и возвращает данные пользователя."""
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
    secret = hmac.new(b"WebAppData", TG_MASTER_BOT_TOKEN.encode(), hashlib.sha256).digest()
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


# ---------- база ----------

def db_get(path):
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_master_by_tg(tg_id):
    rows = db_get(f"masters?tg_id=eq.{tg_id}&select=*")
    return rows[0] if rows else None


def upsert_master(tg_id, name, phone, specialization):
    url = f"{SUPABASE_URL}/rest/v1/masters?on_conflict=tg_id"
    headers = dict(DB_HEADERS)
    headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    payload = {"tg_id": tg_id, "name": name, "phone": phone, "specialization": specialization}
    resp = requests.post(url, headers=headers, json=payload, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def get_pool():
    return db_get("tickets?status=eq.pool&assigned_master_id=is.null&order=created_at.desc&limit=30&select=*")


def get_my(master_id, status):
    return db_get(f"tickets?assigned_master_id=eq.{master_id}&status=eq.{status}&order=created_at.desc&limit=30&select=*")


def fetch_moderator_ids():
    return [r["tg_id"] for r in db_get("moderators?select=tg_id") if r.get("tg_id")]


def notify_moderators(text):
    try:
        for mid in fetch_moderator_ids():
            try:
                requests.post(f"https://api.telegram.org/bot{TG_MASTER_BOT_TOKEN}/sendMessage",
                              json={"chat_id": mid, "text": text}, timeout=10)
            except Exception as e:
                print(f"moderator notify error {mid}: {e}")
    except Exception as e:
        print(f"fetch moderators error: {e}")


def take_ticket(ticket_id, master):
    # Условие защищает от того, что двое возьмут один заказ одновременно
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}&status=eq.pool&assigned_master_id=is.null"
    headers = dict(DB_HEADERS)
    headers["Prefer"] = "return=representation"
    payload = {"assigned_master_id": master["id"], "assigned_master_name": master.get("name"), "status": "in_progress"}
    resp = requests.patch(url, headers=headers, json=payload, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def complete_ticket(ticket_id, master):
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}&assigned_master_id=eq.{master['id']}"
    headers = dict(DB_HEADERS)
    headers["Prefer"] = "return=representation"
    resp = requests.patch(url, headers=headers, json={"status": "done"}, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def reject_ticket(ticket_id, master):
    # Мастер отклоняет назначенную задачу — возвращаем модератору («Новая», без мастера)
    url = f"{SUPABASE_URL}/rest/v1/tickets?id=eq.{ticket_id}&assigned_master_id=eq.{master['id']}"
    headers = dict(DB_HEADERS)
    headers["Prefer"] = "return=representation"
    payload = {"status": "new", "assigned_master_id": None, "assigned_master_name": None}
    resp = requests.patch(url, headers=headers, json=payload, timeout=10)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def notify_client(chat_id, text, reply_markup=None):
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage",
        json=body,
        timeout=10,
    )


def review_markup(tid):
    return {"inline_keyboard": [[
        {"text": "1⭐", "callback_data": f"rate:{tid}:1"},
        {"text": "2⭐", "callback_data": f"rate:{tid}:2"},
        {"text": "3⭐", "callback_data": f"rate:{tid}:3"},
        {"text": "4⭐", "callback_data": f"rate:{tid}:4"},
        {"text": "5⭐", "callback_data": f"rate:{tid}:5"},
    ]]}


def slim(t):
    return {
        "id": t.get("id"),
        "ticket_no": t.get("ticket_no"),
        "status": t.get("status"),
        "created_at": t.get("created_at"),
        "metadata": t.get("metadata") or {},
    }


def cabinet_payload(master):
    return {
        "ok": True,
        "registered": True,
        "profile": {
            "name": master.get("name"),
            "phone": master.get("phone"),
            "specialization": master.get("specialization"),
        },
        "pool": [slim(t) for t in get_pool()],
        "active": [slim(t) for t in get_my(master["id"], "in_progress")],
        "done": [slim(t) for t in get_my(master["id"], "done")],
    }


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
            action = body.get("action")

            user = verify_init_data(body.get("init_data"))
            if not user or "id" not in user:
                self._send(401, {"ok": False, "error": "auth failed"})
                return
            tg_id = user["id"]

            # Регистрация (без кодового слова)
            if action == "register":
                name = ((body.get("name") or "").strip()
                        or f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
                        or f"Мастер {tg_id}")
                upsert_master(tg_id, name, (body.get("phone") or "").strip(), (body.get("specialization") or "").strip())

            master = get_master_by_tg(tg_id)
            if not master:
                self._send(200, {"ok": True, "registered": False})
                return

            # Действия с заказами
            if action == "take":
                row = take_ticket(body.get("ticket_id"), master)
                if row and row.get("client_tg_id"):
                    notify_client(row["client_tg_id"], f"🔧 Вам назначен мастер: {master.get('name')}. Скоро свяжется с вами.")
            elif action == "complete":
                row = complete_ticket(body.get("ticket_id"), master)
                if row and row.get("client_tg_id"):
                    notify_client(row["client_tg_id"],
                                  "✅ Ваша заявка выполнена. Спасибо, что обратились!\n\nОцените работу мастера 👇",
                                  review_markup(row["id"]))
            elif action == "reject":
                row = reject_ticket(body.get("ticket_id"), master)
                if row:
                    desc = (row.get("metadata") or {}).get("description", "заявка")
                    notify_moderators(f"↩️ Мастер {master.get('name')} отклонил заявку. Вернулась на распределение.\nПроблема: {desc}")

            self._send(200, cabinet_payload(master))

        except Exception as e:
            print(f"Error: {e}")
            self._send(500, {"ok": False, "error": "server error"})
