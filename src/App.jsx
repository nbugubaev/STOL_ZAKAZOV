import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseAnonKey)

function App() {
  const [tickets, setTickets] = useState([])

  useEffect(() => {
    fetchTickets()

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, (payload) => {
        setTickets((current) => [payload.new, ...current])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const fetchTickets = async () => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) setTickets(data)
    if (error) console.error('Ошибка загрузки:', error)
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ color: '#111827' }}>Канбан Модератора 🛠</h1>
      <p style={{ color: '#6b7280', marginBottom: '20px' }}>Новые заявки появляются здесь автоматически.</p>

      <div style={{ display: 'grid', gap: '15px' }}>
        {tickets.map(ticket => (
          <div key={ticket.id} style={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            padding: '15px',
            borderRadius: '8px',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontWeight: 'bold', color: '#374151' }}>ID Клиента: {ticket.client_tg_id}</span>
              <span style={{
                backgroundColor: ticket.status === 'new' ? '#fef3c7' : '#d1fae5',
                color: ticket.status === 'new' ? '#92400e' : '#065f46',
                padding: '4px 8px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: '600'
              }}>
                {ticket.status.toUpperCase()}
              </span>
            </div>
            <p style={{ color: '#4b5563', margin: '0 0 10px 0' }}>
              {ticket.metadata?.description || 'Нет описания'}
            </p>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              Создано: {new Date(ticket.created_at).toLocaleString('ru-RU')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
