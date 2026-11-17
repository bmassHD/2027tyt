import fs from 'fs';
import path from 'path';

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
