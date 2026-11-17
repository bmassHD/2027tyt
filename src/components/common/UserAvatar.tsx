import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  isPrimaryAdmin?: boolean;
  rounded?: 'xl' | 'full' | '2xl';
  showAdminRing?: boolean;
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name,
  size = 36,
  isPrimaryAdmin = false,
  rounded = 'xl',
  showAdminRing = false,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const initial = (name?.trim()?.[0] || 'U').toUpperCase();
  const radiusClass =
    rounded === 'full' ? 'rounded-full' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';

  return (
    <div
      className={`relative shrink-0 inline-flex items-center justify-center ${radiusClass} ${
        showAdminRing && isPrimaryAdmin ? 'ring-2 ring-rose-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={name || 'Ảnh đại diện'}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`w-full h-full object-cover ${radiusClass} border border-slate-200 dark:border-slate-700 bg-white`}
        />
      ) : (
        <div
          className={`w-full h-full ${radiusClass} flex items-center justify-center font-bold select-none shadow-xs ${
            isPrimaryAdmin
              ? 'bg-gradient-to-br from-rose-600 to-rose-700 text-white'
              : 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white'
          }`}
          style={{ fontSize: Math.max(11, Math.round(size * 0.38)) }}
        >
          {initial}
        </div>
      )}

      {showAdminRing && isPrimaryAdmin && (
        <span
          className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center border-2 border-white dark:border-slate-900"
          title="Super Admin Hệ Thống"
        >
          <ShieldCheck className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
};
