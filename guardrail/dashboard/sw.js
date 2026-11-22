/**
 * Guardrail Trusted Contact Portal - Push Notification Service Worker
 *
 * Handles background Web Push events and native notification interactions
 * so Caretakers receive immediate lock-screen alerts for intercepted actions.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {
    title: 'Guardrail · Action Approval Required',
    body: 'A protected action requires your review on Guardrail.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-48.png',
    image: '/icons/alert-preview.png',
    data: {
      url: '/#overview',
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
    image: payload.image || '/icons/alert-preview.png',
    tag: payload.tag || 'guardrail-alert',
    data: payload.data || { url: '/#overview' },
    requireInteraction: true,
  };

  if (payload.actions && Array.isArray(payload.actions)) {
    notificationOptions.actions = payload.actions;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions).catch((err) => {
      console.warn('[Guardrail SW] showNotification rich failed, retrying standard:', err);
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icons/icon-192.png',
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/#overview';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(self.location.origin)) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
