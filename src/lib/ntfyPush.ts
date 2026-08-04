import { enqueueClosedAppPush } from './pushOutbox'
import { sendClosedAppPushNow } from './sendWebPushBrowser'
import { getAdminSessionPin } from './adminAuth'
import { PUBLISH_API_URL } from './publishConfig'
import { SITE_BASE_URL } from './siteConfig'

export const NTFY_TOPIC = 'tornuk_dernegi_gumushane_duyuru'

export type NotifyKind = 'duyuru' | 'etkinlik'

export function getNtfySubscribeUrl() {
  return `https://ntfy.sh/${NTFY_TOPIC}`
}

export function getNtfyDeepLink() {
  return `ntfy://ntfy.sh/${NTFY_TOPIC}`
}

function siteClickUrl(kind: NotifyKind, id?: string) {
  const tab = kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'
  const key = kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
  return `${SITE_BASE_URL}/?tab=${tab}&r=${Date.now()}${
    id ? `&${key}=${encodeURIComponent(id)}` : ''
  }`
}

async function sleep(ms: number) {
  await new Promise((r) => window.setTimeout(r, ms))
}

async function postNtfyDirect(payload: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<void> {
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: payload.title.slice(0, 100),
      message: (payload.summary || payload.title).slice(0, 500),
      click: siteClickUrl(payload.kind, payload.id),
      priority: 4,
      tags: [
        payload.kind === 'etkinlik' ? 'calendar' : 'loudspeaker',
        payload.kind,
      ],
    }),
  })
  if (!res.ok) throw new Error(`ntfy ${res.status}`)
}

/** Worker üzerinden (iş ağı ntfy’yi engelliyorsa). */
async function postNtfyViaWorker(payload: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<void> {
  const pin = getAdminSessionPin()
  if (!pin) throw new Error('PIN yok')

  const res = await fetch(`${PUBLISH_API_URL}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin,
      kind: payload.kind,
      id: payload.id,
      title: payload.title,
      summary: payload.summary,
    }),
  })
  const text = await res.text()
  let body: { ok?: boolean; error?: string } = {}
  try {
    body = JSON.parse(text) as { ok?: boolean; error?: string }
  } catch {
    throw new TypeError('Failed to fetch')
  }
  if (!res.ok || !body.ok) throw new Error(body.error || `notify ${res.status}`)
}

/** Duyuru veya etkinlik için anlık bildirim (ntfy + kapalı uygulama kuyruğu). */
export async function publishNotifyToNtfy(item: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<void> {
  // Kapalı uygulama: 1) admin tarayıcısından hemen Web Push  2) outbox yedek
  try {
    await sendClosedAppPushNow(item)
  } catch {
    // FCM engelli olabilir
  }
  try {
    await enqueueClosedAppPush(item)
  } catch {
    // bridge yoksa sessiz
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await postNtfyDirect(item)
      void postNtfyViaWorker(item).catch(() => undefined)
      return
    } catch (error) {
      lastError = error
      await sleep(400 * (attempt + 1))
    }
  }

  try {
    await postNtfyViaWorker(item)
    return
  } catch (error) {
    const a = lastError instanceof Error ? lastError.message : 'ntfy'
    const b = error instanceof Error ? error.message : 'worker'
    throw new Error(`${a} / ${b}`)
  }
}

/** @deprecated kullan publishNotifyToNtfy */
export async function publishDuyuruToNtfy(item: {
  id?: string
  title: string
  summary: string
}): Promise<void> {
  return publishNotifyToNtfy({ kind: 'duyuru', ...item })
}
