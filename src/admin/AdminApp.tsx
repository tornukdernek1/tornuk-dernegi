import { useCallback, useEffect, useRef, useState } from 'react'
import { isAdminLoggedIn, setAdminLoggedIn, getAdminSessionPin } from '../lib/adminAuth'
import { pushAdminData } from '../lib/githubSave'
import {
  clearLiveData,
  LIVE_DATA_BASE,
  setLiveAnnouncements,
  setLiveEvents,
  setLiveMembers,
} from '../lib/liveData'
import { GITHUB_CONTENTS_DATA } from '../lib/siteConfig'
import type { AnnouncementsData, AssociationData, EventsData, MembershipData } from '../types'
import './admin.css'
import { AdminLogin } from './AdminLogin'
import { AidatAdmin } from './AidatAdmin'
import { DernekAdmin } from './DernekAdmin'
import { DuyurularAdmin } from './DuyurularAdmin'
import { EtkinliklerAdmin } from './EtkinliklerAdmin'
import { SavePanel } from './SavePanel'
import { InstallStats } from './InstallStats'

type AdminTab =
  | 'aidat'
  | 'duyurular'
  | 'etkinlikler'
  | 'site'
  | 'indirenler'
  | 'ayarlar'

type Store = {
  members: MembershipData | null
  announcements: AnnouncementsData | null
  events: EventsData | null
  association: AssociationData | null
}

export function AdminApp() {
  const [authed, setAuthed] = useState(() => isAdminLoggedIn())
  const [tab, setTab] = useState<AdminTab>('duyurular')
  const [members, setMembers] = useState<MembershipData | null>(null)
  const [announcements, setAnnouncements] = useState<AnnouncementsData | null>(null)
  const [events, setEvents] = useState<EventsData | null>(null)
  const [association, setAssociation] = useState<AssociationData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [publishNote, setPublishNote] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const dataRef = useRef<Store>({
    members: null,
    announcements: null,
    events: null,
    association: null,
  })
  /** Son başarılı yayın — boş liste ile üzerine yazmayı engeller. */
  const lastGoodRef = useRef<{
    membersCount: number
    announcementsCount: number
    eventsCount: number
  }>({ membersCount: 0, announcementsCount: 0, eventsCount: 0 })
  const publishTimer = useRef<number | null>(null)
  /** Bekleyen otomatik yayın yolları. null + timer = tüm dosyalar. */
  const pendingPathsRef = useRef<string[] | null>(null)
  const pendingAllRef = useRef(false)
  const pendingSuccessRef = useRef<string | undefined>(undefined)
  /** Yayın sırasında React state henüz güncellenmemişken dataRef’i ezme. */
  const publishingLock = useRef(false)

  if (!publishingLock.current) {
    dataRef.current = { members, announcements, events, association }
  }

  useEffect(() => {
    if (!authed) return
    let cancelled = false

    async function load() {
      try {
        setLoadError(null)
        setDraftNote(null)

        // Admin = canlı kaynak: GitHub Contents API (CDN gecikmesi yok), raw yedek
        const bust = `t=${Date.now()}`
        async function loadFile<T>(file: string): Promise<T> {
          try {
            const res = await fetch(
              `${GITHUB_CONTENTS_DATA}/${file}?ref=gh-pages&t=${Date.now()}`,
              {
                cache: 'no-store',
                mode: 'cors',
                headers: { Accept: 'application/vnd.github+json' },
              },
            )
            if (!res.ok) throw new Error('api fail')
            const payload = (await res.json()) as { content?: string }
            if (!payload.content) throw new Error('api empty')
            const clean = payload.content.replace(/\s+/g, '')
            const binary = atob(clean)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            return JSON.parse(new TextDecoder().decode(bytes)) as T
          } catch {
            try {
              const res = await fetch(`${LIVE_DATA_BASE}/${file}?${bust}`, {
                cache: 'no-store',
                mode: 'cors',
              })
              if (!res.ok) throw new Error('raw fail')
              return (await res.json()) as T
            } catch {
              const res = await fetch(`${import.meta.env.BASE_URL}data/${file}?${bust}`, {
                cache: 'no-store',
              })
              if (!res.ok) throw new Error(`${file} yüklenemedi`)
              return (await res.json()) as T
            }
          }
        }

        const [m, d, e, a] = await Promise.all([
          loadFile<MembershipData>('uyeler.json'),
          loadFile<AnnouncementsData>('duyurular.json'),
          loadFile<EventsData>('etkinlikler.json'),
          loadFile<AssociationData>('dernek.json'),
        ])
        if (cancelled) return

        // Sunucu esas: eski yerel taslak “sildim ama sitede duruyor” yanılsaması yaratıyordu
        setMembers(m)
        setAnnouncements(d)
        setEvents(e)
        setAssociation(a)
        dataRef.current = { members: m, announcements: d, events: e, association: a }
        setLiveMembers(m)
        setLiveAnnouncements(d)
        setLiveEvents(e)
        lastGoodRef.current = {
          membersCount: m.members.length,
          announcementsCount: d.items.length,
          eventsCount: e.items.length,
        }
        setDirty(false)
      } catch {
        if (!cancelled) setLoadError('Yönetim verileri yüklenemedi.')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [authed, reloadToken])

  const publishNow = useCallback(async (successText?: string, onlyPaths?: string[]) => {
    const pin = getAdminSessionPin()
    if (!pin) {
      throw new Error('Oturum süresi dolmuş. Yönetim paneline tekrar giriş yapın.')
    }
    setPublishing(true)
    setPublishNote(null)
    publishingLock.current = true

    try {
      const via = await pushAdminData(pin, () => {
        const snap = dataRef.current
        if (!snap.members || !snap.announcements || !snap.events || !snap.association) {
          throw new Error('Veriler henüz yüklenmedi.')
        }

        const good = lastGoodRef.current
        // Üye listesini boş yayınlama (duyuru/etkinlik bilinçli silinebilir)
        if (snap.members.members.length === 0 && good.membersCount > 0) {
          throw new Error(
            'Boş üye listesi canlıyı silmez. Ayarlar → sunucudan yükle ile yenileyin.',
          )
        }

        const all = [
          { path: 'public/data/uyeler.json', data: snap.members as unknown },
          { path: 'public/data/duyurular.json', data: snap.announcements as unknown },
          { path: 'public/data/etkinlikler.json', data: snap.events as unknown },
          { path: 'public/data/dernek.json', data: snap.association as unknown },
        ]
        if (!onlyPaths?.length) return all
        const filtered = all.filter((f) => onlyPaths.includes(f.path))
        return filtered.length ? filtered : all
      })

      const done = dataRef.current
      if (done.members && done.announcements && done.events && done.association) {
        setMembers(done.members)
        setAnnouncements(done.announcements)
        setEvents(done.events)
        setAssociation(done.association)
        setLiveMembers(done.members)
        setLiveAnnouncements(done.announcements)
        setLiveEvents(done.events)
        lastGoodRef.current = {
          membersCount: done.members.members.length,
          announcementsCount: done.announcements.items.length,
          eventsCount: done.events.items.length,
        }
      }
      setDirty(false)
      setDraftNote(null)
      setPublishNote(successText || 'Canlıya yayınlandı.')
      return via
    } finally {
      publishingLock.current = false
      setPublishing(false)
    }
  }, [])

  const schedulePublish = useCallback(
    (delayMs = 700, successText?: string, onlyPaths?: string[]) => {
      setDirty(true)
      if (!onlyPaths?.length) {
        pendingAllRef.current = true
        pendingPathsRef.current = null
      } else if (!pendingAllRef.current) {
        const merged = new Set([...(pendingPathsRef.current ?? []), ...onlyPaths])
        pendingPathsRef.current = [...merged]
      }
      pendingSuccessRef.current = successText
      if (publishTimer.current) window.clearTimeout(publishTimer.current)
      publishTimer.current = window.setTimeout(() => {
        publishTimer.current = null
        const paths = pendingAllRef.current ? undefined : (pendingPathsRef.current ?? undefined)
        const text = pendingSuccessRef.current
        pendingAllRef.current = false
        pendingPathsRef.current = null
        pendingSuccessRef.current = undefined
        void publishNow(text || 'Değişiklikler otomatik yayınlandı.', paths).catch((error) =>
          setDraftNote(error instanceof Error ? error.message : 'Yayın başarısız.'),
        )
      }, delayMs)
    },
    [publishNow],
  )

  const flushPublish = useCallback(
    async (successText?: string, onlyPaths?: string[]) => {
      if (publishTimer.current) {
        window.clearTimeout(publishTimer.current)
        publishTimer.current = null
      }

      let paths: string[] | undefined
      if (pendingAllRef.current || !onlyPaths?.length) {
        paths = undefined
      } else if (pendingPathsRef.current?.length) {
        paths = [...new Set([...pendingPathsRef.current, ...onlyPaths])]
      } else {
        paths = onlyPaths
      }

      pendingAllRef.current = false
      pendingPathsRef.current = null
      pendingSuccessRef.current = undefined
      return publishNow(successText, paths)
    },
    [publishNow],
  )

  function changeTab(next: AdminTab) {
    if (dirty && publishTimer.current) {
      void flushPublish('Bekleyen değişiklikler yayınlandı.').catch((error) =>
        setDraftNote(error instanceof Error ? error.message : 'Yayın başarısız.'),
      )
    }
    setTab(next)
  }

  function patchMembers(next: MembershipData) {
    setMembers(next)
    setLiveMembers(next)
    dataRef.current = { ...dataRef.current, members: next }
    schedulePublish(900, 'Aidat değişiklikleri otomatik yayınlandı.', [
      'public/data/uyeler.json',
    ])
  }

  function patchAnnouncements(next: AnnouncementsData) {
    setAnnouncements(next)
    setLiveAnnouncements(next)
    dataRef.current = { ...dataRef.current, announcements: next }
    schedulePublish(700, 'Duyuru değişiklikleri otomatik yayınlandı.', [
      'public/data/duyurular.json',
    ])
  }

  function patchEvents(next: EventsData) {
    setEvents(next)
    setLiveEvents(next)
    dataRef.current = { ...dataRef.current, events: next }
    schedulePublish(700, 'Etkinlik değişiklikleri otomatik yayınlandı.', [
      'public/data/etkinlikler.json',
    ])
  }

  function patchAssociation(next: AssociationData) {
    setAssociation(next)
    dataRef.current = { ...dataRef.current, association: next }
    schedulePublish(700, 'Site içeriği otomatik yayınlandı.', ['public/data/dernek.json'])
  }

  if (!authed) {
    return (
      <div className="admin-shell">
        <AdminLogin onSuccess={() => setAuthed(true)} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="admin-shell">
        <p className="admin-msg err">{loadError}</p>
      </div>
    )
  }

  if (!members || !announcements || !events || !association) {
    return (
      <div className="admin-shell">
        <p className="hint">Yönetim verileri yükleniyor…</p>
      </div>
    )
  }

  return (
    <div className="admin-shell">
      <div className="admin-top">
        <div>
          <h1>Yönetim paneli</h1>
          <p className="hint">
            Duyuru / etkinlik / aidat / site içeriği ekleyince{' '}
            <strong>otomatik canlıya yayınlanır</strong>. Kaydet menüsüne girmenize gerek yok.
          </p>
        </div>
        <div className="admin-actions">
          {publishing ? (
            <span className="admin-dirty">Yayınlanıyor…</span>
          ) : dirty ? (
            <span className="admin-dirty">Bekleyen değişiklik…</span>
          ) : null}
          <a
            className="btn btn-ghost"
            href={import.meta.env.BASE_URL}
            onClick={(e) => {
              e.preventDefault()
              // Admin’den çıkınca taze üye verisi yüklensin
              window.location.hash = ''
              window.location.href = `${import.meta.env.BASE_URL}?r=${Date.now()}`
            }}
          >
            Siteye dön
          </a>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void setAdminLoggedIn(false)
              setAuthed(false)
            }}
          >
            Çıkış
          </button>
        </div>
      </div>

      {draftNote && <p className="admin-msg err">{draftNote}</p>}
      {publishNote && <p className="admin-msg ok">{publishNote}</p>}

      <div className="admin-tabs">
        {(
          [
            ['aidat', 'Aidat'],
            ['duyurular', 'Duyurular'],
            ['etkinlikler', 'Etkinlikler'],
            ['site', 'Site'],
            ['indirenler', 'İndirenler'],
            ['ayarlar', 'Ayarlar'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`admin-tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => changeTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'aidat' && (
        <AidatAdmin
          data={members}
          onChange={patchMembers}
          onPublishNow={async (next, successText) => {
            const prev = dataRef.current.members
            publishingLock.current = true
            dataRef.current = { ...dataRef.current, members: next }
            setMembers(next)
            setLiveMembers(next)
            setDirty(true)
            try {
              return await flushPublish(successText, ['public/data/uyeler.json'])
            } catch (error) {
              if (prev) {
                dataRef.current = { ...dataRef.current, members: prev }
                setMembers(prev)
                setLiveMembers(prev)
              }
              publishingLock.current = false
              throw error
            }
          }}
        />
      )}
      {tab === 'duyurular' && (
        <DuyurularAdmin
          data={announcements}
          onChange={patchAnnouncements}
          onPublishNow={async (next, successText) => {
            const prev = dataRef.current.announcements
            publishingLock.current = true
            dataRef.current = { ...dataRef.current, announcements: next }
            setAnnouncements(next)
            setLiveAnnouncements(next)
            setDirty(true)
            try {
              return await flushPublish(successText, ['public/data/duyurular.json'])
            } catch (error) {
              if (prev) {
                dataRef.current = { ...dataRef.current, announcements: prev }
                setAnnouncements(prev)
                setLiveAnnouncements(prev)
              }
              publishingLock.current = false
              throw error
            }
          }}
        />
      )}
      {tab === 'etkinlikler' && (
        <EtkinliklerAdmin
          data={events}
          onChange={patchEvents}
          onPublishNow={async (next, successText) => {
            const prev = dataRef.current.events
            publishingLock.current = true
            dataRef.current = { ...dataRef.current, events: next }
            setEvents(next)
            setLiveEvents(next)
            setDirty(true)
            try {
              return await flushPublish(successText, ['public/data/etkinlikler.json'])
            } catch (error) {
              if (prev) {
                dataRef.current = { ...dataRef.current, events: prev }
                setEvents(prev)
                setLiveEvents(prev)
              }
              publishingLock.current = false
              throw error
            }
          }}
        />
      )}
      {tab === 'site' && (
        <DernekAdmin
          data={association}
          onChange={patchAssociation}
          onPublishNow={async (next, successText) => {
            const prev = dataRef.current.association
            publishingLock.current = true
            dataRef.current = { ...dataRef.current, association: next }
            setAssociation(next)
            setDirty(true)
            try {
              return await flushPublish(successText, ['public/data/dernek.json'])
            } catch (error) {
              if (prev) {
                dataRef.current = { ...dataRef.current, association: prev }
                setAssociation(prev)
              }
              publishingLock.current = false
              throw error
            }
          }}
        />
      )}
      {tab === 'indirenler' && <InstallStats />}
      {tab === 'ayarlar' && (
        <SavePanel
          members={members}
          announcements={announcements}
          events={events}
          association={association}
          dirty={dirty}
          onSaved={() => {
            setDirty(false)
            setDraftNote(null)
            setPublishNote('Manuel yayın tamam.')
            lastGoodRef.current = {
              membersCount: members.members.length,
              announcementsCount: announcements.items.length,
              eventsCount: events.items.length,
            }
          }}
          onReloadFromServer={() => {
            clearLiveData()
            setMembers(null)
            setAnnouncements(null)
            setEvents(null)
            setAssociation(null)
            setDirty(false)
            setDraftNote(null)
            setReloadToken((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}
