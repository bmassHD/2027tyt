import fs from 'fs';
import path from 'path';
import * as webpush from 'web-push';

const TMP_VAPID_FILE = path.join('/tmp', '.vapid-keys.json');

export function getVapidKeys() {
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

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const keys = getVapidKeys();
    return res.status(200).json({ publicKey: keys.publicKey });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Không thể tạo khóa VAPID' });
  }
}
