/**
 * Yerel Web Push yardımcısı (şirket ağında workers.dev engelli / Actions workflow yok).
 * Kullanım: node scripts/push-helper-server.mjs
 * Admin panel aynı makinede açıksa duyuru sonrası buraya POST atar.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { webcrypto } from 'node:crypto'
import webpush from 'web-push'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PORT = Number(process.env.TORNUK_PUSH_PORT || 19275)
const OWNER = 'tornukdernek1'
const REPO = 'tornuk-dernegi'
const SITE = `https://${OWNER}.github.io/${REPO}`
const CACHE_DIR = join(homedir(), '.tornuk')
const CACHE_KEYS = join(CACHE_DIR, 'vapid-keys.json')

function b64ToBytes(b64) {
  return Buffer.from(b64, 'base64')
}

async function unlockVapidFromSeal(pin) {
  const seal = JSON.parse(readFileSync(join(ROOT, 'public/data/vapid-seal.json'), 'utf8'))
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const key = await webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToBytes(seal.salt),
      iterations: seal.iter || 250000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(seal.iv) },
    key,
    Buffer.concat([b64ToBytes(seal.data), b64ToBytes(seal.tag)]),
  )
  return JSON.parse(new TextDecoder().decode(plain))
}

function loadCachedKeys() {
  if (!existsSync(CACHE_KEYS)) return null
  try {
    return JSON.parse(readFileSync(CACHE_KEYS, 'utf8'))
  } catch {
    return null
  }
}

async function ensureKeys() {
  const cached = loadCachedKeys()
  if (cached?.publicKey && cached?.privateKey) return cached

  const pin = process.env.TORNUK_ADMIN_PIN
  if (!pin) {
    throw new Error(
      'VAPID anahtarları yok. Bir kez TORNUK_ADMIN_PIN=... ile başlatın (anahtarlar ~/.tornuk içine yazılır).',
    )
  }
  const jwk = await unlockVapidFromSeal(pin)
  const vapid = JSON.parse(readFileSync(join(ROOT, 'public/data/vapid.json'), 'utf8'))
  const keys = {
    publicKey: vapid.publicKey,
    privateKey: jwk.d,
    subject: vapid.subject || 'mailto:tornuk-dernegi@users.noreply.github.com',
  }
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_KEYS, `${JSON.stringify(keys, null, 2)}\n`)
  return keys
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  return execSync('gh auth token', { encoding: 'utf8' }).trim()
}

async function loadSubscriptions() {
  const token = githubToken()
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/data/push-subscriptions.json?ref=gh-pages&t=${Date.now()}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tornuk-push-helper',
      },
    },
  )
  if (!res.ok) throw new Error(`subs ${res.status}`)
  const payload = await res.json()
  const text = Buffer.from(String(payload.content || '').replace(/\s+/g, ''), 'base64').toString(
    'utf8',
  )
  const data = JSON.parse(text)
  return Array.isArray(data.subscriptions) ? data.subscriptions : []
}

async function sendPush(item) {
  const keys = await ensureKeys()
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
  const subscriptions = await loadSubscriptions()
  const kind = item.kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
  const tab = kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'
  const key = kind
  const id = item.id || `${kind}-${Date.now()}`
  const payload = JSON.stringify({
    title: item.title,
    body: item.summary || item.body || item.title,
    kind,
    id,
    url:
      item.url ||
      `${SITE}/?tab=${tab}&r=${Date.now()}&${key}=${encodeURIComponent(id)}`,
  })

  let ok = 0
  let fail = 0
  for (const sub of subscriptions) {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) continue
    try {
      await webpush.sendNotification(sub, payload, {
        TTL: 60 * 60 * 24,
        urgency: 'high',
        topic: kind,
      })
      ok++
    } catch (error) {
      fail++
      console.warn('fail', error?.statusCode || error?.message)
    }
  }
  return { ok, fail, total: subscriptions.length }
}

function json(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(raw)
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    json(res, 200, { ok: true, service: 'tornuk-push-helper' })
    return
  }
  if (req.method === 'POST' && (req.url === '/notify' || req.url === '/')) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      json(res, 400, { ok: false, error: 'Geçersiz JSON' })
      return
    }
    try {
      const result = await sendPush(body)
      console.log(new Date().toISOString(), 'notify', body.title, result)
      json(res, 200, { ok: true, okCount: result.ok, fail: result.fail, total: result.total })
    } catch (error) {
      json(res, 502, {
        ok: false,
        error: error instanceof Error ? error.message : 'Gönderilemedi',
      })
    }
    return
  }
  json(res, 404, { ok: false, error: 'Not found' })
})

const keys = await ensureKeys()
webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Törnük push helper http://127.0.0.1:${PORT}`)
})
