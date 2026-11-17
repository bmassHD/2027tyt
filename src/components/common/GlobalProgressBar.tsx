import React, { useEffect, useState } from 'react';

interface GlobalProgressBarProps {
  isLoading?: boolean;
}

export const GlobalProgressBar: React.FC<GlobalProgressBarProps> = ({ isLoading = false }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let timer: any;
    if (isLoading) {
      setProgress(15);
      timer = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(timer);
            return 90;
          }
          return prev + Math.floor(Math.random() * 15) + 5;
        });
      }, 200);
    } else {
      setProgress(100);
      timer = setTimeout(() => {
        setProgress(0);
      }, 300);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isLoading]);

  if (progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-slate-200/40 pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(16,185,129,0.8)]"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};
