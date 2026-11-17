import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  CalendarOff,
  CalendarCheck,
  Phone,
  ShieldAlert,
  ArrowRight,
  Clock,
  Repeat,
  UserCheck,
  Building2,
  User,
  CalendarClock,
} from 'lucide-react';
import { HolidayScheduleItem, SystemSettings, WorkSchedule } from '../../types';
import {
  formatHolidayDateRange,
  formatIsoDateVN,
  getConfiguredEmergencyContacts,
  getDutySchedulesForHoliday,
  getStationPointLeaders,
  getVietnamTodayKey,
} from '../../services/firebaseService';
import { StationLogo } from '../common/StationLogo';

interface HolidayNoticeModalProps {
  holidays: HolidayScheduleItem[];
  isOpen: boolean;
  isPreview?: boolean;
  settings: SystemSettings;
  workSchedules?: WorkSchedule[];
  onClose: (dontShowToday: boolean) => void;
  onGoToDutySchedule: () => void;
}

const SHIFT_LABELS: Record<WorkSchedule['shift'], string> = {
  full_day: 'Ca 24/24h',
  night: 'Ca đêm',
  morning: 'Ca sáng',
  afternoon: 'Ca chiều',
};

export const HolidayNoticeModal: React.FC<HolidayNoticeModalProps> = ({
  holidays,
  isOpen,
  isPreview = false,
  settings,
  workSchedules = [],
  onClose,
  onGoToDutySchedule,
}) => {
  const [dontShowToday, setDontShowToday] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDontShowToday(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(dontShowToday);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, dontShowToday, onClose]);

  if (!isOpen || holidays.length === 0 || typeof document === 'undefined') return null;

  const isConfigured =
    Boolean(settings.stationName) && !settings.stationName.includes('Chưa cấu hình');
  const stationTitle = isConfigured ? settings.stationName : 'Trạm Y Tế';
  const todayKey = getVietnamTodayKey();
  const todayVN = formatIsoDateVN(todayKey);
  const emergencyContacts = getConfiguredEmergencyContacts(settings);
  const pointLeaders = getStationPointLeaders(settings);
  const leadHoliday = holidays[0];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="holiday-notice-modal-title"
      className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose(dontShowToday);
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-rose-200 dark:border-rose-900/60 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-rose-700 via-rose-800 to-amber-700 text-white flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-2xl bg-white/95 shrink-0 shadow-xs">
              <StationLogo size={34} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-100 tabular-nums">
                <CalendarOff className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {isPreview
                    ? 'Xem trước thông báo ngày nghỉ lễ'
                    : `Thông báo nghỉ lễ · Hôm nay ${todayVN}`}
                </span>
              </div>
              <h2
                id="holiday-notice-modal-title"
                className="text-base sm:text-lg font-extrabold leading-snug text-white mt-0.5 truncate"
              >
                {leadHoliday.noticeTitle?.trim() ||
                  (holidays.length === 1
                    ? leadHoliday.name
                    : `${holidays.length} Lịch Nghỉ Lễ Đang Áp Dụng`)}
              </h2>
              <p className="text-xs text-rose-100/90 truncate">{stationTitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClose(dontShowToday)}
            aria-label="Đóng thông báo nghỉ lễ"
            className="p-1.5 rounded-xl text-white/85 hover:text-white hover:bg-white/15 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {holidays.map(holiday => {
            const rangeText = formatHolidayDateRange(holiday);
            const fallbackMsg =
              'Trạm Y tế tạm nghỉ hoạt động khám chữa bệnh hành chính trong thời gian nghỉ lễ. Hoạt động tiếp nhận sơ cấp cứu ban đầu vẫn duy trì thường trực 24/7.';
            const fallbackDuty =
              'Kíp trực cấp cứu 24/24 giờ vẫn túc trực tiếp nhận xử trí y tế khẩn cấp tại Trụ sở chính và các điểm trạm.';
            const matchedDuties = getDutySchedulesForHoliday(workSchedules, holiday, todayKey);
            const hasOverrideLeader = Boolean(holiday.headName?.trim() || holiday.headPhone?.trim());

            return (
              <div
                key={holiday.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 p-4 space-y-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-rose-700 dark:text-rose-400">
                    Đang áp dụng nghỉ lễ hành chính
                  </span>
                  <div className="flex items-center gap-2 font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                    {holiday.isAnnual && (
                      <>
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                          <Repeat className="w-3 h-3" />
                          <span>Hằng năm</span>
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                      </>
                    )}
                    <span>{rangeText}</span>
                  </div>
                </div>

                <h3 className="text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                  {holiday.name}
                </h3>

                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                  {holiday.noticeMessage?.trim() || fallbackMsg}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-500 dark:text-slate-400">
                      <CalendarOff className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Thời gian nghỉ lễ</span>
                    </div>
                    <p className="font-bold text-slate-900 dark:text-white tabular-nums">
                      {rangeText}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-500 dark:text-slate-400">
                      <CalendarCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Làm việc bình thường lại</span>
                    </div>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {holiday.resumeDate
                        ? formatIsoDateVN(holiday.resumeDate)
                        : 'Ngay sau kỳ nghỉ lễ'}
                    </p>
                  </div>
                </div>

                {/* Head of Medical Points & Phones */}
                {(hasOverrideLeader || pointLeaders.length > 0) && (
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                      <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Người đứng đầu Điểm Y tế &amp; Trực lãnh đạo</span>
                    </div>

                    {hasOverrideLeader && (
                      <div className="p-2.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 block">
                            Trực lãnh đạo phụ trách kỳ nghỉ lễ
                          </span>
                          <span className="font-extrabold text-slate-900 dark:text-white">
                            {holiday.headName?.trim() || 'Lãnh đạo phụ trách điểm y tế'}
                          </span>
                        </div>
                        {holiday.headPhone?.trim() && (
                          <a
                            href={`tel:${holiday.headPhone.trim()}`}
                            className="px-3 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap"
                          >
                            <Phone className="w-3.5 h-3.5 shrink-0" />
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
                            className="py-2 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                                <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span className="truncate">{pt.pointName}</span>
                              </div>
                              {pt.headName && (
                                <p className="text-slate-600 dark:text-slate-300 mt-0.5 pl-5">
                                  Người đứng đầu:{' '}
                                  <strong className="text-slate-900 dark:text-white">
                                    {pt.headName}
                                  </strong>
                                </p>
                              )}
                            </div>

                            {pt.phone && (
                              <a
                                href={`tel:${pt.phone}`}
                                className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-bold inline-flex items-center gap-1.5 hover:bg-emerald-100 tabular-nums whitespace-nowrap shrink-0"
                              >
                                <Phone className="w-3.5 h-3.5 shrink-0" />
                                <span>{pt.phone}</span>
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Duty Roster for That Day */}
                <div className="p-3.5 rounded-2xl bg-emerald-50/75 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      <CalendarClock className="w-4 h-4 shrink-0" />
                      <span>
                        Lịch trực 24/7{' '}
                        {matchedDuties.length > 0 && matchedDuties[0].date === todayKey
                          ? `hôm nay (${todayVN})`
                          : `dịp lễ (${rangeText})`}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {matchedDuties.length} ca trực
                    </span>
                  </div>

                  {matchedDuties.length > 0 ? (
                    <div className="divide-y divide-emerald-200/70 dark:divide-emerald-800/60 bg-white/90 dark:bg-slate-900/90 rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 px-3">
                      {matchedDuties.map(sch => (
                        <div key={sch.id} className="py-2.5 space-y-1 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                                {formatIsoDateVN(sch.date)}
                              </span>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="text-rose-700 dark:text-rose-400 shrink-0">
                                {SHIFT_LABELS[sch.shift] || 'Ca trực'}
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

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <User className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>
                                <strong>{sch.doctorName || sch.staffNames || 'Kíp trực y tế'}</strong>
                                {sch.nurseName ? ` · ĐD: ${sch.nurseName}` : ''}
                              </span>
                            </span>
                            {sch.location && (
                              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                                <Building2 className="w-3 h-3 shrink-0" />
                                <span>{sch.location}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs sm:text-sm text-emerald-900 dark:text-emerald-100 leading-relaxed whitespace-pre-line">
                        {holiday.dutyArrangement?.trim() || fallbackDuty}
                      </p>
                      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                        Chưa có phân công ca trực chi tiết riêng cho ngày này; vui lòng gọi số Người đứng đầu Điểm Y tế hoặc đường dây nóng 24/7 bên dưới.
                      </p>
                    </div>
                  )}

                  {matchedDuties.length > 0 && holiday.dutyArrangement?.trim() && (
                    <p className="text-xs text-emerald-900 dark:text-emerald-100 leading-relaxed flex items-start gap-1.5">
                      <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{holiday.dutyArrangement.trim()}</span>
                    </p>
                  )}
                </div>

                {/* Emergency Contacts */}
                {(holiday.emergencyPhone?.trim() || emergencyContacts.length > 0) && (
                  <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>Đường dây nóng Cấp cứu trực lễ 24/7</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {holiday.emergencyPhone?.trim() && (
                        <a
                          href={`tel:${holiday.emergencyPhone.trim()}`}
                          className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-extrabold inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap"
                        >
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          <span>Trực lễ: {holiday.emergencyPhone.trim()}</span>
                        </a>
                      )}
                      {emergencyContacts.map(ec => (
                        <a
                          key={ec.id}
                          href={`tel:${ec.phone}`}
                          className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-rose-100 dark:hover:bg-rose-950/60 tabular-nums whitespace-nowrap"
                        >
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {ec.phone}
                            {ec.note ? ` · ${ec.note.slice(0, 32)}` : ''}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {!isPreview ? (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowToday}
                onChange={e => setDontShowToday(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span>Không hiện lại hôm nay</span>
            </label>
          ) : (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
              Chế độ xem thử cho Quản trị viên
            </span>
          )}

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {!isPreview && (
              <button
                type="button"
                onClick={() => {
                  onClose(dontShowToday);
                  onGoToDutySchedule();
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Xem Lịch trực 24/7</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onClose(dontShowToday)}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-semibold text-xs transition cursor-pointer whitespace-nowrap shrink-0"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
