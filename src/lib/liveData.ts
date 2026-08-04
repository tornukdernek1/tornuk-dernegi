import type { AnnouncementsData, AssociationData, EventsData, MembershipData } from '../types'
import { PUBLISH_API_URL } from './publishConfig'
import { GITHUB_CONTENTS_DATA, LIVE_DATA_RAW_BASE } from './siteConfig'

const MEMBERS_KEY = 'tornuk-live-members'
const DUYURU_KEY = 'tornuk-live-duyurular'
const ETKINLIK_KEY = 'tornuk-live-etkinlikler'
export const DATA_UPDATED_EVENT = 'tornuk-data-updated'

export const LIVE_DATA_BASE = LIVE_DATA_RAW_BASE

const GITHUB_CONTENTS = GITHUB_CONTENTS_DATA

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, data: unknown) {
  localStorage.setItem(key, JSON.stringify(data))
  window.dispatchEvent(new Event(DATA_UPDATED_EVENT))
}

export function getLiveMembers(): MembershipData | null {
  return read<MembershipData>(MEMBERS_KEY)
}

export function setLiveMembers(data: MembershipData) {
  write(MEMBERS_KEY, data)
}

export function getLiveAnnouncements(): AnnouncementsData | null {
  return read<AnnouncementsData>(DUYURU_KEY)
}

export function setLiveAnnouncements(data: AnnouncementsData) {
  write(DUYURU_KEY, data)
}

export function getLiveEvents(): EventsData | null {
  return read<EventsData>(ETKINLIK_KEY)
}

export function setLiveEvents(data: EventsData) {
  write(ETKINLIK_KEY, data)
}

export function clearLiveData() {
  localStorage.removeItem(MEMBERS_KEY)
  localStorage.removeItem(DUYURU_KEY)
  localStorage.removeItem(ETKINLIK_KEY)
  window.dispatchEvent(new Event(DATA_UPDATED_EVENT))
}

async function fetchOne<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    mode: 'cors',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<T>
}

/** Public GitHub Contents API — CDN yok, tarayıcıdan okunabilir. */
async function fetchViaGithubApi<T>(file: string): Promise<T> {
  const res = await fetch(`${GITHUB_CONTENTS}/${file}?ref=gh-pages&t=${Date.now()}`, {
    cache: 'no-store',
    mode: 'cors',
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`github api ${res.status}`)
  const payload = (await res.json()) as { content?: string; encoding?: string }
  if (!payload.content) throw new Error('github api empty')
  const clean = payload.content.replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const text = new TextDecoder().decode(bytes)
  return JSON.parse(text) as T
}

/**
 * 1) GitHub Contents API (CDN yok — doğrudan yazmadan sonra doğru kaynak)
 * 2) Cloudflare Worker /live
 * 3) raw.githubusercontent
 * 4) Site Pages data/
 */
async function fetchJson<T>(file: string): Promise<T> {
  const bust = `t=${Date.now()}&r=${Math.random()}`
  const errors: string[] = []

  try {
    return await fetchViaGithubApi<T>(file)
  } catch (e) {
    errors.push(`api:${e instanceof Error ? e.message : 'fail'}`)
  }

  try {
    return await fetchOne<T>(`${PUBLISH_API_URL}/live/${file}?${bust}`)
  } catch (e) {
    errors.push(`worker:${e instanceof Error ? e.message : 'fail'}`)
  }

  try {
    return await fetchOne<T>(`${LIVE_DATA_BASE}/${file}?${bust}`)
  } catch (e) {
    errors.push(`raw:${e instanceof Error ? e.message : 'fail'}`)
  }

  try {
    return await fetchOne<T>(`${import.meta.env.BASE_URL}data/${file}?${bust}`)
  } catch (e) {
    errors.push(`pages:${e instanceof Error ? e.message : 'fail'}`)
  }

  throw new Error(`${file} yüklenemedi (${errors.join(' | ')})`)
}

export async function loadMembershipData(): Promise<MembershipData> {
  return fetchJson<MembershipData>('uyeler.json')
}

export async function loadAnnouncementsData(): Promise<AnnouncementsData> {
  return fetchJson<AnnouncementsData>('duyurular.json')
}

export async function loadEventsData(): Promise<EventsData> {
  return fetchJson<EventsData>('etkinlikler.json')
}

export async function loadAssociationData(): Promise<AssociationData> {
  return fetchJson<AssociationData>('dernek.json')
}

export function hasLiveDraft(): boolean {
  return Boolean(getLiveMembers() || getLiveAnnouncements() || getLiveEvents())
}

export function pickNewerData<T extends { updatedAt?: string }>(
  live: T | null,
  server: T,
): { data: T; fromLive: boolean } {
  if (!live) return { data: server, fromLive: false }
  const liveT = Date.parse(live.updatedAt || '') || 0
  const serverT = Date.parse(server.updatedAt || '') || 0
  if (liveT > serverT) return { data: live, fromLive: true }
  return { data: server, fromLive: false }
}
