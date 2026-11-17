import * as XLSX from 'xlsx';
import { Post } from '../types';
import {
  detectEmbedTypeFromInput,
  normalizeFacebookUrl,
  parseFacebookEmbedInput,
} from './facebookEmbed';

export interface ParsedExcelFacebookLinkRow {
  rowNumber: number;
  rawUrl: string;
  normalizedUrl: string;
  isValidFacebookLink: boolean;
  isNonPostPageOrProfile: boolean;
  isDuplicateInFile: boolean;
  isAlreadyInPosts: boolean;
  validationError?: string;
  category?: Post['category'];
}

export const POST_CATEGORY_OPTIONS: Array<{ value: Post['category']; label: string }> = [
  { value: 'giao_duc_suc_khoe', label: 'Khuyến cáo sức khỏe' },
  { value: 'phong_chong_dich', label: 'Phòng chống dịch bệnh' },
  { value: 'tiem_chung', label: 'Tiêm chủng mở rộng' },
  { value: 'benh_khong_lay_nhiem', label: 'Bệnh không lây nhiễm' },
  { value: 'tin_hoat_dong', label: 'Tin hoạt động Trạm' },
  { value: 'an_toan_thuc_pham', label: 'An toàn thực phẩm' },
];

function stripVietnameseDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function mapCategoryValue(raw?: string): Post['category'] | undefined {
  const clean = stripVietnameseDiacritics(String(raw || ''));
  if (!clean) return undefined;

  if (
    clean === 'giao_duc_suc_khoe' ||
    clean.includes('khuyen cao') ||
    clean.includes('giao duc') ||
    clean.includes('suc khoe')
  ) {
    return 'giao_duc_suc_khoe';
  }
  if (clean === 'phong_chong_dich' || clean.includes('phong chong dich') || clean.includes('dich benh')) {
    return 'phong_chong_dich';
  }
  if (clean === 'tiem_chung' || clean.includes('tiem chung') || clean.includes('vac xin')) {
    return 'tiem_chung';
  }
  if (
    clean === 'benh_khong_lay_nhiem' ||
    clean.includes('khong lay') ||
    clean.includes('huyet ap') ||
    clean.includes('tieu duong')
  ) {
    return 'benh_khong_lay_nhiem';
  }
  if (clean === 'tin_hoat_dong' || clean.includes('hoat dong')) {
    return 'tin_hoat_dong';
  }
  if (clean === 'an_toan_thuc_pham' || clean.includes('thuc pham') || clean.includes('attp')) {
    return 'an_toan_thuc_pham';
  }
  return undefined;
}

function normalizeUrlComparisonKey(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const cleanPath = u.pathname.replace(/\/+$/, '');
    const keepParams = new URLSearchParams();
    ['story_fbid', 'id', 'fbid', 'v'].forEach(k => {
      const v = u.searchParams.get(k);
      if (v) keepParams.set(k, v);
    });
    const qs = keepParams.toString();
    return `${u.hostname.toLowerCase()}${cleanPath.toLowerCase()}${qs ? `?${qs}` : ''}`;
  } catch {
    return urlStr.trim().toLowerCase().replace(/\/+$/, '');
  }
}

function isUrlLike(str: string): boolean {
  const s = str.trim();
  return /^https?:\/\//i.test(s) || /(?:facebook\.com|fb\.watch|fb\.com|youtu\.be|youtube\.com)/i.test(s) || /<iframe/i.test(s);
}

function isLinkHeaderCell(str: string): boolean {
  const norm = stripVietnameseDiacritics(str);
  return (
    !isUrlLike(str) &&
    (norm.includes('link') ||
      norm.includes('url') ||
      norm.includes('lien ket') ||
      norm.includes('duong dan') ||
      norm.includes('bai viet') ||
      norm.includes('facebook'))
  );
}

function isCategoryHeaderCell(str: string): boolean {
  const norm = stripVietnameseDiacritics(str);
  return (
    !isUrlLike(str) &&
    (norm.includes('chuyen muc') || norm.includes('danh muc') || norm.includes('category') || norm.includes('nhom'))
  );
}

export async function parseFacebookPostsExcelFile(
  file: File,
  existingPosts: Post[] = []
): Promise<ParsedExcelFacebookLinkRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Tệp Excel không có trang tính (sheet) nào.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const ref = sheet['!ref'];
  if (!ref) {
    throw new Error('Trang tính đầu tiên đang trống.');
  }

  const range = XLSX.utils.decode_range(ref);
  const existingUrlKeys = new Set(
    existingPosts
      .filter(p => p.embedType === 'facebook' && p.embedUrl)
      .map(p => normalizeUrlComparisonKey(normalizeFacebookUrl(p.embedUrl || '') || p.embedUrl || ''))
  );

  // Extract raw grid with cell hyperlink targets preserved
  const grid: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowValues: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell) {
        rowValues.push('');
        continue;
      }
      const textVal = String(cell.v ?? cell.w ?? '').trim();
      const hyperlinkTarget = cell.l?.Target ? String(cell.l.Target).trim() : '';
      // Prefer hyperlink target if it looks like a Facebook URL and text is a short label
      if (hyperlinkTarget && /(?:facebook\.com|fb\.watch|fb\.com)/i.test(hyperlinkTarget)) {
        rowValues.push(hyperlinkTarget);
      } else {
        rowValues.push(textVal);
      }
    }
    grid.push(rowValues);
  }

  if (grid.length === 0) {
    throw new Error('Không tìm thấy dữ liệu trong file Excel.');
  }

  // Detect optional header row in first 5 non-empty rows
  let headerRowIdx = -1;
  let linkColIdx = -1;
  let categoryColIdx = -1;

  for (let i = 0; i < Math.min(5, grid.length); i++) {
    const row = grid[i];
    const foundLinkCol = row.findIndex(cell => isLinkHeaderCell(cell));
    if (foundLinkCol !== -1) {
      headerRowIdx = i;
      linkColIdx = foundLinkCol;
      categoryColIdx = row.findIndex((cell, idx) => idx !== foundLinkCol && isCategoryHeaderCell(cell));
      break;
    }
  }

  const startIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
  const seenKeys = new Set<string>();
  const rows: ParsedExcelFacebookLinkRow[] = [];

  for (let i = startIdx; i < grid.length; i++) {
    const row = grid[i];
    const nonEmpty = row.map(v => v.trim()).filter(Boolean);
    if (nonEmpty.length === 0) continue;

    // Pick candidate link from explicit header column or scan the row for a URL-like cell
    let rawCandidate = linkColIdx >= 0 ? (row[linkColIdx] || '').trim() : '';
    if (!rawCandidate) {
      rawCandidate =
        row.find(cell => /(?:facebook\.com|fb\.watch|fb\.com|<iframe)/i.test(cell))?.trim() ||
        row.find(cell => /^https?:\/\//i.test(cell))?.trim() ||
        row.find(cell => cell.trim().length > 0)?.trim() ||
        '';
    }

    if (!rawCandidate) continue;

    // Skip obvious instruction/placeholder rows from template
    const lowerRaw = rawCandidate.toLowerCase();
    if (lowerRaw.includes('ví dụ:') || lowerRaw.includes('huong dan:')) continue;

    const categoryRaw = categoryColIdx >= 0 ? row[categoryColIdx] : '';
    const mappedCategory = mapCategoryValue(categoryRaw);

    const embedDetected = detectEmbedTypeFromInput(rawCandidate);
    const parsedFb = parseFacebookEmbedInput(rawCandidate);

    if (embedDetected !== 'facebook' || !parsedFb.isValid) {
      rows.push({
        rowNumber: range.s.r + i + 1,
        rawUrl: rawCandidate,
        normalizedUrl: '',
        isValidFacebookLink: false,
        isNonPostPageOrProfile: false,
        isDuplicateInFile: false,
        isAlreadyInPosts: false,
        validationError:
          embedDetected === 'youtube'
            ? 'Link YouTube — chức năng này chỉ hỗ trợ import bài viết Facebook'
            : 'Không phải đường dẫn bài viết Facebook hợp lệ',
        category: mappedCategory,
      });
      continue;
    }

    const normalizedUrl = parsedFb.postUrl;
    const isNonPost = parsedFb.detectedKind === 'page' || parsedFb.detectedKind === 'profile';
    const key = normalizeUrlComparisonKey(normalizedUrl);
    const isDuplicateInFile = seenKeys.has(key);
    seenKeys.add(key);
    const isAlreadyInPosts = existingUrlKeys.has(key);

    rows.push({
      rowNumber: range.s.r + i + 1,
      rawUrl: rawCandidate,
      normalizedUrl,
      isValidFacebookLink: true,
      isNonPostPageOrProfile: isNonPost,
      isDuplicateInFile,
      isAlreadyInPosts,
      validationError: isNonPost
        ? 'Đây là link Fanpage/Trang cá nhân — chỉ hỗ trợ link bài viết Facebook'
        : isDuplicateInFile
        ? 'Link bị trùng lặp trong file Excel'
        : undefined,
      category: mappedCategory,
    });
  }

  if (rows.length === 0) {
    throw new Error('Không tìm thấy link bài viết Facebook nào trong file Excel.');
  }

  return rows;
}

export function downloadFacebookPostsExcelTemplate(): void {
  const wb = XLSX.utils.book_new();

  const sheetData = [
    ['Link bài viết Facebook', 'Chuyên mục (tùy chọn)'],
    ['https://www.facebook.com/TramYTePhuongHiepThanh/posts/pfbid02ExamplePostLink1', 'Khuyến cáo sức khỏe'],
    ['https://www.facebook.com/share/p/1ExampleShareLink2/', 'Tiêm chủng mở rộng'],
    ['https://www.facebook.com/watch/?v=123456789012345', 'Phòng chống dịch bệnh'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [{ wch: 72 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Danh_sach_link_Facebook');

  const guideData = [
    ['HƯỚNG DẪN IMPORT BÀI VIẾT FACEBOOK TỪ EXCEL'],
    ['1. Chỉ cần điền cột "Link bài viết Facebook" (hệ thống tự đọc cả file Excel chỉ có 1 cột chứa danh sách link, có hoặc không có dòng tiêu đề).'],
    ['2. Chức năng này CHỈ áp dụng cho bài viết / video / ảnh công khai từ Facebook (không hỗ trợ link YouTube, Fanpage hoặc Trang cá nhân).'],
    ['3. Sau khi tải file lên, hệ thống tự động tải nội dung công khai từ từng bài viết Facebook (hình ảnh hiển thị trực tiếp qua khung nhúng Facebook).'],
    ['4. Tiêu đề bài viết sẽ được tự động trích xuất từ một phần nội dung bài viết (KHÔNG lấy tên trang cá nhân hay tên Fanpage).'],
    ['5. Cột "Chuyên mục (tùy chọn)" có thể để trống; nếu để trống sẽ dùng chuyên mục mặc định bạn chọn trong cửa sổ Import.'],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideData);
  wsGuide['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Huong_dan');

  XLSX.writeFile(wb, 'mau_import_bai_viet_facebook.xlsx');
}
