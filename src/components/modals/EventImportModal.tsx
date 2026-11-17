import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Upload,
  Repeat,
} from 'lucide-react';
import { ParsedEventImportRow, EVENT_CATEGORY_LABELS } from '../../utils/eventExcelUtils';
import { createStationEvent, formatIsoDateVN, logAuditEvent } from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface EventImportModalProps {
  rows: ParsedEventImportRow[];
  onClose: () => void;
}

export const EventImportModal: React.FC<EventImportModalProps> = ({ rows, onClose }) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast } = useToast();

  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importing, setImporting] = useState(false);

  const validRows = useMemo(
    () => rows.filter(r => !r.error && (!skipDuplicates || !r.isDuplicate)),
    [rows, skipDuplicates]
  );
  const errorCount = useMemo(() => rows.filter(r => Boolean(r.error)).length, [rows]);
  const duplicateCount = useMemo(
    () => rows.filter(r => !r.error && r.isDuplicate).length,
    [rows]
  );

  const handleConfirmImport = async () => {
    if (validRows.length === 0) {
      showToast('warning', 'Không có sự kiện hợp lệ để import');
      return;
    }

    setImporting(true);
    try {
      let imported = 0;
      for (let i = 0; i < validRows.length; i += 10) {
        const batch = validRows.slice(i, i + 10);
        await Promise.all(
          batch.map(async row => {
            await createStationEvent({
              title: row.title,
              eventDate: row.eventDate,
              endDate: row.endDate,
              startTime: row.startTime,
              endTime: row.endTime,
              location: row.location,
              category: row.category,
              description: row.description,
              greetingMessage: row.greetingMessage,
              enableConfetti: row.enableConfetti,
              enableAutoPopup: row.enableAutoPopup,
              isAnnual: row.isAnnual,
              isActive: row.isActive,
              createdBy: currentUser?.uid,
            });
            imported++;
          })
        );
      }

      await logAuditEvent(
        'Import danh sách sự kiện từ Excel',
        'Sự kiện',
        `Đã import ${imported} sự kiện từ file Excel`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );

      showToast(
        'success',
        `Đã import thành công ${imported} sự kiện`,
        'Khi đến ngày diễn ra, hệ thống sẽ tự động hiển thị thông báo và pháo giấy chúc mừng.'
      );
      onClose();
    } catch (err: any) {
      showToast('error', 'Import sự kiện thất bại', err?.message || 'Vui lòng kiểm tra quyền quản trị.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
      onClick={e => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Xem Trước Dữ Liệu Import Sự Kiện (Excel)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tổng cộng {rows.length} dòng · Hợp lệ sẵn sàng lưu:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">{validRows.length}</strong>
                {duplicateCount > 0 ? ` · Trùng lặp: ${duplicateCount}` : ''}
                {errorCount > 0 ? ` · Lỗi dữ liệu: ${errorCount}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options bar */}
        {duplicateCount > 0 && (
          <div className="px-6 py-3 bg-amber-50/70 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-800/50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-amber-800 dark:text-amber-300 font-medium inline-flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Phát hiện {duplicateCount} sự kiện trùng tên và ngày diễn ra với dữ liệu hiện tại.
            </span>
            <label className="inline-flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={e => setSkipDuplicates(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>Bỏ qua dòng trùng lặp</span>
            </label>
          </div>
        )}

        {/* Table preview */}
        <div className="flex-1 overflow-auto p-4 sm:p-5">
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Dòng</th>
                  <th className="py-2.5 px-3">Tên sự kiện &amp; Lời chúc</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Ngày diễn ra</th>
                  <th className="py-2.5 px-3">Phân loại</th>
                  <th className="py-2.5 px-3">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map(row => {
                  const willSkip = Boolean(row.error) || (skipDuplicates && row.isDuplicate);
                  return (
                    <tr
                      key={row.rowNum}
                      className={
                        willSkip
                          ? 'bg-slate-50/80 dark:bg-slate-900/50 opacity-65'
                          : 'hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20'
                      }
                    >
                      <td className="py-2.5 px-3 font-mono text-slate-500 tabular-nums">
                        #{row.rowNum}
                      </td>
                      <td className="py-2.5 px-3 max-w-sm">
                        <div className="font-bold text-slate-900 dark:text-white line-clamp-2">
                          {row.title || '—'}
                        </div>
                        {row.location && (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            Địa điểm: {row.location}
                          </div>
                        )}
                        {row.greetingMessage && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 italic line-clamp-1 mt-0.5">
                            “{row.greetingMessage}”
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {row.eventDate ? formatIsoDateVN(row.eventDate) : '—'}
                        </div>
                        {row.endDate && (
                          <div className="text-[11px] text-slate-500">
                            đến {formatIsoDateVN(row.endDate)}
                          </div>
                        )}
                        {row.isAnnual && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-700 dark:text-teal-400 mt-0.5">
                            <Repeat className="w-3 h-3" /> Hằng năm
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {EVENT_CATEGORY_LABELS[row.category]}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.error ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-bold text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{row.error}</span>
                          </span>
                        ) : row.isDuplicate ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-semibold text-[11px]">
                            {skipDuplicates ? 'Bỏ qua (Trùng)' : 'Vẫn thêm mới'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold text-[11px]">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Sẵn sàng</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={importing || validRows.length === 0}
            onClick={handleConfirmImport}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
          >
            {importing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span>
              {importing
                ? 'Đang lưu dữ liệu...'
                : `Xác nhận Import (${validRows.length} sự kiện)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
