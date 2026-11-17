export interface UrgentDeviceAlertPayload {
  id: string;
  title: string;
  body: string;
  priority: 'hoatoc' | 'khan' | 'binhthuong';
  tag?: string;
}

export interface PushDeviceIdentity {
  uid?: string;
  citizenId?: string;
  phoneNumber?: string;
  department?: string;
}

const SEEN_KEY = 'tyt_seen_urgent_notifs_v1';
const DEVICE_NOTIF_PREF_KEY = 'tyt_device_notif_enabled_v1';
const DEVICE_ID_KEY = 'tyt_device_id_v1';

export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.trim()) {
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `dev_${crypto.randomUUID()}`
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return `dev_${Date.now()}`;
  }
}

export function isDeviceNotificationEnabled(): boolean {
  try {
    const val = localStorage.getItem(DEVICE_NOTIF_PREF_KEY);
    return val !== 'false';
  } catch {
    return true;
  }
}

export function setDeviceNotificationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DEVICE_NOTIF_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

export function getSeenUrgentIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function postMessageToActiveSw(message: { type: string; notifId?: string }): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message);
    }
    navigator.serviceWorker.ready
      .then(reg => {
        if (reg.active) {
          reg.active.postMessage(message);
        }
      })
      .catch(() => {});
  } catch {
    // ignore SW messaging errors
  }
}

export function markUrgentSeen(id: string): void {
  if (!id) return;
  try {
    const seen = getSeenUrgentIds();
    seen.add(id);
    const arr = Array.from(seen).slice(-300);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    // ignore storage quota errors
  }
  postMessageToActiveSw({ type: 'MARK_NOTIF_SEEN', notifId: id });
}

export async function requestSystemNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
    ]);
    if (!reg || !reg.pushManager) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeDeviceToWebPush(
  identity?: PushDeviceIdentity
): Promise<{ ok: boolean; subscription?: PushSubscription; reason?: string }> {
  if (!isWebPushSupported()) {
    return { ok: false, reason: 'Trình duyệt không hỗ trợ Web Push nền' };
  }
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: 'Chưa cấp quyền Thông báo trên thiết bị' };
  }

  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 3000)),
    ]);
    if (!reg || !reg.pushManager) {
      return { ok: false, reason: 'Service Worker chưa sẵn sàng' };
    }

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) {
        return { ok: false, reason: 'Không lấy được khóa VAPID từ máy chủ' };
      }
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) {
        return { ok: false, reason: 'Thiếu public key Web Push' };
      }
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }

    const deviceId = getOrCreateDeviceId();
    const subJson = subscription.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        subscription: subJson,
        uid: identity?.uid || undefined,
        citizenId: identity?.citizenId || undefined,
        phoneNumber: identity?.phoneNumber || undefined,
        department: identity?.department || undefined,
      }),
    });

    return { ok: true, subscription };
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.message || 'Không thể đăng ký kênh đẩy nền Web Push',
    };
  }
}

export async function unsubscribeDeviceFromWebPush(): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  try {
    const sub = await getCurrentPushSubscription();
    if (sub) {
      await sub.unsubscribe();
    }
  } catch {
    // ignore
  }
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
  } catch {
    // ignore
  }
}

export async function sendTestBackgroundPush(stationName?: string): Promise<boolean> {
  const deviceId = getOrCreateDeviceId();
  try {
    const subRes = await subscribeDeviceToWebPush();
    if (subRes.ok) {
      const res = await fetch('/api/push/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          title: stationName || 'Trạm Y Tế',
          body: 'Thông báo nền hoạt động bình thường. Nhấn vào đây để mở ứng dụng.',
        }),
      });
      if (res.ok) {
        return true;
      }
    }
  } catch {
    // fall back to local SW notification
  }

  return triggerDeviceSystemNotification(
    {
      id: `test_${Date.now()}`,
      title: stationName || 'Trạm Y Tế',
      body: 'Thông báo thử nghiệm trên thiết bị đang hoạt động bình thường.',
      priority: 'khan',
      tag: 'tyt-test-notification',
    },
    true
  );
}

export interface FallbackPushSubscriptionInput {
  deviceId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  uid?: string;
  citizenId?: string;
  phoneNumber?: string;
  department?: string;
}

export async function broadcastPushNotification(payload: {
  notificationId: string;
  title: string;
  content: string;
  priority: 'hoatoc' | 'khan' | 'binhthuong';
  targetType: string;
  targetCccd?: string;
  targetPhone?: string;
  targetOrgName?: string;
  fallbackSubscriptions?: FallbackPushSubscriptionInput[];
}): Promise<{ ok: boolean; sent: number; pruned: number; error?: string }> {
  try {
    const res = await fetch('/api/push/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationId: payload.notificationId,
        title: payload.title,
        content: payload.content,
        priority: payload.priority,
        targetType: payload.targetType,
        targetCccd: payload.targetCccd,
        targetPhone: payload.targetPhone,
        targetOrgName: payload.targetOrgName,
        fallbackSubscriptions: payload.fallbackSubscriptions,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        sent: 0,
        pruned: 0,
        error: data?.error || `HTTP ${res.status}`,
      };
    }
    return {
      ok: Boolean(data?.ok ?? true),
      sent: Number(data?.sent || 0),
      pruned: Number(data?.pruned || 0),
    };
  } catch (err: any) {
    console.warn('Background push broadcast non-blocking error:', err);
    return { ok: false, sent: 0, pruned: 0, error: err?.message || 'Network error' };
  }
}

/**
 * Triggers a native OS/Device system notification toast (via ServiceWorker when available,
 * falling back to standard Web Notification API). Clicking opens/focuses the app directly to the notification.
 */
export async function triggerDeviceSystemNotification(
  payload: UrgentDeviceAlertPayload,
  forceBypassPref = false
): Promise<boolean> {
  if (!forceBypassPref && !isDeviceNotificationEnabled()) {
    return false;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const prefix =
    payload.priority === 'hoatoc'
      ? '[HỎA TỐC] '
      : payload.priority === 'khan'
      ? '[KHẨN CẤP] '
      : '';
  const fullTitle = `${prefix}${payload.title}`;
  const deepUrl = `/?openNotif=${encodeURIComponent(payload.id)}#trang-chu`;
  const isUrgent = payload.priority === 'hoatoc' || payload.priority === 'khan';
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: payload.body,
    icon: '/iconapp.png',
    badge: '/iconapp.png',
    tag: payload.tag || `tyt-notif-${payload.id}`,
    renotify: isUrgent,
    requireInteraction: payload.priority === 'hoatoc',
    vibrate:
      payload.priority === 'hoatoc'
        ? [250, 100, 250, 100, 250]
        : payload.priority === 'khan'
        ? [200, 100, 200]
        : [120, 80, 120],
    data: {
      notifId: payload.id,
      url: deepUrl,
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
      ]);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(fullTitle, options);
        return true;
      }
    }
  } catch {
    // Fall back to window Notification constructor
  }

  try {
    const notif = new Notification(fullTitle, options);
    notif.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent('tyt:open-notification', { detail: { notifId: payload.id } })
      );
      notif.close();
    };
    return true;
  } catch {
    return false;
  }
}
