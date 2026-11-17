import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  Upload,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Check,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  RotateCw,
} from 'lucide-react';
import { Post } from '../../types';
import {
  cleanFacebookPostContent,
  deriveFacebookPostSummary,
  deriveFacebookPostTitle,
} from '../../utils/facebookEmbed';
import {
  downloadFacebookPostsExcelTemplate,
  parseFacebookPostsExcelFile,
  POST_CATEGORY_OPTIONS,
} from '../../utils/facebookPostExcel';
import { useToast } from '../../contexts/ToastContext';

interface FacebookPostsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingPosts: Post[];
  onImportPosts: (
    postsToCreate: Array<Partial<Post>>
  ) => Promise<{ createdCount: number; failedCount: number }>;
}

type FetchStatus =
  | 'idle'
  | 'fetching'
  | 'fetched'
  | 'fetched_restricted'
  | 'invalid';

interface ImportRowState {
  id: string;
  rowNumber: number;
  rawUrl: string;
  canonicalUrl: string;
  detectedKind: 'post' | 'video' | 'page' | 'profile';
  selected: boolean;
  isValidFacebookLink: boolean;
  isNonPostPageOrProfile: boolean;
  isDuplicateInFile: boolean;
  isAlreadyInPosts: boolean;
  validationError?: string;
  fetchStatus: FetchStatus;
  title: string;
  content: string;
  category: Post['category'];
}

export const FacebookPostsImportModal: React.FC<FacebookPostsImportModalProps> = ({
  isOpen,
  onClose,
  existingPosts,
  onImportPosts,
}) => {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState('');
  const [defaultCategory, setDefaultCategory] = useState<Post['category']>('giao_duc_suc_khoe');
  const [showImage, setShowImage] = useState(true);
  const [showText, setShowText] = useState(true);

  const [rows, setRows] = useState<ImportRowState[]>([]);
  const [parsing, setParsing] = useState(false);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0 });
  const [publishing, setPublishing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fetchRunIdRef = useRef(0);

  const stats = useMemo(() => {
    const validRows = rows.filter(
      r => r.isValidFacebookLink && !r.isNonPostPageOrProfile && !r.isDuplicateInFile
    );
    const selectedRows = validRows.filter(r => r.selected);
    const fetchedWithData = validRows.filter(
      r => r.fetchStatus === 'fetched'
    );
    const invalidCount = rows.length - validRows.length;
    return {
      total: rows.length,
      validCount: validRows.length,
      selectedCount: selectedRows.length,
      fetchedWithDataCount: fetchedWithData.length,
      invalidCount,
    };
  }, [rows]);

  if (!isOpen) return null;

  const resetState = () => {
    fetchRunIdRef.current += 1;
    setFileName('');
    setRows([]);
    setParsing(false);
    setFetchingAll(false);
    setFetchProgress({ done: 0, total: 0 });
    setPublishing(false);
  };

  const handleClose = () => {
    if (publishing) return;
    resetState();
    onClose();
  };

  const fetchSingleRowMetadata = async (
    row: ImportRowState,
    indexInValidList: number,
    runId: number
  ) => {
    if (fetchRunIdRef.current !== runId) return;

    setRows(prev =>
      prev.map(r => (r.id === row.id ? { ...r, fetchStatus: 'fetching' } : r))
    );

    try {
      const resp = await fetch('/api/facebook-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: row.canonicalUrl || row.rawUrl }),
      });
      const data = await resp.json();
      if (fetchRunIdRef.current !== runId) return;

      const serverKind = (data?.detectedKind as ImportRowState['detectedKind']) || row.detectedKind;
      const isExplicitPostUrl = /\/(?:posts|permalink\.php|photo|story\.php|share|videos|watch|reel|reels|events)\b|story_fbid=|fbid=|pfbid|fb\.watch/i.test(
        row.canonicalUrl || row.rawUrl
      );
      const effectiveKind =
        isExplicitPostUrl && (serverKind === 'page' || serverKind === 'profile')
          ? row.detectedKind
          : serverKind;
      const isPageOrProfile = effectiveKind === 'page' || effectiveKind === 'profile';

      const authorOrPageName = String(data?.displayName || data?.title || '').trim();
      const rawDesc = String(data?.description || '').trim();
      const cleanedContent = cleanFacebookPostContent(rawDesc, authorOrPageName);

      // Title MUST come from a portion of the post content — NEVER the Page/Profile name
      const derivedTitle =
        (data?.suggestedTitle ? String(data.suggestedTitle).trim() : '') ||
        deriveFacebookPostTitle(cleanedContent, authorOrPageName);

      const fallbackTitle = `Bài viết truyền thông Facebook #${indexInValidList + 1}`;
      const finalTitle = derivedTitle || fallbackTitle;

      const fetchStatus: FetchStatus = isPageOrProfile
        ? 'invalid'
        : cleanedContent
        ? 'fetched'
        : 'fetched_restricted';

      setRows(prev =>
        prev.map(r =>
          r.id === row.id
            ? {
                ...r,
                detectedKind: effectiveKind,
                isNonPostPageOrProfile: isPageOrProfile,
                selected: isPageOrProfile ? false : r.selected,
                validationError: isPageOrProfile
                  ? 'Đây là link Fanpage/Trang cá nhân — chỉ hỗ trợ import link bài viết Facebook'
                  : r.validationError,
                fetchStatus,
                title: r.title && !r.title.startsWith('Bài viết truyền thông Facebook #')
                  ? r.title
                  : finalTitle,
                content: cleanedContent || r.content,
              }
            : r
        )
      );
    } catch {
      if (fetchRunIdRef.current !== runId) return;
      setRows(prev =>
        prev.map(r =>
          r.id === row.id
            ? {
                ...r,
                fetchStatus: 'fetched_restricted',
                title: r.title || `Bài viết truyền thông Facebook #${indexInValidList + 1}`,
              }
            : r
        )
      );
    }
  };

  const runBatchFetch = async (targetRows: ImportRowState[]) => {
    const validTargets = targetRows.filter(
      r => r.isValidFacebookLink && !r.isNonPostPageOrProfile && !r.isDuplicateInFile
    );
    if (validTargets.length === 0) return;

    const runId = ++fetchRunIdRef.current;
    setFetchingAll(true);
    setFetchProgress({ done: 0, total: validTargets.length });

    let completed = 0;
    const CONCURRENCY = 3;

    for (let i = 0; i < validTargets.length; i += CONCURRENCY) {
      if (fetchRunIdRef.current !== runId) break;
      const chunk = validTargets.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (row, offset) => {
          await fetchSingleRowMetadata(row, i + offset, runId);
          completed += 1;
          if (fetchRunIdRef.current === runId) {
            setFetchProgress({ done: completed, total: validTargets.length });
          }
        })
      );
    }

    if (fetchRunIdRef.current === runId) {
      setFetchingAll(false);
    }
  };

  const processExcelFile = async (file: File) => {
    setParsing(true);
    fetchRunIdRef.current += 1;
    try {
      const parsed = await parseFacebookPostsExcelFile(file, existingPosts);
      const initialRows: ImportRowState[] = parsed.map((p, idx) => {
        const isUsable =
          p.isValidFacebookLink && !p.isNonPostPageOrProfile && !p.isDuplicateInFile;
        return {
          id: `fb_imp_${Date.now()}_${idx}`,
          rowNumber: p.rowNumber,
          rawUrl: p.rawUrl,
          canonicalUrl: p.normalizedUrl || p.rawUrl,
          detectedKind: p.isNonPostPageOrProfile ? 'page' : 'post',
          selected: isUsable && !p.isAlreadyInPosts,
          isValidFacebookLink: p.isValidFacebookLink,
          isNonPostPageOrProfile: p.isNonPostPageOrProfile,
          isDuplicateInFile: p.isDuplicateInFile,
          isAlreadyInPosts: p.isAlreadyInPosts,
          validationError: p.validationError,
          fetchStatus: isUsable ? 'idle' : 'invalid',
          title: '',
          content: '',
          category: p.category || defaultCategory,
        };
      });

      setFileName(file.name);
      setRows(initialRows);
      setParsing(false);

      const usableCount = initialRows.filter(
        r => r.isValidFacebookLink && !r.isNonPostPageOrProfile && !r.isDuplicateInFile
      ).length;

      if (usableCount > 0) {
        void runBatchFetch(initialRows);
      } else {
        showToast(
          'warning',
          'Không có link bài viết Facebook hợp lệ để tải',
          'Vui lòng kiểm tra lại cột link trong file Excel.'
        );
      }
    } catch (err: any) {
      setParsing(false);
      showToast(
        'error',
        'Không thể đọc file Excel',
        err?.message || 'Vui lòng dùng file .xlsx, .xls hoặc .csv hợp lệ.'
      );
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void processExcelFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processExcelFile(file);
    }
  };

  const updateRow = (id: string, patch: Partial<ImportRowState>) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleApplyDefaultCategoryToAll = (nextCat: Post['category']) => {
    setDefaultCategory(nextCat);
    setRows(prev => prev.map(r => ({ ...r, category: nextCat })));
  };

  const toggleSelectAllValid = (checked: boolean) => {
    setRows(prev =>
      prev.map(r =>
        r.isValidFacebookLink && !r.isNonPostPageOrProfile && !r.isDuplicateInFile
          ? { ...r, selected: checked }
          : r
      )
    );
  };

  const handlePublishSelected = async () => {
    const chosen = rows.filter(
      r =>
        r.selected &&
        r.isValidFacebookLink &&
        !r.isNonPostPageOrProfile &&
        !r.isDuplicateInFile
    );
    if (chosen.length === 0) {
      showToast('warning', 'Vui lòng chọn ít nhất 1 bài viết Facebook hợp lệ để xuất bản');
      return;
    }

    setPublishing(true);
    try {
      const payloads: Array<Partial<Post>> = chosen.map((row, idx) => {
        const finalTitle =
          row.title.trim() ||
          deriveFacebookPostTitle(row.content) ||
          `Bài viết truyền thông Facebook #${idx + 1}`;
        const finalContent = row.content.trim();
        const finalSummary = deriveFacebookPostSummary(finalContent, finalTitle);

        return {
          title: finalTitle.slice(0, 250),
          summary: finalSummary.slice(0, 500),
          content: finalContent,
          category: row.category,
          embedUrl: row.canonicalUrl,
          embedType: 'facebook',
          facebookMeta: {
            kind: row.detectedKind === 'video' ? 'video' : 'post',
            postText: finalContent || undefined,
            showImage,
            showText,
          },
          mediaItems: [],
        };
      });

      const { createdCount, failedCount } = await onImportPosts(payloads);
      if (createdCount > 0) {
        showToast(
          failedCount > 0 ? 'warning' : 'success',
          `Đã import thành công ${createdCount} bài viết Facebook`,
          failedCount > 0 ? `${failedCount} bài viết gặp lỗi khi lưu.` : undefined
        );
        resetState();
        onClose();
      } else {
        showToast('error', 'Không thể lưu các bài viết Facebook đã chọn');
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0 bg-slate-50/60 dark:bg-slate-900/60">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Import Hàng Loạt Bài Viết Facebook Từ Excel
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Chỉ cần cột danh sách link bài viết Facebook — hệ thống tự động tải nội dung và trích 1 phần nội dung làm tiêu đề (ảnh hiển thị trực tiếp trong khung nhúng).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={publishing}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 text-xs">
          {/* Top Controls Bar */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    downloadFacebookPostsExcelTemplate();
                    showToast('success', 'Đã tải file Excel mẫu import bài viết Facebook');
                  }}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Tải file Excel mẫu</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parsing || publishing}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold shadow-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  {parsing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{fileName ? 'Chọn file Excel khác' : 'Chọn file Excel (.xlsx, .xls, .csv)'}</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {rows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void runBatchFetch(rows)}
                    disabled={fetchingAll || publishing}
                    className="px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${fetchingAll ? 'animate-spin' : ''}`} />
                    <span>{fetchingAll ? 'Đang tải...' : 'Tải lại nội dung'}</span>
                  </button>
                )}
              </div>

              {fileName && (
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate max-w-[260px]">
                  {fileName}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Chuyên mục mặc định:
                </span>
                <select
                  value={defaultCategory}
                  onChange={e => handleApplyDefaultCategoryToAll(e.target.value as Post['category'])}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {POST_CATEGORY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showImage}
                    onChange={e => setShowImage(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span>Hiện ảnh bài viết</span>
                </label>

                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showText}
                    onChange={e => setShowText(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span>Hiện nội dung bài viết</span>
                </label>
              </div>
            </div>
          </div>

          {/* Empty Dropzone State */}
          {rows.length === 0 ? (
            <div
              onDragOver={e => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-10 rounded-3xl border-2 border-dashed transition text-center space-y-3 cursor-pointer ${
                isDragging
                  ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 hover:border-blue-400'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Kéo thả file Excel vào đây hoặc bấm để chọn file
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
                  File Excel chỉ cần chứa danh sách <strong>link bài viết Facebook</strong> (1 cột cũng đọc được).
                  Hệ thống tự tải nội dung từ Facebook và lấy một phần nội dung làm tiêu đề (không lấy tên trang cá nhân / Fanpage); hình ảnh hiển thị trực tiếp trong khung nhúng.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Progress & Selection Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60">
                <div className="flex flex-wrap items-center gap-3">
                  {fetchingAll ? (
                    <span className="inline-flex items-center gap-2 font-bold text-blue-800 dark:text-blue-200">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                      <span>
                        Đang tự động tải nội dung từ Facebook ({fetchProgress.done}/{fetchProgress.total})...
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>
                        Hợp lệ: {stats.validCount}/{stats.total} link · Đã chọn xuất bản: {stats.selectedCount}
                      </span>
                    </span>
                  )}

                  {stats.invalidCount > 0 && (
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      ({stats.invalidCount} dòng không phải link bài viết Facebook hoặc trùng lặp)
                    </span>
                  )}
                </div>

                {stats.validCount > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSelectAllValid(true)}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-600 cursor-pointer"
                    >
                      Chọn tất cả hợp lệ
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSelectAllValid(false)}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-600 cursor-pointer"
                    >
                      Bỏ chọn hết
                    </button>
                  </div>
                )}
              </div>

              {/* Rows Preview & Inline Editor */}
              <div className="space-y-3">
                {rows.map((row, idx) => {
                  const rowDisabled =
                    !row.isValidFacebookLink || row.isNonPostPageOrProfile || row.isDuplicateInFile;

                  return (
                    <div
                      key={row.id}
                      className={`p-4 rounded-2xl border transition space-y-3 ${
                        rowDisabled
                          ? 'bg-slate-50/70 dark:bg-slate-900/40 border-rose-200/80 dark:border-rose-900/50 opacity-75'
                          : row.selected
                          ? 'bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-800 shadow-xs'
                          : 'bg-slate-50/40 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {/* Row Top Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={rowDisabled || publishing}
                            onChange={e => updateRow(row.id, { selected: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                          />
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono font-bold text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                            Dòng {row.rowNumber}
                          </span>

                          {row.fetchStatus === 'fetching' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold text-[11px]">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Đang tải từ Facebook...
                            </span>
                          )}
                          {row.fetchStatus === 'fetched' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                              <CheckCircle2 className="w-3 h-3" />
                              Đã tải nội dung bài viết
                            </span>
                          )}
                          {row.fetchStatus === 'fetched_restricted' && !rowDisabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-semibold text-[11px]">
                              <AlertTriangle className="w-3 h-3" />
                              Facebook hạn chế đọc tự động (vẫn nhúng được link)
                            </span>
                          )}
                          {rowDisabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-semibold text-[11px]">
                              <AlertTriangle className="w-3 h-3" />
                              {row.validationError || 'Không hợp lệ'}
                            </span>
                          )}
                          {!rowDisabled && row.isAlreadyInPosts && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-semibold text-[11px]">
                              Đã có trên Tin Trạm (bỏ chọn mặc định)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!rowDisabled && (
                            <button
                              type="button"
                              onClick={() => {
                                const runId = fetchRunIdRef.current;
                                void fetchSingleRowMetadata(row, idx, runId);
                              }}
                              disabled={row.fetchStatus === 'fetching' || publishing}
                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <RotateCw className={`w-3 h-3 ${row.fetchStatus === 'fetching' ? 'animate-spin' : ''}`} />
                              <span>Tải lại</span>
                            </button>
                          )}
                          {row.canonicalUrl && (
                            <a
                              href={row.canonicalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                            >
                              <span>Mở link</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Link display */}
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate bg-slate-50 dark:bg-slate-800/70 px-3 py-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/70">
                        {row.canonicalUrl || row.rawUrl}
                      </div>

                      {/* Editable Content Fields (only for valid Facebook post rows) */}
                      {!rowDisabled && (
                        <div className="space-y-2.5 pt-1">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                Tiêu đề bài viết (trích từ nội dung, không lấy tên Page/Cá nhân)
                              </label>
                              <input
                                type="text"
                                value={row.title}
                                onChange={e => updateRow(row.id, { title: e.target.value })}
                                placeholder="Tự động lấy từ nội dung bài viết Facebook..."
                                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                Chuyên mục
                              </label>
                              <select
                                value={row.category}
                                onChange={e =>
                                  updateRow(row.id, {
                                    category: e.target.value as Post['category'],
                                  })
                                }
                                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {POST_CATEGORY_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                              Nội dung tải từ Facebook
                            </label>
                            <textarea
                              rows={2}
                              value={row.content}
                              onChange={e => {
                                const nextContent = e.target.value;
                                const patch: Partial<ImportRowState> = { content: nextContent };
                                if (
                                  !row.title ||
                                  row.title.startsWith('Bài viết truyền thông Facebook #')
                                ) {
                                  const autoTitle = deriveFacebookPostTitle(nextContent);
                                  if (autoTitle) patch.title = autoTitle;
                                }
                                updateRow(row.id, patch);
                              }}
                              placeholder="Nội dung công khai được tải từ bài viết Facebook (có thể chỉnh sửa hoặc bổ sung nếu Facebook hạn chế)..."
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-slate-50/60 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={handleClose}
            disabled={publishing}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer disabled:opacity-50"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={handlePublishSelected}
            disabled={publishing || fetchingAll || stats.selectedCount === 0}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition inline-flex items-center gap-1.5 cursor-pointer"
          >
            {publishing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>
              {publishing
                ? 'Đang xuất bản bài viết...'
                : `Xuất bản ${stats.selectedCount} bài viết Facebook`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
