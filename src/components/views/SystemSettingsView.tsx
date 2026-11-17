import React, { useState } from 'react';
import {
  Bell,
  MapPin,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Navigation,
  Send,
  ArrowRight,
  Info,
  Smartphone,
  Share2,
  Download,
  Wifi,
  WifiOff,
  ExternalLink,
} from 'lucide-react';
import { SystemSettings } from '../../types';
import { SoftwareTeamContactCard } from '../common/SoftwareTeamContactCard';
import { useUserPermissions } from '../../hooks/useUserPermissions';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../contexts/ToastContext';
import {
  isDeviceNotificationEnabled,
  setDeviceNotificationEnabled,
  triggerDeviceSystemNotification,
} from '../../services/systemNotificationService';
import {
  calculateHaversineDistance,
  estimateDrivingMinutes,
} from '../portal/StationMapSection';

interface SystemSettingsViewProps {
  settings: SystemSettings;
  setCurrentView: (view: string) => void;
}

const LOCATION_PREF_KEY = 'tyt_device_location_enabled_v1';

function loadLocationPref(): boolean {
  try {
    return localStorage.getItem(LOCATION_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  settings,
  setCurrentView,
}) => {
  const {
    locationStatus,
    notificationStatus,
    userCoords,
    requestLocation,
    requestNotification,
  } = useUserPermissions();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const { showToast } = useToast();

  const [notifEnabled, setNotifEnabled] = useState<boolean>(isDeviceNotificationEnabled);
  const [locationPref, setLocationPref] = useState<boolean>(loadLocationPref);
  const [locating, setLocating] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);

  const notifSupported = typeof window !== 'undefined' && 'Notification' in window;
  const geoSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const handleToggleNotifPref = () => {
    const next = !notifEnabled;
    setNotifEnabled(next);
    setDeviceNotificationEnabled(next);
    showToast(
      'info',
      next ? 'Đã bật nhận cảnh báo thiết bị' : 'Đã tắt nhận cảnh báo thiết bị'
    );
  };

  const handleRequestNotification = async () => {
    const granted = await requestNotification();
    if (granted) {
      setNotifEnabled(true);
      setDeviceNotificationEnabled(true);
      showToast('success', 'Đã cấp quyền Thông báo', 'Thiết bị sẵn sàng nhận cảnh báo từ Trạm Y tế.');
    } else {
      showToast('warning', 'Chưa thể bật Thông báo', 'Kiểm tra cài đặt quyền trang web trên trình duyệt.');
    }
  };

  const handleTestNotification = async () => {
    setTestingNotif(true);
    try {
      let granted = notificationStatus === 'granted';
      if (!granted) {
        granted = await requestNotification();
      }
      if (!granted) {
        showToast('warning', 'Chưa có quyền Thông báo', 'Vui lòng chọn Cho phép khi trình duyệt hỏi.');
        return;
      }

      const ok = await triggerDeviceSystemNotification(
        {
          id: `test_${Date.now()}`,
          title: settings.stationName || 'Trạm Y Tế',
          body: 'Thông báo thử nghiệm trên thiết bị đang hoạt động bình thường.',
          priority: 'khan',
          tag: 'tyt-test-notification',
        },
        true
      );
      showToast('success', 'Đã gửi thông báo thử nghiệm', ok ? 'Kiểm tra thanh thông báo của thiết bị.' : '');
    } finally {
      setTestingNotif(false);
    }
  };

  const handleRequestLocation = async () => {
    setLocating(true);
    try {
      const coords = await requestLocation();
      if (coords) {
        setLocationPref(true);
        try {
          localStorage.setItem(LOCATION_PREF_KEY, 'true');
        } catch {
          // ignore
        }
        showToast(
          'success',
          'Định vị GPS thành công',
          `Tọa độ: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
        );
      } else {
        showToast('warning', 'Không thể lấy vị trí', 'Vui lòng kiểm tra GPS hoặc quyền vị trí trên trình duyệt.');
      }
    } finally {
      setLocating(false);
    }
  };

  const handleToggleLocationPref = () => {
    const next = !locationPref;
    setLocationPref(next);
    try {
      localStorage.setItem(LOCATION_PREF_KEY, next ? 'true' : 'false');
    } catch {
      // ignore
    }
    showToast('info', next ? 'Đã bật gợi ý điểm y tế gần nhất' : 'Đã tắt tự động gợi ý vị trí');
  };

  const handleSharePortal = async () => {
    const title = settings.stationName && !settings.stationName.includes('Chưa cấu hình')
      ? settings.stationName
      : 'Cổng Thông Tin Trạm Y Tế';
    const text = `${title} - Lịch tiêm chủng, lịch trực 24/7 và bản đồ GPS.`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url: window.location.origin });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(window.location.origin);
      showToast('success', 'Đã sao chép liên kết cổng thông tin');
    } catch {
      showToast('info', 'Không thể sao chép tự động');
    }
  };

  const handleInstallPwa = async () => {
    if (isInstallable) {
      await install();
    } else if (isInstalled) {
      showToast('success', 'Ứng dụng đã được cài trên thiết bị');
    } else if (isIOS) {
      showToast('info', 'Cài trên iPhone/iPad', 'Mở bằng Safari -> Chia sẻ -> Thêm vào Màn hình chính.');
    } else {
      showToast('info', 'Cài đặt ứng dụng', 'Mở Menu trình duyệt (⋮) -> Cài đặt ứng dụng / Thêm vào màn hình chính.');
    }
  };

  const stations = settings.mapLocations || [];
  const nearestStation =
    userCoords && stations.length > 0
      ? [...stations]
          .map(loc => ({
            ...loc,
            distanceKm: calculateHaversineDistance(userCoords.lat, userCoords.lng, loc.lat, loc.lng),
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)[0]
      : null;

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-6 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
          <SlidersHorizontal className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Thiết Bị &amp; Tiện Ích Kết Nối
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Đồng bộ thông báo hệ thống, GPS và cài đặt ứng dụng lên điện thoại
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Notifications */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    Thông báo thiết bị
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Nhận cảnh báo khẩn và lịch trực mới
                  </p>
                </div>
              </div>

              {!notifSupported ? (
                <span className="text-xs font-semibold text-slate-500">Không hỗ trợ</span>
              ) : notificationStatus === 'granted' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Đã bật</span>
                </span>
              ) : notificationStatus === 'denied' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Đang chặn</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Chưa bật</span>
                </span>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-4">
              <div className="text-sm">
                <p className="font-bold text-slate-800 dark:text-slate-100">
                  Đẩy cảnh báo khẩn cấp
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Phát thông báo ngay cả khi thu nhỏ cửa sổ
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifEnabled}
                onClick={handleToggleNotifPref}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  notifEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                    notifEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {notificationStatus === 'denied' && (
              <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2.5 leading-relaxed">
                <Info className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>Mở biểu tượng ổ khóa trên thanh địa chỉ và bật lại quyền Thông báo.</span>
              </div>
            )}
          </div>

          {/* Max 2 Symmetrical or Right-aligned Buttons */}
          {notifSupported && (
            <div className={`pt-3 border-t border-slate-100 dark:border-slate-800 ${notificationStatus !== 'granted' ? 'grid grid-cols-1 sm:grid-cols-2 gap-2.5' : 'flex justify-end'}`}>
              {notificationStatus !== 'granted' && (
                <button
                  type="button"
                  onClick={handleRequestNotification}
                  className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Bell className="w-4 h-4" />
                  <span>Cấp quyền</span>
                </button>
              )}

              <button
                type="button"
                disabled={testingNotif}
                onClick={handleTestNotification}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-4 h-4 text-emerald-600" />
                <span>{testingNotif ? 'Đang gửi...' : 'Thử thông báo'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Card 2: Location / GPS */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    Định vị GPS &amp; Chỉ đường
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Tìm cơ sở y tế gần vị trí hiện tại
                  </p>
                </div>
              </div>

              {!geoSupported ? (
                <span className="text-xs font-semibold text-slate-500">Không hỗ trợ</span>
              ) : locationStatus === 'granted' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Đã định vị</span>
                </span>
              ) : locationStatus === 'denied' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Đang chặn</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Chưa định vị</span>
                </span>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-4">
              <div className="text-sm">
                <p className="font-bold text-slate-800 dark:text-slate-100">
                  Gợi ý trạm gần nhất
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tự tính khoảng cách và thời gian di chuyển
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={locationPref}
                onClick={handleToggleLocationPref}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  locationPref ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                    locationPref ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {userCoords && (
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                    Tọa độ GPS:
                  </span>
                  <code className="font-mono text-xs text-emerald-900 dark:text-emerald-200 tabular-nums">
                    {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}
                  </code>
                </div>
                {nearestStation && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    Gần nhất: <strong>{nearestStation.name}</strong> ({nearestStation.distanceKm.toFixed(2)} km · ~{estimateDrivingMinutes(nearestStation.distanceKm)} phút)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 2 Equal Symmetrical Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            {geoSupported && (
              <button
                type="button"
                disabled={locating}
                onClick={handleRequestLocation}
                className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Navigation className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
                <span>{locating ? 'Đang định vị...' : userCoords ? 'Cập nhật GPS' : 'Định vị ngay'}</span>
              </button>
            )}

            {nearestStation ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${nearestStation.lat},${nearestStation.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold transition inline-flex items-center justify-center gap-2"
              >
                <span>Google Maps</span>
                <ExternalLink className="w-4 h-4 text-emerald-600" />
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentView('map')}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Mở bản đồ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Card 3: PWA & Native Device Share */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Ứng dụng &amp; Trạng thái thiết bị
              </h2>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${isOnline ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600'}`}>
                {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                <span>{isOnline ? 'Trực tuyến' : 'Ngoại tuyến'}</span>
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Cài biểu tượng Trạm Y tế lên màn hình chính hoặc chia sẻ cổng thông tin cho người thân.
            </p>
          </div>
        </div>

        {/* 2 Symmetrical Right-Aligned Device Buttons */}
        <div className="grid grid-cols-2 gap-2.5 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleInstallPwa}
            className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>{isInstalled ? 'Đã cài App' : 'Cài lên máy'}</span>
          </button>

          <button
            type="button"
            onClick={handleSharePortal}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Share2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Chia sẻ</span>
          </button>
        </div>
      </div>

      <SoftwareTeamContactCard contact={settings.softwareTeamContact} />
    </div>
  );
};
