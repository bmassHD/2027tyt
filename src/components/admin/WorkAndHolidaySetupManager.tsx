import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CalendarOff,
  Clock,
  Edit,
  Eye,
  EyeOff,
  Play,
  Plus,
  Repeat,
  Save,
  Trash2,
  X,
  Phone,
  BellRing,
  CheckCircle2,
  UserCheck,
  CalendarClock,
} from 'lucide-react';
import {
  HolidayScheduleItem,
  SystemSettings,
  WeeklyWorkDayConfig,
  WorkSchedule,
  WorkScheduleConfig,
} from '../../types';
import {
  DEFAULT_WORK_SCHEDULE_CONFIG,
  HOLIDAY_PRESETS,
  formatHolidayDateRange,
  formatIsoDateVN,
  getDutySchedulesForHoliday,
  getResolvedWeeklyWorkSchedule,
  getStationPointLeaders,
  getVietnamTodayKey,
  logAuditEvent,
  resolveHolidayStatus,
  sortHolidaySchedules,
  updateSystemSettings,
} from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface WorkAndHolidaySetupManagerProps {
  settings: SystemSettings;
  workSchedules?: WorkSchedule[];
  onPreviewHoliday?: (holiday: HolidayScheduleItem) => void;
}

export const WorkAndHolidaySetupManager: React.FC<WorkAndHolidaySetupManagerProps> = ({
  settings,
  workSchedules = [],
  onPreviewHoliday,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast, showConfirm } = useToast();

  const todayKey = getVietnamTodayKey();

  // Weekly work schedule state
  const [weeklyDays, setWeeklyDays] = useState<WeeklyWorkDayConfig[]>(
    () => getResolvedWeeklyWorkSchedule(settings).weeklyDays
  );
  const [dutyHoursSummary, setDutyHoursSummary] = useState<string>(
    () =>
      getResolvedWeeklyWorkSchedule(settings).dutyHoursSummary ||
      DEFAULT_WORK_SCHEDULE_CONFIG.dutyHoursSummary ||
      ''
  );
  const [generalNote, setGeneralNote] = useState<string>(
    () =>
      getResolvedWeeklyWorkSchedule(settings).generalNote ||
      DEFAULT_WORK_SCHEDULE_CONFIG.generalNote ||
      ''
  );
  const [syncWorkingHoursField, setSyncWorkingHoursField] = useState(true);
  const [savingWeekly, setSavingWeekly] = useState(false);

  // Holiday list & modal state
  const [holidays, setHolidays] = useState<HolidayScheduleItem[]>(() =>
    sortHolidaySchedules(settings.holidaySchedules || [], todayKey)
  );
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<HolidayScheduleItem | null>(null);

  const [holName, setHolName] = useState('');
  const [holStartDate, setHolStartDate] = useState(todayKey);
  const [holEndDate, setHolEndDate] = useState(todayKey);
  const [holResumeDate, setHolResumeDate] = useState('');
  const [holIsAnnual, setHolIsAnnual] = useState(false);
  const [holNoticeTitle, setHolNoticeTitle] = useState('');
  const [holNoticeMessage, setHolNoticeMessage] = useState('');
  const [holDutyArrangement, setHolDutyArrangement] = useState('');
  const [holEmergencyPhone, setHolEmergencyPhone] = useState('');
  const [holHeadName, setHolHeadName] = useState('');
  const [holHeadPhone, setHolHeadPhone] = useState('');
  const [holShowBanner, setHolShowBanner] = useState(true);
  const [holShowModalOnEntry, setHolShowModalOnEntry] = useState(true);
  const [holIsActive, setHolIsActive] = useState(true);

  const pointLeaders = useMemo(() => getStationPointLeaders(settings), [settings]);

  useEffect(() => {
    const resolved = getResolvedWeeklyWorkSchedule(settings);
    setWeeklyDays(resolved.weeklyDays);
    setDutyHoursSummary(
      resolved.dutyHoursSummary || DEFAULT_WORK_SCHEDULE_CONFIG.dutyHoursSummary || ''
    );
    setGeneralNote(resolved.generalNote || DEFAULT_WORK_SCHEDULE_CONFIG.generalNote || '');
    setHolidays(sortHolidaySchedules(settings.holidaySchedules || [], todayKey));
  }, [settings, todayKey]);

  const sortedHolidays = useMemo(
    () => sortHolidaySchedules(holidays, todayKey),
    [holidays, todayKey]
  );

  const handleDayChange = (
    dayOfWeek: WeeklyWorkDayConfig['dayOfWeek'],
    patch: Partial<WeeklyWorkDayConfig>
  ) => {
    setWeeklyDays(prev =>
      prev.map(d => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const buildSummaryWorkingHours = (days: WeeklyWorkDayConfig[]): string => {
    const activeDays = days.filter(d => d.isWorking);
    if (activeDays.length === 0) return 'Thường trực cấp cứu 24/7';
    const first = activeDays[0];
    const last = activeDays[activeDays.length - 1];
    const hours = [first.morningHours, first.afternoonHours].filter(Boolean).join(' | ');
    return `${first.label} – ${last.label}: ${hours || '07:30 - 17:00'} (Trực cấp cứu 24/7)`;
  };

  const handleSaveWeeklyWorkSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingWeekly(true);
    try {
      const nextConfig: WorkScheduleConfig = {
        weeklyDays: weeklyDays.map(d => ({
          dayOfWeek: d.dayOfWeek,
          label: d.label,
          isWorking: Boolean(d.isWorking),
          morningHours: (d.morningHours || '').trim(),
          afternoonHours: (d.afternoonHours || '').trim(),
          departmentsSummary: (d.departmentsSummary || '').trim(),
          notes: (d.notes || '').trim(),
        })),
        dutyHoursSummary: dutyHoursSummary.trim(),
        generalNote: generalNote.trim(),
        updatedAt: new Date().toISOString(),
      };

      const updatePayload: Partial<SystemSettings> = {
        workScheduleConfig: nextConfig,
        updatedAt: new Date().toISOString(),
      };
      if (syncWorkingHoursField) {
        updatePayload.workingHours = buildSummaryWorkingHours(nextConfig.weeklyDays);
      }

      await updateSystemSettings(updatePayload);
      await logAuditEvent(
        'Cập nhật lịch làm việc tuần',
        'Lịch trực & Làm việc',
        `Cập nhật giờ làm việc Thứ 2 - Chủ Nhật`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Quản trị viên',
        }
      );
      showToast('success', 'Đã lưu cấu hình lịch làm việc tuần');
    } catch (err: any) {
      showToast('error', 'Không thể lưu lịch làm việc', err?.message);
    } finally {
      setSavingWeekly(false);
    }
  };

  const openCreateHolidayModal = () => {
    setEditingHoliday(null);
    setHolName('');
    setHolStartDate(todayKey);
    setHolEndDate(todayKey);
    setHolResumeDate('');
    setHolIsAnnual(false);
    setHolNoticeTitle('');
    setHolNoticeMessage(
      'Trạm Y tế tạm nghỉ làm việc hành chính nhân dịp nghỉ lễ. Bộ phận thường trực cấp cứu 24/24 vẫn tiếp nhận và xử trí y tế khẩn cấp bình thường.'
    );
    setHolDutyArrangement(
      'Kíp trực cấp cứu 24/24 giờ túc trực tại Trụ sở chính và các điểm trạm theo lịch trực lễ công khai.'
    );
    setHolEmergencyPhone(settings.emergencyPhone || '');
    setHolHeadName(pointLeaders[0]?.headName || '');
    setHolHeadPhone(pointLeaders[0]?.phone || '');
    setHolShowBanner(true);
    setHolShowModalOnEntry(true);
    setHolIsActive(true);
    setHolidayModalOpen(true);
  };

  const openEditHolidayModal = (item: HolidayScheduleItem) => {
    setEditingHoliday(item);
    setHolName(item.name || '');
    setHolStartDate(item.startDate || todayKey);
    setHolEndDate(item.endDate || item.startDate || todayKey);
    setHolResumeDate(item.resumeDate || '');
    setHolIsAnnual(Boolean(item.isAnnual));
    setHolNoticeTitle(item.noticeTitle || '');
    setHolNoticeMessage(item.noticeMessage || '');
    setHolDutyArrangement(item.dutyArrangement || '');
    setHolEmergencyPhone(item.emergencyPhone || '');
    setHolHeadName(item.headName || '');
    setHolHeadPhone(item.headPhone || '');
    setHolShowBanner(item.showBanner !== false);
    setHolShowModalOnEntry(item.showModalOnEntry !== false);
    setHolIsActive(item.isActive !== false);
    setHolidayModalOpen(true);
  };

  const applyHolidayPreset = (preset: (typeof HOLIDAY_PRESETS)[number]) => {
    const year = todayKey.slice(0, 4);
    setHolName(preset.name);
    setHolStartDate(`${year}-${preset.mmddStart}`);
    setHolEndDate(`${year}-${preset.mmddEnd}`);
    setHolIsAnnual(preset.isAnnual);
    setHolNoticeTitle(preset.noticeTitle);
    setHolNoticeMessage(preset.noticeMessage);
    setHolDutyArrangement(preset.dutyArrangement);
    setHolShowBanner(true);
    setHolShowModalOnEntry(true);
    setHolIsActive(true);
  };

  const persistHolidaysList = async (
    nextList: HolidayScheduleItem[],
    auditAction: string,
    auditDetail: string
  ) => {
    const cleaned = sortHolidaySchedules(nextList, todayKey);
    await updateSystemSettings({
      holidaySchedules: cleaned,
      updatedAt: new Date().toISOString(),
    });
    setHolidays(cleaned);
    await logAuditEvent(auditAction, 'Lịch nghỉ lễ', auditDetail, {
      uid: currentUser?.uid || 'admin',
      name: userProfile?.displayName || 'Quản trị viên',
    });
  };

  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holName.trim() || !holStartDate) {
      showToast('warning', 'Thiếu thông tin', 'Vui lòng nhập tên kỳ nghỉ lễ và ngày bắt đầu.');
      return;
    }
    const effectiveEnd = holEndDate && holEndDate >= holStartDate ? holEndDate : holStartDate;
    if (holEndDate && holEndDate < holStartDate) {
      showToast('warning', 'Ngày kết thúc không hợp lệ', 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.');
      return;
    }

    setSavingHoliday(true);
    try {
      const nextItem: HolidayScheduleItem = {
        id: editingHoliday?.id || `hol_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: holName.trim(),
        startDate: holStartDate,
        endDate: effectiveEnd,
        resumeDate: holResumeDate || undefined,
        isAnnual: holIsAnnual,
        noticeTitle: holNoticeTitle.trim() || undefined,
        noticeMessage: holNoticeMessage.trim() || undefined,
        dutyArrangement: holDutyArrangement.trim() || undefined,
        emergencyPhone: holEmergencyPhone.trim() || undefined,
        headName: holHeadName.trim() || undefined,
        headPhone: holHeadPhone.trim() || undefined,
        showBanner: holShowBanner,
        showModalOnEntry: holShowModalOnEntry,
        isActive: holIsActive,
        updatedAt: new Date().toISOString(),
      };

      const nextList = editingHoliday
        ? holidays.map(h => (h.id === editingHoliday.id ? nextItem : h))
        : [...holidays, nextItem];

      await persistHolidaysList(
        nextList,
        editingHoliday ? 'Cập nhật lịch nghỉ lễ' : 'Thêm lịch nghỉ lễ',
        `${nextItem.name} (${formatHolidayDateRange(nextItem)})`
      );
      showToast(
        'success',
        editingHoliday ? 'Đã cập nhật lịch nghỉ lễ' : 'Đã thêm lịch nghỉ lễ mới',
        'Khi người dân truy cập đúng ngày nghỉ lễ, hệ thống sẽ tự động hiển thị thông báo rõ ràng.'
      );
      setHolidayModalOpen(false);
    } catch (err: any) {
      showToast('error', 'Không thể lưu lịch nghỉ lễ', err?.message);
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleToggleHolidayActive = async (item: HolidayScheduleItem) => {
    try {
      const updated: HolidayScheduleItem = {
        ...item,
        isActive: !item.isActive,
        updatedAt: new Date().toISOString(),
      };
      const nextList = holidays.map(h => (h.id === item.id ? updated : h));
      await persistHolidaysList(
        nextList,
        updated.isActive ? 'Bật lịch nghỉ lễ' : 'Ẩn lịch nghỉ lễ',
        updated.name
      );
      showToast('info', updated.isActive ? 'Đã bật lịch nghỉ lễ' : 'Đã tạm ẩn lịch nghỉ lễ');
    } catch (err: any) {
      showToast('error', 'Không thể cập nhật trạng thái', err?.message);
    }
  };

  const handleDeleteHoliday = (item: HolidayScheduleItem) => {
    showConfirm({
      title: 'Xóa lịch nghỉ lễ này?',
      message: `Xóa "${item.name}" (${formatHolidayDateRange(item)}) khỏi hệ thống?`,
      confirmText: 'Xóa lịch nghỉ lễ',
      cancelText: 'Hủy',
      isDangerous: true,
      onConfirm: async () => {
        try {
          const nextList = holidays.filter(h => h.id !== item.id);
          await persistHolidaysList(nextList, 'Xóa lịch nghỉ lễ', item.name);
          showToast('success', 'Đã xóa lịch nghỉ lễ');
        } catch (err: any) {
          showToast('error', 'Không thể xóa lịch nghỉ lễ', err?.message);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Weekly Work Schedule Setup */}
      <form
        onSubmit={handleSaveWeeklyWorkSchedule}
        className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Thiết Lập Lịch Làm Việc Hành Chính &amp; Trực 24/7 Trong Tuần
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Cấu hình khung giờ làm việc từng ngày (Thứ 2 – Chủ Nhật) kết hợp song song với kíp trực cấp cứu 24/7.
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingWeekly}
            className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
            <span>{savingWeekly ? 'Đang lưu...' : 'Lưu lịch làm việc'}</span>
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs border-collapse min-w-[740px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="p-3 whitespace-nowrap">Ngày trong tuần</th>
                <th className="p-3 whitespace-nowrap">Trạng thái</th>
                <th className="p-3 whitespace-nowrap">Giờ sáng</th>
                <th className="p-3 whitespace-nowrap">Giờ chiều</th>
                <th className="p-3 whitespace-nowrap">Hoạt động / Bộ phận tiếp nhận</th>
                <th className="p-3 whitespace-nowrap">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {weeklyDays.map(day => (
                <tr
                  key={day.dayOfWeek}
                  className={
                    day.isWorking
                      ? 'bg-white dark:bg-slate-900'
                      : 'bg-slate-50/70 dark:bg-slate-950/40 text-slate-500'
                  }
                >
                  <td className="p-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {day.label}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={day.isWorking}
                        onChange={e =>
                          handleDayChange(day.dayOfWeek, {
                            isWorking: e.target.checked,
                            morningHours: e.target.checked
                              ? day.morningHours || '07:30 - 11:30'
                              : '',
                            afternoonHours: e.target.checked
                              ? day.afternoonHours || '13:30 - 17:00'
                              : '',
                          })
                        }
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <span
                        className={`font-semibold ${
                          day.isWorking
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {day.isWorking ? 'Làm việc' : 'Nghỉ hành chính'}
                      </span>
                    </label>
                  </td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      disabled={!day.isWorking}
                      value={day.morningHours || ''}
                      onChange={e =>
                        handleDayChange(day.dayOfWeek, { morningHours: e.target.value })
                      }
                      placeholder="07:30 - 11:30"
                      className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 disabled:opacity-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      disabled={!day.isWorking}
                      value={day.afternoonHours || ''}
                      onChange={e =>
                        handleDayChange(day.dayOfWeek, { afternoonHours: e.target.value })
                      }
                      placeholder="13:30 - 17:00"
                      className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 disabled:opacity-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      value={day.departmentsSummary || ''}
                      onChange={e =>
                        handleDayChange(day.dayOfWeek, { departmentsSummary: e.target.value })
                      }
                      placeholder="Khám BHYT, Tiêm chủng..."
                      className="w-full min-w-[200px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      value={day.notes || ''}
                      onChange={e =>
                        handleDayChange(day.dayOfWeek, { notes: e.target.value })
                      }
                      placeholder="Thường trực 24/24"
                      className="w-full min-w-[140px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Quy định trực cấp cứu 24/7
            </label>
            <input
              type="text"
              value={dutyHoursSummary}
              onChange={e => setDutyHoursSummary(e.target.value)}
              placeholder="Thường trực cấp cứu 24/24 giờ (07:00 hôm nay đến 07:00 hôm sau)"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Hướng dẫn chung cho người dân
            </label>
            <input
              type="text"
              value={generalNote}
              onChange={e => setGeneralNote(e.target.value)}
              placeholder="Lưu ý giờ tiếp nhận khám BHYT và cấp cứu 24/7..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={syncWorkingHoursField}
            onChange={e => setSyncWorkingHoursField(e.target.checked)}
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
          />
          <span>Tự động đồng bộ tóm tắt giờ làm việc ra Footer và Thông tin đơn vị</span>
        </label>
      </form>

      {/* Section 2: Holiday Schedule Setup */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 shrink-0">
              <CalendarOff className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Thiết Lập Lịch Nghỉ Lễ &amp; Thông Báo Tự Động Khi Truy Cập
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Khi người dân truy cập website đúng ngày nghỉ lễ đã thiết lập, hệ thống sẽ hiển thị banner và hộp thoại thông báo rõ ràng kèm số cấp cứu trực lễ 24/7.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateHolidayModal}
            className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>Thêm kỳ nghỉ lễ</span>
          </button>
        </div>

        {sortedHolidays.length === 0 ? (
          <div className="p-10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
            <CalendarOff className="w-9 h-9 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Chưa có lịch nghỉ lễ nào được thiết lập
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Nhấn “Thêm kỳ nghỉ lễ” để cài đặt ngày nghỉ lễ/Tết (hỗ trợ mẫu nhanh các ngày lễ quốc gia Việt Nam).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedHolidays.map(item => {
              const status = resolveHolidayStatus(item, todayKey);
              const matchedDuties = getDutySchedulesForHoliday(workSchedules, item, todayKey);
              const displayLeaderName = item.headName?.trim() || pointLeaders[0]?.headName;
              const displayLeaderPhone = item.headPhone?.trim() || pointLeaders[0]?.phone;

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                    status.status === 'today' && item.isActive
                      ? 'bg-rose-50/60 dark:bg-rose-950/25 border-rose-300 dark:border-rose-800'
                      : 'bg-slate-50/70 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800'
                  } ${!item.isActive ? 'opacity-65' : ''}`}
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`font-bold ${
                          status.status === 'today'
                            ? 'text-rose-700 dark:text-rose-400'
                            : status.status === 'upcoming'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {status.status === 'today'
                          ? 'Đang nghỉ lễ hôm nay'
                          : status.status === 'upcoming'
                          ? `Còn ${status.daysUntil} ngày`
                          : 'Đã qua'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatHolidayDateRange(item)}
                      </span>
                      {item.isAnnual && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-semibold">
                            <Repeat className="w-3 h-3" />
                            <span>Hằng năm</span>
                          </span>
                        </>
                      )}
                      {!item.isActive && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-rose-600 font-semibold">Đang tắt</span>
                        </>
                      )}
                    </div>

                    <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                      {item.name}
                    </h4>

                    {item.noticeMessage && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        {item.noticeMessage}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {item.resumeDate && (
                        <span>
                          Làm việc lại: <strong className="text-slate-700 dark:text-slate-200">{formatIsoDateVN(item.resumeDate)}</strong>
                        </span>
                      )}
                      {(displayLeaderName || displayLeaderPhone) && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                          <UserCheck className="w-3 h-3 shrink-0" />
                          <span>
                            Người đứng đầu: {displayLeaderName || 'Điểm y tế'}
                            {displayLeaderPhone ? ` · ${displayLeaderPhone}` : ''}
                          </span>
                        </span>
                      )}
                      {item.emergencyPhone && (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                          <Phone className="w-3 h-3" />
                          <span>Trực lễ: {item.emergencyPhone}</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-semibold">
                        <CalendarClock className="w-3 h-3 text-emerald-600" />
                        <span>Lịch trực kỳ nghỉ: {matchedDuties.length} ca</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <BellRing className="w-3 h-3 text-emerald-600" />
                        <span>
                          Banner: {item.showBanner !== false ? 'Bật' : 'Tắt'} · Hộp thoại tự động:{' '}
                          {item.showModalOnEntry !== false ? 'Bật' : 'Tắt'}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {onPreviewHoliday && (
                      <button
                        type="button"
                        onClick={() => onPreviewHoliday(item)}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 text-xs font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Xem thử thông báo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => openEditHolidayModal(item)}
                      className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                      title="Chỉnh sửa"
                    >
                      <Edit className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleHolidayActive(item)}
                      className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                      title={item.isActive ? 'Tạm tắt lịch nghỉ lễ' : 'Bật lịch nghỉ lễ'}
                    >
                      {item.isActive ? (
                        <Eye className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <EyeOff className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteHoliday(item)}
                      className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 cursor-pointer"
                      title="Xóa"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Holiday Modal */}
      {holidayModalOpen && (
        <div
          className="fixed inset-0 z-[140] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={e => {
            if (e.target === e.currentTarget) setHolidayModalOpen(false);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <CalendarOff className="w-5 h-5 text-rose-600" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {editingHoliday ? 'Chỉnh Sửa Lịch Nghỉ Lễ' : 'Thiết Lập Kỳ Nghỉ Lễ Mới'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHolidayModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveHoliday}
              className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs sm:text-sm"
            >
              {!editingHoliday && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Mẫu nhanh ngày nghỉ lễ tại Việt Nam:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HOLIDAY_PRESETS.map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyHolidayPreset(p)}
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-rose-500 hover:text-rose-700 dark:hover:text-rose-300 text-[11px] font-semibold transition cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tên kỳ nghỉ lễ *
                  </label>
                  <input
                    type="text"
                    required
                    value={holName}
                    onChange={e => setHolName(e.target.value)}
                    placeholder="Ví dụ: Nghỉ Lễ 30/4 - 01/5 hoặc Nghỉ Tết Nguyên Đán"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Từ ngày *
                  </label>
                  <input
                    type="date"
                    required
                    value={holStartDate}
                    onChange={e => {
                      const val = e.target.value;
                      setHolStartDate(val);
                      if (!holEndDate || holEndDate < val) setHolEndDate(val);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Đến hết ngày *
                  </label>
                  <input
                    type="date"
                    required
                    min={holStartDate}
                    value={holEndDate}
                    onChange={e => setHolEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ngày làm việc trở lại (tùy chọn)
                  </label>
                  <input
                    type="date"
                    value={holResumeDate}
                    min={holEndDate || holStartDate}
                    onChange={e => setHolResumeDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Số điện thoại trực lễ ưu tiên
                  </label>
                  <input
                    type="tel"
                    value={holEmergencyPhone}
                    onChange={e => setHolEmergencyPhone(e.target.value)}
                    placeholder={settings.emergencyPhone || '115 / 028...'}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Người đứng đầu / Trực lãnh đạo dịp lễ
                  </label>
                  <input
                    type="text"
                    value={holHeadName}
                    onChange={e => setHolHeadName(e.target.value)}
                    placeholder={pointLeaders[0]?.headName || 'BS. Trưởng Trạm / Trưởng điểm y tế'}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SĐT người đứng đầu dịp lễ
                  </label>
                  <input
                    type="tel"
                    value={holHeadPhone}
                    onChange={e => setHolHeadPhone(e.target.value)}
                    placeholder={pointLeaders[0]?.phone || settings.hotline || '028xxxxxxx'}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {pointLeaders.length > 0 && (
                  <div className="sm:col-span-2 p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-1.5 text-xs">
                    <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 shrink-0" />
                      <span>Tự động đính kèm Người đứng đầu các Điểm Y tế &amp; Lịch trực ngày lễ</span>
                    </div>
                    <div className="space-y-1 text-emerald-950 dark:text-emerald-100 tabular-nums">
                      {pointLeaders.map(pt => (
                        <div key={pt.id} className="flex flex-wrap items-center gap-x-2">
                          <span className="font-semibold">{pt.pointName}:</span>
                          <span>{pt.headName || 'Chưa nhập tên'}</span>
                          {pt.phone && <span className="font-bold">· {pt.phone}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tiêu đề thông báo trên website (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={holNoticeTitle}
                    onChange={e => setHolNoticeTitle(e.target.value)}
                    placeholder="Mặc định dùng tên kỳ nghỉ lễ nếu để trống"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nội dung thông báo gửi người dân trong ngày nghỉ lễ
                  </label>
                  <textarea
                    rows={3}
                    value={holNoticeMessage}
                    onChange={e => setHolNoticeMessage(e.target.value)}
                    placeholder="Thông báo rõ việc nghỉ khám hành chính và hướng dẫn liên hệ cấp cứu 24/7..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-y"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Phương án trực cấp cứu 24/7 dịp lễ
                  </label>
                  <textarea
                    rows={2}
                    value={holDutyArrangement}
                    onChange={e => setHolDutyArrangement(e.target.value)}
                    placeholder="Kíp trực cấp cứu 24/24 giờ tại Trụ sở chính và các điểm trạm..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/40 dark:bg-emerald-950/20 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holShowBanner}
                    onChange={e => setHolShowBanner(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Hiện Banner thông báo toàn trang
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Hiển thị ngay đầu website khi truy cập đúng ngày lễ
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holShowModalOnEntry}
                    onChange={e => setHolShowModalOnEntry(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Tự bật hộp thoại thông báo khi mở trang
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Hiện rõ thông tin nghỉ lễ &amp; số cấp cứu 24/7
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holIsAnnual}
                    onChange={e => setHolIsAnnual(e.target.checked)}
                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Lặp lại hằng năm (theo ngày/tháng)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Dùng cho ngày lễ dương lịch cố định (01/01, 30/04, 02/09...)
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holIsActive}
                    onChange={e => setHolIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Kích hoạt lịch nghỉ lễ
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Công khai trên trang Lịch trực &amp; Làm việc
                    </div>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setHolidayModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingHoliday}
                  className="px-5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-semibold text-xs shadow-sm inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {savingHoliday
                      ? 'Đang lưu...'
                      : editingHoliday
                      ? 'Cập nhật lịch nghỉ lễ'
                      : 'Lưu lịch nghỉ lễ'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
