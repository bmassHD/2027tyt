import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ArrowRight,
  Bell,
  ShieldAlert,
  CalendarClock,
  Megaphone,
} from 'lucide-react';
import { StartupPopupConfig, SystemSettings } from '../../types';
import { StationLogo } from '../common/StationLogo';

interface StartupPopupModalProps {
  settings: SystemSettings;
  settingsLoaded: boolean;
  blockedByMaintenance?: boolean;
  pauseForEventPopup?: boolean;
  onVisibilityChange?: (isOpen: boolean) => void;
  onNavigateToView: (view: string) => void;
}

const NOTICE_TYPE_STYLES: Record<
  NonNullable<StartupPopupConfig['noticeType']>,
  {
    kicker: string;
    headerBg: string;
    kickerText: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  general: {
    kicker: 'Thông báo chung',
    headerBg: 'bg-emerald-700',
    kickerText: 'text-emerald-100',
    icon: Megaphone,
  },
  epidemic: {
    kicker: 'Phòng chống dịch bệnh',
    headerBg: 'bg-amber-700',
    kickerText: 'text-amber-100',
    icon: ShieldAlert,
  },
  schedule: {
    kicker: 'Lịch khám & Hoạt động trạm',
    headerBg: 'bg-teal-700',
    kickerText: 'text-teal-100',
    icon: CalendarClock,
  },
  urgent: {
    kicker: 'Thông báo khẩn · Quan trọng',
    headerBg: 'bg-rose-700',
    kickerText: 'text-rose-100',
    icon: Bell,
  },
};

const CTA_DEFAULT_LABELS: Record<string, string> = {
  news: 'Xem Bảng tin y tế',
  duty: 'Xem Lịch trực 24/7',
  documents: 'Xem Văn bản & Biểu mẫu',
  map: 'Xem Bản đồ điểm trạm',
  vaccination: 'Xem Lịch tiêm chủng',
  events: 'Xem Sự kiện & Ngày lễ',
  nearby_facilities: 'Xem Cơ sở Y tế lân cận',
  rescue: 'Mở Bản đồ Cứu hộ SOS',
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

export const StartupPopupModal: React.FC<StartupPopupModalProps> = ({
  settings,
  settingsLoaded,
  blockedByMaintenance = false,
  pauseForEventPopup = false,
  onVisibilityChange,
  onNavigateToView,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowToday, setDontShowToday] = useState(false);
  const [handledKey, setHandledKey] = useState<string | null>(null);

  useEffect(() => {
    onVisibilityChange?.(isOpen);
  }, [isOpen, onVisibilityChange]);

  const popupCfg: StartupPopupConfig = settings.startupPopup || {
    enabled: true,
    noticeType: 'general',
    title: 'Thông báo từ Trạm Y Tế',
    message: '',
    ctaView: 'none',
    frequency: 'per_session',
  };

  const displayNotice = popupCfg.message?.trim() || '';
  const hasContent = Boolean(displayNotice);

  const noticeType = popupCfg.noticeType || 'general';
  const typeMeta = NOTICE_TYPE_STYLES[noticeType] || NOTICE_TYPE_STYLES.general;
  const TypeIcon = typeMeta.icon;

  const ctaView = popupCfg.ctaView && popupCfg.ctaView !== 'none' ? popupCfg.ctaView : undefined;
  const ctaLabel =
    popupCfg.ctaLabel?.trim() || (ctaView ? CTA_DEFAULT_LABELS[ctaView] || 'Xem chi tiết' : '');

  const contentSignature = useMemo(() => {
    const parts = [
      'general',
      popupCfg.updatedAt || '',
      noticeType,
      popupCfg.title || '',
      displayNotice.slice(0, 120),
      ctaView || 'none',
    ];
    return parts.join('|');
  }, [popupCfg.updatedAt, noticeType, popupCfg.title, displayNotice, ctaView]);

  useEffect(() => {
    if (!settingsLoaded || blockedByMaintenance || pauseForEventPopup) return;
    if (popupCfg.enabled === false || !hasContent) return;

    const todayKey = getVietnamTodayKey();
    const dismissDayKey = `tyt_general_popup_dismissed_day_${todayKey}`;
    const dailySeenKey = `tyt_general_popup_seen_day_${todayKey}`;
    const sessionSeenKey = 'tyt_general_popup_seen_session';
    const frequency = popupCfg.frequency || 'per_session';

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
      // Ignore storage access errors in restricted frames
    }

    if (handledKey === contentSignature) return;

    const timer = window.setTimeout(() => {
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
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    settingsLoaded,
    blockedByMaintenance,
    pauseForEventPopup,
    popupCfg.enabled,
    popupCfg.frequency,
    hasContent,
    contentSignature,
    handledKey,
  ]);

  const handleClose = () => {
    if (dontShowToday) {
      const todayKey = getVietnamTodayKey();
      try {
        localStorage.setItem(`tyt_general_popup_dismissed_day_${todayKey}`, contentSignature);
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

  if (!isOpen || !hasContent) return null;

  const isStationConfigured =
    settings.stationName && !settings.stationName.includes('Chưa cấu hình');
  const modalTitle = popupCfg.title?.trim() || 'Thông báo từ Trạm Y Tế';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-popup-title"
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className={`px-5 py-3.5 shrink-0 ${typeMeta.headerBg} text-white flex items-start justify-between gap-3`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-2xl bg-white/95 shrink-0 shadow-xs">
              <StationLogo size={32} />
            </div>
            <div className="min-w-0">
              <div
                className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${typeMeta.kickerText}`}
              >
                <TypeIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {typeMeta.kicker}
                  {isStationConfigured ? ` · ${settings.stationName}` : ''}
                </span>
              </div>
              <h2
                id="startup-popup-title"
                className="text-base sm:text-lg font-extrabold leading-snug text-white mt-0.5 truncate"
              >
                {modalTitle}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Đóng thông báo bình thường"
            className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 min-h-0">
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-line">
            {displayNotice}
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

          <div className="flex items-center gap-2">
            {ctaView && (
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onNavigateToView(ctaView);
                }}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-semibold text-xs transition inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>{ctaLabel}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}

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
    </div>
  );
};
