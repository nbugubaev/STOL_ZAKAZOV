import os
import json
import requests
from datetime import datetime
from http.server import BaseHTTPRequestHandler

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")                 # КЛИЕНТСКИЙ бот
TG_MASTER_BOT_TOKEN = os.environ.get("TG_MASTER_BOT_TOKEN")  # бот мастеров (для уведомлений персоналу)
WEBAPP_URL = os.environ.get("WEBAPP_URL")                    # форма клиента
CABINET_URL = os.environ.get("CABINET_URL")                  # кабинет мастера (кнопка в уведомлении мастерам)
MODERATOR_IDS = [x.strip() for x in (os.environ.get("MODERATOR_CHAT_IDS") or "").split(",") if x.strip()]

BTN_NEW = "📝 Оставить заявку"
BTN_MY = "📋 Мои заявки"
BTN_INFO = "ℹ️ Как мы работаем"

STATUS_LABELS = {
    "new": "🟡 Новая", "pool": "🟡 В пуле", "in_progress": "🔵 В работе",
    "done": "🟢 Выполнена", "cancelled": "⚪ Отменена",
}

# Текст об условиях сервиса. Отредактируй под себя.
INFO_TEXT = (
    "ℹ️ Как мы работаем\n\n"
    "1. Вы оставляете заявку через кнопку «📝 Оставить заявку».\n"
    "2. Мастер приезжает на диагностику.\n"
    "3. После диагностики называем точную стоимость ремонта.\n"
    "4. По согласованию выполняем ремонт.\n\n"
    "💰 Стоимость\n"
    "• Диагностика — 15 000 ₸ (в пределах города).\n"
    "• Ремонт — от 30 000 ₸, зависит от сложности.\n"
    "• Точная стоимость — по итогам диагностики.\n\n"
    "🛡 Гарантия\n"
    "Гарантия на работы предоставляется в зависимости от типа оборудования и его состояния.\n\n"
    "Создавая заявку, вы соглашаетесь с условиями сервиса."
)

DB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


def insert_ticket(chat_id, form, status="new"):
    headers = dict(DB_HEADERS); headers["Prefer"] = "return=minimal"
    requests.post(f"{SUPABASE_URL}/rest/v1/tickets", headers=headers,
                  json={"client_tg_id": chat_id, "status": status, "metadata": form}, timeout=10).raise_for_status()


def fetch_setting(key, default=None):
    try:
        resp = requests.get(f"{SUPABASE_URL}/rest/v1/settings?key=eq.{key}&select=value", headers=DB_HEADERS, timeout=10)
        resp.raise_for_status()
        rows = resp.json()
        return rows[0]["value"] if rows else default
    except Exception as e:
        print(f"setting error: {e}")
        return default


def is_manual_moderation():
    # По умолчанию ручная модерация включена (безопаснее)
    return (fetch_setting("manual_moderation", "true") or "true").lower() != "false"


def notify_masters_pool(form):
    """Уведомляет всех мастеров о заявке, попавшей сразу в пул (авто-режим)."""
    desc = (form.get("description") or "без описания").strip()
    urgency = (form.get("urgency") or "").strip()
    photo = (form.get("photo_url") or "").strip()
    text = f"🆕 Новая заявка в пуле\nПроблема: {desc}"
    if urgency: text += f"\nСрочность: {urgency}"
    if photo: text += f"\n📷 Фото: {photo}"
    markup = {"inline_keyboard": [[{"text": "🧰 Открыть кабинет", "web_app": {"url": CABINET_URL}}]]} if CABINET_URL else None
    try:
        for mid in fetch_master_ids():
            safe_send(TG_MASTER_BOT_TOKEN, mid, text, reply_markup=markup)
    except Exception as e:
        print(f"pool notify error: {e}")


def fetch_my_tickets(chat_id):
    url = f"{SUPABASE_URL}/rest/v1/tickets?client_tg_id=eq.{chat_id}&order=created_at.desc&limit=10&select=*"
    resp = requests.get(url, headers=DB_HEADERS, timeout=10); resp.raise_for_status()
    return resp.json()


def fetch_master_ids():
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/masters?select=tg_id", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    return [r["tg_id"] for r in resp.json() if r.get("tg_id")]


def fetch_moderator_ids():
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/moderators?select=tg_id", headers=DB_HEADERS, timeout=10)
    resp.raise_for_status()
    return [r["tg_id"] for r in resp.json() if r.get("tg_id")]


def tg_send(token, chat_id, text, reply_markup=None):
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json=body, timeout=10)


def safe_send(token, chat_id, text, reply_markup=None):
    try:
        tg_send(token, chat_id, text, reply_markup)
    except Exception as e:
        print(f"send error to {chat_id}: {e}")


def main_keyboard():
    return {"keyboard": [
        [{"text": BTN_NEW, "web_app": {"url": WEBAPP_URL}}],
        [{"text": BTN_MY}, {"text": BTN_INFO}],
    ], "resize_keyboard": True}


def notify_new_ticket(form):
    """При создании заявка уходит ТОЛЬКО модераторам (мастера получат её при попадании в пул)."""
    desc = (form.get("description") or "без описания").strip()
    urgency = (form.get("urgency") or "").strip()
    name = (form.get("name") or "").strip()
    phone = (form.get("phone") or "").strip()
    photo = (form.get("photo_url") or "").strip()

    mod_text = "🆕 Новая заявка\n"
    if name: mod_text += f"Клиент: {name}\n"
    if phone: mod_text += f"Телефон: {phone}\n"
    mod_text += f"Проблема: {desc}"
    if urgency: mod_text += f"\nСрочность: {urgency}"
    if photo: mod_text += f"\n📷 Фото: {photo}"
    try:
        moderator_ids = fetch_moderator_ids() or MODERATOR_IDS
    except Exception as e:
        print(f"fetch moderators error: {e}")
        moderator_ids = MODERATOR_IDS
    for mid in moderator_ids:
        safe_send(TG_MASTER_BOT_TOKEN, mid, mod_text)


def fmt_date(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%d.%m.%Y %H:%M")
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
        if t.get("assigned_master_name"):
            block += f"\nМастер: {t['assigned_master_name']}"
        blocks.append(block)
    return "\n\n".join(blocks)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers['Content-Length'])
            update = json.loads(self.rfile.read(length).decode('utf-8'))

            message = update.get("message")
            if message:
                chat_id = message["chat"]["id"]
                if "web_app_data" in message:
                    form = json.loads(message["web_app_data"]["data"])
                    manual = is_manual_moderation()
                    insert_ticket(chat_id, form, "new" if manual else "pool")
                    notify_new_ticket(form)            # модераторам — всегда
                    if not manual:
                        notify_masters_pool(form)      # авто-режим — сразу мастерам в пул
                    tg_send(TG_BOT_TOKEN, chat_id, "✅ Заявка принята! Передали в обработку.", main_keyboard())
                elif "text" in message:
                    text = message["text"]
                    if text in (BTN_INFO, "/info"):
                        tg_send(TG_BOT_TOKEN, chat_id, INFO_TEXT, main_keyboard())
                    elif text in (BTN_MY, "/my"):
                        tg_send(TG_BOT_TOKEN, chat_id, build_my_tickets_text(fetch_my_tickets(chat_id)), main_keyboard())
                    else:
                        tg_send(TG_BOT_TOKEN, chat_id, "Здравствуйте! Выберите действие на клавиатуре ниже.", main_keyboard())

            self.send_response(200); self.send_header('Content-type', 'text/plain'); self.end_headers()
            self.wfile.write(b"OK")
        except Exception as e:
            print(f"Error: {e}")
            self.send_response(200); self.end_headers(); self.wfile.write(b"Error ignored")
