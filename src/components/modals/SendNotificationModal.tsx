import React, { useState } from 'react';
import { X, Send, Bell, BellRing } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { createTargetedNotification, logAuditEvent } from '../../services/firebaseService';
import {
  broadcastPushNotification,
  FallbackPushSubscriptionInput,
} from '../../services/systemNotificationService';
import { PushSubscriptionRecord } from '../../types';

interface SendNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const SendNotificationModal: React.FC<SendNotificationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast } = useToast();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [targetType, setTargetType] = useState<'all' | 'individual' | 'organization' | 'bulk_cccd'>('all');
  const [targetCccd, setTargetCccd] = useState('');
  const [targetPhone, setTargetPhone] = useState('');
  const [targetOrgName, setTargetOrgName] = useState('');
  const [priority, setPriority] = useState<'hoatoc' | 'khan' | 'binhthuong'>('khan');
  const [pushToDevice, setPushToDevice] = useState(true);
  const [expirationHours, setExpirationHours] = useState('72'); // default 3 days
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSubmitting(true);
    try {
      let expiresAt: string | undefined = undefined;
      if (expirationHours !== 'never') {
        const hoursNum = parseInt(expirationHours, 10) || 72;
        expiresAt = new Date(Date.now() + hoursNum * 3600 * 1000).toISOString();
      }

      const shouldPushUrgent = pushToDevice || priority === 'khan' || priority === 'hoatoc';

      const notifId = await createTargetedNotification({
        title: title.trim(),
        content: content.trim(),
        targetType,
        targetCccd: targetCccd.trim() || undefined,
        targetPhone: targetPhone.trim() || undefined,
        targetOrgName: targetOrgName.trim() || undefined,
        priority,
        pushToDevice: shouldPushUrgent,
        expiresAt,
        createdBy: userProfile?.displayName || currentUser?.email || 'Quản trị viên',
      });

      let broadcastSentCount = 0;
      if (shouldPushUrgent) {
        let fallbackSubscriptions: FallbackPushSubscriptionInput[] = [];
        try {
          const snap = await getDocs(collection(db, 'pushSubscriptions'));
          fallbackSubscriptions = snap.docs
            .map(d => d.data() as PushSubscriptionRecord)
            .filter(rec => rec?.endpoint && rec?.keys?.p256dh && rec?.keys?.auth)
            .map(rec => ({
              deviceId: rec.deviceId,
              endpoint: rec.endpoint,
              keys: rec.keys,
              uid: rec.uid,
              citizenId: rec.citizenId,
              phoneNumber: rec.phoneNumber,
              department: rec.department,
            }));
        } catch {
          // Non-blocking fallback if Firestore subscriptions list cannot be fetched
        }

        const pushRes = await broadcastPushNotification({
          notificationId: notifId,
          title: title.trim(),
          content: content.trim(),
          priority: priority === 'binhthuong' ? 'khan' : priority,
          targetType,
          targetCccd: targetCccd.trim() || undefined,
          targetPhone: targetPhone.trim() || undefined,
          targetOrgName: targetOrgName.trim() || undefined,
          fallbackSubscriptions,
        });
        broadcastSentCount = pushRes.sent || 0;
      }

      await logAuditEvent(
        'Gửi thông báo',
        'Thông báo',
        `Tiêu đề: ${title} (${priority})${shouldPushUrgent ? ' • Đẩy thiết bị SW/PWA' : ''}`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );

      showToast(
        'success',
        shouldPushUrgent
          ? 'Đã ban hành thông báo khẩn đến hệ thống thiết bị (PWA / SW)'
          : 'Đã ban hành thông báo thành công',
        broadcastSentCount > 0
          ? `Đã phát thông báo đẩy nền tới ${broadcastSentCount} thiết bị đã đăng ký.`
          : shouldPushUrgent
          ? 'Các thiết bị đang mở hoặc đã bật thông báo sẽ nhận cảnh báo hệ thống ngay lập tức.'
          : undefined
      );
      if (onSuccess) onSuccess();
      onClose();
      setTitle('');
      setContent('');
      setTargetCccd('');
      setTargetPhone('');
      setTargetOrgName('');
      setPriority('khan');
      setPushToDevice(true);
    } catch (err: any) {
      showToast('error', 'Không thể ban hành thông báo', err?.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-600" />
            Ban Hành Thông Báo / Tin Khẩn
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tiêu đề thông báo *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Thông báo tiêm chủng / Lịch bổ sung vitamin A..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Mức độ ưu tiên
              </label>
              <select
                value={priority}
                onChange={e => {
                  const next = e.target.value as 'hoatoc' | 'khan' | 'binhthuong';
                  setPriority(next);
                  if (next === 'khan' || next === 'hoatoc') {
                    setPushToDevice(true);
                  }
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
              >
                <option value="khan">Khẩn cấp (Thông báo thiết bị)</option>
                <option value="hoatoc">Hỏa tốc (Bật chuông/Cảnh báo)</option>
                <option value="binhthuong">Bình thường</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Thời gian hiển thị (Tự động ẩn)
              </label>
              <select
                value={expirationHours}
                onChange={e => setExpirationHours(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="24">24 giờ (1 ngày)</option>
                <option value="72">72 giờ (3 ngày)</option>
                <option value="168">7 ngày</option>
                <option value="720">30 ngày</option>
                <option value="never">Không hết hạn</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 cursor-pointer">
            <input
              type="checkbox"
              checked={pushToDevice || priority === 'khan' || priority === 'hoatoc'}
              onChange={e => setPushToDevice(e.target.checked)}
              disabled={priority === 'khan' || priority === 'hoatoc'}
              className="mt-0.5 w-4 h-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
            />
            <div className="space-y-0.5 leading-snug">
              <div className="font-bold text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>Gửi thông báo khẩn bằng hệ thống thiết bị (Service Worker &amp; PWA)</span>
              </div>
              <p className="text-[11px] text-rose-700 dark:text-rose-300/90">
                Phát thông báo đẩy nền Web Push &amp; hiển thị thông báo hệ thống trên điện thoại/máy tính của người dùng ngay khi ban hành.
              </p>
            </div>
          </label>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Đối tượng nhận thông báo
            </label>
            <select
              value={targetType}
              onChange={e => setTargetType(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">Tất cả công dân &amp; cán bộ</option>
              <option value="bulk_cccd">Cá nhân / Hàng loạt theo Số CCCD</option>
              <option value="individual">Số Điện thoại cá nhân</option>
              <option value="organization">Tổ chức / Phòng ban y tế</option>
            </select>
          </div>

          {(targetType === 'bulk_cccd' || targetType === 'individual') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Số CCCD định danh *
                </label>
                <input
                  type="text"
                  value={targetCccd}
                  onChange={e => setTargetCccd(e.target.value)}
                  placeholder="079095012345"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Số Điện thoại nhận
                </label>
                <input
                  type="text"
                  value={targetPhone}
                  onChange={e => setTargetPhone(e.target.value)}
                  placeholder="0909xxxxxx"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>
            </div>
          )}

          {targetType === 'organization' && (
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tên Tổ chức / Khoa phòng *
              </label>
              <input
                type="text"
                value={targetOrgName}
                onChange={e => setTargetOrgName(e.target.value)}
                placeholder="Khoa Khám bệnh, Tổ Dân phố 12..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nội dung chi tiết *
            </label>
            <textarea
              rows={5}
              required
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Nhập toàn văn thông báo..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? 'Đang phát...' : 'Phát thông báo khẩn'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
