import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface RawCitizenRow {
  STT?: number;
  'Họ và tên'?: string;
  'Ngày sinh'?: string;
  'Giới tính'?: string;
  'Số ĐDCN/CCCD/ CMND'?: string | number;
  'Nơi thường trú'?: string;
  'Nơi ở hiện tại'?: string;
}

export interface CitizenDatabaseRecord {
  citizenId: string;
  displayName: string;
  dob: string;
  dobRaw: string;
  gender: 'Nam' | 'Nữ' | 'Khác' | '****';
  permanentAddress: string;
  currentAddress: string;
  fullAddress: string;
}

let cachedCitizenIndex: Map<string, CitizenDatabaseRecord> | null = null;
let cachedLoadError: string | null = null;

const BOOTSTRAP_ADMIN_SET = new Set([
  'sonlyhongduc@gmail.com',
  'sonlyhongduc2003@gmail.com',
  'tytvtd@gmail.com',
]);

function getFirebaseAppletCfg(): {
  apiKey?: string;
  projectId?: string;
  firestoreDatabaseId?: string;
} {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      path.resolve(process.cwd(), 'firebase-applet-config.json'),
      path.resolve(moduleDir, '..', 'firebase-applet-config.json'),
    ];
    const cfgPath = candidatePaths.find((p) => fs.existsSync(p));
    if (cfgPath) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

async function resolveCallerRole(authHeader?: string): Promise<{
  uid: string | null;
  isAdmin: boolean;
}> {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { uid: null, isAdmin: false };
  }
  const fbCfg = getFirebaseAppletCfg();
  if (!fbCfg?.apiKey) {
    return { uid: null, isAdmin: false };
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbCfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (!resp.ok) {
      return { uid: null, isAdmin: false };
    }
    const data = (await resp.json()) as { users?: Array<{ localId?: string; email?: string }> };
    const user = data?.users?.[0];
    if (!user?.localId) {
      return { uid: null, isAdmin: false };
    }
    const email = String(user.email || '').trim().toLowerCase();
    if (BOOTSTRAP_ADMIN_SET.has(email)) {
      return { uid: user.localId, isAdmin: true };
    }
    if (fbCfg.projectId && fbCfg.firestoreDatabaseId) {
      const adminUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        fbCfg.projectId
      )}/databases/${encodeURIComponent(fbCfg.firestoreDatabaseId)}/documents/admins/${encodeURIComponent(
        user.localId
      )}`;
      const adminResp = await fetch(adminUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (adminResp.ok) {
        return { uid: user.localId, isAdmin: true };
      }

      const userUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        fbCfg.projectId
      )}/databases/${encodeURIComponent(fbCfg.firestoreDatabaseId)}/documents/users/${encodeURIComponent(
        user.localId
      )}`;
      const userResp = await fetch(userUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (userResp.ok) {
        const userDoc = (await userResp.json().catch(() => ({}))) as {
          fields?: { role?: { stringValue?: string }; accountType?: { stringValue?: string } };
        };
        const role = userDoc?.fields?.role?.stringValue || '';
        const accountType = userDoc?.fields?.accountType?.stringValue || '';
        const isDocAdmin = role === 'admin' || role === 'super_admin' || accountType === 'admin';
        return { uid: user.localId, isAdmin: isDocAdmin };
      }
    }
    return { uid: user.localId, isAdmin: false };
  } catch {
    return { uid: null, isAdmin: false };
  }
}

function maskCccdValue(digits: string): string {
  if (!digits) return '****';
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

function maskNameValue(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return '****';
  const parts = clean.split(' ');
  if (parts.length > 1) {
    return `**** ${parts[parts.length - 1]}`;
  }
  return clean.length > 2 ? `****${clean.slice(-2)}` : '****';
}

function maskAddressValue(addr: string): string {
  const clean = addr.trim();
  if (!clean) return '****';
  const segments = clean.split(',').map(s => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    return `****, ${segments[segments.length - 1]}`;
  }
  return clean.length > 4 ? `****${clean.slice(-4)}` : '****';
}

function buildMaskedCitizenRecord(record: CitizenDatabaseRecord): CitizenDatabaseRecord {
  return {
    citizenId: maskCccdValue(record.citizenId),
    displayName: maskNameValue(record.displayName),
    dob: record.dob,
    dobRaw: record.dobRaw,
    gender: '****',
    permanentAddress: maskAddressValue(record.permanentAddress),
    currentAddress: maskAddressValue(record.currentAddress),
    fullAddress: maskAddressValue(record.fullAddress),
  };
}

function convertDobToIso(rawDob: string): string {
  const cleaned = rawDob.trim();
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const dd = match[1].padStart(2, '0');
  const mm = match[2].padStart(2, '0');
  const yyyy = match[3];
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeGender(rawGender: string): 'Nam' | 'Nữ' | 'Khác' {
  const lower = rawGender.trim().toLowerCase();
  if (lower === 'nam' || lower === 'male') return 'Nam';
  if (lower === 'nữ' || lower === 'nu' || lower === 'female') return 'Nữ';
  return 'Khác';
}

function resolveDataJsonPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'src', 'data', 'data.json'),
    path.resolve(moduleDir, '..', 'src', 'data', 'data.json'),
    path.resolve(process.cwd(), 'data', 'data.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function getCitizenIndex(): Map<string, CitizenDatabaseRecord> {
  if (cachedCitizenIndex) return cachedCitizenIndex;

  const index = new Map<string, CitizenDatabaseRecord>();
  try {
    const filePath = resolveDataJsonPath();
    if (!fs.existsSync(filePath)) {
      cachedLoadError = 'Không tìm thấy tệp cơ sở dữ liệu src/data/data.json';
      cachedCitizenIndex = index;
      return index;
    }

    const rawText = fs.readFileSync(filePath, 'utf-8');
    const parsed: RawCitizenRow[] = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        const digits = String(row['Số ĐDCN/CCCD/ CMND'] ?? '')
          .replace(/\D/g, '')
          .trim();
        if (!digits) continue;

        const dobRaw = String(row['Ngày sinh'] ?? '').trim();
        const permanentAddress = String(row['Nơi thường trú'] ?? '').trim();
        const currentAddress = String(row['Nơi ở hiện tại'] ?? '').trim();
        const fullAddress = currentAddress || permanentAddress;

        const record: CitizenDatabaseRecord = {
          citizenId: digits,
          displayName: String(row['Họ và tên'] ?? '').trim(),
          dob: convertDobToIso(dobRaw),
          dobRaw,
          gender: normalizeGender(String(row['Giới tính'] ?? '')),
          permanentAddress,
          currentAddress,
          fullAddress,
        };

        if (!index.has(digits)) {
          index.set(digits, record);
        }
      }
    }
    cachedLoadError = null;
  } catch (err: any) {
    cachedLoadError = err?.message || 'Lỗi đọc cơ sở dữ liệu công dân';
  }

  cachedCitizenIndex = index;
  return index;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ found: false, error: 'Phương thức không được hỗ trợ' });
  }

  const rawInput =
    req.method === 'POST'
      ? req.body?.citizenId ?? req.body?.cccd
      : req.query?.citizenId ?? req.query?.cccd;

  const action =
    (req.method === 'POST' ? req.body?.action : req.query?.action) === 'confirm'
      ? 'confirm'
      : 'lookup';

  const digits = String(rawInput ?? '')
    .replace(/\D/g, '')
    .trim();

  if (!digits || digits.length < 9 || digits.length > 12) {
    return res.status(400).json({
      found: false,
      citizenId: digits,
      error: 'Số CCCD/ĐDCN phải gồm từ 9 đến 12 chữ số.',
    });
  }

  const index = getCitizenIndex();
  if (cachedLoadError && index.size === 0) {
    return res.status(500).json({
      found: false,
      citizenId: digits,
      error: cachedLoadError,
    });
  }

  const record =
    index.get(digits) ||
    (digits.length < 12 ? index.get(digits.padStart(12, '0')) : undefined) ||
    null;

  if (!record) {
    return res.status(200).json({
      found: false,
      citizenId: digits,
    });
  }

  const caller = await resolveCallerRole(req.headers?.authorization);
  const canReturnFull = caller.isAdmin || (action === 'confirm' && Boolean(caller.uid));

  if (canReturnFull) {
    return res.status(200).json({
      found: true,
      isMasked: false,
      citizenId: record.citizenId,
      record,
    });
  }

  return res.status(200).json({
    found: true,
    isMasked: true,
    citizenId: maskCccdValue(record.citizenId),
    record: buildMaskedCitizenRecord(record),
  });
}
