import { useMemo, useState } from 'react'
import { formatNotifyResultMessage, publishNotifyToNtfy } from '../lib/ntfyPush'
import type { Announcement, AnnouncementsData } from '../types'

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
  return `duyuru-${todayIso()}-${Date.now().toString(36)}-${slug || 'yeni'}`
}

export function DuyurularAdmin({
  data,
  onChange,
  onPublishNow,
}: {
  data: AnnouncementsData
  onChange: (next: AnnouncementsData) => void
  onPublishNow: (
    next: AnnouncementsData,
    successText: string,
  ) => Promise<'direct' | 'worker' | void>
}) {
  const [draft, setDraft] = useState({
    title: '',
    summary: '',
    body: '',
    date: todayIso(),
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = useState<string | null>(null)

  const allSelected = data.items.length > 0 && selected.size === data.items.length
  const selectedCount = selected.size

  const selectedItems = useMemo(
    () => data.items.filter((item) => selected.has(item.id)),
    [data.items, selected],
  )

  async function publishImmediate(
    next: AnnouncementsData,
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

  function updateItem(id: string, patch: Partial<Announcement>) {
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
    setSelected(new Set(data.items.map((item) => item.id)))
  }

  async function addItem() {
    if (!draft.title.trim() || !draft.summary.trim()) return
    const item: Announcement = {
      id: makeId(draft.title),
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      body: draft.body.trim() || draft.summary.trim(),
      date: draft.date || todayIso(),
    }
    const next: AnnouncementsData = {
      updatedAt: new Date().toISOString(),
      items: [item, ...data.items],
    }
    const via = await publishImmediate(next, 'Duyuru eklendi ve canlıya yayınlandı.')
    if (!via) return

    setDraft({ title: '', summary: '', body: '', date: todayIso() })
    setOpenId(item.id)

    try {
      const notify = await publishNotifyToNtfy({
        kind: 'duyuru',
        id: item.id,
        title: item.title,
        summary: item.summary,
      })
      setMsg(formatNotifyResultMessage('Duyuru yayınlandı.', notify))
    } catch {
      setMsg(
        'Duyuru yayınlandı. Anlık kanal bu ağda kapalı; üyeler uygulama açıksa kısa sürede bildirilir.',
      )
    }
  }

  async function removeItem(id: string) {
    if (!confirm('Bu duyuru silinsin mi? Canlı siteden de kalkacak.')) return
    const next: AnnouncementsData = {
      updatedAt: new Date().toISOString(),
      items: data.items.filter((x) => x.id !== id),
    }
    const ok = await publishImmediate(next, 'Duyuru silindi ve yayınlandı.')
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
    if (
      !confirm(
        `${selectedCount} duyuru silinsin mi? Canlı siteden de kalkacak.`,
      )
    ) {
      return
    }
    const next: AnnouncementsData = {
      updatedAt: new Date().toISOString(),
      items: data.items.filter((x) => !selected.has(x.id)),
    }
    const ok = await publishImmediate(
      next,
      `${selectedCount} duyuru silindi ve yayınlandı.`,
    )
    if (!ok) return
    if (openId && selected.has(openId)) setOpenId(null)
    setSelected(new Set())
  }

  async function publishSelectedEdits() {
    if (!selectedCount) return
    const next: AnnouncementsData = {
      ...data,
      updatedAt: new Date().toISOString(),
    }
    const ok = await publishImmediate(
      next,
      `${selectedCount} duyuru güncellendi ve yayınlandı.`,
    )
    if (ok) setSelected(new Set())
  }

  async function moveTop(id: string) {
    const item = data.items.find((x) => x.id === id)
    if (!item) return
    const next: AnnouncementsData = {
      updatedAt: new Date().toISOString(),
      items: [item, ...data.items.filter((x) => x.id !== id)],
    }
    await publishImmediate(next, 'Sıra güncellendi ve yayınlandı.')
  }

  return (
    <div className="admin-panel">
      <h2>Duyurular</h2>
      <p className="hint">
        Yeni duyuru ekleyin veya listeden seçip toplu silin / güncelleyin. Değişiklikler canlıya
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
        <label className="admin-label">
          Kısa özet
          <input
            value={draft.summary}
            onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
          />
        </label>
        <label className="admin-label">
          Detay
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
        </label>
        <label className="admin-label">
          Tarih
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !draft.title.trim() || !draft.summary.trim()}
          onClick={() => void addItem()}
        >
          {busy ? 'Yayınlanıyor…' : 'Duyuru ekle'}
        </button>
        {msg && <p className="admin-msg ok">{msg}</p>}
        {err && <p className="admin-msg err">{err}</p>}
      </div>

      <div className="admin-bulk-bar">
        <label className="admin-check">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={busy || !data.items.length} />
          Tümünü seç ({data.items.length})
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
          Seçili: {selectedItems
            .slice(0, 3)
            .map((i) => i.title)
            .join(', ')}
          {selectedCount > 3 ? ` +${selectedCount - 3}` : ''}
        </p>
      )}

      <div className="admin-list">
        {data.items.map((item, index) => {
          const open = openId === item.id
          const checked = selected.has(item.id)
          return (
            <article key={item.id} className={`admin-list-row ${open ? 'is-open' : ''} ${checked ? 'is-selected' : ''}`}>
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
                  <strong>
                    {index === 0 ? 'En yeni · ' : ''}
                    {item.title || '(başlıksız)'}
                  </strong>
                  <span className="hint">{item.date}</span>
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
                  {index > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void moveTop(item.id)}
                    >
                      Üste
                    </button>
                  )}
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
                  <label className="admin-label">
                    Özet
                    <input
                      value={item.summary}
                      onChange={(e) => updateItem(item.id, { summary: e.target.value })}
                    />
                  </label>
                  <label className="admin-label">
                    Detay
                    <textarea
                      value={item.body}
                      onChange={(e) => updateItem(item.id, { body: e.target.value })}
                    />
                  </label>
                  <label className="admin-label">
                    Tarih
                    <input
                      type="date"
                      value={item.date}
                      onChange={(e) => updateItem(item.id, { date: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void publishImmediate(
                        { ...data, updatedAt: new Date().toISOString() },
                        'Duyuru güncellendi ve yayınlandı.',
                      )
                    }
                  >
                    Bu duyuruyu yayınla
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
