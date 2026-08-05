import { useMemo, useState } from 'react'
import {
  ensureYearHistory,
  totalDebtFromHistory,
  upsertYear,
} from '../lib/aidatHistory'
import { formatMoney } from '../lib/format'
import { hashTc } from '../lib/hash'
import { isValidTc, normalizeTc } from '../lib/tc'
import type { MemberRecord, MembershipData, YearAidat } from '../types'
import { ImportMembers } from './ImportMembers'

function nowIso() {
  return new Date().toISOString()
}

function currentYear() {
  return new Date().getFullYear()
}

function yearBadge(item: YearAidat | undefined, fee: number) {
  if (!item) return { label: '—', className: 'aidat-year-badge is-empty' }
  if (item.status === 'odendi') return { label: 'Ödendi', className: 'aidat-year-badge is-ok' }
  const amount = item.debtAmount || fee
  return {
    label: formatMoney(amount),
    className: 'aidat-year-badge is-debt',
  }
}

export function AidatAdmin({
  data,
  onChange,
  onPublishNow,
}: {
  data: MembershipData
  onChange: (next: MembershipData) => void
  onPublishNow: (next: MembershipData, successText: string) => Promise<'direct' | 'worker' | void>
}) {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [newName, setNewName] = useState('')
  const [newTc, setNewTc] = useState('')
  const [tcDraft, setTcDraft] = useState('')
  const [newYear, setNewYear] = useState(String(currentYear() + 1))
  const [newYearStatus, setNewYearStatus] = useState<'odendi' | 'borclu'>('odendi')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const years = useMemo(() => {
    const set = new Set<number>([currentYear(), currentYear() - 1])
    for (const m of data.members) {
      for (const y of m.yearHistory ?? []) set.add(y.year)
    }
    return [...set].sort((a, b) => b - a).slice(0, 6)
  }, [data.members])

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const qDigits = query.replace(/\D/g, '')
    return data.members
      .slice()
      .sort((a, b) => {
        const da = totalDebtFromHistory(ensureYearHistory(a, data.monthlyFee))
        const db = totalDebtFromHistory(ensureYearHistory(b, data.monthlyFee))
        return db - da || a.displayName.localeCompare(b.displayName, 'tr')
      })
      .filter((m) => {
        if (!q) return true
        if (m.displayName.toLocaleLowerCase('tr').includes(q)) return true
        if (qDigits.length >= 3 && (m.tc || '').includes(qDigits)) return true
        return false
      })
  }, [data.members, data.monthlyFee, query])

  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.idHash))
  const selectedCount = selected.size
  const debtCount = useMemo(
    () =>
      data.members.filter(
        (m) => totalDebtFromHistory(ensureYearHistory(m, data.monthlyFee)) > 0,
      ).length,
    [data.members, data.monthlyFee],
  )

  async function publishImmediate(
    next: MembershipData,
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

  function updateMember(idHash: string, patch: Partial<MemberRecord>) {
    onChange({
      ...data,
      updatedAt: nowIso(),
      members: data.members.map((m) => {
        if (m.idHash !== idHash) return m
        const merged = { ...m, ...patch }
        const yearHistory = ensureYearHistory(merged, data.monthlyFee)
        return {
          ...merged,
          yearHistory,
          debtAmount: totalDebtFromHistory(yearHistory),
        }
      }),
    })
  }

  function setMemberHistory(member: MemberRecord, history: YearAidat[]) {
    updateMember(member.idHash, {
      yearHistory: history,
      debtAmount: totalDebtFromHistory(history),
      notes: totalDebtFromHistory(history) === 0 ? 'Güncel' : member.notes === 'Güncel' ? '' : member.notes,
    })
  }

  function toggleOne(idHash: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idHash)) next.delete(idHash)
      else next.add(idHash)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(filtered.map((m) => m.idHash)))
  }

  async function removeSelected() {
    if (!selectedCount || busy) return
    if (!confirm(`${selectedCount} üye silinsin mi? Canlı listeden de kalkacak.`)) return
    const next: MembershipData = {
      ...data,
      updatedAt: nowIso(),
      members: data.members.filter((m) => !selected.has(m.idHash)),
    }
    const ok = await publishImmediate(next, `${selectedCount} üye silindi ve yayınlandı.`)
    if (!ok) return
    if (openId && selected.has(openId)) setOpenId(null)
    setSelected(new Set())
  }

  async function removeMember(idHash: string) {
    if (busy) return
    if (!confirm('Bu üyeyi listeden silmek istiyor musunuz?')) return
    const next: MembershipData = {
      ...data,
      updatedAt: nowIso(),
      members: data.members.filter((m) => m.idHash !== idHash),
    }
    const ok = await publishImmediate(next, 'Üye silindi ve yayınlandı.')
    if (!ok) return
    setSelected((prev) => {
      const n = new Set(prev)
      n.delete(idHash)
      return n
    })
    if (openId === idHash) setOpenId(null)
  }

  async function addMember() {
    if (busy) return
    const tc = normalizeTc(newTc)
    if (!isValidTc(tc)) {
      setErr('T.C. kimlik no 11 haneli olmalı ve 0 ile başlamamalı.')
      setMsg(null)
      return
    }
    if (!newName.trim()) {
      setErr('Üye adı soyadı gerekli.')
      setMsg(null)
      return
    }
    const idHash = await hashTc(tc)
    if (data.members.some((m) => m.idHash === idHash)) {
      setErr('Bu T.C. kimlik no zaten kayıtlı.')
      setMsg(null)
      return
    }

    const year = currentYear()
    const displayName = newName.trim().replace(/\s+/g, ' ')
    const next: MembershipData = {
      ...data,
      updatedAt: nowIso(),
      members: [
        ...data.members,
        {
          idHash,
          tc,
          displayName,
          debtAmount: 0,
          debtMonths: [],
          lastPayment: null,
          notes: '',
          yearHistory: [
            { year, status: 'odendi', debtAmount: 0, note: '' },
            { year: year - 1, status: 'odendi', debtAmount: 0, note: '' },
          ],
        },
      ],
    }
    const ok = await publishImmediate(next, `${displayName} eklendi ve yayınlandı.`)
    if (!ok) return
    setNewName('')
    setNewTc('')
    setOpenId(idHash)
    setErr(null)
  }

  function markYearPaid(member: MemberRecord, year: number) {
    const history = ensureYearHistory(member, data.monthlyFee)
    setMemberHistory(member, upsertYear(history, year, { status: 'odendi', debtAmount: 0 }))
  }

  function markYearDebt(member: MemberRecord, year: number) {
    const history = ensureYearHistory(member, data.monthlyFee)
    setMemberHistory(
      member,
      upsertYear(history, year, { status: 'borclu', debtAmount: data.monthlyFee }),
    )
  }

  function addYearRow(member: MemberRecord) {
    const year = Number(newYear)
    if (!year || year < 2000 || year > 2100) {
      setErr('Geçerli bir yıl girin (ör. 2027).')
      setMsg(null)
      return
    }
    const history = ensureYearHistory(member, data.monthlyFee)
    if (history.some((y) => y.year === year)) {
      setErr(`${year} yılı zaten listede.`)
      setMsg(null)
      return
    }
    setMemberHistory(
      member,
      upsertYear(history, year, {
        status: newYearStatus,
        debtAmount: newYearStatus === 'odendi' ? 0 : data.monthlyFee,
        note: newYearStatus === 'odendi' ? 'Peşin ödendi' : '',
      }),
    )
    setMsg(`${member.displayName} için ${year} eklendi (${newYearStatus === 'odendi' ? 'ödendi' : 'borçlu'}).`)
    setErr(null)
    setNewYear(String(year + 1))
  }

  function openMember(member: MemberRecord) {
    if (openId === member.idHash) {
      setOpenId(null)
      setTcDraft('')
      return
    }
    setOpenId(member.idHash)
    setTcDraft(member.tc || '')
    setMsg(null)
    setErr(null)
  }

  async function saveMemberTc(member: MemberRecord) {
    if (busy) return
    const tc = normalizeTc(tcDraft)
    if (!isValidTc(tc)) {
      setErr('T.C. kimlik no 11 haneli olmalı ve 0 ile başlamamalı.')
      setMsg(null)
      return
    }

    const idHash = await hashTc(tc)
    const clash = data.members.find((m) => m.idHash !== member.idHash && (m.idHash === idHash || m.tc === tc))
    if (clash) {
      setErr(`Bu T.C. başka üyede kayıtlı: ${clash.displayName}`)
      setMsg(null)
      return
    }

    let notes = member.notes
    if (notes.includes('TC girilmedi')) notes = ''
    notes = notes.replace(/TC kontrol:[^\n]*/g, '').trim()

    const nextMembers = data.members.map((m) => {
      if (m.idHash !== member.idHash) return m
      return {
        ...m,
        idHash,
        tc,
        notes,
      }
    })
    const next: MembershipData = {
      ...data,
      updatedAt: nowIso(),
      members: nextMembers,
    }
    const ok = await publishImmediate(
      next,
      member.tc ? 'T.C. güncellendi ve yayınlandı.' : 'T.C. eklendi ve yayınlandı.',
    )
    if (!ok) return
    setOpenId(idHash)
    setTcDraft(tc)
    setSelected((prev) => {
      if (!prev.has(member.idHash)) return prev
      const n = new Set(prev)
      n.delete(member.idHash)
      n.add(idHash)
      return n
    })
  }

  return (
    <div className="admin-panel aidat-admin">
      <div className="aidat-admin-head">
        <div>
          <h2>Aidat</h2>
          <p className="hint">
            {data.members.length} üye · {debtCount} borçlu · yıllık {formatMoney(data.monthlyFee)}
          </p>
        </div>
        <label className="admin-label aidat-fee-field">
          Yıllık aidat (₺)
          <input
            type="number"
            min={0}
            value={data.monthlyFee}
            onChange={(e) =>
              onChange({
                ...data,
                monthlyFee: Number(e.target.value) || 0,
                updatedAt: nowIso(),
              })
            }
          />
        </label>
      </div>

      {err && <p className="admin-msg err">{err}</p>}
      {msg && <p className="admin-msg ok">{msg}</p>}

      <div className="aidat-add-card">
        <strong>Yeni üye</strong>
        <div className="admin-fields two">
          <label className="admin-label">
            Ad soyad
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ad Soyad"
            />
          </label>
          <label className="admin-label">
            T.C. kimlik no
            <input
              inputMode="numeric"
              maxLength={11}
              value={newTc}
              onChange={(e) => setNewTc(normalizeTc(e.target.value))}
              placeholder="11 haneli"
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void addMember()}
        >
          Ekle ve yayınla
        </button>
      </div>

      <div className="aidat-toolbar">
        <label className="admin-label aidat-search">
          Ara
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ad soyad veya TC…"
          />
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={busy || !filtered.length}
          />
          Tümü ({filtered.length})
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!selectedCount || busy}
          onClick={() => void removeSelected()}
        >
          Sil ({selectedCount})
        </button>
      </div>

      <div className="aidat-table" role="table" aria-label="Üye aidat listesi">
        <div className="aidat-table-head" role="row">
          <span className="aidat-col-check" />
          <span className="aidat-col-name">Üye</span>
          {years.map((y) => (
            <span key={y} className="aidat-col-year">
              {y}
            </span>
          ))}
          <span className="aidat-col-debt">Borç</span>
        </div>

        {filtered.map((member) => {
          const history = ensureYearHistory(member, data.monthlyFee)
          const debt = totalDebtFromHistory(history)
          const open = openId === member.idHash
          const checked = selected.has(member.idHash)

          return (
            <article
              key={member.idHash}
              className={`aidat-row ${open ? 'is-open' : ''} ${checked ? 'is-selected' : ''}`}
            >
              <div className="aidat-row-main">
                <label className="aidat-col-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(member.idHash)}
                    aria-label={`${member.displayName} seç`}
                  />
                </label>
                <button
                  type="button"
                  className="aidat-row-open"
                  onClick={() => openMember(member)}
                >
                  <span className="aidat-col-name">
                    <strong>{member.displayName}</strong>
                    {member.tc ? (
                      <span className="aidat-tc">{member.tc}</span>
                    ) : (
                      <em className="aidat-tag">TC ekle</em>
                    )}
                  </span>
                  {years.map((y) => {
                    const item = history.find((h) => h.year === y)
                    const badge = yearBadge(item, data.monthlyFee)
                    return (
                      <span key={y} className={`aidat-col-year ${badge.className}`}>
                        {badge.label}
                      </span>
                    )
                  })}
                  <span className={`aidat-col-debt ${debt > 0 ? 'is-debt' : 'is-ok'}`}>
                    {debt > 0 ? formatMoney(debt) : 'Güncel'}
                  </span>
                </button>
              </div>

              {open && (
                <div className="aidat-row-edit">
                  <div className={`aidat-tc-box ${member.tc ? '' : 'is-missing'}`}>
                    <label className="admin-label">
                      T.C. kimlik no
                      <input
                        inputMode="numeric"
                        maxLength={11}
                        value={tcDraft}
                        onChange={(e) => setTcDraft(normalizeTc(e.target.value))}
                        placeholder={member.tc ? member.tc : '11 haneli TC girin'}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || tcDraft === (member.tc || '')}
                      onClick={() => void saveMemberTc(member)}
                    >
                      {member.tc ? 'T.C. güncelle' : 'T.C. kaydet'}
                    </button>
                  </div>

                  <div className="aidat-year-grid">
                    {history.map((item) => (
                      <div key={item.year} className="aidat-year-card">
                        <div className="aidat-year-card-top">
                          <strong>{item.year}</strong>
                          <span className={item.status === 'odendi' ? 'badge-ok' : 'badge-debt'}>
                            {item.status === 'odendi' ? 'Ödendi' : 'Borçlu'}
                          </span>
                        </div>
                        <label className="admin-label">
                          Borç (₺)
                          <input
                            type="number"
                            min={0}
                            value={item.status === 'odendi' ? 0 : item.debtAmount}
                            disabled={item.status === 'odendi'}
                            onChange={(e) => {
                              const debtAmount = Number(e.target.value) || 0
                              setMemberHistory(
                                member,
                                upsertYear(history, item.year, {
                                  status: debtAmount > 0 ? 'borclu' : 'odendi',
                                  debtAmount,
                                }),
                              )
                            }}
                          />
                        </label>
                        <div className="admin-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => markYearPaid(member, item.year)}
                          >
                            Ödendi
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => markYearDebt(member, item.year)}
                          >
                            Borçlu yap
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="aidat-add-year">
                    <strong>Yıl ekle</strong>
                    <p className="hint">Peşin ödeme için gelecek yılı ekleyip ödendi işaretleyin.</p>
                    <div className="admin-fields two">
                      <label className="admin-label">
                        Yıl
                        <input
                          type="number"
                          min={2000}
                          max={2100}
                          value={newYear}
                          onChange={(e) => setNewYear(e.target.value)}
                          placeholder="2027"
                        />
                      </label>
                      <label className="admin-label">
                        Durum
                        <select
                          value={newYearStatus}
                          onChange={(e) =>
                            setNewYearStatus(e.target.value as 'odendi' | 'borclu')
                          }
                        >
                          <option value="odendi">Ödendi</option>
                          <option value="borclu">Borçlu</option>
                        </select>
                      </label>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => addYearRow(member)}
                    >
                      Yılı ekle
                    </button>
                  </div>

                  <label className="admin-label">
                    Not
                    <input
                      value={member.notes}
                      onChange={(e) => updateMember(member.idHash, { notes: e.target.value })}
                      placeholder="İsteğe bağlı not"
                    />
                  </label>

                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void removeMember(member.idHash)}
                    >
                      Üyeyi sil
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setOpenId(null)}
                    >
                      Kapat
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <details className="aidat-import" open={showImport} onToggle={(e) => setShowImport((e.target as HTMLDetailsElement).open)}>
        <summary>Excel / CSV ile toplu aktarım</summary>
        <ImportMembers data={data} onChange={onChange} />
      </details>
    </div>
  )
}
