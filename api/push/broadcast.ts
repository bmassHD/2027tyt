import fs from 'fs';
import path from 'path';
import * as webpush from 'web-push';
import { getVapidKeys } from './vapid-public-key';

const TMP_SUBS_FILE = path.join('/tmp', '.push-subscriptions.json');

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

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
  }

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
        if (fb?.endpoint && fb?.keys?.p256dh && fb?.keys?.auth && !mergedByEndpoint.has(fb.endpoint)) {
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
    webpush.setVapidDetails(
      'mailto:tramyte@portal.local',
      keys.publicKey,
      keys.privateKey
    );

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
