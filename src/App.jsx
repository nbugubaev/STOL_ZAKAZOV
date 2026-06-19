import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseAnonKey)

const field = (t, k) => t.metadata?.[k]

const CATEGORIES = ['Электрика', 'Механика', 'Сантехника', 'Определить на месте']

const STATUS = {
  new:         { label: 'Новая',     dot: '🟡', bg: '#fef3c7', color: '#92400e', col: '#fffbeb' },
  pool:        { label: 'В пуле',    dot: '🟠', bg: '#ffedd5', color: '#9a3412', col: '#fff7ed' },
  in_progress: { label: 'В работе',  dot: '🔵', bg: '#dbeafe', color: '#1e40af', col: '#eff6ff' },
  done:        { label: 'Выполнена', dot: '🟢', bg: '#d1fae5', color: '#065f46', col: '#ecfdf5' },
  cancelled:   { label: 'Отменена',  dot: '⚪', bg: '#f3f4f6', color: '#6b7280', col: '#f9fafb' },
}

const COLUMNS = [
  { key: 'new',         title: 'Новые' },
  { key: 'pool',        title: 'В пуле' },
  { key: 'in_progress', title: 'В работе' },
  { key: 'done',        title: 'Выполнены' },
  { key: 'cancelled',   title: 'Отменены' },
]

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
  const inp = { width: '100%', padding: '12px', marginBottom: '10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '16px', boxSizing: 'border-box' }
  return (
    <div style={{ maxWidth: '360px', margin: '80px auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '20px', color: '#111827' }}>Вход модератора</h1>
      <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '20px' }}>Доступ только для сотрудников.</p>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
      <input type="password" placeholder="Пароль" value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} style={inp} />
      {err && <p style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 10px' }}>{err}</p>}
      <button onClick={submit} disabled={busy}
        style={{ width: '100%', padding: '13px', borderRadius: '8px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
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
  const [manualMod, setManualMod] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase.realtime.setAuth(session.access_token)
    fetchTickets(); fetchMasters(); fetchSetting()
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

  const fetchSetting = async () => {
    const { data } = await supabase.from('settings').select('value').eq('key', 'manual_moderation')
    if (data && data[0]) setManualMod(data[0].value !== 'false')
  }

  const toggleModeration = async () => {
    const next = !manualMod
    setManualMod(next)
    const { error } = await supabase.from('settings').update({ value: next ? 'true' : 'false' }).eq('key', 'manual_moderation')
    if (error) { alert('Не удалось сохранить настройку'); setManualMod(!next) }
  }

  const authHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` })

  const postStatus = async (payload, optimistic) => {
    setBusyId(payload.id)
    try {
      const res = await fetch('/api/status', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('сервер вернул ошибку')
      setTickets((cur) => cur.map((t) => (t.id === payload.id ? { ...t, ...optimistic } : t)))
    } catch (e) {
      alert('Не удалось обновить: ' + e.message)
    } finally { setBusyId(null) }
  }

  const changeStatus = (id, status) => postStatus({ id, status }, { status })
  const updateCategory = (id, category) => postStatus({ id, category }, { category })

  const assignMaster = async (ticketId) => {
    const masterId = selected[ticketId]
    if (!masterId) { alert('Сначала выберите мастера'); return }
    setBusyId(ticketId)
    try {
      const res = await fetch('/api/assign', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ticket_id: ticketId, master_id: masterId }) })
      if (!res.ok) throw new Error('сервер вернул ошибку')
      const m = masters.find((x) => x.id === masterId)
      setTickets((cur) => cur.map((t) => (t.id === ticketId ? { ...t, status: 'in_progress', assigned_master_name: m?.name } : t)))
    } catch (e) {
      alert('Не удалось назначить мастера: ' + e.message)
    } finally { setBusyId(null) }
  }

  const btn = (bg, color, border) => ({
    padding: '8px 10px', borderRadius: '8px', border: border || 'none',
    backgroundColor: bg, color, fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  })

  const assignControl = (ticket, busy) => (
    masters.length === 0
      ? <span style={{ fontSize: '12px', color: '#9ca3af' }}>Нет мастеров. Пусть мастер напишет боту мастеров: /cabinet</span>
      : (
        <>
          <select value={selected[ticket.id] || ''} disabled={busy}
            onChange={(e) => setSelected((s) => ({ ...s, [ticket.id]: e.target.value }))}
            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px', width: '100%' }}>
            <option value="">Выберите мастера…</option>
            {masters.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
          </select>
          <button disabled={busy} onClick={() => assignMaster(ticket.id)} style={btn('#2563eb', '#fff')}>Назначить мастера</button>
        </>
      )
  )

  const renderCard = (ticket) => {
    const urgent = field(ticket, 'urgency') === 'Срочная'
    const busy = busyId === ticket.id
    const photo = field(ticket, 'photo_url')

    return (
      <div key={ticket.id} style={{
        backgroundColor: 'white',
        border: `1px solid ${urgent ? '#fecaca' : '#e5e7eb'}`,
        borderLeft: `4px solid ${urgent ? '#dc2626' : '#e5e7eb'}`,
        padding: '12px', borderRadius: '8px', marginBottom: '10px',
        boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)', opacity: busy ? 0.6 : 1,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontWeight: 'bold', color: '#374151', fontSize: '14px' }}>
            {field(ticket, 'name') || `Клиент ${ticket.client_tg_id}`}
          </span>
          {urgent && <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>СРОЧНО</span>}
        </div>

        {ticket.category && (
          <span style={{ display: 'inline-block', backgroundColor: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
            🏷 {ticket.category}
          </span>
        )}

        <p style={{ color: '#111827', margin: '0 0 8px 0', fontSize: '14px' }}>
          {field(ticket, 'description') || 'Нет описания'}
        </p>

        <div style={{ fontSize: '12px', color: '#4b5563', lineHeight: 1.6 }}>
          {field(ticket, 'phone') && <div>📞 {field(ticket, 'phone')}</div>}
          {field(ticket, 'address') && <div>📍 {field(ticket, 'address')}</div>}
          {ticket.assigned_master_name && <div>👷 {ticket.assigned_master_name}</div>}
        </div>

        {photo && (
          <a href={photo} target="_blank" rel="noreferrer">
            <img src={photo} alt="фото" style={{ maxWidth: '100%', maxHeight: '140px', borderRadius: '8px', marginTop: '8px', display: 'block' }} />
          </a>
        )}

        <div style={{ fontSize: '11px', color: '#9ca3af', margin: '6px 0' }}>
          {new Date(ticket.created_at).toLocaleString('ru-RU')}
        </div>

        {/* Категория — для новых и в пуле */}
        {(ticket.status === 'new' || ticket.status === 'pool') && (
          <select value={ticket.category || ''} disabled={busy}
            onChange={(e) => updateCategory(ticket.id, e.target.value)}
            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px', width: '100%', marginBottom: '8px' }}>
            <option value="">Категория…</option>
            {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        )}

        {/* Действия по колонке */}
        {ticket.status === 'new' && (
          <div style={{ display: 'grid', gap: '6px' }}>
            {assignControl(ticket, busy)}
            <button disabled={busy} onClick={() => changeStatus(ticket.id, 'pool')} style={btn('#fff', '#9a3412', '1px solid #fdba74')}>В общий пул</button>
            <button disabled={busy} onClick={() => changeStatus(ticket.id, 'cancelled')} style={btn('#fff', '#6b7280', '1px solid #d1d5db')}>Отменить</button>
          </div>
        )}

        {ticket.status === 'pool' && (
          <div style={{ display: 'grid', gap: '6px' }}>
            {assignControl(ticket, busy)}
            <button disabled={busy} onClick={() => changeStatus(ticket.id, 'cancelled')} style={btn('#fff', '#6b7280', '1px solid #d1d5db')}>Отменить</button>
          </div>
        )}

        {ticket.status === 'in_progress' && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => changeStatus(ticket.id, 'done')} style={btn('#111827', '#fff')}>Выполнено</button>
            <button disabled={busy} onClick={() => changeStatus(ticket.id, 'cancelled')} style={btn('#fff', '#6b7280', '1px solid #d1d5db')}>Отменить</button>
          </div>
        )}

        {(ticket.status === 'done' || ticket.status === 'cancelled') && (
          <button disabled={busy} onClick={() => changeStatus(ticket.id, 'in_progress')} style={btn('#fff', '#374151', '1px solid #d1d5db')}>Вернуть в работу</button>
        )}
      </div>
    )
  }

  if (!authReady) return <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>Загрузка…</div>
  if (!session) return <Login />

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', maxWidth: '1300px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#111827', margin: 0 }}>Канбан Модератора 🛠</h1>
        <button onClick={() => supabase.auth.signOut()}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', fontSize: '13px', cursor: 'pointer' }}>
          Выйти
        </button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', margin: '16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '13px', color: '#6b7280', flex: '1 1 320px' }}>
          {manualMod
            ? 'Ручная модерация включена: новые заявки приходят вам. Поставьте категорию и назначьте мастера или отправьте «В общий пул».'
            : 'Ручная модерация выключена: новые заявки сразу попадают в общий пул и видны всем мастерам.'}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', flex: '0 0 auto' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: manualMod ? '#1e40af' : '#6b7280' }}>
            Ручная модерация: {manualMod ? 'Вкл' : 'Выкл'}
          </span>
          <span onClick={toggleModeration} style={{
            width: '46px', height: '26px', borderRadius: '9999px', position: 'relative',
            backgroundColor: manualMod ? '#2563eb' : '#cbd5e1', transition: 'background-color .15s', display: 'inline-block',
          }}>
            <span style={{
              position: 'absolute', top: '3px', left: manualMod ? '23px' : '3px',
              width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff', transition: 'left .15s',
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }} />
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px', alignItems: 'flex-start' }}>
        {COLUMNS.map((col) => {
          const s = STATUS[col.key]
          const items = tickets.filter((t) => t.status === col.key)
          return (
            <div key={col.key} style={{ flex: '1 0 260px', minWidth: '260px', maxWidth: '300px', backgroundColor: s.col, border: '1px solid #e5e7eb', borderRadius: '12px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: 700, color: '#111827', fontSize: '15px' }}>{s.dot} {col.title}</span>
                <span style={{ backgroundColor: s.bg, color: s.color, padding: '2px 9px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700 }}>{items.length}</span>
              </div>
              {items.length === 0
                ? <div style={{ fontSize: '12px', color: '#9ca3af', padding: '6px 2px' }}>Пусто</div>
                : items.map((t) => renderCard(t))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
