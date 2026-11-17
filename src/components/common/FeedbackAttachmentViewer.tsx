import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Paperclip,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Download,
  ExternalLink,
  FolderGit2,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { FeedbackAttachment, GitHubConfig } from '../../types';
import { GitHubService, inferAttachmentMimeType } from '../../services/githubService';
import { getSystemSettings } from '../../services/firebaseService';

interface FeedbackAttachmentViewerProps {
  attachments?: FeedbackAttachment[];
  githubBackupUrl?: string;
  githubConfig?: GitHubConfig;
  compact?: boolean;
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isPreviewableAttachment(att: FeedbackAttachment): boolean {
  if (att.kind === 'image' || att.kind === 'video' || att.kind === 'audio') {
    return true;
  }
  const mime = inferAttachmentMimeType(att.name, att.mimeType).toLowerCase();
  const ext = att.name.split('.').pop()?.toLowerCase() || '';
  return (
    mime.includes('pdf') ||
    mime.startsWith('text/') ||
    ['pdf', 'txt', 'csv', 'json', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)
  );
}

interface ResolvedPreviewEntry {
  url: string;
  isObjectUrl: boolean;
  mimeType: string;
}

export const FeedbackAttachmentViewer: React.FC<FeedbackAttachmentViewerProps> = ({
  attachments,
  githubBackupUrl,
  githubConfig,
  compact = false,
}) => {
  const list = Array.isArray(attachments) ? attachments : [];

  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [resolvedEntry, setResolvedEntry] = useState<ResolvedPreviewEntry | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const urlCacheRef = useRef<Map<string, ResolvedPreviewEntry>>(new Map());
  const resolvedGhConfigRef = useRef<GitHubConfig | undefined>(githubConfig);

  useEffect(() => {
    if (githubConfig?.token?.trim()) {
      resolvedGhConfigRef.current = githubConfig;
    }
  }, [githubConfig]);

  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      cache.forEach(entry => {
        if (entry.isObjectUrl && entry.url.startsWith('blob:')) {
          URL.revokeObjectURL(entry.url);
        }
      });
      cache.clear();
    };
  }, []);

  const ensureGitHubConfig = useCallback(async (): Promise<GitHubConfig | undefined> => {
    const current = resolvedGhConfigRef.current || githubConfig;
    if (current?.token?.trim() && current?.owner?.trim() && current?.repo?.trim()) {
      return current;
    }
    try {
      const liveSettings = await getSystemSettings();
      if (liveSettings?.githubConfig) {
        resolvedGhConfigRef.current = liveSettings.githubConfig;
        return liveSettings.githubConfig;
      }
    } catch {
      // Fallback to existing config
    }
    return current;
  }, [githubConfig]);

  const resolveAttachmentUrl = useCallback(
    async (att: FeedbackAttachment, cacheKey: string): Promise<{ entry?: ResolvedPreviewEntry; error?: string }> => {
      const cached = urlCacheRef.current.get(cacheKey);
      if (cached) {
        return { entry: cached };
      }
      const cfg = await ensureGitHubConfig();
      const res = await GitHubService.fetchAttachmentObjectUrl(cfg, att);
      if (res.url) {
        const entry: ResolvedPreviewEntry = {
          url: res.url,
          isObjectUrl: Boolean(res.isObjectUrl),
          mimeType: res.mimeType,
        };
        urlCacheRef.current.set(cacheKey, entry);
        return { entry };
      }
      return { error: res.error || 'Không thể tải tệp đính kèm.' };
    },
    [ensureGitHubConfig]
  );

  // Load current preview item whenever previewIdx changes
  useEffect(() => {
    if (previewIdx === null || previewIdx < 0 || previewIdx >= list.length) {
      setResolvedEntry(null);
      setPreviewError(null);
      setLoadingPreview(false);
      return;
    }

    let cancelled = false;
    const att = list[previewIdx];
    const cacheKey = att.id || `${att.name}_${previewIdx}`;

    setLoadingPreview(true);
    setPreviewError(null);
    setResolvedEntry(null);

    resolveAttachmentUrl(att, cacheKey).then(({ entry, error }) => {
      if (cancelled) return;
      setLoadingPreview(false);
      if (entry) {
        setResolvedEntry(entry);
      } else {
        setPreviewError(error || 'Không thể hiển thị tệp này.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [previewIdx, list, resolveAttachmentUrl]);

  // Keyboard navigation in preview modal
  useEffect(() => {
    if (previewIdx === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewIdx(null);
      } else if (e.key === 'ArrowLeft' && list.length > 1) {
        setPreviewIdx(prev => (prev === null ? null : (prev - 1 + list.length) % list.length));
      } else if (e.key === 'ArrowRight' && list.length > 1) {
        setPreviewIdx(prev => (prev === null ? null : (prev + 1) % list.length));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewIdx, list.length]);

  const handleDownloadAttachment = async (
    e: React.MouseEvent,
    att: FeedbackAttachment,
    cacheKey: string
  ) => {
    e.stopPropagation();
    setDownloadingKey(cacheKey);
    try {
      const { entry } = await resolveAttachmentUrl(att, cacheKey);
      const urlToSave = entry?.url || att.downloadUrl || att.htmlUrl;
      if (!urlToSave) return;
      const a = document.createElement('a');
      a.href = urlToSave;
      a.download = att.name;
      if (!entry?.isObjectUrl) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloadingKey(null);
    }
  };

  if (list.length === 0 && !githubBackupUrl) return null;

  const currentAtt = previewIdx !== null ? list[previewIdx] : null;
  const currentMime = currentAtt
    ? resolvedEntry?.mimeType || inferAttachmentMimeType(currentAtt.name, currentAtt.mimeType)
    : '';

  return (
    <div className={`space-y-2 ${compact ? 'pt-1' : 'pt-2'}`}>
      {list.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>Tệp đính kèm ({list.length})</span>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {list.map((att, idx) => {
              const targetSource = att.htmlUrl || att.downloadUrl || '';
              const key = att.id || `${att.name}_${idx}`;
              const canPreview = isPreviewableAttachment(att);
              const isDownloadingThis = downloadingKey === key;

              return (
                <div
                  key={key}
                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-teal-600 dark:text-teal-400">
                        {att.kind === 'image' ? (
                          <ImageIcon className="w-4 h-4" />
                        ) : att.kind === 'video' ? (
                          <Film className="w-4 h-4" />
                        ) : att.kind === 'audio' ? (
                          <Music className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {att.name}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                          {formatAttachmentSize(att.size)}
                          {att.mimeType ? ` · ${att.mimeType}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {canPreview && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setPreviewIdx(idx);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold inline-flex items-center gap-1 transition shadow-xs cursor-pointer"
                          title={`Xem ${att.name}`}
                        >
                          <Eye className="w-3 h-3" />
                          <span>Xem</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isDownloadingThis}
                        onClick={e => handleDownloadAttachment(e, att, key)}
                        className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-teal-50 dark:hover:bg-teal-950/50 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-teal-700 dark:text-teal-300 inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-60"
                        title="Tải tệp xuống"
                      >
                        {isDownloadingThis ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        <span>Tải</span>
                      </button>

                      {targetSource && (
                        <a
                          href={targetSource}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1 transition"
                          title="Mở tệp trên GitHub"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span className="hidden sm:inline">GitHub</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {githubBackupUrl && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/70 text-[11px] text-emerald-800 dark:text-emerald-300">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
            <span>Đã đồng bộ sao lưu dữ liệu trên GitHub</span>
          </span>
          <a
            href={githubBackupUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="font-bold underline hover:text-emerald-900 dark:hover:text-emerald-200 shrink-0 inline-flex items-center gap-1"
          >
            <span>Xem bản sao lưu</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Lightbox / Preview Modal (Portaled to document.body so it renders cleanly above dialogs) */}
      {previewIdx !== null &&
        currentAtt &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setPreviewIdx(null)}
            className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                    {currentAtt.name}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatAttachmentSize(currentAtt.size)}
                    {list.length > 1 ? ` · Tệp ${previewIdx + 1}/${list.length}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={e =>
                      handleDownloadAttachment(
                        e,
                        currentAtt,
                        currentAtt.id || `${currentAtt.name}_${previewIdx}`
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải về</span>
                  </button>

                  {(currentAtt.htmlUrl || currentAtt.downloadUrl) && (
                    <a
                      href={currentAtt.htmlUrl || currentAtt.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">GitHub</span>
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => setPreviewIdx(null)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    aria-label="Đóng"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="relative flex-1 min-h-[260px] bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-3 sm:p-5 overflow-auto">
                {loadingPreview ? (
                  <div className="flex flex-col items-center gap-2.5 py-12 text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-7 h-7 animate-spin text-teal-600" />
                    <span className="text-xs font-medium">Đang tải tệp đính kèm...</span>
                  </div>
                ) : previewError ? (
                  <div className="max-w-md text-center space-y-3 py-8 px-4">
                    <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-slate-800 dark:text-white">
                        Không thể hiển thị trực tiếp tệp này
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{previewError}</p>
                    </div>
                    {(currentAtt.htmlUrl || currentAtt.downloadUrl) && (
                      <a
                        href={currentAtt.htmlUrl || currentAtt.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Mở trên GitHub</span>
                      </a>
                    )}
                  </div>
                ) : resolvedEntry?.url ? (
                  currentAtt.kind === 'image' || currentMime.startsWith('image/') ? (
                    <img
                      src={resolvedEntry.url}
                      alt={currentAtt.name}
                      onError={() =>
                        setPreviewError(
                          'Trình duyệt không giải mã được định dạng ảnh này hoặc đường dẫn bị từ chối.'
                        )
                      }
                      className="max-h-[74vh] max-w-full object-contain rounded-lg shadow-md select-none"
                    />
                  ) : currentAtt.kind === 'video' || currentMime.startsWith('video/') ? (
                    <video
                      controls
                      autoPlay
                      src={resolvedEntry.url}
                      className="max-h-[74vh] w-full rounded-lg bg-black shadow-md"
                    />
                  ) : currentAtt.kind === 'audio' || currentMime.startsWith('audio/') ? (
                    <div className="w-full max-w-md p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center mx-auto">
                        <Music className="w-6 h-6" />
                      </div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                        {currentAtt.name}
                      </p>
                      <audio controls autoPlay src={resolvedEntry.url} className="w-full" />
                    </div>
                  ) : (
                    <iframe
                      src={resolvedEntry.url}
                      title={currentAtt.name}
                      className="w-full h-[72vh] rounded-lg bg-white border border-slate-200 dark:border-slate-800"
                    />
                  )
                ) : null}

                {list.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewIdx(prev =>
                          prev === null ? null : (prev - 1 + list.length) % list.length
                        )
                      }
                      className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 dark:bg-slate-800/90 hover:bg-white text-slate-800 dark:text-white shadow-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                      title="Tệp trước"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewIdx(prev => (prev === null ? null : (prev + 1) % list.length))
                      }
                      className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 dark:bg-slate-800/90 hover:bg-white text-slate-800 dark:text-white shadow-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                      title="Tệp tiếp theo"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
