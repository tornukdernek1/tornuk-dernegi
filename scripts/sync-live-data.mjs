/**
 * Deploy öncesi: gh-pages'teki canlı JSON'u dist + public'e çeker.
 * Böylece site deploy'u admin verilerini ezmez.
 *
 * Ayrıca dernek.json gibi statik dosyaları da senkron tutar.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OWNER = 'tornukdernek1'
const REPO = 'tornuk-dernegi'
const FILES = [
  'uyeler.json',
  'duyurular.json',
  'etkinlikler.json',
  'admin.json',
  'bridge.json',
  'dernek.json',
  'vapid.json',
  'vapid-seal.json',
  'push-subscriptions.json',
  'push-outbox.json',
]

const distData = join(process.cwd(), 'dist', 'data')
const publicData = join(process.cwd(), 'public', 'data')
if (!existsSync(distData)) mkdirSync(distData, { recursive: true })

function readLive(name) {
  const b64 = execFileSync(
    'gh',
    ['api', `repos/${OWNER}/${REPO}/contents/data/${name}?ref=gh-pages`, '--jq', '.content'],
    { encoding: 'utf8' },
  ).replace(/\s+/g, '')
  return Buffer.from(b64, 'base64').toString('utf8')
}

let ok = 0
for (const name of FILES) {
  try {
    const text = readLive(name)
    const out = text.endsWith('\n') ? text : `${text}\n`
    writeFileSync(join(distData, name), out)
    writeFileSync(join(publicData, name), out)
    console.log(`synced ${name}`)
    ok++
  } catch (error) {
    console.warn(`skip ${name}:`, error instanceof Error ? error.message : error)
  }
}

if (ok < 3) {
  console.error('Kritik: canlı veri senkronu başarısız. Deploy iptal.')
  process.exit(1)
}
