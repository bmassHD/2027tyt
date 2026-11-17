import React, { useRef } from 'react';
import {
  Paperclip,
  Trash2,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import {
  classifyAttachmentKind,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_ATTACHMENTS,
} from '../../services/githubService';
import { formatAttachmentSize } from './FeedbackAttachmentViewer';

interface FeedbackAttachmentPickerProps {
  files: File[];
  onChange: (nextFiles: File[]) => void;
  onValidationError: (message: string) => void;
  disabled?: boolean;
  isGitHubConfigured?: boolean;
  uploadProgressText?: string | null;
}

const ACCEPTED_TYPES =
  'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.rtf,.zip,.rar,.7z';

export const FeedbackAttachmentPicker: React.FC<FeedbackAttachmentPickerProps> = ({
  files,
  onChange,
  onValidationError,
  disabled = false,
  isGitHubConfigured = true,
  uploadProgressText,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;

    const rejectedMessages: string[] = [];
    const nextFiles = [...files];

    for (const file of picked) {
      if (file.size <= 0) {
        rejectedMessages.push(`Tệp "${file.name}" bị rỗng (0 byte).`);
        continue;
      }
      if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
        rejectedMessages.push(
          `Tệp "${file.name}" (${formatAttachmentSize(file.size)}) vượt quá giới hạn tối đa 20MB.`
        );
        continue;
      }
      if (nextFiles.length >= MAX_FEEDBACK_ATTACHMENTS) {
        rejectedMessages.push(`Chỉ được đính kèm tối đa ${MAX_FEEDBACK_ATTACHMENTS} tệp cho mỗi phản ánh.`);
        break;
      }
      const alreadyExists = nextFiles.some(
        existing =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified
      );
      if (!alreadyExists) {
        nextFiles.push(file);
      }
    }

    onChange(nextFiles);

    if (rejectedMessages.length > 0) {
      onValidationError(rejectedMessages[0]);
    }
  };

  const removeFileAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span>Tệp đính kèm minh chứng (tùy chọn)</span>
        </label>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Ảnh, video, tài liệu · Tối đa {MAX_FEEDBACK_ATTACHMENTS} tệp (≤ 20MB/tệp)
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        disabled={disabled || files.length >= MAX_FEEDBACK_ATTACHMENTS}
        onChange={handleFilesSelected}
        className="hidden"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || files.length >= MAX_FEEDBACK_ATTACHMENTS}
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 rounded-xl border border-dashed border-teal-400/80 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/30 hover:bg-teal-50 dark:hover:bg-teal-950/60 text-teal-800 dark:text-teal-300 text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span>
            {files.length >= MAX_FEEDBACK_ATTACHMENTS
              ? `Đã đạt tối đa ${MAX_FEEDBACK_ATTACHMENTS} tệp`
              : 'Chọn tệp / hình ảnh / video (≤ 20MB)'}
          </span>
        </button>
      </div>

      {!isGitHubConfigured && files.length > 0 && (
        <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <span>
            Kho lưu trữ GitHub chưa được Quản trị viên cấu hình. Vui lòng xóa tệp đính kèm để gửi phản ánh văn bản, hoặc liên hệ Quản trị viên kích hoạt lưu trữ GitHub.
          </span>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((file, idx) => {
            const kind = classifyAttachmentKind(file.name, file.type);
            return (
              <div
                key={`${file.name}_${file.size}_${file.lastModified}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-teal-600 dark:text-teal-400 shrink-0">
                    {kind === 'image' ? (
                      <ImageIcon className="w-4 h-4" />
                    ) : kind === 'video' ? (
                      <Film className="w-4 h-4" />
                    ) : kind === 'audio' ? (
                      <Music className="w-4 h-4" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {file.name}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatAttachmentSize(file.size)} ·{' '}
                      {kind === 'image'
                        ? 'Hình ảnh'
                        : kind === 'video'
                        ? 'Video'
                        : kind === 'audio'
                        ? 'Âm thanh'
                        : 'Tài liệu / Tệp'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeFileAt(idx)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer disabled:opacity-40"
                  title="Bỏ tệp này"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {uploadProgressText && (
        <p className="text-[11px] font-semibold text-teal-700 dark:text-teal-300 animate-pulse">
          {uploadProgressText}
        </p>
      )}
    </div>
  );
};
