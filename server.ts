import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as webpush from 'web-push';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface StoredPushSubscription {
  deviceId: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  uid?: string;
  citizenId?: string;
  phoneNumber?: string;
  department?: string;
  updatedAt: string;
}

const VAPID_FILE = path.resolve(__dirname, '.vapid-keys.json');
const SUBS_FILE = path.resolve(__dirname, '.push-subscriptions.json');

function initVapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
      if (parsed?.publicKey && parsed?.privateKey) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    }
  } catch {
    // regenerate if corrupt
  }
  const generated = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2), 'utf-8');
  } catch {
    // ignore fs write error in read-only env
  }
  return generated;
}

const vapidKeys = initVapidKeys();
webpush.setVapidDetails(
  'mailto:tramyte@portal.local',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function loadPushSubscriptions(): StoredPushSubscription[] {
  try {
    if (!fs.existsSync(SUBS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePushSubscriptions(list: StoredPushSubscription[]): void {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch {
    // ignore write error
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.APP_PORT || process.env.DEFAULT_APP_PORT || 3000);

  app.use(express.json({ limit: '10mb' }));

  const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

  const safeParseJsonObject = (rawText?: string): Record<string, any> | null => {
    if (!rawText || typeof rawText !== 'string') return null;
    const stripped = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    if (!stripped) return null;
    try {
      const parsed = JSON.parse(stripped);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      const firstBrace = stripped.indexOf('{');
      const lastBrace = stripped.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const normalizeGeminiKey = (raw?: unknown): string => {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'MY_GEMINI_API_KEY') return '';
    return trimmed;
  };

  const createGeminiClient = (apiKey: string) =>
    new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs = 15000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Yêu cầu Gemini AI vượt quá thời gian chờ (timeout).')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const isTransientGeminiError = (err: any): boolean => {
    const status = Number(err?.status || err?.statusCode || err?.code);
    if (status === 429 || status === 500 || status === 503 || status === 504) return true;
    const msg = String(err?.message || err || '');
    return /UNAVAILABLE|503|high demand|overloaded|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg);
  };

  const generateContentWithRetry = async (
    ai: GoogleGenAI,
    params: Parameters<GoogleGenAI['models']['generateContent']>[0],
    timeoutMs = 15000
  ) => {
    const retryDelays = [500, 1200];
    let lastErr: any;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        return await withTimeout(ai.models.generateContent(params), timeoutMs);
      } catch (err: any) {
        lastErr = err;
        if (attempt < retryDelays.length && isTransientGeminiError(err)) {
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };

  const resolveGeminiErrorStatus = (err: any): { status: number; message: string } => {
    let rawMsg = String(err?.message || err || 'Lỗi kết nối Gemini AI.');
    let parsedCode = Number(err?.status || err?.statusCode || err?.code);
    try {
      const parsed = JSON.parse(rawMsg);
      if (parsed?.error?.message) {
        rawMsg = String(parsed.error.message);
      }
      if (!parsedCode && parsed?.error?.code) {
        parsedCode = Number(parsed.error.code);
      }
    } catch {
      // keep rawMsg as-is
    }

    if (/timeout|vượt quá thời gian/i.test(rawMsg)) {
      return { status: 504, message: 'Yêu cầu Gemini AI vượt quá thời gian chờ. Vui lòng thử lại.' };
    }
    if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(rawMsg) || parsedCode === 403) {
      return { status: 403, message: 'GEMINI_API_KEY không hợp lệ hoặc chưa đủ quyền (kiểm tra Settings > Secrets).' };
    }
    if (/RESOURCE_EXHAUSTED/i.test(rawMsg) || parsedCode === 429) {
      return { status: 429, message: 'Đã vượt giới hạn lưu lượng Gemini API (429). Vui lòng thử lại sau.' };
    }
    if (/UNAVAILABLE|high demand/i.test(rawMsg) || parsedCode === 503) {
      return { status: 503, message: 'Máy chủ Gemini AI đang cao tải tạm thời (503). Vui lòng thử lại sau ít giây.' };
    }
    if (parsedCode >= 400 && parsedCode < 600) {
      return { status: parsedCode, message: rawMsg };
    }
    return { status: 502, message: rawMsg };
  };

  // --- BHXH Việt Nam Gateway Proxy (CV 366/BHXH-CNTT & nâng cấp 2024: CV 1923/BHXH-CNTT - KQNhanLichSuKCB2024) ---
  const BHXH_CONFIG_FILE = path.resolve(__dirname, '.bhxh-api-config.json');
  const DEFAULT_BHXH_BASE_URL = 'https://egw.baohiemxahoi.gov.vn';
  type BhxhLookupEndpoint = 'KQNhanLichSuKCB2024' | 'NhanLichSuKCB2024' | 'NhanLichSuKCB2018';

  const normalizeBhxhLookupEndpoint = (raw?: unknown): BhxhLookupEndpoint => {
    const str = typeof raw === 'string' ? raw.trim() : '';
    if (str === 'NhanLichSuKCB2024') return 'NhanLichSuKCB2024';
    if (str === 'NhanLichSuKCB2018') return 'NhanLichSuKCB2018';
    return 'KQNhanLichSuKCB2024';
  };

  interface ServerBhxhConfig {
    enabled: boolean;
    baseUrl: string;
    lookupEndpoint: BhxhLookupEndpoint;
    username: string;
    passwordMd5: string;
    defaultMaCskcb: string;
    defaultHoTenCb: string;
    defaultCccdCb: string;
    autoLookupFacilityName: boolean;
    showHistoryKcb: boolean;
    updatedAt?: string;
  }

  const normalizeBhxhBaseUrl = (raw?: unknown): string => {
    const str = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
    if (!str) return DEFAULT_BHXH_BASE_URL;
    try {
      const parsed = new URL(str);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return DEFAULT_BHXH_BASE_URL;
      }
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
      return DEFAULT_BHXH_BASE_URL;
    }
  };

  const toMd5Upper = (raw: string): string =>
    crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();

  const loadBhxhConfig = (): ServerBhxhConfig => {
    let fileCfg: Partial<ServerBhxhConfig> = {};
    try {
      if (fs.existsSync(BHXH_CONFIG_FILE)) {
        fileCfg = JSON.parse(fs.readFileSync(BHXH_CONFIG_FILE, 'utf-8')) || {};
      }
    } catch {
      fileCfg = {};
    }
    const envUser = String(process.env.BHXH_USERNAME || '').trim();
    const envPassMd5 = String(process.env.BHXH_PASSWORD_MD5 || '').trim().toUpperCase();
    const envBaseUrl = process.env.BHXH_API_BASE_URL;
    const envEndpoint = process.env.BHXH_LOOKUP_ENDPOINT;
    const envMaCskcb = String(process.env.BHXH_MACSKCB || '').trim();
    const envHoTenCb = String(process.env.BHXH_HOTEN_CB || '').trim();
    const envCccdCb = String(process.env.BHXH_CCCD_CB || '').trim();

    return {
      enabled: Boolean(fileCfg.enabled ?? (envUser && envPassMd5)),
      baseUrl: normalizeBhxhBaseUrl(fileCfg.baseUrl || envBaseUrl),
      lookupEndpoint: normalizeBhxhLookupEndpoint(fileCfg.lookupEndpoint || envEndpoint),
      username: String(fileCfg.username ?? envUser).trim(),
      passwordMd5: String(fileCfg.passwordMd5 ?? envPassMd5).trim().toUpperCase(),
      defaultMaCskcb: String(fileCfg.defaultMaCskcb ?? envMaCskcb).trim(),
      defaultHoTenCb: String(fileCfg.defaultHoTenCb ?? envHoTenCb).trim(),
      defaultCccdCb: String(fileCfg.defaultCccdCb ?? envCccdCb).replace(/\s+/g, '').trim(),
      autoLookupFacilityName: fileCfg.autoLookupFacilityName !== false,
      showHistoryKcb: fileCfg.showHistoryKcb !== false,
      updatedAt: fileCfg.updatedAt,
    };
  };

  const saveBhxhConfig = (cfg: ServerBhxhConfig): void => {
    fs.writeFileSync(BHXH_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  };

  const maskUsername = (u: string): string => {
    if (!u) return '';
    if (u.length <= 3) return `${u[0]}***`;
    return `${u.slice(0, 3)}***${u.slice(-2)}`;
  };

  const getFirebaseAppletCfg = () => {
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      }
    } catch {
      // ignore
    }
    return {};
  };

  const BOOTSTRAP_ADMIN_SET = new Set([
    'sonlyhongduc@gmail.com',
    'sonlyhongduc2003@gmail.com',
    'tytvtd@gmail.com',
  ]);

  const verifyFirebaseRole = async (
    authHeader?: string
  ): Promise<{ isAdmin: boolean; isStaff: boolean; email?: string; error?: string }> => {
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return { isAdmin: false, isStaff: false, error: 'Thiếu mã xác thực Quản trị viên (Bearer token).' };
    }
    const fbCfg = getFirebaseAppletCfg();
    if (!fbCfg?.apiKey) {
      return { isAdmin: false, isStaff: false, error: 'Không tìm thấy cấu hình Firebase API Key máy chủ.' };
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
        return { isAdmin: false, isStaff: false, error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' };
      }
      const data = (await resp.json()) as { users?: Array<{ localId?: string; email?: string }> };
      const user = data?.users?.[0];
      if (!user?.localId) {
        return { isAdmin: false, isStaff: false, error: 'Không xác minh được danh tính tài khoản Firebase.' };
      }
      const email = String(user.email || '').trim().toLowerCase();
      if (BOOTSTRAP_ADMIN_SET.has(email)) {
        return { isAdmin: true, isStaff: true, email };
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
          return { isAdmin: true, isStaff: true, email };
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
          const docIsAdmin = role === 'admin' || role === 'super_admin' || accountType === 'admin';
          const docIsStaff =
            docIsAdmin ||
            accountType === 'employee' ||
            ['doctor', 'nurse', 'communicator', 'staff', 'leadership'].includes(role);
          return { isAdmin: docIsAdmin, isStaff: docIsStaff, email };
        }
      }
      return {
        isAdmin: false,
        isStaff: false,
        email,
        error: 'Chỉ Quản trị viên hệ thống mới có quyền cấu hình tài khoản kết nối BHXH.',
      };
    } catch (err: any) {
      return { isAdmin: false, isStaff: false, error: err?.message || 'Lỗi xác minh quyền Quản trị viên.' };
    }
  };

  interface CachedBhxhToken {
    accessToken: string;
    idToken: string;
    expiresAtMs: number;
    maKetQua: string;
    username: string;
    expiresIn?: string;
    cacheKey: string;
  }
  let cachedBhxhToken: CachedBhxhToken | null = null;

  const BHXH_CARD_STATUS_MAP: Record<
    string,
    { code: string; description: string; severity: 'valid' | 'warning' | 'error' }
  > = {
    '000': { code: '000', description: 'Thẻ còn giá trị sử dụng', severity: 'valid' },
    '001': {
      code: '001',
      description: 'Thẻ do BHXH Bộ Quốc Phòng quản lý, đề nghị kiểm tra thẻ và thông tin giấy tờ tùy thân',
      severity: 'warning',
    },
    '002': {
      code: '002',
      description: 'Thẻ do BHXH Bộ Công An quản lý, đề nghị kiểm tra thẻ và thông tin giấy tờ tùy thân',
      severity: 'warning',
    },
    '003': {
      code: '003',
      description: 'Thẻ cũ hết giá trị sử dụng nhưng đã được cấp thẻ mới',
      severity: 'warning',
    },
    '004': {
      code: '004',
      description: 'Thẻ cũ còn giá trị sử dụng nhưng đã được cấp thẻ mới',
      severity: 'valid',
    },
    '005': { code: '005', description: 'Không có quyền tra cứu thông tin thẻ BHYT', severity: 'error' },
    '006': { code: '006', description: 'Không có quyền tra cứu lịch sử khám chữa bệnh', severity: 'error' },
    '007': {
      code: '007',
      description: 'Không tìm thấy hoặc chưa phân quyền thông tin cán bộ tra cứu (hoTenCb / cccdCb)',
      severity: 'error',
    },
    '008': {
      code: '008',
      description: 'Lỗi xác thực thông tin cán bộ thực hiện tra cứu (hoTenCb / cccdCb)',
      severity: 'error',
    },
    '009': {
      code: '009',
      description: 'Tài khoản hoặc thông tin cán bộ tra cứu không hợp lệ / đã bị khóa',
      severity: 'error',
    },
    '010': { code: '010', description: 'Thẻ hết giá trị sử dụng', severity: 'error' },
    '051': { code: '051', description: 'Mã thẻ không đúng', severity: 'error' },
    '052': {
      code: '052',
      description: 'Mã tỉnh cấp thẻ (kí tự thứ 4,5 của mã thẻ) không đúng',
      severity: 'error',
    },
    '053': {
      code: '053',
      description: 'Mã quyền lợi thẻ (kí tự thứ 3 của mã thẻ) không đúng',
      severity: 'error',
    },
    '054': {
      code: '054',
      description: 'Số CCCD của cán bộ thực hiện tra cứu không tồn tại trong danh sách người sử dụng do CSKCB đăng ký',
      severity: 'error',
    },
    '055': {
      code: '055',
      description: 'Họ và tên của cán bộ thực hiện tra cứu không khớp với số CCCD',
      severity: 'error',
    },
    '050': { code: '050', description: 'Không thấy thông tin thẻ BHYT', severity: 'error' },
    '060': { code: '060', description: 'Thẻ sai họ tên', severity: 'error' },
    '061': { code: '061', description: 'Thẻ sai họ tên (đúng kí tự đầu)', severity: 'error' },
    '070': { code: '070', description: 'Thẻ sai ngày sinh', severity: 'error' },
    '100': { code: '100', description: 'Lỗi khi lấy dữ liệu sổ thẻ', severity: 'error' },
    '101': { code: '101', description: 'Lỗi server', severity: 'error' },
    '110': { code: '110', description: 'Thẻ đã thu hồi', severity: 'error' },
    '120': { code: '120', description: 'Thẻ đã báo giảm', severity: 'error' },
    '121': {
      code: '121',
      description: 'Thẻ đã báo giảm. Giảm chuyển ngoại tỉnh',
      severity: 'error',
    },
    '122': {
      code: '122',
      description: 'Thẻ đã báo giảm. Giảm chuyển nội tỉnh',
      severity: 'error',
    },
    '123': {
      code: '123',
      description: 'Thẻ đã báo giảm. Thu hồi do tăng lại cùng đơn vị',
      severity: 'error',
    },
    '124': {
      code: '124',
      description: 'Thẻ đã báo giảm. Ngừng tham gia',
      severity: 'error',
    },
    '130': { code: '130', description: 'Trẻ em không xuất trình thẻ', severity: 'warning' },
    '205': { code: '205', description: 'Lỗi sai định dạng tham số truyền vào', severity: 'error' },
    '401': { code: '401', description: 'Lỗi xác thực tài khoản', severity: 'error' },
    '403': {
      code: '403',
      description: 'Địa chỉ IP hoặc tài khoản chưa được cấp quyền gọi API KQNhanLichSuKCB2024',
      severity: 'error',
    },
    '500': { code: '500', description: 'Lỗi máy chủ Cổng tiếp nhận dữ liệu BHXH', severity: 'error' },
  };

  const translateBhxhNetworkError = (err: any): string => {
    if (err?.name === 'AbortError') {
      return 'Quá thời gian chờ phản hồi từ Cổng Giám định BHYT (15 giây)';
    }
    const code = String(err?.cause?.code || err?.code || '').toUpperCase();
    const rawMsg = String(err?.message || '');
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(rawMsg)) {
      return 'Máy chủ Cổng BHXH từ chối kết nối';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/i.test(rawMsg)) {
      return 'Không tìm thấy địa chỉ máy chủ Cổng BHXH (lỗi DNS)';
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || /timeout/i.test(rawMsg)) {
      return 'Kết nối tới Cổng BHXH bị quá thời gian';
    }
    if (code === 'ECONNRESET' || /ECONNRESET|socket hang up/i.test(rawMsg)) {
      return 'Kết nối tới Cổng BHXH bị ngắt đột ngột';
    }
    return 'Không thể kết nối tới máy chủ Cổng BHXH (vui lòng kiểm tra IP/mạng kết nối tới BHXH Việt Nam)';
  };

  const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const takeBhxhToken = async (cfg: ServerBhxhConfig, forceRefresh = false): Promise<CachedBhxhToken> => {
    if (!cfg.username || !cfg.passwordMd5) {
      throw new Error(
        'Chưa khai báo Tài khoản (username) và Mật khẩu MD5 kết nối Cổng Giám định BHYT trong Bảng Quản trị.'
      );
    }
    const cacheKey = `${cfg.baseUrl}|${cfg.username}|${cfg.passwordMd5}`;
    if (
      !forceRefresh &&
      cachedBhxhToken &&
      cachedBhxhToken.cacheKey === cacheKey &&
      Date.now() < cachedBhxhToken.expiresAtMs - 60_000
    ) {
      return cachedBhxhToken;
    }

    const tokenUrl = `${cfg.baseUrl}/api/token/take`;
    let res: Response;
    try {
      res = await fetchWithTimeout(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          username: cfg.username,
          password: cfg.passwordMd5,
        }),
      });
    } catch (err: any) {
      throw new Error(
        `Không thể kết nối đến Cổng BHXH (${tokenUrl}): ${translateBhxhNetworkError(err)}.`
      );
    }

    const rawText = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(rawText);
    } catch {
      throw new Error(`Cổng BHXH (/api/token/take) trả về mã HTTP ${res.status} với dữ liệu không hợp lệ.`);
    }

    const maKetQua = String(json?.maKetQua ?? json?.maketqua ?? '');
    const apiKey = json?.APIKey || json?.apiKey;
    if (!res.ok || !apiKey?.access_token || !apiKey?.id_token) {
      throw new Error(
        `Xác thực tài khoản BHXH thất bại (Mã ${maKetQua || res.status}): ${
          json?.message || 'Vui lòng kiểm tra lại tên đăng nhập và mật khẩu MD5 theo Công văn 366/BHXH-CNTT.'
        }`
      );
    }

    let expiresAtMs = Date.now() + 25 * 60 * 1000;
    if (apiKey.expires_in) {
      const parsedExp = Date.parse(String(apiKey.expires_in));
      if (!Number.isNaN(parsedExp) && parsedExp > Date.now() + 30_000) {
        expiresAtMs = parsedExp;
      }
    }

    cachedBhxhToken = {
      accessToken: String(apiKey.access_token),
      idToken: String(apiKey.id_token),
      expiresAtMs,
      maKetQua: maKetQua || '200',
      username: String(apiKey.username || cfg.username),
      expiresIn: apiKey.expires_in ? String(apiKey.expires_in) : undefined,
      cacheKey,
    };
    return cachedBhxhToken;
  };

  const callNhanThongTinCSKCB = async (
    cfg: ServerBhxhConfig,
    macskcb: string,
    retried = false
  ): Promise<Record<string, any>> => {
    const tok = await takeBhxhToken(cfg, retried);
    const qs = new URLSearchParams({
      username: cfg.username,
      password: cfg.passwordMd5,
      token: tok.accessToken,
      id_token: tok.idToken,
      macskcb: macskcb.trim(),
    });
    const url = `${cfg.baseUrl}/api/egw/NhanThongTinCSKCB?${qs.toString()}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });
    } catch (err: any) {
      throw new Error(`Lỗi kết nối hàm NhanThongTinCSKCB (${cfg.baseUrl}): ${translateBhxhNetworkError(err)}.`);
    }

    if (res.status === 401 && !retried) {
      cachedBhxhToken = null;
      return callNhanThongTinCSKCB(cfg, macskcb, true);
    }
    const json = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!json) {
      throw new Error(`Hàm NhanThongTinCSKCB trả về mã HTTP ${res.status} không hợp lệ.`);
    }
    if (String(json.maketqua ?? json.maKetQua ?? '') === '401' && !retried) {
      cachedBhxhToken = null;
      return callNhanThongTinCSKCB(cfg, macskcb, true);
    }
    return json;
  };

  const callNhanLichSuKCB = async (
    cfg: ServerBhxhConfig,
    payload: {
      maThe: string;
      hoTen: string;
      ngaySinh: string;
      hoTenCb?: string;
      cccdCb?: string;
    },
    retried = false
  ): Promise<{ endpointName: BhxhLookupEndpoint; data: Record<string, any> }> => {
    const tok = await takeBhxhToken(cfg, retried);
    const endpointName = cfg.lookupEndpoint || 'KQNhanLichSuKCB2024';
    const is2024 = endpointName === 'KQNhanLichSuKCB2024' || endpointName === 'NhanLichSuKCB2024';

    const qs = new URLSearchParams({
      token: tok.accessToken,
      id_token: tok.idToken,
      username: cfg.username,
      password: cfg.passwordMd5,
    });
    const url = `${cfg.baseUrl}/api/egw/${endpointName}?${qs.toString()}`;

    const requestBody: Record<string, string> = {
      maThe: payload.maThe,
      hoTen: payload.hoTen,
      ngaySinh: payload.ngaySinh,
    };
    if (is2024) {
      requestBody.hoTenCb = (payload.hoTenCb || cfg.defaultHoTenCb || '').trim();
      requestBody.cccdCb = (payload.cccdCb || cfg.defaultCccdCb || '').replace(/\s+/g, '').trim();
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    } catch (err: any) {
      throw new Error(
        `Không thể kết nối tới Cổng Giám định BHYT (${cfg.baseUrl}/api/egw/${endpointName}): ${translateBhxhNetworkError(err)}.`
      );
    }

    if (res.status === 401 && !retried) {
      cachedBhxhToken = null;
      return callNhanLichSuKCB(cfg, payload, true);
    }

    if (res.status === 403) {
      throw new Error(
        `Cổng BHXH (/api/egw/${endpointName}) từ chối truy cập (403). Vui lòng kiểm tra đăng ký IP tĩnh và phân quyền tài khoản cán bộ theo Công văn 1923/BHXH-CNTT.`
      );
    }

    const json = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!json) {
      throw new Error(
        `Cổng Giám định BHYT (/api/egw/${endpointName}) trả về mã HTTP ${res.status} với dữ liệu không hợp lệ.`
      );
    }
    if (String(json.maKetQua ?? json.maketqua ?? '') === '401' && !retried) {
      cachedBhxhToken = null;
      return callNhanLichSuKCB(cfg, payload, true);
    }
    return { endpointName, data: json };
  };

  app.get('/api/bhxh/status', (_req, res) => {
    const cfg = loadBhxhConfig();
    const configured = Boolean(cfg.username && cfg.passwordMd5 && cfg.baseUrl);
    const hasOfficerInfo = Boolean(cfg.defaultHoTenCb && /^\d{12}$/.test(cfg.defaultCccdCb));
    return res.json({
      enabled: cfg.enabled,
      configured,
      baseUrl: cfg.baseUrl,
      lookupEndpoint: cfg.lookupEndpoint,
      defaultMaCskcb: cfg.defaultMaCskcb,
      usernameMasked: maskUsername(cfg.username),
      hasCredentials: configured,
      hasOfficerInfo,
      autoLookupFacilityName: cfg.autoLookupFacilityName,
      showHistoryKcb: cfg.showHistoryKcb,
      updatedAt: cfg.updatedAt,
    });
  });

  app.get('/api/bhxh/admin-config', async (req, res) => {
    const roleCheck = await verifyFirebaseRole(req.headers.authorization);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ error: roleCheck.error || 'Bạn không có quyền Quản trị viên.' });
    }
    const cfg = loadBhxhConfig();
    return res.json({
      enabled: cfg.enabled,
      configured: Boolean(cfg.username && cfg.passwordMd5 && cfg.baseUrl),
      baseUrl: cfg.baseUrl,
      lookupEndpoint: cfg.lookupEndpoint,
      username: cfg.username,
      hasPassword: Boolean(cfg.passwordMd5),
      defaultMaCskcb: cfg.defaultMaCskcb,
      defaultHoTenCb: cfg.defaultHoTenCb,
      defaultCccdCb: cfg.defaultCccdCb,
      autoLookupFacilityName: cfg.autoLookupFacilityName,
      showHistoryKcb: cfg.showHistoryKcb,
      updatedAt: cfg.updatedAt,
    });
  });

  app.post('/api/bhxh/config', async (req, res) => {
    const roleCheck = await verifyFirebaseRole(req.headers.authorization);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ error: roleCheck.error || 'Bạn không có quyền Quản trị viên.' });
    }
    const existing = loadBhxhConfig();
    const body = req.body || {};

    let nextPasswordMd5 = existing.passwordMd5;
    if (body.clearPassword) {
      nextPasswordMd5 = '';
    } else if (typeof body.password === 'string' && body.password.trim()) {
      const raw = body.password.trim();
      if (body.passwordMode === 'md5') {
        if (!/^[a-fA-F0-9]{32}$/.test(raw)) {
          return res.status(400).json({
            error: 'Chuỗi MD5 phải gồm đúng 32 ký tự hệ thập lục phân (0-9, A-F).',
          });
        }
        nextPasswordMd5 = raw.toUpperCase();
      } else {
        nextPasswordMd5 = toMd5Upper(raw);
      }
    }

    const nextCccdCb = String(body.defaultCccdCb ?? existing.defaultCccdCb).replace(/\s+/g, '').trim();
    if (nextCccdCb && !/^\d{12}$/.test(nextCccdCb)) {
      return res.status(400).json({
        error: 'Số CCCD cán bộ tra cứu (cccdCb) phải gồm đúng 12 chữ số.',
      });
    }

    const updated: ServerBhxhConfig = {
      enabled: Boolean(body.enabled),
      baseUrl: normalizeBhxhBaseUrl(body.baseUrl ?? existing.baseUrl),
      lookupEndpoint: normalizeBhxhLookupEndpoint(body.lookupEndpoint ?? existing.lookupEndpoint),
      username: String(body.username ?? existing.username).trim(),
      passwordMd5: nextPasswordMd5,
      defaultMaCskcb: String(body.defaultMaCskcb ?? existing.defaultMaCskcb).trim(),
      defaultHoTenCb: String(body.defaultHoTenCb ?? existing.defaultHoTenCb).trim(),
      defaultCccdCb: nextCccdCb,
      autoLookupFacilityName: body.autoLookupFacilityName !== false,
      showHistoryKcb: body.showHistoryKcb !== false,
      updatedAt: new Date().toISOString(),
    };

    try {
      saveBhxhConfig(updated);
      cachedBhxhToken = null;
      return res.json({
        ok: true,
        config: {
          enabled: updated.enabled,
          configured: Boolean(updated.username && updated.passwordMd5 && updated.baseUrl),
          baseUrl: updated.baseUrl,
          lookupEndpoint: updated.lookupEndpoint,
          username: updated.username,
          hasPassword: Boolean(updated.passwordMd5),
          defaultMaCskcb: updated.defaultMaCskcb,
          defaultHoTenCb: updated.defaultHoTenCb,
          defaultCccdCb: updated.defaultCccdCb,
          autoLookupFacilityName: updated.autoLookupFacilityName,
          showHistoryKcb: updated.showHistoryKcb,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Không thể lưu cấu hình API BHXH.' });
    }
  });

  app.get('/api/bhxh/backup-export', async (req, res) => {
    const roleCheck = await verifyFirebaseRole(req.headers.authorization);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ error: roleCheck.error || 'Bạn không có quyền Quản trị viên.' });
    }
    const cfg = loadBhxhConfig();
    const hasConfigured = Boolean(
      cfg.enabled ||
        cfg.username ||
        cfg.passwordMd5 ||
        cfg.defaultMaCskcb ||
        cfg.defaultHoTenCb ||
        cfg.defaultCccdCb
    );
    return res.json({
      ok: true,
      hasConfigured,
      record: hasConfigured
        ? {
            id: 'bhxh_gateway',
            enabled: cfg.enabled,
            baseUrl: cfg.baseUrl,
            lookupEndpoint: cfg.lookupEndpoint,
            username: cfg.username,
            passwordMd5: cfg.passwordMd5,
            defaultMaCskcb: cfg.defaultMaCskcb,
            defaultHoTenCb: cfg.defaultHoTenCb,
            defaultCccdCb: cfg.defaultCccdCb,
            autoLookupFacilityName: cfg.autoLookupFacilityName,
            showHistoryKcb: cfg.showHistoryKcb,
            updatedAt: cfg.updatedAt || new Date().toISOString(),
          }
        : null,
    });
  });

  app.post('/api/bhxh/backup-restore', async (req, res) => {
    const roleCheck = await verifyFirebaseRole(req.headers.authorization);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ error: roleCheck.error || 'Bạn không có quyền Quản trị viên.' });
    }
    const body = req.body?.record || req.body || {};
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Dữ liệu cấu hình BHXH sao lưu không hợp lệ.' });
    }
    const existing = loadBhxhConfig();
    const nextCccdCb = String(body.defaultCccdCb ?? existing.defaultCccdCb)
      .replace(/\s+/g, '')
      .trim();
    if (nextCccdCb && !/^\d{12}$/.test(nextCccdCb)) {
      return res.status(400).json({ error: 'Số CCCD cán bộ tra cứu (cccdCb) không hợp lệ.' });
    }
    const rawPassMd5 =
      typeof body.passwordMd5 === 'string' && body.passwordMd5.trim()
        ? body.passwordMd5.trim().toUpperCase()
        : existing.passwordMd5;
    if (rawPassMd5 && !/^[a-fA-F0-9]{32}$/.test(rawPassMd5)) {
      return res.status(400).json({ error: 'Định dạng mật khẩu MD5 trong bản sao lưu không hợp lệ.' });
    }
    const updated: ServerBhxhConfig = {
      enabled: Boolean(body.enabled),
      baseUrl: normalizeBhxhBaseUrl(body.baseUrl ?? existing.baseUrl),
      lookupEndpoint: normalizeBhxhLookupEndpoint(body.lookupEndpoint ?? existing.lookupEndpoint),
      username: String(body.username ?? existing.username).trim(),
      passwordMd5: rawPassMd5,
      defaultMaCskcb: String(body.defaultMaCskcb ?? existing.defaultMaCskcb).trim(),
      defaultHoTenCb: String(body.defaultHoTenCb ?? existing.defaultHoTenCb).trim(),
      defaultCccdCb: nextCccdCb,
      autoLookupFacilityName: body.autoLookupFacilityName !== false,
      showHistoryKcb: body.showHistoryKcb !== false,
      updatedAt: typeof body.updatedAt === 'string' && body.updatedAt ? body.updatedAt : new Date().toISOString(),
    };
    try {
      saveBhxhConfig(updated);
      cachedBhxhToken = null;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Không thể khôi phục cấu hình API BHXH.' });
    }
  });

  app.post('/api/bhxh/test-token', async (req, res) => {
    const roleCheck = await verifyFirebaseRole(req.headers.authorization);
    if (!roleCheck.isAdmin) {
      return res.status(403).json({ error: roleCheck.error || 'Bạn không có quyền Quản trị viên.' });
    }
    const cfg = loadBhxhConfig();
    try {
      const tok = await takeBhxhToken(cfg, true);
      return res.json({
        ok: true,
        maKetQua: tok.maKetQua,
        username: tok.username,
        expiresIn: tok.expiresIn,
        message: 'Lấy phiên làm việc (access_token & id_token) từ Cổng Giám định BHYT thành công.',
      });
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Không thể lấy Token BHXH.' });
    }
  });

  app.post('/api/bhxh/cskcb', async (req, res) => {
    const cfg = loadBhxhConfig();
    const roleCheck = req.headers.authorization
      ? await verifyFirebaseRole(req.headers.authorization)
      : { isAdmin: false, isStaff: false };

    if (!cfg.enabled && !roleCheck.isAdmin) {
      return res.status(400).json({
        error: 'Tính năng kết nối API BHXH (Công văn 366) hiện chưa được kích hoạt.',
      });
    }
    if (!cfg.username || !cfg.passwordMd5) {
      return res.status(400).json({
        error: 'Chưa cấu hình tài khoản & mật khẩu MD5 kết nối Cổng BHXH trong Bảng Quản trị.',
      });
    }
    const macskcb = String(req.body?.macskcb || cfg.defaultMaCskcb || '').trim();
    if (!macskcb) {
      return res.status(400).json({ error: 'Vui lòng nhập Mã cơ sở KCB (macskcb).' });
    }
    try {
      const data = await callNhanThongTinCSKCB(cfg, macskcb);
      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Tra cứu NhanThongTinCSKCB thất bại.' });
    }
  });

  app.post('/api/bhxh/lookup', async (req, res) => {
    const cfg = loadBhxhConfig();
    const roleCheck = req.headers.authorization
      ? await verifyFirebaseRole(req.headers.authorization)
      : { isAdmin: false, isStaff: false };

    if (!cfg.enabled && !roleCheck.isAdmin) {
      return res.status(400).json({
        error:
          'Cổng tra cứu BHYT trực tuyến hiện đang TẮT. Quản trị viên cần bật và khai báo tài khoản Cổng Giám định BHYT trong Bảng Quản trị.',
      });
    }
    if (!cfg.username || !cfg.passwordMd5) {
      return res.status(400).json({
        error:
          'Hệ thống chưa được cấu hình Tài khoản & Mật khẩu MD5 kết nối API BHXH. Vui lòng liên hệ Quản trị viên Trạm Y tế.',
      });
    }

    const maThe = String(req.body?.maThe || '').trim().toUpperCase();
    const hoTen = String(req.body?.hoTen || '').trim();
    const rawDob = String(req.body?.ngaySinh || '').trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDob);
    const dmyCompact = /^(\d{2})(\d{2})(\d{4})$/.exec(rawDob);
    const ngaySinh = isoMatch
      ? `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
      : dmyCompact
      ? `${dmyCompact[1]}/${dmyCompact[2]}/${dmyCompact[3]}`
      : rawDob;

    if (!maThe || !hoTen || !ngaySinh) {
      return res.status(400).json({
        error: 'Vui lòng nhập đầy đủ Số CCCD / Mã thẻ BHYT, Họ và tên, và Ngày sinh (DD/MM/YYYY hoặc YYYY).',
      });
    }
    if (!/^\d{4}$/.test(ngaySinh) && !/^\d{2}\/\d{2}\/\d{4}$/.test(ngaySinh)) {
      return res.status(400).json({
        error: 'Ngày sinh phải đúng định dạng DD/MM/YYYY hoặc năm sinh YYYY.',
      });
    }

    const endpointName = cfg.lookupEndpoint || 'KQNhanLichSuKCB2024';
    const is2024 = endpointName === 'KQNhanLichSuKCB2024' || endpointName === 'NhanLichSuKCB2024';
    const canOverrideOfficer = roleCheck.isAdmin || roleCheck.isStaff;
    const hoTenCb = (
      canOverrideOfficer && typeof req.body?.hoTenCb === 'string' && req.body.hoTenCb.trim()
        ? req.body.hoTenCb
        : cfg.defaultHoTenCb
    ).trim();
    const cccdCb = (
      canOverrideOfficer && typeof req.body?.cccdCb === 'string' && req.body.cccdCb.trim()
        ? req.body.cccdCb
        : cfg.defaultCccdCb
    )
      .replace(/\s+/g, '')
      .trim();

    if (is2024 && (!hoTenCb || !/^\d{12}$/.test(cccdCb))) {
      return res.status(400).json({
        error:
          'API KQNhanLichSuKCB2024 yêu cầu cấu hình Họ tên cán bộ (hoTenCb) và CCCD 12 số của cán bộ tra cứu (cccdCb) trong Bảng Quản trị (theo Công văn 1923/BHXH-CNTT).',
      });
    }

    try {
      const { endpointName: usedEndpoint, data: rawResult } = await callNhanLichSuKCB(cfg, {
        maThe,
        hoTen,
        ngaySinh,
        hoTenCb,
        cccdCb,
      });
      const code = String(rawResult.maKetQua ?? rawResult.maketqua ?? '').trim();
      const statusInfo = BHXH_CARD_STATUS_MAP[code] || {
        code: code || 'UNKNOWN',
        description: rawResult.ghiChu || 'Mã phản hồi khác từ Cổng Giám định BHYT.',
        severity: code.startsWith('00') ? 'valid' : 'error',
      };

      let dkbdFacility: Record<string, any> | null = null;
      const maDKBD = typeof rawResult.maDKBD === 'string' ? rawResult.maDKBD.trim() : '';
      if (cfg.autoLookupFacilityName && maDKBD) {
        try {
          const facRes = await callNhanThongTinCSKCB(cfg, maDKBD);
          if (String(facRes?.maketqua ?? facRes?.maKetQua ?? '') === '200') {
            dkbdFacility = facRes;
          }
        } catch {
          // non-fatal enrichment failure
        }
      }

      const includeHistory = cfg.showHistoryKcb || roleCheck.isAdmin || roleCheck.isStaff;
      const normalizedKcb =
        rawResult.dsLichSuKCB2024 ?? rawResult.dsLichSuKCB2018 ?? rawResult.dsLichSuKCB ?? null;
      const normalizedKt =
        rawResult.dsLichSuKT2024 ?? rawResult.dsLichSuKT2018 ?? rawResult.dsLichSuKT ?? null;

      return res.json({
        ok: true,
        data: {
          ...rawResult,
          maKetQua: code,
          endpointUsed: usedEndpoint,
          dsLichSuKCB2024: includeHistory ? rawResult.dsLichSuKCB2024 ?? null : null,
          dsLichSuKT2024: includeHistory ? rawResult.dsLichSuKT2024 ?? null : null,
          dsLichSuKCB2018: includeHistory ? rawResult.dsLichSuKCB2018 ?? null : null,
          dsLichSuKT2018: includeHistory ? rawResult.dsLichSuKT2018 ?? null : null,
          dsLichSuKCB: includeHistory ? normalizedKcb : null,
          dsLichSuKT: includeHistory ? normalizedKt : null,
          statusInfo,
          dkbdFacility,
          queriedAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      return res.status(502).json({
        error: err?.message || 'Lỗi kết nối Cổng tiếp nhận dữ liệu Giám định BHYT.',
      });
    }
  });

  // API endpoint for AI Smart Need Finder
  app.post('/api/ai/suggest-needs', async (req, res) => {
    try {
      const { userQuery, role } = req.body || {};
      if (!userQuery || typeof userQuery !== 'string') {
        return res.status(400).json({ error: 'Nhu cầu không được để trống' });
      }

      const apiKey = normalizeGeminiKey(process.env.GEMINI_API_KEY);
      if (!apiKey) {
        return res.status(503).json({
          error: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ (Settings > Secrets).',
        });
      }

      const ai = createGeminiClient(apiKey);
      const prompt = `Bạn là Trợ lý Phân Loại Nhu Cầu của Cổng Thông Tin Điện Tử Trạm Y Tế Xã/Phường.
Người dùng (vai trò: ${role || 'công dân'}) nhập yêu cầu: "${userQuery}".

Hãy phân tích nhu cầu và trả về JSON gợi ý tính năng phù hợp nhất trong hệ thống.
Các target có thể chọn:
- portal: Trang chủ & Giới thiệu trạm
- duty: Lịch trực 24/7 công khai trạm y tế
- map: Bản đồ định vị & Chỉ đường trạm y tế
- telehealth: Ứng dụng Bác sĩ cho mọi nhà (tư vấn trực tuyến)
- news: Tin tức truyền thông y tế
- documents: Văn bản biểu mẫu khai báo
- feedback: Gửi ý kiến phản ánh BHYT, dịch vụ
- tracking: Tra cứu tiến độ giải quyết phản ánh
- workspace: Bàn làm việc y tế (dành cho cán bộ)`;

      const response = await generateContentWithRetry(
        ai,
        {
          model: DEFAULT_GEMINI_MODEL,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                suggestedTarget: { type: Type.STRING },
                reasoning: { type: Type.STRING },
                recommendedActions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      target: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        },
        10000
      );

      const parsedData = safeParseJsonObject(response.text);
      if (!parsedData || !parsedData.suggestedTarget) {
        return res.status(502).json({ error: 'Gemini AI trả về định dạng JSON không hợp lệ.' });
      }

      return res.json(parsedData);
    } catch (error: any) {
      console.error('AI Suggestion Server Error:', error?.message || error);
      const { status, message } = resolveGeminiErrorStatus(error);
      return res.status(status).json({ error: message });
    }
  });

  // API endpoint for AI Integration & Diagnostics Status
  app.get('/api/ai/status', (_req, res) => {
    const rawKey = normalizeGeminiKey(process.env.GEMINI_API_KEY);
    const configured = Boolean(rawKey);
    return res.json({
      ok: true,
      configured,
      model: DEFAULT_GEMINI_MODEL,
      provider: 'Google Gemini AI',
      configuredVia: 'Biến môi trường bảo mật AI Studio (GEMINI_API_KEY)',
      statusMessage: configured
        ? 'Sẵn sàng tự động đọc, quét và trích xuất thông tin văn bản khi tải lên'
        : 'Chưa cấu hình GEMINI_API_KEY trên môi trường máy chủ (Settings > Secrets)',
      capabilities: [
        'Tự động đọc & quét tài liệu đa phương thức (PDF, Word, Ảnh văn bản)',
        'Trích xuất tự động: Số hiệu, Tiêu đề, Ngày ban hành, Cơ quan ban hành, Thể loại, Tóm tắt',
        'Giao diện hiển thị văn bản 1 dòng chuẩn hóa kèm chức năng xem chi tiết',
        'Trợ lý thông minh phân loại và gợi ý dịch vụ y tế cho công dân',
      ],
      updatedAt: new Date().toISOString(),
    });
  });

  // API endpoint for AI Document Scanner
  app.post('/api/ai/scan-document', async (req, res) => {
    const docNameRaw = req.body?.fileName || req.body?.filename || '';
    const cleanBaseTitle = docNameRaw
      ? String(docNameRaw).replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim()
      : 'Văn bản y tế';

    try {
      const { textContent, filename, fileName, fileBase64, mimeType } = req.body || {};
      const effectiveFilename = String(filename || fileName || 'van-ban.txt');
      const normalizedText = typeof textContent === 'string' ? textContent.trim() : '';
      const hasInlineMedia =
        typeof fileBase64 === 'string' &&
        fileBase64.length > 0 &&
        typeof mimeType === 'string' &&
        (mimeType === 'application/pdf' || mimeType.startsWith('image/'));

      if (!normalizedText && !hasInlineMedia && !docNameRaw) {
        return res.status(400).json({ error: 'Nội dung tệp không được để trống' });
      }

      const apiKey = normalizeGeminiKey(process.env.GEMINI_API_KEY);
      if (!apiKey) {
        return res.status(503).json({
          error: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ (Settings > Secrets).',
        });
      }

      const ai = createGeminiClient(apiKey);
      const todayIso = new Date().toISOString().split('T')[0];
      const prompt = `Bạn là Trợ lý AI Phân Tích Văn Bản Y Tế.
Hãy đọc thông tin tập tin (tên tệp: ${effectiveFilename}) và nội dung kèm theo dưới đây:
---
${(normalizedText || effectiveFilename).slice(0, 6000)}
---

Hãy trích xuất các thông tin văn bản y tế hành chính dựa trên dữ liệu hiện có.
Các trường JSON bắt buộc:
- "title": Tên hoặc tiêu đề văn bản (tiếng Việt có dấu, rõ ràng)
- "docNumber": Số hiệu văn bản (ví dụ 12/TB-TYT hoặc 366/BHXH-CNTT)
- "issueDate": Ngày ban hành theo định dạng YYYY-MM-DD (nếu không rõ lấy ngày hôm nay: ${todayIso})
- "issuingAuthority": Cơ quan hoặc đơn vị phát hành văn bản (ví dụ: Bộ Y tế, Sở Y tế, Bảo hiểm xã hội Việt Nam, Trạm Y tế)
- "summary": Tóm tắt ngắn gọn 1-2 câu về nội dung chính
- "category": Chọn 1 trong 4 giá trị: Chỉ đạo điều hành | Tiêm chủng BHYT | Phòng chống dịch | Biểu mẫu kê khai`;

      const contentsPayload: any = hasInlineMedia
        ? {
            parts: [
              { inlineData: { mimeType: String(mimeType), data: String(fileBase64) } },
              { text: prompt },
            ],
          }
        : prompt;

      const response = await generateContentWithRetry(
        ai,
        {
          model: DEFAULT_GEMINI_MODEL,
          contents: contentsPayload,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                docNumber: { type: Type.STRING },
                issueDate: { type: Type.STRING },
                issuingAuthority: { type: Type.STRING },
                summary: { type: Type.STRING },
                category: { type: Type.STRING },
              },
            },
          },
        },
        12000
      );

      const parsedData = safeParseJsonObject(response.text);
      if (!parsedData) {
        return res.status(502).json({ error: 'Gemini AI trả về định dạng JSON không hợp lệ.' });
      }

      return res.json({
        title: typeof parsedData.title === 'string' && parsedData.title.trim() ? parsedData.title.trim() : cleanBaseTitle,
        docNumber: typeof parsedData.docNumber === 'string' && parsedData.docNumber.trim() ? parsedData.docNumber.trim() : '01/CV-TYT',
        issueDate:
          typeof parsedData.issueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsedData.issueDate.trim())
            ? parsedData.issueDate.trim()
            : todayIso,
        issuingAuthority:
          typeof parsedData.issuingAuthority === 'string' && parsedData.issuingAuthority.trim()
            ? parsedData.issuingAuthority.trim()
            : 'Trạm Y tế',
        summary: typeof parsedData.summary === 'string' && parsedData.summary.trim() ? parsedData.summary.trim() : '',
        category: typeof parsedData.category === 'string' && parsedData.category.trim() ? parsedData.category.trim() : 'Chỉ đạo điều hành',
      });
    } catch (error: any) {
      console.error('AI Document Scan Server Error:', error?.message || error);
      const { status, message } = resolveGeminiErrorStatus(error);
      return res.status(status).json({ error: message });
    }
  });

  // API endpoint for fetching health news RSS from suckhoedoisong.vn/y-te.rss
  app.get('/api/health-news-rss', async (_req, res) => {
    try {
      const response = await fetch('https://suckhoedoisong.vn/y-te.rss', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TramYTePortal/3.0; +https://suckhoedoisong.vn/y-te.rss)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      });
      if (!response.ok) {
        throw new Error(`RSS upstream returned HTTP ${response.status}`);
      }
      const xmlText = await response.text();

      const stripCdata = (raw: string) =>
        raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      const decodeHtml = (raw: string) =>
        raw
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ');

      const lastBuildMatch = xmlText.match(/<lastBuildDate>([\s\S]*?)<\/lastBuildDate>/);
      const lastBuildDate = lastBuildMatch ? stripCdata(lastBuildMatch[1]) : '';

      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const items: Array<{
        id: string;
        title: string;
        summary: string;
        imageUrl: string;
        sourceName: string;
        sourceUrl: string;
        publishedAt: string;
        publishedDisplay: string;
        category: string;
      }> = [];
      let match: RegExpExecArray | null;

      while ((match = itemRegex.exec(xmlText)) !== null && items.length < 24) {
        const itemContent = match[1];
        const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
        const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
        const enclosureMatch = itemContent.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
        const mediaMatch = itemContent.match(/<media:content[^>]+url=["']([^"']+)["']/i);

        const rawDesc = descMatch ? stripCdata(descMatch[1]) : '';
        const imgInDescMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
        const imageUrl =
          (enclosureMatch && enclosureMatch[1]) ||
          (mediaMatch && mediaMatch[1]) ||
          (imgInDescMatch && imgInDescMatch[1]) ||
          '';

        const cleanDesc = decodeHtml(rawDesc.replace(/<[^>]*>?/gm, ' '))
          .replace(/\s+/g, ' ')
          .trim();

        const title = titleMatch
          ? decodeHtml(stripCdata(titleMatch[1])).replace(/\s+/g, ' ').trim()
          : 'Tin y tế';
        const sourceUrl = linkMatch
          ? stripCdata(linkMatch[1])
          : 'https://suckhoedoisong.vn/y-te.htm';

        const parsedDate = pubDateMatch ? new Date(pubDateMatch[1].trim()) : new Date();
        const isValidDate = !Number.isNaN(parsedDate.getTime());
        const publishedAt = isValidDate
          ? parsedDate.toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];
        const publishedDisplay = isValidDate
          ? parsedDate.toLocaleString('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : publishedAt;

        const summary =
          cleanDesc.length > 200 ? `${cleanDesc.slice(0, 197).trim()}...` : cleanDesc;

        items.push({
          id: `rss_${items.length + 1}`,
          title,
          summary,
          imageUrl: imageUrl.trim(),
          sourceName: 'Báo Sức Khỏe & Đời Sống',
          sourceUrl,
          publishedAt,
          publishedDisplay,
          category: 'Y Tế',
        });
      }

      return res.json({
        source: 'https://suckhoedoisong.vn/y-te.rss',
        lastBuildDate,
        items,
      });
    } catch (error: any) {
      console.error('RSS Feed Fetch Error:', error);
      return res.status(200).json({
        source: 'https://suckhoedoisong.vn/y-te.rss',
        error: error?.message || 'Không thể tải RSS',
        items: [],
      });
    }
  });

  // Diagnostics endpoint
  app.get('/api/diagnostics', async (_req, res) => {
    const RSS_URL = 'https://suckhoedoisong.vn/y-te.rss';
    const startTime = Date.now();

    let rssStatus: any = {
      status: 'error',
      statusCode: 0,
      responseTimeMs: 0,
      error: null,
      itemsFound: 0,
      source: RSS_URL,
    };

    const rssStart = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      const rssRes = await fetch(RSS_URL, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; TramYTePortal/3.0)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      }).finally(() => clearTimeout(timeout));

      rssStatus.statusCode = rssRes.status;
      rssStatus.responseTimeMs = Date.now() - rssStart;

      if (rssRes.ok) {
        const text = await rssRes.text();
        rssStatus.status = 'connected';
        rssStatus.itemsFound = (text.match(/<item>/g) || []).length;
      } else {
        rssStatus.status = 'error';
        rssStatus.error = `HTTP ${rssRes.status}: ${rssRes.statusText}`;
      }
    } catch (err: any) {
      rssStatus.responseTimeMs = Date.now() - rssStart;
      rssStatus.status = 'error';
      rssStatus.error = err?.name === 'AbortError' ? 'Timeout sau 9 giây' : err?.message || 'Lỗi mạng';
    }

    const rawGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
    const hasGeminiKey = Boolean(rawGeminiKey && rawGeminiKey !== 'MY_GEMINI_API_KEY');

    let firebaseDiag = {
      projectId: '',
      databaseId: '',
      authDomain: '',
    };
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        firebaseDiag = {
          projectId: cfg.projectId || '',
          databaseId: cfg.firestoreDatabaseId || '',
          authDomain: cfg.authDomain || '',
        };
      }
    } catch {
      // ignore config read error
    }

    return res.status(200).json({
      status: rssStatus.status === 'connected' ? 'healthy' : 'warning',
      timestamp: new Date().toISOString(),
      totalResponseTimeMs: Date.now() - startTime,
      appVersion: 'v3.0.0 (Bản Chính Thức)',
      platform: 'Node.js Express / AI Studio Dev',
      environment: process.env.NODE_ENV || 'development',
      region: 'local',
      nodeVersion: process.version,
      apiEndpoints: {
        healthNewsRss: '/api/health-news-rss',
        diagnostics: '/api/diagnostics',
        aiStatus: '/api/ai/status',
        aiSuggestNeeds: '/api/ai/suggest-needs',
        aiScanDocument: '/api/ai/scan-document',
        bhxhStatus: '/api/bhxh/status',
        bhxhLookup: '/api/bhxh/lookup',
        bhxhCskcb: '/api/bhxh/cskcb',
        mapsResolve: '/api/maps/resolve-urls',
        facebookPreview: '/api/facebook-preview',
        pushSubscribe: '/api/push/subscribe',
      },
      services: {
        rssUpstream: rssStatus,
        geminiAi: {
          configured: hasGeminiKey,
          model: DEFAULT_GEMINI_MODEL,
        },
        firebase: {
          projectId: firebaseDiag.projectId,
          databaseId: firebaseDiag.databaseId,
          authDomain: firebaseDiag.authDomain,
          authAuthorizedDomainsNotice:
            'Để đăng nhập Google thành công trên Vercel / Tenten, tên miền tyt.slhd.id.vn và domain.vercel.app phải được thêm vào Firebase Console > Authentication > Settings > Authorized domains.',
        },
        tentenDomain: {
          productionHost: 'tyt.slhd.id.vn',
          cnameTarget: 'cname.vercel-dns.com.',
          rootDomainIp: '76.76.21.21',
        },
      },
    });
  });

  // Web Push endpoints for persistent background notifications
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    try {
      const { deviceId, subscription, uid, citizenId, phoneNumber, department } = req.body || {};
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ error: 'Invalid push subscription payload' });
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
      return res.json({ ok: true, count: list.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Subscribe error' });
    }
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    try {
      const { deviceId, endpoint } = req.body || {};
      const list = loadPushSubscriptions().filter(
        item =>
          (!deviceId || item.deviceId !== deviceId) &&
          (!endpoint || item.subscription?.endpoint !== endpoint)
      );
      savePushSubscriptions(list);
      return res.json({ ok: true, count: list.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Unsubscribe error' });
    }
  });

  app.post('/api/push/send-test', async (req, res) => {
    try {
      const { subscription, deviceId, title, body } = req.body || {};
      const list = loadPushSubscriptions();
      const targetSub =
        subscription ||
        list.find(item => item.deviceId === deviceId)?.subscription;

      if (!targetSub?.endpoint) {
        return res.status(404).json({ error: 'Thiết bị chưa đăng ký nhận thông báo nền.' });
      }

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

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Send test push failed' });
    }
  });

  app.post('/api/push/broadcast', async (req, res) => {
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
        return res.status(400).json({ error: 'Missing notification title or content' });
      }

      const storedList = loadPushSubscriptions();
      const mergedByEndpoint = new Map<string, StoredPushSubscription>();
      for (const entry of storedList) {
        if (entry?.subscription?.endpoint) {
          mergedByEndpoint.set(entry.subscription.endpoint, entry);
        }
      }
      if (Array.isArray(fallbackSubscriptions)) {
        for (const fb of fallbackSubscriptions) {
          if (fb?.endpoint && fb?.keys?.p256dh && fb?.keys?.auth && !mergedByEndpoint.has(fb.endpoint)) {
            mergedByEndpoint.set(fb.endpoint, {
              deviceId: String(fb.deviceId || fb.endpoint),
              subscription: {
                endpoint: fb.endpoint,
                keys: { p256dh: fb.keys.p256dh, auth: fb.keys.auth },
              },
              uid: fb.uid,
              citizenId: fb.citizenId,
              phoneNumber: fb.phoneNumber,
              department: fb.department,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      const list = Array.from(mergedByEndpoint.values());
      if (list.length === 0) {
        return res.json({ ok: true, sent: 0, pruned: 0 });
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

      return res.json({ ok: true, sent, pruned: expiredEndpoints.size });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Broadcast failed' });
    }
  });

  // Resolve Google Maps links (including shortened maps.app.goo.gl URLs) to extract GPS coordinates
  app.post('/api/maps/resolve-urls', async (req, res) => {
    try {
      const rawUrls: unknown = req.body?.urls;
      if (!Array.isArray(rawUrls)) {
        return res.status(400).json({ error: 'urls array is required' });
      }
      const urls = rawUrls
        .slice(0, 100)
        .map(u => (typeof u === 'string' ? u.trim() : ''))
        .filter(Boolean);

      const parseCoordsFromUrl = (urlStr: string): { lat: number; lng: number } | null => {
        let m = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (!m) m = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (!m) m = urlStr.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (!m) return null;
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
        return { lat, lng };
      };

      const resolveSingle = async (inputUrl: string) => {
        const direct = parseCoordsFromUrl(inputUrl);
        if (direct) {
          return { inputUrl, resolvedUrl: inputUrl, lat: direct.lat, lng: direct.lng };
        }
        try {
          const parsed = new URL(inputUrl);
          const allowedHost =
            parsed.hostname === 'maps.app.goo.gl' ||
            parsed.hostname === 'goo.gl' ||
            parsed.hostname.endsWith('.google.com') ||
            parsed.hostname === 'google.com';
          if (!allowedHost) {
            return { inputUrl, resolvedUrl: inputUrl, lat: null, lng: null };
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          try {
            const resp = await fetch(inputUrl, {
              redirect: 'follow',
              signal: controller.signal,
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TramYTePortal/3.0)' },
            });
            const finalUrl = resp.url || inputUrl;
            const coords = parseCoordsFromUrl(finalUrl);
            return {
              inputUrl,
              resolvedUrl: finalUrl,
              lat: coords?.lat ?? null,
              lng: coords?.lng ?? null,
            };
          } finally {
            clearTimeout(timer);
          }
        } catch {
          return { inputUrl, resolvedUrl: inputUrl, lat: null, lng: null };
        }
      };

      const results: Array<{
        inputUrl: string;
        resolvedUrl: string;
        lat: number | null;
        lng: number | null;
      }> = [];
      const BATCH_SIZE = 8;
      for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const chunk = urls.slice(i, i + BATCH_SIZE);
        const settled = await Promise.all(chunk.map(resolveSingle));
        results.push(...settled);
      }

      return res.json({ results });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to resolve URLs' });
    }
  });

  // Resolve Facebook post/share URLs and extract public OpenGraph text & images
  app.post('/api/facebook-preview', async (req, res) => {
    try {
      const { default: facebookPreviewHandler } = await import('./api/facebook-preview');
      return facebookPreviewHandler(req, res);
    } catch (err: any) {
      return res.status(200).json({
        success: true,
        inputUrl: String(req.body?.url || ''),
        canonicalUrl: String(req.body?.url || ''),
        title: '',
        description: '',
        images: [],
        isVideo: false,
        metadataAvailable: false,
        error: err?.message || 'Facebook preview handler error',
      });
    }
  });

  // Lookup citizen profile from src/data/data.json by CCCD/ĐDCN
  app.all('/api/citizen-lookup', async (req, res) => {
    try {
      const { default: citizenLookupHandler } = await import('./api/citizen-lookup');
      return citizenLookupHandler(req, res);
    } catch (err: any) {
      return res.status(500).json({
        found: false,
        error: err?.message || 'Lỗi tra cứu cơ sở dữ liệu CCCD',
      });
    }
  });

  const resolveRequestOrigin = (req: express.Request): string => {
    const forwardedHost = String(req.headers['x-forwarded-host'] || '')
      .split(',')[0]
      ?.trim();
    const host = forwardedHost || req.get('host') || '';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      ?.trim();
    const proto =
      forwardedProto ||
      (host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');

    if (
      host &&
      !host.startsWith('0.0.0.0') &&
      !host.startsWith('localhost') &&
      !host.startsWith('127.0.0.1')
    ) {
      return `${proto}://${host}`;
    }
    if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
      return process.env.APP_URL.replace(/\/+$/, '');
    }
    if (host) {
      return `${proto}://${host}`;
    }
    return 'https://tyt.slhd.id.vn';
  };

  const injectDynamicSeoHtml = (html: string, req: express.Request): string => {
    const origin = resolveRequestOrigin(req);
    const cleanPath = req.path && req.path !== '/' ? req.path : '/';
    const pageUrl = `${origin}${cleanPath}`;
    return html
      .replace(/https:\/\/tyt\.slhd\.id\.vn\/seoapp\.jpg/g, `${origin}/seoapp.jpg`)
      .replace(/https:\/\/tyt\.slhd\.id\.vn\/seoapp\.png/g, `${origin}/seoapp.png`)
      .replace(/https:\/\/tyt\.slhd\.id\.vn\/iconapp\.png/g, `${origin}/iconapp.png`)
      .replace(/https:\/\/tyt\.slhd\.id\.vn\//g, pageUrl)
      .replace(/https:\/\/tyt\.slhd\.id\.vn/g, origin);
  };

  app.get(['/seoapp.jpg', '/seoapp.png', '/iconapp.png'], (req, res, next) => {
    const fileName = req.path.replace(/^\/+/, '');
    const publicFile = path.resolve(__dirname, 'public', fileName);
    const distFile = path.resolve(__dirname, 'dist', fileName);
    const targetFile = fs.existsSync(publicFile) ? publicFile : fs.existsSync(distFile) ? distFile : '';
    if (!targetFile) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(targetFile);
  });

  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = 'true';
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const patchedCode = result.code
          .replace(
            /transport\.connect\(createHMRHandler\(handleMessage\)\);/,
            '/* HMR WebSocket disabled */'
          )
          .replace(
            /throw new SendBeforeConnectError\("send was called before connect"\);/g,
            'return;'
          )
          .replace(
            /throw new SendBeforeConnectError\("invoke was called before connect"\);/g,
            'return undefined;'
          );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(patchedCode);
      } catch (err) {
        return next(err);
      }
    });
    app.use(async (req, res, next) => {
      const accept = String(req.headers.accept || '');
      const isHtmlPageRequest =
        req.method === 'GET' &&
        !req.path.startsWith('/api/') &&
        !req.path.startsWith('/@') &&
        !req.path.startsWith('/src/') &&
        !req.path.startsWith('/node_modules/') &&
        !path.extname(req.path) &&
        (accept.includes('text/html') || accept === '*/*' || !accept);

      if (!isHtmlPageRequest) {
        return next();
      }

      try {
        const rawHtml = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const seoHtml = injectDynamicSeoHtml(transformed, req);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(seoHtml);
      } catch (err) {
        return next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath, { index: false }));
    app.get('*', (req, res) => {
      const rawHtml = fs.readFileSync(path.resolve(distPath, 'index.html'), 'utf-8');
      const seoHtml = injectDynamicSeoHtml(rawHtml, req);
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(seoHtml);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on http://0.0.0.0:${PORT}`);
  });
}

startServer();
