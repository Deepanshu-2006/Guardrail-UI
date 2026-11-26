/**
 * Guardrail Trusted Contact Portal - Push Notification & Offline PWA Service Worker
 *
 * Implements:
 * 1. Standalone offline capability for the Caretaker companion app.
 * 2. Pre-caching of application shell assets (HTML, CSS, JS bundles, manifest, brand icons).
 * 3. Network-first strategy for dynamic views, with safe fallback to cached shell.
 * 4. Network-only bypass for `/api/` endpoints (security invariants: decisions are never served stale).
 * 5. Web Push notification handling and rich native lock-screen alert interactions.
 */

const CACHE_NAME = 'guardrail-caretaker-pwa-v21';

const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/styles/dashboard.css',
  '/dist/dashboard.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-128.png',
  '/icons/icon-48.png',
  '/icons/icon-16.png',
  '/icons/apple-touch-icon.png',
  '/icons/maskable-icon-512.png',
];

// Install: Cache critical static application shell and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_SHELL_ASSETS).catch((err) => {
          console.warn('[Guardrail SW] Cache addAll non-fatal error:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: Claim client tabs and purge stale previous cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('guardrail-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Smart routing & caching
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Invariant 1: Security & API requests are strictly Network-Only (never serve stale security decisions)
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/sse') ||
    url.hostname.includes('clerk') ||
    request.method !== 'GET'
  ) {
    return; // Pass through directly to standard network fetch
  }

  // Invariant 2: Navigation requests (page loads) -> Network first, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match('/index.html');
          if (cachedResponse) {
            return cachedResponse;
          }
          return caches.match('/');
        })
    );
    return;
  }

  // Invariant 3: Static assets -> Stale-while-revalidate / Cache first with network fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch updated asset in the background to update cache for next load
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
          })
          .catch(() => {
            // Ignore background network error if offline
          });
        return cachedResponse;
      }

      // Not in cache: fetch from network and cache
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return networkResponse;
      });
    })
  );
});

// =============================================================================
// Web Push Notifications & Lock-Screen Alerts
// =============================================================================

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {
    title: 'Guardrail',
    body: 'Action held for review.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-48.png',
    data: {
      url: '/#pending',
    },
  };

  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text() || payload.body;
  }

  const notificationOptions = {
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-48.png',
    tag: payload.tag || 'guardrail-alert',
    data: payload.data || { url: '/#pending' },
    requireInteraction: true,
  };

  if (payload.actions && Array.isArray(payload.actions)) {
    notificationOptions.actions = payload.actions;
  }

  const updateBadge = async () => {
    const nav = self.navigator;
    if (!nav || (typeof nav.setAppBadge !== 'function' && typeof nav.clearAppBadge !== 'function')) {
      return;
    }
    try {
      const explicitCount =
        typeof payload.badgeCount === 'number'
          ? payload.badgeCount
          : typeof payload.data?.pendingCount === 'number'
            ? payload.data.pendingCount
            : null;

      if (explicitCount !== null) {
        if (explicitCount > 0 && typeof nav.setAppBadge === 'function') {
          await nav.setAppBadge(explicitCount);
        } else if (typeof nav.clearAppBadge === 'function') {
          await nav.clearAppBadge();
        }
        return;
      }

      if (typeof nav.setAppBadge === 'function') {
        const activeNotifications = await self.registration.getNotifications();
        await nav.setAppBadge(Math.max(1, activeNotifications.length));
      }
    } catch {
      // Ignore unsupported or restricted badging errors
    }
  };

  event.waitUntil(
    self.registration
      .showNotification(payload.title, notificationOptions)
      .catch((err) => {
        console.warn('[Guardrail SW] showNotification rich failed, retrying standard:', err);
        return self.registration.showNotification(payload.title, {
          body: payload.body,
          icon: '/icons/icon-192.png',
        });
      })
      .then(() => updateBadge())
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const requestId = typeof data.requestId === 'string' && data.requestId ? data.requestId : null;
  const fallbackUrl = requestId ? `/#detail/${encodeURIComponent(requestId)}` : '/#pending';
  const targetUrl =
    typeof data.url === 'string' && data.url && (!requestId || data.url.includes('#detail/'))
      ? data.url
      : fallbackUrl;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open and deep-link directly via postMessage
      for (const client of clientList) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          if (requestId && typeof client.postMessage === 'function') {
            client.postMessage({
              type: 'GUARDRAIL_OPEN_REQUEST',
              requestId,
              url: targetUrl,
            });
          } else if (typeof client.navigate === 'function') {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      // Otherwise open new standalone window at the deep-linked request URL
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
