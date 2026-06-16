import os
import json
import requests
from http.server import BaseHTTPRequestHandler

# Переменные окружения из настроек Vercel.
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")
# Полный URL страницы формы, например https://stol-zakazov.vercel.app/form.html
WEBAPP_URL = os.environ.get("WEBAPP_URL")


def insert_ticket(chat_id, form):
    """Сохраняет заявку напрямую через REST API Supabase (PostgREST)."""
    url = f"{SUPABASE_URL}/rest/v1/tickets"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payload = {
        "client_tg_id": chat_id,
        "status": "new",
        "metadata": form,  # весь объект формы: имя, телефон, адрес, срочность, описание
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=10)
    resp.raise_for_status()


def send_message(chat_id, text, reply_markup=None):
    """Отправляет сообщение пользователю (опционально с клавиатурой)."""
    body = {"chat_id": chat_id, "text": text}
    if reply_markup:
        body["reply_markup"] = reply_markup
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage",
        json=body,
        timeout=10,
    )


def send_form_button(chat_id):
    """Показывает кнопку, открывающую форму Mini App."""
    keyboard = {
        "keyboard": [[{"text": "📝 Оставить заявку", "web_app": {"url": WEBAPP_URL}}]],
        "resize_keyboard": True,
    }
    send_message(
        chat_id,
        "Здравствуйте! Нажмите кнопку ниже, чтобы оставить заявку.",
        reply_markup=keyboard,
    )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            update = json.loads(post_data.decode('utf-8'))

            message = update.get("message")
            if message:
                chat_id = message["chat"]["id"]

                # 1) Пришли данные из формы Mini App
                if "web_app_data" in message:
                    form = json.loads(message["web_app_data"]["data"])
                    insert_ticket(chat_id, form)
                    send_message(
                        chat_id,
                        "✅ Заявка принята! Передали модератору, скоро назначим мастера.",
                    )

                # 2) Любое текстовое сообщение → показываем кнопку с формой
                elif "text" in message:
                    send_form_button(chat_id)

            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"OK")

        except Exception as e:
            # Логируем ошибку в консоль Vercel, но возвращаем 200,
            # чтобы Telegram не спамил повторными запросами
            print(f"Error: {e}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Error ignored")
