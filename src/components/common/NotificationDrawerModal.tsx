import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  X,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Trash2,
  Check,
  Eye,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { TargetedNotification } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  markNotificationViewed,
  deleteTargetedNotification,
  savePushSubscriptionRecord,
} from '../../services/firebaseService';
import {
  getOrCreateDeviceId,
  getSeenUrgentIds,
  markUrgentSeen,
  requestSystemNotificationPermission,
  setDeviceNotificationEnabled,
  subscribeDeviceToWebPush,
} from '../../services/systemNotificationService';

interface NotificationDrawerModalProps {
  isOpen: boolean;
  onClose: () => void;
  focusedNotificationId?: string | null;
}

export const NotificationDrawerModal: React.FC<NotificationDrawerModalProps> = ({
  isOpen,
  onClose,
  focusedNotificationId,
}) => {
  const { currentUser, userProfile, isAdmin } = useAuth();
  const { showToast } = useToast();

  const [notifications, setNotifications] = useState<TargetedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [permStatus, setPermStatus] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  );
  const [locallySeenIds, setLocallySeenIds] = useState<Set<string>>(() => getSeenUrgentIds());

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const deviceId = getOrCreateDeviceId();

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermStatus(Notification.permission);
    }
    if (isOpen) {
      setLocallySeenIds(getSeenUrgentIds());
    }
  }, [isOpen]);

  const handleEnableDeviceNotifications = async () => {
    const res = await requestSystemNotificationPermission();
    setPermStatus(res);
    if (res === 'granted') {
      setDeviceNotificationEnabled(true);
      const pushRes = await subscribeDeviceToWebPush({
        uid: currentUser?.uid,
        citizenId: userProfile?.citizenId,
        phoneNumber: userProfile?.phoneNumber,
        department: userProfile?.department,
      });
      if (pushRes.ok && pushRes.subscription) {
        const subJson = pushRes.subscription.toJSON();
        if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
          void savePushSubscriptionRecord({
            deviceId,
            endpoint: subJson.endpoint,
            keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
            uid: currentUser?.uid,
            citizenId: userProfile?.citizenId,
            phoneNumber: userProfile?.phoneNumber,
            department: userProfile?.department,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      showToast(
        'success',
        'Đã bật thông báo nền trên thiết bị',
        'Bạn sẽ nhận được thông báo bất kỳ lúc nào, ngay cả khi chưa mở ứng dụng.'
      );
    } else if (res === 'denied') {
      showToast(
        'warning',
        'Trình duyệt đã chặn thông báo',
        'Vui lòng cấp quyền Thông báo trong phần cài đặt trang web của trình duyệt.'
      );
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const q = query(collection(db, 'targetedNotifications'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        const rawList = snap.docs.map(d => ({ id: d.id, ...d.data() } as TargetedNotification));
        const now = Date.now();
        const activeList = rawList.filter(n => {
          if (n.expiresAt) {
            const expTime = new Date(n.expiresAt).getTime();
            if (expTime <= now) return false;
          }
          return true;
        });

        setNotifications(activeList);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [isOpen]);

  // Auto-focus and mark focused notification viewed when opened via OS push click
  useEffect(() => {
    if (!isOpen || !focusedNotificationId || loading) return;

    markUrgentSeen(focusedNotificationId);
    setLocallySeenIds(getSeenUrgentIds());
    void markNotificationViewed(focusedNotificationId, currentUser?.uid);

    const timer = window.setTimeout(() => {
      const el = cardRefs.current[focusedNotificationId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [isOpen, focusedNotificationId, loading, notifications.length, currentUser?.uid]);

  if (!isOpen) return null;

  const visibleNotifications = notifications.filter(n => {
    if (isAdmin) return true;
    if (n.targetType === 'all') return true;

    const cccdMatch =
      userProfile?.citizenId &&
      n.targetCccd &&
      userProfile.citizenId.trim() === n.targetCccd.trim();

    const phoneMatch =
      userProfile?.phoneNumber &&
      n.targetPhone &&
      userProfile.phoneNumber.trim() === n.targetPhone.trim();

    const uidMatch = currentUser?.uid && n.targetCccd === currentUser.uid;

    const orgMatch =
      userProfile?.department &&
      n.targetOrgName &&
      userProfile.department.toLowerCase().includes(n.targetOrgName.toLowerCase());

    return Boolean(cccdMatch || phoneMatch || uidMatch || orgMatch);
  });

  const isNotificationRead = (n: TargetedNotification): boolean => {
    if (currentUser && n.readByUids?.includes(currentUser.uid)) return true;
    if (n.readByDeviceIds?.includes(deviceId)) return true;
    if (locallySeenIds.has(n.id)) return true;
    return false;
  };

  const unreadCount = visibleNotifications.filter(n => !isNotificationRead(n)).length;

  const handleMarkAsRead = async (id: string) => {
    markUrgentSeen(id);
    setLocallySeenIds(getSeenUrgentIds());
    await markNotificationViewed(id, currentUser?.uid);
  };

  const handleMarkAllRead = async () => {
    const unreadList = visibleNotifications.filter(n => !isNotificationRead(n));
    unreadList.forEach(n => markUrgentSeen(n.id));
    setLocallySeenIds(getSeenUrgentIds());
    await Promise.allSettled(
      unreadList.map(n => markNotificationViewed(n.id, currentUser?.uid))
    );
    showToast('success', 'Đã đánh dấu đã xem tất cả thông báo');
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTargetedNotification(id);
      showToast('success', 'Đã xóa thông báo thành công');
    } catch (err: any) {
      showToast('error', 'Không thể xóa thông báo', err?.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full flex flex-col shadow-2xl border-l border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 relative shrink-0">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                Trung Tâm Thông Báo ({visibleNotifications.length})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {unreadCount > 0
                  ? `${unreadCount} thông báo chưa đọc`
                  : 'Đã xem toàn bộ thông báo'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition cursor-pointer whitespace-nowrap"
              >
                Xem hết
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              aria-label="Đóng thông báo"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Device System Notification Permission Bar */}
        {typeof window !== 'undefined' && 'Notification' in window && permStatus !== 'granted' && (
          <div className="mx-4 mt-3 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-center justify-between gap-3">
            <div className="text-xs text-amber-900 dark:text-amber-200 leading-snug">
              <strong className="block">Nhận thông báo kể cả khi đóng app</strong>
              <span className="opacity-85">
                {permStatus === 'denied'
                  ? 'Quyền thông báo đang bị chặn trên trình duyệt.'
                  : 'Cho phép để nhận thông báo đẩy tự động trên thiết bị.'}
              </span>
            </div>
            {permStatus === 'default' && (
              <button
                type="button"
                onClick={handleEnableDeviceNotifications}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold whitespace-nowrap transition cursor-pointer shrink-0"
              >
                Bật ngay
              </button>
            )}
          </div>
        )}

        {/* Notification List Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p>Đang tải thông báo...</p>
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="py-16 text-center space-y-3 text-slate-400">
              <Bell className="w-10 h-10 stroke-1 mx-auto text-slate-300" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  Không có thông báo nào
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Hiện chưa có thông báo mới gửi đến thiết bị của bạn.
                </p>
              </div>
            </div>
          ) : (
            visibleNotifications.map(item => {
              const isRead = isNotificationRead(item);
              const isFocused = focusedNotificationId === item.id;
              const viewsCount = Math.max(
                item.viewCount || 0,
                (item.readByDeviceIds || []).length,
                (item.readByUids || []).length
              );

              return (
                <div
                  key={item.id}
                  ref={el => {
                    cardRefs.current[item.id] = el;
                  }}
                  className={`p-4 rounded-2xl border transition space-y-2.5 relative ${
                    isFocused
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 ring-2 ring-emerald-500/40 shadow-md'
                      : isRead
                      ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-85'
                      : 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 shadow-sm'
                  }`}
                >
                  {/* Metadata Header Strip (Zero-Pill) */}
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                      {item.priority === 'hoatoc' ? (
                        <span className="font-extrabold text-rose-700 dark:text-rose-400 inline-flex items-center gap-1">
                          <Flame className="w-3.5 h-3.5 shrink-0" />
                          <span>HỎA TỐC</span>
                        </span>
                      ) : item.priority === 'khan' ? (
                        <span className="font-extrabold text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>KHẨN</span>
                        </span>
                      ) : (
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                          Thông báo
                        </span>
                      )}

                      {(item.targetType === 'bulk_cccd' || item.targetCccd) && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="font-mono text-slate-600 dark:text-slate-300">
                            CCCD: {item.targetCccd}
                          </span>
                        </>
                      )}

                      {item.targetType === 'organization' && item.targetOrgName && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="font-mono text-blue-700 dark:text-blue-300">
                            {item.targetOrgName}
                          </span>
                        </>
                      )}
                    </div>

                    <span className="text-slate-400 font-mono tabular-nums shrink-0">
                      {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>

                  {/* Title & Content */}
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                      {item.title}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {item.content}
                    </p>
                  </div>

                  {/* Action Bar */}
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                    {!isRead ? (
                      <button
                        type="button"
                        onClick={() => handleMarkAsRead(item.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold flex items-center gap-1.5 cursor-pointer transition"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Đánh dấu đã xem</span>
                      </button>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Đã xem</span>
                      </span>
                    )}

                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 tabular-nums">
                          <Eye className="w-3.5 h-3.5" />
                          <span>{viewsCount}</span>
                        </span>
                      )}

                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                          title="Xóa thông báo này"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
