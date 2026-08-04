import { buildPushHTTPRequest } from '@pushforge/builder'
import { getVapidPrivateJwk } from './vapidUnlock'
import type { NotifyKind } from './ntfyPush'
import { LIVE_DATA_RAW_BASE, SITE_BASE_URL } from './siteConfig'

type PushSub = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

async function loadSubscriptions(): Promise<PushSub[]> {
  const urls = [
    `${LIVE_DATA_RAW_BASE}/push-subscriptions.json?t=${Date.now()}`,
    `${import.meta.env.BASE_URL}data/push-subscriptions.json?t=${Date.now()}`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) continue
      const data = (await res.json()) as { subscriptions?: PushSub[] }
      if (Array.isArray(data.subscriptions)) return data.subscriptions
    } catch {
      // next
    }
  }
  return []
}

/** Admin cihazından doğrudan FCM’e Web Push — Worker/cron beklemez. */
export async function sendClosedAppPushNow(item: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<{ ok: number; fail: number }> {
  const privateJWK = getVapidPrivateJwk()
  if (!privateJWK) return { ok: 0, fail: 0 }

  const subscriptions = await loadSubscriptions()
  if (!subscriptions.length) return { ok: 0, fail: 0 }

  const tab = item.kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'
  const key = item.kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
  const id = item.id || `${item.kind}-${Date.now()}`
  const payload = {
    title: item.title,
    body: item.summary || item.title,
    kind: item.kind,
    id,
    url: `${SITE_BASE_URL}/?tab=${tab}&r=${Date.now()}&${key}=${encodeURIComponent(id)}`,
  }

  let ok = 0
  let fail = 0
  for (const sub of subscriptions) {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) continue
    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK,
        subscription: {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        },
        message: {
          payload,
          adminContact: 'mailto:tornuk-dernegi@users.noreply.github.com',
          options: {
            ttl: 60 * 60 * 24,
            urgency: 'high',
            topic: item.kind === 'etkinlik' ? 'etkinlik' : 'duyuru',
          },
        },
      })
      const res = await fetch(endpoint, { method: 'POST', headers, body })
      if (res.ok || res.status === 201) ok++
      else fail++
    } catch {
      fail++
    }
  }
  return { ok, fail }
}
