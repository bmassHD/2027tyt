import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Syringe,
  Calendar,
  MapPin,
  ArrowRight,
  Clock,
} from 'lucide-react';
import {
  SystemSettings,
  VaccinationScheduleItem,
  VaccinationStartupPopupConfig,
} from '../../types';
import {
  getActiveVaccinationSchedules,
  formatVaccinationDateRange,
  resolveVaccinationLifecycle,
} from '../../services/firebaseService';

interface VaccinationStartupPopupModalProps {
  settings: SystemSettings;
  settingsLoaded: boolean;
  blockedByMaintenance?: boolean;
  pauseForOtherPopup?: boolean;
  onVisibilityChange?: (isOpen: boolean) => void;
  onNavigateToView: (view: string) => void;
}

interface PopupVaccinationPoint {
  key: string;
  schedule: VaccinationScheduleItem;
  locationName: string;
  effectiveStatus: VaccinationScheduleItem['status'];
  dateText: string;
  timeText: string;
}

const STATUS_BADGE_MAP: Record<
  VaccinationScheduleItem['status'],
  { label: string; className: string }
> = {
  ongoing: {
    label: 'Đang triển khai',
    className:
      'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 animate-pulse',
  },
  upcoming: {
    label: 'Sắp diễn ra',
    className:
      'bg-emerald-100/90 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  },
  completed: {
    label: 'Đã kết thúc',
    className:
      'bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  },
  postponed: {
    label: 'Tạm hoãn',
    className:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  },
};

function getVietnamTodayKey(): string {
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

export const VaccinationStartupPopupModal: React.FC<VaccinationStartupPopupModalProps> = ({
  settings,
  settingsLoaded,
  blockedByMaintenance = false,
  pauseForOtherPopup = false,
  onVisibilityChange,
  onNavigateToView,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowToday, setDontShowToday] = useState(false);
  const [handledKey, setHandledKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    onVisibilityChange?.(isOpen);
  }, [isOpen, onVisibilityChange]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  const vacPopupCfg: VaccinationStartupPopupConfig = useMemo(() => {
    if (settings.vaccinationPopup) {
      return settings.vaccinationPopup;
    }
    return {
      enabled: settings.startupPopup?.includeTopVaccination !== false,
      title: 'Thông Báo Tiêm Chủng',
      message: '',
      ctaLabel: 'Xem lịch tiêm chủng',
      frequency: settings.startupPopup?.frequency || 'per_session',
    };
  }, [settings.vaccinationPopup, settings.startupPopup]);

  const activeSchedules = useMemo(
    () => getActiveVaccinationSchedules(settings),
    [settings]
  );

  const popupPoints = useMemo<PopupVaccinationPoint[]>(() => {
    if (!vacPopupCfg.enabled || activeSchedules.length === 0) return [];
    const todayKey = getVietnamTodayKey();

    const prioritized = activeSchedules.filter(item => {
      const lc = resolveVaccinationLifecycle(item, nowMs);
      if (lc.effectiveStatus === 'ongoing' || lc.effectiveStatus === 'upcoming') {
        return true;
      }
      return (
        item.date === todayKey ||
        (item.endDate ? item.endDate >= todayKey && item.date <= todayKey : false)
      );
    });

    const sourceList = prioritized.length > 0 ? prioritized : activeSchedules;
    const points: PopupVaccinationPoint[] = [];

    sourceList.forEach(item => {
      const lc = resolveVaccinationLifecycle(item, nowMs);
      const dateText = formatVaccinationDateRange(item);
      const timeText =
        item.startTime && item.endTime
          ? `${item.startTime} - ${item.endTime}`
          : item.timeRange || '07:00 - 11:00';

      if (item.location) {
        points.push({
          key: `${item.id}_primary`,
          schedule: item,
          locationName: item.location,
          effectiveStatus: lc.effectiveStatus,
          dateText,
          timeText,
        });
      }

      (item.secondaryLocations || []).forEach((sec, idx) => {
        const cleaned = sec.trim();
        if (cleaned) {
          points.push({
            key: `${item.id}_sec_${idx}`,
            schedule: item,
            locationName: cleaned,
            effectiveStatus: lc.effectiveStatus,
            dateText,
            timeText,
          });
        }
      });

      if (!item.location && (!item.secondaryLocations || item.secondaryLocations.length === 0)) {
        points.push({
          key: `${item.id}_fallback`,
          schedule: item,
          locationName: 'Trạm Y Tế',
          effectiveStatus: lc.effectiveStatus,
          dateText,
          timeText,
        });
      }
    });

    return points;
  }, [vacPopupCfg.enabled, activeSchedules, nowMs]);

  const leadPoint = popupPoints[0];
  const hasContent = vacPopupCfg.enabled !== false && popupPoints.length > 0;

  const contentSignature = useMemo(() => {
    const pointSig = popupPoints
      .map(p => `${p.key}:${p.schedule.updatedAt || p.schedule.date}`)
      .join(',');
    const parts = [
      'vaccination',
      vacPopupCfg.updatedAt || '',
      vacPopupCfg.title || '',
      (vacPopupCfg.message || '').slice(0, 80),
      vacPopupCfg.ctaLabel || '',
      pointSig,
    ];
    return parts.join('|');
  }, [
    vacPopupCfg.updatedAt,
    vacPopupCfg.title,
    vacPopupCfg.message,
    vacPopupCfg.ctaLabel,
    popupPoints,
  ]);

  useEffect(() => {
    if (!settingsLoaded || blockedByMaintenance || pauseForOtherPopup) return;
    if (vacPopupCfg.enabled === false || !hasContent) return;

    const todayKey = getVietnamTodayKey();
    const dismissDayKey = `tyt_vac_popup_dismissed_day_${todayKey}`;
    const dailySeenKey = `tyt_vac_popup_seen_day_${todayKey}`;
    const sessionSeenKey = 'tyt_vac_popup_seen_session';
    const frequency = vacPopupCfg.frequency || 'per_session';

    try {
      if (localStorage.getItem(dismissDayKey) === contentSignature) {
        return;
      }
      if (frequency === 'daily' && localStorage.getItem(dailySeenKey) === contentSignature) {
        return;
      }
      if (frequency === 'per_session' && sessionStorage.getItem(sessionSeenKey) === contentSignature) {
        return;
      }
    } catch {
      // Ignore storage access errors
    }

    if (handledKey === contentSignature) return;

    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
      setIsOpen(true);
      setHandledKey(contentSignature);
      try {
        if (frequency === 'daily') {
          localStorage.setItem(dailySeenKey, contentSignature);
        } else if (frequency === 'per_session') {
          sessionStorage.setItem(sessionSeenKey, contentSignature);
        }
      } catch {
        // Ignore storage errors
      }
    }, 520);

    return () => window.clearTimeout(timer);
  }, [
    settingsLoaded,
    blockedByMaintenance,
    pauseForOtherPopup,
    vacPopupCfg.enabled,
    vacPopupCfg.frequency,
    hasContent,
    contentSignature,
    handledKey,
  ]);

  const handleClose = () => {
    if (dontShowToday) {
      const todayKey = getVietnamTodayKey();
      try {
        localStorage.setItem(`tyt_vac_popup_dismissed_day_${todayKey}`, contentSignature);
      } catch {
        // Ignore storage errors
      }
    }
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen || !hasContent || !leadPoint) return null;

  const isStationConfigured =
    settings.stationName && !settings.stationName.includes('Chưa cấu hình');
  const modalTitle = vacPopupCfg.title?.trim() || 'Thông Báo Tiêm Chủng';
  const customIntro = vacPopupCfg.message?.trim() || '';
  const ctaLabel = vacPopupCfg.ctaLabel?.trim() || 'Xem lịch tiêm chủng';

  const uniqueTitles = Array.from(new Set(popupPoints.map(p => p.schedule.title.trim())));
  const hasSharedTitle = uniqueTitles.length === 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vaccination-startup-popup-title"
      className="fixed inset-0 z-[121] flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={`bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-h-[92vh] flex flex-col overflow-hidden ${
          popupPoints.length >= 3 ? 'max-w-xl' : 'max-w-lg'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 shrink-0 bg-emerald-700 text-white flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-2xl bg-white/95 shrink-0 shadow-xs">
              <Syringe className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-100">
                <Syringe className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Tiêm chủng mở rộng
                  {isStationConfigured ? ` · ${settings.stationName}` : ''}
                </span>
              </div>
              <h2
                id="vaccination-startup-popup-title"
                className="text-base sm:text-lg font-extrabold leading-snug text-white mt-0.5 truncate"
              >
                {modalTitle}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Đóng thông báo tiêm chủng"
            className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 min-h-0">
          {customIntro && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-line">
              {customIntro}
            </div>
          )}

          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-950/25 p-3.5 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                <Syringe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Lịch tiêm chủng</span>
              </span>

              {popupPoints.length >= 2 ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 tabular-nums">
                  {popupPoints.length} điểm tiêm
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    STATUS_BADGE_MAP[leadPoint.effectiveStatus].className
                  }`}
                >
                  {STATUS_BADGE_MAP[leadPoint.effectiveStatus].label}
                </span>
              )}
            </div>

            {popupPoints.length === 1 ? (
              <>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                  {leadPoint.schedule.title}
                </h3>

                <div className="p-3 rounded-xl bg-white dark:bg-slate-900/80 border border-emerald-100 dark:border-emerald-900/50 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold text-slate-900 dark:text-white">
                      {leadPoint.dateText}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                      {leadPoint.timeText}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate font-semibold">{leadPoint.locationName}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {hasSharedTitle && (
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                    {uniqueTitles[0]}
                  </h3>
                )}

                <div className="space-y-1.5">
                  {popupPoints.map(point => {
                    const badge = STATUS_BADGE_MAP[point.effectiveStatus];
                    return (
                      <div
                        key={point.key}
                        className="p-2.5 sm:px-3 sm:py-2.5 rounded-xl bg-white dark:bg-slate-900/85 border border-emerald-100 dark:border-emerald-900/50 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 font-bold text-slate-900 dark:text-white">
                            <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="truncate">{point.locationName}</span>
                          </div>
                          <span
                            className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </div>

                        {!hasSharedTitle && (
                          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate pl-5">
                            {point.schedule.title}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 pl-5 tabular-nums">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200">
                            <Calendar className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            <span>{point.dateText}</span>
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                            <Clock className="w-3 h-3" />
                            <span>{point.timeText}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                handleClose();
                onNavigateToView('vaccination');
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm transition inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <span>{ctaLabel}</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 shrink-0 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowToday}
              onChange={e => setDontShowToday(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>Không hiện lại hôm nay</span>
          </label>

          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-semibold text-xs transition cursor-pointer whitespace-nowrap shrink-0"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
