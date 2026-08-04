import { playNotifySound } from './notifySound'
import { subscribeWebPush } from './webPush'

const STORAGE_KEY = 'tornuk-last-duyuru-id'
const ETKINLIK_STORAGE_KEY = 'tornuk-last-etkinlik-id'
const PREF_KEY = 'tornuk-notify-enabled'
const ASK_KEY = 'tornuk-ask-notify'

export function getNotifyPreference(): boolean {
  return localStorage.getItem(PREF_KEY) === '1'
}

export const NOTIFY_PREF_EVENT = 'tornuk-notify-pref'

export function setNotifyPreference(enabled: boolean) {
  localStorage.setItem(PREF_KEY, enabled ? '1' : '0')
  window.dispatchEvent(new Event(NOTIFY_PREF_EVENT))
}

/** Kurulum sonrası bildirim izni sorulacak mı? */
export function shouldAskNotifyPermission(): boolean {
  if (!('Notification' in window)) return false
  if (getNotifyPreference() && Notification.permission === 'granted') return false
  if (Notification.permission === 'denied') return false
  return localStorage.getItem(ASK_KEY) === '1' || Notification.permission === 'default'
}

export function markAskNotifyPermission() {
  localStorage.setItem(ASK_KEY, '1')
}

export function clearAskNotifyPermission() {
  localStorage.removeItem(ASK_KEY)
}

export function getLastSeenDuyuruId(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setLastSeenDuyuruId(id: string) {
  localStorage.setItem(STORAGE_KEY, id)
}

export function getLastSeenEtkinlikId(): string | null {
  return localStorage.getItem(ETKINLIK_STORAGE_KEY)
}

export function setLastSeenEtkinlikId(id: string) {
  localStorage.setItem(ETKINLIK_STORAGE_KEY, id)
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

/** İndirme / ana ekrana ekleme sonrası: izin iste ve bildirimleri aç. */
export async function enableNotificationsAfterInstall(): Promise<'granted' | 'denied' | 'default'> {
  markAskNotifyPermission()
  const permission = await ensureNotificationPermission()
  if (permission === 'granted') {
    setNotifyPreference(true)
    clearAskNotifyPermission()
    await registerPeriodicDuyuruCheck()
    await askServiceWorkerToCheck()
    try {
      await subscribeWebPush()
    } catch {
      // Worker engelli ağlarda abonelik sonra denenir
    }
    try {
      await showDuyuruNotification({
        id: `welcome-${Date.now()}`,
        title: 'Törnük Derneği',
        summary: 'Bildirimler açıldı. Yeni duyuru ve etkinliklerde size haber vereceğiz.',
      })
    } catch {
      // sessiz
    }
  }
  return permission
}

export async function registerPeriodicDuyuruCheck() {
  const reg = await navigator.serviceWorker?.ready
  if (!reg) return

  const periodic = reg as ServiceWorkerRegistration & {
    periodicSync?: {
      register: (tag: string, options: { minInterval: number }) => Promise<void>
    }
  }

  if (periodic.periodicSync) {
    try {
      await periodic.periodicSync.register('check-duyurular', {
        minInterval: 15 * 60 * 1000,
      })
    } catch {
      // İzin yoksa veya desteklenmiyorsa sessizce geç
    }
  }
}

export async function askServiceWorkerToCheck() {
  const reg = await navigator.serviceWorker?.ready
  reg?.active?.postMessage({ type: 'CHECK_DUYURULAR' })
  reg?.active?.postMessage({ type: 'CHECK_ETKINLIKLER' })
}

/** SW’nin son görülen id’sini güncelle — EventSource ile çift bildirimi önler. */
export async function syncServiceWorkerLastDuyuruId(id: string) {
  const reg = await navigator.serviceWorker?.ready
  reg?.active?.postMessage({ type: 'SET_LAST_DUYURU_ID', id })
}

export async function syncServiceWorkerLastEtkinlikId(id: string) {
  const reg = await navigator.serviceWorker?.ready
  reg?.active?.postMessage({ type: 'SET_LAST_ETKINLIK_ID', id })
}

export type DuyuruLite = {
  id: string
  title: string
  summary: string
}

export type EtkinlikLite = {
  id: string
  title: string
  summary: string
}

function iconUrl() {
  return `${import.meta.env.BASE_URL}icons/icon-192.png`
}

export async function showDuyuruNotification(
  item: DuyuruLite,
  options?: { playSound?: boolean },
) {
  if (options?.playSound !== false) playNotifySound()

  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const opts: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: item.summary,
    icon: iconUrl(),
    badge: iconUrl(),
    tag: `duyuru-${item.id}`,
    renotify: true,
    silent: false,
    vibrate: [200, 80, 200, 80, 400],
    data: { url: `${import.meta.env.BASE_URL}?tab=duyurular&r=${Date.now()}` },
  }

  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg?.showNotification) {
      await reg.showNotification(item.title, opts)
      return
    }
  } catch {
    // fallback aşağıda
  }

  try {
    new Notification(item.title, opts)
  } catch {
    // bazı tarayıcılarda engelli olabilir
  }
}

export async function showEtkinlikNotification(
  item: EtkinlikLite,
  options?: { playSound?: boolean },
) {
  if (options?.playSound !== false) playNotifySound()

  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const opts: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: item.summary,
    icon: iconUrl(),
    badge: iconUrl(),
    tag: `etkinlik-${item.id}`,
    renotify: true,
    silent: false,
    vibrate: [200, 80, 200, 80, 400],
    data: { url: `${import.meta.env.BASE_URL}?tab=etkinlikler&r=${Date.now()}` },
  }

  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg?.showNotification) {
      await reg.showNotification(item.title, opts)
      return
    }
  } catch {
    // fallback
  }

  try {
    new Notification(item.title, opts)
  } catch {
    // engelli
  }
}

/** Menüden deneme bildirimi + ses. */
export async function sendTestNotification() {
  const permission = await ensureNotificationPermission()
  if (permission !== 'granted') {
    throw new Error('Bildirim izni yok')
  }
  setNotifyPreference(true)
  await showDuyuruNotification({
    id: `test-${Date.now()}`,
    title: 'Törnük Derneği',
    summary: 'Test bildirimi — ses ve uyarı çalışıyor.',
  })
}

/** Uygulama açıkken / öne gelince yeni duyuru kontrolü. */
export async function checkDuyurularInPage(options?: {
  notify?: boolean
}): Promise<{ latestId: string | null; isNew: boolean; item: DuyuruLite | null }> {
  const res = await fetch(
    `https://raw.githubusercontent.com/tornukdernek1/tornuk-dernegi/gh-pages/data/duyurular.json?t=${Date.now()}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return { latestId: null, isNew: false, item: null }

  const data = (await res.json()) as { items: DuyuruLite[] }
  const latest = data.items[0]
  if (!latest) return { latestId: null, isNew: false, item: null }

  const prev = getLastSeenDuyuruId()
  const isNew = Boolean(prev && prev !== latest.id)

  if (!prev) {
    setLastSeenDuyuruId(latest.id)
    return { latestId: latest.id, isNew: false, item: latest }
  }

  if (isNew) {
    setLastSeenDuyuruId(latest.id)
    if (options?.notify && getNotifyPreference()) {
      await showDuyuruNotification(latest)
    }
  }

  return { latestId: latest.id, isNew, item: latest }
}

/** Yeni etkinlik kontrolü (items[0] = son eklenen). */
export async function checkEtkinliklerInPage(options?: {
  notify?: boolean
}): Promise<{ latestId: string | null; isNew: boolean; item: EtkinlikLite | null }> {
  const res = await fetch(
    `https://raw.githubusercontent.com/tornukdernek1/tornuk-dernegi/gh-pages/data/etkinlikler.json?t=${Date.now()}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return { latestId: null, isNew: false, item: null }

  const data = (await res.json()) as {
    items: {
      id: string
      title: string
      description?: string
      date?: string
      time?: string
      place?: string
    }[]
  }
  const latestRaw = data.items?.[0]
  if (!latestRaw) return { latestId: null, isNew: false, item: null }

  const latest: EtkinlikLite = {
    id: latestRaw.id,
    title: latestRaw.title,
    summary:
      latestRaw.description?.trim() ||
      [latestRaw.date, latestRaw.time, latestRaw.place].filter(Boolean).join(' · ') ||
      latestRaw.title,
  }

  const prev = getLastSeenEtkinlikId()
  const isNew = Boolean(prev && prev !== latest.id)

  if (!prev) {
    setLastSeenEtkinlikId(latest.id)
    return { latestId: latest.id, isNew: false, item: latest }
  }

  if (isNew) {
    setLastSeenEtkinlikId(latest.id)
    if (options?.notify && getNotifyPreference()) {
      await showEtkinlikNotification(latest)
    }
  }

  return { latestId: latest.id, isNew, item: latest }
}

/** Service worker’dan gelen ses isteğini dinle. */
export function listenForNotifySoundFromSw() {
  if (!('serviceWorker' in navigator)) return () => undefined

  function onMessage(event: MessageEvent) {
    if (event.data?.type === 'PLAY_NOTIFY_SOUND') playNotifySound()
  }

  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
