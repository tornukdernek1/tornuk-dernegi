import { useMemo, useState } from 'react'
import { formatNotifyResultMessage, publishNotifyToNtfy } from '../lib/ntfyPush'
import type { EventItem, EventsData } from '../types'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function makeId(title: string) {
  const slug = title
    .toLocaleLowerCase('tr')
    .replace(/[^a-z0-9ğüşıöç\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
  return `etk-${todayIso()}-${Date.now().toString(36)}-${slug || 'yeni'}`
}

export function EtkinliklerAdmin({
  data,
  onChange,
  onPublishNow,
}: {
  data: EventsData
  onChange: (next: EventsData) => void
  onPublishNow: (next: EventsData, successText: string) => Promise<'direct' | 'worker' | void>
}) {
  const [draft, setDraft] = useState({
    title: '',
    date: todayIso(),
    time: '14:00',
    place: 'Dernek Lokali',
    description: '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = useState<string | null>(null)

  const sorted = useMemo(
    () => data.items.slice().sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
    [data.items],
  )

  const allSelected = sorted.length > 0 && selected.size === sorted.length
  const selectedCount = selected.size

  const selectedItems = useMemo(
    () => sorted.filter((item) => selected.has(item.id)),
    [sorted, selected],
  )

  async function publishImmediate(
    next: EventsData,
    successText: string,
  ): Promise<'direct' | 'worker' | false> {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const via = (await onPublishNow(next, successText)) || 'direct'
      setMsg(successText)
      return via
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Yayın başarısız.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function updateItem(id: string, patch: Partial<EventItem>) {
    onChange({
      ...data,
      updatedAt: new Date().toISOString(),
      items: data.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(sorted.map((item) => item.id)))
  }

  async function addItem() {
    if (!draft.title.trim() || !draft.date) return
    const item: EventItem = {
      id: makeId(draft.title),
      title: draft.title.trim(),
      date: draft.date,
      time: draft.time || '14:00',
      place: draft.place.trim() || 'Belirlenecek',
      description: draft.description.trim(),
    }
    const next: EventsData = {
      updatedAt: new Date().toISOString(),
      items: [item, ...data.items],
    }
    const via = await publishImmediate(next, 'Etkinlik eklendi ve canlıya yayınlandı.')
    if (!via) return

    setDraft({
      title: '',
      date: todayIso(),
      time: '14:00',
      place: 'Dernek Lokali',
      description: '',
    })
    setOpenId(item.id)

    const summary = [item.date, item.time, item.place].filter(Boolean).join(' · ')
    try {
      const notify = await publishNotifyToNtfy({
        kind: 'etkinlik',
        id: item.id,
        title: item.title,
        summary: item.description.trim() || summary,
      })
      setMsg(formatNotifyResultMessage('Etkinlik yayınlandı.', notify))
    } catch {
      setMsg(
        'Etkinlik yayınlandı. Anlık kanal bu ağda kapalı; üyeler uygulama açıksa kısa sürede bildirilir.',
      )
    }
  }

  async function removeItem(id: string) {
    if (!confirm('Bu etkinlik silinsin mi? Canlı siteden de kalkacak.')) return
    const next: EventsData = {
      updatedAt: new Date().toISOString(),
      items: data.items.filter((x) => x.id !== id),
    }
    const ok = await publishImmediate(next, 'Etkinlik silindi ve yayınlandı.')
    if (!ok) return
    setSelected((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
    if (openId === id) setOpenId(null)
  }

  async function removeSelected() {
    if (!selectedCount) return
    if (!confirm(`${selectedCount} etkinlik silinsin mi? Canlı siteden de kalkacak.`)) return
    const next: EventsData = {
      updatedAt: new Date().toISOString(),
      items: data.items.filter((x) => !selected.has(x.id)),
    }
    const ok = await publishImmediate(
      next,
      `${selectedCount} etkinlik silindi ve yayınlandı.`,
    )
    if (!ok) return
    if (openId && selected.has(openId)) setOpenId(null)
    setSelected(new Set())
  }

  async function publishSelectedEdits() {
    if (!selectedCount) return
    const next: EventsData = {
      ...data,
      updatedAt: new Date().toISOString(),
    }
    const ok = await publishImmediate(
      next,
      `${selectedCount} etkinlik güncellendi ve yayınlandı.`,
    )
    if (ok) setSelected(new Set())
  }

  return (
    <div className="admin-panel">
      <h2>Etkinlikler</h2>
      <p className="hint">
        Yeni etkinlik ekleyin veya listeden seçip toplu silin / güncelleyin. Değişiklikler canlıya
        yayınlanır.
      </p>

      <div className="admin-fields">
        <label className="admin-label">
          Başlık
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </label>
        <div className="admin-fields two">
          <label className="admin-label">
            Tarih
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            />
          </label>
          <label className="admin-label">
            Saat
            <input
              type="time"
              value={draft.time}
              onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
            />
          </label>
        </div>
        <label className="admin-label">
          Yer
          <input
            value={draft.place}
            onChange={(e) => setDraft((d) => ({ ...d, place: e.target.value }))}
          />
        </label>
        <label className="admin-label">
          Açıklama
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !draft.title.trim() || !draft.date}
          onClick={() => void addItem()}
        >
          {busy ? 'Yayınlanıyor…' : 'Etkinlik ekle'}
        </button>
        {msg && <p className="admin-msg ok">{msg}</p>}
        {err && <p className="admin-msg err">{err}</p>}
      </div>

      <div className="admin-bulk-bar">
        <label className="admin-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={busy || !sorted.length}
          />
          Tümünü seç ({sorted.length})
        </label>
        <div className="admin-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !selectedCount}
            onClick={() => setSelected(new Set())}
          >
            Seçimi temizle
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !selectedCount}
            onClick={() => void publishSelectedEdits()}
          >
            Seçilenleri yayınla ({selectedCount})
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !selectedCount}
            onClick={() => void removeSelected()}
          >
            {busy ? 'Siliniyor…' : `Seçilenleri sil (${selectedCount})`}
          </button>
        </div>
      </div>

      {selectedCount > 0 && (
        <p className="hint">
          Seçili:{' '}
          {selectedItems
            .slice(0, 3)
            .map((i) => i.title)
            .join(', ')}
          {selectedCount > 3 ? ` +${selectedCount - 3}` : ''}
        </p>
      )}

      <div className="admin-list">
        {sorted.map((item) => {
          const open = openId === item.id
          const checked = selected.has(item.id)
          return (
            <article
              key={item.id}
              className={`admin-list-row ${open ? 'is-open' : ''} ${checked ? 'is-selected' : ''}`}
            >
              <div className="admin-list-main">
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggleOne(item.id)}
                  />
                </label>
                <button
                  type="button"
                  className="admin-list-title"
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  <strong>{item.title || '(başlıksız)'}</strong>
                  <span className="hint">
                    {item.date} · {item.time} · {item.place}
                  </span>
                </button>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setOpenId(open ? null : item.id)}
                  >
                    {open ? 'Kapat' : 'Düzenle'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void removeItem(item.id)}
                  >
                    Sil
                  </button>
                </div>
              </div>

              {open && (
                <div className="admin-fields admin-list-edit">
                  <label className="admin-label">
                    Başlık
                    <input
                      value={item.title}
                      onChange={(e) => updateItem(item.id, { title: e.target.value })}
                    />
                  </label>
                  <div className="admin-fields two">
                    <label className="admin-label">
                      Tarih
                      <input
                        type="date"
                        value={item.date}
                        onChange={(e) => updateItem(item.id, { date: e.target.value })}
                      />
                    </label>
                    <label className="admin-label">
                      Saat
                      <input
                        type="time"
                        value={item.time}
                        onChange={(e) => updateItem(item.id, { time: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="admin-label">
                    Yer
                    <input
                      value={item.place}
                      onChange={(e) => updateItem(item.id, { place: e.target.value })}
                    />
                  </label>
                  <label className="admin-label">
                    Açıklama
                    <textarea
                      value={item.description}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void publishImmediate(
                        { ...data, updatedAt: new Date().toISOString() },
                        'Etkinlik güncellendi ve yayınlandı.',
                      )
                    }
                  >
                    Bu etkinliği yayınla
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
