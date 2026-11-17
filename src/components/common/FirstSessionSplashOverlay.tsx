import React from 'react';
import { createPortal } from 'react-dom';
import { StationLogo } from './StationLogo';
import { SystemSettings } from '../../types';

interface FirstSessionSplashOverlayProps {
  visible: boolean;
  fadingOut?: boolean;
  settings: SystemSettings;
}

export const FirstSessionSplashOverlay: React.FC<FirstSessionSplashOverlayProps> = ({
  visible,
  fadingOut = false,
  settings,
}) => {
  if (!visible || typeof document === 'undefined') return null;

  const cachedSettings = (() => {
    try {
      const cached = localStorage.getItem('tyt_cached_station_settings');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore
    }
    return null;
  })();

  const rawStation = settings.stationName || cachedSettings?.stationName || '';
  const activeStationName =
    rawStation && !rawStation.includes('Chưa cấu hình')
      ? rawStation.trim()
      : 'Cổng Thông Tin Điện Tử Trạm Y Tế';

  const rawParent = settings.parentUnitName || cachedSettings?.parentUnitName || '';
  const parentUnit =
    rawParent && !rawParent.includes('QUẬN / HUYỆN')
      ? rawParent.trim()
      : 'TRẠM Y TẾ XÃ / PHƯỜNG';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-label={`Đang khởi động ${activeStationName}`}
      className={`fixed inset-0 top-0 left-0 right-0 bottom-0 w-full h-[100dvh] m-0 z-[10000] bg-white flex flex-col items-center justify-center px-6 text-center transition-opacity duration-500 ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="max-w-md w-full flex flex-col items-center space-y-6">
        {/* Logo + Circular Spin Loading */}
        <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-emerald-50 animate-pulse"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-[3.5px] border-emerald-100 border-t-emerald-600 border-r-teal-500 animate-spin"
          />
          <div className="relative z-10 rounded-full flex items-center justify-center overflow-hidden bg-white shadow-sm">
            <StationLogo size={88} />
          </div>
        </div>

        {/* Tên đơn vị trực thuộc & Tên đơn vị */}
        <div className="space-y-2">
          <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-emerald-700">
            {parentUnit}
          </p>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug uppercase">
            {activeStationName}
          </h1>
        </div>

        {/* Subtle bottom loading bar */}
        <div className="w-40 h-1 bg-slate-100 rounded-full overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 w-1/3 rounded-full animate-indeterminate" />
        </div>
      </div>
    </div>,
    document.body
  );
};
