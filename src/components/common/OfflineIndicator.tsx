import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-2xl bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-xs font-semibold text-white shadow-xl animate-in fade-in border border-amber-400/40">
      <WifiOff className="w-4 h-4 shrink-0 animate-bounce" />
      <span>Đang ở chế độ Ngoại tuyến (Offline) — Đang hiển thị dữ liệu lưu tạm.</span>
    </div>
  );
};
