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
  const [reviews, setReviews] = useState({})
  const [view, setView] = useState('kanban')
  const [fSearch, setFSearch] = useState('')
  const [fStatus, setFStatus] = useState('all')
  const [fMaster, setFMaster] = useState('all')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase.realtime.setAuth(session.access_token)
    fetchTickets(); fetchMasters(); fetchSetting(); fetchReviews()
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

  const fetchReviews = async () => {
    const { data } = await supabase.from('reviews').select('*')
    if (data) {
      const map = {}
      data.forEach((r) => { map[r.ticket_id] = r })
      setReviews(map)
    }
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
  const returnToPool = (id) => postStatus({ id, status: 'pool' }, { status: 'pool', assigned_master_name: null })

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
            {ticket.ticket_no ? `№${ticket.ticket_no} · ` : ''}{field(ticket, 'name') || `Клиент ${ticket.client_tg_id}`}
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

        {reviews[ticket.id] && (
          <div style={{ marginBottom: '8px', padding: '8px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '13px' }}>
            <div style={{ fontWeight: 600, color: '#92400e' }}>Отзыв: {'⭐'.repeat(reviews[ticket.id].rating || 0)} ({reviews[ticket.id].rating}/5)</div>
            {reviews[ticket.id].comment && <div style={{ color: '#78350f', marginTop: '3px' }}>«{reviews[ticket.id].comment}»</div>}
          </div>
        )}

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
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {ticket.assigned_master_name && (
              <button disabled={busy} onClick={() => changeStatus(ticket.id, 'in_progress')} style={btn('#fff', '#374151', '1px solid #d1d5db')}>Вернуть в работу</button>
            )}
            <button disabled={busy} onClick={() => returnToPool(ticket.id)} style={btn('#fff', '#9a3412', '1px solid #fdba74')}>Вернуть в пул</button>
          </div>
        )}
      </div>
    )
  }

  if (!authReady) return <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>Загрузка…</div>
  if (!session) return <Login />

  const filtered = tickets.filter((t) => {
    if (fStatus !== 'all' && t.status !== fStatus) return false
    if (fMaster === 'none' && t.assigned_master_id) return false
    if (fMaster !== 'all' && fMaster !== 'none' && t.assigned_master_id !== fMaster) return false
    if (fFrom && new Date(t.created_at) < new Date(fFrom)) return false
    if (fTo) { const end = new Date(fTo); end.setHours(23, 59, 59, 999); if (new Date(t.created_at) > end) return false }
    if (fSearch.trim()) {
      const q = fSearch.trim().toLowerCase()
      const hay = [t.id, t.ticket_no, field(t, 'name'), field(t, 'phone'), field(t, 'description'), t.assigned_master_name, t.category]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const resetFilters = () => { setFSearch(''); setFStatus('all'); setFMaster('all'); setFFrom(''); setFTo('') }

  const copyId = (id) => {
    if (navigator.clipboard) navigator.clipboard.writeText(id)
    setCopiedId(id); setTimeout(() => setCopiedId(null), 1200)
  }

  const exportCsv = () => {
    const head = ['№', 'Дата', 'ID', 'Заявитель', 'Телефон', 'Адрес', 'Категория', 'Статус', 'Мастер', 'Оценка', 'Описание']
    const rows = [head]
    filtered.forEach((t) => {
      const r = reviews[t.id]
      rows.push([
        t.ticket_no || '',
        new Date(t.created_at).toLocaleString('ru-RU'),
        t.id,
        field(t, 'name') || '',
        field(t, 'phone') || '',
        field(t, 'address') || '',
        t.category || '',
        STATUS[t.status]?.label || t.status,
        t.assigned_master_name || '',
        r ? r.rating : '',
        (field(t, 'description') || '').replace(/\n/g, ' '),
      ])
    })
    const csv = rows.map((row) => row.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'zayavki.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const tabBtn = (key, label) => (
    <button onClick={() => setView(key)} style={{
      padding: '9px 16px', borderRadius: '8px', border: '1px solid ' + (view === key ? '#2563eb' : '#d1d5db'),
      background: view === key ? '#2563eb' : '#fff', color: view === key ? '#fff' : '#374151',
      fontSize: '14px', fontWeight: 600, cursor: 'pointer',
    }}>{label}</button>
  )

  const inputStyle = { padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }

  const renderAllTable = () => (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
        <input placeholder="Поиск: ID, имя, телефон, текст…" value={fSearch} onChange={(e) => setFSearch(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: '200px' }} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inputStyle}>
          <option value="all">Все статусы</option>
          {Object.keys(STATUS).map((k) => (<option key={k} value={k}>{STATUS[k].label}</option>))}
        </select>
        <select value={fMaster} onChange={(e) => setFMaster(e.target.value)} style={inputStyle}>
          <option value="all">Все мастера</option>
          <option value="none">Без мастера</option>
          {masters.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
        </select>
        <label style={{ fontSize: '12px', color: '#6b7280' }}>с <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} style={inputStyle} /></label>
        <label style={{ fontSize: '12px', color: '#6b7280' }}>по <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} style={inputStyle} /></label>
        <button onClick={resetFilters} style={{ ...inputStyle, cursor: 'pointer', background: '#fff', color: '#6b7280' }}>Сбросить</button>
        <button onClick={exportCsv} style={{ ...inputStyle, cursor: 'pointer', background: '#111827', color: '#fff', border: 'none' }}>Экспорт CSV</button>
      </div>

      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>Найдено: {filtered.length}</div>

      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '820px' }}>
          <thead>
            <tr style={{ background: '#f9fafb', textAlign: 'left', color: '#6b7280' }}>
              <th style={{ padding: '10px' }}>№</th>
              <th style={{ padding: '10px' }}>Дата</th>
              <th style={{ padding: '10px' }}>ID</th>
              <th style={{ padding: '10px' }}>Заявитель</th>
              <th style={{ padding: '10px' }}>Категория</th>
              <th style={{ padding: '10px' }}>Статус</th>
              <th style={{ padding: '10px' }}>Мастер</th>
              <th style={{ padding: '10px' }}>Оценка</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const s = STATUS[t.status] || {}
              const r = reviews[t.id]
              return (
                <tr key={t.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '10px', fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>№{t.ticket_no || '—'}</td>
                  <td style={{ padding: '10px', whiteSpace: 'nowrap', color: '#6b7280' }}>{new Date(t.created_at).toLocaleString('ru-RU')}</td>
                  <td style={{ padding: '10px' }}>
                    <button onClick={() => copyId(t.id)} title={t.id}
                      style={{ fontFamily: 'monospace', fontSize: '12px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '6px', padding: '3px 6px', cursor: 'pointer', color: '#374151' }}>
                      {copiedId === t.id ? 'скопировано ✓' : (t.id.slice(0, 8) + '…')}
                    </button>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ color: '#111827' }}>{field(t, 'name') || `Клиент ${t.client_tg_id}`}</div>
                    {field(t, 'phone') && <div style={{ color: '#6b7280', fontSize: '12px' }}>{field(t, 'phone')}</div>}
                  </td>
                  <td style={{ padding: '10px', color: '#374151' }}>{t.category || '—'}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{ backgroundColor: s.bg, color: s.color, padding: '2px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.dot} {s.label}</span>
                  </td>
                  <td style={{ padding: '10px', color: '#374151' }}>{t.assigned_master_name || '—'}</td>
                  <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{r ? '⭐'.repeat(r.rating) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>Ничего не найдено</div>}
      </div>
    </div>
  )

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', maxWidth: '1300px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#111827', margin: 0 }}>Модератор 🛠</h1>
        <button onClick={() => supabase.auth.signOut()}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', fontSize: '13px', cursor: 'pointer' }}>
          Выйти
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', margin: '16px 0 0' }}>
        {tabBtn('kanban', 'Канбан')}
        {tabBtn('all', 'Все заявки')}
      </div>

      {view === 'kanban' && (
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
      )}

      {view === 'all' && <div style={{ margin: '16px 0' }}>{renderAllTable()}</div>}

      {view === 'kanban' && (
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
      )}
    </div>
  )
}

export default App
