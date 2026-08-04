/**
 * gh-pages / main veri değişince Web Push gönderir.
 * Kullanım: node scripts/send-web-push.mjs duyurular|etkinlikler
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import webpush from 'web-push'

const kindArg = process.argv[2] === 'etkinlikler' ? 'etkinlikler' : 'duyurular'
const fileMain = `public/data/${kindArg}.json`
const fileLive = `data/${kindArg}.json`
const file = existsSync(fileMain) ? fileMain : fileLive
const subsPath = existsSync('public/data/push-subscriptions.json')
  ? 'public/data/push-subscriptions.json'
  : 'data/push-subscriptions.json'

const publicKey = process.env.VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
const subject = process.env.VAPID_SUBJECT || 'mailto:tornuk-dernegi@users.noreply.github.com'

if (!publicKey || !privateKey) {
  console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY eksik')
  process.exit(1)
}

webpush.setVapidDetails(subject, publicKey, privateKey)

function readJson(path) {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readPrevJson(path) {
  try {
    const raw = execSync(`git show HEAD^:${path}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const current = readJson(file)
if (!current?.items?.[0]) {
  console.log('Liste boş, bildirim yok.')
  process.exit(0)
}

const prev = readPrevJson(file)
const latest = current.items[0]
const prevId = prev?.items?.[0]?.id

if (prevId && prevId === latest.id) {
  console.log(`items[0] aynı (${latest.id}), Web Push atlandı.`)
  process.exit(0)
}

const subsFile = readJson(subsPath)
const subscriptions = Array.isArray(subsFile?.subscriptions) ? subsFile.subscriptions : []
if (!subscriptions.length) {
  console.log('Kayıtlı abonelik yok. Üyeler Menü → Bildirimler açıkken abone olur.')
  process.exit(0)
}

const isEtkinlik = kindArg === 'etkinlikler'
const tab = isEtkinlik ? 'etkinlikler' : 'duyurular'
const bodyText =
  (isEtkinlik
    ? latest.description || [latest.date, latest.time, latest.place].filter(Boolean).join(' · ')
    : latest.summary) || latest.title

const payload = JSON.stringify({
  title: latest.title,
  body: bodyText,
  kind: isEtkinlik ? 'etkinlik' : 'duyuru',
  id: latest.id,
  url: `https://tornukdernek1.github.io/tornuk-dernegi/?tab=${tab}&r=${Date.now()}&${
    isEtkinlik ? 'etkinlik' : 'duyuru'
  }=${encodeURIComponent(latest.id)}`,
})

let ok = 0
let fail = 0
const dead = []

for (const sub of subscriptions) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) continue
  try {
    await webpush.sendNotification(sub, payload, {
      TTL: 60 * 60 * 24,
      urgency: 'high',
      topic: isEtkinlik ? 'etkinlik' : 'duyuru',
    })
    ok++
  } catch (error) {
    fail++
    const status = error?.statusCode
    if (status === 404 || status === 410) dead.push(sub.endpoint)
    console.warn('push fail', status || error?.message)
  }
}

console.log(`Web Push: ok=${ok} fail=${fail} dead=${dead.length}`)

if (dead.length) {
  const next = {
    updatedAt: new Date().toISOString(),
    subscriptions: subscriptions.filter((s) => !dead.includes(s.endpoint)),
  }
  writeFileSync(subsPath, `${JSON.stringify(next, null, 2)}\n`)
  try {
    execSync('git config user.name "tornuk-webpush"')
    execSync('git config user.email "tornuk-webpush@users.noreply.github.com"')
    execSync(`git add ${subsPath}`)
    execSync('git diff --cached --quiet || git commit -m "chore: remove expired push subscriptions"')
    execSync('git push')
  } catch (e) {
    console.warn('abonelik temizliği commit edilemedi', e?.message || e)
  }
}
