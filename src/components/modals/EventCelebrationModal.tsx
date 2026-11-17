import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  PartyPopper,
  Calendar,
  Clock,
  MapPin,
  Sparkles,
  HeartHandshake,
  ArrowRight,
  Repeat,
} from 'lucide-react';
import { StationEvent, SystemSettings } from '../../types';
import { formatIsoDateVN, getVietnamTodayKey } from '../../services/firebaseService';
import { StationLogo } from '../common/StationLogo';

interface EventCelebrationModalProps {
  events: StationEvent[];
  isOpen: boolean;
  isPreview?: boolean;
  settings: SystemSettings;
  onClose: (dontShowToday: boolean) => void;
  onGoToEventsTab: () => void;
}

const CATEGORY_LABELS: Record<StationEvent['category'], string> = {
  health_day: 'Ngày lễ ngành Y tế',
  celebration: 'Lễ kỷ niệm',
  community: 'Sự kiện cộng đồng',
  campaign: 'Chiến dịch sức khỏe',
  holiday: 'Ngày lễ lớn',
  other: 'Sự kiện đặc biệt',
};

export const EventCelebrationModal: React.FC<EventCelebrationModalProps> = ({
  events,
  isOpen,
  isPreview = false,
  settings,
  onClose,
  onGoToEventsTab,
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

  if (!isOpen || events.length === 0 || typeof document === 'undefined') return null;

  const isConfigured =
    Boolean(settings.stationName) && !settings.stationName.includes('Chưa cấu hình');
  const stationTitle = isConfigured ? settings.stationName : 'Trạm Y Tế';
  const todayVN = formatIsoDateVN(getVietnamTodayKey());

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-celebration-title"
      className="fixed inset-0 z-[135] flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose(dontShowToday);
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-200/80 dark:border-amber-800/60 shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Festive Gradient Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-emerald-700 via-teal-700 to-amber-600 text-white flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-2xl bg-white/95 shrink-0 shadow-xs">
              <StationLogo size={34} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-100">
                <PartyPopper className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {isPreview ? 'Xem trước thông báo sự kiện' : `Sự kiện hôm nay · ${todayVN}`}
                </span>
              </div>
              <h2
                id="event-celebration-title"
                className="text-base sm:text-lg font-extrabold leading-snug text-white mt-0.5 truncate"
              >
                {events.length === 1 ? events[0].title : `${events.length} Sự Kiện Đặc Biệt Hôm Nay`}
              </h2>
              <p className="text-[11px] text-emerald-100/90 truncate">{stationTitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClose(dontShowToday)}
            aria-label="Đóng thông báo sự kiện"
            className="p-1.5 rounded-xl text-white/85 hover:text-white hover:bg-white/15 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {events.map(ev => {
            const dateDisplay =
              ev.endDate && ev.endDate > ev.eventDate
                ? `${formatIsoDateVN(ev.eventDate)} - ${formatIsoDateVN(ev.endDate)}`
                : formatIsoDateVN(ev.eventDate);
            const timeDisplay =
              ev.startTime && ev.endTime
                ? `${ev.startTime} - ${ev.endTime}`
                : ev.startTime || '';

            return (
              <div
                key={ev.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>{CATEGORY_LABELS[ev.category] || 'Sự kiện'}</span>
                  </span>

                  <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                    {ev.isAnnual && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300">
                        <Repeat className="w-3 h-3" />
                        <span>Hằng năm</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{dateDisplay}</span>
                    </span>
                  </div>
                </div>

                {events.length > 1 && (
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                    {ev.title}
                  </h3>
                )}

                {(timeDisplay || ev.location) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    {timeDisplay && (
                      <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-teal-600" />
                        <span>{timeDisplay}</span>
                      </span>
                    )}
                    {ev.location && (
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <MapPin className="w-3.5 h-3.5 text-rose-500" />
                        <span>{ev.location}</span>
                      </span>
                    )}
                  </div>
                )}

                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                  {ev.description}
                </p>

                {ev.greetingMessage?.trim() && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-amber-50 via-rose-50/60 to-emerald-50 dark:from-amber-950/40 dark:via-rose-950/30 dark:to-emerald-950/40 border border-amber-200 dark:border-amber-800/70 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      <HeartHandshake className="w-4 h-4 text-rose-500 shrink-0" />
                      <span>Lời chúc mừng nhân ngày sự kiện</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-line italic">
                      “{ev.greetingMessage.trim()}”
                    </p>
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
                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
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
                  onGoToEventsTab();
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <span>Xem tab Sự kiện</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onClose(dontShowToday)}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-semibold text-xs transition cursor-pointer whitespace-nowrap"
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
