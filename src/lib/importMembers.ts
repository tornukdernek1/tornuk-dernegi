import { normalizeHistory, totalDebtFromHistory } from './aidatHistory'
import { hashTc } from './hash'
import { isValidTc, normalizeTc } from './tc'
import type { MemberRecord, YearAidat, YearAidatStatus } from '../types'

export type ImportRowError = { row: number; message: string }

export type ImportPreview = {
  members: MemberRecord[]
  errors: ImportRowError[]
  fileName: string
  totalRows: number
}

const HEADER_MAP: Record<string, string> = {
  tc: 'tc',
  tckn: 'tc',
  tc_kimlik: 'tc',
  tc_kimlik_no: 'tc',
  kimlik_no: 'tc',
  kimlik: 'tc',
  ad_soyad: 'ad_soyad',
  adsoyad: 'ad_soyad',
  ad: 'ad_soyad',
  isim: 'ad_soyad',
  ad_soyadı: 'ad_soyad',
  borc_tutari: 'borc_tutari',
  borc: 'borc_tutari',
  tutar: 'borc_tutari',
  borç_tutarı: 'borc_tutari',
  borclu_aylar: 'borclu_aylar',
  borçlu_aylar: 'borclu_aylar',
  aylar: 'borclu_aylar',
  son_odeme: 'son_odeme',
  son_ödeme: 'son_odeme',
  sonodeme: 'son_odeme',
  not: 'not',
  notlar: 'not',
  aciklama: 'not',
  açıklama: 'not',
  yil_gecmis: 'yil_gecmis',
  yıl_geçmiş: 'yil_gecmis',
  yillik: 'yil_gecmis',
  yıllık: 'yil_gecmis',
  gecmis: 'yil_gecmis',
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, '_')
    .replace(/[^\wçğıöşü]/gi, '')
}

function cell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number') {
    // Excel TC'yi bilimsel/number yazarsa düzelt
    if (Number.isInteger(value) && String(value).length >= 10) {
      return String(Math.trunc(value))
    }
    return String(value)
  }
  return String(value).trim()
}

function parseYearHistory(raw: string, debtAmount: number): YearAidat[] {
  if (!raw) return []
  return raw
    .split(';')
    .map((part) => {
      const [yearRaw, statusRaw, amountRaw] = part.split(':').map((x) => x.trim())
      const status: YearAidatStatus = statusRaw === 'borclu' ? 'borclu' : 'odendi'
      return {
        year: Number(yearRaw),
        status,
        debtAmount:
          status === 'borclu'
            ? Number(String(amountRaw || debtAmount).replace(',', '.')) || 0
            : 0,
        note: '',
      }
    })
    .filter((y) => y.year >= 2000)
}

function buildYearHistory(
  debtMonths: string[],
  debtAmount: number,
  monthlyFee: number,
  rawHistory: string,
): YearAidat[] {
  if (rawHistory) {
    return normalizeHistory(parseYearHistory(rawHistory, debtAmount))
  }

  const currentYear = new Date().getFullYear()
  const byYear = new Map<number, number>()
  for (const month of debtMonths) {
    const y = Number(month.slice(0, 4))
    if (y) byYear.set(y, (byYear.get(y) || 0) + 1)
  }

  const history: YearAidat[] = []
  for (const [year, count] of byYear) {
    history.push({
      year,
      status: 'borclu',
      debtAmount: count * monthlyFee,
      note: `${count} aylık borç`,
    })
  }
  for (let y = currentYear - 1; y >= currentYear - 2; y -= 1) {
    if (!history.some((h) => h.year === y)) {
      history.push({ year: y, status: 'odendi', debtAmount: 0, note: '' })
    }
  }
  if (history.length === 0) {
    history.push({
      year: currentYear,
      status: debtAmount > 0 ? 'borclu' : 'odendi',
      debtAmount,
      note: '',
    })
  }
  return normalizeHistory(history)
}

function excelDateToIso(
  value: unknown,
  parseDateCode?: (v: number) => { y: number; m: number; d: number } | null,
): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    const parsed = parseDateCode?.(value)
    if (!parsed) return null
    const mm = String(parsed.m).padStart(2, '0')
    const dd = String(parsed.d).padStart(2, '0')
    return `${parsed.y}-${mm}-${dd}`
  }
  const text = cell(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const tr = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (tr) {
    return `${tr[3]}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`
  }
  return text || null
}

export async function parseMembersFile(
  file: File,
  monthlyFee: number,
): Promise<ImportPreview> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })

  if (rows.length === 0) {
    throw new Error('Dosyada veri satırı bulunamadı.')
  }

  const sampleKeys = Object.keys(rows[0] ?? {})
  const mappedHeaders = sampleKeys.map((k) => HEADER_MAP[normalizeHeader(k)]).filter(Boolean)
  if (!mappedHeaders.includes('tc') || !mappedHeaders.includes('ad_soyad')) {
    throw new Error(
      'Dosyada zorunlu sütunlar yok. En azından tc ve ad_soyad (veya ad soyad) sütunları olmalı.',
    )
  }

  const members: MemberRecord[] = []
  const errors: ImportRowError[] = []
  const seen = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    const row: Record<string, string> = {}
    let rawSonOdeme: unknown = ''
    for (const [key, value] of Object.entries(raw)) {
      const mapped = HEADER_MAP[normalizeHeader(key)]
      if (!mapped) continue
      row[mapped] = cell(value)
      if (mapped === 'son_odeme') rawSonOdeme = value
    }

    // Boş satırları atla
    if (!row.tc && !row.ad_soyad) continue

    const rowNo = i + 2
    let tc = normalizeTc(row.tc)
    // Excel bazen baştaki 0'ı düşürür; 10 haneli ise yine de dene
    if (tc.length === 10) tc = `0${tc}`

    if (!isValidTc(tc)) {
      errors.push({ row: rowNo, message: `Geçersiz T.C. kimlik no: ${row.tc || '(boş)'}` })
      continue
    }
    if (!row.ad_soyad?.trim()) {
      errors.push({ row: rowNo, message: 'Ad soyad boş.' })
      continue
    }

    const idHash = await hashTc(tc)
    if (seen.has(idHash)) {
      errors.push({ row: rowNo, message: `Tekrarlayan T.C.: ${tc}` })
      continue
    }
    seen.add(idHash)

    const debtAmount = Number(String(row.borc_tutari || '0').replace(',', '.')) || 0
    const debtMonths = (row.borclu_aylar || '')
      .split(/[;|]/)
      .map((m) => m.trim())
      .filter((m) => /^\d{4}-\d{2}$/.test(m))

    const yearHistory = buildYearHistory(
      debtMonths,
      debtAmount,
      monthlyFee,
      row.yil_gecmis || '',
    )

    members.push({
      idHash,
      tc,
      displayName: String(row.ad_soyad || '')
        .trim()
        .replace(/\s+/g, ' '),
      debtAmount: totalDebtFromHistory(yearHistory) || debtAmount,
      debtMonths,
      lastPayment: excelDateToIso(rawSonOdeme, (v) => XLSX.SSF.parse_date_code(v)),
      notes: row.not || '',
      yearHistory,
    })
  }

  return {
    members,
    errors,
    fileName: file.name,
    totalRows: rows.length,
  }
}

export const IMPORT_TEMPLATE_CSV = `tc,ad_soyad,borc_tutari,borclu_aylar,son_odeme,not,yil_gecmis
10000000146,Ahmet Yılmaz,300,2026-05;2026-06;2026-07,2026-04-10,,2026:borclu:300;2025:odendi;2024:odendi
12345678950,Ayşe Demir,0,,,Güncel,2026:odendi;2025:odendi;2024:odendi
23456789060,Mehmet Kaya,200,2026-06;2026-07,2026-05-15,İki aylık borç,2026:borclu:200;2025:odendi;2024:odendi
`

export function downloadImportTemplate() {
  const blob = new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'tornuk-uye-sablon.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function mergeMembers(
  existing: MemberRecord[],
  incoming: MemberRecord[],
): MemberRecord[] {
  const map = new Map(existing.map((m) => [m.idHash, m]))
  for (const member of incoming) {
    map.set(member.idHash, member)
  }
  return [...map.values()]
}
