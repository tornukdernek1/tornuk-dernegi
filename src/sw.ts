/// <reference lib="webworker" />
/** tornuk-sw-v2026-08-03g — closed-app web push harden */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

declare let self: ServiceWorkerGlobalScope

// Yeni SW hemen aktif olsun — eski önbellekli SW takılı kalmasın
void self.skipWaiting()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Duyuru/aidat JSON — yalnızca aynı origin; raw.githubusercontent.com’u yakalama
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    url.pathname.includes('/data/') &&
    url.pathname.endsWith('.json'),
  new NetworkOnly({
    plugins: [
      {
        cacheWillUpdate: async () => null,
      },
    ],
  }),
)

async function purgeDataJsonCaches() {
  await caches.delete('live-data')
  const names = await caches.keys()
  for (const name of names) {
    const cache = await caches.open(name)
    const requests = await cache.keys()
    await Promise.all(
      requests
        .filter((req) => req.url.includes('/data/') && req.url.includes('.json'))
        .map((req) => cache.delete(req)),
    )
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await purgeDataJsonCaches()
      await self.clients.claim()
    })(),
  )
})

try {
  const handler = createHandlerBoundToURL('index.html')
  registerRoute(new NavigationRoute(handler))
} catch {
  // Dev ortamında navigateFallback olmayabilir
}

const META_CACHE = 'duyuru-meta-v1'
const LAST_ID_URL = 'https://tornuk.local/last-duyuru-id'
const LAST_ETKINLIK_URL = 'https://tornuk.local/last-etkinlik-id'

async function getMeta(url: string): Promise<string | null> {
  const cache = await caches.open(META_CACHE)
  const hit = await cache.match(url)
  return hit ? hit.text() : null
}

async function setMeta(url: string, id: string) {
  const cache = await caches.open(META_CACHE)
  await cache.put(url, new Response(id, { headers: { 'Content-Type': 'text/plain' } }))
}

async function notifyClientsPlaySound() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'PLAY_NOTIFY_SOUND' })
  }
}

async function checkDuyurular() {
  const base = self.registration.scope
  const res = await fetch(
    `https://raw.githubusercontent.com/tornukdernek1/tornuk-dernegi/gh-pages/data/duyurular.json?t=${Date.now()}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return

  const data = (await res.json()) as {
    items: { id: string; title: string; summary: string }[]
  }
  const latest = data.items?.[0]
  if (!latest) return

  const prev = await getMeta(LAST_ID_URL)
  if (!prev) {
    await setMeta(LAST_ID_URL, latest.id)
    return
  }

  if (prev === latest.id) return

  const options = {
    body: latest.summary,
    icon: `${base}icons/icon-192.png`,
    badge: `${base}icons/icon-192.png`,
    tag: `duyuru-${latest.id}`,
    silent: false,
    data: { url: `${base}?tab=duyurular&r=${Date.now()}` },
    renotify: true,
    vibrate: [200, 80, 200, 80, 400],
  } as NotificationOptions
  await self.registration.showNotification(latest.title, options)

  await notifyClientsPlaySound()
  await setMeta(LAST_ID_URL, latest.id)
}

async function checkEtkinlikler() {
  const base = self.registration.scope
  const res = await fetch(
    `https://raw.githubusercontent.com/tornukdernek1/tornuk-dernegi/gh-pages/data/etkinlikler.json?t=${Date.now()}`,
    { cache: 'no-store' },
  )
  if (!res.ok) return

  const data = (await res.json()) as {
    items: {
      id: string
      title: string
      description?: string
      date?: string
      time?: string
      place?: string
    }[]
  }
  const latest = data.items?.[0]
  if (!latest) return

  const prev = await getMeta(LAST_ETKINLIK_URL)
  if (!prev) {
    await setMeta(LAST_ETKINLIK_URL, latest.id)
    return
  }

  if (prev === latest.id) return

  const body =
    latest.description?.trim() ||
    [latest.date, latest.time, latest.place].filter(Boolean).join(' · ') ||
    latest.title

  const options = {
    body,
    icon: `${base}icons/icon-192.png`,
    badge: `${base}icons/icon-192.png`,
    tag: `etkinlik-${latest.id}`,
    silent: false,
    data: { url: `${base}?tab=etkinlikler&r=${Date.now()}` },
    renotify: true,
    vibrate: [200, 80, 200, 80, 400],
  } as NotificationOptions
  await self.registration.showNotification(latest.title, options)

  await notifyClientsPlaySound()
  await setMeta(LAST_ETKINLIK_URL, latest.id)
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_DUYURULAR') {
    event.waitUntil(checkDuyurular())
  }
  if (event.data?.type === 'CHECK_ETKINLIKLER') {
    event.waitUntil(checkEtkinlikler())
  }
  if (event.data?.type === 'SET_LAST_DUYURU_ID' && typeof event.data.id === 'string') {
    event.waitUntil(setMeta(LAST_ID_URL, event.data.id))
  }
  if (event.data?.type === 'SET_LAST_ETKINLIK_ID' && typeof event.data.id === 'string') {
    event.waitUntil(setMeta(LAST_ETKINLIK_URL, event.data.id))
  }
  if (event.data?.type === 'PURGE_DATA_CACHE') {
    event.waitUntil(purgeDataJsonCaches())
  }
})

self.addEventListener('periodicsync', (event) => {
  const syncEvent = event as Event & { tag: string; waitUntil: (p: Promise<unknown>) => void }
  if (syncEvent.tag === 'check-duyurular') {
    syncEvent.waitUntil(Promise.all([checkDuyurular(), checkEtkinlikler()]))
  }
})

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const base = self.registration.scope
      let title = 'Törnük Derneği'
      let body = 'Yeni bir güncelleme var.'
      let url = `${base}?r=${Date.now()}`
      let tag = `push-${Date.now()}`

      try {
        if (event.data) {
          const raw = await event.data.text()
          try {
            const data = JSON.parse(raw) as {
              title?: string
              body?: string
              url?: string
              kind?: string
              id?: string
            }
            if (data?.title) title = data.title
            if (data?.body) body = data.body
            if (data?.url) url = data.url
            if (data?.id) tag = `${data.kind || 'push'}-${data.id}`
          } catch {
            if (raw) body = raw.slice(0, 180)
          }
        }
      } catch {
        // boş payload — varsayılan metinle göster
      }

      // Kapalı uygulamada mutlaka görünür bildirim
      await self.registration.showNotification(title, {
        body,
        icon: `${base}icons/icon-192.png`,
        badge: `${base}icons/icon-192.png`,
        tag,
        renotify: true,
        requireInteraction: false,
        silent: false,
        vibrate: [200, 80, 200, 80, 400],
        data: { url },
      } as NotificationOptions)

      try {
        await notifyClientsPlaySound()
      } catch {
        // ses opsiyonel
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target =
    event.notification.data?.url || `${self.registration.scope}?tab=duyurular&r=${Date.now()}`
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          void client.navigate?.(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
