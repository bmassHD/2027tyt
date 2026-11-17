import React, { useState } from 'react';
import {
  X,
  MessageSquare,
  User,
  Phone,
  Mail,
  FileQuestion,
  CheckCircle2,
  Copy,
  AlertCircle,
  EyeOff,
  Check,
} from 'lucide-react';
import {
  createFeedback,
  generateFeedbackTicketCode,
  appendLocalFeedbackHistory,
  getSystemSettings,
  logAuditEvent,
} from '../../services/firebaseService';
import { GitHubService } from '../../services/githubService';
import { getOrCreateDeviceId } from '../../services/systemNotificationService';
import { useAuth } from '../../contexts/AuthContext';
import { FeedbackAttachment, GitHubConfig, SystemSettings } from '../../types';
import { FeedbackAttachmentPicker } from '../common/FeedbackAttachmentPicker';
import {
  autoCompleteGmail,
  isValidEmailAddress,
  normalizeAndValidatePhone,
} from '../../utils/verifiedIdentity';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings?: SystemSettings;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, settings }) => {
  const { currentUser, userProfile } = useAuth();

  const [category, setCategory] = useState<'kham_chua_benh' | 'thai_do_phuc_vu' | 'co_so_vat_chat' | 'thu_tuc_bhyt' | 'y_kien_dong_gop'>('y_kien_dong_gop');
  const [fullName, setFullName] = useState(userProfile?.displayName || '');
  const [email, setEmail] = useState(userProfile?.email || '');
  const [phone, setPhone] = useState(userProfile?.phoneNumber || '');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [content, setContent] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [uploadProgressText, setUploadProgressText] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTicketCode, setCreatedTicketCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const isGhConfiguredInline = Boolean(
    settings?.githubConfig?.token?.trim() &&
      settings?.githubConfig?.owner?.trim() &&
      settings?.githubConfig?.repo?.trim()
  );

  const resolveGitHubConfig = async (): Promise<GitHubConfig | undefined> => {
    if (
      settings?.githubConfig?.token?.trim() &&
      settings?.githubConfig?.owner?.trim() &&
      settings?.githubConfig?.repo?.trim()
    ) {
      return settings.githubConfig;
    }
    try {
      const liveSettings = await getSystemSettings();
      return liveSettings.githubConfig;
    } catch {
      return settings?.githubConfig;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('Vui lòng nhập nội dung phản ánh hoặc góp ý.');
      return;
    }
    if (!isAnonymous && !fullName.trim()) {
      setError('Vui lòng nhập họ tên hoặc chọn chế độ gửi ẩn danh.');
      return;
    }
    const cleanPhone = !isAnonymous ? phone.trim() : '';
    if (cleanPhone && !normalizeAndValidatePhone(cleanPhone)) {
      setError('Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
      return;
    }
    const completedEmail = !isAnonymous && email.trim() ? autoCompleteGmail(email) : '';
    if (!isAnonymous && email.trim()) {
      setEmail(completedEmail);
      if (!isValidEmailAddress(completedEmail)) {
        setError('Địa chỉ Email không hợp lệ.');
        return;
      }
    }

    setLoading(true);
    setError(null);
    setUploadProgressText('Đang gửi...');

    const generatedCode = generateFeedbackTicketCode();
    const nowDate = new Date();
    const nowStr = nowDate.toLocaleString('vi-VN');
    const nowIso = nowDate.toISOString();
    const trimmedContent = content.trim();
    const senderDisplay = isAnonymous ? 'Công dân ẩn danh' : fullName.trim();
    const deviceId = getOrCreateDeviceId();
    const uid = currentUser?.uid || '';

    try {
      const ghConfig = await resolveGitHubConfig();
      const hasGh = Boolean(
        ghConfig?.token?.trim() && ghConfig?.owner?.trim() && ghConfig?.repo?.trim()
      );

      if (attachmentFiles.length > 0 && !hasGh) {
        setError(
          'Hệ thống chưa sẵn sàng tiếp nhận tệp đính kèm. Vui lòng xóa tệp đính kèm để gửi nội dung văn bản.'
        );
        return;
      }

      const uploadedAttachments: FeedbackAttachment[] = [];
      if (attachmentFiles.length > 0 && ghConfig) {
        for (let i = 0; i < attachmentFiles.length; i += 1) {
          const file = attachmentFiles[i];
          setUploadProgressText('Đang gửi...');
          const upRes = await GitHubService.uploadFeedbackAttachment(
            ghConfig,
            file,
            generatedCode,
            senderDisplay
          );
          if (!upRes.success || !upRes.attachment) {
            setError(upRes.error || `Không thể gửi tệp "${file.name}".`);
            return;
          }
          uploadedAttachments.push(upRes.attachment);
        }
      }

      let githubBackupUrl = '';
      if (hasGh && ghConfig) {
        setUploadProgressText('Đang gửi...');
        const backupRecord = {
          ticketCode: generatedCode,
          fullName: senderDisplay,
          email: completedEmail,
          phone: cleanPhone,
          category,
          content: trimmedContent,
          isAnonymous,
          status: 'new',
          uid,
          deviceId,
          createdAt: nowStr,
          createdAtIso: nowIso,
          attachments: uploadedAttachments,
        };
        const backupRes = await GitHubService.uploadJsonContent(
          ghConfig,
          `backups/phan-anh/${generatedCode}.json`,
          backupRecord,
          `Sao lưu phản ánh ${generatedCode} (${uploadedAttachments.length} tệp)`
        );
        if (backupRes.success) {
          githubBackupUrl = backupRes.htmlUrl || backupRes.downloadUrl || '';
        }
      }

      setUploadProgressText('Đang gửi...');

      const createdId = await createFeedback({
        ticketCode: generatedCode,
        fullName: senderDisplay,
        email: completedEmail,
        phone: cleanPhone,
        category,
        content: trimmedContent,
        isAnonymous,
        status: 'new',
        uid,
        deviceId,
        createdAt: nowStr,
        ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
        ...(githubBackupUrl ? { githubBackupUrl } : {}),
      });

      appendLocalFeedbackHistory({
        id: createdId,
        code: generatedCode,
        date: nowStr,
        createdAtIso: nowIso,
        content: trimmedContent,
        sender: isAnonymous ? 'Ẩn danh' : fullName.trim() || 'Người dân',
        category,
        status: 'new',
        uid,
        deviceId,
        ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
        ...(githubBackupUrl ? { githubBackupUrl } : {}),
      });

      await logAuditEvent(
        'Gửi phản ánh - góp ý',
        'Ý kiến công dân',
        `Mã tiếp nhận: ${generatedCode} - Chuyên mục: ${category}${
          uploadedAttachments.length > 0 ? ` - ${uploadedAttachments.length} tệp đính kèm` : ''
        }`,
        { uid: uid || 'guest', name: isAnonymous ? 'Ẩn danh' : fullName }
      );

      setAttachmentFiles([]);
      setCreatedTicketCode(generatedCode);
    } catch (err: unknown) {
      console.error(err);
      setError('Không thể gửi phản ánh. Vui lòng kiểm tra lại kết nối và thử lại.');
    } finally {
      setLoading(false);
      setUploadProgressText(null);
    }
  };

  const copyCode = () => {
    if (createdTicketCode) {
      navigator.clipboard.writeText(createdTicketCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleResetAndClose = () => {
    setCreatedTicketCode(null);
    setError(null);
    setContent('');
    setAttachmentFiles([]);
    setUploadProgressText(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-700 to-emerald-700 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-xs">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg">Tiếp nhận phản ánh & Góp ý kiến</h3>
              <p className="text-xs text-teal-100">Kênh lắng nghe ý kiến nhân dân của Trạm Y tế cơ sở</p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          {createdTicketCode ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-teal-100 flex items-center justify-center text-teal-600 shadow-inner">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-800">Tiếp nhận thành công!</h4>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">
                  Trạm Y tế xin trân trọng cảm ơn ý kiến đóng góp quý báu của quý công dân.
                  Bộ phận chuyên trách sẽ xem xét và phản hồi trong thời gian sớm nhất.
                </p>
              </div>

              {/* Receipt Code */}
              <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-4 text-left space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-teal-800 uppercase tracking-wider">
                    Mã tra cứu biên nhận phản ánh
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-teal-900 text-lg">{createdTicketCode}</span>
                    <button
                      type="button"
                      onClick={copyCode}
                      className="p-1.5 rounded-lg hover:bg-teal-200 text-teal-700 transition cursor-pointer"
                      title="Sao chép mã phản ánh"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-600">
                  Phiếu đã được lưu vào Lịch sử phản ánh. Bạn có thể theo dõi tiến trình hoặc thu hồi tại mục &ldquo;Phản ánh&rdquo;.
                </p>
                {copied && (
                  <p className="text-[11px] text-teal-700 font-medium text-center">
                    ✓ Đã sao chép mã biên nhận!
                  </p>
                )}
              </div>

              <button
                onClick={handleResetAndClose}
                className="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-medium text-sm transition shadow-sm"
              >
                Đóng cửa sổ
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nhóm vấn đề phản ánh <span className="text-rose-500">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-teal-500"
                >
                  <option value="y_kien_dong_gop">Ý kiến đóng góp xây dựng nâng cao chất lượng dịch vụ</option>
                  <option value="kham_chua_benh">Quy trình khám bệnh, chữa bệnh & Cấp phát thuốc</option>
                  <option value="thai_do_phuc_vu">Thái độ phục vụ của nhân viên y tế</option>
                  <option value="thu_tuc_bhyt">Thủ tục BHYT, Chuyển tuyến & Hồ sơ sức khỏe</option>
                  <option value="co_so_vat_chat">Cơ sở vật chất, vệ sinh & trang thiết bị trạm</option>
                </select>
              </div>

              {/* Anonymous Checkbox */}
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  id="anonymousCheck"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="w-4 h-4 text-teal-600 rounded-sm focus:ring-teal-500"
                />
                <label htmlFor="anonymousCheck" className="text-xs text-slate-700 font-medium cursor-pointer flex items-center gap-1.5">
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                  Gửi dưới dạng ẩn danh (Không hiển thị danh tính công khai)
                </label>
              </div>

              {/* Citizen info if not anonymous */}
              {!isAnonymous && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Họ và tên của quý vị <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Họ và tên người gửi"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Số điện thoại liên hệ
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="Số điện thoại (10 số)"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Địa chỉ Email nhận phản hồi
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          inputMode="email"
                          placeholder="Tên Gmail hoặc email@gmail.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onBlur={() => setEmail((v) => autoCompleteGmail(v))}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Content */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nội dung chi tiết <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <FileQuestion className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <textarea
                    rows={4}
                    required
                    placeholder="Mô tả cụ thể sự việc, thời gian xảy ra, khoa phòng liên quan hoặc ý kiến đề xuất cải thiện chất lượng phục vụ..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  * Mọi thông tin phản ánh được xử lý nghiêm túc, khách quan và bảo vệ bí mật thông tin người gửi theo quy định của pháp luật.
                </p>
              </div>

              {/* Attachments (<= 20MB, saved to GitHub) */}
              <div className="pt-1 border-t border-slate-100">
                <FeedbackAttachmentPicker
                  files={attachmentFiles}
                  onChange={setAttachmentFiles}
                  onValidationError={msg => setError(msg)}
                  disabled={loading}
                  isGitHubConfigured={settings ? isGhConfiguredInline : true}
                  uploadProgressText={uploadProgressText}
                />
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleResetAndClose}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium text-sm transition shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Đang gửi...' : 'Gửi ý kiến phản ánh'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
