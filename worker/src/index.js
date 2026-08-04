/**
 * Törnük Derneği — yayın köprüsü (Cloudflare Worker)
 *
 * Yöneticiler sadece PIN ile giriş yapar.
 * GitHub token burada gizli kalır; tarayıcıya hiç inmez.
 */

import { sendOneWebPush } from './webPushSend.js'

const SALT = 'tornuk-admin-v1'
const OWNER = 'tornukdernek1'
const REPO = 'tornuk-dernegi'
const MAIN_BRANCH = 'main'
const LIVE_BRANCH = 'gh-pages'

const ALLOWED_PATHS = new Set([
  'public/data/uyeler.json',
  'public/data/duyurular.json',
  'public/data/etkinlikler.json',
  'public/data/dernek.json',
  'public/data/push-subscriptions.json',
])

const MAX_PUSH_SUBS = 400
const PUSH_SUBS_MAIN = 'public/data/push-subscriptions.json'
const PUSH_SUBS_LIVE = 'data/push-subscriptions.json'

function corsHeaders(origin) {
  // PIN ile korunuyor; Origin kısıtı bazı PWA / ağlarda Failed to fetch yapıyordu
  const allow = origin && origin !== 'null' ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  })
}

async function hashPassword(pin) {
  const data = new TextEncoder().encode(`${SALT}:${String(pin).trim()}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tornuk-publish-worker',
  }
}

async function githubJson(url, token, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...githubHeaders(token),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    const error = new Error(`${res.status} ${url}: ${err}`)
    error.status = res.status
    throw error
  }
  return res.json()
}

function isConflictError(error) {
  const text = error instanceof Error ? error.message : String(error)
  return (
    text === 'CONFLICT' ||
    text.includes('"status": "409"') ||
    text.includes(' 409 ') ||
    text.includes(' 422 ') ||
    text.includes('does not match') ||
    text.includes('not a fast-forward')
  )
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

/** Tek dosya: Contents API (daha az tur). */
async function commitSingleFile(token, branch, file, message) {
  const base = `https://api.github.com/repos/${OWNER}/${REPO}`
  const url = `${base}/contents/${file.path}?ref=${encodeURIComponent(branch)}`
  let sha
  const getRes = await fetch(url, { headers: githubHeaders(token) })
  if (getRes.ok) {
    const existing = await getRes.json()
    sha = existing.sha
  } else if (getRes.status !== 404) {
    throw new Error(`${getRes.status} ${url}: ${await getRes.text()}`)
  }

  const put = await fetch(`${base}/contents/${file.path}`, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64Utf8(file.content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (put.status === 409 || put.status === 422) throw new Error('CONFLICT')
  if (!put.ok) throw new Error(`Dosya yazılamadı (${file.path}): ${await put.text()}`)
}

async function commitFilesOnBranch(token, branch, files, message) {
  if (files.length === 1) {
    await commitSingleFile(token, branch, files[0], message)
    return
  }

  const base = `https://api.github.com/repos/${OWNER}/${REPO}`

  const ref = await githubJson(
    `${base}/git/ref/heads/${encodeURIComponent(branch)}?t=${Date.now()}`,
    token,
  )
  const latestCommitSha = ref.object.sha
  const latestCommit = await githubJson(`${base}/git/commits/${latestCommitSha}`, token)

  // Blob’ları paralel oluştur — sırayla bekleme
  const treeItems = await Promise.all(
    files.map(async (file) => {
      const blob = await githubJson(`${base}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify({
          content: toBase64Utf8(file.content),
          encoding: 'base64',
        }),
      })
      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      }
    }),
  )

  const tree = await githubJson(`${base}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: latestCommit.tree.sha,
      tree: treeItems,
    }),
  })

  const commit = await githubJson(`${base}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [latestCommitSha],
    }),
  })

  const update = await fetch(`${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha }),
  })

  if (update.status === 422 || update.status === 409) {
    throw new Error('CONFLICT')
  }
  if (!update.ok) {
    throw new Error(`Dal güncellenemedi (${branch}): ${await update.text()}`)
  }
}

async function commitFilesWithRetry(token, branch, files, message) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await commitFilesOnBranch(token, branch, files, message)
      return
    } catch (error) {
      if (!isConflictError(error)) throw error
      await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 300))
    }
  }
  throw new Error(`Kayıt çakışması (${branch}). Birkaç saniye sonra tekrar deneyin.`)
}

function assertSafeFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 3) {
    throw new Error('Geçersiz dosya listesi.')
  }
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || !ALLOWED_PATHS.has(file.path)) {
      throw new Error(`İzin verilmeyen dosya: ${file?.path || '?'}`)
    }
    if (file.data == null || typeof file.data !== 'object') {
      throw new Error(`Geçersiz veri: ${file.path}`)
    }
    // Üye listesini yanlışlıkla boş yayınlamayı engelle (duyuru/etkinlik silinebilir)
    if (file.path.includes('uyeler')) {
      const members = file.data.members
      if (Array.isArray(members) && members.length === 0) {
        throw new Error('Boş üye listesi yayınlanamaz (veri koruması).')
      }
    }
  }
}

const LIVE_FILES = new Set([
  'uyeler.json',
  'duyurular.json',
  'etkinlikler.json',
  'dernek.json',
  'push-subscriptions.json',
])
/** Yayın sonrası anında okuma — CDN beklemeden */
const memoryLive = new Map()

function decodeGithubContent(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function readLiveFileFromGithub(token, fileName) {
  const path = `data/${fileName}`
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${LIVE_BRANCH}&t=${Date.now()}`
  const res = await fetch(url, {
    headers: {
      ...githubHeaders(token),
      'Cache-Control': 'no-cache',
    },
  })
  if (!res.ok) throw new Error(`GitHub okuma ${res.status}`)
  const data = await res.json()
  return decodeGithubContent(data.content)
}

async function handleLiveGet(env, origin, fileName) {
  if (!LIVE_FILES.has(fileName)) {
    return json({ ok: false, error: 'Not found' }, 404, origin)
  }

  try {
    // Bellekte varsa bile GitHub’dan tazele — doğrudan yayın sonrası eski cache dönmesin
    if (!env.GITHUB_TOKEN) throw new Error('Token yok')
    const text = await readLiveFileFromGithub(env.GITHUB_TOKEN, fileName)
    memoryLive.set(fileName, text)

    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
        ...corsHeaders(origin),
      },
    })
  } catch (error) {
    const cached = memoryLive.get(fileName)
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
          ...corsHeaders(origin),
        },
      })
    }
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Okuma başarısız' },
      502,
      origin,
    )
  }
}

const NTFY_TOPIC = 'tornuk_dernegi_gumushane_duyuru'

async function sendNtfy(kind, item) {
  if (!item || typeof item.title !== 'string') return
  const tab = kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'
  const key = kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
  const summary =
    (typeof item.summary === 'string' && item.summary) ||
    (typeof item.description === 'string' && item.description) ||
    item.title
  const click = `https://tornukdernek1.github.io/tornuk-dernegi/?tab=${tab}&r=${Date.now()}${
    item.id ? `&${key}=${encodeURIComponent(item.id)}` : ''
  }`
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: String(item.title).slice(0, 100),
      message: String(summary).slice(0, 500),
      click,
      priority: 4,
      tags: [kind === 'etkinlik' ? 'calendar' : 'loudspeaker', kind],
    }),
  })
  if (!res.ok) throw new Error(`ntfy ${res.status}`)
}

async function requireAdminPin(body, env) {
  const pin = typeof body.pin === 'string' ? body.pin : ''
  if (!pin) throw Object.assign(new Error('PIN gerekli.'), { status: 401 })
  if (!env.ADMIN_PIN_HASH) throw Object.assign(new Error('Sunucu yapılandırması eksik.'), { status: 500 })
  const hash = await hashPassword(pin)
  if (hash !== env.ADMIN_PIN_HASH) {
    throw Object.assign(new Error('PIN hatalı.'), { status: 401 })
  }
}

async function handleNotify(request, env, origin) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Geçersiz istek.' }, 400, origin)
  }

  try {
    await requireAdminPin(body, env)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Yetkisiz' },
      error?.status || 401,
      origin,
    )
  }

  const kind = body.kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
  try {
    await sendNtfy(kind, {
      id: typeof body.id === 'string' ? body.id : undefined,
      title: typeof body.title === 'string' ? body.title : '',
      summary: typeof body.summary === 'string' ? body.summary : '',
      description: typeof body.description === 'string' ? body.description : '',
    })

    // Kapalı uygulamalar için Web Push (cron beklemeden)
    if (env.VAPID_PRIVATE_JWK && env.GITHUB_TOKEN) {
      const title = typeof body.title === 'string' ? body.title : 'Törnük Derneği'
      const summary =
        (typeof body.summary === 'string' && body.summary) ||
        (typeof body.description === 'string' && body.description) ||
        title
      const id = typeof body.id === 'string' ? body.id : undefined
      const tab = kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'
      const key = kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
      const store = await readPushSubs(env.GITHUB_TOKEN)
      if (store.subscriptions.length) {
        await broadcastWebPush(env, store.subscriptions, {
          title,
          body: summary,
          kind,
          id,
          url: `https://tornukdernek1.github.io/tornuk-dernegi/?tab=${tab}&r=${Date.now()}${
            id ? `&${key}=${encodeURIComponent(id)}` : ''
          }`,
        })
      }
    }

    return json({ ok: true }, 200, origin)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Bildirim başarısız' },
      502,
      origin,
    )
  }
}

function normalizeSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : ''
  const p256dh = raw.keys && typeof raw.keys.p256dh === 'string' ? raw.keys.p256dh : ''
  const auth = raw.keys && typeof raw.keys.auth === 'string' ? raw.keys.auth : ''
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return null
  if (endpoint.length > 2048 || p256dh.length > 256 || auth.length > 128) return null
  return { endpoint, keys: { p256dh, auth } }
}

async function readPushSubs(token) {
  try {
    const text = await readLiveFileFromGithub(token, 'push-subscriptions.json')
    const data = JSON.parse(text)
    return {
      updatedAt: data.updatedAt || new Date().toISOString(),
      subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
    }
  } catch {
    return { updatedAt: new Date().toISOString(), subscriptions: [] }
  }
}

async function writePushSubs(token, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`
  const message = `admin: push abonelik güncellendi (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`
  await commitFilesWithRetry(token, LIVE_BRANCH, [{ path: PUSH_SUBS_LIVE, content }], message)
  await commitFilesWithRetry(token, MAIN_BRANCH, [{ path: PUSH_SUBS_MAIN, content }], message)
}

async function handlePushSubscribe(request, env, origin) {
  if (!env.GITHUB_TOKEN) {
    return json({ ok: false, error: 'Sunucu yapılandırması eksik.' }, 500, origin)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Geçersiz istek.' }, 400, origin)
  }

  const sub = normalizeSubscription(body?.subscription || body)
  if (!sub) return json({ ok: false, error: 'Geçersiz abonelik.' }, 400, origin)

  try {
    const store = await readPushSubs(env.GITHUB_TOKEN)
    const without = store.subscriptions.filter((s) => s.endpoint !== sub.endpoint)
    without.unshift({
      ...sub,
      createdAt: new Date().toISOString(),
    })
    const next = {
      updatedAt: new Date().toISOString(),
      subscriptions: without.slice(0, MAX_PUSH_SUBS),
    }
    await writePushSubs(env.GITHUB_TOKEN, next)
    return json({ ok: true, count: next.subscriptions.length }, 200, origin)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Kayıt başarısız' },
      502,
      origin,
    )
  }
}

async function handlePushUnsubscribe(request, env, origin) {
  if (!env.GITHUB_TOKEN) {
    return json({ ok: false, error: 'Sunucu yapılandırması eksik.' }, 500, origin)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Geçersiz istek.' }, 400, origin)
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  if (!endpoint) return json({ ok: false, error: 'endpoint gerekli' }, 400, origin)

  try {
    const store = await readPushSubs(env.GITHUB_TOKEN)
    const next = {
      updatedAt: new Date().toISOString(),
      subscriptions: store.subscriptions.filter((s) => s.endpoint !== endpoint),
    }
    await writePushSubs(env.GITHUB_TOKEN, next)
    return json({ ok: true, count: next.subscriptions.length }, 200, origin)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Silme başarısız' },
      502,
      origin,
    )
  }
}

async function handlePublish(request, env, origin, ctx) {
  if (!env.GITHUB_TOKEN || !env.ADMIN_PIN_HASH) {
    return json({ ok: false, error: 'Sunucu yapılandırması eksik.' }, 500, origin)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Geçersiz istek.' }, 400, origin)
  }

  try {
    await requireAdminPin(body, env)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Yetkisiz' },
      error?.status || 401,
      origin,
    )
  }

  try {
    assertSafeFiles(body.files)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Geçersiz veri.' },
      400,
      origin,
    )
  }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const message = `admin: veri güncellendi (${stamp})`

  const mainFiles = body.files.map((file) => ({
    path: file.path,
    content: `${JSON.stringify(file.data, null, 2)}\n`,
  }))
  const liveFiles = body.files.map((file) => ({
    path: file.path.replace(/^public\//, ''),
    content: `${JSON.stringify(file.data, null, 2)}\n`,
  }))

  try {
    await commitFilesWithRetry(env.GITHUB_TOKEN, LIVE_BRANCH, liveFiles, message)
    await commitFilesWithRetry(env.GITHUB_TOKEN, MAIN_BRANCH, mainFiles, message)

    // Bellekte taze tut — üye uygulaması hemen görsün
    for (const file of liveFiles) {
      const name = file.path.split('/').pop()
      if (name && LIVE_FILES.has(name)) memoryLive.set(name, file.content)
    }

    return json({ ok: true }, 200, origin)
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Yayın başarısız.',
      },
      502,
      origin,
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname.startsWith('/live/')) {
      const fileName = url.pathname.replace(/^\/live\//, '')
      return handleLiveGet(env, origin, fileName)
    }

    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/publish')) {
      return handlePublish(request, env, origin, ctx)
    }

    if (request.method === 'POST' && url.pathname === '/notify') {
      return handleNotify(request, env, origin)
    }

    if (request.method === 'POST' && url.pathname === '/push/subscribe') {
      return handlePushSubscribe(request, env, origin)
    }

    if (request.method === 'POST' && url.pathname === '/push/unsubscribe') {
      return handlePushUnsubscribe(request, env, origin)
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'tornuk-publish' }, 200, origin)
    }

    return json({ ok: false, error: 'Not found' }, 404, origin)
  },

  /** Dakikada bir: yeni duyuru/etkinlik varsa kapalı uygulamalara Web Push */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runPushPoll(env))
  },
}

async function runPushPoll(env) {
  if (!env.GITHUB_TOKEN || !env.VAPID_PRIVATE_JWK) return

  const [duyuruText, etkinlikText, subsStore, state, outbox] = await Promise.all([
    readLiveFileFromGithub(env.GITHUB_TOKEN, 'duyurular.json').catch(() => null),
    readLiveFileFromGithub(env.GITHUB_TOKEN, 'etkinlikler.json').catch(() => null),
    readPushSubs(env.GITHUB_TOKEN),
    readPushState(env.GITHUB_TOKEN),
    readPushOutbox(env.GITHUB_TOKEN).catch(() => ({ items: [] })),
  ])

  if (!subsStore.subscriptions.length) return

  // 1) Admin’in yazdığı outbox — anlık kapalı-uygulama bildirimi
  if (outbox.items?.length) {
    const remaining = []
    for (const item of outbox.items) {
      const result = await broadcastWebPush(env, subsStore.subscriptions, {
        title: item.title,
        body: item.body || item.title,
        kind: item.kind === 'etkinlik' ? 'etkinlik' : 'duyuru',
        id: item.id,
        url: item.url,
      })
      if (!result.okCount) remaining.push(item)
    }
    await writePushOutbox(env.GITHUB_TOKEN, {
      updatedAt: new Date().toISOString(),
      items: remaining,
    })
  }

  let nextState = { ...state }
  let changed = false

  if (duyuruText) {
    const data = JSON.parse(duyuruText)
    const latest = data.items?.[0]
    if (latest?.id) {
      if (!state.lastDuyuruId) {
        // İlk kurulum: spam yok; son 10 dk içinde eklenmişse yine de gönder
        const age = Date.now() - (Date.parse(data.updatedAt || '') || 0)
        if (age >= 0 && age < 10 * 60 * 1000) {
          await broadcastWebPush(env, subsStore.subscriptions, {
            title: latest.title,
            body: latest.summary || latest.title,
            kind: 'duyuru',
            id: latest.id,
            url: `https://tornukdernek1.github.io/tornuk-dernegi/?tab=duyurular&r=${Date.now()}&duyuru=${encodeURIComponent(latest.id)}`,
          })
        }
        nextState.lastDuyuruId = latest.id
        changed = true
      } else if (state.lastDuyuruId !== latest.id) {
        const sent = await broadcastWebPush(env, subsStore.subscriptions, {
          title: latest.title,
          body: latest.summary || latest.title,
          kind: 'duyuru',
          id: latest.id,
          url: `https://tornukdernek1.github.io/tornuk-dernegi/?tab=duyurular&r=${Date.now()}&duyuru=${encodeURIComponent(latest.id)}`,
        })
        // Başarısızsa state ilerletme — sonraki cron tekrar dener
        if (sent.okCount > 0 || sent.attempted === 0) {
          nextState.lastDuyuruId = latest.id
          changed = true
        }
        nextState.lastDuyuruPush = {
          id: latest.id,
          ok: sent.okCount,
          fail: sent.failCount,
          at: new Date().toISOString(),
        }
        changed = true
      }
    }
  }

  if (etkinlikText) {
    const data = JSON.parse(etkinlikText)
    const latest = data.items?.[0]
    if (latest?.id) {
      if (!state.lastEtkinlikId) {
        const age = Date.now() - (Date.parse(data.updatedAt || '') || 0)
        if (age >= 0 && age < 10 * 60 * 1000) {
          const body =
            latest.description ||
            [latest.date, latest.time, latest.place].filter(Boolean).join(' · ') ||
            latest.title
          await broadcastWebPush(env, subsStore.subscriptions, {
            title: latest.title,
            body,
            kind: 'etkinlik',
            id: latest.id,
            url: `https://tornukdernek1.github.io/tornuk-dernegi/?tab=etkinlikler&r=${Date.now()}&etkinlik=${encodeURIComponent(latest.id)}`,
          })
        }
        nextState.lastEtkinlikId = latest.id
        changed = true
      } else if (state.lastEtkinlikId !== latest.id) {
        const body =
          latest.description ||
          [latest.date, latest.time, latest.place].filter(Boolean).join(' · ') ||
          latest.title
        const sent = await broadcastWebPush(env, subsStore.subscriptions, {
          title: latest.title,
          body,
          kind: 'etkinlik',
          id: latest.id,
          url: `https://tornukdernek1.github.io/tornuk-dernegi/?tab=etkinlikler&r=${Date.now()}&etkinlik=${encodeURIComponent(latest.id)}`,
        })
        if (sent.okCount > 0 || sent.attempted === 0) {
          nextState.lastEtkinlikId = latest.id
          changed = true
        }
        nextState.lastEtkinlikPush = {
          id: latest.id,
          ok: sent.okCount,
          fail: sent.failCount,
          at: new Date().toISOString(),
        }
        changed = true
      }
    }
  }

  if (changed) {
    nextState.updatedAt = new Date().toISOString()
    await writePushState(env.GITHUB_TOKEN, nextState)
  }
}

async function broadcastWebPush(env, subscriptions, payload) {
  const dead = []
  let okCount = 0
  let failCount = 0
  for (const sub of subscriptions) {
    try {
      const result = await sendOneWebPush(env, sub, payload)
      if (result.ok || result.status === 201) {
        okCount++
      } else if (result.status === 404 || result.status === 410 || result.status === 403) {
        dead.push(sub.endpoint)
        failCount++
      } else {
        failCount++
      }
    } catch {
      failCount++
    }
  }
  if (dead.length) {
    const next = {
      updatedAt: new Date().toISOString(),
      subscriptions: subscriptions.filter((s) => !dead.includes(s.endpoint)),
    }
    await writePushSubs(env.GITHUB_TOKEN, next)
  }
  return { okCount, failCount, attempted: subscriptions.length }
}

async function readPushOutbox(token) {
  try {
    const text = await readLiveFileFromGithub(token, 'push-outbox.json')
    const data = JSON.parse(text)
    return { updatedAt: data.updatedAt, items: Array.isArray(data.items) ? data.items : [] }
  } catch {
    return { updatedAt: new Date().toISOString(), items: [] }
  }
}

async function writePushOutbox(token, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`
  const message = `admin: push outbox flushed (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`
  await commitFilesWithRetry(token, LIVE_BRANCH, [{ path: 'data/push-outbox.json', content }], message)
  await commitFilesWithRetry(
    token,
    MAIN_BRANCH,
    [{ path: 'public/data/push-outbox.json', content }],
    message,
  )
}

async function readPushState(token) {
  try {
    const text = await readLiveFileFromGithub(token, 'push-state.json')
    return JSON.parse(text)
  } catch {
    return { lastDuyuruId: null, lastEtkinlikId: null }
  }
}

async function writePushState(token, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`
  const message = `admin: push state (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`
  await commitFilesWithRetry(token, LIVE_BRANCH, [{ path: 'data/push-state.json', content }], message)
  await commitFilesWithRetry(
    token,
    MAIN_BRANCH,
    [{ path: 'public/data/push-state.json', content }],
    message,
  )
}
