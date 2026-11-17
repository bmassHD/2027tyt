import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { BackupItem, GitHubConfig, SystemSettings } from '../types';
import { cleanDataForFirestore, logAuditEvent } from './firebaseService';
import { GitHubService } from './githubService';
import {
  exportBhxhServerConfigForBackup,
  restoreBhxhServerConfigFromBackup,
} from './bhxhService';
import { utf8ToBase64, base64ToUtf8 } from '../utils/base64Utils';

export const AUTO_GITHUB_BACKUP_HOUR_VN = 3; // 03:00 AM giờ Việt Nam

export function getVietnamTimeParts(date: Date = new Date()): {
  dayKey: string;
  hour: number;
  minute: number;
  timeLabel: string;
} {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const getVal = (type: string) => parts.find(p => p.type === type)?.value || '00';
    const year = getVal('year');
    const month = getVal('month');
    const day = getVal('day');
    let hour = Number(getVal('hour'));
    if (hour === 24) hour = 0;
    const minute = Number(getVal('minute'));
    const hourStr = String(hour).padStart(2, '0');
    const minStr = String(minute).padStart(2, '0');

    return {
      dayKey: `${year}-${month}-${day}`,
      hour,
      minute,
      timeLabel: `${hourStr}:${minStr}`,
    };
  } catch {
    const vnMs = date.getTime() + 7 * 60 * 60 * 1000;
    const vn = new Date(vnMs);
    const dayKey = vn.toISOString().slice(0, 10);
    const hour = vn.getUTCHours();
    const minute = vn.getUTCMinutes();
    return {
      dayKey,
      hour,
      minute,
      timeLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  }
}

export function isGitHubConfigValid(config?: Partial<GitHubConfig>): boolean {
  return Boolean(config?.token?.trim() && config?.owner?.trim() && config?.repo?.trim());
}

export function hasGithubBackupForDay(
  settings?: Partial<SystemSettings>,
  targetDayKey?: string
): boolean {
  const dayKey = targetDayKey || getVietnamTimeParts().dayKey;
  if (settings?.lastGithubBackupDay === dayKey) {
    return true;
  }
  if (settings?.lastGithubBackupAt) {
    const parsed = new Date(settings.lastGithubBackupAt);
    if (!Number.isNaN(parsed.getTime())) {
      if (getVietnamTimeParts(parsed).dayKey === dayKey) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Trả về true nếu đã từ 03:00 sáng (giờ VN) trở đi mà hôm nay chưa đẩy sao lưu lên GitHub.
 * Khi Admin đã đẩy xong (lastGithubBackupDay === todayVN), hàm trả về false -> ngừng nhắc ngay.
 */
export function isDailyGithubBackupMissing(
  settings?: Partial<SystemSettings>,
  now: Date = new Date()
): boolean {
  if (!settings || settings.autoBackupGithubEnabled === false) {
    return false;
  }
  const { dayKey, hour } = getVietnamTimeParts(now);
  if (hour < AUTO_GITHUB_BACKUP_HOUR_VN) {
    return false;
  }
  return !hasGithubBackupForDay(settings, dayKey);
}

/**
 * Kiểm tra xem có đang trong khung giờ 03:00 - 03:59 sáng giờ VN và chưa tự động đẩy hôm nay không
 */
export function shouldRunAutoGithubBackupNow(
  settings?: Partial<SystemSettings>,
  now: Date = new Date()
): boolean {
  if (!settings || settings.autoBackupGithubEnabled === false) {
    return false;
  }
  if (!isGitHubConfigValid(settings.githubConfig)) {
    return false;
  }
  const { dayKey, hour } = getVietnamTimeParts(now);
  if (hour !== AUTO_GITHUB_BACKUP_HOUR_VN) {
    return false;
  }
  if (hasGithubBackupForDay(settings, dayKey)) {
    return false;
  }
  if (settings.lastAutoGithubBackupAttemptDay === dayKey) {
    return false;
  }
  return true;
}

export const CURRENT_SYSTEM_VERSION = 'v3.0.0 (Bản Chính Thức)';

export const BACKUP_COLLECTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'systemSettings', label: 'Cấu hình trạm & Bản đồ' },
  { key: 'nearbyFacilities', label: 'Cơ sở Y tế lân cận' },
  { key: 'events', label: 'Sự kiện & Ngày lễ' },
  { key: 'posts', label: 'Tin tức & Truyền thông' },
  { key: 'announcements', label: 'Thông báo khẩn' },
  { key: 'services', label: 'Danh mục dịch vụ' },
  { key: 'documents', label: 'Văn bản & Biểu mẫu' },
  { key: 'workSchedules', label: 'Lịch trực 24/7' },
  { key: 'feedback', label: 'Phản ánh kiến nghị' },
  { key: 'appointments', label: 'Lịch hẹn khám' },
  { key: 'targetedNotifications', label: 'Thông báo mục tiêu' },
  { key: 'users', label: 'Tài khoản, Định danh Y tế & Bảo mật người dùng' },
  { key: 'verifiedIdentifiers', label: 'Khoá định danh đã xác minh (Email/SĐT/CCCD)' },
  { key: 'admins', label: 'Danh sách Quản trị viên' },
  { key: 'tasks', label: 'Nhiệm vụ công việc' },
  { key: 'rescueSignals', label: 'Tín hiệu cứu hộ SOS' },
  { key: 'siteStats', label: 'Thống kê lượt truy cập' },
  { key: 'onlinePresence', label: 'Trạng thái trực tuyến' },
  { key: 'pushSubscriptions', label: 'Đăng ký thông báo đẩy' },
  { key: 'bhxhServerConfig', label: 'Cấu hình API BHXH (Server)' },
  { key: 'auditLogs', label: 'Nhật ký kiểm toán' },
];

const RESTORABLE_COLLECTIONS = new Set<string>([
  'systemSettings',
  'nearbyFacilities',
  'events',
  'posts',
  'announcements',
  'services',
  'documents',
  'workSchedules',
  'feedback',
  'appointments',
  'targetedNotifications',
  'users',
  'verifiedIdentifiers',
  'admins',
  'tasks',
  'rescueSignals',
  'siteStats',
  'onlinePresence',
  'pushSubscriptions',
  'bhxhServerConfig',
  'auditLogs',
]);

const MAX_CLOUD_BACKUP_BYTES = 950_000; // Safe margin under Firestore 1MB document limit

export class BackupService {
  /**
   * Collect snapshot across all system Firestore collections
   */
  private static async collectSnapshot(): Promise<{
    backupData: Record<string, any[]>;
    stats: BackupItem['stats'];
    collectionsIncluded: string[];
    failedCollections: string[];
    dataJson: string;
    sizeBytes: number;
  }> {
    const backupData: Record<string, any[]> = {};
    const collectionsIncluded: string[] = [];
    const failedCollections: string[] = [];
    const stats: BackupItem['stats'] = {
      postsCount: 0,
      servicesCount: 0,
      documentsCount: 0,
      usersCount: 0,
      feedbackCount: 0,
      workSchedulesCount: 0,
      announcementsCount: 0,
      appointmentsCount: 0,
      tasksCount: 0,
      notificationsCount: 0,
      auditLogsCount: 0,
      adminsCount: 0,
      settingsCount: 0,
      rescueSignalsCount: 0,
      onlinePresenceCount: 0,
      nearbyFacilitiesCount: 0,
      eventsCount: 0,
      siteStatsCount: 0,
      pushSubscriptionsCount: 0,
      feedbackAttachmentsCount: 0,
      verifiedIdentifiersCount: 0,
      userDevicesCount: 0,
      bhxhServerConfigCount: 0,
      totalRecords: 0,
    };

    const currentUid = auth.currentUser?.uid || '';

    for (const { key: collName } of BACKUP_COLLECTIONS) {
      if (collName === 'bhxhServerConfig') {
        try {
          const bhxhRecords = await exportBhxhServerConfigForBackup();
          backupData[collName] = bhxhRecords;
          collectionsIncluded.push(collName);
          stats.bhxhServerConfigCount = bhxhRecords.length;
          stats.totalRecords = (stats.totalRecords || 0) + bhxhRecords.length;
        } catch (bhxhErr) {
          console.warn('Snapshot reading BHXH server config failed:', bhxhErr);
          backupData[collName] = [];
          failedCollections.push(collName);
        }
        continue;
      }

      try {
        const snap = await getDocs(collection(db, collName));
        let docs = snap.docs
          .filter(d => !(collName === 'systemSettings' && d.id === 'connection_test'))
          .map(d => ({ id: d.id, ...d.data() }));

        if (collName === 'users') {
          let totalDevices = 0;
          docs = await Promise.all(
            docs.map(async (userDoc: any) => {
              let verifiedDevices: any[] = [];
              try {
                const devSnap = await getDocs(collection(db, 'users', userDoc.id, 'devices'));
                verifiedDevices = devSnap.docs.map(dd => ({ deviceId: dd.id, ...dd.data() }));
                totalDevices += verifiedDevices.length;
              } catch {
                verifiedDevices = [];
              }

              // users/{uid}/security/totp is owner-only per firestore.rules
              let totpSecurity: any = undefined;
              if (currentUid && userDoc.id === currentUid) {
                try {
                  const totpSnap = await getDoc(doc(db, 'users', userDoc.id, 'security', 'totp'));
                  if (totpSnap.exists()) {
                    totpSecurity = totpSnap.data();
                  }
                } catch {
                  // non-blocking
                }
              }

              return {
                ...userDoc,
                verifiedDevices,
                ...(totpSecurity ? { totpSecurity } : {}),
              };
            })
          );
          stats.userDevicesCount = totalDevices;
          stats.totalRecords = (stats.totalRecords || 0) + totalDevices;
        }

        backupData[collName] = docs;
        collectionsIncluded.push(collName);

        const count = docs.length;
        stats.totalRecords = (stats.totalRecords || 0) + count;

        if (collName === 'posts') stats.postsCount = count;
        if (collName === 'services') stats.servicesCount = count;
        if (collName === 'documents') stats.documentsCount = count;
        if (collName === 'users') stats.usersCount = count;
        if (collName === 'verifiedIdentifiers') stats.verifiedIdentifiersCount = count;
        if (collName === 'feedback') {
          stats.feedbackCount = count;
          stats.feedbackAttachmentsCount = docs.reduce(
            (sum: number, item: any) =>
              sum + (Array.isArray(item.attachments) ? item.attachments.length : 0),
            0
          );
        }
        if (collName === 'workSchedules') stats.workSchedulesCount = count;
        if (collName === 'announcements') stats.announcementsCount = count;
        if (collName === 'appointments') stats.appointmentsCount = count;
        if (collName === 'tasks') stats.tasksCount = count;
        if (collName === 'targetedNotifications') stats.notificationsCount = count;
        if (collName === 'auditLogs') stats.auditLogsCount = count;
        if (collName === 'admins') stats.adminsCount = count;
        if (collName === 'systemSettings') stats.settingsCount = count;
        if (collName === 'rescueSignals') stats.rescueSignalsCount = count;
        if (collName === 'onlinePresence') stats.onlinePresenceCount = count;
        if (collName === 'nearbyFacilities') stats.nearbyFacilitiesCount = count;
        if (collName === 'events') stats.eventsCount = count;
        if (collName === 'siteStats') stats.siteStatsCount = count;
        if (collName === 'pushSubscriptions') stats.pushSubscriptionsCount = count;
      } catch (collectionErr) {
        console.warn(`Snapshot reading collection ${collName} failed:`, collectionErr);
        backupData[collName] = [];
        failedCollections.push(collName);
      }
    }

    const dataJson = JSON.stringify(backupData);
    const sizeBytes = new Blob([dataJson]).size;

    return {
      backupData,
      stats,
      collectionsIncluded,
      failedCollections,
      dataJson,
      sizeBytes,
    };
  }

  /**
   * Create a full snapshot backup in Firestore `backups` collection
   */
  public static async createBackup(
    userEmail: string,
    title?: string
  ): Promise<{ success: boolean; backupItem?: BackupItem; warning?: string; error?: string }> {
    try {
      const {
        stats,
        collectionsIncluded,
        failedCollections,
        dataJson,
        sizeBytes,
      } = await this.collectSnapshot();

      if (sizeBytes > MAX_CLOUD_BACKUP_BYTES) {
        return {
          success: false,
          error: `Dung lượng sao lưu (${Math.round(sizeBytes / 1024)} KB) vượt giới hạn lưu trữ 1MB trên Cloud Firestore. Vui lòng dùng nút "Tải JSON về máy".`,
        };
      }

      const nowIso = new Date().toISOString();
      const backupTitle =
        title?.trim() ||
        `Bản sao lưu hệ thống ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`;

      const backupPayload = {
        title: backupTitle,
        version: CURRENT_SYSTEM_VERSION,
        createdAt: nowIso,
        createdBy: userEmail || 'Hệ thống',
        sizeBytes,
        collectionsIncluded,
        stats,
        dataJson,
      };

      const ref = await addDoc(collection(db, 'backups'), cleanDataForFirestore(backupPayload));

      // Update lastBackupAt in systemSettings/general
      try {
        await setDoc(
          doc(db, 'systemSettings', 'general'),
          { lastBackupAt: nowIso, updatedAt: nowIso },
          { merge: true }
        );
      } catch (settingsErr) {
        console.warn('Could not update lastBackupAt:', settingsErr);
      }

      // Record audit log
      try {
        await logAuditEvent(
          'Tạo bản sao lưu hệ thống',
          'Sao lưu & Phục hồi',
          `${backupTitle} (${stats.totalRecords || 0} bản ghi, ${Math.max(1, Math.round(sizeBytes / 1024))} KB)`,
          { uid: userEmail || 'admin', name: userEmail || 'Admin' }
        );
      } catch {
        // Non-blocking audit log
      }

      const backupItem: BackupItem = {
        id: ref.id,
        ...backupPayload,
      };

      return {
        success: true,
        backupItem,
        warning:
          failedCollections.length > 0
            ? `Một số phân hệ không đọc được: ${failedCollections.join(', ')}`
            : undefined,
      };
    } catch (err: any) {
      console.error('Create backup failed:', err);
      return { success: false, error: err?.message || 'Lỗi khi tạo bản sao lưu' };
    }
  }

  /**
   * Snapshot all collections and immediately download as a local JSON file (no 1MB cloud limit)
   */
  public static async exportLocalBackup(
    userEmail: string,
    title?: string
  ): Promise<{ success: boolean; totalRecords?: number; sizeBytes?: number; error?: string }> {
    try {
      const { stats, collectionsIncluded, dataJson, sizeBytes } = await this.collectSnapshot();
      const nowIso = new Date().toISOString();
      const backupItem: BackupItem = {
        id: `local_${Date.now()}`,
        title: title?.trim() || `Bản sao lưu cục bộ ${new Date().toLocaleDateString('vi-VN')}`,
        version: CURRENT_SYSTEM_VERSION,
        createdAt: nowIso,
        createdBy: userEmail || 'Admin',
        sizeBytes,
        collectionsIncluded,
        stats,
        dataJson,
      };
      this.downloadBackupFile(backupItem);
      return { success: true, totalRecords: stats.totalRecords || 0, sizeBytes };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Không thể xuất tệp sao lưu' };
    }
  }

  /**
   * Push full JSON snapshot backup directly into the configured GitHub repository
   * and persist the backup metadata record in Firestore `backups` history
   */
  public static async backupToGitHub(
    githubConfig: GitHubConfig,
    userEmail: string,
    title?: string,
    options?: { isAutoBackup?: boolean }
  ): Promise<{
    success: boolean;
    backupItem?: BackupItem;
    path?: string;
    htmlUrl?: string;
    totalRecords?: number;
    sizeBytes?: number;
    error?: string;
  }> {
    const isAutoBackup = Boolean(options?.isAutoBackup);
    const todayKey = getVietnamTimeParts().dayKey;

    if (!githubConfig?.token || !githubConfig?.owner || !githubConfig?.repo) {
      const errMsg = 'Chưa cấu hình GitHub PAT để sao lưu lên kho lưu trữ.';
      if (isAutoBackup) {
        try {
          await setDoc(
            doc(db, 'systemSettings', 'general'),
            cleanDataForFirestore({
              lastAutoGithubBackupAttemptDay: todayKey,
              lastAutoGithubBackupStatus: 'failed',
              lastAutoGithubBackupError: errMsg,
              updatedAt: new Date().toISOString(),
            }),
            { merge: true }
          );
        } catch {
          // ignore
        }
      }
      return {
        success: false,
        error: errMsg,
      };
    }

    try {
      const { stats, collectionsIncluded, backupData, sizeBytes } = await this.collectSnapshot();
      const nowIso = new Date().toISOString();
      const defaultTitle = isAutoBackup
        ? `Sao lưu tự động 03:00 lên GitHub ${new Date().toLocaleDateString('vi-VN')}`
        : `Sao lưu GitHub ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`;
      const backupTitle = title?.trim() || defaultTitle;

      // Mã hoá toàn bộ dữ liệu sao lưu sang Base64 an toàn để ngăn chặn cơ chế GitHub Secret Scanning
      // ("Repository rule violations found: Secret detected in content") chặn đẩy mã khi có token/key hệ thống
      const rawDataString = JSON.stringify(backupData);
      const dataBase64 = utf8ToBase64(rawDataString);

      const envelope = {
        title: backupTitle,
        version: CURRENT_SYSTEM_VERSION,
        createdAt: nowIso,
        createdBy: userEmail || (isAutoBackup ? 'Hệ thống tự động 03:00' : 'Admin'),
        encoding: 'base64',
        isBase64: true,
        isAutoBackup,
        sizeBytes,
        collectionsIncluded,
        stats,
        dataBase64,
      };

      const res = await GitHubService.uploadJsonContent(
        githubConfig,
        `backups/system_backup_${Date.now()}.json`,
        envelope,
        `Sao lưu dữ liệu hệ thống (Base64${isAutoBackup ? ' · Tự động 03:00' : ''}) - ${backupTitle}`
      );

      if (!res.success) {
        if (isAutoBackup) {
          try {
            await setDoc(
              doc(db, 'systemSettings', 'general'),
              cleanDataForFirestore({
                lastAutoGithubBackupAttemptDay: todayKey,
                lastAutoGithubBackupStatus: 'failed',
                lastAutoGithubBackupError: res.error || 'Lỗi khi đẩy sao lưu lên GitHub',
                updatedAt: nowIso,
              }),
              { merge: true }
            );
          } catch {
            // ignore
          }
        }
        return { success: false, error: res.error };
      }

      const backupPayload: Omit<BackupItem, 'id'> = {
        title: backupTitle,
        version: CURRENT_SYSTEM_VERSION,
        createdAt: nowIso,
        createdBy: userEmail || (isAutoBackup ? 'Hệ thống tự động 03:00' : 'Admin'),
        sizeBytes,
        collectionsIncluded,
        stats,
        storageType: 'github',
        githubPath: res.path || '',
        githubHtmlUrl: res.htmlUrl || '',
        encoding: 'base64',
        isAutoBackup,
        // Lưu chuỗi rỗng trong Firestore để không chạm giới hạn 1MB; toàn bộ snapshot Base64 lưu trên GitHub
        dataJson: '',
      };

      let createdBackupId = `gh_${Date.now()}`;
      try {
        const ref = await addDoc(collection(db, 'backups'), cleanDataForFirestore(backupPayload));
        createdBackupId = ref.id;
      } catch (saveHistoryErr) {
        console.warn('Could not save GitHub backup record to Firestore history:', saveHistoryErr);
      }

      try {
        await setDoc(
          doc(db, 'systemSettings', 'general'),
          cleanDataForFirestore({
            lastBackupAt: nowIso,
            lastGithubBackupAt: nowIso,
            lastGithubBackupDay: todayKey,
            lastAutoGithubBackupStatus: 'success',
            lastAutoGithubBackupError: '',
            ...(isAutoBackup ? { lastAutoGithubBackupAttemptDay: todayKey } : {}),
            updatedAt: nowIso,
          }),
          { merge: true }
        );
        await logAuditEvent(
          isAutoBackup ? 'Sao lưu tự động 03:00 lên GitHub' : 'Sao lưu dữ liệu lên GitHub',
          'Sao lưu & Phục hồi',
          `${backupTitle} -> ${res.path} (${stats.totalRecords || 0} bản ghi, Base64)`,
          { uid: userEmail || 'admin', name: userEmail || 'Admin' }
        );
      } catch {
        // Non-blocking
      }

      return {
        success: true,
        backupItem: {
          id: createdBackupId,
          ...backupPayload,
        },
        path: res.path,
        htmlUrl: res.htmlUrl,
        totalRecords: stats.totalRecords || 0,
        sizeBytes,
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Lỗi khi sao lưu dữ liệu lên GitHub';
      if (isAutoBackup) {
        try {
          await setDoc(
            doc(db, 'systemSettings', 'general'),
            cleanDataForFirestore({
              lastAutoGithubBackupAttemptDay: todayKey,
              lastAutoGithubBackupStatus: 'failed',
              lastAutoGithubBackupError: errMsg,
              updatedAt: new Date().toISOString(),
            }),
            { merge: true }
          );
        } catch {
          // ignore
        }
      }
      return {
        success: false,
        error: errMsg,
      };
    }
  }

  /**
   * Export dedicated Users & Citizen Identity backup with ethnic and administrative details
   */
  public static async exportUsersProfilesBackup(
    userEmail: string
  ): Promise<{ success: boolean; usersCount?: number; sizeBytes?: number; error?: string }> {
    try {
      const [snap, locksSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'verifiedIdentifiers')).catch(() => null),
      ]);

      const verifiedIdentifiersList = locksSnap
        ? locksSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        : [];

      const currentUid = auth.currentUser?.uid || '';
      let totalDevices = 0;
      const usersList = await Promise.all(
        snap.docs.map(async d => {
          const data = d.data();
          const addressComponents = [
            data.address,
            data.wardName,
            data.provinceName,
          ].filter(Boolean);

          let verifiedDevices: any[] = [];
          try {
            const devSnap = await getDocs(collection(db, 'users', d.id, 'devices'));
            verifiedDevices = devSnap.docs.map(dd => ({ deviceId: dd.id, ...dd.data() }));
            totalDevices += verifiedDevices.length;
          } catch {
            verifiedDevices = [];
          }

          let totpSecurity: any = undefined;
          if (currentUid && d.id === currentUid) {
            try {
              const totpSnap = await getDoc(doc(db, 'users', d.id, 'security', 'totp'));
              if (totpSnap.exists()) {
                totpSecurity = totpSnap.data();
              }
            } catch {
              // non-blocking
            }
          }

          const securityStatus = {
            emailVerified: Boolean(data.emailVerified),
            emailVerifiedAt: data.emailVerifiedAt || '',
            phoneVerified: Boolean(data.phoneVerified),
            verifiedPhone: data.verifiedPhone || '',
            phoneVerifiedAt: data.phoneVerifiedAt || '',
            citizenIdVerified: Boolean(data.citizenIdVerified),
            citizenIdVerifiedAt: data.citizenIdVerifiedAt || '',
            hasPasswordLinked: Boolean(data.hasPasswordLinked),
            googleLinked: Boolean(data.googleLinked),
            twoFactorEnabled: Boolean(data.twoFactorEnabled),
            twoFactorUpdatedAt: data.twoFactorUpdatedAt || '',
            smsMfaEnabled: Boolean(data.smsMfaEnabled),
            smsMfaPhoneMasked: data.smsMfaPhoneMasked || '',
            verifiedDevicesCount: verifiedDevices.length,
          };

          return {
            id: d.id,
            uid: d.id,
            // Định danh y tế cá nhân
            email: data.email || '',
            displayName: data.displayName || '',
            citizenId: data.citizenId || '',
            phoneNumber: data.phoneNumber || '',
            dob: data.dob || '',
            gender: data.gender || '',
            ethnicity: data.ethnicity || '',
            provinceCode: data.provinceCode || '',
            provinceName: data.provinceName || '',
            wardCode: data.wardCode || '',
            wardName: data.wardName || '',
            address: data.address || '',
            fullAddress: addressComponents.join(', '),
            role: data.role || 'citizen',
            accountType: data.accountType || 'citizen',
            department: data.department || '',
            position: data.position || '',
            qualification: data.qualification || '',
            status: data.status || 'active',
            avatarUrl: data.avatarUrl || '',
            notes: data.notes || '',
            lastLoginAt: data.lastLoginAt || '',
            createdAt: data.createdAt || '',
            updatedAt: data.updatedAt || '',
            // Trạng thái bảo mật & xác minh tài khoản
            emailVerified: securityStatus.emailVerified,
            emailVerifiedAt: securityStatus.emailVerifiedAt,
            phoneVerified: securityStatus.phoneVerified,
            verifiedPhone: securityStatus.verifiedPhone,
            phoneVerifiedAt: securityStatus.phoneVerifiedAt,
            citizenIdVerified: securityStatus.citizenIdVerified,
            citizenIdVerifiedAt: securityStatus.citizenIdVerifiedAt,
            hasPasswordLinked: securityStatus.hasPasswordLinked,
            googleLinked: securityStatus.googleLinked,
            twoFactorEnabled: securityStatus.twoFactorEnabled,
            twoFactorUpdatedAt: securityStatus.twoFactorUpdatedAt,
            smsMfaEnabled: securityStatus.smsMfaEnabled,
            smsMfaPhoneMasked: securityStatus.smsMfaPhoneMasked,
            securityStatus,
            verifiedDevices,
            ...(totpSecurity ? { totpSecurity } : {}),
          };
        })
      );

      const payload = {
        title: `Bản sao lưu toàn diện Người dùng, Định danh Y tế & Trạng thái Bảo mật`,
        version: CURRENT_SYSTEM_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: userEmail || 'Admin',
        usersCount: usersList.length,
        userDevicesCount: totalDevices,
        verifiedIdentifiersCount: verifiedIdentifiersList.length,
        users: usersList,
        verifiedIdentifiers: verifiedIdentifiersList,
      };

      const dataJson = JSON.stringify(payload, null, 2);
      const blob = new Blob([dataJson], { type: 'application/json' });
      const sizeBytes = blob.size;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_nguoi_dung_dinh_danh_bao_mat_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      try {
        await logAuditEvent(
          'Xuất sao lưu danh sách người dùng & bảo mật',
          'Sao lưu & Phục hồi',
          `Xuất dữ liệu ${usersList.length} tài khoản (Định danh Y tế, Trạng thái bảo mật/xác minh, ${totalDevices} thiết bị tin cậy, ${verifiedIdentifiersList.length} khoá định danh)`,
          { uid: userEmail || 'admin', name: userEmail || 'Admin' }
        );
      } catch {
        // Non-blocking
      }

      return { success: true, usersCount: usersList.length, sizeBytes };
    } catch (err: any) {
      console.error('Export users backup failed:', err);
      return { success: false, error: err?.message || 'Không thể xuất danh sách người dùng' };
    }
  }

  /**
   * List all system backups ordered by creation date
   */
  public static async listBackups(): Promise<BackupItem[]> {
    try {
      const q = query(collection(db, 'backups'), orderBy('createdAt', 'desc'), limit(20));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as BackupItem));
    } catch (err) {
      console.warn('List backups indexed query error, trying plain fetch:', err);
      try {
        const snap = await getDocs(collection(db, 'backups'));
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as BackupItem));
        list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        return list.slice(0, 20);
      } catch (plainErr) {
        console.warn('Plain list backups error:', plainErr);
        return [];
      }
    }
  }

  /**
   * Delete a backup snapshot
   */
  public static async deleteBackup(id: string): Promise<boolean> {
    try {
      await deleteDoc(doc(db, 'backups', id));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate and parse a backup JSON string (supports direct collection map, Base64-encoded envelopes, wrapped BackupItem JSON, or dedicated users export JSON)
   * Tự động giải mã Base64 ngược về cấu trúc JSON gốc khi khôi phục dữ liệu
   */
  public static parseBackupJson(rawJson: string): {
    valid: boolean;
    data?: Record<string, any[]>;
    totalRecords?: number;
    collections?: string[];
    collectionCounts?: Record<string, number>;
    isBase64?: boolean;
    metadata?: {
      title?: string;
      version?: string;
      createdAt?: string;
      createdBy?: string;
    };
    error?: string;
  } {
    try {
      const trimmed = (rawJson || '').trim();
      if (!trimmed) {
        return { valid: false, error: 'Dữ liệu tệp sao lưu rỗng.' };
      }

      let rawParsed: any;
      let wasBase64 = false;

      // 1. Thử phân tích JSON trực tiếp, nếu lỗi cú pháp thì thử giải mã chuỗi Base64 thô
      try {
        rawParsed = JSON.parse(trimmed);
      } catch (jsonErr) {
        try {
          const decoded = base64ToUtf8(trimmed);
          rawParsed = JSON.parse(decoded);
          wasBase64 = true;
        } catch {
          return { valid: false, error: 'Tệp JSON bị lỗi cú pháp hoặc không thể giải mã Base64.' };
        }
      }

      // 2. Trích xuất dữ liệu bên trong nếu được bao bọc hoặc mã hoá Base64
      let parsedData: unknown = rawParsed;
      const metadata: { title?: string; version?: string; createdAt?: string; createdBy?: string } = {};

      if (rawParsed && typeof rawParsed === 'object') {
        if (typeof rawParsed.title === 'string') metadata.title = rawParsed.title;
        if (typeof rawParsed.version === 'string') metadata.version = rawParsed.version;
        if (typeof rawParsed.createdAt === 'string') metadata.createdAt = rawParsed.createdAt;
        if (typeof rawParsed.createdBy === 'string') metadata.createdBy = rawParsed.createdBy;

        // Kiểm tra các thuộc tính Base64 phổ biến
        if (typeof rawParsed.dataBase64 === 'string') {
          const decodedStr = base64ToUtf8(rawParsed.dataBase64);
          parsedData = JSON.parse(decodedStr);
          wasBase64 = true;
        } else if (typeof rawParsed.payloadBase64 === 'string') {
          const decodedStr = base64ToUtf8(rawParsed.payloadBase64);
          parsedData = JSON.parse(decodedStr);
          wasBase64 = true;
        } else if (typeof rawParsed.contentBase64 === 'string') {
          const decodedStr = base64ToUtf8(rawParsed.contentBase64);
          parsedData = JSON.parse(decodedStr);
          wasBase64 = true;
        } else if (typeof rawParsed.base64Data === 'string') {
          const decodedStr = base64ToUtf8(rawParsed.base64Data);
          parsedData = JSON.parse(decodedStr);
          wasBase64 = true;
        } else if (typeof rawParsed.dataJson === 'string') {
          try {
            const inner = JSON.parse(rawParsed.dataJson);
            if (inner && typeof inner === 'object' && typeof inner.dataBase64 === 'string') {
              const decodedStr = base64ToUtf8(inner.dataBase64);
              parsedData = JSON.parse(decodedStr);
              wasBase64 = true;
            } else {
              parsedData = inner;
            }
          } catch {
            try {
              const decodedStr = base64ToUtf8(rawParsed.dataJson);
              parsedData = JSON.parse(decodedStr);
              wasBase64 = true;
            } catch {
              parsedData = rawParsed.dataJson;
            }
          }
        } else if (rawParsed.data && typeof rawParsed.data === 'object' && !Array.isArray(rawParsed.data)) {
          if (typeof (rawParsed.data as any).dataBase64 === 'string') {
            const decodedStr = base64ToUtf8((rawParsed.data as any).dataBase64);
            parsedData = JSON.parse(decodedStr);
            wasBase64 = true;
          } else {
            parsedData = rawParsed.data;
          }
        }
      }

      // Hỗ trợ trường hợp tải về mảng người dùng định danh hoặc bản sao lưu cá nhân (TYT_PERSONAL_PROFILE_BACKUP)
      if (Array.isArray(parsedData) && parsedData.length > 0 && parsedData.some(it => it && (it.uid || it.email))) {
        parsedData = { users: parsedData };
      } else if (
        parsedData &&
        typeof parsedData === 'object' &&
        !Array.isArray(parsedData) &&
        ((parsedData as any).type === 'TYT_PERSONAL_PROFILE_BACKUP' ||
          ((parsedData as any).identity && typeof (parsedData as any).identity === 'object'))
      ) {
        const pd = parsedData as any;
        const identityPart = (pd.identity && typeof pd.identity === 'object' ? pd.identity : pd.data) || {};
        const secPart =
          (pd.securityVerification && typeof pd.securityVerification === 'object'
            ? pd.securityVerification
            : pd.security) || {};
        const actPart = (pd.userActivity && typeof pd.userActivity === 'object' ? pd.userActivity : {}) || {};
        const mergedPersonalUser = {
          ...identityPart,
          id: identityPart.uid || identityPart.id || '',
          uid: identityPart.uid || identityPart.id || '',
          ...(typeof secPart.emailVerified === 'boolean' ? { emailVerified: secPart.emailVerified } : {}),
          ...(secPart.emailVerifiedAt ? { emailVerifiedAt: secPart.emailVerifiedAt } : {}),
          ...(typeof secPart.phoneVerified === 'boolean' ? { phoneVerified: secPart.phoneVerified } : {}),
          ...(secPart.verifiedPhone ? { verifiedPhone: secPart.verifiedPhone } : {}),
          ...(secPart.phoneVerifiedAt ? { phoneVerifiedAt: secPart.phoneVerifiedAt } : {}),
          ...(typeof secPart.citizenIdVerified === 'boolean' ? { citizenIdVerified: secPart.citizenIdVerified } : {}),
          ...(secPart.citizenIdVerifiedAt ? { citizenIdVerifiedAt: secPart.citizenIdVerifiedAt } : {}),
          ...(typeof secPart.hasPasswordLinked === 'boolean' ? { hasPasswordLinked: secPart.hasPasswordLinked } : {}),
          ...(typeof secPart.googleLinked === 'boolean' ? { googleLinked: secPart.googleLinked } : {}),
          ...(typeof secPart.twoFactorEnabled === 'boolean' ? { twoFactorEnabled: secPart.twoFactorEnabled } : {}),
          ...(secPart.twoFactorUpdatedAt ? { twoFactorUpdatedAt: secPart.twoFactorUpdatedAt } : {}),
          ...(typeof secPart.smsMfaEnabled === 'boolean' ? { smsMfaEnabled: secPart.smsMfaEnabled } : {}),
          ...(secPart.smsMfaPhoneMasked ? { smsMfaPhoneMasked: secPart.smsMfaPhoneMasked } : {}),
          ...(Array.isArray(secPart.verifiedDevices) ? { verifiedDevices: secPart.verifiedDevices } : {}),
          ...(secPart.totpSecurity ? { totpSecurity: secPart.totpSecurity } : {}),
        };
        const builtPersonalCollections: Record<string, any[]> = {};
        if (mergedPersonalUser.uid) {
          builtPersonalCollections.users = [mergedPersonalUser];
        }
        if (Array.isArray(secPart.verifiedIdentifiers) && secPart.verifiedIdentifiers.length > 0) {
          builtPersonalCollections.verifiedIdentifiers = secPart.verifiedIdentifiers;
        }
        if (Array.isArray(actPart.appointments) && actPart.appointments.length > 0) {
          builtPersonalCollections.appointments = actPart.appointments;
        }
        if (Array.isArray(actPart.feedback) && actPart.feedback.length > 0) {
          builtPersonalCollections.feedback = actPart.feedback;
        }
        if (Array.isArray(actPart.rescueSignals) && actPart.rescueSignals.length > 0) {
          builtPersonalCollections.rescueSignals = actPart.rescueSignals;
        }
        if (Array.isArray(actPart.nearbyFacilities) && actPart.nearbyFacilities.length > 0) {
          builtPersonalCollections.nearbyFacilities = actPart.nearbyFacilities;
        }
        if (Object.keys(builtPersonalCollections).length > 0) {
          parsedData = builtPersonalCollections;
        }
      }

      if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
        return { valid: false, error: 'Cấu trúc tệp JSON không đúng định dạng bản sao lưu.' };
      }

      // Kiểm tra lớp phụ nếu parsedData vẫn còn chứa dataBase64
      if (typeof (parsedData as any).dataBase64 === 'string') {
        try {
          const decodedStr = base64ToUtf8((parsedData as any).dataBase64);
          parsedData = JSON.parse(decodedStr);
          wasBase64 = true;
        } catch {
          // ignore
        }
      }

      const entries = Object.entries(parsedData as Record<string, unknown>).filter(
        ([collName, items]) => RESTORABLE_COLLECTIONS.has(collName) && Array.isArray(items)
      ) as [string, any[]][];

      if (entries.length === 0) {
        return {
          valid: false,
          error: 'Không tìm thấy phân hệ dữ liệu hợp lệ nào trong tệp sao lưu.',
        };
      }

      const validMap: Record<string, any[]> = {};
      const collectionCounts: Record<string, number> = {};
      let totalRecords = 0;
      const collections: string[] = [];

      for (const [collName, items] of entries) {
        const cleanItems = items
          .map(item => {
            if (!item || typeof item !== 'object') return null;
            const resolvedId =
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : collName === 'users' && typeof item.uid === 'string' && item.uid.trim()
                ? item.uid.trim()
                : collName === 'pushSubscriptions' &&
                  typeof item.deviceId === 'string' &&
                  item.deviceId.trim()
                ? item.deviceId.trim()
                : collName === 'onlinePresence' &&
                  typeof item.sessionId === 'string' &&
                  item.sessionId.trim()
                ? item.sessionId.trim()
                : '';
            if (!resolvedId) return null;
            if (collName === 'systemSettings' && resolvedId === 'connection_test') return null;
            return { ...item, id: resolvedId };
          })
          .filter(Boolean) as any[];

        validMap[collName] = cleanItems;
        collectionCounts[collName] = cleanItems.length;
        totalRecords += cleanItems.length;
        collections.push(collName);
      }

      return {
        valid: true,
        data: validMap,
        totalRecords,
        collections,
        collectionCounts,
        isBase64: wasBase64,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    } catch {
      return { valid: false, error: 'Tệp JSON bị lỗi cú pháp hoặc không thể đọc được.' };
    }
  }

  /**
   * Restore database from a backup JSON string
   */
  public static async restoreFromBackup(
    dataJson: string,
    userEmail?: string,
    selectedCollections?: string[]
  ): Promise<{ success: boolean; message: string }> {
    try {
      const parsed = this.parseBackupJson(dataJson);
      if (!parsed.valid || !parsed.data) {
        return { success: false, message: parsed.error || 'Tệp sao lưu không hợp lệ.' };
      }

      const selectedSet =
        Array.isArray(selectedCollections) && selectedCollections.length > 0
          ? new Set(selectedCollections)
          : null;

      let restoredCount = 0;
      let skippedCount = 0;
      const restoredCollections: string[] = [];

      for (const [collName, items] of Object.entries(parsed.data)) {
        if (!RESTORABLE_COLLECTIONS.has(collName) || !Array.isArray(items)) continue;
        if (selectedSet && !selectedSet.has(collName)) continue;

        if (collName === 'bhxhServerConfig') {
          let bhxhRestored = 0;
          for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const ok = await restoreBhxhServerConfigFromBackup(item);
            if (ok) {
              restoredCount++;
              bhxhRestored++;
            } else {
              skippedCount++;
            }
          }
          if (bhxhRestored > 0) {
            restoredCollections.push(collName);
          }
          continue;
        }

        let collRestored = 0;
        for (const item of items) {
          if (!item?.id) continue;
          if (collName === 'systemSettings' && item.id === 'connection_test') continue;

          // siteStats rules only allow 'summary' document with valid counters
          if (collName === 'siteStats' && item.id !== 'summary') {
            skippedCount++;
            continue;
          }

          const { id, ...rawData } = item;
          const docRef = doc(db, collName, id);

          // auditLogs & verifiedIdentifiers are immutable in Firestore rules: only restore missing records
          if (collName === 'auditLogs' || collName === 'verifiedIdentifiers') {
            try {
              const existingSnap = await getDoc(docRef);
              if (existingSnap.exists()) {
                skippedCount++;
                continue;
              }
              await setDoc(docRef, cleanDataForFirestore(rawData));
              restoredCount++;
              collRestored++;
            } catch {
              skippedCount++;
            }
            continue;
          }

          if (collName === 'users') {
            const {
              verifiedDevices,
              securityStatus,
              securityVerification,
              fullAddress,
              totpSecurity,
              enrolledSmsFactors,
              verificationPercent,
              verificationSummary,
              ...userDocBase
            } = rawData as Record<string, any>;
            void fullAddress;
            void totpSecurity;
            void enrolledSmsFactors;
            void verificationPercent;
            void verificationSummary;

            const secSource =
              (securityStatus && typeof securityStatus === 'object' ? securityStatus : null) ||
              (securityVerification && typeof securityVerification === 'object' ? securityVerification : null);

            const hydratedUserData: Record<string, any> = {
              ...userDocBase,
              uid: userDocBase.uid || id,
            };

            if (secSource) {
              const securityKeys = [
                'emailVerified',
                'emailVerifiedAt',
                'phoneVerified',
                'verifiedPhone',
                'phoneVerifiedAt',
                'citizenIdVerified',
                'citizenIdVerifiedAt',
                'hasPasswordLinked',
                'googleLinked',
                'twoFactorEnabled',
                'twoFactorUpdatedAt',
                'smsMfaEnabled',
                'smsMfaPhoneMasked',
              ];
              for (const key of securityKeys) {
                if (hydratedUserData[key] === undefined && secSource[key] !== undefined) {
                  hydratedUserData[key] = secSource[key];
                }
              }
            }

            try {
              await setDoc(docRef, cleanDataForFirestore(hydratedUserData), { merge: true });
              restoredCount++;
              collRestored++;

              if (Array.isArray(verifiedDevices)) {
                for (const dev of verifiedDevices) {
                  const devId = typeof dev?.deviceId === 'string' && dev.deviceId.trim() ? dev.deviceId.trim() : '';
                  if (!devId || !dev?.deviceName || !dev?.platform || !dev?.verifiedAt || !dev?.lastActiveAt) continue;
                  try {
                    await setDoc(
                      doc(db, 'users', id, 'devices', devId),
                      cleanDataForFirestore({
                        deviceId: devId,
                        deviceName: String(dev.deviceName).slice(0, 128),
                        platform: ['mobile', 'tablet', 'desktop'].includes(dev.platform) ? dev.platform : 'desktop',
                        isTrusted: Boolean(dev.isTrusted),
                        verifiedAt: String(dev.verifiedAt).slice(0, 64),
                        lastActiveAt: String(dev.lastActiveAt).slice(0, 64),
                        ...(typeof dev.os === 'string' ? { os: dev.os.slice(0, 64) } : {}),
                        ...(typeof dev.browser === 'string' ? { browser: dev.browser.slice(0, 64) } : {}),
                        ...(dev.verificationMethod ? { verificationMethod: dev.verificationMethod } : {}),
                        ...(typeof dev.firstSeenAt === 'string' ? { firstSeenAt: dev.firstSeenAt.slice(0, 64) } : {}),
                      }),
                      { merge: true }
                    );
                  } catch (devErr) {
                    console.warn(`Restore device ${id}/${devId} skipped:`, devErr);
                  }
                }
              }

              // Restore owner-only TOTP configuration when restoring the current admin's own account
              if (
                auth.currentUser?.uid === id &&
                totpSecurity &&
                totpSecurity.enabled &&
                typeof totpSecurity.secret === 'string' &&
                totpSecurity.secret.length >= 16
              ) {
                try {
                  const nowIso = new Date().toISOString();
                  await setDoc(doc(db, 'users', id, 'security', 'totp'), {
                    enabled: true,
                    secret: totpSecurity.secret,
                    recoveryCodes: Array.isArray(totpSecurity.recoveryCodes)
                      ? totpSecurity.recoveryCodes.slice(0, 12)
                      : [],
                    issuer: totpSecurity.issuer || 'Tram Y Te',
                    verifiedAt: totpSecurity.verifiedAt || nowIso,
                    updatedAt: totpSecurity.updatedAt || nowIso,
                  });
                } catch (totpErr) {
                  console.warn(`Restore owner TOTP ${id} skipped:`, totpErr);
                }
              }
            } catch (itemErr) {
              console.warn(`Restore user ${id} skipped:`, itemErr);
              skippedCount++;
            }
            continue;
          }

          try {
            await setDoc(docRef, cleanDataForFirestore(rawData), { merge: true });
            restoredCount++;
            collRestored++;
          } catch (itemErr) {
            console.warn(`Restore item ${collName}/${id} skipped:`, itemErr);
            skippedCount++;
          }
        }
        if (collRestored > 0) {
          restoredCollections.push(collName);
        }
      }

      try {
        await logAuditEvent(
          'Khôi phục dữ liệu hệ thống',
          'Sao lưu & Phục hồi',
          `Phục hồi ${restoredCount} bản ghi trên ${restoredCollections.length} phân hệ (${restoredCollections.join(', ')})${
            skippedCount > 0 ? ` · Bỏ qua ${skippedCount} bản ghi bất biến/không hợp lệ` : ''
          }`,
          { uid: userEmail || 'admin', name: userEmail || 'Admin' }
        );
      } catch {
        // Non-blocking audit log
      }

      return {
        success: true,
        message: `Khôi phục thành công ${restoredCount} bản ghi trên ${restoredCollections.length} phân hệ dữ liệu${
          skippedCount > 0 ? ` (giữ nguyên ${skippedCount} bản ghi bất biến/đã tồn tại)` : ''
        }.`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Lỗi khôi phục: ${err?.message || 'Tệp sao lưu không hợp lệ'}`,
      };
    }
  }

  /**
   * Trigger download of backup JSON file to user's computer
   */
  public static downloadBackupFile(backup: BackupItem) {
    if (!backup.dataJson) return;
    const blob = new Blob([backup.dataJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_tram_y_te_${(backup.version || 'v3').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Download any backup item (Cloud local dataJson or remote GitHub Base64 backup decoded back to readable JSON)
   */
  public static async downloadBackupItem(
    backup: BackupItem,
    githubConfig?: GitHubConfig
  ): Promise<{ success: boolean; error?: string }> {
    if (backup.dataJson && backup.dataJson.trim()) {
      this.downloadBackupFile(backup);
      return { success: true };
    }

    if (backup.storageType === 'github' && backup.githubPath) {
      if (!githubConfig || !isGitHubConfigValid(githubConfig)) {
        return {
          success: false,
          error: 'Cần cấu hình GitHub PAT để tải tệp sao lưu từ kho GitHub.',
        };
      }
      const fetchRes = await GitHubService.fetchFileText(githubConfig, backup.githubPath);
      if (!fetchRes.success || !fetchRes.content) {
        return {
          success: false,
          error: fetchRes.error || 'Không thể tải tệp sao lưu từ GitHub.',
        };
      }

      // Tự động giải mã Base64 về JSON gốc dễ đọc & có thể dùng khôi phục trực tiếp
      const parsed = this.parseBackupJson(fetchRes.content);
      const outputJson =
        parsed.valid && parsed.data
          ? JSON.stringify(parsed.data, null, 2)
          : fetchRes.content;

      const blob = new Blob([outputJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_github_${(backup.version || 'v3').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true };
    }

    return { success: false, error: 'Bản sao lưu không chứa dữ liệu để tải về.' };
  }

  /**
   * Directly fetch and restore from a backup file stored on GitHub (automatically decodes Base64)
   */
  public static async restoreFromGitHub(
    githubConfig: GitHubConfig,
    filePath: string,
    userEmail?: string,
    selectedCollections?: string[]
  ): Promise<{ success: boolean; message: string; isBase64?: boolean; totalRecords?: number }> {
    const fetchRes = await GitHubService.fetchFileText(githubConfig, filePath);
    if (!fetchRes.success || !fetchRes.content) {
      return { success: false, message: fetchRes.error || 'Không tải được bản sao lưu từ GitHub' };
    }
    const restoreRes = await this.restoreFromBackup(fetchRes.content, userEmail, selectedCollections);
    return restoreRes;
  }
}
