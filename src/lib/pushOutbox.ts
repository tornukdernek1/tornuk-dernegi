import { getBridgeGithubToken } from './bridgeUnlock'
import { toBase64Utf8 } from './download'
import type { NotifyKind } from './ntfyPush'

import { GITHUB_OWNER, GITHUB_REPO, SITE_BASE_URL } from './siteConfig'

const OWNER = GITHUB_OWNER
const REPO = GITHUB_REPO
const LIVE_PATH = 'data/push-outbox.json'
const MAIN_PATH = 'public/data/push-outbox.json'

type OutboxItem = {
  id: string
  kind: NotifyKind
  title: string
  body: string
  url: string
  createdAt: string
}

type OutboxFile = { updatedAt: string; items: OutboxItem[] }

async function githubGet(token: string, path: string, branch: string) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (res.status === 404) return { sha: undefined, data: { updatedAt: new Date().toISOString(), items: [] } as OutboxFile }
  if (!res.ok) throw new Error(`outbox okuma ${res.status}`)
  const payload = (await res.json()) as { sha: string; content: string }
  const text = atob(payload.content.replace(/\s+/g, ''))
  return { sha: payload.sha, data: JSON.parse(text) as OutboxFile }
}

async function githubPut(
  token: string,
  path: string,
  branch: string,
  data: OutboxFile,
  sha?: string,
) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `admin: push outbox (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
      content: toBase64Utf8(`${JSON.stringify(data, null, 2)}\n`),
      branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!res.ok) throw new Error(`outbox yazma ${res.status}`)
}

/** Kapalı uygulama bildirimi için kuyruk (Worker cron işler). Autoliv’de Worker engelli olsa da GitHub yazılır. */
export async function enqueueClosedAppPush(item: {
  kind: NotifyKind
  id?: string
  title: string
  summary: string
}): Promise<void> {
  const token = getBridgeGithubToken()
  if (!token) return

  const tab = item.kind === 'etkinlik' ? 'etkinlikler' : 'duyurular'
  const key = item.kind === 'etkinlik' ? 'etkinlik' : 'duyuru'
  const id = item.id || `${item.kind}-${Date.now()}`
  const entry: OutboxItem = {
    id,
    kind: item.kind,
    title: item.title,
    body: item.summary || item.title,
    url: `${SITE_BASE_URL}/?tab=${tab}&r=${Date.now()}&${key}=${encodeURIComponent(id)}`,
    createdAt: new Date().toISOString(),
  }

  const live = await githubGet(token, LIVE_PATH, 'gh-pages')
  const items = [...(live.data.items || []).filter((x) => x.id !== id), entry].slice(-20)
  const next: OutboxFile = { updatedAt: new Date().toISOString(), items }
  await githubPut(token, LIVE_PATH, 'gh-pages', next, live.sha)

  try {
    const main = await githubGet(token, MAIN_PATH, 'main')
    await githubPut(token, MAIN_PATH, 'main', next, main.sha)
  } catch {
    // main yedek opsiyonel
  }
}
