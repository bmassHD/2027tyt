import React from 'react';
import { createPortal } from 'react-dom';
import { StationLogo } from './StationLogo';
import { SystemSettings } from '../../types';

interface FullScreenLoadingOverlayProps {
  visible: boolean;
  fadingOut?: boolean;
  settings: SystemSettings;
  settingsLoaded?: boolean;
  subtitle?: string;
  mode?: 'splash' | 'transition';
}

export const FullScreenLoadingOverlay: React.FC<FullScreenLoadingOverlayProps> = ({
  visible,
  fadingOut = false,
  settings,
  settingsLoaded = true,
  subtitle = 'Đang tải dữ liệu cổng thông tin...',
  mode = 'splash',
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
      ? rawStation
      : 'Cổng Thông Tin Điện Tử Trạm Y Tế';

  const rawParent = settings.parentUnitName || cachedSettings?.parentUnitName || '';
  const parentUnit =
    rawParent && !rawParent.includes('QUẬN / HUYỆN')
      ? rawParent.trim()
      : 'TRẠM Y TẾ XÃ / PHƯỜNG';

  const logoSize = mode === 'splash' ? 76 : 56;
  const ringContainerClass = mode === 'splash' ? 'w-24 h-24' : 'w-[74px] h-[74px]';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-label={subtitle}
      className={`fixed inset-0 top-0 left-0 right-0 bottom-0 w-full h-[100dvh] m-0 z-[9999] bg-slate-950/55 dark:bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4 transition-opacity duration-300 ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-700/80 shadow-2xl px-6 py-7 text-center space-y-4">
        {/* Circular Logo with smooth circular spin ring around it */}
        <div className={`mx-auto relative flex items-center justify-center ${ringContainerClass}`}>
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 animate-pulse"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-[3px] border-emerald-500/20 border-t-emerald-600 border-r-teal-500 animate-spin"
          />
          <div className="relative z-10 rounded-full flex items-center justify-center overflow-hidden">
            <StationLogo size={logoSize} />
          </div>
        </div>

        {/* Unit Name & Status */}
        <div className="space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            {parentUnit}
          </div>
          <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
            {activeStationName}
          </h2>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 pt-0.5">
            {subtitle}
          </p>
        </div>

        {/* Indeterminate progress bar */}
        <div className="mx-auto w-44 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 w-1/3 rounded-full animate-indeterminate" />
        </div>
      </div>
    </div>,
    document.body
  );
};
