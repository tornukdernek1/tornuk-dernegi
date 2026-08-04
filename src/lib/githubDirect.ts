import { toBase64Utf8 } from './download'
import type { AdminDataFile } from './githubSave'
import { GITHUB_OWNER, GITHUB_REPO } from './siteConfig'

const OWNER = GITHUB_OWNER
const REPO = GITHUB_REPO

function headers(token: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function putFile(
  token: string,
  branch: string,
  path: string,
  content: string,
  message: string,
) {
  const base = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`
  let sha: string | undefined
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`, {
    headers: headers(token),
  })
  if (getRes.ok) {
    const existing = (await getRes.json()) as { sha: string }
    sha = existing.sha
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub okuma hatası (${getRes.status})`)
  }

  const putRes = await fetch(base, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      message,
      content: toBase64Utf8(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!putRes.ok) {
    throw new Error(`GitHub yazma hatası (${putRes.status}): ${await putRes.text()}`)
  }
}

/** Worker yoksa: doğrudan GitHub’a yaz (api.github.com — çoğu ağda açık). */
export async function pushAdminDataDirect(token: string, files: AdminDataFile[]) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const message = `admin: veri güncellendi (${stamp})`

  // Önce canlı (gh-pages)
  for (const file of files) {
    const livePath = file.path.replace(/^public\//, '')
    const content = `${JSON.stringify(file.data, null, 2)}\n`
    await putFile(token, 'gh-pages', livePath, content, message)
  }
  // main yedek (ardışık, kısa)
  for (const file of files) {
    const content = `${JSON.stringify(file.data, null, 2)}\n`
    await putFile(token, 'main', file.path, content, message)
  }
}
