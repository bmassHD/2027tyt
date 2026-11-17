import React, { useEffect, useMemo, useState } from 'react';
import {
  Syringe,
  Calendar,
  CalendarPlus,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  Settings,
  Pin,
  Phone,
  Share2,
  Building2,
  Navigation,
  ExternalLink,
  User,
  ChevronDown,
  ChevronUp,
  Compass,
} from 'lucide-react';
import { MapLocation, SystemSettings, VaccinationScheduleItem } from '../../types';
import {
  getActiveVaccinationSchedules,
  formatVaccinationDateRange,
  sortLocationsPrimaryFirst,
  resolveVaccinationLifecycle,
} from '../../services/firebaseService';
import { downloadVaccinationIcs } from '../../utils/calendarUtils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { RevealOnScroll } from '../common/RevealOnScroll';
import { useUserPermissions } from '../../hooks/useUserPermissions';
import { calculateHaversineDistance, estimateDrivingMinutes } from '../portal/StationMapSection';

interface VaccinationViewProps {
  settings: SystemSettings;
  settingsLoaded?: boolean;
  onOpenAdminSetup?: () => void;
  onOpenLocationsSetup?: () => void;
  onNavigateToMap?: () => void;
}

const PROGRAM_LABELS: Record<VaccinationScheduleItem['programType'], string> = {
  expanded: 'Tiêm chủng mở rộng',
  campaign: 'Chiến dịch tiêm chủng',
  service: 'Tiêm chủng dịch vụ',
};

const STATUS_META: Record<
  VaccinationScheduleItem['status'],
  { label: string; textClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  ongoing: {
    label: 'Đang triển khai',
    textClass: 'text-emerald-700 dark:text-emerald-300 font-bold',
    icon: CheckCircle2,
  },
  upcoming: {
    label: 'Sắp diễn ra',
    textClass: 'text-teal-700 dark:text-teal-300 font-bold',
    icon: Clock,
  },
  postponed: {
    label: 'Tạm hoãn',
    textClass: 'text-amber-700 dark:text-amber-300 font-bold',
    icon: PauseCircle,
  },
  completed: {
    label: 'Đã kết thúc',
    textClass: 'text-slate-500 dark:text-slate-400 font-medium',
    icon: CheckCircle2,
  },
};

function buildGoogleMapsHref(loc: {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}): string {
  if (typeof loc.lat === 'number' && typeof loc.lng === 'number' && (loc.lat !== 0 || loc.lng !== 0)) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }
  const q = encodeURIComponent([loc.name, loc.address].filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

interface SiteItem {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  workingHours?: string;
  headName?: string;
  notes?: string;
  lat?: number;
  lng?: number;
  isPrimary: boolean;
}

interface PointScheduleCard {
  cardId: string;
  item: VaccinationScheduleItem;
  displayLocation: string;
  isPrimaryLocation: boolean;
}

function normalizeSiteMatchKey(value?: string): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const VaccinationView: React.FC<VaccinationViewProps> = ({
  settings,
  settingsLoaded = true,
  onOpenAdminSetup,
  onOpenLocationsSetup,
  onNavigateToMap,
}) => {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const { userCoords, requestLocation } = useUserPermissions();

  const [programFilter, setProgramFilter] = useState<'all' | VaccinationScheduleItem['programType']>('all');
  const [onlySitesWithSchedules, setOnlySitesWithSchedules] = useState(false);
  const [expandedSites, setExpandedSites] = useState<Record<string, boolean>>({});
  const [expandedSchedules, setExpandedSchedules] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!userCoords) {
      void requestLocation();
    }
  }, [userCoords, requestLocation]);

  const activeSchedules = useMemo(() => getActiveVaccinationSchedules(settings), [settings]);

  const filteredSchedules = useMemo(() => {
    if (programFilter === 'all') return activeSchedules;
    return activeSchedules.filter(item => item.programType === programFilter);
  }, [activeSchedules, programFilter]);

  // Split schedule items per location (primary location + each secondary location) so each point has its own distinct card
  const expandedScheduleCards = useMemo(() => {
    const list: PointScheduleCard[] = [];

    filteredSchedules.forEach(item => {
      if (item.location) {
        list.push({
          cardId: `${item.id}_primary`,
          item,
          displayLocation: item.location,
          isPrimaryLocation: true,
        });
      }
      (item.secondaryLocations || []).forEach((sec, sIdx) => {
        const cleaned = sec.trim();
        if (cleaned) {
          list.push({
            cardId: `${item.id}_sec_${sIdx}`,
            item,
            displayLocation: cleaned,
            isPrimaryLocation: false,
          });
        }
      });
      if (!item.location && (!item.secondaryLocations || item.secondaryLocations.length === 0)) {
        list.push({
          cardId: `${item.id}_fallback`,
          item,
          displayLocation: 'Trạm Y Tế',
          isPrimaryLocation: true,
        });
      }
    });

    return list;
  }, [filteredSchedules]);

  // Resolve unified Điểm tiêm chính & Các điểm tiêm phụ + embed matching detailed schedules directly per point
  const { unifiedSites, totalSitesCount, nearestSiteId, totalMatchedRounds } = useMemo(() => {
    const sortedMap = sortLocationsPrimaryFirst(settings.mapLocations || []);
    const primaryMapLoc = sortedMap.find(l => l.isPrimary) || sortedMap[0];

    const stationConfiguredName =
      settings.stationName && !settings.stationName.includes('Chưa cấu hình')
        ? settings.stationName
        : 'Trụ sở chính Trạm Y tế';
    const stationConfiguredAddress =
      settings.address && !settings.address.includes('Chưa cập nhật')
        ? settings.address
        : '';
    const stationConfiguredPhone =
      settings.hotline && !settings.hotline.includes('Chưa cập nhật')
        ? settings.hotline
        : '';

    const primary: SiteItem = primaryMapLoc
      ? {
          id: primaryMapLoc.id || 'primary_station',
          name: primaryMapLoc.name,
          address: primaryMapLoc.address || stationConfiguredAddress,
          phone: primaryMapLoc.phone || stationConfiguredPhone || undefined,
          workingHours: primaryMapLoc.workingHours || settings.workingHours || undefined,
          headName: primaryMapLoc.headName || settings.leaderName || undefined,
          notes: primaryMapLoc.notes,
          lat: primaryMapLoc.lat,
          lng: primaryMapLoc.lng,
          isPrimary: true,
        }
      : {
          id: 'primary_station',
          name: stationConfiguredName,
          address: stationConfiguredAddress || 'Chưa cập nhật địa chỉ trụ sở chính',
          phone: stationConfiguredPhone || undefined,
          workingHours:
            settings.workingHours && !settings.workingHours.includes('Chưa cập nhật')
              ? settings.workingHours
              : undefined,
          headName:
            settings.leaderName && !settings.leaderName.includes('Chưa cập nhật')
              ? settings.leaderName
              : undefined,
          isPrimary: true,
        };

    const secondaryMapLocs: MapLocation[] = sortedMap.filter(loc =>
      primaryMapLoc ? loc.id !== primaryMapLoc.id : !loc.isPrimary
    );

    const secondaryList: SiteItem[] = secondaryMapLocs.map(loc => ({
      id: loc.id,
      name: loc.name,
      address: loc.address,
      phone: loc.phone,
      workingHours: loc.workingHours,
      headName: loc.headName,
      notes: loc.notes,
      lat: loc.lat,
      lng: loc.lng,
      isPrimary: false,
    }));

    const baseSites: SiteItem[] = [primary, ...secondaryList];
    const baseSiteKeys = baseSites.map(s => normalizeSiteMatchKey(s.name));

    const findMatchingSiteIndex = (rawLoc: string, isPrimaryLoc: boolean): number => {
      const targetKey = normalizeSiteMatchKey(rawLoc);
      if (targetKey) {
        const exactIdx = baseSiteKeys.findIndex(k => k && k === targetKey);
        if (exactIdx !== -1) return exactIdx;

        const fuzzyIdx = baseSiteKeys.findIndex(
          k => k && (targetKey.includes(k) || k.includes(targetKey))
        );
        if (fuzzyIdx !== -1) return fuzzyIdx;
      }
      if (
        isPrimaryLoc &&
        (targetKey === 'tram y te' || targetKey === 'tru so chinh' || !targetKey)
      ) {
        return 0;
      }
      return -1;
    };

    const perSiteSchedules = new Map<string, PointScheduleCard[]>();
    baseSites.forEach(s => perSiteSchedules.set(s.id, []));

    const dynamicSitesMap = new Map<string, { site: SiteItem; cards: PointScheduleCard[] }>();

    // Also inspect all activeSchedules to ensure secondary sites exist even when filtered out temporarily
    activeSchedules.forEach(sched => {
      (sched.secondaryLocations || []).forEach((rawSite, sIdx) => {
        const cleaned = rawSite.trim();
        if (!cleaned) return;
        const matchedIdx = findMatchingSiteIndex(cleaned, false);
        if (matchedIdx === -1) {
          const key = normalizeSiteMatchKey(cleaned) || `extra_${sched.id}_${sIdx}`;
          if (!dynamicSitesMap.has(key)) {
            dynamicSitesMap.set(key, {
              site: {
                id: `sched_sec_${sched.id}_${sIdx}`,
                name: cleaned,
                notes: `Điểm tiêm triển khai theo lịch: ${sched.title}`,
                isPrimary: false,
              },
              cards: [],
            });
          }
        }
      });
    });

    expandedScheduleCards.forEach(card => {
      const matchedIdx = findMatchingSiteIndex(card.displayLocation, card.isPrimaryLocation);
      if (matchedIdx !== -1) {
        const site = baseSites[matchedIdx];
        const bucket = perSiteSchedules.get(site.id) || [];
        bucket.push(card);
        perSiteSchedules.set(site.id, bucket);
        return;
      }

      const dynKey =
        normalizeSiteMatchKey(card.displayLocation) || `dyn_${card.cardId}`;
      const existingDyn = dynamicSitesMap.get(dynKey);
      if (existingDyn) {
        existingDyn.cards.push(card);
      } else {
        dynamicSitesMap.set(dynKey, {
          site: {
            id: `dyn_site_${card.cardId}`,
            name: card.displayLocation,
            notes: `Điểm tiêm triển khai theo lịch: ${card.item.title}`,
            isPrimary: card.isPrimaryLocation,
          },
          cards: [card],
        });
      }
    });

    const combined: Array<{ site: SiteItem; schedules: PointScheduleCard[] }> = [
      ...baseSites.map(site => ({
        site,
        schedules: perSiteSchedules.get(site.id) || [],
      })),
      ...Array.from(dynamicSitesMap.values()).map(entry => ({
        site: entry.site,
        schedules: entry.cards,
      })),
    ];

    let nearestId: string | null = null;
    let minDistance = Infinity;

    combined.forEach(({ site }) => {
      if (
        userCoords &&
        typeof site.lat === 'number' &&
        typeof site.lng === 'number' &&
        (site.lat !== 0 || site.lng !== 0)
      ) {
        const dist = calculateHaversineDistance(userCoords.lat, userCoords.lng, site.lat, site.lng);
        if (dist < minDistance) {
          minDistance = dist;
          nearestId = site.id;
        }
      }
    });

    return {
      unifiedSites: combined,
      totalSitesCount: combined.length,
      nearestSiteId: nearestId,
      totalMatchedRounds: expandedScheduleCards.length,
    };
  }, [settings, activeSchedules, expandedScheduleCards, userCoords]);

  const visibleSites = useMemo(() => {
    if (!onlySitesWithSchedules) return unifiedSites;
    return unifiedSites.filter(entry => entry.schedules.length > 0);
  }, [unifiedSites, onlySitesWithSchedules]);

  const handleDownloadCalendar = (item: VaccinationScheduleItem) => {
    downloadVaccinationIcs(item, settings.stationName);
    showToast(
      'success',
      'Đã tải tệp lịch (.ics)',
      'Mở tệp vừa tải để lưu lịch vào ứng dụng Lịch trên thiết bị.'
    );
  };

  const handleShareSchedule = async (item: VaccinationScheduleItem, locationName: string) => {
    const station =
      settings.stationName && !settings.stationName.includes('Chưa cấu hình')
        ? settings.stationName
        : 'Trạm Y Tế';
    const text = `[LỊCH TIÊM CHỦNG - ${station}]\n${item.title}\nThời gian: ${formatVaccinationDateRange(item)} (${item.timeRange})\nĐịa điểm: ${locationName}`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: item.title,
          text,
          url: window.location.href,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
      showToast('success', 'Đã sao chép lịch tiêm', 'Bạn có thể dán để chia sẻ qua Zalo hoặc SMS.');
    } catch {
      showToast('info', 'Không thể chia sẻ tự động', 'Vui lòng tải tệp .ics hoặc sao chép địa chỉ trang.');
    }
  };

  if (!settingsLoaded) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-36 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        <div className="h-72 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
      </div>
    );
  }

  const hasHotline = Boolean(settings.hotline && !settings.hotline.includes('Chưa cập nhật'));

  return (
    <div className="space-y-6">
      {/* Institutional Header */}
      <RevealOnScroll immediate>
        <header className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                <span>CHƯƠNG TRÌNH TIÊM CHỦNG MỞ RỘNG</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="tabular-nums">{activeSchedules.length} đợt công bố</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="tabular-nums">{totalSitesCount} điểm tiêm</span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                Mạng Lưới Điểm Tiêm &amp; Lịch Tiêm Chủng Chi Tiết
              </h1>

              <p className="text-sm sm:text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                Tra cứu trực tiếp điểm tiêm chính, điểm tiêm phụ gần bạn nhất cùng danh sách đợt tiêm chủng chi tiết triển khai tại từng điểm.
              </p>
            </div>

            {/* Header Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2.5 shrink-0 self-end lg:self-center">
              {isAdmin && onOpenAdminSetup ? (
                <button
                  type="button"
                  onClick={onOpenAdminSetup}
                  className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm transition inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  <span>Thiết lập lịch</span>
                </button>
              ) : hasHotline ? (
                <a
                  href={`tel:${settings.hotline}`}
                  className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 tabular-nums"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>{settings.hotline}</span>
                </a>
              ) : null}

              {onNavigateToMap && (
                <button
                  type="button"
                  onClick={onNavigateToMap}
                  className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-sm transition inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Navigation className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Bản đồ GPS</span>
                </button>
              )}
            </div>
          </div>
        </header>
      </RevealOnScroll>

      {/* Unified Section: Vaccination Network (Điểm Chính & Điểm Phụ) + Embedded Detailed Rounds per Point */}
      <RevealOnScroll title="Mạng lưới điểm tiêm & Đợt tiêm chi tiết">
        <div aria-labelledby="vaccination-sites-heading" className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Mạng lưới tổ chức &amp; Lịch triển khai theo điểm
              </p>
              <h2
                id="vaccination-sites-heading"
                className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight"
              >
                Địa Điểm Điểm Chính, Điểm Phụ &amp; Đợt Tiêm Chi Tiết
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void requestLocation()}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>{userCoords ? 'Đã cập nhật vị trí GPS' : 'Bật định vị tính khoảng cách'}</span>
              </button>

              {isAdmin && onOpenLocationsSetup && (
                <button
                  type="button"
                  onClick={onOpenLocationsSetup}
                  className="text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Settings className="w-4 h-4" />
                  <span>Quản lý điểm trạm</span>
                </button>
              )}
            </div>
          </div>

          {/* Program Filter Bar + Point Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `Tất cả (${activeSchedules.length})` },
                  {
                    id: 'expanded',
                    label: `Mở rộng (${activeSchedules.filter(s => s.programType === 'expanded').length})`,
                  },
                  {
                    id: 'campaign',
                    label: `Chiến dịch (${activeSchedules.filter(s => s.programType === 'campaign').length})`,
                  },
                  {
                    id: 'service',
                    label: `Dịch vụ (${activeSchedules.filter(s => s.programType === 'service').length})`,
                  },
                ] as const
              ).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setProgramFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 border tabular-nums ${
                    programFilter === tab.id
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeSchedules.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer px-2 py-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0">
                <input
                  type="checkbox"
                  checked={onlySitesWithSchedules}
                  onChange={e => setOnlySitesWithSchedules(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span>Chỉ hiện điểm có đợt tiêm</span>
              </label>
            )}
          </div>

          {activeSchedules.length === 0 && (
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Hiện chưa có đợt tiêm chủng nào được công bố
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  Danh sách các điểm tiêm bên dưới vẫn sẵn sàng chỉ đường &amp; tra cứu liên hệ. Lịch đợt tiêm mới sẽ hiển thị trực tiếp tại từng điểm ngay khi ban hành.
                </p>
              </div>

              {isAdmin && onOpenAdminSetup && (
                <button
                  type="button"
                  onClick={onOpenAdminSetup}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-end sm:self-center"
                >
                  <Settings className="w-4 h-4" />
                  <span>Thiết lập lịch tiêm</span>
                </button>
              )}
            </div>
          )}

          {activeSchedules.length > 0 && totalMatchedRounds === 0 && (
            <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-amber-900 dark:text-amber-200 font-semibold">
                Không có đợt tiêm chủng nào thuộc nhóm đã chọn.
              </span>
              <button
                type="button"
                onClick={() => {
                  setProgramFilter('all');
                  setOnlySitesWithSchedules(false);
                }}
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
              >
                Xem tất cả đợt tiêm
              </button>
            </div>
          )}

          {/* Unified Site Cards with Embedded Schedules */}
          <div className="space-y-4">
            {visibleSites.map(({ site, schedules }, sIdx) => {
              const isSiteExpanded = Boolean(expandedSites[site.id]);
              const isNearest = site.id === nearestSiteId;
              let distanceKm: number | null = null;
              let driveMinutes: number | null = null;

              if (
                userCoords &&
                typeof site.lat === 'number' &&
                typeof site.lng === 'number' &&
                (site.lat !== 0 || site.lng !== 0)
              ) {
                distanceKm = calculateHaversineDistance(
                  userCoords.lat,
                  userCoords.lng,
                  site.lat,
                  site.lng
                );
                driveMinutes = estimateDrivingMinutes(distanceKm);
              }

              return (
                <section
                  key={site.id}
                  className={`rounded-3xl bg-white dark:bg-slate-900 border transition-all shadow-xs overflow-hidden ${
                    isNearest
                      ? 'border-emerald-500 dark:border-emerald-600 ring-2 ring-emerald-500/20'
                      : site.isPrimary
                      ? 'border-emerald-300 dark:border-emerald-800'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {/* Site Header */}
                  <div
                    className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isNearest
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/25'
                        : site.isPrimary
                        ? 'bg-emerald-50/20 dark:bg-emerald-950/15'
                        : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSites(prev => ({ ...prev, [site.id]: !prev[site.id] }))
                      }
                      className="flex items-start sm:items-center gap-3 min-w-0 flex-1 text-left cursor-pointer group"
                    >
                      <span className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold text-xs text-slate-700 dark:text-slate-200 shrink-0">
                        {String(sIdx + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white group-hover:text-emerald-600 transition truncate">
                            {site.name}
                          </h3>
                          {isNearest && (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-700 text-white uppercase tracking-wider shadow-2xs">
                              Điểm gần nhất
                            </span>
                          )}
                          {site.isPrimary ? (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 uppercase tracking-wider">
                              Điểm chính
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                              Điểm phụ
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                              schedules.length > 0
                                ? 'bg-teal-100 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {schedules.length > 0
                              ? `${schedules.length} đợt tiêm`
                              : 'Chưa có đợt'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
                          <span className="truncate">
                            {site.address || 'Bấm để xem thông tin chi tiết điểm tiêm'}
                          </span>
                          {distanceKm !== null && driveMinutes !== null && (
                            <>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                Cách bạn {distanceKm.toFixed(1)}Km, ~{driveMinutes} phút
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <a
                        href={buildGoogleMapsHref(site)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition inline-flex items-center gap-1.5 whitespace-nowrap"
                        title="Mở bản đồ chỉ đường"
                      >
                        <Navigation className="w-3.5 h-3.5 shrink-0" />
                        <span>Bản đồ</span>
                        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                      </a>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSites(prev => ({ ...prev, [site.id]: !prev[site.id] }))
                        }
                        className="px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition inline-flex items-center gap-1 cursor-pointer"
                        aria-label={isSiteExpanded ? 'Thu gọn thông tin điểm tiêm' : 'Xem thông tin điểm tiêm'}
                      >
                        <span className="hidden md:inline">
                          {isSiteExpanded ? 'Ẩn thông tin' : 'Thông tin điểm'}
                        </span>
                        {isSiteExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Site Metadata */}
                  {isSiteExpanded && (
                    <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-slate-100 dark:border-slate-800 animate-in fade-in duration-200 space-y-3 text-sm text-slate-700 dark:text-slate-300 bg-slate-50/40 dark:bg-slate-950/30">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex items-start gap-2.5">
                          <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-xs font-semibold text-slate-400 block">
                              Địa chỉ cụ thể
                            </span>
                            <span className="font-medium">
                              {site.address || 'Đang cập nhật địa chỉ'}
                            </span>
                          </div>
                        </div>

                        {site.workingHours && (
                          <div className="flex items-start gap-2.5">
                            <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="text-xs font-semibold text-slate-400 block">
                                Thời gian tiếp nhận
                              </span>
                              <span className="font-medium tabular-nums">{site.workingHours}</span>
                            </div>
                          </div>
                        )}

                        {site.headName && (
                          <div className="flex items-start gap-2.5">
                            <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="text-xs font-semibold text-slate-400 block">
                                Cán bộ phụ trách
                              </span>
                              <span className="font-medium">{site.headName}</span>
                            </div>
                          </div>
                        )}

                        {site.phone && (
                          <div className="flex items-start gap-2.5">
                            <Phone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="text-xs font-semibold text-slate-400 block">
                                Số điện thoại liên hệ
                              </span>
                              <a
                                href={`tel:${site.phone}`}
                                className="font-bold text-emerald-700 dark:text-emerald-400 hover:underline tabular-nums"
                              >
                                {site.phone}
                              </a>
                            </div>
                          </div>
                        )}
                      </div>

                      {site.notes && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 leading-relaxed">
                          <strong>Ghi chú điểm tiêm: </strong> {site.notes}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Embedded Detailed Vaccination Rounds for THIS Site */}
                  {schedules.length > 0 && (
                    <div className="border-t border-slate-100 dark:border-slate-800 p-3.5 sm:p-5 bg-slate-50/50 dark:bg-slate-950/20 space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Syringe className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Đợt tiêm chủng chi tiết tại điểm này ({schedules.length})</span>
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {schedules.map((card, rIdx) => {
                          const item = card.item;
                          const lifecycle = resolveVaccinationLifecycle(item, nowMs);
                          const statusMeta =
                            STATUS_META[lifecycle.effectiveStatus] || STATUS_META.upcoming;
                          const StatusIcon = statusMeta.icon;
                          const displayDate = formatVaccinationDateRange(item);
                          const displayTime =
                            item.startTime && item.endTime
                              ? `${item.startTime} - ${item.endTime}${
                                  item.timeRange && !item.timeRange.includes(item.startTime)
                                    ? ` · ${item.timeRange}`
                                    : ''
                                }`
                              : item.timeRange;
                          const isLead = rIdx === 0 && Boolean(item.isPinned);
                          const isSchedExpanded = Boolean(expandedSchedules[card.cardId]);

                          return (
                            <article
                              key={card.cardId}
                              className={`rounded-2xl bg-white dark:bg-slate-900 border px-4 py-3 sm:px-4.5 sm:py-3.5 shadow-2xs transition-all ${
                                isLead
                                  ? 'border-emerald-300 dark:border-emerald-700'
                                  : 'border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/80">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                  {item.isPinned && (
                                    <Pin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  )}
                                  <span className={`inline-flex items-center gap-1 ${statusMeta.textClass}`}>
                                    <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                                    <span>{statusMeta.label}</span>
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700">·</span>
                                  <span className="font-bold text-emerald-800 dark:text-emerald-300">
                                    {PROGRAM_LABELS[item.programType]}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadCalendar(item)}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 text-[11px] font-semibold transition inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                                    title="Lưu tệp lịch (.ics)"
                                  >
                                    <CalendarPlus className="w-3 h-3 shrink-0" />
                                    <span>Lưu lịch</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleShareSchedule(item, card.displayLocation)}
                                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-[11px] font-semibold transition inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                                    title="Chia sẻ lịch"
                                  >
                                    <Share2 className="w-3 h-3 shrink-0" />
                                    <span className="hidden sm:inline">Chia sẻ</span>
                                  </button>
                                </div>
                              </div>

                              <div className="pt-2.5 space-y-1.5">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                                    {item.title}
                                  </h4>
                                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums inline-flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                                    <span>{displayDate}</span>
                                  </span>
                                </div>

                                {card.displayLocation &&
                                  normalizeSiteMatchKey(card.displayLocation) !==
                                    normalizeSiteMatchKey(site.name) && (
                                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                                      <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                      <span>{card.displayLocation}</span>
                                    </div>
                                  )}

                                <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedSchedules(prev => ({
                                        ...prev,
                                        [card.cardId]: !prev[card.cardId],
                                      }))
                                    }
                                    aria-expanded={isSchedExpanded}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 text-xs font-bold text-emerald-700 dark:text-emerald-400 transition cursor-pointer"
                                  >
                                    <Clock className="w-3.5 h-3.5 shrink-0" />
                                    <span>{isSchedExpanded ? 'Ẩn giờ tiêm' : 'Xem thêm giờ tiêm'}</span>
                                    {isSchedExpanded ? (
                                      <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {isSchedExpanded && (
                                <div className="mt-2.5 p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 animate-in fade-in duration-150 space-y-1.5 text-xs">
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 tabular-nums">
                                      <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      <span>
                                        Ngày tiêm: <strong>{displayDate}</strong>
                                      </span>
                                    </div>
                                    {displayTime && (
                                      <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 tabular-nums">
                                        <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                        <span>
                                          Giờ tiêm: <strong>{displayTime}</strong>
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  {item.targetAudience && (
                                    <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
                                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                      <span>
                                        <strong>Đối tượng:</strong> {item.targetAudience}
                                      </span>
                                    </div>
                                  )}
                                  {item.vaccines && (
                                    <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
                                      <Syringe className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                      <span>
                                        <strong>Vắc-xin:</strong> {item.vaccines}
                                      </span>
                                    </div>
                                  )}
                                  {item.notes && (
                                    <div className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                                      <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                      <span>{item.notes}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </RevealOnScroll>
    </div>
  );
};

