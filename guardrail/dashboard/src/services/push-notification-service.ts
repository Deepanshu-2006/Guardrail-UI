/**
 * Guardrail Dashboard Client - Web Push Notification Manager
 *
 * Provides browser service worker registration, push subscription negotiation
 * with VAPID applicationServerKey, and backend registration.
 */

export interface PushStatus {
  readonly supported: boolean;
  readonly permission: NotificationPermission | 'unsupported';
  readonly isSubscribed: boolean;
  readonly endpoint?: string;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export class DashboardPushService {
  private static instance: DashboardPushService | null = null;
  private registration: ServiceWorkerRegistration | null = null;

  public static getInstance(): DashboardPushService {
    if (!DashboardPushService.instance) {
      DashboardPushService.instance = new DashboardPushService();
    }
    return DashboardPushService.instance;
  }

  public isSupported(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  public getPermission(): NotificationPermission | 'unsupported' {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  }

  public async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!this.isSupported()) return null;
    if (this.registration) return this.registration;

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      return this.registration;
    } catch (err) {
      console.warn('[DashboardPushService] Service worker registration failed:', err);
      return null;
    }
  }

  public async getExistingSubscription(): Promise<PushSubscription | null> {
    const reg = await this.registerServiceWorker();
    if (!reg) return null;
    try {
      return await reg.pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  public async getStatus(): Promise<PushStatus> {
    if (!this.isSupported()) {
      return { supported: false, permission: 'unsupported', isSubscribed: false };
    }
    const permission = this.getPermission();
    const sub = await this.getExistingSubscription();
    return {
      supported: true,
      permission,
      isSubscribed: Boolean(sub),
      endpoint: sub?.endpoint,
    };
  }

  public async fetchVapidPublicKey(apiBase: string): Promise<string> {
    const response = await fetch(`${apiBase}/api/v1/push/vapid-public-key`);
    if (!response.ok) {
      throw new Error(`Failed to fetch VAPID public key (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (!data?.success || !data?.data?.publicKey) {
      throw new Error('Invalid VAPID public key response from server');
    }
    return data.data.publicKey;
  }

  public async subscribe(
    apiBase: string,
    actorId = 'tc_carol',
    token?: string,
  ): Promise<{ success: boolean; subscription?: PushSubscription; error?: string }> {
    if (!this.isSupported()) {
      return { success: false, error: 'Push notifications are not supported in this browser' };
    }

    try {
      // 1. Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return { success: false, error: 'Notification permission was denied or dismissed' };
      }

      // 2. Register service worker and get VAPID key
      const reg = await this.registerServiceWorker();
      if (!reg) {
        return { success: false, error: 'Could not activate Service Worker' };
      }

      const vapidKey = await this.fetchVapidPublicKey(apiBase);
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);

      // 3. Subscribe with PushManager
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });

      // 4. Send subscription to server
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${apiBase}/api/v1/push/subscribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          actorId,
          subscription: subscription.toJSON(),
        }),
      });

      if (!res.ok) {
        throw new Error(`Server rejected push subscription (HTTP ${res.status})`);
      }

      return { success: true, subscription };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to subscribe to push notifications' };
    }
  }

  public async unsubscribe(
    apiBase: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const sub = await this.getExistingSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        try {
          await fetch(`${apiBase}/api/v1/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          });
        } catch {}
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to unsubscribe' };
    }
  }

  public async sendTestAlert(
    apiBase: string,
    actorId = 'tc_carol',
    token?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure local device subscription exists and is registered with current server VAPID key
      const sub = await this.getExistingSubscription();
      if (!sub) {
        await this.subscribe(apiBase, actorId, token);
      }

      // Trigger immediate local notification via service worker for instant visual feedback
      if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && Notification.permission === 'granted') {
        try {
          const reg = await this.registerServiceWorker();
          if (reg) {
            await reg.showNotification('Guardrail · Security Alerts Active', {
              body: '✓ Device verified for Caretaker Carol\nOut-of-band lock screen alerts are active & ready.',
              icon: '/icons/icon-192.png',
              badge: '/icons/icon-48.png',
              image: '/icons/alert-preview.png',
              tag: `test-alert-${Date.now()}`,
              data: { url: '/#overview' },
            });
          }
        } catch {}
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${apiBase}/api/v1/push/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ actorId }),
      });

      if (!res.ok) {
        throw new Error(`Test notification request failed (HTTP ${res.status})`);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Test alert failed' };
    }
  }
}

export const defaultDashboardPushService = DashboardPushService.getInstance();
