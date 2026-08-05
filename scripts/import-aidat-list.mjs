/**
 * Aidat listesini uyeler.json'a çevirir ve GitHub'a yazar.
 * Kullanım: node scripts/import-aidat-list.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const YEARLY_FEE = 1000
const SALT = 'tornuk-dernegi-aidat-v1'

/** Ham liste: No/TC, Ad Soyad, 2025, 2026 (tab veya çoklu boşluk) */
const RAW = `
42619260796	Alim Aksoy	1000	 
2	Erdem  Alim	 	 
31546629646	Zeki  Aslan	1000	 
4	Engin  Ata	 	 
5	Yücel Babayiğit	 	 
6	Kadir  Bayrak	 	 
23971882178	Mustafa  Boz	1300	1000
8	Ali Boz	1300	 
9	Murat  Boz	1000	1000
10	Mehmet Boz	1000	 
11	Özcan Boz	1000	 
23947882980	Ulvi Boz	1000	 
13	Bayram Boz	 	 
27082778450	Recep Civelek	1500	500
27046779608	Yücel Civelek	1000	1000
16	İlhan Civelek	 	 
24979848562	Alim Çak	2000	1000
26143809744	Harun Çak	1300	 
24970848844	Dursun Çak	1300	2000
25711824134	Yasin Çak	1300	1000
26089811566	Mümin Çak	1000	1000
22	Mustafa Çak	1000	1000
25798821248	Özcan Çak	1000	1000
24955849354	Tayfun Çak	1000	1000
25834820068	Yalçın Çak	1000	1000
24973848780	Selami Çak	1000	 
27	Burhan Çak	1000	 
28	Bahri Çak	1000	 
26098811274	Muhammet Çak	800	 
30	Numan  Çak	 	 
31	Mutlu Çak	 	 
32	Sevim  Çak	 	 
33	Selçuk  Çak	 	 
25792821466	Mete Çak	 	 
35	Nurettin Çak	 	 
26551796124	Ersin Çakar	2000	1000
26554796060	Ercan Çakar	1300	1000
26563795788	Necmettin Çakar	1000	 
39	Soner Çakar	1000	 
40	Taner Çakar	700	 
41	Coşkun  Çakar	 	 
42	Bahattin Çakar	 	 
43	Zekayi Germiç	 	 
44	Muzaffer Güldalı	 	 
31213640752	Adem Gündoğdu	1000	1000
25258839226	Alim  İleri	1000	 
64486151588	Mehmet-Mustafa İleri	1000	1000
48	Nihat  İleri	 	 
49	Metin İleri	1000	1000
28924717088	Erdal Kara	3300	 
28921717142	Mustafa (Ali) Kara	2300	1000
52	Salih Kara	2300	500
53	Hakkı  Kara	1500	1500
29053712784	Mustafa (Mehmet) Kara	1300	 
28939716588	Selami Kara	1300	1000
27691758140	Hamza Kara	1000	1000
57	Mesut Kara	1000	 
27673758724	Ali Kara	1000	1000
28894718030	Bünyamin Kara	1000	1000
60	Eyüp  Kara	1000	 
61	Hüseyin Kara	1000	 
28909717508	Mahmut Kara	1000	2000
28906717662	Cemil  Kara	1000	 
28546729698	Nazmi Karahan	1300	1000
65	Zaim Karahan	 	 
29227706960	Ergün Kaval	1300	1000
29191708120	Engin  Kaval	1000	 
29206707698	Mücahit Kaval	1000	 
29203707752	Burhan Kaval	1000	 
24847852998	Osman (Mevlüt) Kaya	1300	1000
71	Nadi  Kaya	1300	1200
72	Osman (Ali) Kaya	1300	 
73	Murat Kaya	1300	 
74	Muhittin Kaya	1000	1000
24478865206	İbrahim  Kaya	1000	1000
76	Yahya Kaya	1000	 
77	Mustafa Kaya	1000	 
24493864796	Ruhi  Kaya	1000	1000
79	Hamza Kaya	1000	 
80	Rıdvan Kengil	1300	 
27205774352	Aşkın Kozlu	1300	1000
27190774894	Muammer Kozlu	1300	 
83	Soner Kozlu	1000	 
27382768496	Nadi  Kozlu	1000	 
85	Yasin Kozlu	 	 
86	Eftal Kozlu	 	 
87	Habil Kozlu	 	 
88	Şenol Kutlu	1000	 
27943749780	Hakan Mendeş	1000	 
90	Hasan  Mendeş	 	 
32137609900	Mustafa  Meral	1000	 
41737290104	Muammer Meral	 	 
93	Mehmet Narin	1000	 
94	Hasan  Sarı	1300	 
43912402432	Cabir Soylu	1000	 
96	Murat Soylu	1000	 
97	Zeki  Soylu	 	 
98	Cengiz  Soylu	 	 
99	Ahmet  Soylu	 	 
24040879846	Faruk Şahin	1000	1000
24034880032	Turgut Şahin	1000	 
24016880616	Oğuzhan Şahin	 	 
103	Erdoğan Şahin	 	 
104	Recep Şayık	500	 
30250672870	Yahya Tanoğlu	1000	 
106	Ayhan  Tanoğlu	 	 
107	Mustafa(Salim) Temel	1500	1000
108	Bülent Temel	1300	1000
29485698304	Cemil(Salim) Temel	1300	1000
29839686506	Muhammed Temel	1300	 
111	Tahsin Temel	1300	1000
29596694684	Recai Temel	1300	1000
29815687398	Bahtiyar (Salim) Temel	1300	1000
29902684460	Adnan Temel	1000	1000
29512697416	Ünal Temel	1000	 
116	Yavuz Temel	1000	 
29932683440	Cemil(Mustafa) Temel	1000	1000
118	Ruhi Temel	1000	 
29500697862	Yücel Temel	 	 
29842686432	Bahtiyar(Halil) Temel	 	 
121	Yusuf  Temel	 	 
122	Tunahan Temel	 	 
123	Zekeriya  Temel	 	 
29896684620	Mustafa  Temel	 	 
125	Atakan Temel	 	 
126	Sait  Temel	 	 
127	İlyas Temel	 	 
128	Salim Ten	2300	 
129	Sabri Ten	1500	 
130	Hakkı  Ten	1300	 
30715657374	Sinan  Ten	1300	 
30751656126	Esat  Ten	1300	1000
30604661062	Yıldıray Ten	1000	1000
30760655844	Yücel Ten	1000	1000
38275405510	Kudret Ten	1000	1000
136	Osman Ten	1000	 
30691658198	Ramazan Ten	1000	1000
30718657210	Coşkun  Ten	1000	 
30412667492	Muhammed (Sabri) Ten	1000	 
140	Muhammet (Hoca) Ten	1000	 
24986069486	Servet  Ten	500	1000
30754656062	Recep Ali Ten	 	 
143	Mehmet Akif Ten	 	 
144	Murat Ten	 	 
31360635816	Abdurrahman Topar	1000	 
29389701582	Celal Topar	1000	 
147	Salih Tuncer	2000	 
64501151036	Mustafa Tuncer	1000	 
149	Osman Tuncer	 	 
28147742904	Yusuf -Bayram Uzun	3600	2000
28252739424	Orhan  Uzun	1500	1000
28228740294	Yener Uzun	1300	1000
28330736888	Ali  Uzun	1300	1000
154	Erdem  Uzun	1300	1000
155	Şenol Uzun	1300	1000
28117743924	Yunus Uzun	1300	 
28225740358	Yücel Uzun	1300	1000
28315737398	Şaban Uzun	1300	 
159	Hikmet Uzun	1000	1000
160	Fikret Uzun	1000	1000
28213740704	Cengiz  Uzun	1000	 
28174742038	Mustafa (İsmail) Uzun	1000	1000
28099744520	Rasim  Uzun	1000	1000
28210740868	Nedim Uzun	1000	 
28201741140	Murat Uzun	1000	1000
28204741086	Adem Uzun	1000	 
28318737234	Süleyman  Uzun	1000	1000
168	Mutlu Uzun	1000	 
28054746040	Eren Uzun	1000	 
170	Suat Uzun	1000	1000
171	Osman  Uzun	 	 
172	Habibullah  Uzun	 	 
173	Saffet Uzun	 	 
26737789964	Emre Ünlü	1300	 
26863785724	Mutlu Ünlü	1300	1000
26821787180	Anıl Ünlü	1300	1000
32575595506	Özgür  Ünlü	1000	1000
178	Kenan Yayla	1500	1000
25564829034	Harun Yayla	1300	1000
180	Adnan Yayla	1000	 
181	Murat Yayla	1000	 
182	Lokman Yayla	1000	1000
25495831366	Turgut Yayla	1000	 
184	Selim Yayla	1000	1000
25474832094	Naim Yayla	1000	 
25489831594	İsa Yayla	1000	1000
65404120990	İsmail Yayla	1000	1000
188	Süleyman Yayla	 	 
189	Beytullah Yayla	 	 
190	Mustafa  Yayla	 	 
191	Suat Yayla	 	 
`.trim()

function hashTc(tc) {
  return createHash('sha256').update(`${SALT}:${tc.trim()}`).digest('hex')
}

function isValidTc(raw) {
  const tc = String(raw).trim()
  if (!/^\d{11}$/.test(tc) || tc[0] === '0') return false
  const d = tc.split('').map(Number)
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8]
  const evenSum = d[1] + d[3] + d[5] + d[7]
  const check10 = (((oddSum * 7 - evenSum) % 10) + 10) % 10
  if (check10 !== d[9]) return false
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10]
}

function normalizePersonName(fullName) {
  return String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function yearStatus(paidRaw) {
  const paid = paidRaw === '' || paidRaw == null ? 0 : Number(paidRaw)
  if (!Number.isFinite(paid)) {
    return { status: 'borclu', debtAmount: YEARLY_FEE, paid: 0 }
  }
  if (paid >= YEARLY_FEE) {
    return { status: 'odendi', debtAmount: 0, paid }
  }
  return {
    status: 'borclu',
    debtAmount: Math.max(0, YEARLY_FEE - paid),
    paid,
  }
}

function parseAmount(raw) {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (!s) return ''
  const n = Number(s)
  return Number.isFinite(n) ? n : ''
}

function parseRows() {
  const members = []
  const warnings = []
  let rowNo = 0

  for (const line of RAW.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    rowNo += 1

    // TC/No \t Name \t 2025 \t 2026  — bazı satırlarda tab yerine boşluk olabilir
    let parts = trimmed.split('\t').map((x) => x.trim())
    if (parts.length < 2) {
      // fallback: ilk token no/tc, son iki sayı tutar olabilir
      const tokens = trimmed.split(/\s{2,}|\t/).map((x) => x.trim()).filter(Boolean)
      parts = tokens
    }

    const idRaw = parts[0] ?? ''
    // Name is everything between id and last two amount columns
    let name
    let y2025
    let y2026

    if (parts.length >= 4) {
      name = parts.slice(1, -2).join(' ').replace(/\s+/g, ' ').trim()
      y2025 = parseAmount(parts[parts.length - 2])
      y2026 = parseAmount(parts[parts.length - 1])
    } else if (parts.length === 3) {
      name = parts[1].replace(/\s+/g, ' ').trim()
      y2025 = parseAmount(parts[2])
      y2026 = ''
    } else if (parts.length === 2) {
      name = parts[1].replace(/\s+/g, ' ').trim()
      y2025 = ''
      y2026 = ''
    } else {
      warnings.push(`Satır ${rowNo}: parse edilemedi → ${trimmed}`)
      continue
    }

    if (!name) {
      warnings.push(`Satır ${rowNo}: isim yok`)
      continue
    }

    const s2025 = yearStatus(y2025)
    const s2026 = yearStatus(y2026)
    const yearHistory = [
      {
        year: 2026,
        status: s2026.status,
        debtAmount: s2026.debtAmount,
        note: s2026.paid ? `Ödenen: ${s2026.paid} ₺` : '',
      },
      {
        year: 2025,
        status: s2025.status,
        debtAmount: s2025.debtAmount,
        note: s2025.paid ? `Ödenen: ${s2025.paid} ₺` : '',
      },
    ]
    const debtAmount = yearHistory.reduce((s, y) => s + (y.status === 'borclu' ? y.debtAmount : 0), 0)

    let idHash
    let notes = ''
    let tc = ''
    if (/^\d{11}$/.test(idRaw)) {
      tc = idRaw
      idHash = hashTc(idRaw)
    } else {
      // Sıra no — TC yok; listede görünsün ama TC ile sorgulanamaz
      idHash = hashTc(`NO-TC:${idRaw}:${name}`)
      notes = 'TC girilmedi — aidat sorgusu için TC eklenmeli'
      warnings.push(`TC yok (sıra ${idRaw}): ${name}`)
    }

    members.push({
      idHash,
      tc,
      displayName: name,
      debtAmount,
      debtMonths: [],
      lastPayment: s2025.status === 'odendi' || s2026.status === 'odendi' ? '2026-01-01' : null,
      notes,
      yearHistory,
      _fullName: name,
    })
  }

  return { members, warnings }
}

function toBase64Utf8(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

async function putFile(token, branch, path, content, message) {
  const base = `https://api.github.com/repos/tornukdernek1/tornuk-dernegi/contents/${path}`
  let sha
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (getRes.ok) {
    const existing = await getRes.json()
    sha = existing.sha
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub okuma ${getRes.status}: ${await getRes.text()}`)
  }

  const putRes = await fetch(base, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: toBase64Utf8(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!putRes.ok) {
    throw new Error(`GitHub yazma ${putRes.status}: ${await putRes.text()}`)
  }
}

const { members, warnings } = parseRows()
const nameByHash = new Map(members.map((m) => [m.idHash, m.displayName]))
const freshByHash = new Map(members.map((m) => [m.idHash, m]))

const outPath = join(ROOT, 'public', 'data', 'uyeler.json')
let payload
try {
  const existing = JSON.parse(readFileSync(outPath, 'utf8'))
  payload = {
    ...existing,
    associationName: existing.associationName || 'Törnük Derneği',
    updatedAt: new Date().toISOString(),
    monthlyFee: YEARLY_FEE,
    currency: existing.currency || 'TRY',
    members: existing.members.map((m) => {
      const fresh = freshByHash.get(m.idHash)
      const fullName = nameByHash.get(m.idHash)
      if (!fresh && !fullName) return m
      return {
        ...m,
        displayName: fullName || m.displayName,
        // TC yoksa listedeki TC’yi al; adminde girilmiş TC’yi koru
        tc: m.tc || fresh?.tc || '',
      }
    }),
  }
} catch {
  payload = {
    associationName: 'Törnük Derneği',
    updatedAt: new Date().toISOString(),
    monthlyFee: YEARLY_FEE,
    currency: 'TRY',
    members: members.map(({ _fullName, ...m }) => m),
  }
}

const json = `${JSON.stringify(payload, null, 2)}\n`
writeFileSync(outPath, json, 'utf8')

const withTc = payload.members.filter((m) => m.tc).length
const withoutTc = payload.members.length - withTc
const odendi2025 = payload.members.filter((m) => m.yearHistory?.find((y) => y.year === 2025)?.status === 'odendi').length
const odendi2026 = payload.members.filter((m) => m.yearHistory?.find((y) => y.year === 2026)?.status === 'odendi').length

console.log(`Üye: ${payload.members.length} (TC’li: ${withTc}, TC’siz: ${withoutTc})`)
console.log(`2025 ödendi: ${odendi2025} | 2026 ödendi: ${odendi2026}`)
console.log(`Örnek isim: ${payload.members[0]?.displayName}`)
console.log(`Uyarı: ${warnings.length}`)
for (const w of warnings.slice(0, 30)) console.log(' -', w)
if (warnings.length > 30) console.log(` ... +${warnings.length - 30} uyarı`)

const token = execSync('gh auth token', { encoding: 'utf8' }).trim()
const message = `admin: üye soyisimleri tam gösterilecek şekilde güncellendi`
await putFile(token, 'gh-pages', 'data/uyeler.json', json, message)
await putFile(token, 'main', 'public/data/uyeler.json', json, message)
console.log('Canlıya yazıldı: gh-pages + main')
