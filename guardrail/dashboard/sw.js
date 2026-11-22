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
    title: '🛡️ Action Approval Required',
    body: 'A protected action requires your review on Guardrail.',
    icon: '/icons/icon-128.png',
    badge: '/icons/icon-48.png',
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
    icon: payload.icon || '/icons/icon-128.png',
    badge: payload.badge || '/icons/icon-48.png',
    tag: payload.tag || 'guardrail-alert',
    data: payload.data || { url: '/#overview' },
    actions: payload.actions || [
      { action: 'review', title: 'Review & Decide' },
    ],
    requireInteraction: true,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
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
