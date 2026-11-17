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
    const { subscription, deviceId, title, body } = req.body || {};
    const list = loadPushSubscriptions();
    const targetSub =
      subscription ||
      list.find(item => item.deviceId === deviceId)?.subscription;

    if (!targetSub?.endpoint) {
      return res.status(404).json({ error: 'Thiết bị chưa đăng ký nhận thông báo nền.' });
    }

    const keys = getVapidKeys();
    webpush.setVapidDetails(
      'mailto:tramyte@portal.local',
      keys.publicKey,
      keys.privateKey
    );

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
