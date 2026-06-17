import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const field = (t, k) => t.metadata?.[k]

const STATUS = {
  new:         { label: 'Новая',     bg: '#fef3c7', color: '#92400e' },
  in_progress: { label: 'В работе',  bg: '#dbeafe', color: '#1e40af' },
  done:        { label: 'Выполнена', bg: '#d1fae5', color: '#065f46' },
  cancelled:   { label: 'Отменена',  bg: '#f3f4f6', color: '#6b7280' },
}

const ACTIONS = {
  new:         [{ to: 'in_progress', label: 'Взять в работу' }, { to: 'cancelled', label: 'Отменить' }],
  in_progress: [{ to: 'done', label: 'Выполнено' }, { to: 'cancelled', label: 'Отменить' }],
  done:        [{ to: 'in_progress', label: 'Вернуть в работу' }],
  cancelled:   [{ to: 'in_progress', label: 'Вернуть в работу' }],
}

// ---------- Экран входа ----------
function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr('Неверный email или пароль')
    setBusy(false)
  }

  return (
    <div style={{ maxWidth: '360px', margin: '80px auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '20px', color: '#111827' }}>Вход модератора</h1>
      <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '20px' }}>Доступ только для сотрудников.</p>
      <input
        type="email" placeholder="Email" value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: '100%', padding: '12px', marginBottom: '10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '16px', boxSizing: 'border-box' }}
      />
      <input
        type="password" placeholder="Пароль" value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        style={{ width: '100%', padding: '12px', marginBottom: '10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '16px', boxSizing: 'border-box' }}
      />
      {err && <p style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 10px' }}>{err}</p>}
      <button
        onClick={submit} disabled={busy}
        style={{ width: '100%', padding: '13px', borderRadius: '8px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
      >
        {busy ? '…' : 'Войти'}
      </button>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [tickets, setTickets] = useState([])
  const [masters, setMasters] = useState([])
  const [selected, setSelected] = useState({})
  const [busyId, setBusyId] = useState(null)

  // Следим за сессией входа
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // После входа — грузим данные и подписываемся на обновления
  useEffect(() => {
    if (!session) return
    supabase.realtime.setAuth(session.access_token)
    fetchTickets()
    fetchMasters()

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setTickets((cur) => [payload.new, ...cur.filter((t) => t.id !== payload.new.id)])
        } else if (payload.eventType === 'UPDATE') {
          setTickets((cur) => cur.map((t) => (t.id === payload.new.id ? payload.new : t)))
        } else if (payload.eventType === 'DELETE') {
          setTickets((cur) => cur.filter((t) => t.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [session])

  const fetchTickets = async () => {
    const { data, error } = await supabase.from('tickets').select('*').order('created_at', { ascending: false })
    if (data) setTickets(data)
    if (error) console.error('Ошибка загрузки заявок:', error)
  }

  const fetchMasters = async () => {
    const { data, error } = await supabase.from('masters').select('id, name').order('name')
    if (data) setMasters(data)
    if (error) console.error('Ошибка загрузки мастеров:', error)
  }

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  })

  const changeStatus = async (id, status) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/status', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id, status }) })
      if (!res.ok) throw new Error('сервер вернул ошибку')
      setTickets((cur) => cur.map((t) => (t.id === id ? { ...t, status } : t)))
    } catch (e) {
      alert('Не удалось изменить статус: ' + e.message)
    } finally {
      setBusyId(null)
    }
  }

  const assignMaster = async (ticketId) => {
    const masterId = selected[ticketId]
    if (!masterId) { alert('Сначала выберите мастера'); return }
    setBusyId(ticketId)
    try {
      const res = await fetch('/api/assign', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ticket_id: ticketId, master_id: masterId }) })
      if (!res.ok) throw new Error('сервер вернул ошибку')
      const m = masters.find((x) => x.id === masterId)
      setTickets((cur) => cur.map((t) =>
        t.id === ticketId ? { ...t, status: 'in_progress', assigned_master_name: m?.name } : t
      ))
    } catch (e) {
      alert('Не удалось назначить мастера: ' + e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!authReady) return <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>Загрузка…</div>
  if (!session) return <Login />

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#111827' }}>Канбан Модератора 🛠</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', fontSize: '13px', cursor: 'pointer' }}
        >
          Выйти
        </button>
      </div>
      <p style={{ color: '#6b7280', marginBottom: '20px' }}>Новые заявки появляются здесь автоматически.</p>

      <div style={{ display: 'grid', gap: '15px' }}>
        {tickets.map((ticket) => {
          const st = STATUS[ticket.status] || { label: String(ticket.status), bg: '#f3f4f6', color: '#374151' }
          const urgent = field(ticket, 'urgency') === 'Срочная'
          const actions = ACTIONS[ticket.status] || []
          const busy = busyId === ticket.id
          const masterName = ticket.assigned_master_name

          return (
            <div key={ticket.id} style={{
              backgroundColor: 'white',
              border: `1px solid ${urgent ? '#fecaca' : '#e5e7eb'}`,
              borderLeft: `4px solid ${urgent ? '#dc2626' : '#e5e7eb'}`,
              padding: '15px', borderRadius: '8px',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              opacity: busy ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#374151' }}>
                  {field(ticket, 'name') || `Клиент ${ticket.client_tg_id}`}
                </span>
                <span style={{ backgroundColor: st.bg, color: st.color, padding: '4px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>
                  {st.label}
                </span>
              </div>

              {urgent && (
                <span style={{ display: 'inline-block', backgroundColor: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, marginBottom: '10px' }}>
                  СРОЧНАЯ
                </span>
              )}

              <p style={{ color: '#111827', margin: '0 0 10px 0' }}>
                {field(ticket, 'description') || 'Нет описания'}
              </p>

              <div style={{ fontSize: '13px', color: '#4b5563', lineHeight: 1.6 }}>
                {field(ticket, 'phone') && <div>📞 {field(ticket, 'phone')}</div>}
                {field(ticket, 'address') && <div>📍 {field(ticket, 'address')}</div>}
                {masterName && <div>👷 Мастер: {masterName}</div>}
              </div>

              <div style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0' }}>
                ID: {ticket.client_tg_id} · {new Date(ticket.created_at).toLocaleString('ru-RU')}
              </div>

              {!masterName && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {masters.length === 0 ? (
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>Нет мастеров. Пусть мастер напишет боту: /cabinet</span>
                  ) : (
                    <>
                      <select
                        value={selected[ticket.id] || ''} disabled={busy}
                        onChange={(e) => setSelected((s) => ({ ...s, [ticket.id]: e.target.value }))}
                        style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}
                      >
                        <option value="">Выберите мастера…</option>
                        {masters.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
                      </select>
                      <button
                        disabled={busy} onClick={() => assignMaster(ticket.id)}
                        style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
                      >
                        Назначить
                      </button>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {actions.map((a) => (
                  <button
                    key={a.to} disabled={busy} onClick={() => changeStatus(ticket.id, a.to)}
                    style={{
                      padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db',
                      backgroundColor: a.to === 'cancelled' ? '#fff' : '#111827',
                      color: a.to === 'cancelled' ? '#6b7280' : '#fff',
                      fontSize: '13px', fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
