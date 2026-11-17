import React from 'react';
import { StationLogo } from './StationLogo';

interface LoadingSpinnerProps {
  message?: string;
  subMessage?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Đang đồng bộ dữ liệu y tế trực tuyến...',
  subMessage = 'Vui lòng chờ trong giây lát',
  size = 'md',
}) => {
  const logoSizes = {
    sm: 36,
    md: 52,
    lg: 68,
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
      <div className="relative flex items-center justify-center mb-4">
        {/* Pulsing ring */}
        <div className="absolute inset-0 rounded-full bg-emerald-500/20 dark:bg-emerald-400/20 animate-ping" />
        
        {/* Rotating border ring */}
        <div className="w-16 h-16 rounded-full border-2 border-emerald-500/30 border-t-emerald-600 animate-spin" />
        
        {/* Centered Station Logo */}
        <div className="absolute inset-0 flex items-center justify-center">
          <StationLogo size={logoSizes[size]} />
        </div>
      </div>

      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-2">
        {message}
      </p>
      {subMessage && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
          {subMessage}
        </p>
      )}

      {/* Indeterminate Progress Bar */}
      <div className="w-48 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mt-4 overflow-hidden relative">
        <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 w-1/3 rounded-full animate-indeterminate" />
      </div>
    </div>
  );
};
