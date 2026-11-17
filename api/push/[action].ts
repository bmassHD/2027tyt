import fs from 'node:fs';
import path from 'node:path';
import * as webpushModule from 'web-push';

const webpush =
  (webpushModule as unknown as { default?: typeof webpushModule }).default?.generateVAPIDKeys
    ? (webpushModule as unknown as { default: typeof webpushModule }).default
    : webpushModule;

const TMP_VAPID_FILE = path.join('/tmp', '.vapid-keys.json');
const TMP_SUBS_FILE = path.join('/tmp', '.push-subscriptions.json');

function getVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }
  try {
    if (fs.existsSync(TMP_VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TMP_VAPID_FILE, 'utf-8'));
      if (parsed?.publicKey && parsed?.privateKey) {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  const generated = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(TMP_VAPID_FILE, JSON.stringify(generated), 'utf-8');
  } catch {
    // ignore
  }
  return generated;
}

function loadPushSubscriptions(): any[] {
  try {
    if (!fs.existsSync(TMP_SUBS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(TMP_SUBS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePushSubscriptions(list: any[]): void {
  try {
    fs.writeFileSync(TMP_SUBS_FILE, JSON.stringify(list), 'utf-8');
  } catch {
    // ignore
  }
}

function resolveAction(req: any): string {
  const rawQueryAction = req.query?.action;
  if (typeof rawQueryAction === 'string' && rawQueryAction.trim()) {
    return rawQueryAction.trim().toLowerCase();
  }
  if (Array.isArray(rawQueryAction) && rawQueryAction[0]) {
    return String(rawQueryAction[0]).trim().toLowerCase();
  }
  try {
    const pathname = new URL(req.url || '', 'http://localhost').pathname;
    const segments = pathname.split('/').filter(Boolean);
    return (segments[segments.length - 1] || '').toLowerCase();
  } catch {
    return '';
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = resolveAction(req);

  if (action === 'vapid-public-key') {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Chỉ chấp nhận phương thức GET' });
    }
    try {
      const keys = getVapidKeys();
      return res.status(200).json({ publicKey: keys.publicKey });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Không thể tạo khóa VAPID' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
  }

  if (action === 'subscribe') {
    try {
      const { deviceId, subscription, uid, citizenId, phoneNumber, department } = req.body || {};
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ error: 'Dữ liệu push subscription không hợp lệ' });
      }
      const keyId = String(deviceId || subscription.endpoint);
      const list = loadPushSubscriptions().filter(
        item => item.deviceId !== keyId && item.subscription?.endpoint !== subscription.endpoint
      );
      list.push({
        deviceId: keyId,
        subscription,
        uid: uid ? String(uid) : undefined,
        citizenId: citizenId ? String(citizenId).trim() : undefined,
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : undefined,
        department: department ? String(department).trim() : undefined,
        updatedAt: new Date().toISOString(),
      });
      savePushSubscriptions(list);
      return res.status(200).json({ ok: true, count: list.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Lỗi lưu đăng ký thông báo' });
    }
  }

  if (action === 'unsubscribe') {
    try {
      const { deviceId, endpoint } = req.body || {};
      const list = loadPushSubscriptions().filter(
        item =>
          (!deviceId || item.deviceId !== deviceId) &&
          (!endpoint || item.subscription?.endpoint !== endpoint)
      );
      savePushSubscriptions(list);
      return res.status(200).json({ ok: true, count: list.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Lỗi hủy đăng ký' });
    }
  }

  if (action === 'send-test') {
    try {
      const { subscription, deviceId, title, body } = req.body || {};
      const list = loadPushSubscriptions();
      const targetSub =
        subscription || list.find(item => item.deviceId === deviceId)?.subscription;

      if (!targetSub?.endpoint) {
        return res.status(404).json({ error: 'Thiết bị chưa đăng ký nhận thông báo nền.' });
      }

      const keys = getVapidKeys();
      webpush.setVapidDetails('mailto:tramyte@portal.local', keys.publicKey, keys.privateKey);

      await webpush.sendNotification(
        targetSub,
        JSON.stringify({
          notifId: `test_${Date.now()}`,
          title: title || 'Trạm Y Tế',
          body: body || 'Thông báo nền hoạt động ngay cả khi ứng dụng đã đóng.',
          priority: 'khan',
          url: '/#trang-chu',
        })
      );

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Gửi thông báo thử nghiệm thất bại' });
    }
  }

  if (action === 'broadcast') {
    try {
      const {
        notificationId,
        title,
        content,
        priority = 'binhthuong',
        targetType = 'all',
        targetCccd,
        targetPhone,
        targetOrgName,
        fallbackSubscriptions,
      } = req.body || {};

      if (!title || !content) {
        return res.status(400).json({ error: 'Tiêu đề hoặc nội dung thông báo không được để trống' });
      }

      const storedList = loadPushSubscriptions();
      const mergedByEndpoint = new Map<string, any>();
      for (const entry of storedList) {
        if (entry?.subscription?.endpoint) {
          mergedByEndpoint.set(entry.subscription.endpoint, entry);
        }
      }
      if (Array.isArray(fallbackSubscriptions)) {
        for (const fb of fallbackSubscriptions) {
          if (
            fb?.endpoint &&
            fb?.keys?.p256dh &&
            fb?.keys?.auth &&
            !mergedByEndpoint.has(fb.endpoint)
          ) {
            mergedByEndpoint.set(fb.endpoint, {
              deviceId: fb.deviceId || fb.endpoint,
              subscription: {
                endpoint: fb.endpoint,
                keys: { p256dh: fb.keys.p256dh, auth: fb.keys.auth },
              },
              uid: fb.uid,
              citizenId: fb.citizenId,
              phoneNumber: fb.phoneNumber,
              department: fb.department,
            });
          }
        }
      }

      const list = Array.from(mergedByEndpoint.values());
      if (list.length === 0) {
        return res.status(200).json({ ok: true, sent: 0, pruned: 0 });
      }

      const cleanCccd = String(targetCccd || '').trim();
      const cleanPhone = String(targetPhone || '').trim();
      const cleanOrg = String(targetOrgName || '').trim().toLowerCase();

      const targets = list.filter(sub => {
        if (targetType === 'all') return true;
        if (cleanCccd && (sub.citizenId === cleanCccd || sub.uid === cleanCccd)) return true;
        if (cleanPhone && sub.phoneNumber === cleanPhone) return true;
        if (cleanOrg && sub.department && sub.department.toLowerCase().includes(cleanOrg)) {
          return true;
        }
        return false;
      });

      const notifId = String(notificationId || `push_${Date.now()}`);
      const payload = JSON.stringify({
        notifId,
        title: String(title),
        body: String(content).slice(0, 220),
        priority,
        url: `/?openNotif=${encodeURIComponent(notifId)}#trang-chu`,
      });

      const keys = getVapidKeys();
      webpush.setVapidDetails('mailto:tramyte@portal.local', keys.publicKey, keys.privateKey);

      const expiredEndpoints = new Set<string>();
      let sent = 0;

      await Promise.allSettled(
        targets.map(async entry => {
          try {
            await webpush.sendNotification(entry.subscription, payload);
            sent += 1;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              expiredEndpoints.add(entry.subscription.endpoint);
            }
          }
        })
      );

      if (expiredEndpoints.size > 0) {
        const remaining = list.filter(
          entry => !expiredEndpoints.has(entry.subscription.endpoint)
        );
        savePushSubscriptions(remaining);
      }

      return res.status(200).json({ ok: true, sent, pruned: expiredEndpoints.size });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Lỗi phát tán thông báo' });
    }
  }

  return res.status(404).json({ error: 'Endpoint Web Push không tồn tại' });
}
