/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { doc, collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from './firebase/config';
import { handleFirestoreError, OperationType } from './firebase/errorHandler';
import { AuthProvider, useAuth, captureReferralCodeFromUrl } from './contexts/AuthContext';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { AppShell } from './components/layout/AppShell';

import { PortalHomeView } from './components/views/PortalHomeView';
import { NewsView } from './components/views/NewsView';
import { DocumentsView } from './components/views/DocumentsView';
import { CitizenHubView } from './components/views/CitizenHubView';
import { AdminConsoleView } from './components/views/AdminConsoleView';
import { AccountDeviceView } from './components/views/AccountDeviceView';
import { PublicDutyScheduleView } from './components/portal/PublicDutyScheduleView';
import { StationMapSection } from './components/portal/StationMapSection';
import { VaccinationView } from './components/views/VaccinationView';
import { OrgChartView } from './components/views/OrgChartView';
import { PersonnelDirectoryView } from './components/views/PersonnelDirectoryView';
import { RescueMapView } from './components/views/RescueMapView';
import { NearbyFacilitiesView } from './components/views/NearbyFacilitiesView';
import { EventsView } from './components/views/EventsView';
import { BhxhLookupView } from './components/views/BhxhLookupView';
import { ShieldAlert, LogIn, Wrench, EyeOff, Phone, ArrowLeft, Building2, MapPin, UserCheck, FolderGit2, RefreshCw, Ban, MonitorSmartphone, Clock, LogOut } from 'lucide-react';
import { evaluateAccessRestriction } from './utils/deviceAccessDetector';
import { getBannedUntilMs, formatBanTimestampVi, formatBanRemainingVi } from './utils/userBan';

import { AdminSetupWizard } from './components/modals/AdminSetupWizard';
import { FeedbackModal } from './components/portal/FeedbackModal';
import { AuthModal } from './components/auth/AuthModal';
import { TwoFactorGateModal } from './components/auth/TwoFactorGateModal';
import { SmsMfaChallengeModal } from './components/auth/SmsMfaChallengeModal';
import { StartupPopupModal } from './components/modals/StartupPopupModal';
import { VaccinationStartupPopupModal } from './components/modals/VaccinationStartupPopupModal';
import { EventCelebrationModal } from './components/modals/EventCelebrationModal';
import { HolidayNoticeModal } from './components/modals/HolidayNoticeModal';
import { GithubBackupReminderModal } from './components/modals/GithubBackupReminderModal';
import { FullScreenLoadingOverlay } from './components/common/FullScreenLoadingOverlay';
import { FirstSessionSplashOverlay } from './components/common/FirstSessionSplashOverlay';
import { ConfettiEffect } from './components/common/ConfettiEffect';
import { ErrorBoundary } from './components/common/ErrorBoundary';

import {
  SystemSettings,
  FeedbackItem,
  UserProfile,
  AuditLog,
  StationEvent,
  HolidayScheduleItem,
  WorkSchedule,
} from './types';
import {
  emptySystemSettings,
  getFeedbackList,
  getUserProfiles,
  getAuditLogs,
  getConfiguredEmergencyContacts,
  getStationPointLeaders,
  sortLocationsPrimaryFirst,
  getVietnamTodayKey,
  isEventHappeningToday,
  sortStationEvents,
  getActiveHolidaysToday,
  updateSystemSettings,
} from './services/firebaseService';
import {
  BackupService,
  getVietnamTimeParts,
  isDailyGithubBackupMissing,
  shouldRunAutoGithubBackupNow,
  isGitHubConfigValid,
} from './services/backupService';
import { cleanDataForFirestore } from './services/firebaseService';
import { createDefaultOrgChart } from './data/defaultOrgChart';
import { syncUsersIntoOrgChart } from './services/orgPersonnelSyncService';
import {
  isFirestoreWriteQuotaExceeded,
  markFirestoreWriteQuotaExceededIfMatch,
} from './utils/firestoreQuotaGuard';

// Hash Route Mapping
const VIEW_TO_HASH: Record<string, string> = {
  portal: 'trang-chu',
  org_chart: 'so-do-to-chuc',
  personnel_directory: 'nhan-luc-khoa-phong',
  vaccination: 'lich-tiem-chung',
  events: 'su-kien',
  duty: 'lich-truc',
  map: 'ban-do',
  nearby_facilities: 'co-so-y-te-lan-can',
  rescue: 'cuu-ho-cuu-nan',
  news: 'tin-tuc',
  documents: 'van-ban',
  bhyt_lookup: 'tra-cuu-bhyt',
  telehealth: 'bac-si-cho-moi-nha',
  feedback_tracking: 'phan-anh',
  admin: 'quan-tri',
  account: 'tai-khoan',
};

const HASH_TO_VIEW: Record<string, string> = {
  ...Object.entries(VIEW_TO_HASH).reduce(
    (acc, [view, hash]) => {
      acc[hash] = view;
      return acc;
    },
    {} as Record<string, string>
  ),
  'nhan-luc': 'personnel_directory',
  'khoa-phong': 'personnel_directory',
  'tra-cuu-bhyt': 'bhyt_lookup',
  bhyt: 'bhyt_lookup',
  'gop-y-tra-cuu': 'feedback_tracking',
  'tra-cuu': 'feedback_tracking',
  'gop-y': 'feedback_tracking',
  'cai-dat-hethong': 'account',
  'cai-dat-he-thong': 'account',
  'dang-nhap': 'account',
};

function parseHashRoute(): { view: string; query: string } {
  const hashStr = window.location.hash.replace(/^#\/?/, '');
  const [routePart, queryPart] = hashStr.split('?');
  const view = HASH_TO_VIEW[routePart] || 'portal';
  return { view, query: queryPart || '' };
}

function MainApp() {
  const { currentUser, userProfile, isPrimaryAdmin, isAdmin, isStaff, isBanned, logout, requiresTwoFactorVerification, pendingSmsMfaResolver } = useAuth();
  const { showToast } = useToast();

  const initialReferralRef = useRef<string>(captureReferralCodeFromUrl());
  const initialRoute = parseHashRoute();
  const hasExplicitHash = Boolean(window.location.hash && window.location.hash !== '#' && window.location.hash !== '#/');
  const resolvedInitialView =
    !hasExplicitHash && initialReferralRef.current ? 'account' : initialRoute.view;
  const initialTabParam = new URLSearchParams(initialRoute.query).get('tab') || undefined;
  const [currentView, setCurrentViewInternal] = useState<string>(resolvedInitialView);
  const [adminRequestedSubTab, setAdminRequestedSubTab] = useState<string | undefined>(
    initialRoute.view === 'admin' ? initialTabParam : undefined
  );
  const [newsRequestedTab, setNewsRequestedTab] = useState<'api' | 'station' | undefined>(
    initialRoute.view === 'news' && (initialTabParam === 'api' || initialTabParam === 'station')
      ? initialTabParam
      : undefined
  );
  const [isPageLoading, setIsPageLoading] = useState<boolean>(false);
  const [showFirstSessionSplash, setShowFirstSessionSplash] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('tyt_first_session_splash_shown') !== '1';
    } catch {
      return true;
    }
  });
  const [isFirstSplashFading, setIsFirstSplashFading] = useState<boolean>(false);
  const [minFirstSplashElapsed, setMinFirstSplashElapsed] = useState<boolean>(false);
  const [showInitialSplash, setShowInitialSplash] = useState<boolean>(true);
  const [isSplashFading, setIsSplashFading] = useState<boolean>(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState<boolean>(false);
  const [settings, setSettings] = useState<SystemSettings>(() => {
    try {
      const cached = localStorage.getItem('tyt_cached_station_settings');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          return { ...emptySystemSettings, ...parsed };
        }
      }
    } catch {
      // ignore
    }
    return emptySystemSettings;
  });
  const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false);

  // Events & celebration states
  const [events, setEvents] = useState<StationEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState<boolean>(false);
  const [confettiTriggerKey, setConfettiTriggerKey] = useState<number>(0);
  const [eventAutoModalOpen, setEventAutoModalOpen] = useState<boolean>(false);
  const [previewEvent, setPreviewEvent] = useState<StationEvent | null>(null);
  const [handledEventSig, setHandledEventSig] = useState<string | null>(null);
  const autoConfettiTriggeredRef = useRef<boolean>(false);

  // Holiday notice modal states
  const [holidayAutoModalOpen, setHolidayAutoModalOpen] = useState<boolean>(false);
  const [previewHoliday, setPreviewHoliday] = useState<HolidayScheduleItem | null>(null);
  const [handledHolidaySig, setHandledHolidaySig] = useState<string | null>(null);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);

  // Daily 03:00 AM GitHub Auto-Backup & Admin Reminder states
  const [vnClockTick, setVnClockTick] = useState<number>(() => Date.now());
  const autoBackupRunningRef = useRef<boolean>(false);
  const [isReminderBackingUp, setIsReminderBackingUp] = useState<boolean>(false);
  const [dismissedReminderDay, setDismissedReminderDay] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('tyt_gh_backup_reminder_dismissed_day');
    } catch {
      return null;
    }
  });

  // Admin view data (lazily fetched when needed)
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isAdminSetupModalOpen, setIsAdminSetupModalOpen] = useState(false);
  const [isGeneralPopupOpen, setIsGeneralPopupOpen] = useState(false);
  const [isVaccinationPopupOpen, setIsVaccinationPopupOpen] = useState(false);

  // First-layer per-session white splash (displayed once per browser session, reloads on next session)
  useEffect(() => {
    if (!showFirstSessionSplash) return;
    try {
      sessionStorage.setItem('tyt_first_session_splash_shown', '1');
    } catch {
      // ignore
    }
    const minTimer = window.setTimeout(() => setMinFirstSplashElapsed(true), 1350);
    const maxTimer = window.setTimeout(() => {
      setIsFirstSplashFading(true);
      window.setTimeout(() => setShowFirstSessionSplash(false), 500);
    }, 3000);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, [showFirstSessionSplash]);

  useEffect(() => {
    if (!showFirstSessionSplash || !minFirstSplashElapsed || !settingsLoaded) return;
    setIsFirstSplashFading(true);
    const hideTimer = window.setTimeout(() => {
      setShowFirstSessionSplash(false);
    }, 500);
    return () => window.clearTimeout(hideTimer);
  }, [showFirstSessionSplash, minFirstSplashElapsed, settingsLoaded]);

  // Initial startup splash timer (ensures logo + unit name + spin are shown cleanly on entry)
  useEffect(() => {
    const minTimer = window.setTimeout(() => setMinSplashElapsed(true), 950);
    const maxTimer = window.setTimeout(() => {
      setIsSplashFading(true);
      window.setTimeout(() => setShowInitialSplash(false), 300);
    }, 2600);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, []);

  useEffect(() => {
    if (!showInitialSplash || !minSplashElapsed || !settingsLoaded) return;
    setIsSplashFading(true);
    const hideTimer = window.setTimeout(() => {
      setShowInitialSplash(false);
    }, 300);
    return () => window.clearTimeout(hideTimer);
  }, [showInitialSplash, minSplashElapsed, settingsLoaded]);

  // Navigate function with Hash sync and transition animation
  const setCurrentView = useCallback((newView: string, extraQuery?: string) => {
    setIsPageLoading(true);

    const hashName = VIEW_TO_HASH[newView] || 'trang-chu';
    const targetHash = extraQuery ? `#${hashName}?${extraQuery}` : `#${hashName}`;
    window.history.pushState(null, '', targetHash);

    const tabParam = extraQuery ? new URLSearchParams(extraQuery).get('tab') || undefined : undefined;
    if (newView === 'admin' && tabParam) {
      setAdminRequestedSubTab(tabParam);
    } else if (newView !== 'admin') {
      setAdminRequestedSubTab(undefined);
    }

    if (newView === 'news' && (tabParam === 'api' || tabParam === 'station')) {
      setNewsRequestedTab(tabParam);
    } else if (newView !== 'news') {
      setNewsRequestedTab(undefined);
    }

    setCurrentViewInternal(newView);

    // Smooth page loading transition effect
    setTimeout(() => {
      setIsPageLoading(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 280);
  }, []);

  const openVaccinationAdminSetup = useCallback(() => {
    setCurrentView('admin', 'tab=vaccination_setup');
  }, [setCurrentView]);

  // Listen to hash changes (browser back/forward button or external links)
  useEffect(() => {
    const handleHashChange = () => {
      const { view, query } = parseHashRoute();
      const tabParam = query ? new URLSearchParams(query).get('tab') || undefined : undefined;
      if (view === 'admin' && tabParam) {
        setAdminRequestedSubTab(tabParam);
      }
      if (view === 'news' && (tabParam === 'api' || tabParam === 'station')) {
        setNewsRequestedTab(tabParam);
      }
      if (view !== currentView) {
        setIsPageLoading(true);
        setCurrentViewInternal(view);
        setTimeout(() => setIsPageLoading(false), 250);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [currentView]);

  // Realtime subscription to system settings so admin edits reflect immediately everywhere
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'systemSettings', 'general'),
      snap => {
        if (snap.exists()) {
          const data = snap.data() as SystemSettings;
          setSettings(data);
          try {
            localStorage.setItem('tyt_cached_station_settings', JSON.stringify(data));
          } catch {
            // ignore
          }
        } else {
          setSettings(emptySystemSettings);
        }
        setSettingsLoaded(true);
      },
      err => {
        console.warn('System settings listener:', err);
        setSettingsLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  // Sync HTML document title, SEO meta, OpenGraph & Twitter share card with configured station settings
  useEffect(() => {
    if (!settingsLoaded) return;
    const isConfigured = settings.stationName && !settings.stationName.includes('Chưa cấu hình');
    const title = isConfigured
      ? `${settings.stationName} - Cổng Thông Tin Điện Tử`
      : 'Cổng Thông Tin Điện Tử Trạm Y Tế';
    const description =
      settings.subTitle?.trim() ||
      'Cổng thông tin điện tử chính thức Trạm Y tế: tra cứu lịch trực 24/7, bản đồ mạng lưới y tế, lịch tiêm chủng, văn bản chỉ đạo và phản ánh trực tuyến.';
    const origin = window.location.origin;
    const pageUrl = `${origin}${window.location.pathname}`;
    const seoImageUrl = `${origin}/seoapp.jpg`;

    document.title = title;
    const setMeta = (selector: string, content: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('content', content);
    };
    const setHref = (selector: string, href: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('href', href);
    };

    setMeta('meta[name="description"]', description);
    setMeta('meta[itemprop="image"]', seoImageUrl);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:site_name"]', isConfigured ? settings.stationName : title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:url"]', pageUrl);
    setMeta('meta[property="og:image"]', seoImageUrl);
    setMeta('meta[property="og:image:url"]', seoImageUrl);
    setMeta('meta[property="og:image:secure_url"]', seoImageUrl);
    setMeta('meta[property="og:image:type"]', 'image/jpeg');
    setMeta('meta[property="og:image:width"]', '1200');
    setMeta('meta[property="og:image:height"]', '675');
    setMeta('meta[property="og:image:alt"]', title);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);
    setMeta('meta[name="twitter:image"]', seoImageUrl);
    setMeta('meta[name="twitter:image:alt"]', title);
    setHref('link[rel="canonical"]', pageUrl);
    setHref('link[rel="image_src"]', seoImageUrl);
  }, [settingsLoaded, settings.stationName, settings.subTitle]);

  // Minute ticker for 03:00 AM daily GitHub auto-backup & overdue reminder check
  useEffect(() => {
    if (!isAdmin) return;
    const interval = window.setInterval(() => {
      setVnClockTick(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [isAdmin]);

  // Automatic 03:00 AM (VN time) GitHub backup execution when an Admin session is active
  useEffect(() => {
    if (!isAdmin || !settingsLoaded || autoBackupRunningRef.current) return;
    const now = new Date(vnClockTick);
    if (!shouldRunAutoGithubBackupNow(settings, now)) return;

    const { dayKey } = getVietnamTimeParts(now);
    try {
      if (localStorage.getItem('tyt_auto_gh_backup_attempt_day') === dayKey) {
        return;
      }
      localStorage.setItem('tyt_auto_gh_backup_attempt_day', dayKey);
    } catch {
      // ignore storage errors
    }

    autoBackupRunningRef.current = true;
    const actorEmail = currentUser?.email || 'Hệ thống tự động 03:00';

    (async () => {
      try {
        if (!isFirestoreWriteQuotaExceeded()) {
          await updateSystemSettings({
            lastAutoGithubBackupAttemptDay: dayKey,
            updatedAt: new Date().toISOString(),
          });
        }
        const res = await BackupService.backupToGitHub(
          settings.githubConfig!,
          actorEmail,
          undefined,
          { isAutoBackup: true }
        );
        if (res.success) {
          showToast(
            'success',
            'Tự động sao lưu 03:00 lên GitHub thành công',
            `Đã đẩy ${res.totalRecords ?? 0} bản ghi (Base64) tại ${res.path}`
          );
        } else {
          showToast(
            'error',
            'Tự động sao lưu 03:00 lên GitHub thất bại',
            res.error || 'Vui lòng đẩy sao lưu thủ công.'
          );
        }
      } catch (err: any) {
        console.warn('Auto 03:00 GitHub backup error:', err);
      } finally {
        autoBackupRunningRef.current = false;
      }
    })();
  }, [isAdmin, settingsLoaded, settings, vnClockTick, currentUser?.email, showToast]);

  // Realtime subscription to station events
  useEffect(() => {
    const q = isStaff
      ? collection(db, 'events')
      : query(collection(db, 'events'), where('isActive', '==', true));

    const unsub = onSnapshot(
      q,
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as StationEvent));
        setEvents(sortStationEvents(items));
        setEventsLoaded(true);
      },
      err => {
        setEventsLoaded(true);
        try {
          handleFirestoreError(err, OperationType.LIST, 'events');
        } catch {
          // Non-fatal fallback if user lacks permission before deployment
        }
      }
    );
    return () => unsub();
  }, [isStaff]);

  // Realtime subscription to work/duty schedules (for holiday notice, banner, and admin setup preview)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'workSchedules'),
      snap => {
        setWorkSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkSchedule)));
      },
      err => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'workSchedules');
        } catch {
          // Non-fatal fallback if permission is temporarily unavailable
        }
      }
    );
    return () => unsub();
  }, []);

  // Realtime subscriptions for admin/staff operational data
  useEffect(() => {
    if (!isStaff) {
      setFeedbackList([]);
      return;
    }
    const unsubFeedback = onSnapshot(
      collection(db, 'feedback'),
      snap => {
        setFeedbackList(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeedbackItem)));
      },
      err => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'feedback');
        } catch {
          // Non-fatal fallback
        }
      }
    );
    return () => unsubFeedback();
  }, [isStaff]);

  useEffect(() => {
    if (!isAdmin) {
      setUsers([]);
      setAuditLogs([]);
      return;
    }
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      snap => {
        setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
      },
      err => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } catch {
          // Non-fatal fallback
        }
      }
    );
    const unsubAudit = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(50)),
      snap => {
        setAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog)));
      },
      err => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'auditLogs');
        } catch {
          // Non-fatal fallback
        }
      }
    );
    return () => {
      unsubUsers();
      unsubAudit();
    };
  }, [isAdmin]);

  // Manual refresh helper for compatibility with AdminConsoleView prop
  const fetchAdminData = useCallback(async () => {
    try {
      const [fb, usr, aud] = await Promise.all([
        getFeedbackList(),
        getUserProfiles(),
        getAuditLogs(),
      ]);
      setFeedbackList(fb);
      setUsers(usr);
      setAuditLogs(aud);
    } catch (e) {
      console.warn('Fetch admin records:', e);
    }
  }, []);

  // Tự động đồng bộ tài khoản cán bộ / người dùng có liên kết sang Quản Lý Nhân Lực & Khoa Phòng
  const lastOrgAutoSyncSigRef = useRef<string>('');
  const orgAutoSyncInFlightRef = useRef<boolean>(false);
  const orgAutoSyncDisabledRef = useRef<boolean>(false);
  const orgAutoSyncCooldownUntilRef = useRef<number>(0);

  useEffect(() => {
    if (
      !isAdmin ||
      !settingsLoaded ||
      users.length === 0 ||
      orgAutoSyncInFlightRef.current ||
      orgAutoSyncDisabledRef.current ||
      isFirestoreWriteQuotaExceeded()
    ) {
      return;
    }

    if (Date.now() < orgAutoSyncCooldownUntilRef.current) return;

    const sig = [
      settings.orgChart?.updatedAt || 'none',
      (settings.orgChart?.excludedSyncedUids || []).join(','),
      ...users
        .map(u =>
          [
            u.uid,
            u.displayName || '',
            u.citizenId || '',
            u.phoneNumber || '',
            u.department || '',
            u.position || '',
            u.qualification || '',
            u.accountType || '',
            u.role || '',
            u.status || '',
          ].join('|')
        )
        .sort(),
    ].join('::');

    if (lastOrgAutoSyncSigRef.current === sig) return;
    lastOrgAutoSyncSigRef.current = sig;

    const hasPersistedOrg = Boolean(
      settings.orgChart &&
        (settings.orgChart.director ||
          (settings.orgChart.deputyDirectors?.length || 0) > 0 ||
          (settings.orgChart.departments?.length || 0) > 0)
    );
    const baseChart =
      hasPersistedOrg && settings.orgChart ? settings.orgChart : createDefaultOrgChart();

    const syncRes = syncUsersIntoOrgChart(baseChart, users);
    if (!syncRes.changed) return;

    // Kiểm tra tính lũy đẳng (idempotency): chạy lần 2 trên kết quả phải không còn thay đổi
    const verifyPass = syncUsersIntoOrgChart(syncRes.nextChart, users);
    if (verifyPass.changed) {
      console.warn('Auto-sync aborted to prevent non-idempotent write loop.');
      orgAutoSyncDisabledRef.current = true;
      return;
    }

    orgAutoSyncInFlightRef.current = true;
    orgAutoSyncCooldownUntilRef.current = Date.now() + 15_000;

    const nextOrgChart = cleanDataForFirestore({
      ...syncRes.nextChart,
      updatedAt: new Date().toISOString(),
    });
    updateSystemSettings({
      orgChart: nextOrgChart,
      updatedAt: new Date().toISOString(),
    })
      .catch(err => {
        if (markFirestoreWriteQuotaExceededIfMatch(err)) {
          orgAutoSyncDisabledRef.current = true;
        }
        console.warn('Auto sync users to orgChart error:', err);
      })
      .finally(() => {
        orgAutoSyncInFlightRef.current = false;
      });
  }, [isAdmin, settingsLoaded, settings.orgChart, users]);

  const accessEval = useMemo(
    () => evaluateAccessRestriction(settings.accessControl),
    [settings.accessControl]
  );
  const isSuperAdminActual = Boolean(isPrimaryAdmin || userProfile?.role === 'super_admin');
  const exemptAdminsFromBlock = settings.accessControl?.exemptAdmins !== false;
  const blockedByAccessRestriction =
    settingsLoaded &&
    accessEval.isBlocked &&
    !isSuperAdminActual &&
    !(isAdmin && exemptAdminsFromBlock);

  const isGlobalMaintenance = settingsLoaded && !!settings.maintenanceMode;
  const isTabUnderMaintenance = settingsLoaded && !!settings.tabMaintenance?.[currentView];
  const isTabHidden = settingsLoaded && !!settings.hiddenTabs?.includes(currentView);
  const blockedByGlobalMaintenance = !blockedByAccessRestriction && !isSuperAdminActual && !isAdmin && isGlobalMaintenance && currentView !== 'account' && currentView !== 'admin';
  const blockedByTabMaintenance = !blockedByAccessRestriction && !isSuperAdminActual && !isAdmin && !blockedByGlobalMaintenance && isTabUnderMaintenance && currentView !== 'account' && currentView !== 'admin';
  const blockedByHiddenTab = !blockedByAccessRestriction && !isSuperAdminActual && !isAdmin && !blockedByGlobalMaintenance && !blockedByTabMaintenance && isTabHidden && currentView !== 'account' && currentView !== 'admin';
  const configuredEmergencies = getConfiguredEmergencyContacts(settings);
  const maintenancePointLeaders = useMemo(() => {
    const baseLeaders = getStationPointLeaders(settings);
    const existingIds = new Set(baseLeaders.map(l => l.id));
    const extraPoints = sortLocationsPrimaryFirst(settings.mapLocations || [])
      .filter(loc => loc.name && !existingIds.has(loc.id))
      .map(loc => ({
        id: loc.id,
        pointName: loc.name,
        address: loc.address,
        headName: loc.headName?.trim() || undefined,
        phone: loc.phone?.trim() || undefined,
        isPrimary: Boolean(loc.isPrimary),
      }));
    return [...baseLeaders, ...extraPoints];
  }, [settings]);

  const todayKey = getVietnamTodayKey();
  const todayEvents = useMemo(
    () => events.filter(ev => isEventHappeningToday(ev, todayKey)),
    [events, todayKey]
  );
  const todayAutoEvents = useMemo(
    () => todayEvents.filter(ev => ev.enableAutoPopup !== false),
    [todayEvents]
  );
  const todaySilentConfettiEvents = useMemo(
    () => todayEvents.filter(ev => ev.enableAutoPopup === false && ev.enableConfetti !== false),
    [todayEvents]
  );
  const todayEventSignature = useMemo(
    () =>
      todayAutoEvents
        .map(ev => `${ev.id}:${ev.updatedAt || ev.eventDate}`)
        .join('|'),
    [todayAutoEvents]
  );
  const todayAutoEventsRef = useRef(todayAutoEvents);
  todayAutoEventsRef.current = todayAutoEvents;

  const isEventModalOpen = Boolean(previewEvent) || (eventAutoModalOpen && todayAutoEvents.length > 0);
  const modalEventsToDisplay = useMemo(
    () => (previewEvent ? [previewEvent] : todayAutoEvents),
    [previewEvent, todayAutoEvents]
  );
  const wasEventModalOpenRef = useRef(false);

  const activeHolidaysToday = useMemo(
    () => getActiveHolidaysToday(settings, todayKey),
    [settings, todayKey]
  );
  const autoPopupHolidaysToday = useMemo(
    () => activeHolidaysToday.filter(h => h.showModalOnEntry !== false),
    [activeHolidaysToday]
  );
  const todayHolidaySignature = useMemo(
    () =>
      autoPopupHolidaysToday
        .map(h => `${h.id}:${h.updatedAt || h.startDate}`)
        .join('|'),
    [autoPopupHolidaysToday]
  );
  const autoPopupHolidaysRef = useRef(autoPopupHolidaysToday);
  autoPopupHolidaysRef.current = autoPopupHolidaysToday;

  const isHolidayModalOpen =
    Boolean(previewHoliday) || (holidayAutoModalOpen && autoPopupHolidaysToday.length > 0);
  const modalHolidaysToDisplay = useMemo(
    () => (previewHoliday ? [previewHoliday] : autoPopupHolidaysToday),
    [previewHoliday, autoPopupHolidaysToday]
  );

  // Automatic holiday notice modal when visiting on an active holiday date
  useEffect(() => {
    if (showFirstSessionSplash || showInitialSplash || !settingsLoaded || blockedByGlobalMaintenance) return;

    if (
      autoPopupHolidaysRef.current.length > 0 &&
      todayHolidaySignature &&
      handledHolidaySig !== todayHolidaySignature
    ) {
      const dismissKey = `tyt_holiday_popup_dismissed_${todayKey}`;
      let isDismissedToday = false;
      try {
        isDismissedToday = localStorage.getItem(dismissKey) === todayHolidaySignature;
      } catch {
        // ignore
      }

      if (!isDismissedToday) {
        const timer = window.setTimeout(() => {
          setHolidayAutoModalOpen(true);
          setHandledHolidaySig(todayHolidaySignature);
          const lead = autoPopupHolidaysRef.current[0];
          if (lead) {
            showToast(
              'warning',
              `Hôm nay nghỉ lễ: ${lead.name}`,
              lead.noticeMessage || 'Nghỉ làm việc hành chính, trực cấp cứu 24/7 vẫn hoạt động bình thường.'
            );
          }
        }, 200);
        return () => window.clearTimeout(timer);
      } else {
        setHandledHolidaySig(todayHolidaySignature);
      }
    }
  }, [
    showFirstSessionSplash,
    showInitialSplash,
    settingsLoaded,
    blockedByGlobalMaintenance,
    todayHolidaySignature,
    handledHolidaySig,
    todayKey,
    showToast,
  ]);

  const handleCloseHolidayModal = useCallback(
    (dontShowToday: boolean) => {
      if (dontShowToday && !previewHoliday && todayHolidaySignature) {
        try {
          localStorage.setItem(`tyt_holiday_popup_dismissed_${todayKey}`, todayHolidaySignature);
        } catch {
          // ignore
        }
      }
      setHolidayAutoModalOpen(false);
      setPreviewHoliday(null);
    },
    [previewHoliday, todayHolidaySignature, todayKey]
  );

  const handlePreviewHoliday = useCallback((holiday: HolidayScheduleItem) => {
    setPreviewHoliday(holiday);
  }, []);

  // Automatic event notification popup when visiting on the event date (wait if holiday modal is active)
  useEffect(() => {
    if (showFirstSessionSplash || showInitialSplash || !settingsLoaded || !eventsLoaded || blockedByGlobalMaintenance) return;

    // Fallback: if an event disables popup but enables confetti, still burst confetti once on entry
    if (
      todaySilentConfettiEvents.length > 0 &&
      todayAutoEventsRef.current.length === 0 &&
      !autoConfettiTriggeredRef.current
    ) {
      autoConfettiTriggeredRef.current = true;
      setConfettiTriggerKey(k => k + 1);
    }

    if (isHolidayModalOpen) return;

    if (todayAutoEventsRef.current.length > 0 && todayEventSignature && handledEventSig !== todayEventSignature) {
      const dismissKey = `tyt_event_popup_dismissed_${todayKey}`;
      let isDismissedToday = false;
      try {
        isDismissedToday = localStorage.getItem(dismissKey) === todayEventSignature;
      } catch {
        // ignore
      }

      if (!isDismissedToday) {
        const timer = window.setTimeout(() => {
          setEventAutoModalOpen(true);
          setHandledEventSig(todayEventSignature);
          const lead = todayAutoEventsRef.current[0];
          if (lead) {
            showToast(
              'success',
              `Sự kiện hôm nay: ${lead.title}`,
              lead.greetingMessage || lead.description
            );
          }
        }, 250);
        return () => window.clearTimeout(timer);
      } else {
        setHandledEventSig(todayEventSignature);
      }
    }
  }, [
    showFirstSessionSplash,
    showInitialSplash,
    settingsLoaded,
    eventsLoaded,
    blockedByGlobalMaintenance,
    isHolidayModalOpen,
    todaySilentConfettiEvents.length,
    todayEventSignature,
    handledEventSig,
    todayKey,
    showToast,
  ]);

  // Automatically trigger confetti whenever the event notification modal becomes visible
  useEffect(() => {
    const shouldBurst = modalEventsToDisplay.some(ev => ev.enableConfetti !== false);
    if (isEventModalOpen && !wasEventModalOpenRef.current && shouldBurst) {
      autoConfettiTriggeredRef.current = true;
      setConfettiTriggerKey(k => k + 1);
    }
    wasEventModalOpenRef.current = isEventModalOpen;
  }, [isEventModalOpen, modalEventsToDisplay]);

  const handleCloseEventModal = useCallback(
    (dontShowToday: boolean) => {
      if (dontShowToday && !previewEvent && todayEventSignature) {
        try {
          localStorage.setItem(`tyt_event_popup_dismissed_${todayKey}`, todayEventSignature);
        } catch {
          // ignore
        }
      }
      setEventAutoModalOpen(false);
      setPreviewEvent(null);
    },
    [previewEvent, todayEventSignature, todayKey]
  );

  const handlePreviewEvent = useCallback((ev: StationEvent) => {
    setPreviewEvent(ev);
  }, []);

  return (
    <AppShell
      currentView={currentView}
      setCurrentView={setCurrentView}
      settings={settings}
      settingsLoaded={settingsLoaded}
      hasTodayEvent={todayEvents.length > 0}
      activeHolidaysToday={activeHolidaysToday}
      workSchedules={workSchedules}
      openAuthModal={() => setIsAuthModalOpen(true)}
      openAdminSetupModal={() => setIsAdminSetupModalOpen(true)}
    >
      {/* Layer 1: First-session solid white splash overlay (once per session) */}
      <FirstSessionSplashOverlay
        visible={showFirstSessionSplash}
        fadingOut={isFirstSplashFading}
        settings={settings}
      />

      {/* Layer 2: Initial Startup Splash & Page Loading Overlays (portaled to document.body to cover 100% viewport) */}
      <FullScreenLoadingOverlay
        visible={showInitialSplash}
        fadingOut={isSplashFading}
        settings={settings}
        settingsLoaded={settingsLoaded}
        subtitle="Đang khởi tạo Cổng thông tin điện tử..."
        mode="splash"
      />

      <FullScreenLoadingOverlay
        visible={!showFirstSessionSplash && !showInitialSplash && isPageLoading}
        settings={settings}
        settingsLoaded={settingsLoaded}
        subtitle="Đang tải dữ liệu trang..."
        mode="transition"
      />

      {/* Admin notice bar when viewing while their own environment matches an active block rule */}
      {isAdmin && accessEval.isBlocked && (
        <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-900 dark:text-rose-100">
          <div className="flex items-center gap-2.5">
            <Ban className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>
              <strong>Cảnh báo Vô hiệu hóa truy cập:</strong> Thiết bị/Trình duyệt của bạn ({accessEval.env.osLabel} · {accessEval.env.deviceTypeLabel} · {accessEval.env.browserLabel}) đang nằm trong danh sách bị vô hiệu hóa ({accessEval.matchedLabels.join(', ')}). Người dân dùng môi trường này sẽ bị chặn truy cập.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('admin', 'tab=system_control')}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold whitespace-nowrap self-start sm:self-auto transition cursor-pointer"
          >
            Cấu hình chặn thiết bị
          </button>
        </div>
      )}

      {/* Admin notice bar when viewing while global maintenance, tab maintenance, or hidden tab is active */}
      {isAdmin && (isGlobalMaintenance || isTabUnderMaintenance || isTabHidden) && currentView !== 'admin' && (
        <div className="mb-5 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <Wrench className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              {isGlobalMaintenance
                ? 'Chế độ Bảo Trì Toàn Hệ Thống đang BẬT (người dân tạm thời không thể truy cập).'
                : isTabUnderMaintenance
                ? 'Phân hệ này đang ở chế độ Bảo Trì Lẻ (chỉ Quản trị viên xem được).'
                : 'Phân hệ này đang bị Ẩn khỏi Sidebar đối với người dùng công khai.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('admin')}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap self-start sm:self-auto transition cursor-pointer"
          >
            Quản lý bảo trì
          </button>
        </div>
      )}

      {/* Admin reminder bar when today's 03:00 AM GitHub backup has not yet been pushed (automatically disappears once pushed) */}
      {(() => {
        const vnNow = new Date(vnClockTick);
        const dailyMissing =
          isAdmin && settingsLoaded && !showInitialSplash && isDailyGithubBackupMissing(settings, vnNow);
        if (!dailyMissing) return null;

        const hasGhConfig = isGitHubConfigValid(settings.githubConfig);
        return (
          <div className="mb-5 p-3.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-indigo-950 dark:text-indigo-100">
            <div className="flex items-center gap-2.5">
              <FolderGit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                <strong>Nhắc nhở sao lưu GitHub hằng ngày (03:00 sáng):</strong> Hôm nay hệ thống chưa tự động đẩy bản sao lưu lên GitHub. Vui lòng đẩy ngay để hoàn tất sao lưu trong ngày.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              {hasGhConfig ? (
                <button
                  type="button"
                  disabled={isReminderBackingUp}
                  onClick={async () => {
                    if (!settings.githubConfig) return;
                    setIsReminderBackingUp(true);
                    try {
                      const res = await BackupService.backupToGitHub(
                        settings.githubConfig,
                        currentUser?.email || 'Admin'
                      );
                      if (res.success) {
                        showToast(
                          'success',
                          'Đã đẩy sao lưu lên GitHub thành công',
                          `Đã lưu ${res.totalRecords ?? 0} bản ghi (Base64). Hệ thống đã ngừng nhắc hôm nay.`
                        );
                      } else {
                        showToast('error', 'Sao lưu lên GitHub thất bại', res.error);
                      }
                    } finally {
                      setIsReminderBackingUp(false);
                    }
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold whitespace-nowrap transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReminderBackingUp ? 'animate-spin' : ''}`} />
                  <span>{isReminderBackingUp ? 'Đang đẩy...' : 'Đẩy sao lưu GitHub ngay'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCurrentView('admin', 'tab=github_storage')}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold whitespace-nowrap transition cursor-pointer"
                >
                  Cấu hình GitHub
                </button>
              )}
              <button
                type="button"
                onClick={() => setCurrentView('admin', 'tab=backup')}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-semibold whitespace-nowrap transition cursor-pointer hover:bg-indigo-100/60"
              >
                Lịch sử sao lưu
              </button>
            </div>
          </div>
        );
      })()}

      {isBanned ? (
        <div className="max-w-xl mx-auto py-10 sm:py-12 px-5 sm:px-6 my-6 rounded-3xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/70 shadow-sm text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <Ban className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 text-xs font-bold">
              <Ban className="w-3.5 h-3.5" />
              <span>
                {userProfile?.banType === 'temporary'
                  ? 'Tài khoản đang bị Ban có thời hạn'
                  : 'Tài khoản đã bị Ban vô thời hạn'}
              </span>
            </span>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Quyền Truy Cập Tài Khoản Bị Tạm Ngừng
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Tài khoản <strong>{currentUser?.email || userProfile?.displayName}</strong> hiện đã bị Quản trị viên hệ thống khóa quyền truy cập.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-left space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">Hình thức:</span>
              <span className="font-bold text-rose-700 dark:text-rose-300">
                {userProfile?.banType === 'temporary' ? 'Ban có thời hạn' : 'Ban vô thời hạn'}
              </span>
            </div>
            {userProfile?.banType === 'temporary' && getBannedUntilMs(userProfile) && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">Mở khóa tự động lúc:</span>
                  <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                    {formatBanTimestampVi(getBannedUntilMs(userProfile))}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">Thời gian còn lại:</span>
                  <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatBanRemainingVi(getBannedUntilMs(userProfile))}</span>
                  </span>
                </div>
              </>
            )}
            {userProfile?.banReason && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-semibold block">Lý do:</span>
                <p className="font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                  {userProfile.banReason}
                </p>
              </div>
            )}
            {userProfile?.bannedAt && (
              <div className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                Thời điểm áp dụng: {formatBanTimestampVi(userProfile.bannedAt)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void logout()}
              className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Đăng xuất khỏi tài khoản</span>
            </button>
          </div>
        </div>
      ) : blockedByAccessRestriction ? (
        <div className="max-w-2xl mx-auto py-10 sm:py-12 px-5 sm:px-6 my-6 rounded-3xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/70 shadow-sm text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <Ban className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Truy Cập Tạm Thời Bị Vô Hiệu Hóa
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {settings.accessControl?.customMessage ||
                'Hiện tại hệ thống đang tạm hạn chế truy cập trên loại thiết bị hoặc trình duyệt bạn đang sử dụng. Vui lòng chuyển sang thiết bị/trình duyệt được hỗ trợ hoặc liên hệ Trạm Y tế bên dưới.'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-left space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
              <MonitorSmartphone className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Thông tin thiết bị &amp; trình duyệt đang truy cập</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300">
                HĐH: {accessEval.env.osLabel}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300">
                Thiết bị: {accessEval.env.deviceTypeLabel}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300">
                Trình duyệt: {accessEval.env.browserLabel}
              </span>
            </div>
            <div className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold">
              Quy tắc đang áp dụng: {accessEval.matchedLabels.join(' • ')}
            </div>
          </div>

          {maintenancePointLeaders.length > 0 && (
            <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/70 text-left space-y-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                <span>Người đứng đầu &amp; Liên hệ các Điểm Trạm</span>
              </div>
              <div className="divide-y divide-emerald-200/70 dark:divide-emerald-900/50">
                {maintenancePointLeaders.map(pt => (
                  <div
                    key={pt.id}
                    className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-bold text-slate-900 dark:text-white">{pt.pointName}</div>
                      {pt.headName && (
                        <div className="text-slate-700 dark:text-slate-200">
                          Phụ trách: <strong>{pt.headName}</strong>
                        </div>
                      )}
                      {pt.address && (
                        <div className="text-slate-600 dark:text-slate-300">{pt.address}</div>
                      )}
                    </div>
                    {pt.phone && (
                      <a
                        href={`tel:${pt.phone}`}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 font-bold inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap self-start sm:self-center shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>{pt.phone}</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {configuredEmergencies.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-left space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <Phone className="w-3.5 h-3.5" />
                <span>Liên hệ Cấp cứu 24/7 khi cần thiết</span>
              </div>
              <div className="divide-y divide-rose-200/70 dark:divide-rose-900/50">
                {configuredEmergencies.map(ec => (
                  <div key={ec.id} className="py-1.5 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3">
                    <span className="text-xs text-rose-800 dark:text-rose-300">
                      {ec.note || 'Thường trực cấp cứu 24/7'}
                    </span>
                    <a
                      href={`tel:${ec.phone}`}
                      className="text-sm font-extrabold text-rose-700 dark:text-rose-200 hover:underline tabular-nums whitespace-nowrap"
                    >
                      {ec.phone}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {exemptAdminsFromBlock && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Đăng nhập Quản trị viên (Mở khóa)</span>
              </button>
            </div>
          )}
        </div>
      ) : blockedByGlobalMaintenance ? (
        <div className="max-w-2xl mx-auto py-10 sm:py-12 px-5 sm:px-6 my-6 rounded-3xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 shadow-sm text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Wrench className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Hệ Thống Đang Bảo Trì
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {settings.maintenanceMessage ||
                'Hệ thống Cổng thông tin điện tử Trạm Y tế đang được bảo trì, nâng cấp định kỳ. Vui lòng quay lại sau.'}
            </p>
          </div>

          {maintenancePointLeaders.length > 0 && (
            <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/70 text-left space-y-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                <span>Người đứng đầu &amp; Liên hệ các Điểm Trạm</span>
              </div>
              <div className="divide-y divide-emerald-200/70 dark:divide-emerald-900/50">
                {maintenancePointLeaders.map(pt => (
                  <div
                    key={pt.id}
                    className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {pt.pointName}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            pt.isPrimary
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {pt.isPrimary ? 'Trụ sở chính' : 'Điểm trạm'}
                        </span>
                      </div>
                      {pt.headName && (
                        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>
                            Người đứng đầu:{' '}
                            <strong className="text-slate-900 dark:text-white">
                              {pt.headName}
                            </strong>
                          </span>
                        </div>
                      )}
                      {pt.address && (
                        <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                          <span>{pt.address}</span>
                        </div>
                      )}
                    </div>
                    {pt.phone && (
                      <a
                        href={`tel:${pt.phone}`}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 font-bold inline-flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 tabular-nums whitespace-nowrap self-start sm:self-center shrink-0 transition"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>{pt.phone}</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {configuredEmergencies.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-left space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <Phone className="w-3.5 h-3.5" />
                <span>Liên hệ Cấp cứu 24/7 khi cần thiết</span>
              </div>
              <div className="divide-y divide-rose-200/70 dark:divide-rose-900/50">
                {configuredEmergencies.map(ec => (
                  <div key={ec.id} className="py-1.5 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3">
                    <span className="text-xs text-rose-800 dark:text-rose-300">
                      {ec.note || 'Thường trực cấp cứu 24/7'}
                    </span>
                    <a
                      href={`tel:${ec.phone}`}
                      className="text-sm font-extrabold text-rose-700 dark:text-rose-200 hover:underline tabular-nums whitespace-nowrap"
                    >
                      {ec.phone}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setCurrentView('account')}
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Đăng nhập Quản trị viên</span>
            </button>
          </div>
        </div>
      ) : blockedByTabMaintenance ? (
        <div className="max-w-2xl mx-auto py-10 sm:py-12 px-5 sm:px-6 my-6 rounded-3xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 shadow-sm text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Wrench className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Phân Hệ Đang Bảo Trì
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Mục chức năng này hiện đang được bảo trì và cập nhật dữ liệu. Quý người dân vui lòng quay lại sau hoặc sử dụng các phân hệ khác trên Cổng thông tin.
            </p>
          </div>

          {maintenancePointLeaders.length > 0 && (
            <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/70 text-left space-y-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                <span>Người đứng đầu &amp; Liên hệ các Điểm Trạm</span>
              </div>
              <div className="divide-y divide-emerald-200/70 dark:divide-emerald-900/50">
                {maintenancePointLeaders.map(pt => (
                  <div
                    key={pt.id}
                    className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {pt.pointName}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            pt.isPrimary
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {pt.isPrimary ? 'Trụ sở chính' : 'Điểm trạm'}
                        </span>
                      </div>
                      {pt.headName && (
                        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>
                            Người đứng đầu:{' '}
                            <strong className="text-slate-900 dark:text-white">
                              {pt.headName}
                            </strong>
                          </span>
                        </div>
                      )}
                      {pt.address && (
                        <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                          <span>{pt.address}</span>
                        </div>
                      )}
                    </div>
                    {pt.phone && (
                      <a
                        href={`tel:${pt.phone}`}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 font-bold inline-flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 tabular-nums whitespace-nowrap self-start sm:self-center shrink-0 transition"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>{pt.phone}</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {configuredEmergencies.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-left space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <Phone className="w-3.5 h-3.5" />
                <span>Hỗ trợ Cấp cứu 24/7</span>
              </div>
              <div className="divide-y divide-rose-200/70 dark:divide-rose-900/50">
                {configuredEmergencies.map(ec => (
                  <div key={ec.id} className="py-1.5 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3">
                    <span className="text-xs text-rose-800 dark:text-rose-300">
                      {ec.note || 'Thường trực cấp cứu 24/7'}
                    </span>
                    <a
                      href={`tel:${ec.phone}`}
                      className="text-sm font-extrabold text-rose-700 dark:text-rose-200 hover:underline tabular-nums whitespace-nowrap"
                    >
                      {ec.phone}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentView !== 'portal' && !settings.hiddenTabs?.includes('portal') && !settings.tabMaintenance?.portal && (
            <button
              type="button"
              onClick={() => setCurrentView('portal')}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay về Trang chủ</span>
            </button>
          )}
        </div>
      ) : blockedByHiddenTab ? (
        <div className="max-w-md mx-auto py-14 px-6 my-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center mx-auto">
            <EyeOff className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
              Phân Hệ Đang Tạm Ẩn
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Mục này hiện đang được Quản trị viên tạm ẩn khỏi menu hiển thị công khai.
            </p>
          </div>
          {currentView !== 'portal' && (
            <button
              type="button"
              onClick={() => setCurrentView('portal')}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay về Trang chủ</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {currentView === 'portal' && (
            <PortalHomeView
              settings={settings}
              settingsLoaded={settingsLoaded}
              setCurrentView={setCurrentView}
              openAdminSetupModal={() => setIsAdminSetupModalOpen(true)}
            />
          )}

          {currentView === 'org_chart' && (
            <OrgChartView
              settings={settings}
              settingsLoaded={settingsLoaded}
              onOpenPersonnelDirectory={() => setCurrentView('personnel_directory')}
            />
          )}

          {currentView === 'personnel_directory' && (
            <PersonnelDirectoryView
              settings={settings}
              settingsLoaded={settingsLoaded}
              users={users}
              onOpenOrgChart={() => setCurrentView('org_chart')}
              onRefreshUsers={fetchAdminData}
            />
          )}

          {currentView === 'vaccination' && (
            <VaccinationView
              settings={settings}
              settingsLoaded={settingsLoaded}
              onOpenAdminSetup={openVaccinationAdminSetup}
              onOpenLocationsSetup={() => setCurrentView('admin', 'tab=map_locations')}
              onNavigateToMap={() => setCurrentView('map')}
            />
          )}

          {currentView === 'events' && (
            <EventsView
              events={events}
              settings={settings}
              onPreviewEvent={handlePreviewEvent}
            />
          )}

          {currentView === 'duty' && (
            <PublicDutyScheduleView
              settings={settings}
              onPreviewHoliday={handlePreviewHoliday}
            />
          )}

          {currentView === 'map' && (
            <div className="space-y-6">
              <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Bản Đồ Mạng Lưới Y Tế & Định Vị Chỉ Đường Trạm Y Tế
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Hệ thống định vị GPS nhận diện vị trí hiện tại, tính khoảng cách và thời gian di chuyển theo địa giới hành chính chính thức.
                </p>
              </div>
              <StationMapSection
                locations={settings.mapLocations}
                stationName={settings.stationName}
                defaultAddress={settings.address}
              />
            </div>
          )}

          {currentView === 'nearby_facilities' && (
            <NearbyFacilitiesView
              settings={settings}
              onOpenAdminManage={() => setCurrentView('admin', 'tab=nearby_facilities')}
            />
          )}

          {currentView === 'rescue' && (
            <RescueMapView settings={settings} setCurrentView={setCurrentView} />
          )}

          {currentView === 'news' && (
            <NewsView settings={settings} initialTab={newsRequestedTab} />
          )}

          {currentView === 'documents' && <DocumentsView />}

          {currentView === 'bhyt_lookup' && (
            <BhxhLookupView settings={settings} />
          )}

          {currentView === 'telehealth' && (
            <CitizenHubView initialTab="telehealth" settings={settings} />
          )}

          {(currentView === 'feedback_tracking' || currentView === 'tracking' || currentView === 'feedback') && (
            <CitizenHubView initialTab="feedback_tracking" settings={settings} />
          )}

          {/* Strict Protection for Admin Console */}
          {currentView === 'admin' && (
            !isAdmin || requiresTwoFactorVerification ? (
              <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto">
                  <ShieldAlert className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Khu Vực Quản Trị Hệ Thống
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Yêu cầu tài khoản Quản trị viên trạm để truy cập cấu hình hệ sinh thái, phân quyền người dùng và kiểm toán an ninh.
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentView('account')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Đăng nhập Quản trị viên</span>
                </button>
              </div>
            ) : (
              <AdminConsoleView
                settings={settings}
                feedbackList={feedbackList}
                users={users}
                auditLogs={auditLogs}
                events={events}
                workSchedules={workSchedules}
                onPreviewEvent={handlePreviewEvent}
                onPreviewHoliday={handlePreviewHoliday}
                onRefreshData={fetchAdminData}
                openAuthModal={() => setIsAuthModalOpen(true)}
                onNavigateToLogin={() => setCurrentView('account')}
                onOpenOrgChart={() => setCurrentView('org_chart')}
                initialSubTab={adminRequestedSubTab}
              />
            )
          )}

          {currentView === 'account' && (
            <AccountDeviceView settings={settings} setCurrentView={setCurrentView} />
          )}
        </>
      )}

      {/* Global Modals */}
      <FeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
        settings={settings}
      />

      <AdminSetupWizard
        isOpen={isAdminSetupModalOpen}
        onClose={() => setIsAdminSetupModalOpen(false)}
        settings={settings}
        onRefreshData={() => {}}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onRegisteredNavigate={() => setCurrentView('account')}
      />

      <TwoFactorGateModal />
      <SmsMfaChallengeModal />

      <StartupPopupModal
        settings={settings}
        settingsLoaded={settingsLoaded}
        blockedByMaintenance={blockedByGlobalMaintenance || blockedByAccessRestriction || isBanned}
        pauseForEventPopup={
          showFirstSessionSplash ||
          showInitialSplash ||
          isBanned ||
          requiresTwoFactorVerification ||
          Boolean(pendingSmsMfaResolver) ||
          isEventModalOpen ||
          isHolidayModalOpen ||
          isVaccinationPopupOpen
        }
        onVisibilityChange={setIsGeneralPopupOpen}
        onNavigateToView={view => setCurrentView(view)}
      />

      <VaccinationStartupPopupModal
        settings={settings}
        settingsLoaded={settingsLoaded}
        blockedByMaintenance={blockedByGlobalMaintenance || blockedByAccessRestriction || isBanned}
        pauseForOtherPopup={
          showFirstSessionSplash ||
          showInitialSplash ||
          isBanned ||
          requiresTwoFactorVerification ||
          Boolean(pendingSmsMfaResolver) ||
          isEventModalOpen ||
          isHolidayModalOpen ||
          isGeneralPopupOpen
        }
        onVisibilityChange={setIsVaccinationPopupOpen}
        onNavigateToView={view => setCurrentView(view)}
      />

      <HolidayNoticeModal
        holidays={modalHolidaysToDisplay}
        isOpen={isHolidayModalOpen}
        isPreview={Boolean(previewHoliday)}
        settings={settings}
        workSchedules={workSchedules}
        onClose={handleCloseHolidayModal}
        onGoToDutySchedule={() => setCurrentView('duty')}
      />

      <EventCelebrationModal
        events={modalEventsToDisplay}
        isOpen={isEventModalOpen}
        isPreview={Boolean(previewEvent)}
        settings={settings}
        onClose={handleCloseEventModal}
        onGoToEventsTab={() => setCurrentView('events')}
      />

      {(() => {
        const vnNow = new Date(vnClockTick);
        const vnDayKey = getVietnamTimeParts(vnNow).dayKey;
        const shouldShowReminderModal =
          isAdmin &&
          settingsLoaded &&
          !showFirstSessionSplash &&
          !showInitialSplash &&
          !isHolidayModalOpen &&
          !isEventModalOpen &&
          isDailyGithubBackupMissing(settings, vnNow) &&
          dismissedReminderDay !== vnDayKey;

        return (
          <GithubBackupReminderModal
            isOpen={shouldShowReminderModal}
            settings={settings}
            isBackingUp={isReminderBackingUp}
            onBackupNow={async () => {
              if (!settings.githubConfig) return;
              setIsReminderBackingUp(true);
              try {
                const res = await BackupService.backupToGitHub(
                  settings.githubConfig,
                  currentUser?.email || 'Admin'
                );
                if (res.success) {
                  showToast(
                    'success',
                    'Đã đẩy sao lưu lên GitHub thành công',
                    `Đã lưu ${res.totalRecords ?? 0} bản ghi (Base64). Hệ thống đã ngừng nhắc hôm nay.`
                  );
                } else {
                  showToast('error', 'Sao lưu lên GitHub thất bại', res.error);
                }
              } finally {
                setIsReminderBackingUp(false);
              }
            }}
            onOpenBackupManager={() => {
              setDismissedReminderDay(vnDayKey);
              try {
                sessionStorage.setItem('tyt_gh_backup_reminder_dismissed_day', vnDayKey);
              } catch {
                // ignore
              }
              setCurrentView('admin', 'tab=backup');
            }}
            onOpenGithubConfig={() => {
              setDismissedReminderDay(vnDayKey);
              try {
                sessionStorage.setItem('tyt_gh_backup_reminder_dismissed_day', vnDayKey);
              } catch {
                // ignore
              }
              setCurrentView('admin', 'tab=github_storage');
            }}
            onDismissForSession={() => {
              setDismissedReminderDay(vnDayKey);
              try {
                sessionStorage.setItem('tyt_gh_backup_reminder_dismissed_day', vnDayKey);
              } catch {
                // ignore
              }
            }}
          />
        );
      })()}

      <ConfettiEffect triggerKey={confettiTriggerKey} />
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <MainApp />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
