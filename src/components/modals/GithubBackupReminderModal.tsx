import React from 'react';
import {
  AlertTriangle,
  Clock,
  FolderGit2,
  RefreshCw,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { SystemSettings } from '../../types';
import { isGitHubConfigValid } from '../../services/backupService';

interface GithubBackupReminderModalProps {
  isOpen: boolean;
  settings: SystemSettings;
  isBackingUp: boolean;
  onBackupNow: () => void;
  onOpenBackupManager: () => void;
  onOpenGithubConfig: () => void;
  onDismissForSession: () => void;
}

export const GithubBackupReminderModal: React.FC<GithubBackupReminderModalProps> = ({
  isOpen,
  settings,
  isBackingUp,
  onBackupNow,
  onOpenBackupManager,
  onOpenGithubConfig,
  onDismissForSession,
}) => {
  if (!isOpen) return null;

  const isConfigured = isGitHubConfigValid(settings.githubConfig);
  const lastFailed = settings.lastAutoGithubBackupStatus === 'failed';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in"
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-200 dark:border-amber-800/80 shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-amber-600 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-white/15 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">
                Nhắc Nhở Sao Lưu GitHub Hằng Ngày (03:00 Sáng)
              </h3>
              <p className="text-xs text-amber-100 truncate">
                Hôm nay chưa có bản sao lưu được đẩy lên kho GitHub
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isBackingUp}
            onClick={onDismissForSession}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0 disabled:opacity-50"
            title="Đóng hộp thoại nhắc"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <p className="leading-relaxed">
            Theo lịch cấu hình, hệ thống tự động mã hoá Base64 và đẩy bản sao lưu toàn bộ cơ sở dữ liệu lên{' '}
            <strong className="text-slate-900 dark:text-white">GitHub</strong> vào lúc{' '}
            <strong className="text-amber-700 dark:text-amber-400">03:00 sáng hằng ngày</strong>.
            Tuy nhiên hôm nay bản sao lưu chưa được thực hiện (do không có phiên Quản trị mở lúc 03:00 sáng hoặc quá trình đẩy tự động gặp gián đoạn).
          </p>

          {lastFailed && settings.lastAutoGithubBackupError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200">
              <div className="font-bold">Lỗi tự động đẩy gần nhất:</div>
              <div className="mt-0.5 break-words">{settings.lastAutoGithubBackupError}</div>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Lần đẩy GitHub gần nhất:{' '}
                {settings.lastGithubBackupAt
                  ? new Date(settings.lastGithubBackupAt).toLocaleString('vi-VN')
                  : 'Chưa từng đẩy bản sao lưu lên GitHub'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-[11px]">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                Sau khi đẩy xong hôm nay, thông báo nhắc sẽ tự động tắt cho đến ngày hôm sau.
              </span>
            </div>
          </div>

          {!isConfigured && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200">
              Kho lưu trữ GitHub (Token PAT / Owner / Repo) hiện chưa được thiết lập. Vui lòng cấu hình trước để hệ thống sao lưu tự động.
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={isBackingUp}
            onClick={onDismissForSession}
            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
          >
            Để sau
          </button>

          <button
            type="button"
            disabled={isBackingUp}
            onClick={onOpenBackupManager}
            className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
          >
            Mở Quản lý Sao lưu
          </button>

          {isConfigured ? (
            <button
              type="button"
              disabled={isBackingUp}
              onClick={onBackupNow}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isBackingUp ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <FolderGit2 className="w-4 h-4" />
              )}
              <span>{isBackingUp ? 'Đang đẩy lên GitHub...' : 'Đẩy sao lưu lên GitHub ngay'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenGithubConfig}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>Cấu hình Kho GitHub</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
