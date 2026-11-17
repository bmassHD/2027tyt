import React, { useState } from 'react';

interface StationLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export const StationLogo: React.FC<StationLogoProps> = ({
  className = '',
  size = 40,
  showText = false,
}) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {!imgError ? (
        <img
          src="/assets/logotram.png"
          alt="Logo Trạm Y Tế"
          width={size}
          height={size}
          onError={() => setImgError(true)}
          className="rounded-full object-cover shrink-0 shadow-xs transition-transform duration-300 hover:scale-105 border border-emerald-600/30 bg-white"
          style={{ width: size, height: size }}
        />
      ) : (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0 drop-shadow-sm transition-transform duration-300 hover:scale-105"
          role="img"
          aria-label="Logo Trạm Y Tế"
        >
          <defs>
            <linearGradient id="shieldGrad" x1="50" y1="5" x2="50" y2="95" gradientUnits="userSpaceOnUse">
              <stop stopColor="#059669" />
              <stop offset="1" stopColor="#065f46" />
            </linearGradient>
            <linearGradient id="goldGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fbbf24" />
              <stop offset="0.5" stopColor="#d97706" />
              <stop offset="1" stopColor="#b45309" />
            </linearGradient>
            <linearGradient id="crossGrad" x1="50" y1="25" x2="50" y2="75" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ef4444" />
              <stop offset="1" stopColor="#b91c1c" />
            </linearGradient>
          </defs>

          {/* Outer Circular Laurel / Gear Border */}
          <circle cx="50" cy="50" r="47" stroke="url(#goldGrad)" strokeWidth="2.5" fill="#f8fafc" />
          <circle cx="50" cy="50" r="43" stroke="#047857" strokeWidth="1.2" strokeDasharray="3 2" fill="none" />

          {/* Inner Emerald Field */}
          <circle cx="50" cy="50" r="39" fill="url(#shieldGrad)" />

          {/* White Central Disk */}
          <circle cx="50" cy="50" r="28" fill="#ffffff" />

          {/* Red Medical Cross */}
          <path
            d="M44 32 H56 V44 H68 V56 H56 V68 H44 V56 H32 V44 H44 Z"
            fill="url(#crossGrad)"
          />

          {/* Bowl of Hygieia and Serpent */}
          <g stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M43 55 C43 62 57 62 57 55 Z" fill="#d97706" stroke="#b45309" strokeWidth="1" />
            <path d="M50 62 L50 65 M45 65 L55 65" stroke="#b45309" strokeWidth="1.2" />
            <path
              d="M50 38 C53 41 53 45 50 47 C47 49 47 52 50 54"
              stroke="#fbbf24"
              strokeWidth="1.8"
            />
          </g>

          <polygon
            points="50,11 52,16 57,16 53,19 55,24 50,21 45,24 47,19 43,16 48,16"
            fill="url(#goldGrad)"
          />
        </svg>
      )}

      {showText && (
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] tracking-wider uppercase font-semibold text-emerald-700 dark:text-emerald-400">
            HỆ THỐNG Y TẾ CƠ SỞ
          </span>
          <span className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
            TRẠM Y TẾ
          </span>
        </div>
      )}
    </div>
  );
};
