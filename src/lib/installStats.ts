const COUNTED_KEY = 'tornuk-install-counted-v2'
/** Abacus — tarayıcıdan CORS ile çalışır. Namespace yeni hesap için ayrı (eski sayaç 7’yi taşımasın). */
const HIT_URL = 'https://abacus.jasoncameron.dev/hit/tornukdernek1/app-installs'
const GET_URL = 'https://abacus.jasoncameron.dev/get/tornukdernek1/app-installs'

type CounterResponse = {
  value?: number | string
  count?: number | string
}

function readCount(data: CounterResponse): number {
  const raw = data.value ?? data.count
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

export async function getInstallCount(): Promise<number> {
  const res = await fetch(GET_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error('Sayaç okunamadı')
  return readCount((await res.json()) as CounterResponse)
}

export async function trackAppInstall(): Promise<number | null> {
  if (localStorage.getItem(COUNTED_KEY) === '1') return null

  try {
    const res = await fetch(HIT_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error('Sayaç artırılamadı')
    const count = readCount((await res.json()) as CounterResponse)
    localStorage.setItem(COUNTED_KEY, '1')
    return count
  } catch {
    // Başarısızsa işaretleme — bir sonraki açılışta tekrar denensin
    return null
  }
}

export function wasInstallCounted(): boolean {
  return localStorage.getItem(COUNTED_KEY) === '1'
}
