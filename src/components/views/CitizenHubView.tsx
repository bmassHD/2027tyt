import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  MessageSquare,
  Clock,
  CheckCircle2,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Activity,
  Send,
  RotateCcw,
  Ban,
  Lock,
  Paperclip,
  Copy,
  Check,
} from 'lucide-react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { normalizeAndValidatePhone } from '../../utils/verifiedIdentity';
import { db } from '../../firebase/config';
import { FeedbackAttachment, FeedbackItem, GitHubConfig, SystemSettings } from '../../types';
import {
  createFeedback,
  withdrawFeedback,
  generateFeedbackTicketCode,
  loadLocalFeedbackHistory,
  loadScopedLocalFeedbackHistory,
  appendLocalFeedbackHistory,
  updateLocalFeedbackHistoryItem,
  parseVietnameseOrIsoDateMs,
  FEEDBACK_HISTORY_EVENT,
  LocalFeedbackHistoryItem,
  getSystemSettings,
  logAuditEvent,
} from '../../services/firebaseService';
import { GitHubService } from '../../services/githubService';
import { getOrCreateDeviceId } from '../../services/systemNotificationService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { BacSiChoMoiNhaSection } from '../portal/BacSiChoMoiNhaSection';
import { FeedbackAttachmentPicker } from '../common/FeedbackAttachmentPicker';
import { FeedbackAttachmentViewer } from '../common/FeedbackAttachmentViewer';

interface CitizenHubViewProps {
  initialTab?: 'telehealth' | 'tracking' | 'feedback' | 'feedback_tracking';
  settings?: SystemSettings;
}

const WITHDRAWABLE_STATUSES: FeedbackItem['status'][] = ['new', 'processing', 'forwarded'];
const HISTORY_PAGE_SIZE = 10;

export const CitizenHubView: React.FC<CitizenHubViewProps> = ({
  initialTab = 'telehealth',
  settings,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast, showConfirm } = useToast();
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const currentUid = currentUser?.uid || '';

  // Route separation: /#bac-si-cho-moi-nha (telehealth) vs /#phan-anh (feedback_tracking)
  const isTelehealthMode = initialTab === 'telehealth';

  // Sub-view inside /#phan-anh: 'form' | 'history_detail'
  const [subView, setSubView] = useState<'form' | 'history_detail'>(
    initialTab === 'tracking' ? 'history_detail' : 'form'
  );

  useEffect(() => {
    if (initialTab === 'tracking') {
      setSubView('history_detail');
    } else if (initialTab === 'feedback') {
      setSubView('form');
    }
  }, [initialTab]);

  // Tracking & Selected Ticket State
  const [trackKeyword, setTrackKeyword] = useState('');
  const [trackSearching, setTrackSearching] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<FeedbackItem | null>(null);
  const [fetchedFeedbackMap, setFetchedFeedbackMap] = useState<Record<string, FeedbackItem>>({});
  const [firestoreOwnItems, setFirestoreOwnItems] = useState<FeedbackItem[]>([]);
  const [localHistoryItems, setLocalHistoryItems] = useState<LocalFeedbackHistoryItem[]>(() =>
    loadScopedLocalFeedbackHistory(currentUid, deviceId)
  );
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [withdrawingCode, setWithdrawingCode] = useState<string | null>(null);

  // Feedback Form State
  const [fbCategory, setFbCategory] = useState<FeedbackItem['category']>('y_kien_dong_gop');
  const [fbName, setFbName] = useState(userProfile?.displayName || '');
  const [fbPhone, setFbPhone] = useState(userProfile?.phoneNumber || '');
  const [fbIsAnon, setFbIsAnon] = useState(false);
  const [fbContent, setFbContent] = useState('');
  const [fbAttachmentFiles, setFbAttachmentFiles] = useState<File[]>([]);
  const [fbUploadProgress, setFbUploadProgress] = useState<string | null>(null);
  const [fbSubmitting, setFbSubmitting] = useState(false);
  const [createdFbCode, setCreatedFbCode] = useState<string | null>(null);
  const [copiedFbCode, setCopiedFbCode] = useState<string | null>(null);

  const handleCopyTicketCode = (code: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedFbCode(code);
    showToast('success', 'Đã sao chép mã phản ánh', code);
    window.setTimeout(() => {
      setCopiedFbCode((prev) => (prev === code ? null : prev));
    }, 2200);
  };

  // Sync profile data to feedback form if logged in
  useEffect(() => {
    if (userProfile) {
      if (!fbName) setFbName(userProfile.displayName || '');
      if (!fbPhone) setFbPhone(userProfile.phoneNumber || '');
    }
  }, [userProfile, fbName, fbPhone]);

  // Reset in-memory feedback state & re-scope local history whenever user identity changes
  useEffect(() => {
    setSelectedTicket(null);
    setFetchedFeedbackMap({});
    setFirestoreOwnItems([]);
    setTrackKeyword('');
    setHistoryPage(1);
    setLocalHistoryItems(loadScopedLocalFeedbackHistory(currentUid, deviceId));
  }, [currentUid, deviceId]);

  // Keep local feedback history synchronized across tabs/modals (strictly scoped to current user/device)
  useEffect(() => {
    const syncLocal = () =>
      setLocalHistoryItems(loadScopedLocalFeedbackHistory(currentUid, deviceId));
    window.addEventListener(FEEDBACK_HISTORY_EVENT, syncLocal);
    window.addEventListener('storage', syncLocal);
    return () => {
      window.removeEventListener(FEEDBACK_HISTORY_EVENT, syncLocal);
      window.removeEventListener('storage', syncLocal);
    };
  }, [currentUid, deviceId]);

  // Merge user's Firestore feedbacks + scoped local feedbacks (newest first)
  const historyItems = useMemo(() => {
    const merged = new Map<string, LocalFeedbackHistoryItem>();

    for (const localItem of localHistoryItems) {
      merged.set(localItem.code.toUpperCase(), localItem);
    }

    if (currentUid) {
      for (const fb of firestoreOwnItems) {
        if (fb.uid !== currentUid) continue;
        const code = (fb.ticketCode || fb.id).toUpperCase();
        const existing = merged.get(code);
        const parsedMs = parseVietnameseOrIsoDateMs(
          fb.createdAt,
          existing?.createdAtIso || fb.updatedAt
        );
        const createdAtIso =
          existing?.createdAtIso ||
          (!Number.isNaN(parsedMs) ? new Date(parsedMs).toISOString() : new Date().toISOString());

        merged.set(code, {
          id: fb.id,
          code: fb.ticketCode || fb.id,
          date: fb.createdAt || existing?.date || '',
          createdAtIso,
          content: fb.content || existing?.content || '',
          sender: fb.isAnonymous ? 'Ẩn danh' : fb.fullName || existing?.sender || 'Công dân',
          category: fb.category || existing?.category,
          status: fb.status,
          withdrawnAt: fb.withdrawnAt || existing?.withdrawnAt,
          attachments: fb.attachments || existing?.attachments,
          githubBackupUrl: fb.githubBackupUrl || existing?.githubBackupUrl,
          uid: fb.uid,
          deviceId: fb.deviceId || existing?.deviceId,
        });
      }
    }

    return Array.from(merged.values()).sort((a, b) => {
      const msA = parseVietnameseOrIsoDateMs(a.date, a.createdAtIso) || 0;
      const msB = parseVietnameseOrIsoDateMs(b.date, b.createdAtIso) || 0;
      return msB - msA;
    });
  }, [localHistoryItems, firestoreOwnItems, currentUid]);

  const totalHistoryPages = Math.max(1, Math.ceil(historyItems.length / HISTORY_PAGE_SIZE));
  useEffect(() => {
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [historyPage, totalHistoryPages]);

  const isOwnedFeedback = useCallback(
    (fb: FeedbackItem | null | undefined): boolean => {
      if (!fb) return false;
      if (currentUid) {
        return fb.uid === currentUid;
      }
      return (!fb.uid || fb.uid === '') && fb.deviceId === deviceId;
    },
    [currentUid, deviceId]
  );

  const toFallbackTicket = useCallback(
    (item: LocalFeedbackHistoryItem): FeedbackItem => ({
      id: item.id || item.code,
      ticketCode: item.code,
      fullName: item.sender || 'Công dân',
      category: item.category || 'y_kien_dong_gop',
      content: item.content,
      isAnonymous: item.sender === 'Ẩn danh',
      status: item.status || 'new',
      assignedDepartment: 'Ban tiếp công dân - Trạm Y tế',
      attachments: item.attachments,
      githubBackupUrl: item.githubBackupUrl,
      uid: item.uid || '',
      deviceId: item.deviceId || deviceId,
      createdAt: item.date,
      withdrawnAt: item.withdrawnAt,
    }),
    [deviceId]
  );

  // Sync local history & selected ticket from Firestore documents
  const applyOwnFeedbackDocs = useCallback(
    (docsList: FeedbackItem[]) => {
      const nextMap: Record<string, FeedbackItem> = {};
      const ownList: FeedbackItem[] = [];

      docsList.forEach(item => {
        if (item.uid !== currentUid) return;
        ownList.push(item);
        if (item.ticketCode) nextMap[item.ticketCode.toUpperCase()] = item;
        nextMap[item.id.toUpperCase()] = item;
      });

      const allLocal = loadLocalFeedbackHistory();
      for (const localItem of allLocal) {
        const docItem =
          nextMap[localItem.code.toUpperCase()] ||
          (localItem.id ? nextMap[localItem.id.toUpperCase()] : undefined);
        if (
          docItem &&
          (docItem.id !== localItem.id ||
            docItem.status !== localItem.status ||
            docItem.withdrawnAt !== localItem.withdrawnAt ||
            localItem.uid !== currentUid)
        ) {
          updateLocalFeedbackHistoryItem(localItem.code, {
            id: docItem.id,
            status: docItem.status,
            withdrawnAt: docItem.withdrawnAt,
            uid: currentUid,
          });
        }
      }

      setFirestoreOwnItems(ownList);
      setFetchedFeedbackMap(nextMap);
    },
    [currentUid]
  );

  // Realtime subscription to the signed-in user's own feedback
  useEffect(() => {
    if (isTelehealthMode || !currentUid) {
      setFirestoreOwnItems([]);
      return;
    }

    const q = query(collection(db, 'feedback'), where('uid', '==', currentUid));
    const unsub = onSnapshot(
      q,
      snap => {
        const docsList = snap.docs.map(d => ({ id: d.id, ...d.data() } as FeedbackItem));
        applyOwnFeedbackDocs(docsList);
      },
      err => {
        console.warn('Realtime feedback subscription fallback:', err);
      }
    );

    return () => unsub();
  }, [isTelehealthMode, currentUid, applyOwnFeedbackDocs]);

  // Manual fallback refresh when user clicks Lịch sử
  const refreshAccessibleFeedback = useCallback(async () => {
    if (isTelehealthMode || !currentUid) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'feedback'), where('uid', '==', currentUid))
      );
      const docsList = snap.docs.map(d => ({ id: d.id, ...d.data() } as FeedbackItem));
      applyOwnFeedbackDocs(docsList);
    } catch (e) {
      console.warn('Could not list own feedback:', e);
    }
  }, [isTelehealthMode, currentUid, applyOwnFeedbackDocs]);

  // Keep selectedTicket synchronized in realtime whenever its status/response updates
  useEffect(() => {
    if (!selectedTicket) return;
    const byCode = selectedTicket.ticketCode
      ? fetchedFeedbackMap[selectedTicket.ticketCode.toUpperCase()]
      : undefined;
    const byId = selectedTicket.id
      ? fetchedFeedbackMap[selectedTicket.id.toUpperCase()]
      : undefined;
    const latest = byCode || byId;
    if (latest && isOwnedFeedback(latest)) {
      const hasChanges =
        latest.status !== selectedTicket.status ||
        latest.response !== selectedTicket.response ||
        latest.assignedDepartment !== selectedTicket.assignedDepartment ||
        latest.withdrawnAt !== selectedTicket.withdrawnAt ||
        latest.updatedAt !== selectedTicket.updatedAt ||
        latest.content !== selectedTicket.content;
      if (hasChanges) {
        setSelectedTicket(latest);
      }
    }
  }, [fetchedFeedbackMap, selectedTicket, isOwnedFeedback]);

  const handleTrackSearch = async (keyword?: string) => {
    const q = (keyword !== undefined ? keyword : trackKeyword).trim().toUpperCase();
    if (!q) return;

    setTrackSearching(true);
    try {
      let matched: FeedbackItem | null = null;

      if (currentUid) {
        // 1. Check cached feedback strictly owned by currentUid
        const cached = fetchedFeedbackMap[q];
        if (cached && isOwnedFeedback(cached)) {
          matched = cached;
        }

        // 2. Query Firestore strictly filtered by uid == currentUid (enforced by Firestore Rules)
        if (!matched) {
          const snap = await getDocs(
            query(collection(db, 'feedback'), where('uid', '==', currentUid))
          );
          const myFeedback = snap.docs
            .map(d => ({ id: d.id, ...d.data() } as FeedbackItem))
            .filter(f => f.uid === currentUid);

          matched =
            myFeedback.find(
              f =>
                f.ticketCode?.toUpperCase() === q ||
                f.id?.toUpperCase() === q ||
                f.ticketCode?.toUpperCase().includes(q) ||
                (!f.isAnonymous && f.phone?.includes(q))
            ) || null;
        }

        // 3. Fallback to current user's own local history items (in case offline/pending)
        if (!matched) {
          const localMatch = historyItems.find(
            item =>
              item.uid === currentUid &&
              (item.code.toUpperCase() === q || item.code.toUpperCase().includes(q))
          );
          if (localMatch) {
            matched = toFallbackTicket(localMatch);
          }
        }
      } else {
        // Guest (not signed in): strictly allow lookup ONLY for items created on this device without uid
        const cached = fetchedFeedbackMap[q];
        if (cached && isOwnedFeedback(cached)) {
          matched = cached;
        }

        if (!matched) {
          const localMatch = historyItems.find(
            item =>
              item.uid === '' &&
              item.deviceId === deviceId &&
              (item.code.toUpperCase() === q || item.code.toUpperCase().includes(q))
          );
          if (localMatch) {
            matched = toFallbackTicket(localMatch);
          }
        }
      }

      if (matched && isOwnedFeedback(matched)) {
        setSelectedTicket(matched);
        setFetchedFeedbackMap(prev => ({
          ...prev,
          [matched!.id.toUpperCase()]: matched!,
          ...(matched!.ticketCode ? { [matched!.ticketCode.toUpperCase()]: matched! } : {}),
        }));
      } else {
        setSelectedTicket(null);
        showToast(
          'warning',
          'Không tìm thấy phiếu phản ánh',
          currentUid
            ? `Mã "${q}" không tồn tại hoặc thuộc về người khác. Bạn chỉ có thể tra cứu phản ánh do chính tài khoản mình gửi.`
            : `Mã "${q}" không tồn tại hoặc không thuộc quyền tra cứu trên thiết bị này.`
        );
      }
    } catch {
      setSelectedTicket(null);
      showToast('error', 'Lỗi khi tra cứu kết quả');
    } finally {
      setTrackSearching(false);
    }
  };

  const handleOpenTicketDetail = async (itemOrCode: LocalFeedbackHistoryItem | string) => {
    const code = typeof itemOrCode === 'string' ? itemOrCode : itemOrCode.code;
    const id = typeof itemOrCode === 'string' ? itemOrCode : itemOrCode.id || itemOrCode.code;
    const upperCode = code.toUpperCase();
    const upperId = id.toUpperCase();

    setSubView('history_detail');
    const cached = fetchedFeedbackMap[upperCode] || fetchedFeedbackMap[upperId];
    if (cached && isOwnedFeedback(cached)) {
      setSelectedTicket(cached);
    }

    if (currentUid) {
      try {
        const snap = await getDocs(
          query(collection(db, 'feedback'), where('uid', '==', currentUid))
        );
        const ownDocs = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as FeedbackItem))
          .filter(f => f.uid === currentUid);

        const live = ownDocs.find(
          f =>
            f.ticketCode?.toUpperCase() === upperCode ||
            f.id.toUpperCase() === upperId ||
            f.id.toUpperCase() === upperCode
        );

        if (live) {
          setSelectedTicket(live);
          setFirestoreOwnItems(ownDocs);
          setFetchedFeedbackMap(prev => ({
            ...prev,
            [live.id.toUpperCase()]: live,
            ...(live.ticketCode ? { [live.ticketCode.toUpperCase()]: live } : {}),
          }));
          updateLocalFeedbackHistoryItem(code, {
            id: live.id,
            status: live.status,
            withdrawnAt: live.withdrawnAt,
            uid: currentUid,
          });
          return;
        }
      } catch {
        // Fallback to scoped local match below
      }
    }

    if (typeof itemOrCode !== 'string') {
      const fallback = toFallbackTicket(itemOrCode);
      if (isOwnedFeedback(fallback)) {
        setSelectedTicket(fallback);
        return;
      }
    }

    const scopedLocal = historyItems.find(item => item.code.toUpperCase() === upperCode);
    if (scopedLocal) {
      const fallback = toFallbackTicket(scopedLocal);
      if (isOwnedFeedback(fallback)) {
        setSelectedTicket(fallback);
        return;
      }
    }

    if (!cached || !isOwnedFeedback(cached)) {
      setTrackKeyword(code);
      await handleTrackSearch(code);
    }
  };

  const handleWithdrawFeedback = (target: {
    id?: string;
    code: string;
    status?: FeedbackItem['status'];
  }) => {
    const liveTicket =
      fetchedFeedbackMap[target.code.toUpperCase()] ||
      (target.id ? fetchedFeedbackMap[target.id.toUpperCase()] : undefined);
    const currentStatus = liveTicket?.status || target.status || 'new';

    if (!WITHDRAWABLE_STATUSES.includes(currentStatus)) {
      showToast(
        'warning',
        'Không thể thu hồi phản ánh',
        currentStatus === 'withdrawn'
          ? 'Phản ánh này đã được thu hồi trước đó.'
          : 'Phản ánh đã có kết quả xử lý nên không thể thu hồi.'
      );
      return;
    }

    const docId = liveTicket?.id || target.id || target.code;

    showConfirm({
      title: 'Thu hồi ý kiến phản ánh?',
      message: `Bạn có chắc muốn thu hồi phiếu phản ánh "${target.code}"? Sau khi thu hồi, Trạm Y tế sẽ ngừng xử lý phiếu này và trạng thái sẽ chuyển sang "Đã thu hồi".`,
      confirmText: 'Thu hồi phản ánh',
      cancelText: 'Giữ lại',
      isDangerous: true,
      onConfirm: async () => {
        setWithdrawingCode(target.code);
        try {
          const { withdrawnAt, foundInFirestore, resolvedId } = await withdrawFeedback(
            docId,
            target.code
          );

          await logAuditEvent(
            'Thu hồi phản ánh',
            'Phản ánh',
            `Công dân thu hồi biên nhận: ${target.code}`,
            {
              uid: currentUser?.uid || 'guest',
              name: userProfile?.displayName || 'Công dân',
            }
          );

          updateLocalFeedbackHistoryItem(target.code, {
            id: resolvedId,
            status: 'withdrawn',
            withdrawnAt,
            uid: currentUid,
          });
          setLocalHistoryItems(loadScopedLocalFeedbackHistory(currentUid, deviceId));
          setFirestoreOwnItems(prev =>
            prev.map(item =>
              item.ticketCode === target.code || item.id === docId || item.id === resolvedId
                ? { ...item, id: resolvedId, status: 'withdrawn', withdrawnAt, updatedAt: withdrawnAt }
                : item
            )
          );

          setFetchedFeedbackMap(prev => {
            const existing =
              prev[target.code.toUpperCase()] ||
              prev[docId.toUpperCase()] ||
              prev[resolvedId.toUpperCase()];
            if (!existing) return prev;
            const patched: FeedbackItem = {
              ...existing,
              id: resolvedId,
              status: 'withdrawn',
              withdrawnAt,
              updatedAt: withdrawnAt,
            };
            return {
              ...prev,
              [patched.id.toUpperCase()]: patched,
              [patched.ticketCode.toUpperCase()]: patched,
            };
          });

          setSelectedTicket(prev =>
            prev &&
            (prev.ticketCode === target.code || prev.id === docId || prev.id === resolvedId)
              ? { ...prev, id: resolvedId, status: 'withdrawn', withdrawnAt, updatedAt: withdrawnAt }
              : prev
          );

          showToast(
            'success',
            'Đã thu hồi phản ánh',
            foundInFirestore
              ? `Phiếu ${target.code} đã chuyển sang trạng thái Đã thu hồi.`
              : `Phiếu ${target.code} không còn trên hệ thống máy chủ và đã được cập nhật trạng thái Đã thu hồi trong lịch sử.`
          );
        } catch (err: any) {
          showToast(
            'error',
            'Thu hồi phản ánh thất bại',
            err?.message || 'Vui lòng kiểm tra kết nối mạng và thử lại.'
          );
        } finally {
          setWithdrawingCode(null);
        }
      },
    });
  };

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

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbContent.trim()) {
      showToast('warning', 'Vui lòng nhập nội dung phản ánh');
      return;
    }
    const cleanPhone = !fbIsAnon ? fbPhone.trim() : '';
    if (cleanPhone && !normalizeAndValidatePhone(cleanPhone)) {
      showToast('warning', 'Số điện thoại không hợp lệ', 'Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
      return;
    }

    setFbSubmitting(true);
    setFbUploadProgress('Đang gửi...');
    const ticketCode = generateFeedbackTicketCode();
    const nowDate = new Date();
    const nowStr = nowDate.toLocaleString('vi-VN');
    const nowIso = nowDate.toISOString();
    const trimmedContent = fbContent.trim();
    const senderDisplay = fbIsAnon ? 'Công dân ẩn danh' : fbName.trim() || 'Người dân';

    try {
      const ghConfig = await resolveGitHubConfig();
      const hasGh = Boolean(
        ghConfig?.token?.trim() && ghConfig?.owner?.trim() && ghConfig?.repo?.trim()
      );

      if (fbAttachmentFiles.length > 0 && !hasGh) {
        showToast(
          'error',
          'Chưa thể gửi tệp đính kèm',
          'Hệ thống chưa sẵn sàng lưu tệp đính kèm. Vui lòng xóa tệp để gửi nội dung văn bản.'
        );
        return;
      }

      const uploadedAttachments: FeedbackAttachment[] = [];
      if (fbAttachmentFiles.length > 0 && ghConfig) {
        for (let i = 0; i < fbAttachmentFiles.length; i += 1) {
          const file = fbAttachmentFiles[i];
          setFbUploadProgress('Đang gửi...');
          const upRes = await GitHubService.uploadFeedbackAttachment(
            ghConfig,
            file,
            ticketCode,
            senderDisplay
          );
          if (!upRes.success || !upRes.attachment) {
            showToast(
              'error',
              `Gửi tệp "${file.name}" thất bại`,
              upRes.error || 'Vui lòng kiểm tra kích thước tệp (≤ 20MB).'
            );
            return;
          }
          uploadedAttachments.push(upRes.attachment);
        }
      }

      let githubBackupUrl = '';
      if (hasGh && ghConfig) {
        setFbUploadProgress('Đang gửi...');
        const backupRecord = {
          ticketCode,
          fullName: senderDisplay,
          phone: cleanPhone,
          category: fbCategory,
          content: trimmedContent,
          isAnonymous: fbIsAnon,
          status: 'new',
          assignedDepartment: 'Ban tiếp công dân - Trạm Y tế',
          uid: currentUid,
          deviceId,
          createdAt: nowStr,
          createdAtIso: nowIso,
          attachments: uploadedAttachments,
        };
        const backupRes = await GitHubService.uploadJsonContent(
          ghConfig,
          `backups/phan-anh/${ticketCode}.json`,
          backupRecord,
          `Sao lưu phản ánh ${ticketCode} (${uploadedAttachments.length} tệp)`
        );
        if (backupRes.success) {
          githubBackupUrl = backupRes.htmlUrl || backupRes.downloadUrl || '';
        }
      }

      setFbUploadProgress('Đang gửi...');

      const payload: Omit<FeedbackItem, 'id'> = {
        ticketCode,
        fullName: senderDisplay,
        phone: !fbIsAnon && fbPhone.trim() ? fbPhone.trim() : '',
        category: fbCategory,
        content: trimmedContent,
        isAnonymous: fbIsAnon,
        status: 'new',
        assignedDepartment: 'Ban tiếp công dân - Trạm Y tế',
        uid: currentUid,
        deviceId,
        createdAt: nowStr,
        ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
        ...(githubBackupUrl ? { githubBackupUrl } : {}),
      };

      const createdId = await createFeedback(payload);

      await logAuditEvent(
        'Gửi ý kiến phản ánh',
        'Phản ánh',
        `Biên nhận: ${ticketCode}${
          uploadedAttachments.length > 0 ? ` (${uploadedAttachments.length} tệp đính kèm)` : ''
        }`,
        {
          uid: currentUid || 'guest',
          name: fbIsAnon ? 'Ẩn danh' : fbName || 'Người dân',
        }
      );

      const createdItem: FeedbackItem = {
        id: createdId,
        ...payload,
      };

      // Save ONLY actual submitted feedback to local history (scoped to current uid/device)
      appendLocalFeedbackHistory({
        id: createdId,
        code: ticketCode,
        date: nowStr,
        createdAtIso: nowIso,
        content: trimmedContent,
        sender: fbIsAnon ? 'Ẩn danh' : fbName.trim() || 'Người dân',
        category: fbCategory,
        status: 'new',
        uid: currentUid,
        deviceId,
        ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
        ...(githubBackupUrl ? { githubBackupUrl } : {}),
      });
      setLocalHistoryItems(loadScopedLocalFeedbackHistory(currentUid, deviceId));
      if (currentUid) {
        setFirestoreOwnItems(prev => [createdItem, ...prev]);
      }
      setHistoryPage(1);

      setFetchedFeedbackMap(prev => ({
        ...prev,
        [createdId.toUpperCase()]: createdItem,
        [ticketCode.toUpperCase()]: createdItem,
      }));
      setCreatedFbCode(ticketCode);
      showToast(
        'success',
        'Gửi ý kiến phản ánh thành công',
        uploadedAttachments.length > 0
          ? `Mã biên nhận: ${ticketCode} · Đã đính kèm ${uploadedAttachments.length} tệp.`
          : `Mã biên nhận của bạn là ${ticketCode}`
      );
      setFbContent('');
      setFbAttachmentFiles([]);
    } catch (err: any) {
      showToast('error', 'Không thể gửi phản ánh', err?.message);
    } finally {
      setFbSubmitting(false);
      setFbUploadProgress(null);
    }
  };

  // Compute 5-step progress for selectedTicket (Step 5 is the final terminal step)
  const getProgressStep = (status: FeedbackItem['status']) => {
    switch (status) {
      case 'new':
        return 2; // Chờ tiếp nhận
      case 'processing':
        return 3; // Đã tiếp nhận
      case 'forwarded':
        return 4; // Đợi kết quả
      case 'responded':
      case 'resolved':
      case 'rejected':
        return 5; // Kết quả (Bước cuối cùng - kết thúc tại đây)
      case 'withdrawn':
        return 1; // Đã thu hồi bởi công dân
      default:
        return 2;
    }
  };

  const getStatusBadgeInfo = (status?: FeedbackItem['status']) => {
    switch (status) {
      case 'resolved':
      case 'responded':
        return {
          label: 'Hoàn tất (Bước 5)',
          cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        };
      case 'processing':
        return {
          label: 'Đã tiếp nhận (Bước 3)',
          cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
        };
      case 'forwarded':
        return {
          label: 'Đợi kết quả (Bước 4)',
          cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
        };
      case 'rejected':
        return {
          label: 'Kết thúc · Không thuộc thẩm quyền',
          cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        };
      case 'withdrawn':
        return {
          label: 'Đã thu hồi',
          cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300',
        };
      default:
        return {
          label: 'Chờ tiếp nhận (Bước 2)',
          cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        };
    }
  };

  // VIEW 1: /#bac-si-cho-moi-nha (Dedicated Telehealth view — NO feedback/tracking tabs)
  if (isTelehealthMode) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
        <BacSiChoMoiNhaSection
          stationName={settings?.stationName}
          androidUrl={settings?.appBacSiChoMoiNha?.androidUrl}
          iosUrl={settings?.appBacSiChoMoiNha?.iosUrl}
          guideText={settings?.appBacSiChoMoiNha?.guideText}
        />

        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Lợi Ích Khi Khám Bệnh Qua &ldquo;Bác Sĩ Cho Mọi Nhà&rdquo;
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 dark:text-slate-400">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1.5">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                Không Cần Xếp Hàng Bốc Số
              </h4>
              <p className="leading-relaxed">
                Người dân chủ động lựa chọn thời gian tư vấn thuận tiện, được bác sĩ Trạm Y tế tiếp nhận đúng giờ hẹn mà không mất công chờ đợi đông người.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1.5">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                Hội Chẩn Tuyến Trên Khi Cần Thiết
              </h4>
              <p className="leading-relaxed">
                Trong trường hợp bệnh lý phức tạp, Bác sĩ Trạm Y tế có thể kết nối ngay với các bác sĩ chuyên khoa tuyến Huyện/Tỉnh để hội chẩn trực tiếp qua video.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1.5">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                Theo Dõi Bệnh Mãn Tính Định Kỳ
              </h4>
              <p className="leading-relaxed">
                Bệnh nhân Tăng huyết áp, Đái tháo đường có thể cập nhật chỉ số huyết áp, đường huyết hàng tuần để bác sĩ tư vấn điều chỉnh thuốc kịp thời.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1.5">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                Bảo Mật &amp; Miễn Phí Hoàn Toàn
              </h4>
              <p className="leading-relaxed">
                Ứng dụng do Bộ Y tế và UNDP Việt Nam tài trợ triển khai, hoàn toàn miễn phí cho nhân dân trên các thiết bị Android và iOS.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: /#phan-anh (Dedicated Feedback & History Tracking view)
  return (
    <div className="space-y-3.5 max-w-3xl mx-auto animate-in fade-in duration-200">
      {/* Sub-navigation inside /#phan-anh */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            setSubView('form');
            setSelectedTicket(null);
          }}
          className={`flex-1 min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
            subView === 'form'
              ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
          <span>Gửi phản ánh</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSubView('history_detail');
            refreshAccessibleFeedback();
          }}
          className={`flex-1 min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
            subView === 'history_detail'
              ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Lịch sử ({historyItems.length})</span>
        </button>
      </div>

      {/* SUBVIEW 1: SUBMIT FEEDBACK FORM */}
      {subView === 'form' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm">
          {createdFbCode ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-11 h-11 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Gửi Phản Ánh Thành Công!
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ý kiến đã được ghi nhận vào Lịch sử phản ánh.
                </p>
                <div className="pt-1 flex items-center justify-center gap-2 font-mono text-base font-extrabold text-emerald-700 dark:text-emerald-400">
                  <span>{createdFbCode}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyTicketCode(createdFbCode)}
                    className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 transition cursor-pointer"
                    title="Sao chép mã phản ánh"
                  >
                    {copiedFbCode === createdFbCode ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleOpenTicketDetail(createdFbCode)}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Xem tiến trình 5 bước</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedFbCode(null)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Gửi ý kiến khác
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleFeedbackSubmit} className="space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Hòm Thư Phản Ánh &amp; Góp Ý
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Tiếp nhận đóng góp về phục vụ, khám BHYT và cơ sở vật chất trạm.
                  </p>
                </div>

                <label
                  htmlFor="fbAnon"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer shrink-0 self-start sm:self-auto"
                >
                  <input
                    type="checkbox"
                    id="fbAnon"
                    checked={fbIsAnon}
                    onChange={e => setFbIsAnon(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span>Gửi ẩn danh</span>
                </label>
              </div>

              <div className={`grid grid-cols-1 gap-2.5 ${fbIsAnon ? '' : 'sm:grid-cols-3'}`}>
                {!fbIsAnon && (
                  <>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Họ và tên
                      </label>
                      <input
                        type="text"
                        placeholder="Nguyễn Văn A"
                        value={fbName}
                        onChange={e => setFbName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Số điện thoại (10 số)
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="0912345678"
                        value={fbPhone}
                        onChange={e => setFbPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Chủ đề phản ánh
                  </label>
                  <select
                    value={fbCategory}
                    onChange={e => setFbCategory(e.target.value as any)}
                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="y_kien_dong_gop">Ý kiến đóng góp xây dựng trạm</option>
                    <option value="kham_chua_benh">Khám chữa bệnh &amp; cấp phát thuốc BHYT</option>
                    <option value="thai_do_phuc_vu">Tinh thần &amp; thái độ phục vụ của nhân viên</option>
                    <option value="co_so_vat_chat">Cơ sở vật chất, vệ sinh môi trường</option>
                    <option value="thu_tuc_bhyt">Thủ tục hành chính &amp; liên thông hồ sơ</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nội dung phản ánh *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Mô tả ngắn gọn thời gian, sự việc hoặc đề xuất để Trạm kịp thời xử lý..."
                  value={fbContent}
                  onChange={e => setFbContent(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                <FeedbackAttachmentPicker
                  files={fbAttachmentFiles}
                  onChange={setFbAttachmentFiles}
                  onValidationError={msg => showToast('warning', msg)}
                  disabled={fbSubmitting}
                  isGitHubConfigured={settings ? isGhConfiguredInline : true}
                  uploadProgressText={fbUploadProgress}
                />
              </div>

              <div className="flex justify-end pt-0.5">
                <button
                  type="submit"
                  disabled={fbSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{fbSubmitting ? 'Đang gửi...' : 'Gửi ý kiến phản ánh'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Subtle dimmed 5-step track underneath the feedback form (Step 1 active, Steps 2-5 faded below form) */}
          <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                Bước 1/5 · Gửi phản ánh
              </span>
              <span className="text-slate-400 dark:text-slate-500">
                Kết thúc tại Bước 5
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { num: 1, title: 'Gửi phản ánh' },
                { num: 2, title: 'Chờ tiếp nhận' },
                { num: 3, title: 'Đã tiếp nhận' },
                { num: 4, title: 'Đợi kết quả' },
                { num: 5, title: 'Kết quả' },
              ].map(step => {
                const isCurrent = step.num === 1;
                return (
                  <div
                    key={step.num}
                    className={`flex flex-col items-center text-center transition-all ${
                      isCurrent
                        ? 'opacity-100'
                        : 'opacity-25 blur-[0.4px] select-none pointer-events-none'
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isCurrent
                          ? createdFbCode
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-600 text-white ring-2 ring-emerald-200 dark:ring-emerald-900'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {isCurrent && createdFbCode ? <CheckCircle2 className="w-3.5 h-3.5" /> : step.num}
                    </div>
                    <span
                      className={`mt-1 text-[10px] leading-tight ${
                        isCurrent
                          ? 'font-bold text-emerald-800 dark:text-emerald-300'
                          : 'font-medium text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUBVIEW 2: FEEDBACK HISTORY & TRACKING PROGRESS */}
      {subView === 'history_detail' && (
        <div className="space-y-3.5">
          {/* Quick Lookup by Ticket Code */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-sm space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Tra Cứu Theo Mã Biên Nhận</span>
              </h3>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Riêng tư · Chỉ xem phiếu của chính bạn
              </span>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                handleTrackSearch();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                required
                placeholder="Nhập mã PA-YYYY-XXXXXX"
                value={trackKeyword}
                onChange={e => setTrackKeyword(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={trackSearching}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60"
              >
                {trackSearching ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>Tra cứu</span>
              </button>
            </form>

            {!currentUid && (
              <p className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/70 text-[11px] text-amber-800 dark:text-amber-200">
                Chưa đăng nhập: chỉ tra cứu được phiếu gửi từ trình duyệt này. Đăng nhập để đồng bộ trên mọi thiết bị.
              </p>
            )}
          </div>

          {/* Selected Ticket 5-Step Progress Details */}
          {selectedTicket && (() => {
            const badge = getStatusBadgeInfo(selectedTicket.status);
            const canWithdraw = WITHDRAWABLE_STATUSES.includes(selectedTicket.status);
            const isWithdrawing = withdrawingCode === selectedTicket.ticketCode;

            return (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-3.5 animate-in fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-extrabold text-teal-700 dark:text-teal-400 text-sm sm:text-base">
                        {selectedTicket.ticketCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyTicketCode(selectedTicket.ticketCode)}
                        className="p-1 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-950/60 text-teal-700 dark:text-teal-400 transition cursor-pointer"
                        title="Sao chép mã phản ánh"
                      >
                        {copiedFbCode === selectedTicket.ticketCode ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {selectedTicket.fullName} · {selectedTicket.createdAt}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {canWithdraw && (
                      <button
                        type="button"
                        disabled={isWithdrawing}
                        onClick={() =>
                          handleWithdrawFeedback({
                            id: selectedTicket.id,
                            code: selectedTicket.ticketCode,
                            status: selectedTicket.status,
                          })
                        }
                        className="px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-[11px] font-bold transition inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{isWithdrawing ? 'Đang thu hồi...' : 'Thu hồi'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedTicket(null)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                </div>

                {/* ACTIVE STEP SPOTLIGHT + FORM/RESPONSE + DIMMED STEPS UNDERNEATH */}
                {selectedTicket.status === 'withdrawn' ? (
                  <>
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2.5">
                      <Ban className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-0.5">
                        <p className="font-bold text-rose-800 dark:text-rose-300">
                          Phản ánh đã được công dân thu hồi
                        </p>
                        <p className="text-[11px] text-rose-700/90 dark:text-rose-300/80">
                          Đã ngừng xử lý
                          {selectedTicket.withdrawnAt
                            ? ` lúc ${new Date(selectedTicket.withdrawnAt).toLocaleString('vi-VN')}.`
                            : '.'}
                        </p>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-bold text-slate-900 dark:text-white mr-1">Nội dung:</span>
                      <span className="italic">&ldquo;{selectedTicket.content}&rdquo;</span>
                    </div>

                    <FeedbackAttachmentViewer
                      attachments={selectedTicket.attachments}
                      githubBackupUrl={selectedTicket.githubBackupUrl}
                      githubConfig={settings?.githubConfig}
                    />
                  </>
                ) : (
                  (() => {
                    const activeStep = getProgressStep(selectedTicket.status);
                    const isFinalStep = activeStep === 5;
                    const isRejected = selectedTicket.status === 'rejected';
                    const steps = [
                      { num: 1, title: 'Gửi phản ánh', desc: 'Đã ghi nhận phiếu phản ánh lên hệ thống' },
                      { num: 2, title: 'Chờ tiếp nhận', desc: 'Đang chờ phân công cán bộ tiếp nhận' },
                      {
                        num: 3,
                        title: 'Đã tiếp nhận',
                        desc: `${selectedTicket.assignedDepartment || 'Ban tiếp công dân'} đã tiếp nhận hồ sơ`,
                      },
                      {
                        num: 4,
                        title: 'Đợi kết quả',
                        desc: `${selectedTicket.assignedDepartment || 'Bộ phận chuyên môn'} đang xác minh kết quả`,
                      },
                      {
                        num: 5,
                        title: 'Kết quả',
                        desc: isRejected
                          ? 'Không thuộc thẩm quyền · Kết thúc tại Bước 5'
                          : 'Đã có kết quả phản hồi · Kết thúc quy trình',
                      },
                    ];
                    const currentStepInfo = steps.find(s => s.num === activeStep) || steps[1];

                    return (
                      <div className="space-y-3">
                        {/* Current Step Spotlight: Đến bước nào hiện bước đó */}
                        <div
                          className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                            isFinalStep
                              ? isRejected
                                ? 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700'
                                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                              : 'bg-teal-50/70 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800/70'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-xs shrink-0 shadow-xs ${
                                isFinalStep
                                  ? isRejected
                                    ? 'bg-slate-600 text-white'
                                    : 'bg-emerald-600 text-white'
                                  : 'bg-teal-600 text-white ring-2 ring-teal-100 dark:ring-teal-950'
                              }`}
                            >
                              {isFinalStep ? <CheckCircle2 className="w-5 h-5" /> : activeStep}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] font-extrabold uppercase tracking-wider text-teal-800 dark:text-teal-300">
                                  Bước {activeStep}/5 · {currentStepInfo.title}
                                </span>
                                {isFinalStep && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white">
                                    Kết thúc
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                {currentStepInfo.desc}
                              </p>
                            </div>
                          </div>

                          <div className="w-full sm:w-32 shrink-0 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                              <span>Tiến độ</span>
                              <span>{activeStep}/5</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isFinalStep && isRejected ? 'bg-slate-500' : 'bg-emerald-600'
                                }`}
                                style={{ width: `${(activeStep / 5) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Content & Official Response (Form Body) */}
                        <div className="space-y-2">
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                            <span className="font-bold text-slate-900 dark:text-white mr-1">Nội dung:</span>
                            <span className="italic">&ldquo;{selectedTicket.content}&rdquo;</span>
                          </div>

                          <FeedbackAttachmentViewer
                            attachments={selectedTicket.attachments}
                            githubBackupUrl={selectedTicket.githubBackupUrl}
                            githubConfig={settings?.githubConfig}
                          />

                          {isFinalStep ? (
                            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200 space-y-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="font-extrabold text-[11px] uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                  {isRejected
                                    ? 'Kết thúc xử lý (Không thuộc thẩm quyền):'
                                    : 'Phản hồi chính thức từ Trạm Y tế:'}
                                </span>
                                <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
                                  {selectedTicket.assignedDepartment || 'Ban lãnh đạo trạm'}
                                </span>
                              </div>
                              <p className="leading-relaxed text-xs">
                                {selectedTicket.response ||
                                  'Hồ sơ phản ánh đã hoàn tất xử lý và kết thúc tại Bước 5/5.'}
                              </p>
                              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                Quy trình đã kết thúc tại Bước 5.
                              </p>
                            </div>
                          ) : (
                            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-[11px] italic flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              <span>
                                {activeStep === 2 &&
                                  'Đang ở Bước 2/5 (Chờ tiếp nhận) · Ban tiếp công dân sẽ sớm phân công xử lý.'}
                                {activeStep === 3 &&
                                  `Đang ở Bước 3/5 (Đã tiếp nhận) · ${selectedTicket.assignedDepartment || 'Bộ phận chuyên môn'} đang kiểm tra thông tin.`}
                                {activeStep === 4 &&
                                  `Đang ở Bước 4/5 (Đợi kết quả) · ${selectedTicket.assignedDepartment || 'Bộ phận chuyên môn'} đang hoàn thiện phản hồi chính thức.`}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Underneath the form: Full 5-step bar where previous & next steps are dimmed/blurred */}
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                            <span className="font-semibold uppercase tracking-wider">
                              Trạng thái
                            </span>
                            <span>Bước {activeStep}/5</span>
                          </div>

                          <div className="relative grid grid-cols-5 w-full">
                            <div className="absolute left-[10%] right-[10%] top-3.5 h-0.5 bg-slate-200/70 dark:bg-slate-800 z-0" />
                            <div
                              className="absolute left-[10%] top-3.5 h-0.5 bg-emerald-500/40 z-0 transition-all duration-500"
                              style={{
                                width: `${Math.min(80, Math.max(0, ((activeStep - 1) / 4) * 80))}%`,
                              }}
                            />

                            {steps.map(s => {
                              const isCurrent = s.num === activeStep;
                              const isPast = s.num < activeStep;

                              return (
                                <div
                                  key={s.num}
                                  className={`relative z-10 flex flex-col items-center text-center transition-all ${
                                    isCurrent
                                      ? 'opacity-100'
                                      : 'opacity-25 blur-[0.45px] select-none pointer-events-none'
                                  }`}
                                >
                                  <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] transition ${
                                      isCurrent
                                        ? isFinalStep
                                          ? 'bg-emerald-600 text-white shadow-xs'
                                          : 'bg-teal-600 text-white ring-2 ring-teal-100 dark:ring-teal-950 shadow-xs'
                                        : isPast
                                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                                        : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400'
                                    }`}
                                  >
                                    {isCurrent && isFinalStep ? (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    ) : isPast ? (
                                      <CheckCircle2 className="w-3 h-3" />
                                    ) : (
                                      s.num
                                    )}
                                  </div>
                                  <p
                                    className={`mt-1 px-0.5 text-[10px] leading-tight ${
                                      isCurrent
                                        ? 'text-emerald-800 dark:text-emerald-300 font-extrabold'
                                        : 'text-slate-500 dark:text-slate-400 font-medium'
                                    }`}
                                  >
                                    {s.title}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            );
          })()}

          {/* Feedback History List ("Lịch sử phản ánh" - 10 items per page) */}
          {(() => {
            const safePage = Math.min(historyPage, totalHistoryPages);
            const startIndex = (safePage - 1) * HISTORY_PAGE_SIZE;
            const paginatedHistoryItems = historyItems.slice(
              startIndex,
              startIndex + HISTORY_PAGE_SIZE
            );

            return (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                        Lịch sử phản ánh
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        10 mục/trang · Tự động xóa sau 30 ngày làm việc
                      </p>
                    </div>
                  </div>
                  {historyItems.length > 0 && (
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                      {startIndex + 1}–{Math.min(startIndex + HISTORY_PAGE_SIZE, historyItems.length)} / {historyItems.length}
                    </span>
                  )}
                </div>

                {historyItems.length === 0 ? (
                  <div className="text-center py-5 text-xs text-slate-400 italic space-y-2">
                    <MessageSquare className="w-7 h-7 text-slate-300 mx-auto" />
                    <p>Chưa có phản ánh nào trên thiết bị này.</p>
                    <button
                      type="button"
                      onClick={() => setSubView('form')}
                      className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold text-xs transition cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Gửi phản ánh ngay</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                      {paginatedHistoryItems.map(item => {
                        const matchedFb =
                          fetchedFeedbackMap[item.code.toUpperCase()] ||
                          (item.id ? fetchedFeedbackMap[item.id.toUpperCase()] : undefined);
                                const effectiveStatus = matchedFb?.status || item.status || 'new';
                                const badge = getStatusBadgeInfo(effectiveStatus);
                                const canWithdraw = WITHDRAWABLE_STATUSES.includes(effectiveStatus);
                                const isWithdrawing = withdrawingCode === item.code;
                                const attachmentsCount =
                                  matchedFb?.attachments?.length || item.attachments?.length || 0;

                                return (
                                  <div
                                    key={item.id || item.code}
                                    onClick={() => handleOpenTicketDetail(item)}
                                    className="py-2.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer group"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0 font-mono font-bold text-[11px]">
                                        PA
                                      </div>
                                      <div className="min-w-0 space-y-0.5">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-mono font-bold text-xs text-slate-900 dark:text-white group-hover:text-emerald-600 transition">
                                              {item.code}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={(e) => handleCopyTicketCode(item.code, e)}
                                              className="p-1 rounded-md hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-500 hover:text-emerald-700 dark:text-slate-400 transition cursor-pointer"
                                              title="Sao chép mã phản ánh"
                                            >
                                              {copiedFbCode === item.code ? (
                                                <Check className="w-3 h-3 text-emerald-600" />
                                              ) : (
                                                <Copy className="w-3 h-3" />
                                              )}
                                            </button>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>
                                              {badge.label}
                                            </span>
                                          {attachmentsCount > 0 && (
                                            <span className="px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-[10px] font-semibold text-teal-700 dark:text-teal-300 inline-flex items-center gap-1">
                                              <Paperclip className="w-2.5 h-2.5" />
                                              <span>{attachmentsCount}</span>
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 truncate max-w-md">
                                          &ldquo;{item.content}&rdquo;
                                        </p>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                          <span>{item.sender || 'Công dân'}</span>
                                          <span>·</span>
                                          <span>{item.date}</span>
                                        </div>
                                      </div>
                                    </div>

                            <div className="flex items-center justify-end gap-2 shrink-0">
                              {canWithdraw && (
                                <button
                                  type="button"
                                  disabled={isWithdrawing}
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleWithdrawFeedback({
                                      id: matchedFb?.id || item.id,
                                      code: item.code,
                                      status: effectiveStatus,
                                    });
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-[11px] font-bold transition inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>{isWithdrawing ? 'Đang thu hồi...' : 'Thu hồi'}</span>
                                </button>
                              )}

                              <div className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 group-hover:translate-x-0.5 transition">
                                <span>Chi tiết</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {totalHistoryPages > 1 && (
                      <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Trang {safePage} / {totalHistoryPages}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={safePage <= 1}
                            onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ChevronLeft className="w-3 h-3" />
                            <span>Trước</span>
                          </button>

                          {Array.from({ length: totalHistoryPages }, (_, i) => i + 1).map(pageNum => (
                            <button
                              key={pageNum}
                              type="button"
                              onClick={() => setHistoryPage(pageNum)}
                              className={`min-w-[28px] h-7 px-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                pageNum === safePage
                                  ? 'bg-emerald-700 text-white shadow-xs'
                                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              {pageNum}
                            </button>
                          ))}

                          <button
                            type="button"
                            disabled={safePage >= totalHistoryPages}
                            onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}
                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>Sau</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
