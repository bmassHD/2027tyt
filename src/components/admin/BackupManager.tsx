import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { BackupItem, GitHubConfig, SystemSettings } from '../../types';
import {
  BackupService,
  BACKUP_COLLECTIONS,
  CURRENT_SYSTEM_VERSION,
  getVietnamTimeParts,
  hasGithubBackupForDay,
  isDailyGithubBackupMissing,
} from '../../services/backupService';
import { updateSystemSettings } from '../../services/firebaseService';
import { useToast } from '../../contexts/ToastContext';
import {
  Database,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  Plus,
  RefreshCw,
  Clock,
  ShieldCheck,
  FileJson,
  HardDriveDownload,
  Users,
  FolderGit2,
  ExternalLink,
  Eye,
  X,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import { GitHubService } from '../../services/githubService';

interface BackupManagerProps {
  userEmail: string;
  lastBackupAt?: string;
  githubConfig?: GitHubConfig;
  settings?: SystemSettings;
  onDataRestored?: () => void;
}

interface RemoteGitHubBackupFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  downloadUrl: string;
  htmlUrl?: string;
}

function parseTimestampFromBackupFilename(fileName: string): string {
  const m = fileName.match(/(\d{13})/);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isNaN(ms) && ms > 1_600_000_000_000) {
      return new Date(ms).toISOString();
    }
  }
  return new Date().toISOString();
}

export const BackupManager: React.FC<BackupManagerProps> = ({
  userEmail,
  lastBackupAt,
  githubConfig,
  settings,
  onDataRestored,
}) => {
  const { showToast, showConfirm } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [remoteGithubFiles, setRemoteGithubFiles] = useState<RemoteGitHubBackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isBackingUpGitHub, setIsBackingUpGitHub] = useState(false);
  const [isExportingLocal, setIsExportingLocal] = useState(false);
  const [isExportingUsers, setIsExportingUsers] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [savingAutoToggle, setSavingAutoToggle] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'github' | 'cloud'>('all');
  const [customTitle, setCustomTitle] = useState('');

  // GitHub restore modal state
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [gitHubBackups, setGitHubBackups] = useState<RemoteGitHubBackupFile[]>([]);
  const [loadingGitHubBackups, setLoadingGitHubBackups] = useState(false);
  const [previewingGitHubFile, setPreviewingGitHubFile] = useState<{
    file: { name: string; path: string; size: number };
    rawContent: string;
    parsed: ReturnType<typeof BackupService.parseBackupJson>;
  } | null>(null);
  const [fetchingGitHubContent, setFetchingGitHubContent] = useState(false);

  // Selective collection restore modal state
  const [restorePicker, setRestorePicker] = useState<{
    source: 'cloud' | 'local' | 'github';
    title: string;
    rawContent: string;
    createdAt?: string;
    version?: string;
    isBase64?: boolean;
    collections: string[];
    collectionCounts: Record<string, number>;
    selectedCollections: string[];
  } | null>(null);
  const [loadingRestorePicker, setLoadingRestorePicker] = useState(false);

  const isGitHubConfigured = Boolean(
    githubConfig?.token?.trim() && githubConfig?.owner?.trim() && githubConfig?.repo?.trim()
  );

  const autoBackupEnabled = settings?.autoBackupGithubEnabled !== false;
  const vnNow = getVietnamTimeParts();
  const pushedGithubToday = hasGithubBackupForDay(settings, vnNow.dayKey);
  const missingDailyGithub = isDailyGithubBackupMissing(settings);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const [list, ghFiles] = await Promise.all([
        BackupService.listBackups(),
        isGitHubConfigured && githubConfig
          ? GitHubService.listBackupFiles(githubConfig)
          : Promise.resolve([]),
      ]);
      setBackups(list);
      setRemoteGithubFiles(ghFiles);
    } catch {
      showToast('error', 'Không thể tải danh sách bản sao lưu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'backups'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        setBackups(snap.docs.map(d => ({ id: d.id, ...d.data() } as BackupItem)));
        setLoading(false);
      },
      () => {
        void fetchBackups();
      }
    );
    return () => unsub();
  }, []);

  // Also load any legacy GitHub backup files not yet recorded in Firestore `backups`
  useEffect(() => {
    if (!isGitHubConfigured || !githubConfig) {
      setRemoteGithubFiles([]);
      return;
    }
    let cancelled = false;
    GitHubService.listBackupFiles(githubConfig)
      .then(files => {
        if (!cancelled) {
          setRemoteGithubFiles(files);
        }
      })
      .catch(() => {
        // non-blocking
      });
    return () => {
      cancelled = true;
    };
  }, [isGitHubConfigured, githubConfig?.owner, githubConfig?.repo, githubConfig?.branch, githubConfig?.folderPath]);

  // Merge Firestore backup records + unrecorded legacy GitHub backup files seamlessly
  const mergedBackups = useMemo<BackupItem[]>(() => {
    const recordedGithubPaths = new Set(
      backups.map(b => b.githubPath).filter((p): p is string => Boolean(p))
    );

    const legacyRemoteItems: BackupItem[] = remoteGithubFiles
      .filter(f => !recordedGithubPaths.has(f.path))
      .map(f => ({
        id: `gh_remote_${f.sha || f.path}`,
        title: `Sao lưu GitHub (${f.name})`,
        version: CURRENT_SYSTEM_VERSION,
        createdAt: parseTimestampFromBackupFilename(f.name),
        createdBy: githubConfig?.owner || 'GitHub Repository',
        sizeBytes: f.size,
        collectionsIncluded: BACKUP_COLLECTIONS.map(c => c.key),
        stats: {
          postsCount: 0,
          servicesCount: 0,
          documentsCount: 0,
          usersCount: 0,
          feedbackCount: 0,
        },
        storageType: 'github',
        githubPath: f.path,
        githubHtmlUrl: f.htmlUrl,
        encoding: 'base64',
        dataJson: '',
      }));

    const combined = [...backups, ...legacyRemoteItems];
    combined.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    return combined;
  }, [backups, remoteGithubFiles, githubConfig?.owner]);

  const filteredBackups = useMemo(() => {
    if (historyFilter === 'github') {
      return mergedBackups.filter(b => b.storageType === 'github');
    }
    if (historyFilter === 'cloud') {
      return mergedBackups.filter(b => b.storageType !== 'github');
    }
    return mergedBackups;
  }, [mergedBackups, historyFilter]);

  const handleToggleAutoBackup = async () => {
    setSavingAutoToggle(true);
    try {
      const nextVal = !autoBackupEnabled;
      await updateSystemSettings({
        autoBackupGithubEnabled: nextVal,
        updatedAt: new Date().toISOString(),
      });
      showToast(
        'success',
        nextVal
          ? 'Đã bật tự động sao lưu GitHub lúc 03:00 sáng hằng ngày'
          : 'Đã tạm tắt nhắc & tự động sao lưu GitHub 03:00 sáng'
      );
    } catch {
      showToast('error', 'Không thể cập nhật cấu hình tự động sao lưu');
    } finally {
      setSavingAutoToggle(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreating(true);
    try {
      const res = await BackupService.createBackup(userEmail, customTitle);
      if (res.success) {
        showToast(
          res.warning ? 'warning' : 'success',
          'Đã tạo bản sao lưu lên Cloud thành công',
          res.warning || `Phiên bản: ${CURRENT_SYSTEM_VERSION}`
        );
        setCustomTitle('');
        fetchBackups();
        if (onDataRestored) onDataRestored();
      } else {
        showToast('error', 'Tạo sao lưu thất bại', res.error);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleExportLocal = async () => {
    setIsExportingLocal(true);
    try {
      const res = await BackupService.exportLocalBackup(userEmail, customTitle);
      if (res.success) {
        showToast(
          'success',
          'Đã tải tệp sao lưu JSON về máy',
          `Tổng ${res.totalRecords ?? 0} bản ghi (${Math.max(1, Math.round((res.sizeBytes || 0) / 1024))} KB)`
        );
      } else {
        showToast('error', 'Xuất tệp sao lưu thất bại', res.error);
      }
    } finally {
      setIsExportingLocal(false);
    }
  };

  const handleExportUsers = async () => {
    setIsExportingUsers(true);
    try {
      const res = await BackupService.exportUsersProfilesBackup(userEmail);
      if (res.success) {
        showToast(
          'success',
          'Đã tải bản sao lưu Người dùng & Định danh',
          `Tổng ${res.usersCount ?? 0} tài khoản kèm Dân tộc & Địa giới hành chính (${Math.max(1, Math.round((res.sizeBytes || 0) / 1024))} KB)`
        );
      } else {
        showToast('error', 'Xuất sao lưu người dùng thất bại', res.error);
      }
    } finally {
      setIsExportingUsers(false);
    }
  };

  const handleBackupToGitHub = async () => {
    if (!githubConfig || !isGitHubConfigured) {
      showToast(
        'warning',
        'Chưa cấu hình GitHub',
        'Vui lòng thiết lập Token & Repository tại tab "Kho tệp GitHub" trước khi sao lưu.'
      );
      return;
    }
    setIsBackingUpGitHub(true);
    try {
      const res = await BackupService.backupToGitHub(githubConfig, userEmail, customTitle);
      if (res.success) {
        showToast(
          'success',
          'Đã sao lưu lên GitHub & ghi lịch sử thành công',
          `Đã lưu ${res.totalRecords ?? 0} bản ghi (${Math.max(1, Math.round((res.sizeBytes || 0) / 1024))} KB) tại ${res.path}`
        );
        setCustomTitle('');
        void fetchBackups();
        if (onDataRestored) onDataRestored();
      } else {
        showToast('error', 'Sao lưu lên GitHub thất bại', res.error);
      }
    } finally {
      setIsBackingUpGitHub(false);
    }
  };

  const handleOpenGitHubRestore = async () => {
    if (!githubConfig || !isGitHubConfigured) {
      showToast(
        'warning',
        'Chưa cấu hình GitHub',
        'Vui lòng thiết lập Token & Repository tại tab "Kho tệp GitHub" trước khi lấy danh sách bản sao lưu.'
      );
      return;
    }
    setShowGitHubModal(true);
    setLoadingGitHubBackups(true);
    setPreviewingGitHubFile(null);
    try {
      const files = await GitHubService.listBackupFiles(githubConfig);
      setGitHubBackups(files);
      setRemoteGithubFiles(files);
    } catch {
      showToast('error', 'Lỗi khi lấy danh sách bản sao lưu từ kho GitHub');
    } finally {
      setLoadingGitHubBackups(false);
    }
  };

  const handlePreviewGitHubFile = async (file: { name: string; path: string; size: number }) => {
    if (!githubConfig) return;
    setFetchingGitHubContent(true);
    try {
      const res = await GitHubService.fetchFileText(githubConfig, file.path);
      if (!res.success || !res.content) {
        showToast('error', 'Không thể đọc tệp từ GitHub', res.error);
        return;
      }
      const parsed = BackupService.parseBackupJson(res.content);
      if (!parsed.valid) {
        showToast('error', 'Tệp sao lưu không hợp lệ', parsed.error);
        return;
      }
      setPreviewingGitHubFile({ file, rawContent: res.content, parsed });
    } finally {
      setFetchingGitHubContent(false);
    }
  };

  const handleRestoreFromGitHubConfirmed = async (rawContent: string, fileName: string) => {
    showConfirm({
      title: `Khôi phục từ bản sao lưu GitHub "${fileName}"?`,
      message:
        'Hệ thống sẽ tự động giải mã Base64 và phục hồi toàn bộ dữ liệu phân hệ theo bản sao lưu này. Bạn có chắc chắn muốn tiến hành?',
      confirmText: 'Khôi phục ngay',
      cancelText: 'Huỷ',
      isDangerous: true,
      onConfirm: async () => {
        setIsRestoring(true);
        try {
          const res = await BackupService.restoreFromBackup(rawContent, userEmail);
          if (res.success) {
            showToast('success', 'Khôi phục dữ liệu từ GitHub hoàn tất', res.message);
            setShowGitHubModal(false);
            setPreviewingGitHubFile(null);
            if (onDataRestored) {
              onDataRestored();
            }
          } else {
            showToast('error', 'Khôi phục thất bại', res.message);
          }
        } finally {
          setIsRestoring(false);
        }
      },
    });
  };

  const handleOpenSelectiveFromGitHubPreview = () => {
    if (!previewingGitHubFile) return;
    const cols = previewingGitHubFile.parsed.collections || [];
    setRestorePicker({
      source: 'github',
      title: previewingGitHubFile.parsed.metadata?.title || previewingGitHubFile.file.name,
      rawContent: previewingGitHubFile.rawContent,
      createdAt: previewingGitHubFile.parsed.metadata?.createdAt,
      version: previewingGitHubFile.parsed.metadata?.version,
      isBase64: previewingGitHubFile.parsed.isBase64,
      collections: cols,
      collectionCounts: previewingGitHubFile.parsed.collectionCounts || {},
      selectedCollections: cols,
    });
  };

  const handleConfirmSelectiveRestore = () => {
    if (!restorePicker || restorePicker.selectedCollections.length === 0) {
      showToast('warning', 'Chưa chọn phân hệ nào', 'Vui lòng chọn ít nhất 1 phân hệ dữ liệu để khôi phục.');
      return;
    }

    const selectedLabels = restorePicker.selectedCollections
      .map(key => BACKUP_COLLECTIONS.find(c => c.key === key)?.label || key)
      .slice(0, 6)
      .join(', ');
    const extraCount =
      restorePicker.selectedCollections.length > 6
        ? ` và ${restorePicker.selectedCollections.length - 6} phân hệ khác`
        : '';

    showConfirm({
      title: `Khôi phục ${restorePicker.selectedCollections.length} phân hệ đã chọn?`,
      message: `Hệ thống sẽ phục hồi từ "${restorePicker.title}" cho các phân hệ: ${selectedLabels}${extraCount}. Các bản ghi trùng ID sẽ được cập nhật theo bản sao lưu này.`,
      confirmText: 'Tiến hành khôi phục',
      cancelText: 'Huỷ',
      isDangerous: true,
      onConfirm: async () => {
        setIsRestoring(true);
        try {
          const res = await BackupService.restoreFromBackup(
            restorePicker.rawContent,
            userEmail,
            restorePicker.selectedCollections
          );
          if (res.success) {
            showToast('success', 'Khôi phục chọn lọc hoàn tất', res.message);
            setRestorePicker(null);
            setShowGitHubModal(false);
            setPreviewingGitHubFile(null);
            if (onDataRestored) {
              onDataRestored();
            }
          } else {
            showToast('error', 'Khôi phục thất bại', res.message);
          }
        } finally {
          setIsRestoring(false);
        }
      },
    });
  };

  const handleDownloadBackupItem = async (backup: BackupItem) => {
    setDownloadingId(backup.id);
    try {
      const res = await BackupService.downloadBackupItem(backup, githubConfig);
      if (res.success) {
        showToast(
          'success',
          backup.storageType === 'github'
            ? 'Đã tải & giải mã tệp sao lưu từ GitHub'
            : 'Đã tải tệp sao lưu JSON về máy'
        );
      } else {
        showToast('error', 'Không thể tải bản sao lưu', res.error);
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleRestore = async (backup: BackupItem) => {
    const isGithubRemote = backup.storageType === 'github' && !backup.dataJson;
    if (isGithubRemote && (!githubConfig || !isGitHubConfigured)) {
      showToast(
        'warning',
        'Chưa cấu hình GitHub',
        'Vui lòng thiết lập Token & Repository tại tab "Kho tệp GitHub" để khôi phục bản sao lưu từ GitHub.'
      );
      return;
    }

    let rawContent = backup.dataJson || '';
    if (isGithubRemote && githubConfig && backup.githubPath) {
      setLoadingRestorePicker(true);
      try {
        const fetched = await GitHubService.fetchFileText(githubConfig, backup.githubPath);
        if (!fetched.success || !fetched.content) {
          showToast('error', 'Không thể tải bản sao lưu từ GitHub', fetched.error);
          return;
        }
        rawContent = fetched.content;
      } finally {
        setLoadingRestorePicker(false);
      }
    }

    const parsed = BackupService.parseBackupJson(rawContent);
    if (!parsed.valid) {
      showToast('error', 'Bản sao lưu không hợp lệ', parsed.error);
      return;
    }

    const cols = parsed.collections || [];
    setRestorePicker({
      source: backup.storageType === 'github' ? 'github' : 'cloud',
      title: backup.title,
      rawContent,
      createdAt: parsed.metadata?.createdAt || backup.createdAt,
      version: parsed.metadata?.version || backup.version,
      isBase64: parsed.isBase64,
      collections: cols,
      collectionCounts: parsed.collectionCounts || {},
      selectedCollections: cols,
    });
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      const validation = BackupService.parseBackupJson(content);

      if (!validation.valid) {
        showToast('error', 'Tệp sao lưu không hợp lệ', validation.error);
        return;
      }

      const cols = validation.collections || [];
      setRestorePicker({
        source: 'local',
        title: file.name,
        rawContent: content,
        createdAt: validation.metadata?.createdAt,
        version: validation.metadata?.version,
        isBase64: validation.isBase64,
        collections: cols,
        collectionCounts: validation.collectionCounts || {},
        selectedCollections: cols,
      });
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleDelete = (backup: BackupItem) => {
    if (backup.id.startsWith('gh_remote_')) {
      showToast(
        'info',
        'Bản sao lưu cũ trên kho GitHub',
        'Mục này được đọc trực tiếp từ thư mục backups/ trên GitHub (không có bản ghi trong Firestore). Nếu cần xoá, vui lòng xoá trực tiếp trên GitHub.'
      );
      return;
    }

    showConfirm({
      title: 'Xoá bản sao lưu này khỏi lịch sử?',
      message: `Bản ghi lịch sử "${backup.title}" sẽ bị xoá khỏi Firestore.${
        backup.storageType === 'github' ? ' (Tệp gốc trên GitHub vẫn được giữ an toàn).' : ''
      }`,
      confirmText: 'Xoá',
      cancelText: 'Huỷ',
      isDangerous: true,
      onConfirm: async () => {
        const ok = await BackupService.deleteBackup(backup.id);
        if (ok) {
          showToast('success', 'Đã xoá bản sao lưu khỏi lịch sử');
          void fetchBackups();
        } else {
          showToast('error', 'Không thể xoá bản sao lưu');
        }
      },
    });
  };

  const latestBackupDate = lastBackupAt || mergedBackups[0]?.createdAt;
  const githubCount = mergedBackups.filter(b => b.storageType === 'github').length;
  const cloudCount = mergedBackups.filter(b => b.storageType !== 'github').length;

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 shrink-0">
              <Database className="w-7 h-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Hệ Thống Sao Lưu &amp; Phục Hồi Dữ Liệu
                </h3>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                  {CURRENT_SYSTEM_VERSION}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sao lưu toàn bộ {BACKUP_COLLECTIONS.length} phân hệ dữ liệu Firestore: cấu hình trạm, bản đồ, tin tức, dịch vụ, văn bản, lịch trực 24/7, phản ánh, lịch hẹn, tài khoản (định danh Y tế, trạng thái bảo mật/xác minh &amp; thiết bị tin cậy) và khoá định danh.
              </p>
              {latestBackupDate && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-1.5 flex items-center gap-1.5 tabular-nums">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Sao lưu gần nhất: {new Date(latestBackupDate).toLocaleString('vi-VN')}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loading}
              onClick={fetchBackups}
              className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl bg-slate-100 dark:bg-slate-800 transition cursor-pointer"
              title="Tải lại danh sách"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileImport}
            />
            <button
              type="button"
              disabled={isRestoring}
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Phục hồi từ tệp JSON</span>
            </button>

            <button
              type="button"
              disabled={isExportingLocal}
              onClick={handleExportLocal}
              className="px-3.5 py-2 text-xs font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 border border-teal-200 dark:border-teal-800 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
            >
              <HardDriveDownload className={`w-3.5 h-3.5 ${isExportingLocal ? 'animate-pulse' : ''}`} />
              <span>{isExportingLocal ? 'Đang xuất...' : 'Tải JSON về máy'}</span>
            </button>

            <button
              type="button"
              disabled={isExportingUsers}
              onClick={handleExportUsers}
              className="px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              title="Xuất bản sao lưu toàn bộ Định danh Y tế cá nhân, Trạng thái bảo mật, Xác minh tài khoản & Thiết bị tin cậy"
            >
              <Users className={`w-3.5 h-3.5 ${isExportingUsers ? 'animate-pulse' : ''}`} />
              <span>{isExportingUsers ? 'Đang xuất...' : 'Sao lưu Người dùng & Bảo mật'}</span>
            </button>

            <button
              type="button"
              disabled={isBackingUpGitHub}
              onClick={handleBackupToGitHub}
              title={
                isGitHubConfigured
                  ? 'Đẩy bản sao lưu JSON đầy đủ (mã hoá Base64) lên kho GitHub và lưu lịch sử'
                  : 'Cần cấu hình Kho tệp GitHub trước'
              }
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer border ${
                isGitHubConfigured
                  ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 border-indigo-200 dark:border-indigo-800'
                  : 'text-slate-500 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-75'
              }`}
            >
              <FolderGit2 className={`w-3.5 h-3.5 ${isBackingUpGitHub ? 'animate-pulse' : ''}`} />
              <span>{isBackingUpGitHub ? 'Đang đẩy GitHub...' : 'Sao lưu lên GitHub'}</span>
            </button>

            <button
              type="button"
              disabled={loadingGitHubBackups}
              onClick={handleOpenGitHubRestore}
              title={
                isGitHubConfigured
                  ? 'Xem danh sách và khôi phục dữ liệu từ các bản sao lưu đã lưu trên kho GitHub'
                  : 'Cần cấu hình Kho tệp GitHub trước'
              }
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer border ${
                isGitHubConfigured
                  ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 border-purple-200 dark:border-purple-800'
                  : 'text-slate-500 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-75'
              }`}
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loadingGitHubBackups ? 'animate-spin' : ''}`} />
              <span>Khôi phục từ GitHub</span>
            </button>

            <button
              type="button"
              disabled={isCreating}
              onClick={handleCreateBackup}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              {isCreating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>Sao lưu lên Cloud</span>
            </button>
          </div>
        </div>

        {/* Daily 03:00 AM GitHub Auto-Backup Schedule Card */}
        <div
          className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
            missingDailyGithub
              ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
              : pushedGithubToday
              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70'
              : 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/70'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`p-2 rounded-xl shrink-0 ${
                missingDailyGithub
                  ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                  : pushedGithubToday
                  ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                  : 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
              }`}
            >
              <CalendarClock className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Lịch Tự Động Đẩy Sao Lưu GitHub Lúc 03:00 Sáng Hằng Ngày
                </span>
                {pushedGithubToday ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold">
                    <CheckCircle2 className="w-3 h-3" />
                    Đã đẩy GitHub hôm nay
                  </span>
                ) : missingDailyGithub ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-bold">
                    <AlertTriangle className="w-3 h-3" />
                    Hôm nay chưa đẩy lên GitHub (Quá 03:00 sáng)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-semibold">
                    Chờ phiên 03:00 sáng hôm nay
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                Hệ thống tự động mã hoá Base64 và đẩy lên GitHub lúc 03:00 sáng (giờ VN) khi có phiên Quản trị hoạt động. Nếu hôm đó chưa tự động đẩy, hệ thống sẽ nhắc Quản trị viên khi truy cập cho tới khi đẩy xong.
              </p>
              {settings?.lastGithubBackupAt && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Đẩy GitHub gần nhất: {new Date(settings.lastGithubBackupAt).toLocaleString('vi-VN')}
                </p>
              )}
              {settings?.lastAutoGithubBackupStatus === 'failed' && settings?.lastAutoGithubBackupError && (
                <p className="text-[11px] text-rose-700 dark:text-rose-300 font-medium">
                  Lỗi tự động đẩy gần nhất: {settings.lastAutoGithubBackupError}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {missingDailyGithub && isGitHubConfigured && (
              <button
                type="button"
                disabled={isBackingUpGitHub}
                onClick={handleBackupToGitHub}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FolderGit2 className={`w-3.5 h-3.5 ${isBackingUpGitHub ? 'animate-pulse' : ''}`} />
                <span>{isBackingUpGitHub ? 'Đang đẩy...' : 'Đẩy GitHub ngay'}</span>
              </button>
            )}
            <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Tự động 03:00
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoBackupEnabled}
                aria-label="Bật hoặc tắt sao lưu GitHub tự động lúc 03:00"
                disabled={savingAutoToggle}
                onClick={handleToggleAutoBackup}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-60 ${
                  autoBackupEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                    autoBackupEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Custom backup label & protected collections checklist */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-5">
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Tên / Ghi chú bản sao lưu (tùy chọn)
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={e => setCustomTitle(e.target.value)}
              placeholder="Ví dụ: Sao lưu định kỳ trước khi cập nhật lịch trực tháng..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="lg:col-span-7">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              Phân hệ được sao lưu đồng bộ ({BACKUP_COLLECTIONS.length} phân hệ):
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              {BACKUP_COLLECTIONS.map(c => c.label).join(' · ')}
            </div>
          </div>
        </div>
      </div>

      {isRestoring && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-amber-600 animate-spin" />
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Đang phục hồi cơ sở dữ liệu từ bản sao lưu... Vui lòng không đóng trình duyệt.
          </span>
        </div>
      )}

      {/* History Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
          <Clock className="w-4 h-4 text-teal-600" />
          <span>Lịch Sử Sao Lưu ({filteredBackups.length})</span>
        </div>
        <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 gap-1">
          <button
            type="button"
            onClick={() => setHistoryFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              historyFilter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Tất cả ({mergedBackups.length})
          </button>
          <button
            type="button"
            onClick={() => setHistoryFilter('github')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              historyFilter === 'github'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-indigo-700'
            }`}
          >
            GitHub ({githubCount})
          </button>
          <button
            type="button"
            onClick={() => setHistoryFilter('cloud')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              historyFilter === 'cloud'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-teal-700'
            }`}
          >
            Cloud ({cloudCount})
          </button>
        </div>
      </div>

      {/* Backups List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredBackups.length === 0 ? (
          <div className="col-span-full p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
            {loading
              ? 'Đang tải danh sách bản sao lưu...'
              : 'Chưa có bản sao lưu nào phù hợp. Hãy bấm "Sao lưu lên GitHub", "Sao lưu lên Cloud" hoặc "Tải JSON về máy".'}
          </div>
        ) : (
          filteredBackups.map(b => {
            const isGithub = b.storageType === 'github';
            const isLegacyRemote = b.id.startsWith('gh_remote_');
            const approxKb = b.sizeBytes
              ? Math.max(1, Math.round(b.sizeBytes / 1024))
              : Math.max(1, Math.round(new Blob([b.dataJson || '']).size / 1024));

            return (
              <div
                key={b.id}
                className={`p-5 rounded-2xl bg-white dark:bg-slate-900 border shadow-xs flex flex-col justify-between gap-4 transition ${
                  isGithub
                    ? 'border-indigo-200/80 dark:border-indigo-900/70 hover:border-indigo-500/60'
                    : 'border-slate-200 dark:border-slate-800 hover:border-teal-500/50'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isGithub ? (
                        <FolderGit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      ) : (
                        <FileJson className="w-5 h-5 text-teal-600 shrink-0" />
                      )}
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {b.title}
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0 tabular-nums">
                      {approxKb} KB
                    </span>
                  </div>

                  {/* Storage & Schedule Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {isGithub ? (
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-semibold">
                        GitHub · Base64
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 text-[10px] font-semibold">
                        Cloud Firestore
                      </span>
                    )}
                    {b.isAutoBackup && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-semibold">
                        Tự động 03:00
                      </span>
                    )}
                    {isLegacyRemote && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium">
                        Đồng bộ từ kho GitHub
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500 tabular-nums">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(b.createdAt).toLocaleString('vi-VN')}
                    </span>
                    <span>Thực hiện: {b.createdBy}</span>
                  </div>

                  {isGithub && b.githubPath && (
                    <div className="mt-1.5 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 truncate">
                      {b.githubPath}
                    </div>
                  )}

                  {/* Stats badge grid */}
                  {!isLegacyRemote && (
                    <>
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center tabular-nums">
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Cấu hình</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.settingsCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Tin tức</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.postsCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Văn bản</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.documentsCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Lịch trực</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.workSchedulesCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Sự kiện</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.eventsCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">CSYT lân cận</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.nearbyFacilitiesCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Phản ánh</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.feedbackCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Dịch vụ</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.servicesCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Thông báo</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {(b.stats?.notificationsCount ?? 0) + (b.stats?.announcementsCount ?? 0)}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">SOS / Lịch hẹn</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {(b.stats?.rescueSignalsCount ?? 0) + (b.stats?.appointmentsCount ?? 0)}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <div className="text-[10px] text-slate-400 truncate">Tài khoản</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.stats?.usersCount ?? 0}
                          </div>
                        </div>
                        <div className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/50">
                          <div className="text-[10px] text-teal-700 dark:text-teal-400 truncate">Tổng mục</div>
                          <div className="text-xs font-bold text-teal-800 dark:text-teal-300">
                            {b.stats?.totalRecords ??
                              (b.stats?.postsCount ?? 0) +
                                (b.stats?.servicesCount ?? 0) +
                                (b.stats?.documentsCount ?? 0) +
                                (b.stats?.usersCount ?? 0) +
                                (b.stats?.feedbackCount ?? 0)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                        <span>
                          Tệp đính kèm phản ánh: {b.stats?.feedbackAttachmentsCount ?? 0} · Thiết bị tin cậy: {b.stats?.userDevicesCount ?? 0} · Khoá định danh: {b.stats?.verifiedIdentifiersCount ?? 0} · Cấu hình BHXH server: {b.stats?.bhxhServerConfigCount ?? 0} · Quản trị viên: {b.stats?.adminsCount ?? 0} · Push: {b.stats?.pushSubscriptionsCount ?? 0} · Nhật ký: {b.stats?.auditLogsCount ?? 0}
                        </span>
                        <span className="font-semibold text-teal-700 dark:text-teal-400">
                          {b.collectionsIncluded?.length || BACKUP_COLLECTIONS.length} phân hệ
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={downloadingId === b.id}
                      onClick={() => handleDownloadBackupItem(b)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-teal-600 dark:hover:text-teal-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {downloadingId === b.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{downloadingId === b.id ? 'Đang tải...' : 'Tải JSON'}</span>
                    </button>

                    {isGithub && b.githubHtmlUrl && (
                      <a
                        href={b.githubHtmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 rounded-lg transition inline-flex items-center gap-1"
                        title="Mở tệp trên GitHub"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>GitHub</span>
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isRestoring || loadingRestorePicker}
                      onClick={() => handleRestore(b)}
                      className="px-3 py-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/60 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${loadingRestorePicker ? 'animate-spin' : ''}`} />
                      <span>{loadingRestorePicker ? 'Đang đọc...' : 'Khôi phục'}</span>
                    </button>
                    {!isLegacyRemote && (
                      <button
                        type="button"
                        onClick={() => handleDelete(b)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer"
                        title="Xoá bản ghi lịch sử"
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

      {/* GitHub Restore Modal */}
      {showGitHubModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
          onClick={e => {
            if (e.target === e.currentTarget && !isRestoring && !fetchingGitHubContent) {
              setShowGitHubModal(false);
            }
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-purple-700 text-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-white/15 shrink-0">
                  <FolderGit2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    Bản Sao Lưu Trên Kho GitHub
                  </h3>
                  <p className="text-xs text-purple-100 truncate">
                    {githubConfig?.owner}/{githubConfig?.repo} · Tự động giải mã Base64 ngược về dữ liệu gốc
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isRestoring || fetchingGitHubContent}
                onClick={() => setShowGitHubModal(false)}
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {loadingGitHubBackups ? (
                <div className="p-10 text-center text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-purple-600" />
                  <div>Đang tải danh sách bản sao lưu từ kho lưu trữ GitHub...</div>
                </div>
              ) : gitHubBackups.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                  <FolderGit2 className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Chưa có bản sao lưu nào trên GitHub
                  </div>
                  <p className="text-slate-500 max-w-md mx-auto">
                    Bấm &ldquo;Sao lưu lên GitHub&rdquo; ở giao diện chính để đẩy bản sao lưu hệ thống (mã hoá Base64 an toàn) lên kho lưu trữ.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 text-slate-500 text-[11px]">
                    <span>Tìm thấy {gitHubBackups.length} tệp sao lưu trong thư mục backups/</span>
                    <button
                      type="button"
                      disabled={loadingGitHubBackups}
                      onClick={handleOpenGitHubRestore}
                      className="text-purple-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Làm mới</span>
                    </button>
                  </div>

                  {/* Preview Section if a file is loaded */}
                  {previewingGitHubFile && (
                    <div className="p-4 rounded-2xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 space-y-3 animate-in fade-in">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-purple-600" />
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                              {previewingGitHubFile.parsed.metadata?.title || previewingGitHubFile.file.name}
                            </h4>
                          </div>
                          <p className="text-[11px] text-purple-800 dark:text-purple-300 mt-0.5">
                            {previewingGitHubFile.parsed.isBase64
                              ? 'Đã tự động giải mã Base64 ngược về định dạng dữ liệu hệ thống gốc.'
                              : 'Định dạng JSON tiêu chuẩn.'}{' '}
                            Tổng {previewingGitHubFile.parsed.totalRecords ?? 0} bản ghi trên{' '}
                            {previewingGitHubFile.parsed.collections?.length ?? 0} phân hệ.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setPreviewingGitHubFile(null)}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Collections Breakdown */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                        {(previewingGitHubFile.parsed.collections || []).map(key => {
                          const label = BACKUP_COLLECTIONS.find(c => c.key === key)?.label || key;
                          const count = previewingGitHubFile.parsed.collectionCounts?.[key] ?? 0;
                          return (
                            <div
                              key={key}
                              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/60 flex items-center justify-between gap-1"
                            >
                              <span className="text-slate-600 dark:text-slate-400 truncate">{label}</span>
                              <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums">
                                {count}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-purple-200/60 dark:border-purple-900/40">
                        <button
                          type="button"
                          onClick={() => setPreviewingGitHubFile(null)}
                          className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
                        >
                          Đóng xem trước
                        </button>
                        <button
                          type="button"
                          disabled={isRestoring}
                          onClick={handleOpenSelectiveFromGitHubPreview}
                          className="px-3.5 py-1.5 rounded-xl border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 hover:bg-purple-100/70 dark:hover:bg-purple-950 text-purple-800 dark:text-purple-200 font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Chọn phân hệ khôi phục</span>
                        </button>
                        <button
                          type="button"
                          disabled={isRestoring}
                          onClick={() =>
                            handleRestoreFromGitHubConfirmed(
                              previewingGitHubFile.rawContent,
                              previewingGitHubFile.file.name
                            )
                          }
                          className="px-4 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Tiến hành khôi phục toàn bộ</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Files List */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                    {gitHubBackups.map(file => {
                      const sizeKb = Math.max(1, Math.round(file.size / 1024));
                      const isCurrentlyPreviewing = previewingGitHubFile?.file.path === file.path;

                      return (
                        <div
                          key={file.sha || file.path}
                          className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                            isCurrentlyPreviewing
                              ? 'bg-purple-50/50 dark:bg-purple-950/30'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 shrink-0">
                              <FileJson className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 dark:text-white truncate">
                                {file.name}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                                {sizeKb} KB · Mã hoá Base64
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {file.htmlUrl && (
                              <a
                                href={file.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                                title="Xem tệp trên GitHub"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}

                            <button
                              type="button"
                              disabled={fetchingGitHubContent || isRestoring}
                              onClick={() => handlePreviewGitHubFile(file)}
                              className="px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 text-purple-800 dark:text-purple-300 font-semibold inline-flex items-center gap-1.5 cursor-pointer border border-purple-200 dark:border-purple-800"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>
                                {fetchingGitHubContent && isCurrentlyPreviewing
                                  ? 'Đang tải...'
                                  : 'Xem & Khôi phục'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowGitHubModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Selective Collection Restore Modal */}
      {restorePicker && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-sm animate-in fade-in"
          onClick={e => {
            if (e.target === e.currentTarget && !isRestoring) {
              setRestorePicker(null);
            }
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-teal-700 text-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-white/15 shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    Chọn Phân Hệ Dữ Liệu Khôi Phục
                  </h3>
                  <p className="text-xs text-teal-100 truncate tabular-nums">
                    {restorePicker.title}
                    {restorePicker.version ? ` · ${restorePicker.version}` : ''}
                    {restorePicker.createdAt
                      ? ` · ${new Date(restorePicker.createdAt).toLocaleString('vi-VN')}`
                      : ''}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isRestoring}
                onClick={() => setRestorePicker(null)}
                className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold">
                    {restorePicker.source === 'github'
                      ? 'Nguồn: GitHub'
                      : restorePicker.source === 'local'
                      ? 'Nguồn: Tệp JSON trên máy'
                      : 'Nguồn: Cloud Firestore'}
                  </span>
                  {restorePicker.isBase64 && (
                    <span className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-semibold">
                      Đã giải mã Base64
                    </span>
                  )}
                  <span className="text-slate-600 dark:text-slate-300 font-medium tabular-nums">
                    Đã chọn{' '}
                    <strong className="text-teal-700 dark:text-teal-400">
                      {restorePicker.selectedCollections.length}/{restorePicker.collections.length}
                    </strong>{' '}
                    phân hệ (
                    <strong className="text-teal-700 dark:text-teal-400">
                      {restorePicker.selectedCollections.reduce(
                        (sum, key) => sum + (restorePicker.collectionCounts[key] ?? 0),
                        0
                      )}
                    </strong>{' '}
                    bản ghi)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setRestorePicker(prev =>
                        prev ? { ...prev, selectedCollections: [...prev.collections] } : prev
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 font-semibold hover:bg-teal-100 transition cursor-pointer"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRestorePicker(prev =>
                        prev ? { ...prev, selectedCollections: [] } : prev
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-200 transition cursor-pointer"
                  >
                    Bỏ chọn hết
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {restorePicker.collections.map(key => {
                  const meta = BACKUP_COLLECTIONS.find(c => c.key === key);
                  const label = meta?.label || key;
                  const count = restorePicker.collectionCounts[key] ?? 0;
                  const checked = restorePicker.selectedCollections.includes(key);

                  return (
                    <label
                      key={key}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition select-none ${
                        checked
                          ? 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700'
                          : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setRestorePicker(prev => {
                              if (!prev) return prev;
                              const exists = prev.selectedCollections.includes(key);
                              return {
                                ...prev,
                                selectedCollections: exists
                                  ? prev.selectedCollections.filter(item => item !== key)
                                  : [...prev.selectedCollections, key],
                              };
                            })
                          }
                          className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-white truncate">
                            {label}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            {key}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums shrink-0 ${
                          count > 0
                            ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}
                      >
                        {count} mục
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-amber-800 dark:text-amber-200 text-[11px] leading-relaxed">
                Lưu ý: Dữ liệu trùng ID ở các phân hệ đã chọn sẽ được cập nhật theo bản sao lưu này. Nhật ký kiểm toán hiện tại vẫn được giữ nguyên tính bất biến; khoá 2FA TOTP chỉ được khôi phục cho chính tài khoản đang thao tác nếu có trong gói sao lưu.
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={isRestoring}
                onClick={() => setRestorePicker(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={isRestoring || restorePicker.selectedCollections.length === 0}
                onClick={handleConfirmSelectiveRestore}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                <span>
                  {isRestoring
                    ? 'Đang khôi phục...'
                    : `Khôi phục ${restorePicker.selectedCollections.length} phân hệ đã chọn`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
