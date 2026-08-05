import { useEffect, useState, type FormEvent } from 'react'
import { YearHistory } from '../components/YearHistory'
import { ensureYearHistory, totalDebtFromHistory } from '../lib/aidatHistory'
import { formatDate, formatMoney, formatMonthKey } from '../lib/format'
import { hashTc } from '../lib/hash'
import { DATA_UPDATED_EVENT, loadMembershipData } from '../lib/liveData'
import { maskDisplayName } from '../lib/maskName'
import { isValidTc, normalizeTc } from '../lib/tc'
import type { MembershipData, MemberRecord } from '../types'

type ViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'found'; member: MemberRecord; data: MembershipData }

export function AidatPage() {
  const [tc, setTc] = useState('')
  const [data, setData] = useState<MembershipData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<ViewState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const json = await loadMembershipData()
        if (!cancelled) {
          setData(json)
          setLoadError(null)
        }
      } catch {
        if (!cancelled) {
          setLoadError('Aidat verisi şu anda yüklenemiyor. Lütfen daha sonra tekrar deneyin.')
        }
      }
    }
    function onUpdate() {
      void load()
    }
    void load()
    window.addEventListener(DATA_UPDATED_EVENT, onUpdate)
    return () => {
      cancelled = true
      window.removeEventListener(DATA_UPDATED_EVENT, onUpdate)
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeTc(tc)

    if (!isValidTc(normalized)) {
      setView({
        status: 'error',
        message: 'T.C. kimlik numarası 11 haneli olmalı.',
      })
      return
    }

    setView({ status: 'loading' })

    try {
      const latest = await loadMembershipData()
      setData(latest)

      const idHash = await hashTc(normalized)
      const member = latest.members.find((m) => m.idHash === idHash)

      if (!member) {
        setView({ status: 'not_found' })
        return
      }

      setView({ status: 'found', member, data: latest })
    } catch {
      setView({
        status: 'error',
        message: loadError ?? 'Veriler henüz yüklenmedi. Lütfen kısa süre sonra tekrar deneyin.',
      })
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Aidat sorgulama</h1>
        <p>T.C. kimlik numaranız ile borç ve geçmiş yıl aidat durumunuzu görün.</p>
      </header>

      <div className="panel">
        <form onSubmit={onSubmit}>
          <label className="label">
            <span>T.C. Kimlik Numarası</span>
            <input
              className="field"
              inputMode="numeric"
              autoComplete="off"
              name="tc"
              maxLength={11}
              placeholder="xxxxxxxxxxx"
              value={tc}
              onChange={(e) => {
                setTc(normalizeTc(e.target.value))
                if (view.status !== 'idle' && view.status !== 'loading') {
                  setView({ status: 'idle' })
                }
              }}
            />
          </label>
          <p className="hint">Numaranız sunucuya gönderilmez; yalnızca bu cihazda kontrol edilir.</p>
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={view.status === 'loading'}>
              {view.status === 'loading' ? 'Sorgulanıyor…' : 'Borç Sorgula'}
            </button>
            {view.status !== 'idle' && view.status !== 'loading' && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setTc('')
                  setView({ status: 'idle' })
                }}
              >
                Temizle
              </button>
            )}
          </div>
        </form>

        {view.status === 'error' && <p className="error">{view.message}</p>}
        {view.status === 'not_found' && (
          <p className="error">
            Bu T.C. kimlik numarasına ait üye kaydı bulunamadı. Dernek yönetimi ile iletişime
            geçiniz.
          </p>
        )}
        {view.status === 'found' && <ResultCard member={view.member} data={view.data} />}
      </div>

      <p className="footer">
        {data ? (
          <>
            Son güncelleme: <strong>{formatDate(data.updatedAt)}</strong>
            {' · '}
            Yıllık aidat: <strong>{formatMoney(data.monthlyFee)}</strong>
          </>
        ) : loadError ? (
          loadError
        ) : (
          'Veriler yükleniyor…'
        )}
      </p>
    </section>
  )
}

function ResultCard({ member, data }: { member: MemberRecord; data: MembershipData }) {
  const history = ensureYearHistory(member, data.monthlyFee)
  const totalDebt = totalDebtFromHistory(history)
  const hasDebt = totalDebt > 0

  return (
    <div className="result">
      <div className="result-head">
        <h2>{maskDisplayName(member.displayName)}</h2>
        <span className={`badge ${hasDebt ? 'badge-debt' : 'badge-ok'}`}>
          {hasDebt ? 'Borçlu' : 'Güncel'}
        </span>
      </div>
      <div className="amount">
        <span>Toplam açık borç</span>
        <strong>{formatMoney(totalDebt)}</strong>
      </div>
      <dl className="meta">
        <div>
          <dt>Yıllık aidat</dt>
          <dd>{formatMoney(data.monthlyFee)}</dd>
        </div>
        <div>
          <dt>Son ödeme</dt>
          <dd>{formatDate(member.lastPayment)}</dd>
        </div>
      </dl>

      <YearHistory member={member} monthlyFee={data.monthlyFee} />

      {member.debtMonths.length > 0 && (
        <div className="months">
          <h3>Açık borçlu aylar</h3>
          <ul className="month-list">
            {member.debtMonths.map((month) => (
              <li key={month}>{formatMonthKey(month)}</li>
            ))}
          </ul>
        </div>
      )}
      {member.notes ? <p className="note">{member.notes}</p> : null}
    </div>
  )
}
