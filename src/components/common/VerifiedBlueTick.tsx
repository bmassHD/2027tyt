import React from 'react';

interface VerifiedBlueTickProps {
  size?: 'xs' | 'sm' | 'md';
  title?: string;
  className?: string;
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-4.5 h-4.5',
};

/**
 * Clean verified blue checkmark badge rendered next to display names
 * when an account has completed 100% (4/4) verification.
 */
export const VerifiedBlueTick: React.FC<VerifiedBlueTickProps> = ({
  size = 'sm',
  title = 'Tài khoản đã xác minh 100% (4/4 lớp bảo mật)',
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 align-middle ${className}`}
      title={title}
      aria-label={title}
      role="img"
    >
      <svg
        viewBox="0 0 24 24"
        className={SIZE_CLASSES[size]}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
          fill="#1D9BF0"
        />
        <path
          d="M9.64 15.86L6.45 12.67a.95.95 0 0 1 1.34-1.34l2.52 2.52 5.9-5.9a.95.95 0 1 1 1.34 1.34l-6.57 6.57a.95.95 0 0 1-1.34 0z"
          fill="#FFFFFF"
        />
      </svg>
    </span>
  );
};
