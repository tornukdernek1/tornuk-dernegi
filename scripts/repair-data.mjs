import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OWNER = 'tornukdernek1'
const REPO = 'tornuk-dernegi'

const MUTABLE = ['uyeler.json', 'duyurular.json', 'etkinlikler.json']
const STATIC = ['admin.json', 'bridge.json', 'dernek.json']
const ALL = [...MUTABLE, ...STATIC]

function ghContent(path, branch) {
  const b64 = execFileSync(
    'gh',
    ['api', `repos/${OWNER}/${REPO}/contents/${path}?ref=${branch}`, '--jq', '.content'],
    { encoding: 'utf8' },
  ).replace(/\s+/g, '')
  return Buffer.from(b64, 'base64').toString('utf8')
}

function ghPut(path, branch, content, message, sha) {
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
  }
  if (sha) body.sha = sha
  const args = [
    'api',
    '--method',
    'PUT',
    `repos/${OWNER}/${REPO}/contents/${path}`,
    '-f',
    `message=${message}`,
    '-f',
    `content=${body.content}`,
    '-f',
    `branch=${branch}`,
  ]
  if (sha) args.push('-f', `sha=${sha}`)
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function ghSha(path, branch) {
  try {
    return execFileSync(
      'gh',
      ['api', `repos/${OWNER}/${REPO}/contents/${path}?ref=${branch}`, '--jq', '.sha'],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    return null
  }
}

function summarize(txt) {
  const j = JSON.parse(txt)
  if (Array.isArray(j.items)) {
    return {
      n: j.items.length,
      at: j.updatedAt || '-',
      sample: j.items.slice(0, 3).map((x) => x.title).join(' | '),
    }
  }
  if (Array.isArray(j.members)) {
    return {
      n: j.members.length,
      at: j.updatedAt || '-',
      sample: j.members.slice(0, 3).map((x) => x.displayName).join(' | '),
    }
  }
  return { n: 'obj', at: j.updatedAt || '-', sample: Object.keys(j).slice(0, 4).join(',') }
}

const mode = process.argv[2] || 'audit'

console.log(`\n=== DATA ${mode.toUpperCase()} ===\n`)

const report = []
for (const name of ALL) {
  const mainPath = `public/data/${name}`
  const livePath = `data/${name}`
  const localPath = join(process.cwd(), 'public', 'data', name)

  let mainTxt = ''
  let liveTxt = ''
  let localTxt = ''
  try {
    mainTxt = ghContent(mainPath, 'main')
  } catch {
    mainTxt = ''
  }
  try {
    liveTxt = ghContent(livePath, 'gh-pages')
  } catch {
    liveTxt = ''
  }
  if (existsSync(localPath)) localTxt = readFileSync(localPath, 'utf8')

  const sm = mainTxt ? summarize(mainTxt) : { n: 'MISSING', at: '-', sample: '' }
  const sl = liveTxt ? summarize(liveTxt) : { n: 'MISSING', at: '-', sample: '' }
  const so = localTxt ? summarize(localTxt) : { n: 'MISSING', at: '-', sample: '' }

  console.log(name)
  console.log(`  main     ${String(sm.n).padStart(4)}  ${sm.at}  ${sm.sample}`)
  console.log(`  gh-pages ${String(sl.n).padStart(4)}  ${sl.at}  ${sl.sample}`)
  console.log(`  local    ${String(so.n).padStart(4)}  ${so.at}  ${so.sample}`)
  console.log(`  match    main==live:${mainTxt === liveTxt}  live==local:${liveTxt === localTxt}`)

  report.push({ name, mainTxt, liveTxt, localTxt, mainPath, livePath, localPath })
}

if (mode === 'audit') {
  const bad = report.filter((r) => r.liveTxt && (r.mainTxt !== r.liveTxt || r.localTxt !== r.liveTxt))
  if (bad.length) {
    console.log(`\n${bad.length} dosya tutarsız. Düzeltmek için: node scripts/repair-data.mjs fix\n`)
    process.exitCode = 2
  } else {
    console.log('\nTüm veri dosyaları tutarlı.\n')
  }
  process.exit()
}

if (mode !== 'fix') {
  console.error('Kullanım: node scripts/repair-data.mjs [audit|fix]')
  process.exit(1)
}

/**
 * Kaynak: gh-pages (canlı site).
 * Hedef: main/public/data + local public/data + dist/data
 * Mutable dosyalar her zaman canlıdan gelir.
 * Static dosyalar canlıda yoksa local'den main'e yazılır.
 */
const distData = join(process.cwd(), 'dist', 'data')
if (!existsSync(distData)) mkdirSync(distData, { recursive: true })

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
const message = `chore: sync data from live (${stamp})`

for (const row of report) {
  let source = row.liveTxt
  if (!source) {
    source = row.localTxt || row.mainTxt
    if (!source) {
      console.warn(`skip ${row.name}: nowhere to copy from`)
      continue
    }
    console.log(`warn ${row.name}: gh-pages missing, using fallback`)
  }

  const out = source.endsWith('\n') ? source : `${source}\n`

  // local
  writeFileSync(row.localPath, out)
  // dist (if present)
  writeFileSync(join(distData, row.name), out)

  // main branch if different
  if (row.mainTxt !== out && row.mainTxt !== source) {
    const sha = ghSha(row.mainPath, 'main')
    console.log(`fix main ${row.name}`)
    ghPut(row.mainPath, 'main', out, message, sha)
  } else {
    console.log(`ok   main ${row.name}`)
  }

  // ensure gh-pages has it (if was missing)
  if (!row.liveTxt) {
    const sha = ghSha(row.livePath, 'gh-pages')
    console.log(`fix live ${row.name}`)
    ghPut(row.livePath, 'gh-pages', out, message, sha)
  } else {
    console.log(`ok   live ${row.name}`)
  }
}

console.log('\nRepair complete. Live (gh-pages) is source of truth.\n')
