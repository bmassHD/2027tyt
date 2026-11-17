import React, { useMemo, useState } from 'react';
import {
  PartyPopper,
  Calendar,
  Clock,
  MapPin,
  Search,
  Sparkles,
  HeartHandshake,
  Repeat,
  BellRing,
  Settings,
  X,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { StationEvent, SystemSettings } from '../../types';
import {
  formatIsoDateVN,
  getVietnamTodayKey,
  resolveEventStatus,
  sortStationEvents,
} from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { EventsManager } from '../admin/EventsManager';
import {
  exportEventsToExcel,
  parseEventsExcelFile,
  ParsedEventImportRow,
} from '../../utils/eventExcelUtils';
import { EventImportModal } from '../modals/EventImportModal';

interface EventsViewProps {
  events: StationEvent[];
  settings: SystemSettings;
  onPreviewEvent: (ev: StationEvent) => void;
}

const CATEGORY_META: Record<
  StationEvent['category'],
  { label: string; badgeClass: string }
> = {
  health_day: {
    label: 'Ngày lễ ngành Y tế',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
  },
  celebration: {
    label: 'Lễ kỷ niệm',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
  },
  community: {
    label: 'Sự kiện cộng đồng',
    badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300',
  },
  campaign: {
    label: 'Chiến dịch y tế',
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
  },
  holiday: {
    label: 'Ngày lễ lớn',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300',
  },
  other: {
    label: 'Sự kiện khác',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

export const EventsView: React.FC<EventsViewProps> = ({
  events,
  settings,
  onPreviewEvent,
}) => {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [filterMode, setFilterMode] = useState<'all' | 'today' | 'upcoming' | 'past'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdminManager, setShowAdminManager] = useState(false);
  const [parsingExcel, setParsingExcel] = useState(false);
  const [importRows, setImportRows] = useState<ParsedEventImportRow[] | null>(null);

  const todayKey = getVietnamTodayKey();
  const isConfigured =
    Boolean(settings.stationName) && !settings.stationName.includes('Chưa cấu hình');

  const visibleEvents = useMemo(() => {
    const activeOnly = events.filter(ev => ev.isActive !== false);
    return sortStationEvents(activeOnly, todayKey);
  }, [events, todayKey]);

  const todayEvents = useMemo(
    () => visibleEvents.filter(ev => resolveEventStatus(ev, todayKey).status === 'today'),
    [visibleEvents, todayKey]
  );

  const upcomingCount = useMemo(
    () => visibleEvents.filter(ev => resolveEventStatus(ev, todayKey).status === 'upcoming').length,
    [visibleEvents, todayKey]
  );

  const pastCount = useMemo(
    () => visibleEvents.filter(ev => resolveEventStatus(ev, todayKey).status === 'past').length,
    [visibleEvents, todayKey]
  );

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visibleEvents.filter(ev => {
      const st = resolveEventStatus(ev, todayKey).status;
      if (filterMode !== 'all' && st !== filterMode) return false;
      if (!q) return true;
      return (
        ev.title.toLowerCase().includes(q) ||
        ev.description.toLowerCase().includes(q) ||
        (ev.greetingMessage || '').toLowerCase().includes(q) ||
        (ev.location || '').toLowerCase().includes(q)
      );
    });
  }, [visibleEvents, filterMode, searchQuery, todayKey]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page Header */}
      <div
        data-section-title="Sự kiện & Ngày lễ"
        className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-50 to-emerald-50 dark:from-amber-950/60 dark:to-emerald-950/60 text-amber-600 dark:text-amber-400 shrink-0 border border-amber-200/70 dark:border-amber-800/50">
            <PartyPopper className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Sự Kiện &amp; Ngày Lễ {isConfigured ? `· ${settings.stationName}` : ''}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Theo dõi các sự kiện, ngày kỷ niệm ngành Y tế và hoạt động cộng đồng.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {visibleEvents.length > 0 && (
            <button
              type="button"
              onClick={() => {
                exportEventsToExcel(visibleEvents);
                showToast('success', `Đã xuất ${visibleEvents.length} sự kiện ra Excel`);
              }}
              className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Xuất Excel</span>
            </button>
          )}

          {isAdmin && (
            <label className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
              <Upload className="w-4 h-4" />
              <span>{parsingExcel ? 'Đang đọc...' : 'Import Excel'}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={parsingExcel}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setParsingExcel(true);
                  try {
                    const parsed = await parseEventsExcelFile(file, events);
                    setImportRows(parsed);
                  } catch (err: any) {
                    showToast(
                      'error',
                      'Không thể đọc file Excel',
                      err?.message || 'Vui lòng kiểm tra định dạng file Excel.'
                    );
                  } finally {
                    setParsingExcel(false);
                  }
                }}
                className="hidden"
              />
            </label>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAdminManager(v => !v)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap border ${
                showAdminManager
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-700'
              }`}
            >
              {showAdminManager ? <X className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
              <span>{showAdminManager ? 'Đóng quản lý' : 'Quản lý / Setup sự kiện'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Admin Setup Section */}
      {isAdmin && showAdminManager && (
        <div className="p-4 sm:p-6 rounded-3xl bg-slate-100/80 dark:bg-slate-950/60 border border-emerald-200 dark:border-emerald-900/60">
          <EventsManager events={events} onPreviewEvent={onPreviewEvent} />
        </div>
      )}

      {/* Today's Featured Event Celebration Banner */}
      {todayEvents.length > 0 && (
        <div className="rounded-3xl bg-gradient-to-r from-emerald-700 via-teal-700 to-amber-600 p-6 text-white shadow-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-white/20 text-xs font-extrabold uppercase tracking-wider">
              <PartyPopper className="w-4 h-4 text-amber-200" />
              <span>Đang diễn ra hôm nay · {formatIsoDateVN(todayKey)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {todayEvents.map(ev => (
              <div
                key={ev.id}
                className="p-4 rounded-2xl bg-white/12 backdrop-blur-xs border border-white/20 space-y-2"
              >
                <h2 className="text-lg sm:text-xl font-extrabold text-white">{ev.title}</h2>
                <p className="text-xs sm:text-sm text-emerald-50 leading-relaxed whitespace-pre-line">
                  {ev.description}
                </p>
                {ev.greetingMessage?.trim() && (
                  <div className="p-3 rounded-xl bg-white/15 border border-amber-200/40 text-xs sm:text-sm text-amber-50 flex items-start gap-2">
                    <HeartHandshake className="w-4 h-4 text-amber-200 shrink-0 mt-0.5" />
                    <span className="italic font-semibold">“{ev.greetingMessage.trim()}”</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: `Tất cả (${visibleEvents.length})` },
            { id: 'today', label: `Hôm nay (${todayEvents.length})` },
            { id: 'upcoming', label: `Sắp tới (${upcomingCount})` },
            { id: 'past', label: `Đã qua (${pastCount})` },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id as typeof filterMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm tên sự kiện, địa điểm..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Events Grid */}
      {filteredEvents.length === 0 ? (
        <div className="p-12 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <Calendar className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            Chưa có sự kiện nào phù hợp
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAdmin
              ? 'Nhấn "Quản lý / Setup sự kiện" ở phía trên để thêm lịch sự kiện mới.'
              : 'Lịch sự kiện và ngày lễ của Trạm Y tế sẽ sớm được cập nhật tại đây.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredEvents.map(ev => {
            const st = resolveEventStatus(ev, todayKey);
            const cat = CATEGORY_META[ev.category] || CATEGORY_META.other;
            const dateRangeText =
              ev.endDate && ev.endDate > ev.eventDate
                ? `${formatIsoDateVN(ev.eventDate)} - ${formatIsoDateVN(ev.endDate)}`
                : formatIsoDateVN(ev.eventDate);

            return (
              <article
                key={ev.id}
                className={`p-5 rounded-3xl bg-white dark:bg-slate-900 border shadow-xs flex flex-col justify-between gap-4 transition ${
                  st.status === 'today'
                    ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-400/25'
                    : 'border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${cat.badgeClass}`}>
                      {cat.label}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {ev.isAnnual && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          <Repeat className="w-3 h-3" />
                          <span>Hằng năm</span>
                        </span>
                      )}

                      {st.status === 'today' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 animate-pulse">
                          <PartyPopper className="w-3 h-3" />
                          <span>Hôm nay</span>
                        </span>
                      ) : st.status === 'upcoming' ? (
                        <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 tabular-nums">
                          Còn {st.daysUntil} ngày
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          Đã diễn ra
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                    {ev.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{dateRangeText}</span>
                    </span>
                    {(ev.startTime || ev.endTime) && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-teal-600" />
                        <span>
                          {ev.startTime || '--:--'}
                          {ev.endTime ? ` - ${ev.endTime}` : ''}
                        </span>
                      </span>
                    )}
                    {ev.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-rose-500" />
                        <span>{ev.location}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                    {ev.description}
                  </p>

                  {ev.greetingMessage?.trim() && (
                    <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                      <HeartHandshake className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <p className="italic leading-relaxed">“{ev.greetingMessage.trim()}”</p>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-3">
                    {ev.enableAutoPopup && (
                      <span className="inline-flex items-center gap-1">
                        <BellRing className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Thông báo tự động</span>
                      </span>
                    )}
                    {ev.enableConfetti && (
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Chúc mừng</span>
                      </span>
                    )}
                  </div>

                  {(st.status === 'today' || isAdmin) && (
                    <button
                      type="button"
                      onClick={() => onPreviewEvent(ev)}
                      className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <PartyPopper className="w-3.5 h-3.5" />
                      <span>{st.status === 'today' ? 'Xem chi tiết' : 'Xem thử'}</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {/* Excel Import Preview Modal */}
      {importRows && (
        <EventImportModal rows={importRows} onClose={() => setImportRows(null)} />
      )}
    </div>
  );
};
