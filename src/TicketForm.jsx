import { useEffect, useRef, useState } from 'react'

// SDK Telegram доступен только когда страница открыта внутри Telegram
const tg = window.Telegram?.WebApp
const inTelegram = Boolean(tg && tg.initData !== undefined)

// Цвета берём из темы Telegram (светлая/тёмная подхватятся сами), с запасными значениями
const c = {
  bg: 'var(--tg-theme-bg-color, #ffffff)',
  text: 'var(--tg-theme-text-color, #111827)',
  hint: 'var(--tg-theme-hint-color, #6b7280)',
  border: 'var(--tg-theme-section-separator-color, #e5e7eb)',
  field: 'var(--tg-theme-secondary-bg-color, #f3f4f6)',
  btn: 'var(--tg-theme-button-color, #2563eb)',
  btnText: 'var(--tg-theme-button-text-color, #ffffff)',
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px',
  marginTop: '6px',
  borderRadius: '10px',
  border: `1px solid ${c.border}`,
  backgroundColor: c.field,
  color: c.text,
  fontSize: '16px', // 16px чтобы iOS не зумил поле при фокусе
  outline: 'none',
}

const labelStyle = { display: 'block', marginBottom: '14px', fontSize: '14px', color: c.hint }

export default function TicketForm() {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    urgency: 'Обычная',
    description: '',
  })
  const [error, setError] = useState('')

  // ref всегда хранит свежие данные — нужен для нативной кнопки Telegram
  const formRef = useRef(form)
  formRef.current = form

  const submit = () => {
    const f = formRef.current
    if (!f.name.trim() || !f.phone.trim() || !f.description.trim()) {
      setError('Заполните имя, телефон и описание проблемы.')
      return
    }
    setError('')
    const payload = JSON.stringify(f)
    if (tg && tg.sendData) {
      tg.sendData(payload) // отправляет данные боту и закрывает окно
    } else {
      // Открыто вне Telegram — режим отладки
      alert('Форма работает внутри Telegram.\n\nСобранные данные:\n' + payload)
    }
  }

  useEffect(() => {
    if (!inTelegram) return
    tg.ready()
    tg.expand()
    // Нативная кнопка Telegram снизу
    tg.MainButton.setText('Отправить заявку')
    tg.MainButton.show()
    tg.MainButton.onClick(submit)
    return () => tg.MainButton.offClick(submit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: c.bg,
      color: c.text,
      fontFamily: 'system-ui, sans-serif',
      padding: '20px',
      boxSizing: 'border-box',
    }}>
      <h2 style={{ margin: '0 0 6px 0' }}>Новая заявка</h2>
      <p style={{ margin: '0 0 20px 0', color: c.hint, fontSize: '14px' }}>
        Заполните поля — мы передадим заявку модератору.
      </p>

      <label style={labelStyle}>
        Имя *
        <input style={inputStyle} value={form.name} onChange={update('name')} placeholder="Как к вам обращаться" />
      </label>

      <label style={labelStyle}>
        Телефон *
        <input style={inputStyle} type="tel" value={form.phone} onChange={update('phone')} placeholder="+7 ..." />
      </label>

      <label style={labelStyle}>
        Адрес
        <input style={inputStyle} value={form.address} onChange={update('address')} placeholder="Улица, дом, квартира" />
      </label>

      <label style={labelStyle}>
        Срочность
        <select style={inputStyle} value={form.urgency} onChange={update('urgency')}>
          <option>Обычная</option>
          <option>Срочная</option>
        </select>
      </label>

      <label style={labelStyle}>
        Описание проблемы *
        <textarea
          style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
          value={form.description}
          onChange={update('description')}
          placeholder="Опишите, что случилось"
        />
      </label>

      {error && (
        <p style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 14px 0' }}>{error}</p>
      )}

      {/* Если форма открыта вне Telegram (нативной кнопки нет) — показываем свою */}
      {!inTelegram && (
        <button
          onClick={submit}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '10px',
            border: 'none',
            backgroundColor: c.btn,
            color: c.btnText,
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Отправить заявку
        </button>
      )}
    </div>
  )
}
