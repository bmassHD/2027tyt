import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

interface PrecacheEntry {
  url: string;
  revision: string | null;
}

interface SWWindowClient {
  url: string;
  focused?: boolean;
  focus(): Promise<SWWindowClient>;
  navigate?(url: string): Promise<SWWindowClient | null>;
  postMessage(message: unknown): void;
}

interface SWNotification {
  close(): void;
  data?: {
    url?: string;
    notifId?: string;
  };
}

interface SWPushEvent extends Event {
  data?: {
    json(): any;
    text(): string;
  };
  waitUntil(promise: Promise<unknown>): void;
}

interface SWNotificationEvent extends Event {
  notification: SWNotification;
  waitUntil(promise: Promise<unknown>): void;
}

interface SWExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SWMessageEvent extends Event {
  data?: {
    type?: string;
    notifId?: string;
  };
}

interface SWGlobalScope {
  __WB_MANIFEST: PrecacheEntry[];
  location: Location;
  skipWaiting(): Promise<void>;
  registration: {
    showNotification(
      title: string,
      options?: NotificationOptions & { vibrate?: number[]; renotify?: boolean }
    ): Promise<void>;
  };
  clients: {
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<SWWindowClient[]>;
    openWindow(url: string): Promise<SWWindowClient | null>;
  };
  addEventListener(type: 'install', listener: (event: SWExtendableEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SWMessageEvent) => void): void;
  addEventListener(type: 'push', listener: (event: SWPushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: SWNotificationEvent) => void): void;
}

const sw = self as unknown as SWGlobalScope;

const SEEN_CACHE_NAME = 'tyt-seen-notifications-v1';

cleanupOutdatedCaches();
precacheAndRoute((self as unknown as SWGlobalScope).__WB_MANIFEST || []);
clientsClaim();

sw.addEventListener('install', event => {
  event.waitUntil(sw.skipWaiting());
});

async function markSeenInSwCache(notifId?: string): Promise<void> {
  if (!notifId || typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(SEEN_CACHE_NAME);
    await cache.put(
      new Request(`/__seen__/${encodeURIComponent(notifId)}`),
      new Response('1', { status: 200 })
    );
  } catch {
    // ignore cache write errors
  }
}

async function isSeenInSwCache(notifId?: string): Promise<boolean> {
  if (!notifId || typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(SEEN_CACHE_NAME);
    const match = await cache.match(new Request(`/__seen__/${encodeURIComponent(notifId)}`));
    return Boolean(match);
  } catch {
    return false;
  }
}

sw.addEventListener('message', event => {
  const payload = event.data;
  if (!payload) return;
  if (payload.type === 'SKIP_WAITING') {
    sw.skipWaiting();
  } else if (payload.type === 'MARK_NOTIF_SEEN' && payload.notifId) {
    markSeenInSwCache(payload.notifId);
  }
});

sw.addEventListener('push', event => {
  event.waitUntil(
    (async () => {
      let data: {
        notifId?: string;
        title?: string;
        body?: string;
        priority?: 'hoatoc' | 'khan' | 'binhthuong';
        url?: string;
      } = {};

      if (event.data) {
        try {
          data = event.data.json();
        } catch {
          data = { title: 'Thông báo Trạm Y Tế', body: event.data.text() };
        }
      }

      const notifId = data.notifId || '';
      if (notifId && (await isSeenInSwCache(notifId))) {
        return;
      }

      const priority = data.priority || 'binhthuong';
      const prefix =
        priority === 'hoatoc'
          ? '[HỎA TỐC] '
          : priority === 'khan'
          ? '[KHẨN CẤP] '
          : '';
      const title = `${prefix}${data.title || 'Thông báo từ Trạm Y Tế'}`;
      const targetUrl =
        data.url ||
        (notifId ? `/?openNotif=${encodeURIComponent(notifId)}#trang-chu` : '/#trang-chu');

      await sw.registration.showNotification(title, {
        body: data.body || 'Bạn có thông báo mới từ Trạm Y Tế.',
        icon: '/iconapp.png',
        badge: '/iconapp.png',
        tag: notifId ? `tyt-notif-${notifId}` : `tyt-push-${Date.now()}`,
        renotify: priority === 'hoatoc' || priority === 'khan',
        requireInteraction: priority === 'hoatoc',
        vibrate:
          priority === 'hoatoc'
            ? [250, 100, 250, 100, 250]
            : priority === 'khan'
            ? [200, 100, 200]
            : [120, 80, 120],
        data: {
          notifId,
          url: targetUrl,
        },
      });
    })()
  );
});

sw.addEventListener('notificationclick', event => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const notifId = notifData.notifId || '';
  const relativeUrl =
    notifData.url ||
    (notifId ? `/?openNotif=${encodeURIComponent(notifId)}#trang-chu` : '/#trang-chu');
  const fullUrl = new URL(relativeUrl, sw.location.origin).href;

  event.waitUntil(
    (async () => {
      if (notifId) {
        await markSeenInSwCache(notifId);
      }

      const clientList = await sw.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const sameOriginClient = clientList.find(c =>
        c.url.startsWith(sw.location.origin)
      );

      if (sameOriginClient) {
        await sameOriginClient.focus();
        if (notifId) {
          sameOriginClient.postMessage({
            type: 'OPEN_NOTIFICATION',
            notifId,
          });
        }
        return;
      }

      await sw.clients.openWindow(fullUrl);
    })()
  );
});
