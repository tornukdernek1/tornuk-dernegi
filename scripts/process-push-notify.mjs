/**
 * Kapalı uygulama Web Push: outbox + yeni duyuru/etkinlik.
 * Kullanım (yerel): node scripts/process-push-notify.mjs
 * CI: VAPID_* + GITHUB_TOKEN ortam değişkenleri gerekir.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import webpush from 'web-push'

const OWNER = 'tornukdernek1'
const REPO = 'tornuk-dernegi'
const SITE = `https://${OWNER}.github.io/${REPO}`
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`

const publicKey = process.env.VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
const subject = process.env.VAPID_SUBJECT || 'mailto:tornuk-dernegi@users.noreply.github.com'

if (!publicKey || !privateKey) {
  console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY eksik')
  process.exit(1)
}

webpush.setVapidDetails(subject, publicKey, privateKey)

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  return execSync('gh auth token', { encoding: 'utf8' }).trim()
}

const token = githubToken()

async function getJson(path, branch) {
  const res = await fetch(`${API}/${path}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tornuk-push-notify',
    },
  })
  if (res.status === 404) return { sha: undefined, data: null }
  if (!res.ok) throw new Error(`get ${path}@${branch}: ${res.status}`)
  const payload = await res.json()
  const text = Buffer.from(String(payload.content || '').replace(/\s+/g, ''), 'base64').toString(
    'utf8',
  )
  return { sha: payload.sha, data: JSON.parse(text) }
}

async function putJson(path, branch, data, sha, message) {
  const body = {
    message,
    content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  }
  const res = await fetch(`${API}/${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'tornuk-push-notify',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`put ${path}@${branch}: ${res.status} ${await res.text()}`)
}

async function sendToAll(subscriptions, payloadObj) {
  const payload = JSON.stringify(payloadObj)
  let ok = 0
  let fail = 0
  const dead = []
  for (const sub of subscriptions) {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) continue
    try {
      await webpush.sendNotification(sub, payload, {
        TTL: 60 * 60 * 24,
        urgency: 'high',
        topic: payloadObj.kind === 'etkinlik' ? 'etkinlik' : 'duyuru',
      })
      ok++
    } catch (error) {
      fail++
      const status = error?.statusCode
      if (status === 404 || status === 410) dead.push(sub.endpoint)
      console.warn('push fail', status || error?.message)
    }
  }
  return { ok, fail, dead }
}

function fingerprint(title, body, id) {
  return createHash('sha256').update(`${id}|${title}|${body}`).digest('hex').slice(0, 16)
}

const liveSubs = await getJson('data/push-subscriptions.json', 'gh-pages')
const liveState = await getJson('data/push-state.json', 'gh-pages')
const liveOutbox = await getJson('data/push-outbox.json', 'gh-pages')
const liveDuyuru = await getJson('data/duyurular.json', 'gh-pages')
const liveEtkinlik = await getJson('data/etkinlikler.json', 'gh-pages')

let subscriptions = Array.isArray(liveSubs.data?.subscriptions)
  ? [...liveSubs.data.subscriptions]
  : []
let state = liveState.data || {
  lastDuyuruId: null,
  lastEtkinlikId: null,
  updatedAt: new Date().toISOString(),
}
let outboxItems = Array.isArray(liveOutbox.data?.items) ? [...liveOutbox.data.items] : []

const bootstrap =
  process.env.PUSH_BOOTSTRAP === '1' ||
  process.argv.includes('--bootstrap')

if (bootstrap) {
  const latestD = liveDuyuru.data?.items?.[0]
  const latestE = liveEtkinlik.data?.items?.[0]
  state = {
    lastDuyuruId: latestD?.id || state.lastDuyuruId || null,
    lastEtkinlikId: latestE?.id || state.lastEtkinlikId || null,
    updatedAt: new Date().toISOString(),
  }
  outboxItems = []
  console.log('bootstrap: state hizalandı, outbox temizlendi (spam yok)')
} else {
  const remaining = []
  for (const item of outboxItems) {
    const result = await sendToAll(subscriptions, {
      title: item.title,
      body: item.body || item.title,
      kind: item.kind === 'etkinlik' ? 'etkinlik' : 'duyuru',
      id: item.id,
      url:
        item.url ||
        `${SITE}/?tab=${item.kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'}&r=${Date.now()}`,
    })
    console.log(`outbox ${item.id}: ok=${result.ok} fail=${result.fail}`)
    if (result.dead.length) {
      subscriptions = subscriptions.filter((s) => !result.dead.includes(s.endpoint))
    }
    if (!result.ok) remaining.push(item)
    else if (item.kind === 'etkinlik') state.lastEtkinlikId = item.id
    else state.lastDuyuruId = item.id
  }
  outboxItems = remaining

  const latestD = liveDuyuru.data?.items?.[0]
  if (latestD?.id && latestD.id !== state.lastDuyuruId) {
    if (!state.lastDuyuruId) {
      // İlk kurulum: geçmişi spam etme
      state.lastDuyuruId = latestD.id
      console.log(`duyuru seed: ${latestD.id}`)
    } else {
      const result = await sendToAll(subscriptions, {
        title: latestD.title,
        body: latestD.summary || latestD.title,
        kind: 'duyuru',
        id: latestD.id,
        url: `${SITE}/?tab=duyurular&r=${Date.now()}&duyuru=${encodeURIComponent(latestD.id)}`,
      })
      console.log(`duyuru ${latestD.id}: ok=${result.ok} fail=${result.fail}`)
      if (result.dead.length) {
        subscriptions = subscriptions.filter((s) => !result.dead.includes(s.endpoint))
      }
      if (result.ok > 0 || result.fail === 0) state.lastDuyuruId = latestD.id
    }
  }

  const latestE = liveEtkinlik.data?.items?.[0]
  if (latestE?.id && latestE.id !== state.lastEtkinlikId) {
    if (!state.lastEtkinlikId) {
      state.lastEtkinlikId = latestE.id
      console.log(`etkinlik seed: ${latestE.id}`)
    } else {
      const bodyText =
        latestE.description ||
        [latestE.date, latestE.time, latestE.place].filter(Boolean).join(' · ') ||
        latestE.title
      const result = await sendToAll(subscriptions, {
        title: latestE.title,
        body: bodyText,
        kind: 'etkinlik',
        id: latestE.id,
        url: `${SITE}/?tab=etkinlikler&r=${Date.now()}&etkinlik=${encodeURIComponent(latestE.id)}`,
      })
      console.log(`etkinlik ${latestE.id}: ok=${result.ok} fail=${result.fail}`)
      if (result.dead.length) {
        subscriptions = subscriptions.filter((s) => !result.dead.includes(s.endpoint))
      }
      if (result.ok > 0 || result.fail === 0) state.lastEtkinlikId = latestE.id
    }
  }
}

state.updatedAt = new Date().toISOString()
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
const subsData = { updatedAt: new Date().toISOString(), subscriptions }
const outboxData = { updatedAt: new Date().toISOString(), items: outboxItems }

await putJson(
  'data/push-state.json',
  'gh-pages',
  state,
  liveState.sha,
  `chore: push-state (${stamp})`,
)
await putJson(
  'data/push-outbox.json',
  'gh-pages',
  outboxData,
  liveOutbox.sha,
  `chore: push-outbox (${stamp})`,
)
await putJson(
  'data/push-subscriptions.json',
  'gh-pages',
  subsData,
  liveSubs.sha,
  `chore: push-subs (${stamp})`,
)

try {
  const mainState = await getJson('public/data/push-state.json', 'main')
  const mainOutbox = await getJson('public/data/push-outbox.json', 'main')
  const mainSubs = await getJson('public/data/push-subscriptions.json', 'main')
  await putJson('public/data/push-state.json', 'main', state, mainState.sha, `chore: push-state (${stamp})`)
  await putJson(
    'public/data/push-outbox.json',
    'main',
    outboxData,
    mainOutbox.sha,
    `chore: push-outbox (${stamp})`,
  )
  await putJson(
    'public/data/push-subscriptions.json',
    'main',
    subsData,
    mainSubs.sha,
    `chore: push-subs (${stamp})`,
  )
} catch (e) {
  console.warn('main yedek yazılamadı:', e instanceof Error ? e.message : e)
}

console.log(
  JSON.stringify({
    ok: true,
    subs: subscriptions.length,
    outboxLeft: outboxItems.length,
    lastDuyuruId: state.lastDuyuruId,
    lastEtkinlikId: state.lastEtkinlikId,
    fp: fingerprint(state.lastDuyuruId || '', state.lastEtkinlikId || '', stamp),
  }),
)
