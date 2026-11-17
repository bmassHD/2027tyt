import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Newspaper,
  FileText,
  Smartphone,
  Search,
  MessageSquare,
  Settings,
  LogOut,
  LogIn,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
  Phone,
  ShieldCheck,
  User,
  CalendarClock,
  MapPin,
  RotateCw,
  Eye,
  RefreshCw,
  SlidersHorizontal,
  Syringe,
  Network,
  Clock,
  ArrowRight,
  ArrowUp,
  Sun,
  Moon,
  Hospital,
  Siren,
  PartyPopper,
  CalendarOff,
  CreditCard,
  Users,
  Megaphone,
} from 'lucide-react';
import { useAuth, PRIMARY_ADMIN_EMAIL } from '../../contexts/AuthContext';
import { SystemSettings, RoleType, AccountType, VaccinationScheduleItem, HolidayScheduleItem, WorkSchedule } from '../../types';
import {
  getActiveVaccinationSchedules,
  formatVaccinationDateRange,
  resolveVaccinationLifecycle,
  markNotificationViewed,
  markAnnouncementViewed,
  savePushSubscriptionRecord,
  formatHolidayDateRange,
  formatIsoDateVN,
  getConfiguredEmergencyContacts,
  getStationPointLeaders,
  getDutySchedulesForHoliday,
  getVietnamTodayKey,
} from '../../services/firebaseService';
import { StationLogo } from '../common/StationLogo';
import { UserAvatar } from '../common/UserAvatar';
import { CustomFooter } from '../common/CustomFooter';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { GlobalProgressBar } from '../common/GlobalProgressBar';
import { OfflineIndicator } from '../common/OfflineIndicator';
import { NotificationDrawerModal } from '../common/NotificationDrawerModal';
import { VerifiedBlueTick } from '../common/VerifiedBlueTick';
import { getUserVerificationProgress } from '../../utils/verificationBadge';
import { Bell } from 'lucide-react';
import { isFirestoreWriteQuotaExceeded } from '../../utils/firestoreQuotaGuard';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useToast } from '../../contexts/ToastContext';
import {
  getOrCreateDeviceId,
  getSeenUrgentIds,
  isDeviceNotificationEnabled,
  markUrgentSeen,
  subscribeDeviceToWebPush,
  triggerDeviceSystemNotification,
} from '../../services/systemNotificationService';

interface AppShellProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  settings: SystemSettings;
  settingsLoaded?: boolean;
  hasTodayEvent?: boolean;
  activeHolidaysToday?: HolidayScheduleItem[];
  workSchedules?: WorkSchedule[];
  openAuthModal: () => void;
  openAdminSetupModal: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentView,
  setCurrentView,
  settings,
  settingsLoaded = true,
  hasTodayEvent = false,
  activeHolidaysToday = [],
  workSchedules = [],
  children,
}) => {
  const {
    currentUser,
    userProfile,
    isAdmin,
    isStaff,
    isPrimaryAdmin,
    logout,
    switchPreviewRole,
    resetRoleToActual,
    isSimulatingRole,
    activeRole,
    activeAccountType,
    hasPasswordProvider,
    hasGoogleProvider,
    twoFactorEnabled,
    smsMfaEnabled,
  } = useAuth();

  const verificationProgress = getUserVerificationProgress(userProfile, {
    emailVerified: currentUser?.emailVerified,
    hasGoogleProvider,
    hasPasswordProvider,
    twoFactorEnabled,
    smsMfaEnabled,
    phoneNumber: userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser?.phoneNumber,
  });

  const { showToast } = useToast();

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('tyt_theme');
      if (saved) return saved === 'dark';
      return document.documentElement.classList.contains('dark');
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    try {
      localStorage.setItem('tyt_theme', isDarkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDarkMode]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<{
    label: string;
    badge?: string;
    top: number;
    left: number;
    isDanger?: boolean;
  } | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const [focusedNotifId, setFocusedNotifId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Dynamic Header Section Title on Scroll Down, Normal Header on Scroll Up
  const [scrollDir, setScrollDir] = useState<'up' | 'down'>('up');
  const [isScrolledPastTop, setIsScrolledPastTop] = useState(false);
  const [activeSectionTitle, setActiveSectionTitle] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const lastScrollYRef = useRef(0);

  // Independent dismiss state for top-page banners (General notice vs Vaccination countdown)
  const [dismissedGeneralBannerSig, setDismissedGeneralBannerSig] = useState<string>(() => {
    try {
      return sessionStorage.getItem('tyt_dismissed_general_banner_v1') || '';
    } catch {
      return '';
    }
  });
  const [dismissedVacBannerSig, setDismissedVacBannerSig] = useState<string>(() => {
    try {
      return sessionStorage.getItem('tyt_dismissed_vac_banner_v1') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (!sidebarCollapsed) {
      setHoveredNav(null);
    }
  }, [sidebarCollapsed]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('tyt_sidebar_open_groups');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore
    }
    return {
      overview: true,
      schedules: true,
      maps: false,
      media: false,
      citizen: true,
      system: true,
    };
  });

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      try {
        localStorage.setItem('tyt_sidebar_open_groups', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Pull to refresh mobile states
  const [pullDistance, setPullDistance] = useState(0);
  const pullDistanceRef = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef(0);

  const targetedInitRef = useRef(false);
  const announcementsInitRef = useRef(false);
  const deviceId = getOrCreateDeviceId();

  // Open notification drawer directly to specific notification ID (from PWA toast click / URL deep-link)
  const openNotificationById = React.useCallback(
    (rawId?: string | null) => {
      if (!rawId) {
        setNotificationModalOpen(true);
        return;
      }
      const cleanId = rawId.trim();
      setFocusedNotifId(cleanId);
      setNotificationModalOpen(true);
      markUrgentSeen(cleanId);
      if (cleanId.startsWith('ann_')) {
        void markAnnouncementViewed(cleanId.slice(4));
      } else {
        void markNotificationViewed(cleanId, currentUser?.uid);
      }
    },
    [currentUser?.uid]
  );

  // Deep-link URL ?openNotif=... & Service Worker / Notification click listeners
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const deepNotif = params.get('openNotif');
      if (deepNotif) {
        openNotificationById(deepNotif);
        params.delete('openNotif');
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', nextUrl);
      }
    } catch {
      // ignore URL parsing errors
    }

    const handleCustomOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ notifId?: string }>).detail;
      if (detail?.notifId) {
        openNotificationById(detail.notifId);
      }
    };

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_NOTIFICATION' && event.data?.notifId) {
        openNotificationById(String(event.data.notifId));
      }
    };

    window.addEventListener('tyt:open-notification', handleCustomOpen);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      window.removeEventListener('tyt:open-notification', handleCustomOpen);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [openNotificationById]);

  // Auto-sync Web Push subscription silently only when subscription/identity changes or after 24h
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      !isDeviceNotificationEnabled() ||
      isFirestoreWriteQuotaExceeded()
    ) {
      return;
    }
    let cancelled = false;
    subscribeDeviceToWebPush({
      uid: currentUser?.uid,
      citizenId: userProfile?.citizenId,
      phoneNumber: userProfile?.phoneNumber,
      department: userProfile?.department,
    }).then(res => {
      if (cancelled || !res.ok || !res.subscription || isFirestoreWriteQuotaExceeded()) return;
      const subJson = res.subscription.toJSON();
      const endpoint = subJson.endpoint || res.subscription.endpoint || '';
      const p256dh = subJson.keys?.p256dh || '';
      const authKey = subJson.keys?.auth || '';
      if (!endpoint) return;

      const syncSig = [
        deviceId,
        endpoint,
        currentUser?.uid || '',
        userProfile?.citizenId || '',
        userProfile?.phoneNumber || '',
        userProfile?.department || '',
      ].join('|');
      const storageKey = `tyt_push_sync_meta_${deviceId}`;

      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { sig?: string; ts?: number };
          if (
            parsed?.sig === syncSig &&
            typeof parsed?.ts === 'number' &&
            Date.now() - parsed.ts < 24 * 60 * 60 * 1000
          ) {
            return;
          }
        }
      } catch {
        // ignore storage errors
      }

      void savePushSubscriptionRecord({
        deviceId,
        endpoint,
        keys: { p256dh, auth: authKey },
        uid: currentUser?.uid,
        citizenId: userProfile?.citizenId,
        phoneNumber: userProfile?.phoneNumber,
        department: userProfile?.department,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        updatedAt: new Date().toISOString(),
      }).then(() => {
        if (!isFirestoreWriteQuotaExceeded()) {
          try {
            localStorage.setItem(storageKey, JSON.stringify({ sig: syncSig, ts: Date.now() }));
          } catch {
            // ignore
          }
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, userProfile?.citizenId, userProfile?.phoneNumber, userProfile?.department, deviceId]);

  // Live ticker for vaccination countdown strip below header
  const [countdownNowMs, setCountdownNowMs] = useState<number>(() => Date.now());
  const activeCountdownCandidates = getActiveVaccinationSchedules(settings).filter(
    item => item.status !== 'postponed'
  );

  useEffect(() => {
    if (activeCountdownCandidates.length === 0) return;
    const timer = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCountdownCandidates.length]);

  // Realtime unread notification counter & single-notify device dispatcher
  useEffect(() => {
    const q = query(collection(db, 'targetedNotifications'));
    const unsub = onSnapshot(
      q,
      snap => {
        const now = Date.now();
        let unread = 0;
        const seenUrgent = getSeenUrgentIds();

        snap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.expiresAt && new Date(data.expiresAt).getTime() <= now) return;

          const isRelevant =
            data.targetType === 'all' ||
            (currentUser &&
              ((userProfile?.citizenId && data.targetCccd && userProfile.citizenId.trim() === data.targetCccd.trim()) ||
                (userProfile?.phoneNumber && data.targetPhone && userProfile.phoneNumber.trim() === data.targetPhone.trim()) ||
                data.targetCccd === currentUser.uid ||
                (userProfile?.department && data.targetOrgName && userProfile.department.toLowerCase().includes(data.targetOrgName.toLowerCase()))));

          const readByUids: string[] = Array.isArray(data.readByUids) ? data.readByUids : [];
          const readByDeviceIds: string[] = Array.isArray(data.readByDeviceIds) ? data.readByDeviceIds : [];
          const isRead =
            Boolean(currentUser && readByUids.includes(currentUser.uid)) ||
            readByDeviceIds.includes(deviceId);

          if (isRelevant && !isRead) {
            unread++;
          }

          // Fire alert/toast AT MOST ONCE if neither viewed nor previously notified on this device
          const isUrgent =
            data.priority === 'khan' || data.priority === 'hoatoc' || data.pushToDevice === true;
          if (isRelevant && !isRead && !seenUrgent.has(docSnap.id)) {
            const createdMs = data.createdAt ? new Date(data.createdAt).getTime() : 0;
            const isRecent = createdMs > 0 && now - createdMs < 180_000;
            if (isUrgent && (targetedInitRef.current || isRecent)) {
              markUrgentSeen(docSnap.id);
              const priority: 'khan' | 'hoatoc' = data.priority === 'hoatoc' ? 'hoatoc' : 'khan';
              const toastType = priority === 'hoatoc' ? 'error' : 'warning';
              const prefix = priority === 'hoatoc' ? 'KHẨN CẤP - HỎA TỐC: ' : 'THÔNG BÁO KHẨN: ';
              showToast(toastType, `${prefix}${data.title || 'Trạm Y Tế'}`, data.content || '');
              void triggerDeviceSystemNotification({
                id: docSnap.id,
                title: data.title || 'Thông báo từ Trạm Y Tế',
                body: data.content || '',
                priority,
              });
            } else if (!targetedInitRef.current && !isRecent) {
              markUrgentSeen(docSnap.id);
            }
          }
        });
        targetedInitRef.current = true;
        setUnreadCount(unread);
      },
      () => {}
    );
    return () => unsub();
  }, [currentUser, userProfile, showToast, deviceId]);

  // Realtime emergency announcements watcher for System/Device Urgent Notification Toast
  useEffect(() => {
    const q = query(collection(db, 'announcements'));
    const unsub = onSnapshot(
      q,
      snap => {
        const now = Date.now();
        const seenUrgent = getSeenUrgentIds();

        snap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.expiresAt && new Date(data.expiresAt).getTime() <= now) return;
          const isUrgent = data.type === 'emergency' || data.priority === 'khan' || data.priority === 'hoatoc';
          if (!isUrgent) return;

          const readByDeviceIds: string[] = Array.isArray(data.readByDeviceIds) ? data.readByDeviceIds : [];
          const notifKey = `ann_${docSnap.id}`;
          if (readByDeviceIds.includes(deviceId) || seenUrgent.has(notifKey)) return;

          const createdMs = data.createdAt ? new Date(data.createdAt).getTime() : 0;
          const isRecent = createdMs > 0 && now - createdMs < 180_000;
          if (announcementsInitRef.current || isRecent) {
            markUrgentSeen(notifKey);
            const priority: 'khan' | 'hoatoc' = data.priority === 'hoatoc' ? 'hoatoc' : 'khan';
            showToast(
              priority === 'hoatoc' ? 'error' : 'warning',
              `THÔNG BÁO KHẨN: ${data.title || 'Trạm Y Tế'}`,
              data.content || ''
            );
            void triggerDeviceSystemNotification({
              id: notifKey,
              title: data.title || 'Cảnh báo y tế khẩn',
              body: data.content || '',
              priority,
            });
          } else {
            markUrgentSeen(notifKey);
          }
        });
        announcementsInitRef.current = true;
      },
      () => {}
    );
    return () => unsub();
  }, [showToast, deviceId]);

  // Reset header & back-to-top state on view change
  useEffect(() => {
    setScrollDir('up');
    setIsScrolledPastTop(false);
    setActiveSectionTitle(null);
    setShowBackToTop(false);
    setHoveredNav(null);
    lastScrollYRef.current = window.scrollY || 0;
  }, [currentView]);

  // Track scroll direction, active visible section heading, and near-bottom Back to Top visibility
  useEffect(() => {
    let rafId = 0;

    const updateScrollHeader = () => {
      rafId = 0;
      const currentY = window.scrollY || document.documentElement.scrollTop;
      const delta = currentY - lastScrollYRef.current;

      if (currentY <= 72) {
        setScrollDir('up');
        setIsScrolledPastTop(false);
      } else {
        setIsScrolledPastTop(true);
        if (delta > 6) {
          setScrollDir('down');
        } else if (delta < -6) {
          setScrollDir('up');
        }
      }
      lastScrollYRef.current = currentY;

      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const docHeight = document.documentElement.scrollHeight;
      const maxScroll = docHeight - viewportHeight;
      const distanceFromBottom = docHeight - (currentY + viewportHeight);
      const nearBottom =
        maxScroll > 140 &&
        currentY > 140 &&
        (distanceFromBottom <= 450 || currentY / maxScroll >= 0.72);
      setShowBackToTop(nearBottom);

      const sectionEls = document.querySelectorAll<HTMLElement>('[data-section-title]');
      let foundTitle: string | null = null;
      sectionEls.forEach(el => {
        const title = el.getAttribute('data-section-title');
        if (!title) return;
        const rect = el.getBoundingClientRect();
        if (rect.top <= 116 && rect.bottom > 76) {
          foundTitle = title;
        }
      });
      setActiveSectionTitle(foundTitle);
    };

    const onScroll = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(updateScrollHeader);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [currentView]);

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Pull-to-refresh / manual refresh triggers system + GPS refresh
  const handleManualRefresh = () => {
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent('tyt:refresh-location'));
    showToast('info', 'Đang cập nhật', 'Đang đồng bộ dữ liệu và định vị GPS...');
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('success', 'Đã cập nhật', 'Dữ liệu và vị trí mới nhất đã sẵn sàng.');
    }, 650);
  };

  // Mobile pull-to-refresh touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 2) {
      touchStartYRef.current = e.touches[0].clientY;
    } else {
      touchStartYRef.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (window.scrollY <= 2 && touchStartYRef.current > 0) {
      const currentY = e.touches[0].clientY;
      const distance = currentY - touchStartYRef.current;
      if (distance > 12 && distance < 130) {
        pullDistanceRef.current = distance;
        setPullDistance(distance);
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullDistanceRef.current > 65) {
      handleManualRefresh();
    }
    pullDistanceRef.current = 0;
    setPullDistance(0);
    touchStartYRef.current = 0;
  };

  interface NavItem {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }

  interface NavGroup {
    id: string;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    items: NavItem[];
  }

  const hiddenTabSet = new Set(settings.hiddenTabs || []);
  const tabMaintMap = settings.tabMaintenance || {};

  const decorateOrFilter = (items: NavItem[]): NavItem[] =>
    items
      .filter(item => {
        if (item.id === 'personnel_directory' && !isAdmin && !isStaff) return false;
        return isAdmin || !hiddenTabSet.has(item.id);
      })
      .map(item => {
        if (isAdmin && hiddenTabSet.has(item.id)) {
          return { ...item, badge: 'Đã ẩn' };
        }
        if (tabMaintMap[item.id]) {
          return { ...item, badge: 'Bảo trì' };
        }
        return item;
      });

  const overviewItems = decorateOrFilter([
    { id: 'portal', label: 'Trang chủ & Giới thiệu', icon: Building2 },
    { id: 'org_chart', label: 'Sơ đồ tổ chức', icon: Network },
    { id: 'personnel_directory', label: 'Nhân lực & Khoa phòng', icon: Users },
  ]);

  const scheduleItems = decorateOrFilter([
    {
      id: 'duty',
      label: 'Lịch trực 24/7 & Làm việc',
      icon: CalendarClock,
      badge: activeHolidaysToday.length > 0 ? 'Nghỉ lễ' : undefined,
    },
    { id: 'vaccination', label: 'Lịch tiêm chủng', icon: Syringe },
    { id: 'events', label: 'Sự kiện', icon: PartyPopper, badge: hasTodayEvent ? 'Hôm nay' : undefined },
  ]);

  const mapItems = decorateOrFilter([
    { id: 'map', label: 'Bản đồ & Định vị trạm', icon: MapPin },
    { id: 'nearby_facilities', label: 'Cơ sở Y tế lân cận', icon: Hospital },
    { id: 'rescue', label: 'Bản đồ Cứu hộ cứu nạn', icon: Siren, badge: 'SOS' },
  ]);

  const mediaItems = decorateOrFilter([
    { id: 'news', label: 'Tin tức & Media', icon: Newspaper },
    { id: 'documents', label: 'Văn bản & Biểu mẫu', icon: FileText },
  ]);

  const citizenItems = decorateOrFilter([
    { id: 'bhyt_lookup', label: 'Tra cứu BHYT', icon: CreditCard },
    { id: 'telehealth', label: 'Bác sĩ cho mọi nhà', icon: Smartphone },
    { id: 'feedback_tracking', label: 'Phản ánh', icon: MessageSquare },
  ]);

  const systemItems: NavItem[] = [];
  if (isAdmin) {
    systemItems.push({
      id: 'admin',
      label: 'Bảng Quản trị Trạm',
      icon: Settings,
      badge: 'Admin',
    });
  }
  systemItems.push({
    id: 'account',
    label: currentUser ? 'Tài khoản & Thiết bị' : 'Đăng nhập & Thiết bị',
    icon: User,
  });

  const navGroups: NavGroup[] = [
    { id: 'overview', title: 'Tổng quan & Tổ chức', icon: Building2, items: overviewItems },
    { id: 'schedules', title: 'Lịch trực & Hoạt động', icon: CalendarClock, items: scheduleItems },
    { id: 'maps', title: 'Bản đồ & Cứu hộ y tế', icon: MapPin, items: mapItems },
    { id: 'media', title: 'Tin tức & Văn bản', icon: Newspaper, items: mediaItems },
    { id: 'citizen', title: 'Tiện ích dân cư', icon: Smartphone, items: citizenItems },
    { id: 'system', title: 'Hệ thống & Quản trị', icon: Settings, items: systemItems },
  ].filter(group => group.items.length > 0);

  // Automatically expand the group containing the currently active route
  useEffect(() => {
    const activeGroup = navGroups.find(g => g.items.some(i => i.id === currentView));
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups(prev => {
        const next = { ...prev, [activeGroup.id]: true };
        try {
          localStorage.setItem('tyt_sidebar_open_groups', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  const mobileBottomItems: NavItem[] = [
    { id: 'portal', label: 'Trang chủ', icon: Building2 },
    { id: 'vaccination', label: 'Lịch tiêm', icon: Syringe },
    { id: 'news', label: 'Tin tức', icon: Newspaper },
    { id: 'map', label: 'Bản đồ', icon: MapPin },
    { id: 'account', label: 'Tài khoản', icon: User },
  ].filter(item => isAdmin || !hiddenTabSet.has(item.id));

  const isConfigured = settings.stationName && !settings.stationName.includes('Chưa cấu hình');

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased selection:bg-emerald-500 selection:text-white w-full overflow-x-clip"
    >
      {/* Pull to refresh visual indicator */}
      {pullDistance > 0 && (
        <div
          className="fixed top-0 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white px-4 py-2 rounded-b-2xl shadow-lg text-xs sm:text-sm font-semibold flex items-center gap-2 transition-transform whitespace-nowrap"
          style={{ transform: `translate(-50%, ${Math.min(pullDistance, 50)}px)` }}
        >
          <RotateCw className={`w-4 h-4 shrink-0 ${pullDistance > 65 ? 'animate-spin' : ''}`} />
          <span>{pullDistance > 65 ? 'Thả ra để cập nhật' : 'Vuốt xuống để cập nhật'}</span>
        </div>
      )}

      {/* Top Loading Progress Bar */}
      <GlobalProgressBar />

      {/* Offline Mode Alert Toast */}
      <OfflineIndicator />

      {/* Desktop Fixed Sidebar */}
      <aside
        className={`hidden lg:flex flex-col border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-300 z-30 select-none shadow-xs sticky top-0 h-screen shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-72'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
          {!sidebarCollapsed ? (
            <div
              onClick={() => setCurrentView('portal')}
              className="cursor-pointer overflow-hidden group flex items-center gap-3 flex-1"
            >
              <StationLogo size={38} />
              <div className="overflow-hidden flex-1">
                {!settingsLoaded ? (
                  <div className="h-3.5 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                ) : (
                  <h1 className="text-sm font-extrabold text-slate-900 dark:text-white truncate group-hover:text-emerald-600 transition">
                    {isConfigured ? settings.stationName : 'TRẠM Y TẾ XÃ/PHƯỜNG'}
                  </h1>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              onMouseEnter={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredNav({
                  label: 'Mở rộng Sidebar',
                  top: rect.top + rect.height / 2,
                  left: rect.right + 12,
                });
              }}
              onMouseLeave={() => setHoveredNav(null)}
              className="mx-auto p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 transition shadow-xs cursor-pointer"
              aria-label="Mở rộng Sidebar"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Thu gọn Sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sidebar Navigation (collapsible dropdown groups when expanded, icons + hover tooltip when collapsed) */}
        <div
          onScroll={() => setHoveredNav(null)}
          className={`flex-1 overflow-y-auto px-2.5 py-4 ${
            sidebarCollapsed ? 'no-scrollbar overflow-x-hidden space-y-2' : 'space-y-2'
          }`}
        >
          {navGroups.map((group, gIdx) => {
            const GroupIcon = group.icon;
            const isOpen = Boolean(openGroups[group.id]);
            const hasActiveChild = group.items.some(i => i.id === currentView);
            const highlightBadge = !isOpen
              ? group.items.find(i => i.badge && i.badge !== 'Đã ẩn' && i.badge !== 'Admin')?.badge
              : undefined;

            return (
              <div key={group.id} className="space-y-1">
                {sidebarCollapsed && gIdx > 0 && (
                  <div className="mx-2 my-1.5 h-px bg-slate-200/80 dark:bg-slate-800" />
                )}

                {!sidebarCollapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isOpen}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-[11.5px] font-bold uppercase tracking-wider transition cursor-pointer ${
                      hasActiveChild
                        ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/40'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <GroupIcon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          hasActiveChild ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">{group.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {highlightBadge && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                            highlightBadge === 'SOS'
                              ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                              : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {highlightBadge}
                        </span>
                      )}
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          isOpen ? 'rotate-0' : '-rotate-90'
                        }`}
                      />
                    </span>
                  </button>
                )}

                {(sidebarCollapsed || isOpen) && (
                  <div
                    className={
                      sidebarCollapsed
                        ? 'space-y-1'
                        : 'space-y-1 pl-2 ml-2.5 border-l border-slate-200/80 dark:border-slate-800'
                    }
                  >
                    {group.items.map(item => {
                      const Icon = item.icon;
                      const isActive = currentView === item.id;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setHoveredNav(null);
                            setCurrentView(item.id);
                          }}
                          onMouseEnter={e => {
                            if (!sidebarCollapsed) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredNav({
                              label: item.label,
                              badge: item.badge,
                              top: rect.top + rect.height / 2,
                              left: rect.right + 12,
                              isDanger: item.id === 'rescue',
                            });
                          }}
                          onMouseLeave={() => setHoveredNav(null)}
                          onFocus={e => {
                            if (!sidebarCollapsed) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredNav({
                              label: item.label,
                              badge: item.badge,
                              top: rect.top + rect.height / 2,
                              left: rect.right + 12,
                              isDanger: item.id === 'rescue',
                            });
                          }}
                          onBlur={() => setHoveredNav(null)}
                          className={`w-full flex items-center ${
                            sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'
                          } py-2 rounded-xl text-[13px] font-semibold transition cursor-pointer text-left ${
                            isActive
                              ? 'bg-gradient-to-r from-emerald-700 to-teal-800 text-white shadow-md'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                          }`}
                          aria-label={item.label}
                        >
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              isActive
                                ? 'text-white'
                                : item.id === 'rescue'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          />
                          {!sidebarCollapsed && (
                            <span className="truncate flex-1">{item.label}</span>
                          )}
                          {!sidebarCollapsed && item.badge && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono font-bold whitespace-nowrap ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : item.badge === 'Admin' || item.badge === 'SOS'
                                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300'
                                  : item.badge === 'Đã ẩn'
                                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                  : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* User Account Dock */}
        <div className="p-3 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40">
          {currentUser ? (
            <div className="space-y-2">
              <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
                {!sidebarCollapsed && (
                  <div
                    onClick={() => setCurrentView('account')}
                    className="flex items-center gap-2.5 overflow-hidden cursor-pointer group"
                  >
                    <UserAvatar
                      src={userProfile?.avatarUrl || currentUser.photoURL}
                      name={userProfile?.displayName || currentUser.displayName || currentUser.email}
                      size={34}
                      isPrimaryAdmin={isPrimaryAdmin}
                      rounded="xl"
                    />
                    <div className="truncate">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate flex items-center gap-1 group-hover:text-emerald-600">
                        <span className="truncate">{userProfile?.displayName || currentUser.displayName || currentUser.email}</span>
                        {verificationProgress.isFullyVerified && <VerifiedBlueTick size="xs" />}
                        {isPrimaryAdmin && (
                          <ShieldCheck className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">
                        {isPrimaryAdmin ? 'Super Admin' : userProfile?.accountType === 'employee' ? 'Cán bộ Y tế' : 'Công dân'}
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={logout}
                  onMouseEnter={e => {
                    if (!sidebarCollapsed) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredNav({
                      label: 'Đăng xuất',
                      top: rect.top + rect.height / 2,
                      left: rect.right + 12,
                      isDanger: true,
                    });
                  }}
                  onMouseLeave={() => setHoveredNav(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                  aria-label="Đăng xuất"
                  title={!sidebarCollapsed ? 'Đăng xuất' : undefined}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setCurrentView('account')}
                onMouseEnter={e => {
                  if (!sidebarCollapsed) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredNav({
                    label: 'Đăng nhập & Thiết bị',
                    top: rect.top + rect.height / 2,
                    left: rect.right + 12,
                  });
                }}
                onMouseLeave={() => setHoveredNav(null)}
                className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-semibold bg-emerald-700 hover:bg-emerald-800 text-white transition shadow-sm cursor-pointer whitespace-nowrap ${
                  sidebarCollapsed ? 'p-2' : ''
                }`}
                aria-label="Đăng nhập & Thiết bị"
                title={!sidebarCollapsed ? 'Tài khoản & Thiết bị' : undefined}
              >
                <LogIn className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span>Đăng nhập</span>}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full flex flex-col z-10 shadow-2xl">
            <div className="h-16 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <StationLogo size={36} />
                <div className="min-w-0 flex-1">
                  {!settingsLoaded ? (
                    <div className="h-3.5 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                  ) : (
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {isConfigured ? settings.stationName : 'Trạm Y Tế Xã/Phường'}
                    </h3>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
              {navGroups.map(group => {
                const GroupIcon = group.icon;
                const isOpen = Boolean(openGroups[group.id]);
                const hasActiveChild = group.items.some(i => i.id === currentView);
                return (
                  <div key={group.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={isOpen}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${
                        hasActiveChild
                          ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/40'
                          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <GroupIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{group.title}</span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                          isOpen ? 'rotate-0' : '-rotate-90'
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className="space-y-1 pl-2 ml-2.5 border-l border-slate-200 dark:border-slate-800">
                        {group.items.map(item => {
                          const Icon = item.icon;
                          const isActive = currentView === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setCurrentView(item.id);
                                setMobileDrawerOpen(false);
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold text-left ${
                                isActive
                                  ? 'bg-emerald-700 text-white'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <Icon
                                className={`w-4 h-4 shrink-0 ${
                                  !isActive && item.id === 'rescue' ? 'text-rose-600 dark:text-rose-400' : ''
                                }`}
                              />
                              <span className="flex-1 truncate">{item.label}</span>
                              {item.badge && (
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono font-bold whitespace-nowrap ${
                                    isActive
                                      ? 'bg-white/20 text-white'
                                      : item.badge === 'Admin' || item.badge === 'SOS'
                                      ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300'
                                      : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <PWAInstallButton variant="drawer" />

              {currentUser ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileDrawerOpen(false);
                      setCurrentView('account');
                    }}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <UserAvatar
                      src={userProfile?.avatarUrl || currentUser.photoURL}
                      name={userProfile?.displayName || currentUser.displayName || currentUser.email}
                      size={34}
                      isPrimaryAdmin={isPrimaryAdmin}
                      rounded="xl"
                    />
                    <div className="truncate">
                      <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1 truncate">
                        <span className="truncate">
                          {userProfile?.displayName || currentUser.displayName || currentUser.email}
                        </span>
                        {verificationProgress.isFullyVerified && <VerifiedBlueTick size="xs" />}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-400 font-mono truncate">
                        <span className="truncate">{currentUser.email}</span>
                      </span>
                    </div>
                  </button>
                  <button type="button" onClick={logout} className="p-2 text-rose-600 shrink-0" title="Đăng xuất">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    setCurrentView('account');
                  }}
                  className="w-full py-2.5 bg-emerald-700 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <LogIn className="w-4 h-4 shrink-0" /> Đăng nhập
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0 w-full overflow-x-clip">
        {/* Top Sticky Header: Section title on scroll down, normal header on scroll up */}
        {(() => {
          const allNav = navGroups.flatMap(g => g.items);
          const currentNavTitle =
            allNav.find(item => item.id === currentView)?.label ||
            (isConfigured ? settings.stationName : 'Trạm Y Tế');
          const showSectionHeader =
            scrollDir === 'down' && isScrolledPastTop && Boolean(activeSectionTitle);

          return (
            <header className="h-16 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md sticky top-0 z-20 px-4 sm:px-8 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  aria-label="Mở menu điều hướng"
                >
                  <Menu className="w-5 h-5" />
                </button>

                <div className="min-w-0 flex-1 overflow-hidden">
                  {showSectionHeader ? (
                    <div
                      key={activeSectionTitle}
                      className="flex items-center gap-2 min-w-0 animate-in fade-in duration-200"
                    >
                      <span className="hidden sm:inline-block text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
                        Mục hiện tại
                      </span>
                      <span className="hidden sm:inline-block text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                        {activeSectionTitle}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0 animate-in fade-in duration-200">
                      <span className="lg:hidden font-bold text-sm text-slate-900 dark:text-white truncate">
                        {isConfigured ? settings.stationName : 'Trạm Y Tế'}
                      </span>
                      <span className="hidden lg:inline-block font-bold text-sm text-slate-700 dark:text-slate-200 truncate">
                        {currentNavTitle}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Header Affordances */}
              <div className="flex items-center gap-2 shrink-0">
                {(isPrimaryAdmin || userProfile?.accountType === 'admin') && (
                  <div className="hidden md:flex items-center gap-1 p-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-xl text-xs">
                    <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 px-2 flex items-center gap-1 whitespace-nowrap">
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden xl:inline">Vai trò:</span>
                    </span>
                    <select
                      value={activeAccountType === 'admin' ? 'admin' : activeAccountType === 'employee' ? 'staff' : 'citizen'}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === 'admin') switchPreviewRole('super_admin', 'admin');
                        else if (val === 'staff') switchPreviewRole('doctor', 'employee');
                        else switchPreviewRole('citizen', 'citizen');
                      }}
                      className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs font-semibold px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-700 focus:outline-none cursor-pointer"
                    >
                      <option value="admin">Quản trị viên</option>
                      <option value="staff">Cán bộ Y tế</option>
                      <option value="citizen">Công dân</option>
                    </select>

                    {isSimulatingRole && (
                      <button
                        type="button"
                        onClick={resetRoleToActual}
                        className="px-2 py-1 rounded-lg bg-amber-600 text-white font-bold text-[11px] hover:bg-amber-700 transition whitespace-nowrap"
                        title="Khôi phục quyền thực tế"
                      >
                        Khôi phục
                      </button>
                    )}
                  </div>
                )}

                {/* Dark Mode Toggle Button */}
                <button
                  type="button"
                  onClick={() => setIsDarkMode(v => !v)}
                  className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                  title={isDarkMode ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối (Dark Mode)'}
                >
                  {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
                </button>

                {/* Refresh Data & Location Button */}
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  className={`p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0 ${
                    isRefreshing ? 'animate-spin text-emerald-600' : ''
                  }`}
                  title="Cập nhật dữ liệu & GPS"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                {/* Notification Bell Button */}
                <button
                  type="button"
                  onClick={() => setNotificationModalOpen(true)}
                  className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition relative cursor-pointer shrink-0"
                  title="Thông báo cá nhân & hệ thống"
                >
                  <Bell className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </div>
            </header>
          );
        })()}

        {/* Prominent Global Holiday Alert Banner immediately below Header when visiting on a configured holiday */}
        {(() => {
          const bannerHolidays = activeHolidaysToday.filter(h => h.showBanner !== false);
          if (bannerHolidays.length === 0) return null;
          const leadHoliday = bannerHolidays[0];
          const contacts = getConfiguredEmergencyContacts(settings);
          const priorityPhone = leadHoliday.emergencyPhone?.trim() || contacts[0]?.phone || settings.emergencyPhone;
          const pointLeaders = getStationPointLeaders(settings);
          const leadHeadName = leadHoliday.headName?.trim() || pointLeaders[0]?.headName || '';
          const leadHeadPhone = leadHoliday.headPhone?.trim() || pointLeaders[0]?.phone || '';
          const todayDuties = getDutySchedulesForHoliday(
            workSchedules,
            leadHoliday,
            getVietnamTodayKey()
          );
          const leadDuty = todayDuties[0];
          const leadDutyStaff = leadDuty ? (leadDuty.doctorName || leadDuty.staffNames || leadDuty.title) : '';

          return (
            <div
              role="region"
              aria-label="Thông báo nghỉ lễ hôm nay"
              className="bg-gradient-to-r from-rose-700 via-rose-800 to-amber-700 text-white px-4 sm:px-8 py-3 shadow-md border-b border-rose-900/40 w-full"
            >
              <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-extrabold">
                    <CalendarOff className="w-4 h-4 text-amber-200 shrink-0" />
                    <span className="text-amber-200 whitespace-nowrap">THÔNG BÁO NGHỈ LỄ</span>
                    <span className="text-rose-200">·</span>
                    <span className="text-white truncate">
                      {leadHoliday.noticeTitle?.trim() || leadHoliday.name}
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-rose-100 leading-snug tabular-nums">
                    Thời gian: <strong>{formatHolidayDateRange(leadHoliday)}</strong>
                    {leadHoliday.resumeDate
                      ? ` · Làm việc lại: ${formatIsoDateVN(leadHoliday.resumeDate)}`
                      : ''}
                    {leadHeadName ? ` · Người đứng đầu: ${leadHeadName}` : ''}
                    {leadHeadPhone ? ` (${leadHeadPhone})` : ''}
                    {todayDuties.length > 0
                      ? ` · Lịch trực hôm nay: ${todayDuties.length} ca (${leadDutyStaff}${leadDuty?.phone ? ` - ${leadDuty.phone}` : ''})`
                      : ' · Vẫn duy trì trực cấp cứu 24/7.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {leadHeadPhone && (
                    <a
                      href={`tel:${leadHeadPhone}`}
                      className="px-3 py-1.5 rounded-xl bg-amber-500/25 hover:bg-amber-500/35 border border-amber-300/35 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition tabular-nums whitespace-nowrap"
                      title={leadHeadName ? `Gọi Người đứng đầu: ${leadHeadName}` : 'Gọi Người đứng đầu Điểm Y tế'}
                    >
                      <User className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                      <span>
                        {leadHeadName ? `${leadHeadName}: ` : 'Lãnh đạo điểm: '}
                        {leadHeadPhone}
                      </span>
                    </a>
                  )}

                  {priorityPhone && priorityPhone !== leadHeadPhone && (
                    <a
                      href={`tel:${priorityPhone}`}
                      className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition tabular-nums whitespace-nowrap"
                    >
                      <Phone className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                      <span>Cấp cứu 24/7: {priorityPhone}</span>
                    </a>
                  )}

                  {currentView !== 'duty' && (
                    <button
                      type="button"
                      onClick={() => setCurrentView('duty')}
                      className="px-3.5 py-1.5 rounded-xl bg-white text-rose-900 hover:bg-rose-50 text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-xs"
                    >
                      <span>Xem lịch trực lễ 24/7</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Independent General / Normal Top-Page Banner Notice */}
        {(() => {
          const bannerText = settings.bannerNotice?.trim() || '';
          const bannerEnabled = settings.bannerNoticeEnabled ?? Boolean(bannerText);
          if (!bannerEnabled || !bannerText) return null;
          const generalSig = `${settings.startupPopup?.updatedAt || ''}|${bannerText}`;
          if (dismissedGeneralBannerSig === generalSig) return null;

          const ctaTarget =
            settings.startupPopup?.ctaView && settings.startupPopup.ctaView !== 'none'
              ? settings.startupPopup.ctaView
              : undefined;
          const ctaText = settings.startupPopup?.ctaLabel?.trim() || 'Xem chi tiết';

          return (
            <div
              role="region"
              aria-label="Thông báo chung đầu trang"
              className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-700 text-white px-4 sm:px-8 py-2.5 shadow-sm border-b border-amber-800/40 w-full"
            >
              <div className="w-full flex items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                  <Megaphone className="w-4 h-4 text-amber-100 shrink-0 mt-0.5 sm:mt-0" />
                  <p className="text-xs sm:text-sm font-semibold leading-snug text-white min-w-0 flex-1">
                    <span className="font-extrabold uppercase tracking-wider text-amber-100 mr-1.5">
                      Thông báo:
                    </span>
                    <span className="break-words">{bannerText}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {ctaTarget && currentView !== ctaTarget && (
                    <button
                      type="button"
                      onClick={() => setCurrentView(ctaTarget)}
                      className="hidden sm:inline-flex px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white text-amber-900 text-xs font-extrabold items-center gap-1 transition cursor-pointer whitespace-nowrap shadow-xs"
                    >
                      <span>{ctaText}</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setDismissedGeneralBannerSig(generalSig);
                      try {
                        sessionStorage.setItem('tyt_dismissed_general_banner_v1', generalSig);
                      } catch {
                        // ignore
                      }
                    }}
                    aria-label="Đóng thông báo bình thường đầu trang"
                    title="Đóng thông báo này"
                    className="p-1.5 rounded-xl text-white/85 hover:text-white hover:bg-white/20 transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Independent Vaccination Countdown Strip immediately below Header */}
        {(() => {
          if (settings.vaccinationBannerEnabled === false) return null;

          type ValidCountdownEntry = {
            item: VaccinationScheduleItem;
            effectiveStatus: VaccinationScheduleItem['status'];
            startMs: number;
            endMs: number;
          };
          const validEntries: ValidCountdownEntry[] = [];
          activeCountdownCandidates.forEach(item => {
            const lifecycle = resolveVaccinationLifecycle(item, countdownNowMs);
            if (
              lifecycle.effectiveStatus !== 'completed' &&
              lifecycle.effectiveStatus !== 'postponed' &&
              lifecycle.startMs !== null &&
              lifecycle.endMs !== null &&
              lifecycle.endMs > countdownNowMs
            ) {
              validEntries.push({
                item,
                effectiveStatus: lifecycle.effectiveStatus,
                startMs: lifecycle.startMs,
                endMs: lifecycle.endMs,
              });
            }
          });

          if (validEntries.length === 0) return null;

          const sortedEntries = [...validEntries].sort((a, b) => {
            const aOngoing = a.effectiveStatus === 'ongoing';
            const bOngoing = b.effectiveStatus === 'ongoing';
            if (aOngoing !== bOngoing) return aOngoing ? -1 : 1;
            if (Boolean(a.item.isPinned) !== Boolean(b.item.isPinned)) {
              return a.item.isPinned ? -1 : 1;
            }
            return a.startMs - b.startMs;
          });

          const target = sortedEntries[0];
          const vacSig = `${target.item.id}:${target.item.updatedAt || target.item.date}:${settings.vaccinationBannerNote || ''}`;
          if (dismissedVacBannerSig === vacSig) return null;

          const isOngoing = target.effectiveStatus === 'ongoing';
          const targetDeadlineMs = isOngoing ? target.endMs : target.startMs;
          const diffMs = Math.max(0, targetDeadlineMs - countdownNowMs);

          const days = Math.floor(diffMs / 86_400_000);
          const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
          const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
          const seconds = Math.floor((diffMs % 60_000) / 1000);

          const pad = (n: number) => String(n).padStart(2, '0');
          const dateText = formatVaccinationDateRange(target.item);
          const vacBannerNote = settings.vaccinationBannerNote?.trim() || '';

          return (
            <div
              role="region"
              aria-label="Thông báo tiêm chủng đầu trang"
              className="bg-gradient-to-r from-emerald-600 via-teal-700 to-emerald-800 text-white px-4 sm:px-8 py-3 shadow-md w-full"
            >
              <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-extrabold min-w-0">
                    <Syringe className="w-4 h-4 text-amber-300 shrink-0 animate-pulse" />
                    <span className="text-amber-300 whitespace-nowrap shrink-0">Tiêm chủng mở rộng</span>
                    <span className="text-emerald-200">·</span>
                    <span className="truncate text-white font-bold">{target.item.title}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs font-medium text-emerald-100 tabular-nums">
                    <span>Ngày triển khai: {dateText}</span>
                    {vacBannerNote && (
                      <>
                        <span className="text-emerald-200/70">·</span>
                        <span className="text-amber-100 font-semibold">{vacBannerNote}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 text-white font-mono font-extrabold text-xs sm:text-sm tabular-nums whitespace-nowrap shadow-xs">
                    <Clock className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>
                      {isOngoing ? 'Còn lại ' : 'Đếm ngược '}
                      {pad(days)} ngày · {pad(hours)}:{pad(minutes)}:{pad(seconds)}
                    </span>
                  </div>

                  {currentView !== 'vaccination' && (
                    <button
                      type="button"
                      onClick={() => setCurrentView('vaccination')}
                      className="px-4 py-2 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
                    >
                      <span>Đến lịch tiêm</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setDismissedVacBannerSig(vacSig);
                      try {
                        sessionStorage.setItem('tyt_dismissed_vac_banner_v1', vacSig);
                      } catch {
                        // ignore
                      }
                    }}
                    aria-label="Đóng thông báo tiêm chủng đầu trang"
                    title="Đóng thanh tiêm chủng này"
                    className="p-1.5 rounded-xl text-white/85 hover:text-white hover:bg-white/20 transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Main Content Viewport */}
        <div className="flex-1 px-4 sm:px-8 py-6 w-full space-y-6">
          {children}
        </div>

        {/* Footer */}
        <CustomFooter settings={settings} settingsLoaded={settingsLoaded} onNavigateToView={setCurrentView} />

        {/* Notification Drawer Modal */}
        <NotificationDrawerModal
          isOpen={notificationModalOpen}
          focusedNotificationId={focusedNotifId}
          onClose={() => {
            setNotificationModalOpen(false);
            setFocusedNotifId(null);
          }}
        />
      </div>

      {/* Mobile Bottom Thumb Navigation Bar */}
      <nav
        aria-label="Điều hướng nhanh thiết bị"
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-30 min-h-14 pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid items-center px-1 ${
          mobileBottomItems.length === 5
            ? 'grid-cols-5'
            : mobileBottomItems.length === 4
            ? 'grid-cols-4'
            : mobileBottomItems.length === 3
            ? 'grid-cols-3'
            : 'grid-cols-2'
        }`}
      >
        {mobileBottomItems.map(item => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentView(item.id)}
              className={`h-14 min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition cursor-pointer ${
                isActive
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
              <span className="truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Back to Top Floating Button (appears when scrolled near bottom of page) */}
      <button
        type="button"
        onClick={handleBackToTop}
        aria-label="Cuộn lên đầu trang"
        title="Lên đầu trang"
        className={`fixed bottom-20 right-4 lg:bottom-7 lg:right-7 z-40 inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white text-xs font-bold shadow-lg shadow-emerald-900/25 border border-emerald-500/40 backdrop-blur-sm transition-all duration-300 cursor-pointer ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        <ArrowUp className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">Lên đầu trang</span>
      </button>

      {/* Portaled Hover Label Tooltip for Collapsed Desktop Sidebar */}
      {sidebarCollapsed &&
        hoveredNav &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: hoveredNav.top, left: hoveredNav.left }}
            className="fixed -translate-y-1/2 z-[90] pointer-events-none hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold shadow-xl border border-slate-700/80 whitespace-nowrap"
          >
            <span
              aria-hidden="true"
              className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 bg-slate-900 dark:bg-slate-800 border-l border-b border-slate-700/80"
            />
            <span className="relative z-10">{hoveredNav.label}</span>
            {hoveredNav.badge && (
              <span
                className={`relative z-10 text-[10px] px-1.5 py-0.5 rounded-md font-mono font-bold ${
                  hoveredNav.isDanger || hoveredNav.badge === 'Admin' || hoveredNav.badge === 'SOS'
                    ? 'bg-rose-500/25 text-rose-200'
                    : hoveredNav.badge === 'Đã ẩn'
                    ? 'bg-slate-700 text-slate-300'
                    : 'bg-amber-500/25 text-amber-200'
                }`}
              >
                {hoveredNav.badge}
              </span>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
