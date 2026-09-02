import { enqueueClosedAppPush } from './pushOutbox'
import { sendClosedAppPushNow } from './sendWebPushBrowser'
import { getAdminSessionPin } from './adminAuth'
import { getBridgeGithubToken } from './bridgeUnlock'
import { PUBLISH_API_URL } from './publishConfig'
import { GITHUB_OWNER, GITHUB_REPO, SITE_BASE_URL } from './siteConfig'

export const NTFY_TOPIC = 'tornuk_dernegi_gumushane_duyuru'

export type NotifyKind = 'duyuru' | 'etkinlik'

export type NotifyResult = {
  webPushOk: number
  webPushFail: number
  outbox: boolean
  workflow: boolean
  helper: boolean
  ntfy: boolean
}

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

/** Yerel push helper — Node üzerinden FCM (tarayıcı CORS sorunu yok). */
async function postViaLocalHelper(item: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<{ ok: number; fail: number } | null> {
  try {
    const res = await fetch('http://127.0.0.1:19275/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      okCount?: number
      fail?: number
      ok?: number | boolean
    }
    const okCount =
      typeof body.okCount === 'number'
        ? body.okCount
        : typeof body.ok === 'number'
          ? body.ok
          : 0
    const fail = typeof body.fail === 'number' ? body.fail : 0
    return { ok: okCount, fail }
  } catch {
    return null
  }
}

async function triggerPushNotifyWorkflow(): Promise<boolean> {
  const token = getBridgeGithubToken()
  if (!token) return false
  const repos = [`${GITHUB_OWNER}/${GITHUB_REPO}`, 'mustafatemel1986-ops/tornuk-push-relay']
  for (const repo of repos) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_type: 'push-notify' }),
      })
      if (res.status === 204 || res.ok) return true
    } catch {
      // next
    }
  }
  return false
}

/** Duyuru veya etkinlik için anlık bildirim. */
export async function publishNotifyToNtfy(item: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<NotifyResult> {
  const result: NotifyResult = {
    webPushOk: 0,
    webPushFail: 0,
    outbox: false,
    workflow: false,
    helper: false,
    ntfy: false,
  }

  const helper = await postViaLocalHelper(item)
  if (helper) {
    result.helper = true
    result.webPushOk += helper.ok
    result.webPushFail += helper.fail
  } else {
    try {
      const sent = await sendClosedAppPushNow(item)
      result.webPushOk += sent.ok
      result.webPushFail += sent.fail
    } catch {
      // ignore
    }
  }

  try {
    await enqueueClosedAppPush(item)
    result.outbox = true
  } catch {
    // bridge yoksa sessiz
  }

  result.workflow = await triggerPushNotifyWorkflow()

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await postNtfyDirect(item)
      result.ntfy = true
      void postNtfyViaWorker(item).catch(() => undefined)
      return result
    } catch (error) {
      lastError = error
      await sleep(400 * (attempt + 1))
    }
  }

  try {
    await postNtfyViaWorker(item)
    result.ntfy = true
    return result
  } catch (error) {
    if (result.outbox || result.workflow || result.helper || result.webPushOk > 0) {
      return result
    }
    const a = lastError instanceof Error ? lastError.message : 'ntfy'
    const b = error instanceof Error ? error.message : 'worker'
    throw new Error(`${a} / ${b}`)
  }
}

export function formatNotifyResultMessage(prefix: string, result: NotifyResult): string {
  if (result.webPushOk > 0 || result.helper) {
    return `${prefix} Üyelere bildirim gönderildi (${result.webPushOk} cihaz).`
  }
  if (result.workflow || result.outbox) {
    return `${prefix} Bildirim kuyruğa alındı; kısa sürede iletilir.`
  }
  if (result.ntfy) {
    return `${prefix} ntfy bildirimi gitti. Uygulama bildirimi için yerel yardımcı gerekir.`
  }
  return `${prefix} Bildirim kanalı yanıt vermedi; üyeler uygulamayı açınca görür.`
}

/** @deprecated kullan publishNotifyToNtfy */
export async function publishDuyuruToNtfy(item: {
  id?: string
  title: string
  summary: string
}): Promise<NotifyResult> {
  return publishNotifyToNtfy({ kind: 'duyuru', ...item })
}
