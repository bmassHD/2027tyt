import { auth } from '../firebase/config';
import {
  BhxhApiPublicConfig,
  BhxhCardLookupResult,
  BhxhCskcbInfo,
  BhxhLookupStatusInfo,
} from '../types';

export type BhxhLookupEndpoint = 'KQNhanLichSuKCB2024' | 'NhanLichSuKCB2024' | 'NhanLichSuKCB2018';

export interface BhxhPublicStatus extends BhxhApiPublicConfig {
  configured: boolean;
}

export interface BhxhAdminConfig {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  lookupEndpoint: BhxhLookupEndpoint;
  username: string;
  hasPassword: boolean;
  defaultMaCskcb: string;
  defaultHoTenCb: string;
  defaultCccdCb: string;
  autoLookupFacilityName: boolean;
  showHistoryKcb: boolean;
  updatedAt?: string;
}

export interface SaveBhxhConfigPayload {
  enabled: boolean;
  baseUrl: string;
  lookupEndpoint: BhxhLookupEndpoint;
  username: string;
  password?: string;
  passwordMode?: 'plain' | 'md5';
  clearPassword?: boolean;
  defaultMaCskcb: string;
  defaultHoTenCb: string;
  defaultCccdCb: string;
  autoLookupFacilityName: boolean;
  showHistoryKcb: boolean;
}

export const BHXH_RESULT_CODE_MAP: Record<string, BhxhLookupStatusInfo> = {
  '000': {
    code: '000',
    description: 'Thẻ còn giá trị sử dụng',
    severity: 'valid',
  },
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
  '005': {
    code: '005',
    description: 'Không có quyền tra cứu thông tin thẻ BHYT',
    severity: 'error',
  },
  '006': {
    code: '006',
    description: 'Không có quyền tra cứu lịch sử khám chữa bệnh',
    severity: 'error',
  },
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
  '010': {
    code: '010',
    description: 'Thẻ hết giá trị sử dụng',
    severity: 'error',
  },
  '051': {
    code: '051',
    description: 'Mã thẻ không đúng',
    severity: 'error',
  },
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
  '050': {
    code: '050',
    description: 'Không thấy thông tin thẻ BHYT',
    severity: 'error',
  },
  '060': {
    code: '060',
    description: 'Thẻ sai họ tên',
    severity: 'error',
  },
  '061': {
    code: '061',
    description: 'Thẻ sai họ tên (đúng kí tự đầu)',
    severity: 'error',
  },
  '070': {
    code: '070',
    description: 'Thẻ sai ngày sinh',
    severity: 'error',
  },
  '100': {
    code: '100',
    description: 'Lỗi khi lấy dữ liệu sổ thẻ',
    severity: 'error',
  },
  '101': {
    code: '101',
    description: 'Lỗi server',
    severity: 'error',
  },
  '110': {
    code: '110',
    description: 'Thẻ đã thu hồi',
    severity: 'error',
  },
  '120': {
    code: '120',
    description: 'Thẻ đã báo giảm',
    severity: 'error',
  },
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
  '130': {
    code: '130',
    description: 'Trẻ em không xuất trình thẻ',
    severity: 'warning',
  },
  '205': {
    code: '205',
    description: 'Lỗi sai định dạng tham số truyền vào',
    severity: 'error',
  },
  '401': {
    code: '401',
    description: 'Lỗi xác thực tài khoản',
    severity: 'error',
  },
  '403': {
    code: '403',
    description: 'Địa chỉ IP hoặc tài khoản chưa được cấp quyền gọi API KQNhanLichSuKCB2024',
    severity: 'error',
  },
  '500': {
    code: '500',
    description: 'Lỗi máy chủ Cổng tiếp nhận dữ liệu BHXH',
    severity: 'error',
  },
};

export const BHXH_CSKCB_RESULT_CODE_MAP: Record<string, string> = {
  '200': 'Nhận thông tin thành công',
  '205': 'Sai định dạng tham số truyền vào',
  '206': 'Không tìm thấy thông tin cơ sở',
  '401': 'Lỗi xác thực tài khoản',
  '500': 'Lỗi server',
};

export const BHXH_HANG_LABELS: Record<string, string> = {
  '0': 'Hạng Đặc biệt',
  '1': 'Hạng I',
  '2': 'Hạng II',
  '3': 'Hạng III',
  '4': 'Hạng IV',
  '5': 'Chưa phân hạng',
};

export const BHXH_TUYEN_LABELS: Record<string, string> = {
  '1': 'Tuyến Trung ương',
  '2': 'Tuyến Tỉnh',
  '3': 'Tuyến Huyện',
  '4': 'Tuyến Xã',
};

export function describeBhxhHang(hang?: string): string {
  if (!hang && hang !== '0') return 'Không xác định';
  return BHXH_HANG_LABELS[String(hang).trim()] || `Hạng ${hang}`;
}

export function describeBhxhTuyen(tuyen?: string): string {
  if (!tuyen) return 'Không xác định';
  return BHXH_TUYEN_LABELS[String(tuyen).trim()] || `Tuyến ${tuyen}`;
}

export function normalizeBhxhDobInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // YYYY-MM-DD (from <input type="date">) -> DD/MM/YYYY
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  // DDMMYYYY (compact 8-digit date seen in some BHXH 2024 samples) -> DD/MM/YYYY
  const compactDmy = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  if (compactDmy) {
    return `${compactDmy[1]}/${compactDmy[2]}/${compactDmy[3]}`;
  }
  // D/M/YYYY or DD-MM-YYYY -> DD/MM/YYYY
  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    return `${dd}/${mm}/${dmyMatch[3]}`;
  }
  return trimmed;
}

export function isValidBhxhDob(normalized: string): boolean {
  return /^\d{4}$/.test(normalized) || /^\d{2}\/\d{2}\/\d{4}$/.test(normalized);
}

export function formatBhxhDateTime(raw?: string): string {
  if (!raw) return '—';
  const clean = String(raw).trim();
  // yyyyMMddHHmm (12 digits) or yyyyMMddHHmmss (14 digits)
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(clean);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  }
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (d) {
    return `${d[3]}/${d[2]}/${d[1]}`;
  }
  return clean;
}

export function getNormalizedBhxhHistoryKcb(result?: BhxhCardLookupResult | null) {
  if (!result) return [];
  const list = result.dsLichSuKCB ?? result.dsLichSuKCB2024 ?? result.dsLichSuKCB2018;
  return Array.isArray(list) ? list : [];
}

export function getNormalizedBhxhHistoryKt(result?: BhxhCardLookupResult | null) {
  if (!result) return [];
  const list = result.dsLichSuKT ?? result.dsLichSuKT2024 ?? result.dsLichSuKT2018;
  return Array.isArray(list) ? list : [];
}

async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Vui lòng đăng nhập tài khoản Quản trị viên.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function translateBhxhClientError(err: unknown, httpStatus?: number): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
      ? err.message
      : '';
  const lower = raw.toLowerCase();

  if (!raw) {
    if (httpStatus === 400) return 'Thông tin tra cứu chưa hợp lệ hoặc cổng tra cứu chưa được kích hoạt.';
    if (httpStatus === 401 || httpStatus === 403) return 'Không có quyền xác thực kết nối Cổng Giám định BHYT.';
    if (httpStatus === 404) return 'Không tìm thấy dịch vụ tra cứu BHYT trên máy chủ.';
    if (httpStatus && httpStatus >= 500) {
      return 'Cổng tiếp nhận dữ liệu Giám định BHYT đang gián đoạn hoặc chưa phản hồi. Vui lòng thử lại sau.';
    }
    return 'Không thể tra cứu thông tin Bảo hiểm Y tế lúc này. Vui lòng thử lại sau.';
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed') ||
    lower.includes('err_connection') ||
    lower.includes('econnrefused')
  ) {
    return 'Không thể kết nối tới máy chủ tra cứu. Vui lòng kiểm tra kết nối mạng hoặc thử lại sau.';
  }

  if (lower.includes('aborted') || lower.includes('timeout')) {
    return 'Quá thời gian chờ phản hồi từ Cổng Giám định BHYT. Vui lòng thử lại.';
  }

  if (lower.includes('unexpected token') || lower.includes('json')) {
    return 'Dữ liệu phản hồi từ máy chủ không đúng định dạng. Vui lòng thử lại sau.';
  }

  if (lower === 'unauthorized' || lower === 'forbidden') {
    return 'Bạn chưa có quyền truy cập chức năng này.';
  }

  return raw;
}

async function safeJsonFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw new Error(translateBhxhClientError(err));
  }
}

export async function fetchBhxhPublicStatus(): Promise<BhxhPublicStatus> {
  const res = await safeJsonFetch('/api/bhxh/status');
  if (!res.ok) {
    throw new Error(translateBhxhClientError(null, res.status));
  }
  return (await res.json()) as BhxhPublicStatus;
}

export async function fetchBhxhAdminConfig(): Promise<BhxhAdminConfig> {
  const headers = await getAdminAuthHeaders();
  const res = await safeJsonFetch('/api/bhxh/admin-config', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(translateBhxhClientError(data?.error, res.status));
  }
  return data as BhxhAdminConfig;
}

export async function saveBhxhAdminConfig(
  payload: SaveBhxhConfigPayload
): Promise<{ ok: boolean; config: BhxhAdminConfig }> {
  const headers = await getAdminAuthHeaders();
  const res = await safeJsonFetch('/api/bhxh/config', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(translateBhxhClientError(data?.error, res.status));
  }
  return data as { ok: boolean; config: BhxhAdminConfig };
}

export async function testBhxhTokenConnection(): Promise<{
  ok: boolean;
  maKetQua?: string;
  username?: string;
  expiresIn?: string;
  message: string;
}> {
  const headers = await getAdminAuthHeaders();
  const res = await safeJsonFetch('/api/bhxh/test-token', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(translateBhxhClientError(data?.error, res.status));
  }
  return data;
}

export async function lookupBhxhFacility(
  macskcb: string
): Promise<{ ok: boolean; data: BhxhCskcbInfo }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      headers.Authorization = `Bearer ${token}`;
    } catch {
      // public lookup allowed when enabled
    }
  }
  const res = await safeJsonFetch('/api/bhxh/cskcb', {
    method: 'POST',
    headers,
    body: JSON.stringify({ macskcb: macskcb.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(translateBhxhClientError(data?.error, res.status));
  }
  return data as { ok: boolean; data: BhxhCskcbInfo };
}

export async function lookupBhxhCard(params: {
  maThe: string;
  hoTen: string;
  ngaySinh: string;
  hoTenCb?: string;
  cccdCb?: string;
}): Promise<{ ok: boolean; data: BhxhCardLookupResult }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      headers.Authorization = `Bearer ${token}`;
    } catch {
      // optional auth header for staff/admin privilege
    }
  }
  const res = await safeJsonFetch('/api/bhxh/lookup', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      maThe: params.maThe.trim().toUpperCase(),
      hoTen: params.hoTen.trim(),
      ngaySinh: normalizeBhxhDobInput(params.ngaySinh),
      ...(params.hoTenCb ? { hoTenCb: params.hoTenCb.trim() } : {}),
      ...(params.cccdCb ? { cccdCb: params.cccdCb.replace(/\s+/g, '').trim() } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(translateBhxhClientError(data?.error, res.status));
  }
  return data as { ok: boolean; data: BhxhCardLookupResult };
}

export interface BhxhServerBackupRecord {
  id: string;
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

export async function exportBhxhServerConfigForBackup(): Promise<BhxhServerBackupRecord[]> {
  if (!auth.currentUser) return [];
  try {
    const headers = await getAdminAuthHeaders();
    const res = await safeJsonFetch('/api/bhxh/backup-export', { headers });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (data?.ok && data?.hasConfigured && data?.record) {
      return [data.record as BhxhServerBackupRecord];
    }
    return [];
  } catch {
    return [];
  }
}

export async function restoreBhxhServerConfigFromBackup(
  record: Partial<BhxhServerBackupRecord>
): Promise<boolean> {
  if (!auth.currentUser || !record) return false;
  try {
    const headers = await getAdminAuthHeaders();
    const res = await safeJsonFetch('/api/bhxh/backup-restore', {
      method: 'POST',
      headers,
      body: JSON.stringify({ record }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

