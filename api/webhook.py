import os
import json
import requests
from http.server import BaseHTTPRequestHandler
from supabase import create_client, Client

# Получаем переменные окружения из настроек Vercel.
# ВАЖНО: для серверной вставки используем SERVICE_ROLE ключ (он обходит RLS).
# У него НЕ должно быть префикса VITE_, иначе он попадёт в публичный фронтенд!
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN")

# Инициализируем клиент базы данных с привилегированным ключом
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            update = json.loads(post_data.decode('utf-8'))

            # Проверяем, что это текстовое сообщение
            if "message" in update and "text" in update["message"]:
                chat_id = update["message"]["chat"]["id"]
                text = update["message"]["text"]

                # Игнорируем технические команды вроде /start
                if text.startswith('/'):
                    text = "Заявка через команду: " + text

                # Сохраняем заявку в Supabase
                supabase.table("tickets").insert({
                    "client_tg_id": chat_id,
                    "status": "new",
                    "metadata": {"description": text}
                }).execute()

                # Отвечаем пользователю в Telegram
                send_url = f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage"
                requests.post(send_url, json={
                    "chat_id": chat_id,
                    "text": "✅ Заявка принята! Передали модератору, скоро назначим мастера."
                })

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
