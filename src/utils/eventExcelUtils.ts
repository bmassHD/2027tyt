import * as XLSX from 'xlsx';
import { StationEvent, StationEventCategory } from '../types';
import { getVietnamTodayKey } from '../services/firebaseService';

export const EVENT_CATEGORY_LABELS: Record<StationEventCategory, string> = {
  health_day: 'Ngày lễ ngành Y tế',
  celebration: 'Lễ kỷ niệm đơn vị',
  campaign: 'Chiến dịch truyền thông / Sức khỏe',
  community: 'Sự kiện cộng đồng',
  holiday: 'Ngày lễ lớn / Quốc gia',
  other: 'Sự kiện khác',
};

export interface ParsedEventImportRow {
  rowNum: number;
  title: string;
  eventDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  category: StationEventCategory;
  location?: string;
  description: string;
  greetingMessage?: string;
  enableAutoPopup: boolean;
  enableConfetti: boolean;
  isAnnual: boolean;
  isActive: boolean;
  isDuplicate: boolean;
  error?: string;
}

function normalizeHeaderKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseBooleanFlexible(val: unknown, defaultValue: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const s = normalizeHeaderKey(String(val ?? ''));
  if (!s) return defaultValue;
  if (['1', 'co', 'yes', 'true', 'x', 'bat', 'on', 'ok', 'cong khai'].includes(s)) return true;
  if (['0', 'khong', 'no', 'false', 'tat', 'off', 'an'].includes(s)) return false;
  return defaultValue;
}

function parseExcelDateToIso(val: unknown): string {
  if (val === undefined || val === null || val === '') return '';

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = val.getMonth() + 1;
    const d = val.getDate();
    if (y >= 1900 && y <= 2100) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  if (typeof val === 'number' && Number.isFinite(val) && val > 1000) {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
    }
  }

  const raw = String(val).trim();
  if (!raw) return '';

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const vnMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (vnMatch) {
    const d = Number(vnMatch[1]);
    const m = Number(vnMatch[2]);
    const y = Number(vnMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  // DD/MM (assume current Vietnam year)
  const shortMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (shortMatch) {
    const d = Number(shortMatch[1]);
    const m = Number(shortMatch[2]);
    const y = Number(getVietnamTodayKey().slice(0, 4));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  return '';
}

function parseExcelTime(val: unknown): string | undefined {
  if (val === undefined || val === null || val === '') return undefined;

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${pad2(val.getHours())}:${pad2(val.getMinutes())}`;
  }

  if (typeof val === 'number' && val >= 0 && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  const raw = String(val).trim();
  const match = raw.match(/^(\d{1,2})[:hH](\d{1,2})/);
  if (match) {
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${pad2(hh)}:${pad2(mm)}`;
    }
  }
  return undefined;
}

function inferEventCategory(raw: unknown): StationEventCategory {
  const s = normalizeHeaderKey(String(raw ?? ''));
  if (!s) return 'celebration';
  if (s === 'health day' || s.includes('nganh y') || s.includes('y te')) return 'health_day';
  if (s === 'celebration' || s.includes('ky niem') || s.includes('don vi')) return 'celebration';
  if (s === 'campaign' || s.includes('chien dich') || s.includes('truyen thong')) return 'campaign';
  if (s === 'community' || s.includes('cong dong')) return 'community';
  if (s === 'holiday' || s.includes('quoc gia') || s.includes('ngay le lon')) return 'holiday';
  if (s === 'other' || s.includes('khac')) return 'other';
  return 'celebration';
}

export function exportEventsToExcel(
  events: StationEvent[],
  fileName?: string
): void {
  const rows = events.map((ev, index) => ({
    STT: index + 1,
    'Tên sự kiện': ev.title,
    'Ngày diễn ra': ev.eventDate,
    'Đến ngày': ev.endDate || '',
    'Giờ bắt đầu': ev.startTime || '',
    'Giờ kết thúc': ev.endTime || '',
    'Phân loại': EVENT_CATEGORY_LABELS[ev.category] || 'Sự kiện khác',
    'Địa điểm': ev.location || '',
    'Mô tả sự kiện': ev.description,
    'Lời chúc': ev.greetingMessage || '',
    'Thông báo tự động': ev.enableAutoPopup !== false ? 'Có' : 'Không',
    'Bắn pháo giấy': ev.enableConfetti !== false ? 'Có' : 'Không',
    'Lặp hằng năm': ev.isAnnual ? 'Có' : 'Không',
    'Hiển thị công khai': ev.isActive !== false ? 'Có' : 'Không',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 36 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 28 },
    { wch: 26 },
    { wch: 46 },
    { wch: 42 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SuKien_NgayLe');
  const today = getVietnamTodayKey();
  XLSX.writeFile(wb, fileName || `danh_sach_su_kien_${today}.xlsx`);
}

export function downloadEventsExcelTemplate(): void {
  const year = getVietnamTodayKey().slice(0, 4);
  const sampleRows = [
    {
      'Tên sự kiện': 'Kỷ niệm Ngày Thầy thuốc Việt Nam 27/02',
      'Ngày diễn ra': `${year}-02-27`,
      'Đến ngày': '',
      'Giờ bắt đầu': '07:30',
      'Giờ kết thúc': '11:30',
      'Phân loại': 'Ngày lễ ngành Y tế',
      'Địa điểm': 'Hội trường Trạm Y tế',
      'Mô tả sự kiện':
        'Tôn vinh đội ngũ y bác sĩ, điều dưỡng và nhân viên y tế cơ sở tận tụy vì sức khỏe nhân dân.',
      'Lời chúc':
        'Kính chúc toàn thể đội ngũ y bác sĩ luôn dồi dào sức khỏe, vững vàng y đức và hoàn thành xuất sắc nhiệm vụ!',
      'Thông báo tự động': 'Có',
      'Bắn pháo giấy': 'Có',
      'Lặp hằng năm': 'Có',
      'Hiển thị công khai': 'Có',
    },
    {
      'Tên sự kiện': 'Chiến dịch uống Vitamin A & Tẩy giun cho trẻ em',
      'Ngày diễn ra': `${year}-06-01`,
      'Đến ngày': `${year}-06-02`,
      'Giờ bắt đầu': '07:00',
      'Giờ kết thúc': '16:30',
      'Phân loại': 'Chiến dịch truyền thông / Sức khỏe',
      'Địa điểm': 'Các điểm uống trên địa bàn phường',
      'Mô tả sự kiện':
        'Tổ chức cho trẻ từ 6 đến 36 tháng tuổi uống bổ sung Vitamin A liều cao và tư vấn dinh dưỡng miễn phí.',
      'Lời chúc':
        'Chúc các em nhỏ luôn khỏe mạnh, hay ăn chóng lớn và có một ngày Quốc tế Thiếu nhi thật vui tươi!',
      'Thông báo tự động': 'Có',
      'Bắn pháo giấy': 'Có',
      'Lặp hằng năm': 'Có',
      'Hiển thị công khai': 'Có',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 36 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 30 },
    { wch: 28 },
    { wch: 46 },
    { wch: 44 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mau_SuKien');
  XLSX.writeFile(wb, 'mau_import_su_kien.xlsx');
}

export async function parseEventsExcelFile(
  file: File,
  existingEvents: StationEvent[]
): Promise<ParsedEventImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    throw new Error('Không tìm thấy sheet dữ liệu trong file Excel.');
  }

  const rawObjects = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
    defval: '',
  });

  if (rawObjects.length === 0) {
    throw new Error('File Excel không có dòng dữ liệu nào.');
  }

  const existingKeys = new Set(
    existingEvents.map(ev => `${ev.title.trim().toLowerCase()}|${ev.eventDate}`)
  );

  const parsed: ParsedEventImportRow[] = [];

  rawObjects.forEach((raw, idx) => {
    const kv: Record<string, unknown> = {};
    Object.entries(raw).forEach(([k, v]) => {
      kv[normalizeHeaderKey(k)] = v;
    });

    const getRaw = (...keys: string[]): unknown => {
      for (const k of keys) {
        const val = kv[k];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return val;
        }
      }
      return '';
    };

    const getStr = (...keys: string[]): string => {
      const val = getRaw(...keys);
      return val !== undefined && val !== null ? String(val).trim() : '';
    };

    const title = getStr('ten su kien', 'su kien', 'tieu de', 'title', 'name').slice(0, 256);
    const rawDate = getRaw('ngay dien ra', 'ngay bat dau', 'ngay', 'date', 'eventdate');
    const eventDate = parseExcelDateToIso(rawDate);

    // Skip completely empty trailing rows
    if (!title && !eventDate && !getStr('mo ta su kien', 'mo ta', 'description')) {
      return;
    }

    const rawEndDate = getRaw('den ngay', 'ngay ket thuc', 'enddate');
    let endDate = parseExcelDateToIso(rawEndDate) || undefined;
    if (endDate && eventDate && endDate < eventDate) {
      endDate = undefined;
    }

    const startTime = parseExcelTime(getRaw('gio bat dau', 'bat dau', 'starttime'));
    const endTime = parseExcelTime(getRaw('gio ket thuc', 'ket thuc', 'endtime'));
    const category = inferEventCategory(getRaw('phan loai', 'loai su kien', 'loai', 'category'));
    const location = getStr('dia diem', 'noi to chuc', 'location').slice(0, 256) || undefined;
    const rawDesc = getStr('mo ta su kien', 'mo ta', 'noi dung', 'description');
    const description = (rawDesc || title || 'Sự kiện Trạm Y tế').slice(0, 4000);
    const greetingMessage =
      getStr('loi chuc', 'loi chuc mung', 'chuc mung', 'greeting', 'greetingmessage').slice(
        0,
        2000
      ) || undefined;

    const enableAutoPopup = parseBooleanFlexible(
      getRaw('thong bao tu dong', 'tu dong thong bao', 'enableautopopup', 'autopopup'),
      true
    );
    const enableConfetti = parseBooleanFlexible(
      getRaw('ban phao giay', 'phao giay', 'hieu ung phao giay', 'enableconfetti', 'confetti'),
      true
    );
    const isAnnual = parseBooleanFlexible(
      getRaw('lap hang nam', 'lap lai hang nam', 'hang nam', 'isannual', 'annual'),
      false
    );
    const isActive = parseBooleanFlexible(
      getRaw('hien thi cong khai', 'cong khai', 'hien thi', 'isactive', 'active'),
      true
    );

    let error: string | undefined;
    if (!title) {
      error = 'Thiếu tên sự kiện';
    } else if (!eventDate) {
      error = 'Ngày diễn ra không hợp lệ (cần YYYY-MM-DD hoặc DD/MM/YYYY)';
    }

    const dupKey = `${title.toLowerCase()}|${eventDate}`;
    const isDuplicate = Boolean(title && eventDate && existingKeys.has(dupKey));

    parsed.push({
      rowNum: idx + 2,
      title,
      eventDate,
      endDate,
      startTime,
      endTime,
      category,
      location,
      description,
      greetingMessage,
      enableAutoPopup,
      enableConfetti,
      isAnnual,
      isActive,
      isDuplicate,
      error,
    });
  });

  if (parsed.length === 0) {
    throw new Error('Không tìm thấy dòng sự kiện nào hợp lệ trong file Excel.');
  }

  return parsed;
}
