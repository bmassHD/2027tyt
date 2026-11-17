import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Calendar,
  CalendarOff,
  CalendarCheck,
  Clock,
  Phone,
  User,
  Download,
  Upload,
  Search,
  CheckCircle2,
  Building2,
  PhoneCall,
  Plus,
  Edit3,
  Trash2,
  X,
  FileSpreadsheet,
  Repeat,
  ShieldAlert,
  Play,
  Settings2,
  UserCheck,
  CalendarClock,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';
import { WorkSchedule, SystemSettings, HolidayScheduleItem } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createWorkSchedule,
  updateWorkSchedule,
  deleteWorkSchedule,
  logAuditEvent,
  getConfiguredEmergencyContacts,
  getStationPointLeaders,
  getDutySchedulesForHoliday,
  sortLocationsPrimaryFirst,
  formatIsoDateVN,
  getVietnamNowInfo,
  getStationOperationalStatus,
  getResolvedWeeklyWorkSchedule,
  sortHolidaySchedules,
  resolveHolidayStatus,
  formatHolidayDateRange,
  isHolidayHappeningOnDate,
  emptySystemSettings,
} from '../../services/firebaseService';
import { CardSkeleton } from '../common/SkeletonLoader';
import { RevealOnScroll } from '../common/RevealOnScroll';
import { WorkAndHolidaySetupManager } from '../admin/WorkAndHolidaySetupManager';

interface PublicDutyScheduleViewProps {
  settings?: SystemSettings;
  onPreviewHoliday?: (holiday: HolidayScheduleItem) => void;
}

type DutyViewTab = 'daily' | 'weekly' | 'monthly' | 'holidays' | 'setup';
type ScheduleCategoryFilter = 'all' | 'duty' | 'work';

const SCHEDULE_TYPE_META: Record<
  WorkSchedule['type'],
  { label: string; shortLabel: string; accentClass: string }
> = {
  duty: {
    label: 'Trực cấp cứu 24/7',
    shortLabel: 'Trực 24/7',
    accentClass: 'text-rose-700 dark:text-rose-400',
  },
  clinic: {
    label: 'Khám bệnh & BHYT',
    shortLabel: 'Khám bệnh',
    accentClass: 'text-emerald-700 dark:text-emerald-400',
  },
  vaccine: {
    label: 'Tiêm chủng & Dự phòng',
    shortLabel: 'Tiêm chủng',
    accentClass: 'text-teal-700 dark:text-teal-400',
  },
  community: {
    label: 'Y tế cộng đồng',
    shortLabel: 'Cộng đồng',
    accentClass: 'text-amber-700 dark:text-amber-400',
  },
  meeting: {
    label: 'Họp & Giao ban',
    shortLabel: 'Giao ban',
    accentClass: 'text-indigo-700 dark:text-indigo-400',
  },
};

const HOLIDAY_SHIFT_LABELS: Record<WorkSchedule['shift'], string> = {
  full_day: 'Ca 24/24h',
  night: 'Ca đêm',
  morning: 'Ca sáng',
  afternoon: 'Ca chiều',
};

// Calculate medical 24h duty date: 7:00 AM today to 7:00 AM tomorrow
// Between 0:00 and 6:59 AM, duty shift belongs to the previous day!
export function getMedicalActiveDutyDate(): string {
  const now = new Date();
  const currentHour = now.getHours();
  const dateObj = new Date(now);
  if (currentHour < 7) {
    dateObj.setDate(dateObj.getDate() - 1);
  }
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeExcelDate(rawVal: unknown, fallbackDate: string): string {
  if (rawVal instanceof Date && !Number.isNaN(rawVal.getTime())) {
    const yyyy = rawVal.getFullYear();
    const mm = String(rawVal.getMonth() + 1).padStart(2, '0');
    const dd = String(rawVal.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
    const parsed = XLSX.SSF?.parse_date_code?.(rawVal);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const str = String(rawVal || '').trim();
  if (!str) return fallbackDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
  }
  return fallbackDate;
}

function normalizeShift(rawShift: unknown): WorkSchedule['shift'] {
  const s = String(rawShift || '').trim().toLowerCase();
  if (s === 'morning' || s.includes('sáng') || s === 'sang') return 'morning';
  if (s === 'afternoon' || s.includes('chiều') || s === 'chieu') return 'afternoon';
  if (s === 'night' || s.includes('đêm') || s === 'dem') return 'night';
  return 'full_day';
}

function normalizeScheduleType(rawType: unknown): WorkSchedule['type'] {
  const s = String(rawType || '').trim().toLowerCase();
  if (!s) return 'duty';
  if (s === 'clinic' || s.includes('khám') || s.includes('kham') || s.includes('bhyt')) {
    return 'clinic';
  }
  if (s === 'vaccine' || s.includes('tiêm') || s.includes('tiem')) return 'vaccine';
  if (s === 'community' || s.includes('cộng đồng') || s.includes('cong dong')) {
    return 'community';
  }
  if (s === 'meeting' || s.includes('họp') || s.includes('hop') || s.includes('giao ban')) {
    return 'meeting';
  }
  return 'duty';
}

function getColumnValue(row: Record<string, unknown>, keys: string[]): string {
  const entries = Object.entries(row);
  for (const targetKey of keys) {
    const matched = entries.find(([k]) => k.trim().toLowerCase() === targetKey.toLowerCase());
    if (matched && matched[1] !== undefined && matched[1] !== null && String(matched[1]).trim() !== '') {
      return String(matched[1]).trim();
    }
  }
  return '';
}

function getRawColumnValue(row: Record<string, unknown>, keys: string[]): unknown {
  const entries = Object.entries(row);
  for (const targetKey of keys) {
    const matched = entries.find(([k]) => k.trim().toLowerCase() === targetKey.toLowerCase());
    if (matched && matched[1] !== undefined && matched[1] !== null && matched[1] !== '') {
      return matched[1];
    }
  }
  return undefined;
}

export const PublicDutyScheduleView: React.FC<PublicDutyScheduleViewProps> = ({
  settings,
  onPreviewHoliday,
}) => {
  const { isStaff, isAdmin, currentUser, userProfile } = useAuth();
  const { showToast, showConfirm } = useToast();

  const activeDutyDateStr = getMedicalActiveDutyDate();
  const canEditSchedule = isStaff || isAdmin;

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const nowInfo = useMemo(() => getVietnamNowInfo(new Date(nowTick)), [nowTick]);
  const operationalStatus = useMemo(
    () => getStationOperationalStatus(settings, nowInfo),
    [settings, nowInfo]
  );
  const weeklyWorkConfig = useMemo(
    () => getResolvedWeeklyWorkSchedule(settings),
    [settings]
  );
  const sortedHolidays = useMemo(() => {
    const all = sortHolidaySchedules(settings?.holidaySchedules || [], nowInfo.dateKey);
    return isAdmin ? all : all.filter(h => h.isActive !== false);
  }, [settings?.holidaySchedules, nowInfo.dateKey, isAdmin]);
  const pointLeaders = useMemo(() => getStationPointLeaders(settings), [settings]);

  const [activeTab, setActiveTab] = useState<DutyViewTab>('monthly');
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<ScheduleCategoryFilter>('all');
  const [filterShift, setFilterShift] = useState<string>('all');
  const [filterLocation, setFilterLocation] = useState<string>('all');
  // Default to today's medical active duty date
  const [filterDate, setFilterDate] = useState<string>(() => getMedicalActiveDutyDate());

  const [monthlyYear, setMonthlyYear] = useState<number>(() => new Date().getFullYear());
  const [monthlyMonth, setMonthlyMonth] = useState<number>(() => new Date().getMonth());

  const monthlyCalendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(monthlyYear, monthlyMonth, 1);
    const lastDayOfMonth = new Date(monthlyYear, monthlyMonth + 1, 0);
    let startDayOfWeek = firstDayOfMonth.getDay();
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

    const days: { dateKey: string; dayNum: number; isCurrentMonth: boolean; isWeekend: boolean; isHoliday: boolean; isDayOff: boolean; daySchedules: WorkSchedule[] }[] = [];

    const prevMonthLastDay = new Date(monthlyYear, monthlyMonth, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const m = monthlyMonth === 0 ? 11 : monthlyMonth - 1;
      const y = monthlyMonth === 0 ? monthlyYear - 1 : monthlyYear;
      const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(y, m, d).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = (settings?.holidaySchedules || []).some(h => h.isActive !== false && isHolidayHappeningOnDate(h, dateKey));
      const daySchedules = schedules.filter(s => s.date === dateKey);
      days.push({ dateKey, dayNum: d, isCurrentMonth: false, isWeekend, isHoliday, isDayOff: isWeekend || isHoliday, daySchedules });
    }

    const totalDays = lastDayOfMonth.getDate();
    for (let d = 1; d <= totalDays; d++) {
      const dateKey = `${monthlyYear}-${String(monthlyMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(monthlyYear, monthlyMonth, d).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = (settings?.holidaySchedules || []).some(h => h.isActive !== false && isHolidayHappeningOnDate(h, dateKey));
      const dayConfig = (weeklyWorkConfig.weeklyDays || []).find(w => w.dayOfWeek === dayOfWeek);
      const isConfiguredDayOff = dayConfig ? dayConfig.isWorking === false : isWeekend;
      const isDayOff = isWeekend || isHoliday || isConfiguredDayOff;
      const daySchedules = schedules.filter(s => s.date === dateKey);
      days.push({ dateKey, dayNum: d, isCurrentMonth: true, isWeekend, isHoliday, isDayOff, daySchedules });
    }

    const totalCells = Math.ceil(days.length / 7) * 7;
    const remaining = totalCells - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = monthlyMonth === 11 ? 0 : monthlyMonth + 1;
      const y = monthlyMonth === 11 ? monthlyYear + 1 : monthlyYear;
      const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(y, m, d).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = (settings?.holidaySchedules || []).some(h => h.isActive !== false && isHolidayHappeningOnDate(h, dateKey));
      const daySchedules = schedules.filter(s => s.date === dateKey);
      days.push({ dateKey, dayNum: d, isCurrentMonth: false, isWeekend, isHoliday, isDayOff: isWeekend || isHoliday, daySchedules });
    }

    return days;
  }, [monthlyYear, monthlyMonth, settings?.holidaySchedules, schedules, weeklyWorkConfig]);

  // Excel Import State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importingData, setImportingData] = useState<Omit<WorkSchedule, 'id'>[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [isSavingImport, setIsSavingImport] = useState(false);

  // Add / Edit Duty Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<WorkSchedule | null>(null);
  const [savingForm, setSavingForm] = useState(false);

  const stationLocations: { id: string; name: string; phone?: string; headName?: string }[] = [
    {
      id: 'primary',
      name: settings?.stationName || 'Trụ sở chính Trạm Y tế',
      phone: settings?.hotline || '',
      headName: settings?.leaderName || '',
    },
    ...sortLocationsPrimaryFirst(settings?.mapLocations || []).map(loc => ({
      id: loc.id,
      name: loc.name,
      phone: loc.phone || settings?.hotline || '',
      headName: loc.headName || '',
    })),
  ];

  const [formType, setFormType] = useState<WorkSchedule['type']>('duty');
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(activeDutyDateStr);
  const [formShift, setFormShift] = useState<WorkSchedule['shift']>('full_day');
  const [formLocation, setFormLocation] = useState(stationLocations[0]?.name || '');
  const [formDoctor, setFormDoctor] = useState('');
  const [formNurse, setFormNurse] = useState('');
  const [formStaff, setFormStaff] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const emergencyContacts = getConfiguredEmergencyContacts(settings);

  // Parse deep link query param from hash URL (if provided)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('?')) {
      const queryStr = hash.split('?')[1];
      const params = new URLSearchParams(queryStr);
      const ngayParam = params.get('ngay');
      const tabParam = params.get('tab');
      if (tabParam === 'weekly' || tabParam === 'holidays' || tabParam === 'daily') {
        setActiveTab(tabParam);
      } else if (tabParam === 'setup' && isAdmin) {
        setActiveTab('setup');
      }
      if (ngayParam) {
        if (ngayParam.length === 8 && !ngayParam.includes('-')) {
          const dd = ngayParam.slice(0, 2);
          const mm = ngayParam.slice(2, 4);
          const yyyy = ngayParam.slice(4, 8);
          setFilterDate(`${yyyy}-${mm}-${dd}`);
        } else {
          setFilterDate(ngayParam);
        }
      }
    }
  }, [isAdmin]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'workSchedules'),
      snap => {
        setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkSchedule)));
        setLoading(false);
      },
      err => {
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'workSchedules');
        } catch {
          // Non-fatal fallback if permission is temporarily unavailable
        }
      }
    );
    return () => unsub();
  }, []);

  const holidaysOnSelectedDate = useMemo(() => {
    if (!filterDate) return [];
    return (settings?.holidaySchedules || []).filter(
      h => h.isActive !== false && isHolidayHappeningOnDate(h, filterDate)
    );
  }, [settings?.holidaySchedules, filterDate]);

  const openCreateModal = () => {
    setEditingSchedule(null);
    setFormType('duty');
    setFormTitle(`Ca trực 24/7 - ${stationLocations[0]?.name || 'Trạm Y tế'}`);
    setFormDate(filterDate || activeDutyDateStr);
    setFormShift('full_day');
    setFormLocation(stationLocations[0]?.name || '');
    setFormDoctor('');
    setFormNurse('');
    setFormStaff('');
    setFormPhone(stationLocations[0]?.phone || settings?.hotline || '');
    setFormNotes('');
    setIsEditModalOpen(true);
  };

  const openEditModal = (item: WorkSchedule) => {
    setEditingSchedule(item);
    setFormType(item.type || 'duty');
    setFormTitle(item.title || '');
    setFormDate(item.date || activeDutyDateStr);
    setFormShift(item.shift || 'full_day');
    setFormLocation(item.location || stationLocations[0]?.name || '');
    setFormDoctor(item.doctorName || '');
    setFormNurse(item.nurseName || '');
    setFormStaff(item.staffNames || '');
    setFormPhone(item.phone || '');
    setFormNotes(item.notes || '');
    setIsEditModalOpen(true);
  };

  const handleSaveScheduleForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditSchedule) return;

    if (!formDate || !formTitle.trim()) {
      showToast('warning', 'Thiếu thông tin', 'Vui lòng nhập ngày và tên ca / lịch công tác.');
      return;
    }

    setSavingForm(true);
    try {
      const payload: Omit<WorkSchedule, 'id'> = {
        title: formTitle.trim(),
        type: formType,
        date: formDate,
        shift: formShift,
        location: formLocation.trim() || stationLocations[0]?.name || 'Trạm Y tế',
        doctorName: formDoctor.trim(),
        nurseName: formNurse.trim(),
        staffNames: formStaff.trim() || formDoctor.trim() || 'Kíp trực y tế',
        phone: formPhone.trim(),
        department: 'Trạm Y tế',
        notes: formNotes.trim(),
        isPublic: true,
      };

      if (editingSchedule) {
        await updateWorkSchedule(editingSchedule.id, payload);
        await logAuditEvent('Cập nhật lịch trực / làm việc', 'Lịch trực', `${payload.date} · ${payload.title}`, {
          uid: currentUser?.uid || 'staff',
          name: userProfile?.displayName || 'Cán bộ',
        });
        showToast('success', 'Đã cập nhật lịch');
      } else {
        await createWorkSchedule(payload);
        await logAuditEvent('Thêm lịch trực / làm việc', 'Lịch trực', `${payload.date} · ${payload.title}`, {
          uid: currentUser?.uid || 'staff',
          name: userProfile?.displayName || 'Cán bộ',
        });
        showToast('success', 'Đã thêm lịch mới');
      }
      setIsEditModalOpen(false);
      setEditingSchedule(null);
    } catch (err: any) {
      showToast('error', 'Không thể lưu lịch', err?.message);
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteSchedule = (item: WorkSchedule) => {
    if (!canEditSchedule) return;
    showConfirm({
      title: 'Xóa lịch này?',
      message: `Xóa "${item.title}" ngày ${formatIsoDateVN(item.date)} khỏi danh sách?`,
      confirmText: 'Xóa lịch',
      cancelText: 'Hủy',
      isDangerous: true,
      onConfirm: async () => {
        try {
          await deleteWorkSchedule(item.id);
          await logAuditEvent('Xóa lịch trực / làm việc', 'Lịch trực', `${item.date} · ${item.title}`, {
            uid: currentUser?.uid || 'staff',
            name: userProfile?.displayName || 'Cán bộ',
          });
          showToast('success', 'Đã xóa lịch');
        } catch (err: any) {
          showToast('error', 'Không thể xóa lịch', err?.message);
        }
      },
    });
  };

  const filtered = schedules.filter(sch => {
    const schType = sch.type || 'duty';
    const matchCategory =
      filterCategory === 'all' ||
      (filterCategory === 'duty' ? schType === 'duty' : schType !== 'duty');

    const matchSearch =
      !searchQuery.trim() ||
      sch.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sch.staffNames?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (sch.doctorName && sch.doctorName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (sch.nurseName && sch.nurseName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      sch.location?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchShift = filterShift === 'all' || sch.shift === filterShift;
    const matchLocation =
      filterLocation === 'all' ||
      sch.location?.toLowerCase().includes(filterLocation.toLowerCase());
    const matchDate = !filterDate || sch.date === filterDate;

    return matchCategory && matchSearch && matchShift && matchLocation && matchDate;
  });

  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Export Columnar Excel (.xlsx) - Strictly Admin only
  const handleExportExcel = () => {
    if (!isAdmin) {
      showToast('error', 'Từ chối quyền', 'Chỉ Quản trị viên trạm mới có quyền xuất Excel.');
      return;
    }

    if (schedules.length === 0) {
      showToast('warning', 'Không có dữ liệu lịch để xuất');
      return;
    }

    const rows = sorted.map(sch => ({
      Ngay_Truc: sch.date || '',
      Loai_Lich: sch.type || 'duty',
      Ca_Truc: sch.shift || 'full_day',
      Ten_Ca: sch.title || '',
      Bac_Si_Truc: sch.doctorName || '',
      Dieu_Duong: sch.nurseName || '',
      Nhan_Su_Khac: sch.staffNames || '',
      So_Dien_Thoai: sch.phone || '',
      Dia_Diem: sch.location || '',
      Ghi_Chu: sch.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 13 },
      { wch: 12 },
      { wch: 12 },
      { wch: 32 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 15 },
      { wch: 26 },
      { wch: 28 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LichTrucLamViec');
    XLSX.writeFile(wb, `lich_truc_lam_viec_${activeDutyDateStr}.xlsx`);
    showToast('success', 'Đã xuất tệp Excel (.xlsx)');
  };

  // Download formatted Columnar Excel Template (.xlsx)
  const handleDownloadTemplateExcel = () => {
    const sampleRows = [
      ...stationLocations.map((loc, idx) => ({
        Ngay_Truc: activeDutyDateStr,
        Loai_Lich: 'duty',
        Ca_Truc: 'full_day',
        Ten_Ca: `Ca trực 24/7 - ${loc.name}`,
        Bac_Si_Truc: `BS. Nguyễn Văn ${idx + 1}`,
        Dieu_Duong: `ĐD. Trần Thị ${idx + 1}`,
        Nhan_Su_Khac: `Kíp trực số ${idx + 1}`,
        So_Dien_Thoai: loc.phone || '028xxxxxxx',
        Dia_Diem: loc.name,
        Ghi_Chu: 'Thường trực cấp cứu 24/7',
      })),
      {
        Ngay_Truc: activeDutyDateStr,
        Loai_Lich: 'clinic',
        Ca_Truc: 'morning',
        Ten_Ca: 'Lịch khám BHYT & Tiếp nhận hồ sơ buổi sáng',
        Bac_Si_Truc: 'BS. Lê Minh C',
        Dieu_Duong: 'ĐD. Phạm Thị D',
        Nhan_Su_Khac: 'Tổ Khám bệnh',
        So_Dien_Thoai: stationLocations[0]?.phone || '028xxxxxxx',
        Dia_Diem: stationLocations[0]?.name || 'Trụ sở chính Trạm Y tế',
        Ghi_Chu: '07:30 - 11:30',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    ws['!cols'] = [
      { wch: 13 },
      { wch: 12 },
      { wch: 12 },
      { wch: 32 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 15 },
      { wch: 26 },
      { wch: 28 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MauLichTrucLamViec');
    XLSX.writeFile(wb, 'mau_lich_truc_va_lam_viec_tram_y_te.xlsx');
    showToast('success', 'Đã tải mẫu Excel (.xlsx)');
  };

  // Import Columnar Excel (.xlsx / .xls) or JSON backup
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    const reader = new FileReader();

    if (file.name.toLowerCase().endsWith('.json')) {
      reader.onload = evt => {
        try {
          const parsed = JSON.parse(String(evt.target?.result || ''));
          if (Array.isArray(parsed) && parsed.length > 0) {
            const cleanList: Omit<WorkSchedule, 'id'>[] = parsed.map((item: any) => ({
              title: item.title || 'Ca trực cấp cứu 24/7',
              type: normalizeScheduleType(item.type),
              date: item.date || activeDutyDateStr,
              shift: normalizeShift(item.shift),
              staffNames: item.staffNames || '',
              doctorName: item.doctorName || '',
              nurseName: item.nurseName || '',
              phone: item.phone || '',
              department: item.department || 'Trạm Y tế',
              location: item.location || stationLocations[0].name,
              notes: item.notes || '',
              isPublic: true,
            }));
            setImportingData(cleanList);
            setIsImportModalOpen(true);
          } else {
            showToast('error', 'Tệp JSON không hợp lệ');
          }
        } catch (err: any) {
          showToast('error', 'Lỗi đọc tệp JSON', err?.message);
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = evt => {
        try {
          const buffer = evt.target?.result;
          const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            showToast('warning', 'Tệp Excel không có sheet dữ liệu');
            return;
          }
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

          const parsedList: Omit<WorkSchedule, 'id'>[] = rows
            .map((row): Omit<WorkSchedule, 'id'> | null => {
              const rawDate = getRawColumnValue(row, [
                'Ngay_Truc',
                'Ngày trực',
                'Ngay',
                'Ngày',
                'date',
              ]);
              const typeVal = getColumnValue(row, ['Loai_Lich', 'Loại lịch', 'Loai', 'type']);
              const shiftVal = getColumnValue(row, ['Ca_Truc', 'Ca trực', 'Ca', 'shift']);
              const title = getColumnValue(row, ['Ten_Ca', 'Tên ca', 'Tieu_De', 'Tiêu đề', 'title']);
              const doctorName = getColumnValue(row, [
                'Bac_Si_Truc',
                'Bác sĩ trực',
                'Bác sĩ',
                'doctorName',
              ]);
              const nurseName = getColumnValue(row, [
                'Dieu_Duong',
                'Điều dưỡng',
                'Y sĩ',
                'nurseName',
              ]);
              const staffNames = getColumnValue(row, [
                'Nhan_Su_Khac',
                'Nhân sự khác',
                'Nhân sự',
                'staffNames',
              ]);
              const phone = getColumnValue(row, [
                'So_Dien_Thoai',
                'Số điện thoại',
                'Hotline',
                'SĐT',
                'phone',
              ]);
              const location = getColumnValue(row, ['Dia_Diem', 'Địa điểm', 'Điểm trạm', 'location']);
              const notes = getColumnValue(row, ['Ghi_Chu', 'Ghi chú', 'notes']);

              if (!title && !doctorName && !nurseName && !staffNames && !rawDate) {
                return null;
              }

              return {
                date: normalizeExcelDate(rawDate, activeDutyDateStr),
                type: normalizeScheduleType(typeVal),
                shift: normalizeShift(shiftVal),
                title: title || `Ca trực 24/7 - ${location || stationLocations[0].name}`,
                doctorName,
                nurseName,
                staffNames: staffNames || doctorName || 'Kíp trực y tế',
                phone,
                location: location || stationLocations[0].name,
                notes,
                department: 'Trạm Y tế',
                isPublic: true,
              };
            })
            .filter((item): item is Omit<WorkSchedule, 'id'> => item !== null);

          if (parsedList.length > 0) {
            setImportingData(parsedList);
            setIsImportModalOpen(true);
          } else {
            showToast('error', 'Không tìm thấy cột dữ liệu hợp lệ trong tệp Excel');
          }
        } catch (err: any) {
          showToast('error', 'Lỗi đọc tệp Excel', err?.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (importingData.length === 0) return;

    setIsSavingImport(true);
    let count = 0;

    try {
      for (const item of importingData) {
        await createWorkSchedule(item);
        count++;
      }

      await logAuditEvent('Nhập Excel lịch trực', 'Lịch trực', `Đã nhập ${count} lịch`, {
        uid: currentUser?.uid || 'staff',
        name: userProfile?.displayName || 'Cán bộ',
      });

      showToast('success', 'Nhập lịch thành công', `Đã lưu ${count} lịch từ tệp Excel.`);
      setIsImportModalOpen(false);
      setImportingData([]);
    } catch (err: any) {
      showToast('error', 'Lỗi khi lưu lịch', err?.message);
    } finally {
      setIsSavingImport(false);
    }
  };

  const activeHolidaysCountToday = operationalStatus.activeHolidays.length;

  return (
    <div className="space-y-6">
      {/* Top Banner Header + Live Operational Status */}
      <RevealOnScroll immediate>
        <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                <span>
                  {nowInfo.weekdayLabel}, {formatIsoDateVN(nowInfo.dateKey)} · {nowInfo.timeLabel}
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span
                  className={`px-2.5 py-0.5 rounded-lg font-bold text-[11px] ${
                    operationalStatus.mode === 'holiday'
                      ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                      : operationalStatus.mode === 'working_open'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                  }`}
                >
                  {operationalStatus.label}
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Lịch Trực 24/7, Lịch Làm Việc &amp; Nghỉ Lễ
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {operationalStatus.detail}
              </p>

              {emergencyContacts.length > 0 && (
                <div className="pt-1 flex flex-wrap gap-2">
                  {emergencyContacts.map(ec => (
                    <a
                      key={ec.id}
                      href={`tel:${ec.phone}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap tabular-nums hover:underline"
                    >
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span>Cấp cứu 24/7: {ec.phone}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Concise Non-Wrapping Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              {activeTab === 'daily' && (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadTemplateExcel}
                    className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-emerald-50 hover:text-emerald-700 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    title="Tải mẫu Excel có cột chuẩn"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Mẫu Excel</span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      title="Xuất danh sách ra Excel (.xlsx)"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>Xuất Excel</span>
                    </button>
                  )}

                  {canEditSchedule && (
                    <>
                      <label className="cursor-pointer px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 text-slate-800 dark:text-slate-100 font-semibold text-xs transition inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <Upload className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Nhập Excel</span>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.json"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={openCreateModal}
                        className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>Thêm ca / lịch</span>
                      </button>
                    </>
                  )}
                </>
              )}

              {isAdmin && activeTab !== 'setup' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('setup')}
                  className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Thiết lập làm việc &amp; nghỉ lễ</span>
                </button>
              )}
            </div>
          </div>

          {/* Clear Active Holiday Alert inside Page when visiting on a holiday */}
          {operationalStatus.mode === 'holiday' && operationalStatus.activeHolidays.length > 0 && (
            <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/80 space-y-4">
              {operationalStatus.activeHolidays.map(holiday => {
                const matchedDuties = getDutySchedulesForHoliday(schedules, holiday, nowInfo.dateKey);
                const hasOverrideLeader = Boolean(holiday.headName?.trim() || holiday.headPhone?.trim());
                const targetDutyDate = matchedDuties[0]?.date || nowInfo.dateKey;

                return (
                  <div key={holiday.id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-rose-800 dark:text-rose-200 font-extrabold text-sm sm:text-base">
                        <CalendarOff className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                        <span>Hôm nay đang trong kỳ nghỉ lễ: {holiday.name}</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                        {formatHolidayDateRange(holiday)}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-rose-900 dark:text-rose-100 leading-relaxed">
                      {holiday.noticeMessage ||
                        'Trạm Y tế tạm nghỉ hoạt động khám chữa bệnh hành chính trong thời gian nghỉ lễ. Bộ phận thường trực cấp cứu 24/7 vẫn tiếp nhận và xử trí khẩn cấp bình thường.'}
                    </p>

                    {/* Head of Medical Points & Holiday Duty Roster */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {(hasOverrideLeader || pointLeaders.length > 0) && (
                        <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-800/60 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                            <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Người đứng đầu Điểm Y tế &amp; Trực lãnh đạo</span>
                          </div>

                          {hasOverrideLeader && (
                            <div className="p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="min-w-0">
                                <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 block">
                                  Lãnh đạo trực kỳ nghỉ lễ
                                </span>
                                <span className="font-extrabold text-slate-900 dark:text-white">
                                  {holiday.headName?.trim() || 'Lãnh đạo phụ trách điểm y tế'}
                                </span>
                              </div>
                              {holiday.headPhone?.trim() && (
                                <a
                                  href={`tel:${holiday.headPhone.trim()}`}
                                  className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold inline-flex items-center gap-1 tabular-nums whitespace-nowrap"
                                >
                                  <Phone className="w-3 h-3 shrink-0" />
                                  <span>{holiday.headPhone.trim()}</span>
                                </a>
                              )}
                            </div>
                          )}

                          {pointLeaders.length > 0 && (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                              {pointLeaders.map(pt => (
                                <div
                                  key={pt.id}
                                  className="py-1.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                                      {pt.pointName}
                                    </div>
                                    {pt.headName && (
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                        Người đứng đầu:{' '}
                                        <strong className="text-slate-900 dark:text-white">
                                          {pt.headName}
                                        </strong>
                                      </div>
                                    )}
                                  </div>
                                  {pt.phone && (
                                    <a
                                      href={`tel:${pt.phone}`}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-bold inline-flex items-center gap-1 hover:bg-emerald-100 tabular-nums whitespace-nowrap shrink-0"
                                    >
                                      <Phone className="w-3 h-3 shrink-0" />
                                      <span>{pt.phone}</span>
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                            <CalendarClock className="w-4 h-4 shrink-0" />
                            <span>
                              Lịch trực ngày {formatIsoDateVN(targetDutyDate)} ({matchedDuties.length} ca)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setFilterDate(targetDutyDate);
                              setActiveTab('daily');
                            }}
                            className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
                          >
                            Xem chi tiết ngày trực
                          </button>
                        </div>

                        {matchedDuties.length > 0 ? (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {matchedDuties.slice(0, 4).map(sch => (
                              <div key={sch.id} className="py-1.5 first:pt-0 last:pb-0 space-y-0.5 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                                    <span className="text-rose-700 dark:text-rose-400 shrink-0">
                                      {HOLIDAY_SHIFT_LABELS[sch.shift] || 'Ca trực'}
                                    </span>
                                    <span className="text-slate-300 dark:text-slate-700">·</span>
                                    <span className="truncate">{sch.title}</span>
                                  </div>
                                  {sch.phone && (
                                    <a
                                      href={`tel:${sch.phone}`}
                                      className="font-bold text-rose-700 dark:text-rose-300 hover:underline inline-flex items-center gap-1 tabular-nums whitespace-nowrap shrink-0"
                                    >
                                      <Phone className="w-3 h-3 shrink-0" />
                                      <span>{sch.phone}</span>
                                    </a>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span>
                                    <strong>{sch.doctorName || sch.staffNames || 'Kíp trực y tế'}</strong>
                                    {sch.nurseName ? ` · ĐD: ${sch.nurseName}` : ''}
                                  </span>
                                  {sch.location && (
                                    <span className="text-slate-500 dark:text-slate-400">
                                      · {sch.location}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {holiday.dutyArrangement ||
                              'Chưa có ca trực riêng cho ngày này; kíp trực cấp cứu 24/7 vẫn túc trực tiếp nhận theo đường dây nóng.'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700 dark:text-slate-200 tabular-nums">
                        {holiday.resumeDate && (
                          <span>
                            Làm việc lại bình thường:{' '}
                            <strong className="text-emerald-700 dark:text-emerald-400">
                              {formatIsoDateVN(holiday.resumeDate)}
                            </strong>
                          </span>
                        )}
                        {holiday.dutyArrangement && (
                          <span>
                            Trực lễ 24/7: <strong>{holiday.dutyArrangement}</strong>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {holiday.emergencyPhone && (
                          <a
                            href={`tel:${holiday.emergencyPhone}`}
                            className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap"
                          >
                            <Phone className="w-3.5 h-3.5 shrink-0" />
                            <span>Trực lễ: {holiday.emergencyPhone}</span>
                          </a>
                        )}
                        {onPreviewHoliday && (
                          <button
                            type="button"
                            onClick={() => onPreviewHoliday(holiday)}
                            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100/60 font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            <span>Xem chi tiết thông báo</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Unified Navigation Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('monthly')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 border ${
                activeTab === 'monthly'
                  ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Lịch làm việc Tháng</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('daily')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 border ${
                activeTab === 'daily'
                  ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>Lịch trực 24/7 &amp; Công tác ngày</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('weekly')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 border ${
                activeTab === 'weekly'
                  ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Lịch làm việc tuần</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('holidays')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 border ${
                activeTab === 'holidays'
                  ? activeHolidaysCountToday > 0
                    ? 'bg-rose-700 text-white border-rose-700 shadow-xs'
                    : 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                  : activeHolidaysCountToday > 0
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100/70'
                  : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <CalendarOff className="w-3.5 h-3.5 shrink-0" />
              <span>
                Lịch nghỉ lễ ({sortedHolidays.length})
                {activeHolidaysCountToday > 0 ? ' · Đang nghỉ' : ''}
              </span>
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('setup')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 border ${
                  activeTab === 'setup'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5 shrink-0" />
                <span>Thiết lập (Admin)</span>
              </button>
            )}
          </div>
        </div>
      </RevealOnScroll>

      {/* TAB 1: DAILY DUTY 24/7 & WORK ROSTER */}
      {activeTab === 'daily' && (
        <>
          {/* Station Location Contact Info Cards */}
          <RevealOnScroll title="Điểm trực trạm y tế">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {stationLocations.map(loc => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() =>
                    setFilterLocation(prev => (prev === loc.name ? 'all' : loc.name))
                  }
                  className={`p-4 rounded-2xl border transition-all cursor-pointer text-left space-y-2 ${
                    filterLocation === loc.name
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-lg bg-emerald-600 text-white shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {loc.name}
                    </h4>
                  </div>

                  <div className="space-y-1 text-slate-600 dark:text-slate-300 text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                    {loc.headName && (
                      <p className="flex items-center justify-between gap-2">
                        <span className="text-slate-400 shrink-0">Phụ trách</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {loc.headName}
                        </span>
                      </p>
                    )}
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">Trực ban</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums truncate">
                        {loc.phone || 'Chưa cập nhật'}
                      </span>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </RevealOnScroll>

          {/* Date Mode Toggle & Filters */}
          <RevealOnScroll title="Danh sách ca trực & lịch công tác">
            <div className="space-y-4">
              {holidaysOnSelectedDate.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-rose-800 dark:text-rose-200">
                  <div className="flex items-center gap-2">
                    <CalendarOff className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      Ngày <strong>{formatIsoDateVN(filterDate)}</strong> thuộc kỳ nghỉ lễ:{' '}
                      <strong>{holidaysOnSelectedDate.map(h => h.name).join(', ')}</strong> (Nghỉ hành chính, kíp trực 24/7 vẫn làm việc bình thường).
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('holidays')}
                    className="font-bold underline text-rose-700 dark:text-rose-300 whitespace-nowrap self-start sm:self-auto cursor-pointer"
                  >
                    Xem lịch nghỉ lễ
                  </button>
                </div>
              )}

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div>
                    <select
                      value={filterDate === activeDutyDateStr ? 'today' : 'all_days'}
                      onChange={e => {
                        if (e.target.value === 'today') {
                          setFilterDate(activeDutyDateStr);
                        } else {
                          setFilterDate('');
                        }
                      }}
                      className="px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="today">Hôm nay ({formatIsoDateVN(activeDutyDateStr)})</option>
                      <option value="all_days">Tất cả ngày</option>
                    </select>
                  </div>

                  <div>
                    <select
                      value={filterCategory}
                      onChange={e => setFilterCategory(e.target.value as ScheduleCategoryFilter)}
                      className="px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="all">Tất cả lịch (Trực &amp; Công tác)</option>
                      <option value="duty">Trực cấp cứu 24/7</option>
                      <option value="work">Lịch làm việc &amp; Công tác</option>
                    </select>
                  </div>
                </div>

                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                  {sorted.length} lịch {filterDate ? `· ${formatIsoDateVN(filterDate)}` : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="relative sm:col-span-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    placeholder="Tìm tên bác sĩ, điều dưỡng..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs"
                  />
                </div>

                <div>
                  <select
                    value={filterLocation}
                    onChange={e => setFilterLocation(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs font-semibold"
                  >
                    <option value="all">Tất cả điểm trạm</option>
                    {stationLocations.map(loc => (
                      <option key={loc.id} value={loc.name}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs text-slate-700 dark:text-slate-200 tabular-nums"
                  />
                </div>

                <div>
                  <select
                    value={filterShift}
                    onChange={e => setFilterShift(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs font-semibold"
                  >
                    <option value="all">Tất cả ca trực / làm việc</option>
                    <option value="full_day">Trực 24/24 / Cả ngày</option>
                    <option value="night">Ca đêm</option>
                    <option value="morning">Ca sáng</option>
                    <option value="afternoon">Ca chiều</option>
                  </select>
                </div>
              </div>

              {/* Duty Roster Cards */}
              {loading ? (
                <CardSkeleton count={3} />
              ) : sorted.length === 0 ? (
                <div className="p-10 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-500 space-y-3">
                  <Calendar className="w-9 h-9 mx-auto text-slate-300" />
                  <p>
                    {filterDate === activeDutyDateStr
                      ? `Chưa có lịch trực 24/7 hoặc công tác được cập nhật riêng cho ngày ${formatIsoDateVN(activeDutyDateStr)}. Quý dân có thể xem khung giờ chuẩn tại mục “Lịch làm việc tuần”.`
                      : 'Chưa có lịch trực hoặc lịch làm việc phù hợp bộ lọc.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    {filterDate && (
                      <button
                        type="button"
                        onClick={() => setFilterDate('')}
                        className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        Xem tất cả ngày
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveTab('weekly')}
                      className="px-4 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Xem lịch làm việc tuần
                    </button>
                    {canEditSchedule && (
                      <button
                        type="button"
                        onClick={openCreateModal}
                        className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>Thêm ca / lịch</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {sorted.map(sch => {
                    const isCurrentActiveDuty = sch.date === activeDutyDateStr;
                    const typeMeta = SCHEDULE_TYPE_META[sch.type || 'duty'] || SCHEDULE_TYPE_META.duty;

                    return (
                      <div
                        key={sch.id}
                        className={`p-5 rounded-3xl border transition flex flex-col justify-between space-y-4 ${
                          isCurrentActiveDuty
                            ? 'bg-emerald-50/40 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-700 shadow-xs'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 font-mono font-bold text-slate-700 dark:text-slate-200 tabular-nums min-w-0">
                              <span>{formatIsoDateVN(sch.date)}</span>
                              {isCurrentActiveDuty && (
                                <>
                                  <span className="text-slate-300 dark:text-slate-700">·</span>
                                  <span className="font-sans text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                    Hôm nay
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-xs whitespace-nowrap shrink-0">
                              <span className={`font-bold ${typeMeta.accentClass}`}>
                                {typeMeta.shortLabel}
                              </span>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="font-semibold text-slate-600 dark:text-slate-300">
                                {sch.shift === 'full_day'
                                  ? sch.type === 'duty'
                                    ? '24/24h'
                                    : 'Cả ngày'
                                  : sch.shift === 'night'
                                  ? 'Ca đêm'
                                  : sch.shift === 'morning'
                                  ? 'Ca sáng'
                                  : 'Ca chiều'}
                              </span>
                            </div>
                          </div>

                          <h3 className="font-bold text-base text-slate-900 dark:text-white leading-snug line-clamp-2">
                            {sch.title}
                          </h3>

                          <div className="space-y-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 min-w-0">
                              <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="truncate">
                                <strong>{sch.doctorName || sch.staffNames || 'Đang cập nhật'}</strong>
                              </span>
                            </div>

                            {sch.nurseName && (
                              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 min-w-0">
                                <User className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                                <span className="truncate">ĐD: {sch.nurseName}</span>
                              </div>
                            )}

                            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 min-w-0">
                              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{sch.location || stationLocations[0].name}</span>
                            </div>

                            {sch.phone && (
                              <a
                                href={`tel:${sch.phone}`}
                                className="flex items-center gap-2 pt-0.5 font-semibold text-rose-600 dark:text-rose-400 hover:underline tabular-nums"
                              >
                                <PhoneCall className="w-3.5 h-3.5 shrink-0" />
                                <span>{sch.phone}</span>
                              </a>
                            )}
                          </div>

                          {sch.notes && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                              {sch.notes}
                            </p>
                          )}
                        </div>

                        {canEditSchedule && (
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(sch)}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 hover:text-emerald-700 text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <Edit3 className="w-3.5 h-3.5 shrink-0" />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSchedule(sch)}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-700 dark:text-slate-200 hover:text-rose-600 text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Xóa</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </RevealOnScroll>
        </>
      )}

      {/* TAB: MONTHLY SCHEDULE VIEW */}
      {activeTab === 'monthly' && (
        <RevealOnScroll title="Lịch làm việc Tháng">
          <div className="space-y-6">
            {/* Month Controller Header */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-emerald-600" />
                  Lịch Làm Việc &amp; Trực Tháng {monthlyMonth + 1} / {monthlyYear}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1 align-middle" /> Ngày nghỉ / cuối tuần (chấm đỏ) • 
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 ml-2 mr-1 align-middle" /> Ngày lễ (chấm vàng)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (monthlyMonth === 0) {
                      setMonthlyMonth(11);
                      setMonthlyYear(y => y - 1);
                    } else {
                      setMonthlyMonth(m => m - 1);
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
                >
                  Tháng trước
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setMonthlyYear(now.getFullYear());
                    setMonthlyMonth(now.getMonth());
                  }}
                  className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition cursor-pointer"
                >
                  Tháng này
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (monthlyMonth === 11) {
                      setMonthlyMonth(0);
                      setMonthlyYear(y => y + 1);
                    } else {
                      setMonthlyMonth(m => m + 1);
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
                >
                  Tháng sau
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              {/* Day of Week Headers */}
              <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-center text-xs font-bold text-slate-600 dark:text-slate-400 py-3">
                <div>Thứ Hai</div>
                <div>Thứ Ba</div>
                <div>Thứ Tư</div>
                <div>Thứ Năm</div>
                <div>Thứ Sáu</div>
                <div className="text-slate-500">Thứ Bảy</div>
                <div className="text-rose-600">Chủ Nhật</div>
              </div>

              {/* Days Grid */}
              <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-slate-200 dark:divide-slate-800">
                {monthlyCalendarDays.map((cell, idx) => {
                  const isToday = cell.dateKey === nowInfo.dateKey;
                  const isWeekendCell = cell.isWeekend;
                  return (
                    <div
                      key={`m_cell_${idx}`}
                      onClick={() => {
                        setFilterDate(cell.dateKey);
                        setActiveTab('daily');
                      }}
                      className={`min-h-[110px] p-2.5 flex flex-col justify-between transition cursor-pointer group hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 ${
                        !cell.isCurrentMonth
                          ? 'bg-slate-50/50 dark:bg-slate-950/40 text-slate-400 dark:text-slate-600'
                          : isWeekendCell
                          ? 'bg-slate-100/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                          : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
                      } ${isToday ? 'ring-2 ring-emerald-500 inset-0 z-10 font-bold' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-extrabold ${isToday ? 'w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs' : ''}`}>
                          {cell.dayNum}
                        </span>

                        <div className="flex items-center gap-1">
                          {cell.isHoliday && (
                            <span className="w-2 h-2 rounded-full bg-amber-400 ring-2 ring-amber-200 dark:ring-amber-900" title="Ngày lễ (Chấm vàng)" />
                          )}
                          {cell.isDayOff && !cell.isHoliday && (
                            <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-rose-200 dark:ring-rose-900" title="Ngày nghỉ / cuối tuần (Chấm đỏ)" />
                          )}
                        </div>
                      </div>

                      <div className="space-y-1 mt-1 overflow-hidden">
                        {cell.daySchedules.slice(0, 2).map((sch, sIdx) => (
                          <div
                            key={`sch_cell_${sch.id || sIdx}`}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 truncate border border-emerald-200/60 dark:border-emerald-800/50"
                            title={`${sch.title} - ${sch.staffNames || ''}`}
                          >
                            {sch.title}
                          </div>
                        ))}
                        {cell.daySchedules.length > 2 && (
                          <div className="text-[10px] text-slate-400 font-medium pl-0.5">
                            +{cell.daySchedules.length - 2} ca khác
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </RevealOnScroll>
      )}

      {/* TAB 2: WEEKLY ADMINISTRATIVE & CLINIC WORK SCHEDULE */}
      {activeTab === 'weekly' && (
        <RevealOnScroll title="Lịch làm việc hành chính hằng tuần">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                  Lịch Làm Việc Hành Chính &amp; Khám Chữa Bệnh Trong Tuần
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Lịch tiếp nhận hành chính, khám BHYT và các chuyên khoa kết hợp trực cấp cứu 24/7.
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveTab('setup')}
                  className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap self-start sm:self-auto"
                >
                  <Settings2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Chỉnh sửa lịch làm việc</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs sm:text-sm border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <th className="p-3.5 whitespace-nowrap">Ngày trong tuần</th>
                    <th className="p-3.5 whitespace-nowrap">Hoạt động hành chính</th>
                    <th className="p-3.5 whitespace-nowrap">Buổi sáng</th>
                    <th className="p-3.5 whitespace-nowrap">Buổi chiều</th>
                    <th className="p-3.5">Bộ phận tiếp nhận</th>
                    <th className="p-3.5">Trực 24/7 / Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {weeklyWorkConfig.weeklyDays.map(day => {
                    const isToday = day.dayOfWeek === nowInfo.dayOfWeek;
                    const isHolidayToday = isToday && operationalStatus.mode === 'holiday';

                    return (
                      <tr
                        key={day.dayOfWeek}
                        className={
                          isHolidayToday
                            ? 'bg-rose-50/70 dark:bg-rose-950/30'
                            : isToday
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/25'
                            : 'bg-white dark:bg-slate-900'
                        }
                      >
                        <td className="p-3.5 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{day.label}</span>
                            {isToday && (
                              <span
                                className={`text-[11px] font-bold ${
                                  isHolidayToday
                                    ? 'text-rose-700 dark:text-rose-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                · {isHolidayToday ? 'Hôm nay (Nghỉ lễ)' : 'Hôm nay'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3.5 whitespace-nowrap">
                          {day.isWorking ? (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              Làm việc
                            </span>
                          ) : (
                            <span className="font-semibold text-slate-500">Nghỉ hành chính</span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                          {day.isWorking ? day.morningHours || '—' : '—'}
                        </td>
                        <td className="p-3.5 font-mono text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                          {day.isWorking ? day.afternoonHours || '—' : '—'}
                        </td>
                        <td className="p-3.5 text-slate-700 dark:text-slate-200">
                          {day.departmentsSummary || '—'}
                        </td>
                        <td className="p-3.5 text-slate-500 dark:text-slate-400">
                          {day.notes || 'Thường trực cấp cứu 24/24'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
              <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-1">
                <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <PhoneCall className="w-4 h-4 shrink-0" />
                  <span>Thường trực cấp cứu 24/7</span>
                </div>
                <p className="text-emerald-950 dark:text-emerald-100 leading-relaxed">
                  {weeklyWorkConfig.dutyHoursSummary ||
                    'Thường trực cấp cứu 24/24 giờ (07:00 hôm nay đến 07:00 hôm sau, kể cả Thứ 7, Chủ Nhật và ngày Lễ/Tết).'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <CalendarCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Lưu ý dành cho người dân</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {weeklyWorkConfig.generalNote ||
                    'Người dân khám BHYT hoặc giải quyết thủ tục hành chính vui lòng đến trong giờ làm việc. Trường hợp cấp cứu liên hệ trực tiếp kíp trực 24/7.'}
                </p>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      )}

      {/* TAB 3: PUBLIC HOLIDAY SCHEDULE LIST */}
      {activeTab === 'holidays' && (
        <RevealOnScroll title="Lịch nghỉ lễ và trực cấp cứu dịp lễ">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                  Lịch Nghỉ Lễ &amp; Thông Báo Hoạt Động Dịp Lễ, Tết
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Vào các ngày nghỉ lễ được thiết lập, hệ thống tự động bật thông báo toàn trang để người dân nắm rõ lịch nghỉ hành chính và số điện thoại trực cấp cứu 24/7.
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveTab('setup')}
                  className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap self-start sm:self-auto"
                >
                  <Settings2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Thiết lập lịch nghỉ lễ</span>
                </button>
              )}
            </div>

            {sortedHolidays.length === 0 ? (
              <div className="p-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
                <CalendarOff className="w-9 h-9 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Hiện chưa có lịch nghỉ lễ nào được công bố
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Quản trị viên có thể thiết lập các kỳ nghỉ lễ tại mục “Thiết lập (Admin)” để hệ thống tự động thông báo khi đến ngày lễ.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedHolidays.map(holiday => {
                  const status = resolveHolidayStatus(holiday, nowInfo.dateKey);
                  const isToday = status.status === 'today' && holiday.isActive !== false;
                  const matchedDuties = getDutySchedulesForHoliday(schedules, holiday, nowInfo.dateKey);
                  const hasOverrideLeader = Boolean(holiday.headName?.trim() || holiday.headPhone?.trim());
                  const targetDutyDate =
                    matchedDuties[0]?.date || (isToday ? nowInfo.dateKey : holiday.startDate);

                  return (
                    <div
                      key={holiday.id}
                      className={`p-5 rounded-2xl border space-y-3.5 ${
                        isToday
                          ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                          : 'bg-slate-50/70 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800'
                      } ${holiday.isActive === false ? 'opacity-65' : ''}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`font-bold ${
                              isToday
                                ? 'text-rose-700 dark:text-rose-400'
                                : status.status === 'upcoming'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {isToday
                              ? 'Đang trong kỳ nghỉ lễ hôm nay'
                              : status.status === 'upcoming'
                              ? `Còn ${status.daysUntil} ngày`
                              : 'Đã qua'}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                            {formatHolidayDateRange(holiday)}
                          </span>
                          {holiday.isAnnual && (
                            <>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-semibold">
                                <Repeat className="w-3 h-3" />
                                <span>Hằng năm</span>
                              </span>
                            </>
                          )}
                          {holiday.isActive === false && (
                            <>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="text-rose-600 font-semibold">Đang tắt (chỉ Admin xem)</span>
                            </>
                          )}
                        </div>

                        {onPreviewHoliday && isAdmin && (
                          <button
                            type="button"
                            onClick={() => onPreviewHoliday(holiday)}
                            className="px-3 py-1 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Play className="w-3 h-3" />
                            <span>Xem thử thông báo</span>
                          </button>
                        )}
                      </div>

                      <h4 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                        {holiday.name}
                      </h4>

                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                        {holiday.noticeMessage ||
                          'Trạm Y tế nghỉ làm việc hành chính theo quy định. Bộ phận thường trực cấp cứu 24/7 vẫn trực tiếp nhận xử trí y tế khẩn cấp.'}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 dark:text-slate-400 block">
                            Làm việc bình thường trở lại
                          </span>
                          <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                            {holiday.resumeDate
                              ? formatIsoDateVN(holiday.resumeDate)
                              : 'Ngay sau kỳ nghỉ lễ'}
                          </span>
                        </div>

                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 dark:text-slate-400 block">
                            Phương án trực cấp cứu 24/7 dịp lễ
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            {holiday.dutyArrangement || 'Thường trực cấp cứu 24/24 tại Trụ sở chính & các điểm trạm.'}
                          </span>
                        </div>
                      </div>

                      {/* Medical Point Heads & Duty Roster for this Holiday */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {(hasOverrideLeader || pointLeaders.length > 0) && (
                          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                              <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>Người đứng đầu các Điểm Y tế &amp; SĐT</span>
                            </div>

                            {hasOverrideLeader && (
                              <div className="p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 block">
                                    Trực lãnh đạo kỳ nghỉ lễ
                                  </span>
                                  <span className="font-extrabold text-slate-900 dark:text-white">
                                    {holiday.headName?.trim() || 'Lãnh đạo phụ trách điểm y tế'}
                                  </span>
                                </div>
                                {holiday.headPhone?.trim() && (
                                  <a
                                    href={`tel:${holiday.headPhone.trim()}`}
                                    className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold inline-flex items-center gap-1 tabular-nums whitespace-nowrap"
                                  >
                                    <Phone className="w-3 h-3 shrink-0" />
                                    <span>{holiday.headPhone.trim()}</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {pointLeaders.length > 0 && (
                              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {pointLeaders.map(pt => (
                                  <div
                                    key={pt.id}
                                    className="py-1.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2 text-xs"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                                        {pt.pointName}
                                      </div>
                                      {pt.headName && (
                                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                          Người đứng đầu:{' '}
                                          <strong className="text-slate-900 dark:text-white">
                                            {pt.headName}
                                          </strong>
                                        </div>
                                      )}
                                    </div>
                                    {pt.phone && (
                                      <a
                                        href={`tel:${pt.phone}`}
                                        className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-bold inline-flex items-center gap-1 hover:bg-emerald-100 tabular-nums whitespace-nowrap shrink-0"
                                      >
                                        <Phone className="w-3 h-3 shrink-0" />
                                        <span>{pt.phone}</span>
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                              <CalendarClock className="w-4 h-4 shrink-0" />
                              <span>Lịch trực ngày lễ đó ({matchedDuties.length} ca)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFilterDate(targetDutyDate);
                                setActiveTab('daily');
                              }}
                              className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
                            >
                              Xem chi tiết ngày trực
                            </button>
                          </div>

                          {matchedDuties.length > 0 ? (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                              {matchedDuties.slice(0, 5).map(sch => (
                                <div key={sch.id} className="py-1.5 first:pt-0 last:pb-0 space-y-0.5 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                                      <span className="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                                        {formatIsoDateVN(sch.date)}
                                      </span>
                                      <span className="text-slate-300 dark:text-slate-700">·</span>
                                      <span className="text-rose-700 dark:text-rose-400 shrink-0">
                                        {HOLIDAY_SHIFT_LABELS[sch.shift] || 'Ca trực'}
                                      </span>
                                      <span className="text-slate-300 dark:text-slate-700">·</span>
                                      <span className="truncate">{sch.title}</span>
                                    </div>
                                    {sch.phone && (
                                      <a
                                        href={`tel:${sch.phone}`}
                                        className="font-bold text-rose-700 dark:text-rose-300 hover:underline inline-flex items-center gap-1 tabular-nums whitespace-nowrap shrink-0"
                                      >
                                        <Phone className="w-3 h-3 shrink-0" />
                                        <span>{sch.phone}</span>
                                      </a>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <span>
                                      <strong>{sch.doctorName || sch.staffNames || 'Kíp trực y tế'}</strong>
                                      {sch.nurseName ? ` · ĐD: ${sch.nurseName}` : ''}
                                    </span>
                                    {sch.location && (
                                      <span className="text-slate-500 dark:text-slate-400">
                                        · {sch.location}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                              Chưa phân công ca trực chi tiết riêng cho ngày lễ này trong bảng Lịch trực 24/7. Người dân cần hỗ trợ vui lòng gọi số Người đứng đầu Điểm Y tế hoặc Đường dây nóng trực lễ.
                            </p>
                          )}
                        </div>
                      </div>

                      {holiday.emergencyPhone && (
                        <div className="pt-1">
                          <a
                            href={`tel:${holiday.emergencyPhone}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold tabular-nums whitespace-nowrap"
                          >
                            <Phone className="w-3.5 h-3.5 shrink-0" />
                            <span>Đường dây nóng trực lễ: {holiday.emergencyPhone}</span>
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </RevealOnScroll>
      )}

      {/* TAB 4: ADMIN SETUP WORK SCHEDULE & HOLIDAYS */}
      {activeTab === 'setup' && isAdmin && (
        <WorkAndHolidaySetupManager
          settings={settings || emptySystemSettings}
          workSchedules={schedules}
          onPreviewHoliday={onPreviewHoliday}
        />
      )}

      {/* Add / Edit Schedule Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingSchedule ? 'Chỉnh Sửa Ca Trực / Lịch Công Tác' : 'Thêm Ca Trực / Lịch Làm Việc'}
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveScheduleForm} className="space-y-3.5 text-xs sm:text-sm">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Phân loại lịch
                </label>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value as WorkSchedule['type'])}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                >
                  <option value="duty">Trực cấp cứu 24/7</option>
                  <option value="clinic">Lịch làm việc / Khám chữa bệnh BHYT</option>
                  <option value="vaccine">Tiêm chủng &amp; Y tế dự phòng</option>
                  <option value="community">Công tác y tế cộng đồng</option>
                  <option value="meeting">Họp / Giao ban chuyên môn</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tên ca trực / Nội dung công tác *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Ca trực cấp cứu 24/7 hoặc Lịch khám BHYT sáng"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ngày *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ca / Khung giờ
                  </label>
                  <select
                    value={formShift}
                    onChange={e => setFormShift(e.target.value as WorkSchedule['shift'])}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="full_day">Trực 24/24 / Cả ngày</option>
                    <option value="morning">Ca sáng</option>
                    <option value="afternoon">Ca chiều</option>
                    <option value="night">Ca đêm</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Điểm trạm / Cơ sở
                </label>
                <select
                  value={formLocation}
                  onChange={e => setFormLocation(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {stationLocations.map(loc => (
                    <option key={loc.id} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Bác sĩ / Phụ trách
                  </label>
                  <input
                    type="text"
                    value={formDoctor}
                    onChange={e => setFormDoctor(e.target.value)}
                    placeholder="BS. Nguyễn Văn A"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Điều dưỡng / Y sĩ
                  </label>
                  <input
                    type="text"
                    value={formNurse}
                    onChange={e => setFormNurse(e.target.value)}
                    placeholder="ĐD. Trần Thị B"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nhân sự khác
                  </label>
                  <input
                    type="text"
                    value={formStaff}
                    onChange={e => setFormStaff(e.target.value)}
                    placeholder="Kíp trực y tế"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Số điện thoại trực
                  </label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    placeholder="028xxxxxxx"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ghi chú
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Ghi chú phân công trực / làm việc..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl cursor-pointer whitespace-nowrap"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition cursor-pointer whitespace-nowrap"
                >
                  {savingForm ? 'Đang lưu...' : 'Lưu lịch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Import Preview Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  <span>Xác Nhận Nhập Excel ({importingData.length} lịch)</span>
                </h3>
                <p className="text-xs text-slate-500 truncate">Tệp: {importFileName}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 max-h-60">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 font-bold text-slate-600 dark:text-slate-300">
                    <th className="p-2.5 whitespace-nowrap">Ngày</th>
                    <th className="p-2.5 whitespace-nowrap">Loại</th>
                    <th className="p-2.5 whitespace-nowrap">Ca</th>
                    <th className="p-2.5 whitespace-nowrap">Tên ca</th>
                    <th className="p-2.5 whitespace-nowrap">Bác sĩ / Nhân sự</th>
                    <th className="p-2.5 whitespace-nowrap">Địa điểm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                  {importingData.slice(0, 20).map((row, idx) => (
                    <tr key={idx}>
                      <td className="p-2.5 font-mono tabular-nums whitespace-nowrap">{row.date}</td>
                      <td className="p-2.5 whitespace-nowrap">
                        {SCHEDULE_TYPE_META[row.type || 'duty']?.shortLabel || 'Trực 24/7'}
                      </td>
                      <td className="p-2.5 whitespace-nowrap">{row.shift}</td>
                      <td className="p-2.5 font-medium">{row.title}</td>
                      <td className="p-2.5">{row.doctorName || row.staffNames}</td>
                      <td className="p-2.5">{row.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 sm:max-w-xs sm:ml-auto">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl cursor-pointer whitespace-nowrap"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSavingImport}
                onClick={handleConfirmImport}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {isSavingImport ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>Lưu tất cả</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
