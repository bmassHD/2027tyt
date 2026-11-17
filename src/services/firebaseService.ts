import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  increment,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import {
  isFirestoreWriteQuotaExceeded,
  markFirestoreWriteQuotaExceededIfMatch,
} from '../utils/firestoreQuotaGuard';
import {
  SystemSettings,
  Post,
  Announcement,
  TargetedNotification,
  ServiceItem,
  Appointment,
  FeedbackItem,
  FeedbackAttachment,
  StaffTask,
  WorkSchedule,
  DocumentItem,
  AuditLog,
  UserProfile,
  EmergencyContact,
  VaccinationScheduleItem,
  PushSubscriptionRecord,
  NearbyFacility,
  NearbyFacilityEditPayload,
  RescueSignal,
  StationEvent,
  WeeklyWorkDayConfig,
  WorkScheduleConfig,
  HolidayScheduleItem,
  ReferralCodeItem,
  RoleType,
} from '../types';
import { getOrCreateDeviceId } from './systemNotificationService';

// Utility to strip all undefined fields recursively (including inside arrays) before sending to Firestore
export function cleanDataForFirestore<T>(data: T): any {
  if (data === null || data === undefined) {
    return null;
  }
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item =>
        item !== null && typeof item === 'object'
          ? cleanDataForFirestore(item)
          : item
      );
  }
  if (typeof data === 'object') {
    if (data instanceof Date) {
      return data;
    }
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        if (value !== null && typeof value === 'object') {
          result[key] = cleanDataForFirestore(value);
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  }
  return data;
}

// Empty default skeleton when station settings have not yet been configured by Admin
export const emptySystemSettings: SystemSettings = {
  stationName: '',
  parentUnitName: '',
  subTitle: '',
  address: '',
  hotline: '',
  emergencyPhone: '',
  emergencyNote: '',
  emergencyContacts: [],
  email: '',
  workingHours: '',
  leaderName: '',
  bannerNotice: '',
  bannerNoticeEnabled: false,
  vaccinationBannerEnabled: true,
  vaccinationBannerNote: '',
  version: 'v3.0.0 (Bản Chính Thức)',
  highlightImages: [],
  vaccinationSchedules: [],
  holidaySchedules: [],
  startupPopup: {
    enabled: true,
    noticeType: 'general',
    title: 'Thông báo từ Trạm Y Tế',
    message: '',
    includeTopVaccination: false,
    ctaView: 'none',
    ctaLabel: '',
    frequency: 'per_session',
  },
  vaccinationPopup: {
    enabled: true,
    title: 'Thông Báo Tiêm Chủng',
    message: '',
    ctaLabel: 'Xem lịch tiêm chủng',
    frequency: 'per_session',
  },
  orgChart: {
    deputyDirectors: [],
    departments: [],
  },
  appBacSiChoMoiNha: {
    enabled: true,
    androidUrl: 'https://play.google.com/store/apps/details?id=vn.gov.moh.bacsichomoinha1',
    iosUrl: 'https://apps.apple.com/vn/app/b%C3%A1c-s%C4%A9-cho-m%E1%BB%8Di-nh%C3%A0/id6453760139',
    guideText: 'Khám chữa bệnh từ xa cùng Bác sĩ Trạm Y tế',
  },
  modulesEnabled: {
    nonCommunicableDiseases: true,
    immunizationManagement: true,
    maternalChildHealth: true,
    elderlyCare: true,
    epidemicPrevention: true,
    schoolHealth: true,
    googleCalendarSync: false,
  },
  socialLinks: {
    facebook: '',
    zalo: '',
    tiktok: '',
    youtube: '',
  },
  maintenanceMode: false,
  maintenanceMessage:
    'Hệ thống Cổng thông tin điện tử Trạm Y tế đang được bảo trì, nâng cấp định kỳ. Quý người dân cần hỗ trợ y tế khẩn cấp vui lòng liên hệ trực tiếp số Cấp cứu 24/7 bên dưới.',
  hiddenTabs: [],
  tabMaintenance: {},
  editorialBoard: '',
  responsiblePerson: '',
  copyrightText: '',
  softwareTeamContact: {
    enabled: true,
    teamName: '',
    roleLabel: '',
    personName: '',
    phone: '',
    email: '',
    zaloUrl: '',
    facebookUrl: '',
    websiteUrl: '',
    supportHours: '',
    note: '',
  },
  autoBackupGithubEnabled: true,
  accessControl: {
    rules: {},
    customMessage:
      'Hiện tại hệ thống đang tạm hạn chế truy cập trên loại thiết bị hoặc trình duyệt bạn đang sử dụng. Vui lòng chuyển sang thiết bị/trình duyệt được hỗ trợ hoặc liên hệ Trạm Y tế qua số Cấp cứu 24/7 bên dưới.',
    exemptAdmins: true,
  },
  bhxhApi: {
    enabled: false,
    baseUrl: 'https://egw.baohiemxahoi.gov.vn',
    lookupEndpoint: 'KQNhanLichSuKCB2024',
    defaultMaCskcb: '',
    usernameMasked: '',
    hasCredentials: false,
    hasOfficerInfo: false,
    autoLookupFacilityName: true,
    showHistoryKcb: true,
  },
};

export interface SidebarTabDefinition {
  id: string;
  label: string;
  hash: string;
  group: 'CỔNG THÔNG TIN ĐIỆN TỬ' | 'TIỆN ÍCH DÂN CƯ';
}

export const CONTROLLABLE_SIDEBAR_TABS: SidebarTabDefinition[] = [
  { id: 'portal', label: 'Trang chủ & Giới thiệu', hash: '#trang-chu', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'org_chart', label: 'Sơ đồ tổ chức', hash: '#so-do-to-chuc', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'personnel_directory', label: 'Nhân lực & Khoa phòng', hash: '#nhan-luc-khoa-phong', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'vaccination', label: 'Lịch tiêm chủng', hash: '#lich-tiem-chung', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'events', label: 'Sự kiện', hash: '#su-kien', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'duty', label: 'Lịch trực 24/7 & Làm việc', hash: '#lich-truc', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'map', label: 'Bản đồ & Định vị trạm', hash: '#ban-do', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'nearby_facilities', label: 'Cơ sở Y tế lân cận', hash: '#co-so-y-te-lan-can', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'rescue', label: 'Bản đồ Cứu hộ cứu nạn', hash: '#cuu-ho-cuu-nan', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'news', label: 'Tin tức & Media', hash: '#tin-tuc', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'documents', label: 'Văn bản & Biểu mẫu', hash: '#van-ban', group: 'CỔNG THÔNG TIN ĐIỆN TỬ' },
  { id: 'bhyt_lookup', label: 'Tra cứu thông tin BHYT', hash: '#tra-cuu-bhyt', group: 'TIỆN ÍCH DÂN CƯ' },
  { id: 'telehealth', label: 'Bác sĩ cho mọi nhà', hash: '#bac-si-cho-moi-nha', group: 'TIỆN ÍCH DÂN CƯ' },
  { id: 'feedback_tracking', label: 'Phản ánh', hash: '#phan-anh', group: 'TIỆN ÍCH DÂN CƯ' },
];

export const DEFAULT_VACCINATION_START_TIME = '07:00';
export const DEFAULT_VACCINATION_END_TIME = '11:00';
export const DEFAULT_VACCINATION_AUDIENCE =
  'Trẻ em theo lịch Tiêm chủng mở rộng & đối tượng chỉ định trên địa bàn';
export const DEFAULT_VACCINATION_VACCINES =
  'Các loại vắc xin trong Chương trình Tiêm chủng mở rộng theo phân bổ';
export const DEFAULT_VACCINATION_NOTES =
  'Phụ huynh mang theo sổ tiêm chủng và CCCD/mã định danh của trẻ; ở lại theo dõi sau tiêm ít nhất 30 phút.';

const VACCINATION_STATUS_RANK: Record<VaccinationScheduleItem['status'], number> = {
  ongoing: 0,
  upcoming: 1,
  postponed: 2,
  completed: 3,
};

export function sortVaccinationSchedules(
  schedules?: VaccinationScheduleItem[]
): VaccinationScheduleItem[] {
  if (!Array.isArray(schedules)) return [];
  const nowMs = Date.now();
  return [...schedules].sort((a, b) => {
    const statusA = resolveVaccinationLifecycle(a, nowMs).effectiveStatus;
    const statusB = resolveVaccinationLifecycle(b, nowMs).effectiveStatus;
    const rankA = VACCINATION_STATUS_RANK[statusA] ?? 4;
    const rankB = VACCINATION_STATUS_RANK[statusB] ?? 4;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
      return a.isPinned ? -1 : 1;
    }
    const dateCompare = (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31');
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

export function getActiveVaccinationSchedules(
  settings?: Partial<SystemSettings>
): VaccinationScheduleItem[] {
  const list = (settings?.vaccinationSchedules || []).filter(item => item.isActive !== false);
  return sortVaccinationSchedules(list);
}

export function formatIsoDateVN(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export function formatVaccinationDateRange(
  item: Pick<VaccinationScheduleItem, 'date' | 'endDate' | 'dateLabel'>
): string {
  if (item.dateLabel && item.dateLabel.trim()) {
    return item.dateLabel.trim();
  }
  const startFormatted = formatIsoDateVN(item.date);
  if (item.endDate && item.endDate > item.date) {
    return `${startFormatted} - ${formatIsoDateVN(item.endDate)}`;
  }
  return startFormatted || 'Đang cập nhật';
}

export function enumerateDateRange(startIso: string, endIso: string, maxDays = 31): string[] {
  if (!startIso) return [];
  if (!endIso || endIso <= startIso) return [startIso];

  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return [startIso];

  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  const dates: string[] = [];

  for (let cur = new Date(start); cur <= end && dates.length < maxDays; cur.setUTCDate(cur.getUTCDate() + 1)) {
    dates.push(cur.toISOString().split('T')[0]);
  }
  return dates.length > 0 ? dates : [startIso];
}

export function sortLocationsPrimaryFirst<T extends { isPrimary?: boolean }>(locations: T[]): T[] {
  return [...locations].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return 0;
  });
}

function parseClockTime(clockStr?: string, fallbackHour = 7, fallbackMin = 0): [number, number] {
  if (!clockStr) return [fallbackHour, fallbackMin];
  const m = clockStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return [fallbackHour, fallbackMin];
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return [h, min];
}

export function getVaccinationBounds(
  item: Pick<VaccinationScheduleItem, 'date' | 'endDate' | 'startTime' | 'endTime' | 'timeRange'>
): { startMs: number; endMs: number } | null {
  if (!item.date) return null;
  const startParts = item.date.split('-').map(Number);
  if (startParts.length !== 3 || startParts.some(n => Number.isNaN(n))) return null;

  const endIso = item.endDate && item.endDate >= item.date ? item.endDate : item.date;
  const endParts = endIso.split('-').map(Number);
  if (endParts.length !== 3 || endParts.some(n => Number.isNaN(n))) return null;

  let startHour = 7;
  let startMin = 0;
  let endHour = 11;
  let endMin = 0;

  const timeMatches = (item.timeRange || '').match(/\b\d{1,2}:\d{2}\b/g);
  if (item.startTime && /^\d{1,2}:\d{2}$/.test(item.startTime.trim())) {
    [startHour, startMin] = parseClockTime(item.startTime, 7, 0);
  } else if (timeMatches && timeMatches.length > 0) {
    [startHour, startMin] = parseClockTime(timeMatches[0], 7, 0);
  }

  if (item.endTime && /^\d{1,2}:\d{2}$/.test(item.endTime.trim())) {
    [endHour, endMin] = parseClockTime(item.endTime, 11, 0);
  } else if (timeMatches && timeMatches.length > 0) {
    [endHour, endMin] = parseClockTime(timeMatches[timeMatches.length - 1], 11, 0);
  }

  const startMs = new Date(startParts[0], startParts[1] - 1, startParts[2], startHour, startMin, 0).getTime();
  let endMs = new Date(endParts[0], endParts[1] - 1, endParts[2], endHour, endMin, 59).getTime();
  if (endMs < startMs) {
    endMs = new Date(endParts[0], endParts[1] - 1, endParts[2], 23, 59, 59).getTime();
  }
  return { startMs, endMs };
}

export function resolveVaccinationLifecycle(
  item: Pick<VaccinationScheduleItem, 'date' | 'endDate' | 'startTime' | 'endTime' | 'timeRange' | 'status'>,
  nowMs = Date.now()
): {
  effectiveStatus: VaccinationScheduleItem['status'];
  startMs: number | null;
  endMs: number | null;
} {
  const bounds = getVaccinationBounds(item);
  if (!bounds) {
    return { effectiveStatus: item.status, startMs: null, endMs: null };
  }

  if (item.status === 'postponed') {
    return { effectiveStatus: 'postponed', startMs: bounds.startMs, endMs: bounds.endMs };
  }

  let effectiveStatus: VaccinationScheduleItem['status'] = 'upcoming';
  if (nowMs > bounds.endMs) {
    effectiveStatus = 'completed';
  } else if (nowMs >= bounds.startMs && nowMs <= bounds.endMs) {
    effectiveStatus = 'ongoing';
  }

  return {
    effectiveStatus,
    startMs: bounds.startMs,
    endMs: bounds.endMs,
  };
}

export function getConfiguredEmergencyContacts(settings?: Partial<SystemSettings>): EmergencyContact[] {
  if (settings?.emergencyContacts && settings.emergencyContacts.length > 0) {
    return settings.emergencyContacts
      .filter(c => c.phone && c.phone.trim())
      .map((c, idx) => ({
        id: c.id || `ec_${idx + 1}`,
        phone: c.phone.trim(),
        note: (c.note || '').trim(),
      }));
  }
  const primaryPhone = settings?.emergencyPhone?.trim();
  if (!primaryPhone) return [];
  return [
    {
      id: 'ec_1',
      phone: primaryPhone,
      note: (settings?.emergencyNote || '').trim(),
    },
  ];
}

// System Settings
export async function getSystemSettings(): Promise<SystemSettings> {
  const path = 'systemSettings';
  try {
    const docRef = doc(db, path, 'general');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as SystemSettings;
    }
    return emptySystemSettings;
  } catch (error) {
    console.warn('System settings read:', error);
    return emptySystemSettings;
  }
}

export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<void> {
  const path = 'systemSettings';
  try {
    const docRef = doc(db, path, 'general');
    await setDoc(docRef, cleanDataForFirestore(settings), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// Posts (News & Health Education)
export async function getPosts(): Promise<Post[]> {
  const path = 'posts';
  try {
    const q = query(collection(db, path), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Post));
  } catch (error) {
    console.warn('Posts read:', error);
    return [];
  }
}

export async function createPost(post: Omit<Post, 'id'>): Promise<string> {
  const path = 'posts';
  try {
    const ref = await addDoc(collection(db, path), cleanDataForFirestore(post));
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePost(id: string, post: Partial<Post>): Promise<void> {
  const path = `posts/${id}`;
  try {
    await updateDoc(doc(db, 'posts', id), cleanDataForFirestore(post));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePost(id: string): Promise<void> {
  const path = `posts/${id}`;
  try {
    await deleteDoc(doc(db, 'posts', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deletePostsBatch(ids: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  const path = 'posts';
  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
      for (const id of chunk) {
        batch.delete(doc(db, 'posts', id));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updatePostsSortOrder(
  updates: Array<{ id: string; sortOrder: number }>
): Promise<void> {
  if (updates.length === 0) return;
  const path = 'posts';
  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      for (const item of chunk) {
        batch.update(doc(db, 'posts', item.id), { sortOrder: item.sortOrder });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// Announcements
export async function getAnnouncements(): Promise<Announcement[]> {
  const path = 'announcements';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Announcement));
  } catch (error) {
    console.warn('Announcements read:', error);
    return [];
  }
}

export async function createAnnouncement(announcement: Omit<Announcement, 'id'>): Promise<string> {
  const path = 'announcements';
  try {
    const ref = await addDoc(collection(db, path), cleanDataForFirestore(announcement));
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const path = `announcements/${id}`;
  try {
    await deleteDoc(doc(db, 'announcements', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Services Catalog
export async function getServices(): Promise<ServiceItem[]> {
  const path = 'services';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceItem));
  } catch (error) {
    console.warn('Services read:', error);
    return [];
  }
}

export async function createService(service: Omit<ServiceItem, 'id'>): Promise<string> {
  const path = 'services';
  try {
    const ref = await addDoc(collection(db, path), cleanDataForFirestore(service));
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateService(id: string, service: Partial<ServiceItem>): Promise<void> {
  const path = `services/${id}`;
  try {
    await updateDoc(doc(db, 'services', id), cleanDataForFirestore(service));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteService(id: string): Promise<void> {
  const path = `services/${id}`;
  try {
    await deleteDoc(doc(db, 'services', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Appointments
export async function getAppointments(): Promise<Appointment[]> {
  const path = 'appointments';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment));
  } catch (error) {
    console.warn('Appointments read:', error);
    return [];
  }
}

export async function createAppointment(appointment: Omit<Appointment, 'id'>): Promise<string> {
  const path = 'appointments';
  try {
    const ref = await addDoc(collection(db, path), cleanDataForFirestore(appointment));
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAppointmentStatus(
  id: string,
  status: Appointment['status'],
  responseNotes?: string
): Promise<void> {
  const path = `appointments/${id}`;
  try {
    const payload: Record<string, any> = { status };
    if (responseNotes !== undefined) {
      payload.responseNotes = responseNotes;
    }
    await updateDoc(doc(db, 'appointments', id), cleanDataForFirestore(payload));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAppointment(id: string): Promise<void> {
  const path = `appointments/${id}`;
  try {
    await deleteDoc(doc(db, 'appointments', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export const MY_FEEDBACK_HISTORY_KEY = 'my_feedback_history';
export const FEEDBACK_HISTORY_EVENT = 'tyt_feedback_history_updated';
const FEEDBACK_HISTORY_MAX_AGE_MS = 42 * 24 * 60 * 60 * 1000; // ~30 business days

export interface LocalFeedbackHistoryItem {
  id?: string;
  code: string;
  date: string;
  createdAtIso: string;
  content: string;
  sender?: string;
  category?: FeedbackItem['category'];
  status?: FeedbackItem['status'];
  withdrawnAt?: string;
  attachments?: FeedbackAttachment[];
  githubBackupUrl?: string;
  uid?: string;
  deviceId?: string;
}

export function parseVietnameseOrIsoDateMs(dateStr?: string, createdAtIso?: string): number {
  if (createdAtIso) {
    const isoMs = Date.parse(createdAtIso);
    if (!Number.isNaN(isoMs)) return isoMs;
  }
  if (!dateStr) return NaN;
  const directMs = Date.parse(dateStr);
  if (!Number.isNaN(directMs)) return directMs;
  // Support vi-VN toLocaleString format like "03:50:12 14/11/2026" or "14/11/2026, 03:50:12"
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const timeMatch = dateStr.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    const hours = timeMatch ? Number(timeMatch[1]) : 0;
    const mins = timeMatch ? Number(timeMatch[2]) : 0;
    const secs = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;
    return new Date(year, month, day, hours, mins, secs).getTime();
  }
  return NaN;
}

export function loadLocalFeedbackHistory(): LocalFeedbackHistoryItem[] {
  try {
    const raw = localStorage.getItem(MY_FEEDBACK_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const valid: LocalFeedbackHistoryItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || !item.code) continue;
      const itemMs = parseVietnameseOrIsoDateMs(item.date, item.createdAtIso);
      const validMs = Number.isNaN(itemMs) ? now : itemMs;
      if (now - validMs <= FEEDBACK_HISTORY_MAX_AGE_MS) {
        valid.push({
          ...item,
          createdAtIso: item.createdAtIso || new Date(validMs).toISOString(),
        });
      }
    }
    valid.sort((a, b) => {
      const msA = Date.parse(a.createdAtIso || '') || 0;
      const msB = Date.parse(b.createdAtIso || '') || 0;
      return msB - msA;
    });
    if (valid.length !== parsed.length) {
      localStorage.setItem(MY_FEEDBACK_HISTORY_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

export function loadScopedLocalFeedbackHistory(
  uid?: string | null,
  deviceId?: string
): LocalFeedbackHistoryItem[] {
  const all = loadLocalFeedbackHistory();
  const cleanUid = uid?.trim() || '';
  if (cleanUid) {
    return all.filter(item => item.uid === cleanUid);
  }
  const resolvedDeviceId = deviceId?.trim() || getOrCreateDeviceId();
  return all.filter(
    item => item.uid === '' && item.deviceId === resolvedDeviceId
  );
}

export function saveLocalFeedbackHistory(items: LocalFeedbackHistoryItem[]): void {
  try {
    localStorage.setItem(MY_FEEDBACK_HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(FEEDBACK_HISTORY_EVENT));
    }
  } catch (e) {
    console.warn('Save local feedback history error:', e);
  }
}

export function appendLocalFeedbackHistory(entry: LocalFeedbackHistoryItem): LocalFeedbackHistoryItem[] {
  const existing = loadLocalFeedbackHistory().filter(
    item => item.code.toUpperCase() !== entry.code.toUpperCase()
  );
  const next = [entry, ...existing].slice(0, 50);
  saveLocalFeedbackHistory(next);
  return next;
}

export function updateLocalFeedbackHistoryItem(
  codeOrId: string,
  patch: Partial<LocalFeedbackHistoryItem>
): LocalFeedbackHistoryItem[] {
  const target = codeOrId.trim().toUpperCase();
  const next = loadLocalFeedbackHistory().map(item =>
    item.code.toUpperCase() === target || (item.id && item.id.toUpperCase() === target)
      ? { ...item, ...patch }
      : item
  );
  saveLocalFeedbackHistory(next);
  return next;
}

export function generateFeedbackTicketCode(): string {
  const year = new Date().getFullYear();
  const num = Math.floor(100000 + Math.random() * 900000);
  return `PA-${year}-${num}`;
}

// Feedback & Petitions
export async function getFeedbackList(): Promise<FeedbackItem[]> {
  const path = 'feedback';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as FeedbackItem));
  } catch (error) {
    console.warn('Feedback read:', error);
    return [];
  }
}

export async function getFeedbackByIdOrCode(idOrCode: string): Promise<FeedbackItem | null> {
  const clean = idOrCode.trim();
  if (!clean) return null;
  try {
    const snap = await getDoc(doc(db, 'feedback', clean));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as FeedbackItem;
    }
    const upper = clean.toUpperCase();
    if (upper !== clean) {
      const upperSnap = await getDoc(doc(db, 'feedback', upper));
      if (upperSnap.exists()) {
        return { id: upperSnap.id, ...upperSnap.data() } as FeedbackItem;
      }
    }
    return null;
  } catch (error) {
    console.warn('Feedback single read:', error);
    return null;
  }
}

export async function createFeedback(feedback: Omit<FeedbackItem, 'id'>): Promise<string> {
  const path = 'feedback';
  const deviceId = getOrCreateDeviceId();
  const payload = cleanDataForFirestore({
    ...feedback,
    deviceId: feedback.deviceId || deviceId,
    uid: feedback.uid || auth.currentUser?.uid || '',
  });
  try {
    const docId = feedback.ticketCode?.trim();
    if (docId && /^[a-zA-Z0-9_-]{3,128}$/.test(docId)) {
      const targetRef = doc(db, path, docId);
      await setDoc(targetRef, payload);
      return docId;
    }
    const ref = await addDoc(collection(db, path), payload);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateFeedbackResponse(
  id: string,
  status: FeedbackItem['status'],
  response?: string,
  assignedDepartment?: string
): Promise<void> {
  const path = `feedback/${id}`;
  try {
    const payload: Record<string, any> = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (response !== undefined) {
      payload.response = response;
    }
    if (assignedDepartment !== undefined && assignedDepartment.trim() !== '') {
      payload.assignedDepartment = assignedDepartment.trim();
    }
    await updateDoc(doc(db, 'feedback', id), cleanDataForFirestore(payload));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface WithdrawFeedbackResult {
  withdrawnAt: string;
  foundInFirestore: boolean;
  resolvedId: string;
}

export async function withdrawFeedback(
  idOrCode: string,
  ticketCode?: string
): Promise<WithdrawFeedbackResult> {
  const nowIso = new Date().toISOString();
  const primaryId = idOrCode.trim();
  const codeToMatch = (ticketCode || idOrCode).trim();

  if (!auth.currentUser?.uid) {
    return {
      withdrawnAt: nowIso,
      foundInFirestore: false,
      resolvedId: primaryId || codeToMatch,
    };
  }

  let resolvedId: string | null = null;
  let existingData: Record<string, any> | null = null;

  try {
    if (primaryId) {
      const snap = await getDoc(doc(db, 'feedback', primaryId));
      if (snap.exists()) {
        resolvedId = snap.id;
        existingData = snap.data();
      }
    }

    if (!resolvedId && codeToMatch && codeToMatch !== primaryId) {
      const codeSnap = await getDoc(doc(db, 'feedback', codeToMatch));
      if (codeSnap.exists()) {
        resolvedId = codeSnap.id;
        existingData = codeSnap.data();
      }
    }

    // Legacy fallback: docs created previously via addDoc() have random IDs instead of ticketCode
    if (!resolvedId && codeToMatch && auth.currentUser?.uid) {
      try {
        const ownSnap = await getDocs(
          query(
            collection(db, 'feedback'),
            where('uid', '==', auth.currentUser.uid),
            where('ticketCode', '==', codeToMatch)
          )
        );
        if (!ownSnap.empty) {
          resolvedId = ownSnap.docs[0].id;
          existingData = ownSnap.docs[0].data();
        }
      } catch {
        // Ignore if query fails permissions
      }
    }

    if (!resolvedId && codeToMatch) {
      try {
        const staffSnap = await getDocs(
          query(collection(db, 'feedback'), where('ticketCode', '==', codeToMatch))
        );
        if (!staffSnap.empty) {
          resolvedId = staffSnap.docs[0].id;
          existingData = staffSnap.docs[0].data();
        }
      } catch {
        // Non-staff citizens cannot run collection-wide ticketCode queries; safely ignore
      }
    }
  } catch (lookupErr) {
    console.warn('Lookup feedback before withdraw failed:', lookupErr);
  }

  if (!resolvedId) {
    return {
      withdrawnAt: nowIso,
      foundInFirestore: false,
      resolvedId: primaryId || codeToMatch,
    };
  }

  if (existingData?.status === 'withdrawn') {
    return {
      withdrawnAt: existingData.withdrawnAt || nowIso,
      foundInFirestore: true,
      resolvedId,
    };
  }

  const path = `feedback/${resolvedId}`;
  try {
    await updateDoc(
      doc(db, 'feedback', resolvedId),
      cleanDataForFirestore({
        status: 'withdrawn',
        withdrawnAt: nowIso,
        updatedAt: nowIso,
      })
    );
    return {
      withdrawnAt: nowIso,
      foundInFirestore: true,
      resolvedId,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFeedback(id: string): Promise<void> {
  const path = `feedback/${id}`;
  try {
    await deleteDoc(doc(db, 'feedback', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Staff Tasks
export async function getStaffTasks(): Promise<StaffTask[]> {
  const path = 'tasks';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffTask));
  } catch (error) {
    console.warn('Staff tasks read:', error);
    return [];
  }
}

export async function createStaffTask(task: Omit<StaffTask, 'id'>): Promise<string> {
  const path = 'tasks';
  try {
    const ref = await addDoc(collection(db, path), cleanDataForFirestore(task));
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStaffTaskStatus(id: string, status: StaffTask['status']): Promise<void> {
  const path = `tasks/${id}`;
  try {
    await updateDoc(doc(db, 'tasks', id), cleanDataForFirestore({ status }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStaffTask(id: string): Promise<void> {
  const path = `tasks/${id}`;
  try {
    await deleteDoc(doc(db, 'tasks', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Work Schedules & Duty
export async function getWorkSchedules(): Promise<WorkSchedule[]> {
  const path = 'workSchedules';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkSchedule));
  } catch (error) {
    console.warn('Work schedules read:', error);
    return [];
  }
}

export async function createWorkSchedule(schedule: Omit<WorkSchedule, 'id'>): Promise<string> {
  const path = 'workSchedules';
  try {
    const ref = await addDoc(collection(db, path), cleanDataForFirestore(schedule));
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateWorkSchedule(id: string, schedule: Partial<WorkSchedule>): Promise<void> {
  const path = `workSchedules/${id}`;
  try {
    await updateDoc(doc(db, 'workSchedules', id), cleanDataForFirestore(schedule));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteWorkSchedule(id: string): Promise<void> {
  const path = `workSchedules/${id}`;
  try {
    await deleteDoc(doc(db, 'workSchedules', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Documents
export async function getDocuments(): Promise<DocumentItem[]> {
  const path = 'documents';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentItem));
  } catch (error) {
    console.warn('Documents read:', error);
    return [];
  }
}

const MAX_SAFE_FIRESTORE_DOC_BYTES = 920_000;

function assertDocumentPayloadWithinLimit(payload: Record<string, any>): void {
  const byteSize = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (byteSize > MAX_SAFE_FIRESTORE_DOC_BYTES) {
    const sizeMb = (byteSize / (1024 * 1024)).toFixed(2);
    throw new Error(
      `Dữ liệu văn bản (${sizeMb} MB) vượt quá giới hạn tối đa ~0.9 MB của Firestore. Vui lòng cấu hình lưu trữ GitHub trong Quản trị hệ thống hoặc dán đường dẫn Google Drive / liên kết ngoài.`
    );
  }
}

export async function createDocumentItem(docItem: Omit<DocumentItem, 'id'>): Promise<string> {
  const path = 'documents';
  const cleaned = cleanDataForFirestore(docItem);
  assertDocumentPayloadWithinLimit(cleaned);
  try {
    const ref = await addDoc(collection(db, path), cleaned);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateDocumentItem(id: string, docItem: Partial<DocumentItem>): Promise<void> {
  const path = `documents/${id}`;
  const cleaned = cleanDataForFirestore(docItem);
  assertDocumentPayloadWithinLimit(cleaned);
  try {
    await updateDoc(doc(db, 'documents', id), cleaned);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteDocumentItem(id: string): Promise<void> {
  const path = `documents/${id}`;
  try {
    await deleteDoc(doc(db, 'documents', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Audit Logs
export async function getAuditLogs(): Promise<AuditLog[]> {
  const path = 'auditLogs';
  try {
    const q = query(collection(db, path), orderBy('timestamp', 'desc'), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog));
  } catch (error) {
    console.warn('Audit logs read:', error);
    return [];
  }
}

export async function logAuditEvent(
  action: string,
  module: string,
  details: string,
  user?: { uid: string; name: string }
): Promise<void> {
  const path = 'auditLogs';
  try {
    await addDoc(
      collection(db, path),
      cleanDataForFirestore({
        userUid: user?.uid || 'anonymous',
        userName: user?.name || 'Khách truy cập',
        action,
        module,
        details,
        timestamp: new Date().toLocaleString('vi-VN'),
      })
    );
  } catch {
    // Non-blocking
  }
}

// User Profiles
export async function getUserProfiles(): Promise<UserProfile[]> {
  const path = 'users';
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
  } catch {
    return [];
  }
}

export async function updateUserRole(
  uid: string,
  role: UserProfile['role'],
  accountType: UserProfile['accountType']
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      role,
      accountType,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteUserProfile(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await deleteDoc(doc(db, 'users', uid));
    try {
      await deleteDoc(doc(db, 'admins', uid));
    } catch {
      // Admin registry doc might not exist for non-admin users
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Targeted Notifications (CCCD, Phone, Org, All, Read/Unread + Analytics)
export async function createTargetedNotification(
  item: Omit<TargetedNotification, 'id' | 'readByUids' | 'createdAt'>
): Promise<string> {
  const path = 'targetedNotifications';
  try {
    const payload = cleanDataForFirestore({
      ...item,
      readByUids: [],
      readByDeviceIds: [],
      viewCount: 0,
      createdAt: new Date().toISOString(),
    });
    const ref = await addDoc(collection(db, path), payload);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function markNotificationAsRead(
  notificationId: string,
  userUid: string
): Promise<void> {
  return markNotificationViewed(notificationId, userUid);
}

export async function markNotificationViewed(
  notificationId: string,
  userUid?: string
): Promise<void> {
  if (!notificationId) return;
  const deviceId = getOrCreateDeviceId();
  const countedKey = 'tyt_counted_notif_views_v1';
  let alreadyCounted = false;
  try {
    const raw = localStorage.getItem(countedKey);
    const list: string[] = raw ? JSON.parse(raw) : [];
    alreadyCounted = Array.isArray(list) && list.includes(notificationId);
    if (!alreadyCounted) {
      localStorage.setItem(countedKey, JSON.stringify([...list, notificationId].slice(-300)));
    }
  } catch {
    // ignore storage errors
  }

  try {
    const updatePayload: Record<string, any> = {
      readByDeviceIds: arrayUnion(deviceId),
    };
    if (userUid) {
      updatePayload.readByUids = arrayUnion(userUid);
    }
    if (!alreadyCounted) {
      updatePayload.viewCount = increment(1);
    }
    await updateDoc(doc(db, 'targetedNotifications', notificationId), updatePayload);
  } catch (error) {
    console.warn('Mark notification viewed error:', error);
  }
}

export async function markAnnouncementViewed(announcementId: string): Promise<void> {
  if (!announcementId) return;
  const deviceId = getOrCreateDeviceId();
  const countedKey = 'tyt_counted_ann_views_v1';
  let alreadyCounted = false;
  try {
    const raw = localStorage.getItem(countedKey);
    const list: string[] = raw ? JSON.parse(raw) : [];
    alreadyCounted = Array.isArray(list) && list.includes(announcementId);
    if (!alreadyCounted) {
      localStorage.setItem(countedKey, JSON.stringify([...list, announcementId].slice(-200)));
    }
  } catch {
    // ignore
  }

  try {
    const updatePayload: Record<string, any> = {
      readByDeviceIds: arrayUnion(deviceId),
    };
    if (!alreadyCounted) {
      updatePayload.viewCount = increment(1);
    }
    await updateDoc(doc(db, 'announcements', announcementId), updatePayload);
  } catch (error) {
    console.warn('Mark announcement viewed error:', error);
  }
}

export async function recordPostViewOnce(postId: string): Promise<void> {
  if (!postId || isFirestoreWriteQuotaExceeded()) return;
  const viewedKey = 'tyt_viewed_posts_v1';
  try {
    const raw = sessionStorage.getItem(viewedKey);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list) && list.includes(postId)) {
      return;
    }
    sessionStorage.setItem(viewedKey, JSON.stringify([...list, postId].slice(-200)));
  } catch {
    // ignore session storage errors
  }

  try {
    await updateDoc(doc(db, 'posts', postId), {
      views: increment(1),
    });
  } catch (error) {
    markFirestoreWriteQuotaExceededIfMatch(error);
    console.warn('Record post view error:', error);
  }
}

export async function savePushSubscriptionRecord(
  record: PushSubscriptionRecord
): Promise<void> {
  if (!record.deviceId || isFirestoreWriteQuotaExceeded()) return;
  try {
    await setDoc(
      doc(db, 'pushSubscriptions', record.deviceId),
      cleanDataForFirestore(record),
      { merge: true }
    );
  } catch (error) {
    markFirestoreWriteQuotaExceededIfMatch(error);
    console.warn('Save push subscription record error:', error);
  }
}

export async function deletePushSubscriptionRecord(deviceId: string): Promise<void> {
  if (!deviceId) return;
  try {
    await deleteDoc(doc(db, 'pushSubscriptions', deviceId));
  } catch (error) {
    console.warn('Delete push subscription record error:', error);
  }
}

export async function deleteTargetedNotification(id: string): Promise<void> {
  const path = `targetedNotifications/${id}`;
  try {
    await deleteDoc(doc(db, 'targetedNotifications', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Nearby Healthcare Facilities (Cơ sở Y tế lân cận)
function sanitizePendingEditPayload(
  editData?: NearbyFacilityEditPayload
): NearbyFacilityEditPayload | undefined {
  if (!editData) return undefined;
  return cleanDataForFirestore({
    name: String(editData.name || '').trim().slice(0, 256),
    facilityType: editData.facilityType,
    level: String(editData.level || '').trim().slice(0, 128),
    address: String(editData.address || '').trim().slice(0, 512),
    ward: String(editData.ward || '').trim().slice(0, 128),
    lat: Math.max(-90, Math.min(90, Number(editData.lat) || 0)),
    lng: Math.max(-180, Math.min(180, Number(editData.lng) || 0)),
    phone: String(editData.phone || '').trim().slice(0, 64),
    emergencyPhone: String(editData.emergencyPhone || '').trim().slice(0, 64),
    workingHours: String(editData.workingHours || '').trim().slice(0, 256),
    is24Hours: Boolean(editData.is24Hours),
    hasEmergency: Boolean(editData.hasEmergency),
    hasBhyt: Boolean(editData.hasBhyt),
    services: String(editData.services || '').trim().slice(0, 2000),
    bedCount: Math.max(0, Math.round(Number(editData.bedCount) || 0)),
    headName: String(editData.headName || '').trim().slice(0, 128),
    website: String(editData.website || '').trim().slice(0, 512),
    notes: String(editData.notes || '').trim().slice(0, 2000),
    submittedBy: editData.submittedBy?.trim()
      ? editData.submittedBy.trim().slice(0, 128)
      : undefined,
    requestedAt: (editData.requestedAt || new Date().toISOString()).slice(0, 64),
  });
}

function sanitizeNearbyFacilityPayload(
  item: Partial<Omit<NearbyFacility, 'id'>>,
  isCreate: boolean
): Record<string, any> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, any> = {};

  if (item.name !== undefined) payload.name = String(item.name).trim().slice(0, 256);
  if (item.facilityType !== undefined) payload.facilityType = item.facilityType;
  if (item.level !== undefined && item.level.trim()) payload.level = item.level.trim().slice(0, 128);
  if (item.address !== undefined) payload.address = String(item.address).trim().slice(0, 512);
  if (item.ward !== undefined && item.ward.trim()) payload.ward = item.ward.trim().slice(0, 128);
  if (typeof item.lat === 'number' && !Number.isNaN(item.lat)) {
    payload.lat = Math.max(-90, Math.min(90, item.lat));
  }
  if (typeof item.lng === 'number' && !Number.isNaN(item.lng)) {
    payload.lng = Math.max(-180, Math.min(180, item.lng));
  }
  if (item.phone !== undefined && item.phone.trim()) payload.phone = item.phone.trim().slice(0, 64);
  if (item.emergencyPhone !== undefined && item.emergencyPhone.trim()) {
    payload.emergencyPhone = item.emergencyPhone.trim().slice(0, 64);
  }
  if (item.workingHours !== undefined && item.workingHours.trim()) {
    payload.workingHours = item.workingHours.trim().slice(0, 256);
  }
  if (typeof item.is24Hours === 'boolean') payload.is24Hours = item.is24Hours;
  if (typeof item.hasEmergency === 'boolean') payload.hasEmergency = item.hasEmergency;
  if (typeof item.hasBhyt === 'boolean') payload.hasBhyt = item.hasBhyt;
  if (item.services !== undefined && item.services.trim()) {
    payload.services = item.services.trim().slice(0, 2000);
  }
  if (typeof item.bedCount === 'number' && !Number.isNaN(item.bedCount)) {
    payload.bedCount = Math.max(0, Math.round(item.bedCount));
  }
  if (item.headName !== undefined && item.headName.trim()) {
    payload.headName = item.headName.trim().slice(0, 128);
  }
  if (item.website !== undefined && item.website.trim()) {
    payload.website = item.website.trim().slice(0, 512);
  }
  if (item.notes !== undefined && item.notes.trim()) {
    payload.notes = item.notes.trim().slice(0, 2000);
  }
  if (
    item.approvalStatus === 'approved' ||
    item.approvalStatus === 'pending' ||
    item.approvalStatus === 'rejected'
  ) {
    payload.approvalStatus = item.approvalStatus;
  }
  if (item.submittedBy !== undefined && item.submittedBy.trim()) {
    payload.submittedBy = item.submittedBy.trim().slice(0, 128);
  }
  if (item.submittedByUid !== undefined && item.submittedByUid.trim()) {
    payload.submittedByUid = item.submittedByUid.trim().slice(0, 128);
  }
  if (item.submitterDeviceId !== undefined && item.submitterDeviceId.trim()) {
    payload.submitterDeviceId = item.submitterDeviceId.trim().slice(0, 128);
  }
  if (item.rejectionReason !== undefined && item.rejectionReason.trim()) {
    payload.rejectionReason = item.rejectionReason.trim().slice(0, 512);
  }
  if (
    item.editStatus === 'none' ||
    item.editStatus === 'pending_edit' ||
    item.editStatus === 'rejected_edit'
  ) {
    payload.editStatus = item.editStatus;
  }
  if (item.pendingEditData) {
    payload.pendingEditData = sanitizePendingEditPayload(item.pendingEditData);
  }
  if (item.editRequestedAt !== undefined && item.editRequestedAt.trim()) {
    payload.editRequestedAt = item.editRequestedAt.trim().slice(0, 64);
  }
  if (item.editRejectionReason !== undefined && item.editRejectionReason.trim()) {
    payload.editRejectionReason = item.editRejectionReason.trim().slice(0, 512);
  }
  if (typeof item.isActive === 'boolean') payload.isActive = item.isActive;
  if (typeof item.order === 'number' && !Number.isNaN(item.order)) payload.order = item.order;

  if (isCreate) {
    payload.createdAt = (item.createdAt || nowIso).slice(0, 64);
    payload.updatedAt = (item.updatedAt || nowIso).slice(0, 64);
    if (payload.isActive === undefined) payload.isActive = true;
  } else {
    if (item.createdAt) payload.createdAt = item.createdAt.slice(0, 64);
    payload.updatedAt = nowIso;
  }

  return cleanDataForFirestore(payload);
}

export async function createNearbyFacility(
  item: Omit<NearbyFacility, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const path = 'nearbyFacilities';
  try {
    const id = `fac_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = sanitizeNearbyFacilityPayload(
      {
        ...item,
        approvalStatus: item.approvalStatus || 'approved',
        editStatus: item.editStatus || 'none',
      },
      true
    );
    await setDoc(doc(db, path, id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export interface PendingNearbyFacilityInput {
  name: string;
  facilityType: NearbyFacility['facilityType'];
  level: string;
  address: string;
  ward: string;
  lat: number;
  lng: number;
  phone: string;
  emergencyPhone: string;
  workingHours: string;
  is24Hours: boolean;
  hasEmergency: boolean;
  hasBhyt: boolean;
  services: string;
  bedCount: number;
  headName: string;
  website: string;
  notes: string;
  submittedBy?: string;
  submittedByUid?: string;
  submitterDeviceId?: string;
}

export async function submitPendingNearbyFacility(
  input: PendingNearbyFacilityInput
): Promise<{ id: string; createdAt: string; deviceId: string; uid: string }> {
  const path = 'nearbyFacilities';
  try {
    const nowIso = new Date().toISOString();
    const id = `fac_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const resolvedUid = (input.submittedByUid ?? auth.currentUser?.uid ?? '').trim().slice(0, 128);
    const resolvedDeviceId = (input.submitterDeviceId || getOrCreateDeviceId()).trim().slice(0, 128);

    const payload = cleanDataForFirestore({
      name: input.name.trim().slice(0, 256),
      facilityType: input.facilityType,
      level: input.level.trim().slice(0, 128),
      address: input.address.trim().slice(0, 512),
      ward: input.ward.trim().slice(0, 128),
      lat: Math.max(-90, Math.min(90, input.lat)),
      lng: Math.max(-180, Math.min(180, input.lng)),
      phone: input.phone.trim().slice(0, 64),
      emergencyPhone: input.emergencyPhone.trim().slice(0, 64),
      workingHours: input.workingHours.trim().slice(0, 256),
      is24Hours: Boolean(input.is24Hours),
      hasEmergency: Boolean(input.hasEmergency),
      hasBhyt: Boolean(input.hasBhyt),
      services: input.services.trim().slice(0, 2000),
      bedCount: Math.max(0, Math.round(input.bedCount)),
      headName: input.headName.trim().slice(0, 128),
      website: input.website.trim().slice(0, 512),
      notes: input.notes.trim().slice(0, 2000),
      submittedBy: input.submittedBy?.trim()
        ? input.submittedBy.trim().slice(0, 128)
        : undefined,
      submittedByUid: resolvedUid || undefined,
      submitterDeviceId: resolvedDeviceId,
      approvalStatus: 'pending',
      editStatus: 'none',
      isActive: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await setDoc(doc(db, path, id), payload);
    return {
      id,
      createdAt: nowIso,
      deviceId: resolvedDeviceId,
      uid: resolvedUid,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function resubmitPendingNearbyFacility(
  id: string,
  input: PendingNearbyFacilityInput & {
    createdAt: string;
    submittedByUid?: string;
    submitterDeviceId?: string;
  }
): Promise<{ updatedAt: string }> {
  const path = `nearbyFacilities/${id}`;
  try {
    const nowIso = new Date().toISOString();
    const resolvedUid = (input.submittedByUid ?? auth.currentUser?.uid ?? '').trim().slice(0, 128);
    const resolvedDeviceId = (input.submitterDeviceId || getOrCreateDeviceId()).trim().slice(0, 128);

    const payload = cleanDataForFirestore({
      name: input.name.trim().slice(0, 256),
      facilityType: input.facilityType,
      level: input.level.trim().slice(0, 128),
      address: input.address.trim().slice(0, 512),
      ward: input.ward.trim().slice(0, 128),
      lat: Math.max(-90, Math.min(90, input.lat)),
      lng: Math.max(-180, Math.min(180, input.lng)),
      phone: input.phone.trim().slice(0, 64),
      emergencyPhone: input.emergencyPhone.trim().slice(0, 64),
      workingHours: input.workingHours.trim().slice(0, 256),
      is24Hours: Boolean(input.is24Hours),
      hasEmergency: Boolean(input.hasEmergency),
      hasBhyt: Boolean(input.hasBhyt),
      services: input.services.trim().slice(0, 2000),
      bedCount: Math.max(0, Math.round(input.bedCount)),
      headName: input.headName.trim().slice(0, 128),
      website: input.website.trim().slice(0, 512),
      notes: input.notes.trim().slice(0, 2000),
      submittedBy: input.submittedBy?.trim()
        ? input.submittedBy.trim().slice(0, 128)
        : undefined,
      submittedByUid: resolvedUid || undefined,
      submitterDeviceId: resolvedDeviceId,
      approvalStatus: 'pending',
      editStatus: 'none',
      isActive: false,
      createdAt: (input.createdAt || nowIso).slice(0, 64),
      updatedAt: nowIso,
    });
    await setDoc(doc(db, 'nearbyFacilities', id), payload);
    return { updatedAt: nowIso };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

export async function proposeApprovedFacilityEdit(
  id: string,
  input: PendingNearbyFacilityInput
): Promise<{ pendingEditData: NearbyFacilityEditPayload; editRequestedAt: string }> {
  const path = `nearbyFacilities/${id}`;
  try {
    const nowIso = new Date().toISOString();
    const pendingEditData: NearbyFacilityEditPayload = cleanDataForFirestore({
      name: input.name.trim().slice(0, 256),
      facilityType: input.facilityType,
      level: input.level.trim().slice(0, 128),
      address: input.address.trim().slice(0, 512),
      ward: input.ward.trim().slice(0, 128),
      lat: Math.max(-90, Math.min(90, input.lat)),
      lng: Math.max(-180, Math.min(180, input.lng)),
      phone: input.phone.trim().slice(0, 64),
      emergencyPhone: input.emergencyPhone.trim().slice(0, 64),
      workingHours: input.workingHours.trim().slice(0, 256),
      is24Hours: Boolean(input.is24Hours),
      hasEmergency: Boolean(input.hasEmergency),
      hasBhyt: Boolean(input.hasBhyt),
      services: input.services.trim().slice(0, 2000),
      bedCount: Math.max(0, Math.round(input.bedCount)),
      headName: input.headName.trim().slice(0, 128),
      website: input.website.trim().slice(0, 512),
      notes: input.notes.trim().slice(0, 2000),
      submittedBy: input.submittedBy?.trim()
        ? input.submittedBy.trim().slice(0, 128)
        : undefined,
      requestedAt: nowIso,
    });

    await updateDoc(
      doc(db, 'nearbyFacilities', id),
      cleanDataForFirestore({
        editStatus: 'pending_edit',
        pendingEditData,
        editRequestedAt: nowIso,
        editRejectionReason: '',
        updatedAt: nowIso,
      })
    );
    return { pendingEditData, editRequestedAt: nowIso };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

export const NEARBY_FACILITY_HISTORY_KEY = 'tyt_nearby_facility_history_v1';

export function loadLocalNearbyFacilityHistory(
  uid?: string | null,
  deviceId?: string
): NearbyFacility[] {
  try {
    const raw = localStorage.getItem(NEARBY_FACILITY_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cleanUid = uid?.trim() || '';
    const resolvedDeviceId = (deviceId || getOrCreateDeviceId()).trim();

    return (parsed as NearbyFacility[])
      .filter(item => {
        if (!item || typeof item !== 'object' || !item.id) return false;
        if (cleanUid) {
          return item.submittedByUid === cleanUid || (!item.submittedByUid && item.submitterDeviceId === resolvedDeviceId);
        }
        return !item.submittedByUid && item.submitterDeviceId === resolvedDeviceId;
      })
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  } catch {
    return [];
  }
}

export function upsertLocalNearbyFacilityHistory(entry: NearbyFacility): void {
  try {
    const raw = localStorage.getItem(NEARBY_FACILITY_HISTORY_KEY);
    const list: NearbyFacility[] = raw ? JSON.parse(raw) : [];
    const filtered = (Array.isArray(list) ? list : []).filter(item => item && item.id !== entry.id);
    const next = [entry, ...filtered].slice(0, 60);
    localStorage.setItem(NEARBY_FACILITY_HISTORY_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('Save local nearby facility history error:', e);
  }
}

export async function updateNearbyFacility(
  id: string,
  item: NearbyFacility
): Promise<void> {
  const path = `nearbyFacilities/${id}`;
  try {
    const { id: _unused, ...rest } = item;
    const payload = sanitizeNearbyFacilityPayload(rest, false);
    await setDoc(doc(db, 'nearbyFacilities', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

export async function deleteNearbyFacility(id: string): Promise<void> {
  const path = `nearbyFacilities/${id}`;
  try {
    await deleteDoc(doc(db, 'nearbyFacilities', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
  }
}

// Rescue Signals (Bản đồ Cứu hộ cứu nạn)
export async function createRescueSignal(
  input: Omit<RescueSignal, 'id' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const path = 'rescueSignals';
  try {
    const nowIso = new Date().toISOString();
    const id = `sos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = cleanDataForFirestore({
      phone: input.phone.trim().slice(0, 32),
      extraPhone: input.extraPhone?.trim() ? input.extraPhone.trim().slice(0, 32) : undefined,
      senderName: input.senderName?.trim() ? input.senderName.trim().slice(0, 128) : undefined,
      senderAvatarUrl: input.senderAvatarUrl?.trim()
        ? input.senderAvatarUrl.trim().slice(0, 500000)
        : undefined,
      senderCitizenIdMasked: input.senderCitizenIdMasked?.trim()
        ? input.senderCitizenIdMasked.trim().slice(0, 32)
        : undefined,
      senderDob: input.senderDob?.trim() ? input.senderDob.trim().slice(0, 32) : undefined,
      senderGender: input.senderGender,
      senderAddress: input.senderAddress?.trim()
        ? input.senderAddress.trim().slice(0, 512)
        : undefined,
      senderVerified: typeof input.senderVerified === 'boolean' ? input.senderVerified : undefined,
      category: input.category,
      note: input.note?.trim() ? input.note.trim().slice(0, 1000) : undefined,
      lat: Math.max(-90, Math.min(90, input.lat)),
      lng: Math.max(-180, Math.min(180, input.lng)),
      accuracy: typeof input.accuracy === 'number' ? Math.round(input.accuracy) : undefined,
      status: 'active',
      deviceId: input.deviceId.slice(0, 128),
      uid: input.uid ? input.uid.slice(0, 128) : undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await setDoc(doc(db, path, id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function updateRescueSignal(
  id: string,
  patch: Partial<
    Pick<
      RescueSignal,
      | 'lat'
      | 'lng'
      | 'accuracy'
      | 'status'
      | 'note'
      | 'responderName'
      | 'responderPhone'
      | 'responderNote'
      | 'outcome'
      | 'referredToFacility'
      | 'resolvedAt'
    >
  >
): Promise<void> {
  const path = `rescueSignals/${id}`;
  try {
    const payload: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (typeof patch.lat === 'number') payload.lat = Math.max(-90, Math.min(90, patch.lat));
    if (typeof patch.lng === 'number') payload.lng = Math.max(-180, Math.min(180, patch.lng));
    if (typeof patch.accuracy === 'number') payload.accuracy = Math.round(patch.accuracy);
    if (patch.status) payload.status = patch.status;
    if (patch.note !== undefined) payload.note = patch.note.trim().slice(0, 1000);
    if (patch.responderName !== undefined) payload.responderName = patch.responderName.trim().slice(0, 128);
    if (patch.responderPhone !== undefined) payload.responderPhone = patch.responderPhone.trim().slice(0, 32);
    if (patch.responderNote !== undefined) payload.responderNote = patch.responderNote.trim().slice(0, 1000);
    if (patch.outcome !== undefined) payload.outcome = patch.outcome;
    if (patch.referredToFacility !== undefined) {
      payload.referredToFacility = patch.referredToFacility.trim().slice(0, 256);
    }
    if (patch.resolvedAt !== undefined) payload.resolvedAt = patch.resolvedAt.slice(0, 64);

    await updateDoc(doc(db, 'rescueSignals', id), cleanDataForFirestore(payload));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

export async function deleteRescueSignal(id: string): Promise<void> {
  const path = `rescueSignals/${id}`;
  try {
    await deleteDoc(doc(db, 'rescueSignals', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
  }
}

// ==========================================
// Station Events & Holiday Celebrations
// ==========================================

export function getVietnamTodayKey(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function diffIsoDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export function isEventHappeningToday(
  ev: Pick<StationEvent, 'eventDate' | 'endDate' | 'isAnnual' | 'isActive'>,
  todayKey = getVietnamTodayKey()
): boolean {
  if (ev.isActive === false || !ev.eventDate) return false;
  if (ev.isAnnual) {
    const startMd = ev.eventDate.slice(5, 10);
    const todayMd = todayKey.slice(5, 10);
    if (ev.endDate && ev.endDate >= ev.eventDate) {
      const endMd = ev.endDate.slice(5, 10);
      if (endMd >= startMd) {
        return todayMd >= startMd && todayMd <= endMd;
      }
      return todayMd >= startMd || todayMd <= endMd;
    }
    return todayMd === startMd;
  }
  if (ev.endDate && ev.endDate >= ev.eventDate) {
    return todayKey >= ev.eventDate && todayKey <= ev.endDate;
  }
  return todayKey === ev.eventDate;
}

export function resolveEventStatus(
  ev: Pick<StationEvent, 'eventDate' | 'endDate' | 'isAnnual' | 'isActive'>,
  todayKey = getVietnamTodayKey()
): { status: 'today' | 'upcoming' | 'past'; daysUntil: number; effectiveDate: string } {
  const baseDate = ev.eventDate || todayKey;
  if (isEventHappeningToday(ev, todayKey)) {
    return { status: 'today', daysUntil: 0, effectiveDate: todayKey };
  }

  if (ev.isAnnual && baseDate.length >= 10) {
    const todayYear = Number(todayKey.slice(0, 4));
    const md = baseDate.slice(5, 10);
    let candidate = `${todayYear}-${md}`;
    if (candidate < todayKey) {
      candidate = `${todayYear + 1}-${md}`;
    }
    return {
      status: 'upcoming',
      daysUntil: Math.max(1, diffIsoDays(todayKey, candidate)),
      effectiveDate: candidate,
    };
  }

  const endBoundary = ev.endDate && ev.endDate >= baseDate ? ev.endDate : baseDate;
  if (endBoundary < todayKey) {
    return {
      status: 'past',
      daysUntil: diffIsoDays(todayKey, baseDate),
      effectiveDate: baseDate,
    };
  }
  return {
    status: 'upcoming',
    daysUntil: Math.max(1, diffIsoDays(todayKey, baseDate)),
    effectiveDate: baseDate,
  };
}

export function sortStationEvents(
  events: StationEvent[],
  todayKey = getVietnamTodayKey()
): StationEvent[] {
  const rankMap = { today: 0, upcoming: 1, past: 2 };
  return [...events].sort((a, b) => {
    const ra = resolveEventStatus(a, todayKey);
    const rb = resolveEventStatus(b, todayKey);
    if (rankMap[ra.status] !== rankMap[rb.status]) {
      return rankMap[ra.status] - rankMap[rb.status];
    }
    if (ra.status === 'upcoming') {
      return ra.daysUntil - rb.daysUntil;
    }
    if (ra.status === 'past') {
      return (b.eventDate || '').localeCompare(a.eventDate || '');
    }
    return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
  });
}

function sanitizeStationEventPayload(
  item: Partial<Omit<StationEvent, 'id'>>,
  isCreate: boolean
): Record<string, any> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, any> = {};

  if (item.title !== undefined) payload.title = String(item.title).trim().slice(0, 256);
  if (item.eventDate !== undefined) payload.eventDate = String(item.eventDate).trim().slice(0, 32);
  if (item.endDate !== undefined && item.endDate.trim()) {
    payload.endDate = item.endDate.trim().slice(0, 32);
  }
  if (item.startTime !== undefined && item.startTime.trim()) {
    payload.startTime = item.startTime.trim().slice(0, 16);
  }
  if (item.endTime !== undefined && item.endTime.trim()) {
    payload.endTime = item.endTime.trim().slice(0, 16);
  }
  if (item.location !== undefined && item.location.trim()) {
    payload.location = item.location.trim().slice(0, 256);
  }
  if (item.category !== undefined) payload.category = item.category;
  if (item.description !== undefined) {
    payload.description = String(item.description).trim().slice(0, 4000);
  }
  if (item.greetingMessage !== undefined && item.greetingMessage.trim()) {
    payload.greetingMessage = item.greetingMessage.trim().slice(0, 2000);
  }
  if (typeof item.enableConfetti === 'boolean') payload.enableConfetti = item.enableConfetti;
  if (typeof item.enableAutoPopup === 'boolean') payload.enableAutoPopup = item.enableAutoPopup;
  if (typeof item.isAnnual === 'boolean') payload.isAnnual = item.isAnnual;
  if (typeof item.isActive === 'boolean') payload.isActive = item.isActive;
  if (item.createdBy !== undefined && item.createdBy.trim()) {
    payload.createdBy = item.createdBy.trim().slice(0, 128);
  }

  if (isCreate) {
    payload.createdAt = (item.createdAt || nowIso).slice(0, 64);
    payload.updatedAt = (item.updatedAt || nowIso).slice(0, 64);
    if (payload.enableConfetti === undefined) payload.enableConfetti = true;
    if (payload.enableAutoPopup === undefined) payload.enableAutoPopup = true;
    if (payload.isActive === undefined) payload.isActive = true;
  } else {
    if (item.createdAt) payload.createdAt = item.createdAt.slice(0, 64);
    payload.updatedAt = nowIso;
  }

  return cleanDataForFirestore(payload);
}

export async function createStationEvent(
  input: Omit<StationEvent, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const path = 'events';
  try {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = sanitizeStationEventPayload(input, true);
    await setDoc(doc(db, path, id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function updateStationEvent(id: string, item: StationEvent): Promise<void> {
  const path = `events/${id}`;
  try {
    const { id: _unused, ...rest } = item;
    const payload = sanitizeStationEventPayload(rest, false);
    await setDoc(doc(db, 'events', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

export async function deleteStationEvent(id: string): Promise<void> {
  const path = `events/${id}`;
  try {
    await deleteDoc(doc(db, 'events', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
  }
}

// ==========================================
// Weekly Work Schedule & Holiday Setup Helpers
// ==========================================

export const DEFAULT_WEEKLY_WORK_DAYS: WeeklyWorkDayConfig[] = [
  {
    dayOfWeek: 1,
    label: 'Thứ Hai',
    isWorking: true,
    morningHours: '07:30 - 11:30',
    afternoonHours: '13:30 - 17:00',
    departmentsSummary: 'Khám BHYT, Cấp cứu ban đầu, Hồ sơ sức khỏe, Hành chính',
    notes: '',
  },
  {
    dayOfWeek: 2,
    label: 'Thứ Ba',
    isWorking: true,
    morningHours: '07:30 - 11:30',
    afternoonHours: '13:30 - 17:00',
    departmentsSummary: 'Khám BHYT, Khám thai & Chăm sóc sức khỏe sinh sản',
    notes: '',
  },
  {
    dayOfWeek: 3,
    label: 'Thứ Tư',
    isWorking: true,
    morningHours: '07:30 - 11:30',
    afternoonHours: '13:30 - 17:00',
    departmentsSummary: 'Khám BHYT, Tiêm chủng mở rộng (theo lịch), Quản lý bệnh mạn tính',
    notes: '',
  },
  {
    dayOfWeek: 4,
    label: 'Thứ Năm',
    isWorking: true,
    morningHours: '07:30 - 11:30',
    afternoonHours: '13:30 - 17:00',
    departmentsSummary: 'Khám BHYT, Tư vấn dinh dưỡng, Phòng chống dịch & ATTP',
    notes: '',
  },
  {
    dayOfWeek: 5,
    label: 'Thứ Sáu',
    isWorking: true,
    morningHours: '07:30 - 11:30',
    afternoonHours: '13:30 - 17:00',
    departmentsSummary: 'Khám BHYT, Cấp thuốc, Tổng hợp báo cáo tuần & Giao ban',
    notes: '',
  },
  {
    dayOfWeek: 6,
    label: 'Thứ Bảy',
    isWorking: false,
    morningHours: '',
    afternoonHours: '',
    departmentsSummary: 'Nghỉ hành chính',
    notes: 'Thường trực cấp cứu 24/24',
  },
  {
    dayOfWeek: 0,
    label: 'Chủ Nhật',
    isWorking: false,
    morningHours: '',
    afternoonHours: '',
    departmentsSummary: 'Nghỉ hành chính',
    notes: 'Thường trực cấp cứu 24/24',
  },
];

export const DEFAULT_WORK_SCHEDULE_CONFIG: WorkScheduleConfig = {
  weeklyDays: DEFAULT_WEEKLY_WORK_DAYS,
  dutyHoursSummary: 'Thường trực cấp cứu 24/24 giờ (07:00 hôm nay đến 07:00 hôm sau, kể cả Thứ 7, Chủ Nhật và ngày Lễ/Tết).',
  generalNote: 'Người dân cần khám BHYT hoặc giải quyết thủ tục hành chính vui lòng đến trong giờ làm việc. Trường hợp cấp cứu liên hệ trực tiếp kíp trực 24/7.',
};

export function getResolvedWeeklyWorkSchedule(settings?: Partial<SystemSettings>): WorkScheduleConfig {
  const configured = settings?.workScheduleConfig;
  if (!configured || !Array.isArray(configured.weeklyDays) || configured.weeklyDays.length === 0) {
    return DEFAULT_WORK_SCHEDULE_CONFIG;
  }
  const dayMap = new Map<number, WeeklyWorkDayConfig>();
  configured.weeklyDays.forEach(d => dayMap.set(d.dayOfWeek, d));
  const mergedDays = DEFAULT_WEEKLY_WORK_DAYS.map(defDay => {
    const found = dayMap.get(defDay.dayOfWeek);
    return found ? { ...defDay, ...found } : defDay;
  });
  return {
    weeklyDays: mergedDays,
    dutyHoursSummary: configured.dutyHoursSummary ?? DEFAULT_WORK_SCHEDULE_CONFIG.dutyHoursSummary,
    generalNote: configured.generalNote ?? DEFAULT_WORK_SCHEDULE_CONFIG.generalNote,
    updatedAt: configured.updatedAt,
  };
}

export const HOLIDAY_PRESETS: Array<{
  label: string;
  name: string;
  mmddStart: string;
  mmddEnd: string;
  isAnnual: boolean;
  noticeTitle: string;
  noticeMessage: string;
  dutyArrangement: string;
}> = [
  {
    label: 'Tết Dương lịch (01/01)',
    name: 'Nghỉ Lễ Tết Dương lịch 01/01',
    mmddStart: '01-01',
    mmddEnd: '01-01',
    isAnnual: true,
    noticeTitle: 'Thông báo nghỉ Lễ Tết Dương lịch',
    noticeMessage:
      'Trạm Y tế tạm nghỉ hoạt động khám chữa bệnh hành chính nhân dịp Tết Dương lịch. Hoạt động tiếp nhận cấp cứu ban đầu vẫn duy trì thường trực 24/24.',
    dutyArrangement: 'Kíp trực cấp cứu 24/24 tại Trụ sở chính & các điểm trạm theo lịch trực công khai.',
  },
  {
    label: '30/04 - 01/05',
    name: 'Nghỉ Lễ Giải phóng miền Nam & Quốc tế Lao động (30/4 - 1/5)',
    mmddStart: '04-30',
    mmddEnd: '05-01',
    isAnnual: true,
    noticeTitle: 'Thông báo nghỉ Lễ 30/4 - 01/5',
    noticeMessage:
      'Trạm Y tế nghỉ làm việc hành chính dịp Lễ 30/4 và 01/5. Trong thời gian nghỉ lễ, đội ngũ y bác sĩ trực 24/7 vẫn túc trực tiếp nhận sơ cấp cứu và xử trí y tế khẩn cấp.',
    dutyArrangement: 'Bố trí kíp trực cấp cứu 24/24 liên tục trong suốt kỳ nghỉ lễ.',
  },
  {
    label: 'Quốc khánh (02/09)',
    name: 'Nghỉ Lễ Quốc khánh nước CHXHCN Việt Nam (02/09)',
    mmddStart: '09-02',
    mmddEnd: '09-02',
    isAnnual: true,
    noticeTitle: 'Thông báo nghỉ Lễ Quốc khánh 02/09',
    noticeMessage:
      'Trạm Y tế tạm nghỉ làm việc hành chính dịp Lễ Quốc khánh 02/09. Hệ thống trực cấp cứu y tế 24/7 luôn sẵn sàng phục vụ người dân khi có tình huống khẩn cấp.',
    dutyArrangement: 'Thường trực cấp cứu 24/24, đảm bảo cơ số thuốc và vật tư y tế thiết yếu.',
  },
  {
    label: 'Giỗ Tổ Hùng Vương',
    name: 'Nghỉ Lễ Giỗ Tổ Hùng Vương (10/3 Âm lịch)',
    mmddStart: '04-18',
    mmddEnd: '04-18',
    isAnnual: false,
    noticeTitle: 'Thông báo nghỉ Lễ Giỗ Tổ Hùng Vương',
    noticeMessage:
      'Trạm Y tế nghỉ làm việc hành chính nhân ngày Giỗ Tổ Hùng Vương. Kíp trực cấp cứu 24/7 vẫn làm việc bình thường.',
    dutyArrangement: 'Kíp trực cấp cứu 24/24 tại Trụ sở chính.',
  },
  {
    label: 'Tết Nguyên Đán',
    name: 'Nghỉ Lễ Tết Nguyên Đán cổ truyền',
    mmddStart: '01-28',
    mmddEnd: '02-02',
    isAnnual: false,
    noticeTitle: 'Thông báo lịch nghỉ Tết Nguyên Đán & Trực cấp cứu 24/7',
    noticeMessage:
      'Trạm Y tế tạm nghỉ làm việc hành chính trong dịp Tết Nguyên Đán. Bộ phận thường trực cấp cứu, phòng chống dịch và an toàn thực phẩm trực 24/24 xuyên Tết.',
    dutyArrangement: 'Trực cấp cứu 24/24 xuyên Tết tại Trụ sở chính và các điểm trạm.',
  },
];

export interface VietnamNowInfo {
  dateKey: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  minutesOfDay: number;
  timeLabel: string;
  weekdayLabel: string;
}

const WEEKDAY_VN_LABELS: Record<number, string> = {
  0: 'Chủ Nhật',
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
};

export function getVietnamNowInfo(nowDate = new Date()): VietnamNowInfo {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(nowDate);

    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hourRaw = Number(getPart('hour'));
    const hour = hourRaw === 24 ? 0 : hourRaw;
    const minute = Number(getPart('minute'));
    const weekdayShort = getPart('weekday').toLowerCase();

    let dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1;
    if (weekdayShort.startsWith('sun')) dayOfWeek = 0;
    else if (weekdayShort.startsWith('mon')) dayOfWeek = 1;
    else if (weekdayShort.startsWith('tue')) dayOfWeek = 2;
    else if (weekdayShort.startsWith('wed')) dayOfWeek = 3;
    else if (weekdayShort.startsWith('thu')) dayOfWeek = 4;
    else if (weekdayShort.startsWith('fri')) dayOfWeek = 5;
    else if (weekdayShort.startsWith('sat')) dayOfWeek = 6;

    return {
      dateKey: `${year}-${month}-${day}`,
      dayOfWeek,
      minutesOfDay: hour * 60 + minute,
      timeLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      weekdayLabel: WEEKDAY_VN_LABELS[dayOfWeek] || 'Hôm nay',
    };
  } catch {
    const dayOfWeek = nowDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const h = nowDate.getHours();
    const m = nowDate.getMinutes();
    return {
      dateKey: nowDate.toISOString().split('T')[0],
      dayOfWeek,
      minutesOfDay: h * 60 + m,
      timeLabel: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      weekdayLabel: WEEKDAY_VN_LABELS[dayOfWeek] || 'Hôm nay',
    };
  }
}

export function isHolidayHappeningOnDate(
  holiday: Pick<HolidayScheduleItem, 'startDate' | 'endDate' | 'isAnnual' | 'isActive'>,
  dateKey = getVietnamTodayKey()
): boolean {
  if (holiday.isActive === false || !holiday.startDate) return false;
  const end = holiday.endDate && holiday.endDate >= holiday.startDate ? holiday.endDate : holiday.startDate;

  if (holiday.isAnnual) {
    const startMd = holiday.startDate.slice(5, 10);
    const endMd = end.slice(5, 10);
    const targetMd = dateKey.slice(5, 10);
    if (endMd >= startMd) {
      return targetMd >= startMd && targetMd <= endMd;
    }
    return targetMd >= startMd || targetMd <= endMd;
  }

  return dateKey >= holiday.startDate && dateKey <= end;
}

export function getActiveHolidaysToday(
  settings?: Partial<SystemSettings>,
  todayKey = getVietnamTodayKey()
): HolidayScheduleItem[] {
  const list = settings?.holidaySchedules || [];
  return list.filter(h => isHolidayHappeningOnDate(h, todayKey));
}

export function resolveHolidayStatus(
  holiday: Pick<HolidayScheduleItem, 'startDate' | 'endDate' | 'isAnnual' | 'isActive'>,
  todayKey = getVietnamTodayKey()
): { status: 'today' | 'upcoming' | 'past'; daysUntil: number; effectiveStart: string; effectiveEnd: string } {
  const start = holiday.startDate || todayKey;
  const end = holiday.endDate && holiday.endDate >= start ? holiday.endDate : start;

  if (isHolidayHappeningOnDate(holiday, todayKey)) {
    return { status: 'today', daysUntil: 0, effectiveStart: start, effectiveEnd: end };
  }

  if (holiday.isAnnual && start.length >= 10) {
    const todayYear = Number(todayKey.slice(0, 4));
    const startMd = start.slice(5, 10);
    const endMd = end.slice(5, 10);
    let candidateStart = `${todayYear}-${startMd}`;
    let candidateEnd = `${todayYear}-${endMd}`;
    if (endMd < startMd) {
      candidateEnd = `${todayYear + 1}-${endMd}`;
    }
    if (candidateEnd < todayKey) {
      candidateStart = `${todayYear + 1}-${startMd}`;
      candidateEnd = `${endMd < startMd ? todayYear + 2 : todayYear + 1}-${endMd}`;
    }
    return {
      status: 'upcoming',
      daysUntil: Math.max(1, diffIsoDays(todayKey, candidateStart)),
      effectiveStart: candidateStart,
      effectiveEnd: candidateEnd,
    };
  }

  if (end < todayKey) {
    return {
      status: 'past',
      daysUntil: diffIsoDays(todayKey, start),
      effectiveStart: start,
      effectiveEnd: end,
    };
  }

  return {
    status: 'upcoming',
    daysUntil: Math.max(1, diffIsoDays(todayKey, start)),
    effectiveStart: start,
    effectiveEnd: end,
  };
}

export function sortHolidaySchedules(
  holidays: HolidayScheduleItem[],
  todayKey = getVietnamTodayKey()
): HolidayScheduleItem[] {
  const rankMap = { today: 0, upcoming: 1, past: 2 };
  return [...holidays].sort((a, b) => {
    const ra = resolveHolidayStatus(a, todayKey);
    const rb = resolveHolidayStatus(b, todayKey);
    if (rankMap[ra.status] !== rankMap[rb.status]) {
      return rankMap[ra.status] - rankMap[rb.status];
    }
    if (ra.status === 'upcoming') {
      return ra.daysUntil - rb.daysUntil;
    }
    if (ra.status === 'past') {
      return (b.startDate || '').localeCompare(a.startDate || '');
    }
    return (a.startDate || '').localeCompare(b.startDate || '');
  });
}

export function formatHolidayDateRange(
  holiday: Pick<HolidayScheduleItem, 'startDate' | 'endDate'>
): string {
  const start = formatIsoDateVN(holiday.startDate);
  if (holiday.endDate && holiday.endDate > holiday.startDate) {
    return `${start} – ${formatIsoDateVN(holiday.endDate)}`;
  }
  return start;
}

function parseRangeMinutes(rangeStr?: string): [number, number] | null {
  if (!rangeStr) return null;
  const matches = rangeStr.match(/\b(\d{1,2}):(\d{2})\b/g);
  if (!matches || matches.length < 2) return null;
  const [sh, sm] = matches[0].split(':').map(Number);
  const [eh, em] = matches[matches.length - 1].split(':').map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
  return [sh * 60 + sm, eh * 60 + em];
}

export interface StationOperationalStatus {
  mode: 'holiday' | 'working_open' | 'working_break' | 'weekend_off';
  label: string;
  detail: string;
  activeHolidays: HolidayScheduleItem[];
  todayWorkConfig?: WeeklyWorkDayConfig;
  nowInfo: VietnamNowInfo;
}

export function getStationOperationalStatus(
  settings?: Partial<SystemSettings>,
  nowInfo = getVietnamNowInfo()
): StationOperationalStatus {
  const activeHolidays = getActiveHolidaysToday(settings, nowInfo.dateKey);
  const weekly = getResolvedWeeklyWorkSchedule(settings);
  const todayWorkConfig = weekly.weeklyDays.find(d => d.dayOfWeek === nowInfo.dayOfWeek);

  if (activeHolidays.length > 0) {
    const primary = activeHolidays[0];
    return {
      mode: 'holiday',
      label: `Nghỉ lễ · ${primary.name}`,
      detail: primary.resumeDate
        ? `Nghỉ hành chính (${formatHolidayDateRange(primary)}). Làm việc lại từ ${formatIsoDateVN(primary.resumeDate)}. Trực cấp cứu 24/7 vẫn hoạt động.`
        : `Nghỉ hành chính (${formatHolidayDateRange(primary)}). Bộ phận trực cấp cứu 24/7 vẫn túc trực bình thường.`,
      activeHolidays,
      todayWorkConfig,
      nowInfo,
    };
  }

  if (!todayWorkConfig || !todayWorkConfig.isWorking) {
    return {
      mode: 'weekend_off',
      label: `${nowInfo.weekdayLabel} · Nghỉ hành chính`,
      detail: 'Hôm nay nghỉ làm việc hành chính. Kíp trực cấp cứu 24/7 vẫn trực tiếp nhận khẩn cấp.',
      activeHolidays: [],
      todayWorkConfig,
      nowInfo,
    };
  }

  const morningRange = parseRangeMinutes(todayWorkConfig.morningHours);
  const afternoonRange = parseRangeMinutes(todayWorkConfig.afternoonHours);
  const mins = nowInfo.minutesOfDay;
  const inMorning = morningRange ? mins >= morningRange[0] && mins <= morningRange[1] : false;
  const inAfternoon = afternoonRange ? mins >= afternoonRange[0] && mins <= afternoonRange[1] : false;

  if (inMorning || inAfternoon) {
    return {
      mode: 'working_open',
      label: `${nowInfo.weekdayLabel} · Đang làm việc`,
      detail: `Đang trong giờ hành chính (${inMorning ? todayWorkConfig.morningHours : todayWorkConfig.afternoonHours}) và duy trì trực cấp cứu 24/7.`,
      activeHolidays: [],
      todayWorkConfig,
      nowInfo,
    };
  }

  const hoursCombined = [todayWorkConfig.morningHours, todayWorkConfig.afternoonHours]
    .filter(Boolean)
    .join(' · ');

  return {
    mode: 'working_break',
    label: `${nowInfo.weekdayLabel} · Ngoài giờ hành chính`,
    detail: `Giờ làm việc hôm nay: ${hoursCombined || '07:30 - 11:30 · 13:30 - 17:00'}. Hiện tại đang trực cấp cứu 24/7.`,
    activeHolidays: [],
    todayWorkConfig,
    nowInfo,
  };
}

export interface StationPointLeader {
  id: string;
  pointName: string;
  address?: string;
  headName?: string;
  phone?: string;
  isPrimary: boolean;
}

function isPlaceholderValue(val?: string): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  return trimmed.toLowerCase().includes('chưa cập nhật');
}

export function getStationPointLeaders(
  settings?: Partial<SystemSettings>
): StationPointLeader[] {
  if (!settings) return [];

  const sortedMap = sortLocationsPrimaryFirst(settings.mapLocations || []);
  const primaryMapLoc = sortedMap.find(loc => loc.isPrimary) || null;

  const mainStationName = !isPlaceholderValue(settings.stationName)
    ? settings.stationName!.trim()
    : 'Trụ sở chính Trạm Y tế';
  const mainLeader = !isPlaceholderValue(settings.leaderName)
    ? settings.leaderName!.trim()
    : settings.orgChart?.director?.fullName?.trim() || '';
  const mainPhone = !isPlaceholderValue(settings.hotline)
    ? settings.hotline!.trim()
    : settings.orgChart?.director?.phone?.trim() ||
      (!isPlaceholderValue(settings.emergencyPhone) ? settings.emergencyPhone!.trim() : '');

  const leaders: StationPointLeader[] = [];

  if (primaryMapLoc) {
    const headName = primaryMapLoc.headName?.trim() || mainLeader || undefined;
    const phone = primaryMapLoc.phone?.trim() || mainPhone || undefined;
    if (headName || phone) {
      leaders.push({
        id: primaryMapLoc.id || 'primary_station',
        pointName: primaryMapLoc.name || mainStationName,
        address: primaryMapLoc.address || (!isPlaceholderValue(settings.address) ? settings.address?.trim() : undefined),
        headName,
        phone,
        isPrimary: true,
      });
    }
  } else if (mainLeader || mainPhone) {
    leaders.push({
      id: 'primary_station',
      pointName: mainStationName,
      address: !isPlaceholderValue(settings.address) ? settings.address?.trim() : undefined,
      headName: mainLeader || undefined,
      phone: mainPhone || undefined,
      isPrimary: true,
    });
  }

  sortedMap.forEach((loc, idx) => {
    if (primaryMapLoc && loc.id === primaryMapLoc.id) return;
    if (!primaryMapLoc && loc.isPrimary) return;
    const headName = loc.headName?.trim() || undefined;
    const phone = loc.phone?.trim() || mainPhone || undefined;
    if (headName || phone) {
      leaders.push({
        id: loc.id || `point_${idx + 1}`,
        pointName: loc.name,
        address: loc.address,
        headName,
        phone,
        isPrimary: false,
      });
    }
  });

  return leaders;
}

export function getDutySchedulesForHoliday(
  schedules: WorkSchedule[],
  holiday: Pick<HolidayScheduleItem, 'startDate' | 'endDate' | 'isAnnual' | 'isActive'>,
  referenceDateKey = getVietnamTodayKey()
): WorkSchedule[] {
  if (!Array.isArray(schedules) || schedules.length === 0) return [];

  const isToday = isHolidayHappeningOnDate(holiday, referenceDateKey);
  const resolved = resolveHolidayStatus(holiday, referenceDateKey);
  const rangeStart = resolved.effectiveStart;
  const rangeEnd = resolved.effectiveEnd;

  const sortPriority = (list: WorkSchedule[]): WorkSchedule[] => {
    const shiftOrder: Record<WorkSchedule['shift'], number> = {
      full_day: 0,
      night: 1,
      morning: 2,
      afternoon: 3,
    };
    return [...list].sort((a, b) => {
      if (a.date !== b.date) {
        if (a.date === referenceDateKey) return -1;
        if (b.date === referenceDateKey) return 1;
        return (a.date || '').localeCompare(b.date || '');
      }
      const aDuty = a.type === 'duty' ? 0 : 1;
      const bDuty = b.type === 'duty' ? 0 : 1;
      if (aDuty !== bDuty) return aDuty - bDuty;
      return (shiftOrder[a.shift] ?? 9) - (shiftOrder[b.shift] ?? 9);
    });
  };

  if (isToday) {
    const exactToday = schedules.filter(sch => sch.date === referenceDateKey);
    if (exactToday.length > 0) {
      return sortPriority(exactToday);
    }
  }

  const inRange = schedules.filter(
    sch => Boolean(sch.date) && sch.date >= rangeStart && sch.date <= rangeEnd
  );
  return sortPriority(inRange);
}

// ============================================================
// REFERRAL CODES (Cán bộ Y tế Registration & Invite Links)
// ============================================================

export function normalizeReferralCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);
}

export function generateRandomReferralCode(prefix = 'TYT'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${suffix}`;
}

export async function getReferralCode(rawCode: string): Promise<ReferralCodeItem | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code || code.length < 4) return null;
  const path = `referralCodes/${code}`;
  try {
    const snap = await getDoc(doc(db, 'referralCodes', code));
    if (!snap.exists()) return null;
    return snap.data() as ReferralCodeItem;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

export async function validateReferralCode(
  rawCode: string
): Promise<{ valid: boolean; item?: ReferralCodeItem; error?: string }> {
  const code = normalizeReferralCode(rawCode);
  if (!code || code.length < 4) {
    return { valid: false, error: 'Mã giới thiệu phải có ít nhất 4 ký tự hợp lệ.' };
  }
  try {
    const item = await getReferralCode(code);
    if (!item) {
      return { valid: false, error: 'Mã giới thiệu không tồn tại hoặc đã bị thu hồi.' };
    }
    if (!item.active) {
      return { valid: false, error: 'Mã giới thiệu này hiện đang tạm khóa.' };
    }
    return { valid: true, item };
  } catch {
    return { valid: false, error: 'Không thể kiểm tra mã giới thiệu lúc này.' };
  }
}

export async function consumeReferralCodeUsage(rawCode: string, uid: string): Promise<void> {
  const code = normalizeReferralCode(rawCode);
  if (!code || !uid) return;
  try {
    await updateDoc(doc(db, 'referralCodes', code), {
      usedCount: increment(1),
      lastUsedAt: new Date().toISOString(),
      lastUsedByUid: uid,
    });
  } catch (err) {
    console.warn('consumeReferralCodeUsage warning:', err);
  }
}

export async function listReferralCodes(): Promise<ReferralCodeItem[]> {
  const path = 'referralCodes';
  try {
    const snap = await getDocs(query(collection(db, 'referralCodes'), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => d.data() as ReferralCodeItem);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

export async function createReferralCode(params: {
  code?: string;
  label?: string;
  targetRole?: Exclude<RoleType, 'citizen' | 'admin' | 'super_admin'>;
  createdByUid: string;
  createdByEmail?: string;
}): Promise<ReferralCodeItem> {
  const code = normalizeReferralCode(params.code || generateRandomReferralCode('CBYT'));
  if (code.length < 4) {
    throw new Error('Mã giới thiệu phải có ít nhất 4 ký tự chữ/số (A-Z, 0-9, -, _).');
  }
  const existing = await getDoc(doc(db, 'referralCodes', code));
  if (existing.exists()) {
    throw new Error(`Mã giới thiệu "${code}" đã tồn tại. Vui lòng chọn mã khác.`);
  }
  const now = new Date().toISOString();
  const payload: ReferralCodeItem = cleanDataForFirestore({
    code,
    ...(params.label?.trim() ? { label: params.label.trim().slice(0, 128) } : {}),
    active: true,
    targetAccountType: 'employee',
    targetRole: params.targetRole || 'staff',
    createdByUid: params.createdByUid,
    ...(params.createdByEmail?.trim() ? { createdByEmail: params.createdByEmail.trim().slice(0, 256) } : {}),
    createdAt: now,
    usedCount: 0,
  });
  const path = `referralCodes/${code}`;
  try {
    await setDoc(doc(db, 'referralCodes', code), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
    throw err;
  }
}

export async function toggleReferralCodeStatus(code: string, active: boolean): Promise<void> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return;
  const path = `referralCodes/${normalized}`;
  try {
    await updateDoc(doc(db, 'referralCodes', normalized), { active });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
    throw err;
  }
}

export async function deleteReferralCode(code: string): Promise<void> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return;
  const path = `referralCodes/${normalized}`;
  try {
    await deleteDoc(doc(db, 'referralCodes', normalized));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    throw err;
  }
}





