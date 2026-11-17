import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  User,
  Phone,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  MapPin,
  Stethoscope,
  LogOut,
  KeyRound,
  Camera,
  Eye,
  EyeOff,
  ArrowLeft,
  Send,
  Bell,
  Navigation,
  Smartphone,
  Share2,
  Download,
  Wifi,
  WifiOff,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  Settings,
  ChevronRight,
  ChevronDown,
  Info,
  Sun,
  Moon,
  RefreshCw,
  Sparkles,
  Database,
  HardDriveDownload,
  RotateCcw,
  Copy,
  Check,
  X,
  Ticket,
  Search,
} from 'lucide-react';
import {
  useAuth,
  getPendingReferralCode,
  setPendingReferralCode,
  captureReferralCodeFromUrl,
} from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useUserPermissions } from '../../hooks/useUserPermissions';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { StationLogo } from '../common/StationLogo';
import { UserAvatar } from '../common/UserAvatar';
import { AccountSecurityCard } from '../account/AccountSecurityCard';
import {
  SystemSettings,
  UserProfile,
  EthnicItem,
  ProvinceItem,
  WardItem,
} from '../../types';
import {
  isDeviceNotificationEnabled,
  setDeviceNotificationEnabled,
  subscribeDeviceToWebPush,
  unsubscribeDeviceFromWebPush,
  sendTestBackgroundPush,
  getOrCreateDeviceId,
} from '../../services/systemNotificationService';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { VerifiedBlueTick } from '../common/VerifiedBlueTick';
import { SoftwareTeamContactCard } from '../common/SoftwareTeamContactCard';
import { getUserVerificationProgress } from '../../utils/verificationBadge';
import { formatFirebaseGoogleAuthError } from '../../utils/smsMfaUtils';
import {
  buildEmailLockId,
  buildPhoneLockId,
  buildCccdLockId,
  autoCompleteGmail,
  isValidEmailAddress,
  normalizeAndValidatePhone,
  maskVerifiedValue,
  maskNameForLookup,
  maskAddressForLookup,
  maskGenderForLookup,
  verifyUnauthenticatedPasswordResetIdentity,
} from '../../utils/verifiedIdentity';
import {
  savePushSubscriptionRecord,
  deletePushSubscriptionRecord,
  cleanDataForFirestore,
  loadLocalFeedbackHistory,
  loadScopedLocalFeedbackHistory,
  saveLocalFeedbackHistory,
  loadLocalNearbyFacilityHistory,
  upsertLocalNearbyFacilityHistory,
  LocalFeedbackHistoryItem,
} from '../../services/firebaseService';
import {
  calculateHaversineDistance,
  estimateDrivingMinutes,
} from '../portal/StationMapSection';
import {
  lookupCitizenByCccd,
  parseAddressIntoAdministrativeParts,
  CitizenDatabaseLookupRecord,
  ParsedAdministrativeAddress,
} from '../../utils/citizenDatabaseLookup';

interface AccountDeviceViewProps {
  settings: SystemSettings;
  setCurrentView: (view: string) => void;
}

const REMEMBERED_LOGIN_KEY = 'tyt_remembered_login_v1';
const LOCATION_PREF_KEY = 'tyt_device_location_enabled_v1';

interface RememberedCredentials {
  email: string;
  password: string;
  remember: boolean;
}

function loadRememberedCredentials(): RememberedCredentials {
  try {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    if (!raw) return { email: '', password: '', remember: true };
    const parsed = JSON.parse(raw);
    return {
      email: typeof parsed.email === 'string' ? parsed.email : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      remember: parsed.remember !== false,
    };
  } catch {
    return { email: '', password: '', remember: true };
  }
}

function loadLocationPref(): boolean {
  try {
    return localStorage.getItem(LOCATION_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

async function compressImageToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Định dạng ảnh không hợp lệ'));
      img.onload = () => {
        const size = 220;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const AccountDeviceView: React.FC<AccountDeviceViewProps> = ({
  settings,
  setCurrentView,
}) => {
  const {
    currentUser,
    userProfile,
    isAdmin,
    isPrimaryAdmin,
    hasPasswordProvider,
    hasGoogleProvider,
    totpConfig,
    twoFactorEnabled,
    enrolledSmsFactors,
    smsMfaEnabled,
    verifiedDevices,
    signInWithGoogle,
    loginWithEmail,
    registerWithEmail,
    confirmAndLockPhoneNumber,
    verifyAndLockCitizenId,
    sendPasswordReset,
    logout,
    updateProfileData,
    refreshCurrentUserState,
  } = useAuth();
  const { showToast } = useToast();
  const {
    locationStatus,
    notificationStatus,
    userCoords,
    requestLocation,
    requestNotification,
  } = useUserPermissions();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<'account' | 'device'>('account');

  // Auth form states
  const savedCreds = loadRememberedCredentials();
  const initialRefCode = captureReferralCodeFromUrl() || getPendingReferralCode();
  const [authMode, setAuthMode] = useState<'login' | 'register'>(
    initialRefCode ? 'register' : 'login'
  );
  const [email, setEmail] = useState(savedCreds.email);
  const [password, setPassword] = useState(savedCreds.password);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState(initialRefCode);
  const [lockingCccd, setLockingCccd] = useState(false);
  const [lockingPhone, setLockingPhone] = useState(false);
  const [rememberMe, setRememberMe] = useState(savedCreds.remember);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState(savedCreds.email);
  const [resetPhone, setResetPhone] = useState('');
  const [resetCccd, setResetCccd] = useState('');
  const [sendingReset, setSendingReset] = useState(false);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [resetGateOpen, setResetGateOpen] = useState(false);
  const [resetCheckEmail, setResetCheckEmail] = useState('');
  const [resetCheckPhone, setResetCheckPhone] = useState('');
  const [resetCheckCccd, setResetCheckCccd] = useState('');
  const [resetCheckName, setResetCheckName] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);

  // Reference datasets from public/json (Dân tộc & Địa giới hành chính)
  const [ethnicList, setEthnicList] = useState<EthnicItem[]>([]);
  const [provincesList, setProvincesList] = useState<ProvinceItem[]>([]);
  const [copiedCard, setCopiedCard] = useState(false);
  const personalBackupInputRef = useRef<HTMLInputElement | null>(null);

  // Profile form states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({
    displayName: userProfile?.displayName || '',
    phoneNumber: userProfile?.phoneNumber || '',
    citizenId: userProfile?.citizenId || '',
    dob: userProfile?.dob || '',
    gender: userProfile?.gender || 'Nam',
    ethnicity: userProfile?.ethnicity || 'Kinh',
    provinceCode: userProfile?.provinceCode || '',
    provinceName: userProfile?.provinceName || '',
    wardCode: userProfile?.wardCode || '',
    wardName: userProfile?.wardName || '',
    address: userProfile?.address || '',
    department: userProfile?.department || '',
    position: userProfile?.position || '',
    qualification: userProfile?.qualification || '',
    avatarUrl: userProfile?.avatarUrl || currentUser?.photoURL || '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [identityExpanded, setIdentityExpanded] = useState(false);
  const [nfcFallbackModalOpen, setNfcFallbackModalOpen] = useState(false);
  const [nfcFallbackInput, setNfcFallbackInput] = useState('');
  const [lookingUpCccd, setLookingUpCccd] = useState(false);
  const [cccdLookupStatus, setCccdLookupStatus] = useState<
    'idle' | 'found' | 'not_found' | 'error'
  >('idle');
  const [matchedCitizenRecord, setMatchedCitizenRecord] = useState<
    (CitizenDatabaseLookupRecord &
      ParsedAdministrativeAddress & { rawLookupDigits?: string; isMasked?: boolean }) | null
  >(null);
  const [cccdLookupMessage, setCccdLookupMessage] = useState<string | null>(null);
  const lastLookedUpCccdRef = useRef<string>('');

  const isSuperAdmin = Boolean(isPrimaryAdmin || userProfile?.role === 'super_admin');
  const canViewFullIdentity = Boolean(isAdmin);
  const allowIdentityEditByAdmin = isSuperAdmin || Boolean(userProfile?.allowIdentityEditByAdmin);
  const isProfileLocked = Boolean(
    !isSuperAdmin &&
      (userProfile?.identityVerifiedFromDatabase || userProfile?.citizenIdVerified) &&
      !allowIdentityEditByAdmin
  );
  const isCoreIdentityLocked = Boolean(
    !isSuperAdmin && (isProfileLocked || (!allowIdentityEditByAdmin && matchedCitizenRecord))
  );
  const isCccdLocked = isProfileLocked;
  const isPhoneLocked = Boolean(
    !isSuperAdmin && (isProfileLocked || (userProfile?.phoneVerified && !allowIdentityEditByAdmin))
  );
  const shouldMaskLockedProfileFields = Boolean(
    !canViewFullIdentity &&
      !allowIdentityEditByAdmin &&
      userProfile?.identityVerifiedFromDatabase
  );
  const shouldMaskLookupPreview = Boolean(
    matchedCitizenRecord && !canViewFullIdentity && !allowIdentityEditByAdmin
  );

  const handleLookupCccdInDatabase = async (rawValue?: string, silent = false) => {
    const digits = String(rawValue ?? profileForm.citizenId ?? '')
      .replace(/\D/g, '')
      .trim();

    if (digits.length < 9 || digits.length > 12) {
      if (!silent) {
        showToast('warning', 'Số CCCD chưa hợp lệ', 'Vui lòng nhập đủ 9 đến 12 chữ số CCCD/CMND.');
      }
      return;
    }

    lastLookedUpCccdRef.current = digits;
    setLookingUpCccd(true);
    setCccdLookupMessage(null);

    try {
      const idToken = await currentUser?.getIdToken().catch(() => null);
      const res = await lookupCitizenByCccd(digits, { idToken, action: 'lookup' });
      if (res.found && res.record) {
        const shouldMask = Boolean(res.isMasked || !canViewFullIdentity);
        if (shouldMask) {
          const maskedRecord: CitizenDatabaseLookupRecord &
            ParsedAdministrativeAddress & { rawLookupDigits?: string; isMasked?: boolean } = {
            citizenId: maskVerifiedValue(res.record.citizenId || digits, 'cccd'),
            displayName: res.record.displayName.startsWith('****')
              ? res.record.displayName
              : maskNameForLookup(res.record.displayName),
            dob: res.record.dob,
            dobRaw: res.record.dobRaw,
            gender: '****',
            permanentAddress: res.record.permanentAddress.startsWith('****')
              ? res.record.permanentAddress
              : maskAddressForLookup(res.record.permanentAddress),
            currentAddress: res.record.currentAddress.startsWith('****')
              ? res.record.currentAddress
              : maskAddressForLookup(res.record.currentAddress),
            fullAddress: res.record.fullAddress.startsWith('****')
              ? res.record.fullAddress
              : maskAddressForLookup(res.record.fullAddress),
            provinceCode: '',
            provinceName: '',
            wardCode: '',
            wardName: '',
            address: '',
            rawLookupDigits: digits,
            isMasked: true,
          };
          setMatchedCitizenRecord(maskedRecord);
          setCccdLookupStatus('found');
          setCccdLookupMessage(
            'Tìm thấy thông tin công dân trong cơ sở dữ liệu. Hệ thống ẩn bớt dữ liệu nhạy cảm và hiển thị đầy đủ Ngày sinh để bạn đối chiếu xác nhận.'
          );
          setProfileForm(prev => ({
            ...prev,
            citizenId: digits,
            dob: res.record!.dob || prev.dob,
          }));
        } else {
          const parsedAddr = parseAddressIntoAdministrativeParts(
            res.record.fullAddress,
            provincesList
          );
          const combined = {
            ...res.record,
            ...parsedAddr,
            rawLookupDigits: digits,
            isMasked: false,
          };
          setMatchedCitizenRecord(combined);
          setCccdLookupStatus('found');
          setCccdLookupMessage(
            'Tìm thấy thông tin công dân trong cơ sở dữ liệu. Vui lòng kiểm tra kỹ và nhấn "Xác nhận đúng thông tin & Khóa hồ sơ".'
          );
          setProfileForm(prev => ({
            ...prev,
            citizenId: res.record!.citizenId,
            displayName: res.record!.displayName,
            dob: res.record!.dob,
            gender: res.record!.gender === '****' ? 'Nam' : res.record!.gender,
            provinceCode: parsedAddr.provinceCode,
            provinceName: parsedAddr.provinceName,
            wardCode: parsedAddr.wardCode,
            wardName: parsedAddr.wardName,
            address: parsedAddr.address,
          }));
        }
        if (!silent) {
          showToast(
            'success',
            'Đã tìm thấy thông tin CCCD',
            shouldMask
              ? 'Vui lòng đối chiếu thông tin rút gọn và Ngày sinh rồi bấm xác nhận để khóa hồ sơ.'
              : 'Thông tin Họ tên, Ngày sinh, Giới tính và Địa chỉ đã được tự động điền. Vui lòng xác nhận để khóa hồ sơ.'
          );
        }
      } else {
        setMatchedCitizenRecord(null);
        setCccdLookupStatus('not_found');
        setCccdLookupMessage(
          'Số CCCD này chưa có trong cơ sở dữ liệu dân cư — Bạn vui lòng nhập thủ công các thông tin bên dưới như bình thường.'
        );
        if (!silent) {
          showToast(
            'info',
            'Không có trong cơ sở dữ liệu CCCD',
            'Bạn có thể nhập thủ công Họ tên, Ngày sinh, Giới tính và Địa chỉ như bình thường.'
          );
        }
      }
    } catch (err: any) {
      setMatchedCitizenRecord(null);
      setCccdLookupStatus('error');
      setCccdLookupMessage(err?.message || 'Không thể tra cứu cơ sở dữ liệu CCCD.');
      if (!silent) {
        showToast('error', 'Lỗi tra cứu CCCD', err?.message || 'Vui lòng thử lại.');
      }
    } finally {
      setLookingUpCccd(false);
    }
  };

  useEffect(() => {
    if (!matchedCitizenRecord || matchedCitizenRecord.isMasked || provincesList.length === 0) return;
    if (matchedCitizenRecord.provinceCode) return;
    const parsedAddr = parseAddressIntoAdministrativeParts(
      matchedCitizenRecord.fullAddress,
      provincesList
    );
    if (parsedAddr.provinceCode || parsedAddr.wardCode) {
      setMatchedCitizenRecord(prev => (prev ? { ...prev, ...parsedAddr } : prev));
      setProfileForm(prev => ({
        ...prev,
        provinceCode: parsedAddr.provinceCode,
        provinceName: parsedAddr.provinceName,
        wardCode: parsedAddr.wardCode,
        wardName: parsedAddr.wardName,
        address: parsedAddr.address,
      }));
    }
  }, [provincesList, matchedCitizenRecord]);

  useEffect(() => {
    if (!editingProfile) return;
    if (userProfile?.citizenIdVerified && !allowIdentityEditByAdmin) return;
    const digits = (profileForm.citizenId || '').replace(/\D/g, '').trim();
    if (digits.length !== 10 && digits.length !== 12) return;
    if (lastLookedUpCccdRef.current === digits) return;

    const timer = window.setTimeout(() => {
      void handleLookupCccdInDatabase(digits, true);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileForm.citizenId, editingProfile, userProfile?.citizenIdVerified, allowIdentityEditByAdmin]);

  const handleConfirmNfcFallback = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nfcFallbackInput.trim();
    if (!cleaned) {
      showToast('warning', 'Thiếu số CCCD', 'Vui lòng nhập mã số CCCD gắn chip (12 số).');
      return;
    }
    setProfileForm(prev => ({
      ...prev,
      citizenId: cleaned,
    }));
    setNfcFallbackModalOpen(false);
    showToast('success', 'Đã nhận số CCCD qua NFC mô phỏng', `Số CCCD: ${cleaned}`);
    if (!userProfile?.citizenIdVerified || allowIdentityEditByAdmin) {
      void handleLookupCccdInDatabase(cleaned, false);
    }
  };

  const handleNfcScanCccd = async () => {
    if (typeof window === 'undefined' || !('NDEFReader' in window)) {
      setNfcFallbackInput(profileForm.citizenId?.trim() || '');
      setNfcFallbackModalOpen(true);
      return;
    }

    try {
      showToast('success', 'Đang chờ quét NFC CCCD...', 'Đưa mặt sau thẻ CCCD gắn chip lại gần mặt lưng điện thoại.');
      const ndef = new (window as any).NDEFReader();
      await ndef.scan();
      ndef.onreading = (event: any) => {
        const decoder = new TextDecoder();
        for (const record of event.message.records) {
          if (record.recordType === 'text') {
            const text = decoder.decode(record.payload).trim();
            setProfileForm(prev => ({
              ...prev,
              citizenId: text,
            }));
            showToast('success', 'Đọc thẻ NFC CCCD thành công', `Số CCCD: ${text}`);
            if (!userProfile?.citizenIdVerified || allowIdentityEditByAdmin) {
              void handleLookupCccdInDatabase(text, false);
            }
            break;
          }
        }
      };
    } catch (err: any) {
      showToast('error', 'Lỗi quét NFC', err?.message || 'Không thể đọc thẻ CCCD qua NFC.');
    }
  };

  // Device controls state
  const [notifEnabled, setNotifEnabled] = useState<boolean>(isDeviceNotificationEnabled);
  const [locationPref, setLocationPref] = useState<boolean>(loadLocationPref);
  const [locating, setLocating] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [syncingPush, setSyncingPush] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('tyt_theme');
      if (saved) return saved === 'dark';
      return document.documentElement.classList.contains('dark');
    } catch {
      return false;
    }
  });

  const handleToggleDarkMode = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('tyt_theme', next ? 'dark' : 'light');
    } catch {
      // ignore
    }
    showToast('info', next ? 'Đã chuyển sang chế độ Tối (Dark Mode)' : 'Đã chuyển sang chế độ Sáng');
  };

  const APP_VERSION = 'v2.4.0';
  const APP_BUILD_DATE = '14/11/2026';
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckAppUpdate = async () => {
    setCheckingUpdate(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            showToast('success', 'Đã tải bản cập nhật mới', 'Đang làm mới để áp dụng...');
            setTimeout(() => window.location.reload(), 1000);
            return;
          }
        }
      }
      setTimeout(() => {
        setCheckingUpdate(false);
        showToast('success', `Phiên bản hiện tại: ${APP_VERSION}`, 'Ứng dụng đang ở phiên bản mới nhất, hệ thống hoạt động ổn định.');
      }, 700);
    } catch {
      setCheckingUpdate(false);
      showToast('info', `Phiên bản: ${APP_VERSION}`, 'Đã kiểm tra. Bạn đang sử dụng phiên bản mới nhất.');
    }
  };

  const renderVersionCard = () => (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              Phiên bản ứng dụng {APP_VERSION}
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              Mới nhất
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Bản dựng phát hành: {APP_BUILD_DATE} · Đồng bộ PWA &amp; Web Push
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={checkingUpdate}
        onClick={handleCheckAppUpdate}
        className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer shrink-0 disabled:opacity-60 shadow-xs"
      >
        <RefreshCw className={`w-4 h-4 shrink-0 ${checkingUpdate ? 'animate-spin' : ''}`} />
        <span>{checkingUpdate ? 'Đang kiểm tra...' : 'Cập nhật ứng dụng'}</span>
      </button>
    </div>
  );

  const notifSupported = typeof window !== 'undefined' && 'Notification' in window;
  const geoSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  // Fetch dantoc.json and data.json from public
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      fetch('/json/dantoc.json')
        .then(res => (res.ok ? res.json() : []))
        .catch(() => []),
      fetch('/json/data.json')
        .then(res => (res.ok ? res.json() : []))
        .catch(() => []),
    ]).then(([dantocData, provincesData]) => {
      if (!isMounted) return;
      if (Array.isArray(dantocData) && dantocData.length > 0) {
        setEthnicList(dantocData);
      }
      if (Array.isArray(provincesData) && provincesData.length > 0) {
        setProvincesList(provincesData);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (currentUser || userProfile) {
      let pCode = userProfile?.provinceCode || '';
      let pName = userProfile?.provinceName || '';
      if (provincesList.length > 0) {
        if (pCode && !pName) {
          const found = provincesList.find(p => p.province_code === pCode);
          if (found) pName = found.name;
        } else if (!pCode && pName) {
          const found = provincesList.find(p => p.name === pName || p.short_name === pName);
          if (found) pCode = found.province_code;
        }
      }

      let wCode = userProfile?.wardCode || '';
      let wName = userProfile?.wardName || '';
      if (pCode && provincesList.length > 0) {
        const p = provincesList.find(item => item.province_code === pCode);
        if (p) {
          if (wCode && !wName) {
            const w = p.wards.find(item => item.ward_code === wCode);
            if (w) wName = w.name;
          } else if (!wCode && wName) {
            const w = p.wards.find(item => item.name === wName);
            if (w) wCode = w.ward_code;
          }
        }
      }

      setProfileForm({
        displayName: userProfile?.displayName || currentUser?.displayName || '',
        phoneNumber: userProfile?.phoneNumber || currentUser?.phoneNumber || '',
        citizenId: userProfile?.citizenId || '',
        dob: userProfile?.dob || '',
        gender: userProfile?.gender || 'Nam',
        ethnicity: userProfile?.ethnicity || 'Kinh',
        provinceCode: pCode,
        provinceName: pName,
        wardCode: wCode,
        wardName: wName,
        address: userProfile?.address || '',
        department: userProfile?.department || '',
        position: userProfile?.position || '',
        qualification: userProfile?.qualification || '',
        avatarUrl: userProfile?.avatarUrl || currentUser?.photoURL || '',
      });
    }
  }, [currentUser, userProfile, provincesList]);

  const selectedProvince = provincesList.find(
    p => p.province_code === profileForm.provinceCode || p.name === profileForm.provinceName
  );
  const availableWards = selectedProvince ? selectedProvince.wards : [];

  const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    const found = provincesList.find(p => p.province_code === code);
    setProfileForm(prev => ({
      ...prev,
      provinceCode: code,
      provinceName: found ? found.name : '',
      wardCode: '',
      wardName: '',
    }));
  };

  const handleWardChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    const found = availableWards.find(w => w.ward_code === code);
    setProfileForm(prev => ({
      ...prev,
      wardCode: code,
      wardName: found ? found.name : '',
    }));
  };

  const handleEthnicityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setProfileForm(prev => ({
      ...prev,
      ethnicity: e.target.value,
    }));
  };

  const handleExportPersonalBackup = async () => {
    try {
      const resolvedProvinceName = profileForm.provinceName || userProfile?.provinceName || '';
      const resolvedWardName = profileForm.wardName || userProfile?.wardName || '';
      const resolvedAddress = profileForm.address || userProfile?.address || '';
      const fullAddress = [resolvedAddress, resolvedWardName, resolvedProvinceName]
        .filter(Boolean)
        .join(', ');

      const identityData = {
        uid: currentUser?.uid || userProfile?.uid || '',
        email: currentUser?.email || userProfile?.email || '',
        displayName: profileForm.displayName || userProfile?.displayName || '',
        citizenId: profileForm.citizenId || userProfile?.citizenId || '',
        phoneNumber: profileForm.phoneNumber || userProfile?.phoneNumber || '',
        dob: profileForm.dob || userProfile?.dob || '',
        gender: profileForm.gender || userProfile?.gender || 'Nam',
        ethnicity: profileForm.ethnicity || userProfile?.ethnicity || 'Kinh',
        provinceCode: profileForm.provinceCode || userProfile?.provinceCode || '',
        provinceName: resolvedProvinceName,
        wardCode: profileForm.wardCode || userProfile?.wardCode || '',
        wardName: resolvedWardName,
        address: resolvedAddress,
        fullAddress,
        department: profileForm.department || userProfile?.department || '',
        position: profileForm.position || userProfile?.position || '',
        qualification: profileForm.qualification || userProfile?.qualification || '',
        role: userProfile?.role || 'citizen',
        accountType: userProfile?.accountType || 'citizen',
        status: userProfile?.status || 'active',
        avatarUrl: profileForm.avatarUrl || userProfile?.avatarUrl || currentUser?.photoURL || '',
        notes: userProfile?.notes || '',
        createdAt: userProfile?.createdAt || '',
        updatedAt: userProfile?.updatedAt || '',
        lastLoginAt: userProfile?.lastLoginAt || '',
      };

      const vProgress = getUserVerificationProgress(userProfile, {
        emailVerified: Boolean(currentUser?.emailVerified),
        hasGoogleProvider,
        hasPasswordProvider,
        phoneNumber: userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser?.phoneNumber,
        twoFactorEnabled,
        smsMfaEnabled,
      });

      const uid = currentUser?.uid || '';
      const deviceId = getOrCreateDeviceId();

      // Safely fetch deterministic verifiedIdentifiers locks owned by current user via getDoc (rules allow get, disallow list for non-admin)
      const verifiedIdentifiers: any[] = [];
      if (uid) {
        const lockCandidates: string[] = [];
        const targetEmail = currentUser?.email || userProfile?.email || '';
        const targetPhone = userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser?.phoneNumber || '';
        const targetCccd = userProfile?.citizenId || '';

        if (targetEmail) {
          const emailLock = await buildEmailLockId(targetEmail).catch(() => '');
          if (emailLock) lockCandidates.push(emailLock);
        }
        if (targetPhone) {
          const phoneLock = buildPhoneLockId(targetPhone);
          if (phoneLock) lockCandidates.push(phoneLock);
        }
        if (targetCccd) {
          const cccdLock = buildCccdLockId(targetCccd);
          if (cccdLock) lockCandidates.push(cccdLock);
        }

        const lockSnaps = await Promise.allSettled(
          lockCandidates.map(id => getDoc(doc(db, 'verifiedIdentifiers', id)))
        );
        for (const res of lockSnaps) {
          if (res.status === 'fulfilled' && res.value.exists()) {
            const lockData = res.value.data();
            if (lockData?.ownerUid === uid) {
              verifiedIdentifiers.push({ id: res.value.id, ...lockData });
            }
          }
        }
      }

      const securityVerification = {
        verificationPercent: vProgress.percent,
        verificationSummary: {
          completedCount: vProgress.completedCount,
          totalCount: 4,
          isFullyVerified: vProgress.isFullyVerified,
        },
        emailVerified: vProgress.emailDone,
        emailVerifiedAt: userProfile?.emailVerifiedAt || '',
        phoneVerified: vProgress.phoneDone,
        verifiedPhone:
          userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser?.phoneNumber || '',
        phoneVerifiedAt: userProfile?.phoneVerifiedAt || '',
        citizenIdVerified: Boolean(userProfile?.citizenIdVerified),
        citizenIdVerifiedAt: userProfile?.citizenIdVerifiedAt || '',
        hasPasswordLinked: vProgress.passwordDone,
        googleLinked: Boolean(hasGoogleProvider || userProfile?.googleLinked),
        twoFactorEnabled: Boolean(twoFactorEnabled || userProfile?.twoFactorEnabled),
        twoFactorUpdatedAt: userProfile?.twoFactorUpdatedAt || totpConfig?.updatedAt || '',
        totpSecurity:
          totpConfig && totpConfig.secret
            ? {
                enabled: Boolean(totpConfig.enabled),
                secret: totpConfig.secret,
                recoveryCodes: Array.isArray(totpConfig.recoveryCodes)
                  ? totpConfig.recoveryCodes
                  : [],
                issuer: totpConfig.issuer || '',
                verifiedAt: totpConfig.verifiedAt || '',
                updatedAt: totpConfig.updatedAt || new Date().toISOString(),
              }
            : null,
        smsMfaEnabled: Boolean(smsMfaEnabled || userProfile?.smsMfaEnabled),
        smsMfaPhoneMasked: userProfile?.smsMfaPhoneMasked || '',
        enrolledSmsFactors: enrolledSmsFactors.map(f => ({
          uid: f.uid,
          displayName: f.displayName || '',
          phoneNumber: f.phoneNumber || '',
          enrollmentTime: f.enrollmentTime || '',
        })),
        verifiedDevices: verifiedDevices.map(dev => ({
          deviceId: dev.deviceId,
          deviceName: dev.deviceName,
          platform: dev.platform,
          os: dev.os || '',
          browser: dev.browser || '',
          isTrusted: Boolean(dev.isTrusted),
          verificationMethod: dev.verificationMethod || 'manual',
          verifiedAt: dev.verifiedAt,
          firstSeenAt: dev.firstSeenAt || dev.verifiedAt,
          lastActiveAt: dev.lastActiveAt,
        })),
        verifiedIdentifiers,
      };

      // Local device preferences & histories
      let rescuePhone = '';
      let rescueName = '';
      try {
        rescuePhone = localStorage.getItem('tyt_rescue_phone_v1') || '';
        rescueName = localStorage.getItem('tyt_rescue_name_v1') || '';
      } catch {
        // ignore storage error
      }

      const devicePreferences = {
        deviceId,
        theme: isDarkMode ? 'dark' : 'light',
        notificationEnabled: notifEnabled,
        locationEnabled: locationPref,
        rescuePhone,
        rescueName,
        localFeedbackHistory: loadScopedLocalFeedbackHistory(uid || null, deviceId),
        localNearbyFacilityHistory: loadLocalNearbyFacilityHistory(uid || null, deviceId),
      };

      // Owner-scoped Firestore activity (only queries allowed by firestore.rules)
      let appointments: any[] = [];
      let feedback: any[] = [];
      let rescueSignals: any[] = [];
      let nearbyFacilities: any[] = [];

      if (uid) {
        const [apptRes, fbRes, sosRes, facRes] = await Promise.allSettled([
          getDocs(query(collection(db, 'appointments'), where('userUid', '==', uid))),
          getDocs(query(collection(db, 'feedback'), where('uid', '==', uid))),
          getDocs(query(collection(db, 'rescueSignals'), where('uid', '==', uid))),
          getDocs(query(collection(db, 'nearbyFacilities'), where('submittedByUid', '==', uid))),
        ]);
        if (apptRes.status === 'fulfilled') {
          appointments = apptRes.value.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        if (fbRes.status === 'fulfilled') {
          feedback = fbRes.value.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        if (sosRes.status === 'fulfilled') {
          rescueSignals = sosRes.value.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        if (facRes.status === 'fulfilled') {
          nearbyFacilities = facRes.value.docs.map(d => ({ id: d.id, ...d.data() }));
        }
      }

      const userActivity = {
        appointments,
        feedback,
        rescueSignals,
        nearbyFacilities,
      };

      const payload = {
        type: 'TYT_PERSONAL_PROFILE_BACKUP',
        version: '3.0',
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser?.email || 'NguoiDung',
        identity: identityData,
        securityVerification,
        devicePreferences,
        userActivity,
        data: identityData,
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (identityData.citizenId || identityData.displayName || 'ca_nhan').replace(/[^a-zA-Z0-9]/g, '_');
      a.download = `sao_luu_ca_nhan_toan_dien_${safeName}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(
        'success',
        'Đã tải tệp sao lưu cá nhân toàn diện',
        `Gồm Định danh Y tế, Bảo mật/Xác minh, ${appointments.length} lịch hẹn, ${feedback.length} phản ánh, ${rescueSignals.length} SOS & tuỳ chọn thiết bị.`
      );
    } catch (err: any) {
      showToast('error', 'Lỗi xuất tệp sao lưu', err?.message);
    }
  };

  const handleImportPersonalBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (personalBackupInputRef.current) personalBackupInputRef.current.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => showToast('error', 'Không thể đọc tệp sao lưu');
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        const parsed = JSON.parse(text);
        const data = parsed.identity || parsed.data || parsed.profile || parsed;
        const sec = parsed.securityVerification || parsed.security || null;
        const devPrefs = parsed.devicePreferences || null;
        const activity = parsed.userActivity || null;
        if (!data || typeof data !== 'object') {
          showToast('error', 'Tệp sao lưu không đúng định dạng', 'Không tìm thấy dữ liệu hồ sơ cá nhân.');
          return;
        }

        let pCode = data.provinceCode || '';
        let pName = data.provinceName || '';
        if (provincesList.length > 0) {
          if (pCode && !pName) {
            const found = provincesList.find(p => p.province_code === pCode);
            if (found) pName = found.name;
          } else if (!pCode && pName) {
            const found = provincesList.find(p => p.name === pName || p.short_name === pName);
            if (found) pCode = found.province_code;
          }
        }
        let wCode = data.wardCode || '';
        let wName = data.wardName || '';
        if (pCode && provincesList.length > 0) {
          const p = provincesList.find(item => item.province_code === pCode);
          if (p) {
            if (wCode && !wName) {
              const w = p.wards.find(item => item.ward_code === wCode);
              if (w) wName = w.name;
            } else if (!wCode && wName) {
              const w = p.wards.find(item => item.name === wName);
              if (w) wCode = w.ward_code;
            }
          }
        }

        const restoredForm: Partial<UserProfile> = {
          displayName: data.displayName || profileForm.displayName || '',
          phoneNumber: data.phoneNumber || profileForm.phoneNumber || '',
          citizenId: data.citizenId || profileForm.citizenId || '',
          dob: data.dob || profileForm.dob || '',
          gender: data.gender || profileForm.gender || 'Nam',
          ethnicity: data.ethnicity || profileForm.ethnicity || 'Kinh',
          provinceCode: pCode,
          provinceName: pName,
          wardCode: wCode,
          wardName: wName,
          address: data.address || profileForm.address || '',
          department: data.department || profileForm.department || '',
          position: data.position || profileForm.position || '',
          qualification: data.qualification || profileForm.qualification || '',
          avatarUrl: data.avatarUrl || profileForm.avatarUrl || '',
          ...(typeof data.notes === 'string' && data.notes ? { notes: data.notes } : {}),
        };

        setProfileForm(restoredForm);
        setIdentityExpanded(true);
        setEditingProfile(true);

        const restoredParts: string[] = [];

        // Restore local device preferences & offline histories
        if (devPrefs && typeof devPrefs === 'object') {
          try {
            if (devPrefs.theme === 'dark' || devPrefs.theme === 'light') {
              const nextDark = devPrefs.theme === 'dark';
              setIsDarkMode(nextDark);
              document.documentElement.classList.toggle('dark', nextDark);
              localStorage.setItem('tyt_theme', devPrefs.theme);
            }
            if (typeof devPrefs.locationEnabled === 'boolean') {
              setLocationPref(devPrefs.locationEnabled);
              localStorage.setItem(LOCATION_PREF_KEY, devPrefs.locationEnabled ? 'true' : 'false');
            }
            if (typeof devPrefs.rescuePhone === 'string' && devPrefs.rescuePhone) {
              localStorage.setItem('tyt_rescue_phone_v1', devPrefs.rescuePhone);
            }
            if (typeof devPrefs.rescueName === 'string' && devPrefs.rescueName) {
              localStorage.setItem('tyt_rescue_name_v1', devPrefs.rescueName);
            }
            if (Array.isArray(devPrefs.localFeedbackHistory) && devPrefs.localFeedbackHistory.length > 0) {
              const existingFb = loadLocalFeedbackHistory();
              const existingCodes = new Set(existingFb.map(i => i.code?.toUpperCase()));
              const mergedFb: LocalFeedbackHistoryItem[] = [...existingFb];
              for (const entry of devPrefs.localFeedbackHistory) {
                if (entry && entry.code && !existingCodes.has(String(entry.code).toUpperCase())) {
                  mergedFb.push(entry);
                  existingCodes.add(String(entry.code).toUpperCase());
                }
              }
              saveLocalFeedbackHistory(mergedFb);
            }
            if (Array.isArray(devPrefs.localNearbyFacilityHistory)) {
              for (const fac of devPrefs.localNearbyFacilityHistory) {
                if (fac && fac.id) upsertLocalNearbyFacilityHistory(fac);
              }
            }
            restoredParts.push('Tuỳ chọn thiết bị & Lịch sử cục bộ');
          } catch {
            // non-blocking local storage restore
          }
        }

        try {
          await updateProfileData(restoredForm);
          restoredParts.unshift('Định danh Y tế cá nhân');

          const isSameUid =
            currentUser?.uid && (!data.uid || data.uid === currentUser.uid);

          if (currentUser?.uid && isSameUid && sec && typeof sec === 'object') {
            if (Array.isArray(sec.verifiedDevices) && sec.verifiedDevices.length > 0) {
              let deviceRestoredCount = 0;
              for (const dev of sec.verifiedDevices) {
                const devId =
                  typeof dev?.deviceId === 'string' && dev.deviceId.trim()
                    ? dev.deviceId.trim()
                    : '';
                if (!devId || !dev?.deviceName || !dev?.verifiedAt || !dev?.lastActiveAt) continue;
                try {
                  await setDoc(
                    doc(db, 'users', currentUser.uid, 'devices', devId),
                    cleanDataForFirestore({
                      deviceId: devId,
                      deviceName: String(dev.deviceName).slice(0, 128),
                      platform: ['mobile', 'tablet', 'desktop'].includes(dev.platform)
                        ? dev.platform
                        : 'desktop',
                      isTrusted: Boolean(dev.isTrusted),
                      verifiedAt: String(dev.verifiedAt).slice(0, 64),
                      lastActiveAt: String(dev.lastActiveAt).slice(0, 64),
                      ...(typeof dev.os === 'string' && dev.os ? { os: dev.os.slice(0, 64) } : {}),
                      ...(typeof dev.browser === 'string' && dev.browser
                        ? { browser: dev.browser.slice(0, 64) }
                        : {}),
                      ...(dev.verificationMethod ? { verificationMethod: dev.verificationMethod } : {}),
                      ...(typeof dev.firstSeenAt === 'string' && dev.firstSeenAt
                        ? { firstSeenAt: dev.firstSeenAt.slice(0, 64) }
                        : {}),
                    }),
                    { merge: true }
                  );
                  deviceRestoredCount++;
                } catch {
                  // skip invalid device entry
                }
              }
              if (deviceRestoredCount > 0) {
                restoredParts.push(`${deviceRestoredCount} thiết bị tin cậy`);
              }
            }

            if (
              !twoFactorEnabled &&
              sec.totpSecurity &&
              sec.totpSecurity.enabled &&
              typeof sec.totpSecurity.secret === 'string' &&
              sec.totpSecurity.secret.length >= 16
            ) {
              try {
                const nowIso = new Date().toISOString();
                await setDoc(doc(db, 'users', currentUser.uid, 'security', 'totp'), {
                  enabled: true,
                  secret: sec.totpSecurity.secret,
                  recoveryCodes: Array.isArray(sec.totpSecurity.recoveryCodes)
                    ? sec.totpSecurity.recoveryCodes.slice(0, 12)
                    : [],
                  issuer: sec.totpSecurity.issuer || settings.stationName || 'Tram Y Te',
                  verifiedAt: sec.totpSecurity.verifiedAt || nowIso,
                  updatedAt: nowIso,
                });
                await updateProfileData({
                  twoFactorEnabled: true,
                  twoFactorUpdatedAt: nowIso,
                });
                restoredParts.push('Khoá 2FA Authenticator');
              } catch {
                // ignore if TOTP secret violates validation
              }
            }
          }

          if (currentUser?.uid && isSameUid && activity && typeof activity === 'object') {
            if (Array.isArray(activity.appointments) && activity.appointments.length > 0) {
              let restoredAppts = 0;
              for (const appt of activity.appointments) {
                if (!appt?.id || !appt?.fullName || !appt?.phone || !appt?.serviceName) continue;
                try {
                  const apptRef = doc(db, 'appointments', String(appt.id));
                  const existingSnap = await getDoc(apptRef);
                  if (!existingSnap.exists()) {
                    const { id: _ignoreId, ...apptBody } = appt;
                    await setDoc(
                      apptRef,
                      cleanDataForFirestore({ ...apptBody, userUid: currentUser.uid })
                    );
                    restoredAppts++;
                  }
                } catch {
                  // skip disallowed/invalid appointment
                }
              }
              if (restoredAppts > 0) {
                restoredParts.push(`${restoredAppts} lịch hẹn`);
              }
            }
          }

          try {
            await refreshCurrentUserState();
          } catch {
            // non-blocking
          }

          showToast(
            'success',
            'Khôi phục dữ liệu cá nhân thành công',
            `Đã phục hồi: ${restoredParts.join(', ')} cho ${restoredForm.displayName || 'người dùng'}.`
          );
        } catch {
          showToast('info', 'Đã nạp dữ liệu từ tệp sao lưu', 'Nhấn "Lưu định danh" để cập nhật lên hệ thống.');
        }
      } catch {
        showToast('error', 'Lỗi tệp sao lưu', 'Tệp JSON bị lỗi cú pháp hoặc không hợp lệ.');
      }
    };
    reader.readAsText(file);
  };

  const handleCopyProfileSummary = () => {
    const p = userProfile || profileForm;
    const addr = [p.address, p.wardName, p.provinceName].filter(Boolean).join(', ');
    const displayCccd = userProfile?.citizenIdVerified
      ? maskVerifiedValue(p.citizenId, 'cccd')
      : p.citizenId || 'Chưa cập nhật';
    const rawPhone = userProfile?.verifiedPhone || p.phoneNumber;
    const displayPhone =
      userProfile?.phoneVerified || hasPhoneDone
        ? maskVerifiedValue(rawPhone, 'phone')
        : rawPhone || 'Chưa cập nhật';
    const cardText = [
      `THẺ ĐỊNH DANH Y TẾ CÁ NHÂN`,
      `Họ và tên: ${p.displayName || 'Chưa cập nhật'}`,
      `Số CCCD: ${displayCccd}`,
      `Số điện thoại: ${displayPhone}`,
      `Ngày sinh: ${p.dob || 'Chưa cập nhật'} - Giới tính: ${p.gender || 'Nam'}`,
      `Dân tộc: ${p.ethnicity || 'Kinh'}`,
      `Tỉnh/Thành phố: ${p.provinceName || 'Chưa cập nhật'}`,
      `Xã/Phường: ${p.wardName || 'Chưa cập nhật'}`,
      `Địa chỉ cư trú: ${addr || 'Chưa cập nhật'}`,
      p.department || p.position ? `Chức danh / Khoa phòng: ${[p.position, p.department].filter(Boolean).join(' · ')}` : '',
    ].filter(Boolean).join('\n');

    try {
      navigator.clipboard.writeText(cardText);
      setCopiedCard(true);
      setTimeout(() => setCopiedCard(false), 2000);
      showToast('success', 'Đã sao chép thông tin thẻ định danh');
    } catch {
      showToast('error', 'Không thể sao chép');
    }
  };

  const syncPushIdentity = async () => {
    const deviceId = getOrCreateDeviceId();
    const res = await subscribeDeviceToWebPush({
      uid: currentUser?.uid,
      citizenId: userProfile?.citizenId,
      phoneNumber: userProfile?.phoneNumber,
      department: userProfile?.department,
    });
    if (res.ok && res.subscription) {
      const subJson = res.subscription.toJSON();
      await savePushSubscriptionRecord({
        deviceId,
        endpoint: subJson.endpoint || res.subscription.endpoint || '',
        keys: {
          p256dh: subJson.keys?.p256dh || '',
          auth: subJson.keys?.auth || '',
        },
        uid: currentUser?.uid,
        citizenId: userProfile?.citizenId,
        phoneNumber: userProfile?.phoneNumber,
        department: userProfile?.department,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    return res;
  };

  // Auth handlers
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = autoCompleteGmail(email);
    setEmail(cleanEmail);
    if (!isValidEmailAddress(cleanEmail)) {
      showToast('warning', 'Email không hợp lệ', 'Vui lòng nhập đúng tên tài khoản Gmail hoặc địa chỉ email.');
      return;
    }
    setSubmitting(true);
    try {
      const status = await loginWithEmail(cleanEmail, password, rememberMe);
      try {
        if (rememberMe) {
          localStorage.setItem(
            REMEMBERED_LOGIN_KEY,
            JSON.stringify({ email: cleanEmail, password, remember: true })
          );
        } else {
          localStorage.removeItem(REMEMBERED_LOGIN_KEY);
        }
      } catch {
        // ignore storage error
      }
      if (status === 'mfa_required') {
        showToast(
          'info',
          'Bước 2/2: Xác thực OTP SMS',
          'Nhập mã OTP gửi tới số điện thoại đã liên kết.'
        );
        return;
      }
      showToast('success', 'Đăng nhập thành công', cleanEmail);
    } catch (err: any) {
      showToast('error', 'Đăng nhập thất bại', err?.message || 'Vui lòng kiểm tra lại thông tin');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) {
      showToast('warning', 'Thiếu họ và tên');
      return;
    }
    const cleanEmail = autoCompleteGmail(email);
    setEmail(cleanEmail);
    if (!isValidEmailAddress(cleanEmail)) {
      showToast('warning', 'Email không hợp lệ', 'Vui lòng nhập Gmail hoặc địa chỉ email hợp lệ.');
      return;
    }
    const trimmedPhone = regPhone.trim();
    if (trimmedPhone && !normalizeAndValidatePhone(trimmedPhone)) {
      showToast('warning', 'Số điện thoại không hợp lệ', 'Số điện thoại bắt buộc phải gồm đúng 10 chữ số (VD: 0912345678).');
      return;
    }
    if (password.length < 6) {
      showToast('warning', 'Mật khẩu tối thiểu 6 ký tự');
      return;
    }
    if (password !== regConfirmPassword) {
      showToast('warning', 'Mật khẩu xác nhận không khớp');
      return;
    }
    setSubmitting(true);
    try {
      await registerWithEmail(
        cleanEmail,
        password,
        regName.trim(),
        trimmedPhone || undefined,
        referralCode.trim() || undefined
      );
      setAuthMode('login');
      setRegConfirmPassword('');
      showToast(
        'success',
        'Đăng ký thành công!',
        'Hãy xác minh Gmail và xác nhận Số điện thoại ở mục Bảo mật bên dưới.'
      );
    } catch (err: any) {
      const msg = String(err?.code || err?.message || '');
      if (msg.includes('email-already-in-use')) {
        showToast('error', 'Email đã được đăng ký', 'Vui lòng đăng nhập hoặc dùng email khác.');
      } else {
        showToast('error', 'Đăng ký thất bại', err?.message || 'Vui lòng thử lại.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyAndLockPhone = async (rawValue?: string) => {
    const target = (rawValue ?? profileForm.phoneNumber ?? userProfile?.phoneNumber ?? '').trim();
    if (!target) {
      showToast('warning', 'Vui lòng nhập số điện thoại trước');
      return;
    }
    setLockingPhone(true);
    try {
      await confirmAndLockPhoneNumber(target);
      showToast(
        'success',
        'Đã xác nhận & khoá số điện thoại',
        'Số điện thoại đã được gắn duy nhất cho tài khoản.'
      );
    } catch (err: any) {
      showToast('error', 'Không thể xác nhận số điện thoại', err?.message);
    } finally {
      setLockingPhone(false);
    }
  };

  const handleConfirmMatchedCitizenIdentity = async () => {
    if (!matchedCitizenRecord) return;
    const targetDigits =
      matchedCitizenRecord.rawLookupDigits ||
      matchedCitizenRecord.citizenId.replace(/\D/g, '') ||
      (profileForm.citizenId || '').replace(/\D/g, '');
    if (targetDigits.length < 9) {
      showToast('error', 'Số CCCD không hợp lệ');
      return;
    }
    setLockingCccd(true);
    try {
      let fullRecord = matchedCitizenRecord;
      if (
        matchedCitizenRecord.isMasked ||
        matchedCitizenRecord.displayName.startsWith('****') ||
        matchedCitizenRecord.gender === '****'
      ) {
        const idToken = await currentUser?.getIdToken().catch(() => null);
        const confirmRes = await lookupCitizenByCccd(targetDigits, {
          idToken,
          action: 'confirm',
        });
        if (!confirmRes.found || !confirmRes.record) {
          throw new Error('Không thể xác thực thông tin công dân từ cơ sở dữ liệu CCCD.');
        }
        const parsedAddr = parseAddressIntoAdministrativeParts(
          confirmRes.record.fullAddress,
          provincesList
        );
        fullRecord = {
          ...confirmRes.record,
          ...parsedAddr,
          rawLookupDigits: targetDigits,
          isMasked: false,
        };
      }

      const verifiedGender: 'Nam' | 'Nữ' | 'Khác' =
        fullRecord.gender === 'Nữ' ? 'Nữ' : fullRecord.gender === 'Khác' ? 'Khác' : 'Nam';

      await verifyAndLockCitizenId(fullRecord.citizenId, {
        displayName: fullRecord.displayName,
        dob: fullRecord.dob,
        gender: verifiedGender,
        provinceCode: fullRecord.provinceCode,
        provinceName: fullRecord.provinceName,
        wardCode: fullRecord.wardCode,
        wardName: fullRecord.wardName,
        address: fullRecord.address || fullRecord.fullAddress,
      });
      setMatchedCitizenRecord(null);
      setCccdLookupStatus('idle');
      setCccdLookupMessage(null);
      setEditingProfile(false);
      showToast(
        'success',
        'Đã xác minh & khóa thông tin định danh',
        'Thông tin định danh đã được xác thực và bảo vệ.'
      );
    } catch (err: any) {
      showToast('error', 'Không thể xác nhận & khóa thông tin', err?.message);
    } finally {
      setLockingCccd(false);
    }
  };

  const handleVerifyAndLockCccd = async (rawValue?: string) => {
    const target = (rawValue ?? profileForm.citizenId ?? userProfile?.citizenId ?? '').trim();
    if (!target) {
      showToast('warning', 'Vui lòng nhập số CCCD trước');
      return;
    }

    const targetDigits = target.replace(/\D/g, '');
    if (
      matchedCitizenRecord &&
      (matchedCitizenRecord.rawLookupDigits === targetDigits ||
        matchedCitizenRecord.citizenId === targetDigits)
    ) {
      await handleConfirmMatchedCitizenIdentity();
      return;
    }

    setLockingCccd(true);
    try {
      const idToken = await currentUser?.getIdToken().catch(() => null);
      const lookup = await lookupCitizenByCccd(targetDigits, { idToken, action: 'lookup' });
      if (lookup.found && lookup.record) {
        const shouldMask = Boolean(lookup.isMasked || !canViewFullIdentity);
        lastLookedUpCccdRef.current = targetDigits;
        if (shouldMask) {
          setMatchedCitizenRecord({
            citizenId: maskVerifiedValue(lookup.record.citizenId || targetDigits, 'cccd'),
            displayName: lookup.record.displayName.startsWith('****')
              ? lookup.record.displayName
              : maskNameForLookup(lookup.record.displayName),
            dob: lookup.record.dob,
            dobRaw: lookup.record.dobRaw,
            gender: '****',
            permanentAddress: maskAddressForLookup(lookup.record.permanentAddress),
            currentAddress: maskAddressForLookup(lookup.record.currentAddress),
            fullAddress: lookup.record.fullAddress.startsWith('****')
              ? lookup.record.fullAddress
              : maskAddressForLookup(lookup.record.fullAddress),
            provinceCode: '',
            provinceName: '',
            wardCode: '',
            wardName: '',
            address: '',
            rawLookupDigits: targetDigits,
            isMasked: true,
          });
          setProfileForm(prev => ({
            ...prev,
            citizenId: targetDigits,
            dob: lookup.record!.dob || prev.dob,
          }));
        } else {
          const parsedAddr = parseAddressIntoAdministrativeParts(
            lookup.record.fullAddress,
            provincesList
          );
          setMatchedCitizenRecord({
            ...lookup.record,
            ...parsedAddr,
            rawLookupDigits: targetDigits,
            isMasked: false,
          });
          setProfileForm(prev => ({
            ...prev,
            citizenId: lookup.record!.citizenId,
            displayName: lookup.record!.displayName,
            dob: lookup.record!.dob,
            gender: lookup.record!.gender === '****' ? 'Nam' : lookup.record!.gender,
            provinceCode: parsedAddr.provinceCode,
            provinceName: parsedAddr.provinceName,
            wardCode: parsedAddr.wardCode,
            wardName: parsedAddr.wardName,
            address: parsedAddr.address,
          }));
        }
        setCccdLookupStatus('found');
        setCccdLookupMessage(
          'Tìm thấy thông tin công dân trong cơ sở dữ liệu. Vui lòng kiểm tra kỹ và nhấn "Xác nhận đúng thông tin & Khóa hồ sơ".'
        );
        setIdentityExpanded(true);
        setEditingProfile(true);
        showToast(
          'info',
          'Vui lòng kiểm tra & xác nhận thông tin',
          'Nhấn "Xác nhận đúng thông tin & Khóa hồ sơ" để hoàn tất.'
        );
        return;
      }

      if (!profileForm.displayName?.trim()) {
        setIdentityExpanded(true);
        setEditingProfile(true);
        showToast(
          'warning',
          'Vui lòng nhập đầy đủ thông tin trước khi khóa',
          'Hãy nhập Họ và tên, Ngày sinh, Giới tính, Địa chỉ trước khi xác minh & khóa hồ sơ.'
        );
        return;
      }

      await updateProfileData(profileForm);
      await verifyAndLockCitizenId(target);
      showToast('success', 'Đã xác minh & khoá toàn bộ hồ sơ', 'Số CCCD và thông tin định danh đã được khóa cho tài khoản.');
    } catch (err: any) {
      showToast('error', 'Không thể xác minh CCCD', err?.message);
    } finally {
      setLockingCccd(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    try {
      const status = await signInWithGoogle();
      if (status === 'mfa_required') {
        showToast(
          'info',
          'Bước 2/2: Xác thực OTP qua tin nhắn SMS',
          'Vui lòng nhận và nhập mã OTP gửi tới số điện thoại đã liên kết.'
        );
        return;
      }
      showToast('success', 'Đăng nhập Google thành công');
    } catch (err: any) {
      showToast('error', 'Đăng nhập Google thất bại', formatFirebaseGoogleAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendUnauthPasswordReset = async () => {
    const clean = autoCompleteGmail(resetEmail);
    setResetEmail(clean);
    if (!clean) {
      showToast('warning', 'Thiếu địa chỉ email', 'Vui lòng nhập Gmail / email tài khoản của bạn.');
      return;
    }
    setSendingReset(true);
    try {
      const check = await verifyUnauthenticatedPasswordResetIdentity({
        email: clean,
        phone: resetPhone,
        cccd: resetCccd,
      });
      if (!check.ok) {
        showToast('error', 'Thông tin đối chiếu chưa khớp', check.error || 'Vui lòng kiểm tra lại.');
        return;
      }
      await sendPasswordReset(check.normalizedEmail);
      setResetSentTo(maskVerifiedValue(check.normalizedEmail, 'email'));
      showToast(
        'success',
        'Đã gửi liên kết đặt lại mật khẩu',
        'Kiểm tra hộp thư Gmail hoặc thư mục Spam.'
      );
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('user-not-found')) {
        showToast('error', 'Không tìm thấy tài khoản', 'Email này chưa được đăng ký.');
      } else {
        showToast('error', 'Không thể gửi email', msg || 'Vui lòng thử lại sau.');
      }
    } finally {
      setSendingReset(false);
    }
  };

  const handleVerifiedSignedInPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.email) return;

    const inputEmail = autoCompleteGmail(resetCheckEmail).toLowerCase();
    setResetCheckEmail(inputEmail);
    if (inputEmail !== currentUser.email.toLowerCase()) {
      showToast('error', 'Email chưa khớp', 'Vui lòng nhập chính xác địa chỉ Email / Gmail của tài khoản.');
      return;
    }

    const expectedPhone = normalizeAndValidatePhone(
      userProfile?.verifiedPhone || userProfile?.phoneNumber || ''
    );
    const expectedCccd = (userProfile?.citizenId || '').replace(/\D/g, '');
    const expectedName = (userProfile?.displayName || currentUser.displayName || '').trim().toLowerCase();

    const phoneInputNorm = resetCheckPhone.trim()
      ? normalizeAndValidatePhone(resetCheckPhone.trim())
      : '';
    const cccdInputDigits = resetCheckCccd.replace(/\D/g, '');
    const nameInputNorm = resetCheckName.trim().toLowerCase();

    if (expectedPhone && resetCheckPhone.trim() && phoneInputNorm !== expectedPhone) {
      showToast('error', 'Số điện thoại chưa khớp', 'Số điện thoại nhập vào không trùng với hồ sơ.');
      return;
    }
    if (expectedCccd && cccdInputDigits && cccdInputDigits !== expectedCccd) {
      showToast('error', 'Số CCCD chưa khớp', 'Số CCCD nhập vào không trùng với hồ sơ.');
      return;
    }

    const phoneMatched = Boolean(expectedPhone && phoneInputNorm && phoneInputNorm === expectedPhone);
    const cccdMatched = Boolean(expectedCccd && cccdInputDigits && cccdInputDigits === expectedCccd);
    const nameMatched = Boolean(expectedName && nameInputNorm && nameInputNorm === expectedName);

    if (expectedPhone || expectedCccd) {
      if (!phoneMatched && !cccdMatched) {
        showToast(
          'warning',
          'Thiếu thông tin xác minh bổ sung',
          'Vui lòng nhập chính xác Số điện thoại hoặc Số CCCD đã lưu trên tài khoản để xác nhận.'
        );
        return;
      }
    } else if (expectedName && !nameMatched) {
      showToast(
        'warning',
        'Thiếu họ và tên xác minh',
        'Vui lòng nhập chính xác Họ và tên tài khoản để xác nhận trước khi gửi liên kết.'
      );
      return;
    }

    setSendingReset(true);
    try {
      await sendPasswordReset(currentUser.email);
      setResetSentTo(maskVerifiedValue(currentUser.email, 'email'));
      setResetGateOpen(false);
      setResetCheckEmail('');
      setResetCheckPhone('');
      setResetCheckCccd('');
      setResetCheckName('');
      showToast(
        'success',
        'Đã gửi liên kết đặt lại mật khẩu',
        'Kiểm tra hộp thư Gmail hoặc thư mục Spam.'
      );
    } catch (err: any) {
      showToast('error', 'Không thể gửi email', err?.message || 'Vui lòng thử lại sau.');
    } finally {
      setSendingReset(false);
    }
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSavingAvatar(true);
    try {
      const dataUrl = await compressImageToAvatarDataUrl(file);
      setProfileForm(prev => ({ ...prev, avatarUrl: dataUrl }));
      await updateProfileData({ avatarUrl: dataUrl });
      showToast('success', 'Đã cập nhật ảnh đại diện', 'Ảnh đại diện mới đã được lưu vào hồ sơ.');
    } catch (err: any) {
      showToast('error', 'Lỗi xử lý ảnh', err?.message);
    } finally {
      setSavingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProfileLocked) {
      showToast(
        'warning',
        'Thông tin định danh đang bị khóa',
        'Vui lòng liên hệ Quản trị viên để mở khóa chỉnh sửa thông tin.'
      );
      return;
    }
    if (matchedCitizenRecord && !userProfile?.citizenIdVerified && !allowIdentityEditByAdmin) {
      await handleConfirmMatchedCitizenIdentity();
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfileData(profileForm);
      if (notificationStatus === 'granted' && notifEnabled) {
        await subscribeDeviceToWebPush({
          uid: currentUser?.uid,
          citizenId: profileForm.citizenId,
          phoneNumber: profileForm.phoneNumber,
          department: profileForm.department,
        });
      }
      setMatchedCitizenRecord(null);
      setEditingProfile(false);
      showToast('success', 'Đã lưu hồ sơ định danh', 'Thông tin cá nhân đã được đồng bộ.');
    } catch (err: any) {
      showToast('error', 'Cập nhật thất bại', err?.message);
    } finally {
      setSavingProfile(false);
    }
  };

  // Device handlers
  const handleToggleNotifPref = async () => {
    const next = !notifEnabled;
    setSyncingPush(true);
    try {
      if (next) {
        let granted = notificationStatus === 'granted';
        if (!granted) {
          granted = await requestNotification();
        }
        if (!granted) {
          showToast('warning', 'Chưa cấp quyền thông báo', 'Vui lòng cho phép thông báo trên trình duyệt.');
          return;
        }
        setNotifEnabled(true);
        setDeviceNotificationEnabled(true);
        await syncPushIdentity();
        showToast('success', 'Đã bật thông báo nền', 'Thiết bị sẽ nhận tin ngay cả khi đóng ứng dụng.');
      } else {
        setNotifEnabled(false);
        setDeviceNotificationEnabled(false);
        await unsubscribeDeviceFromWebPush();
        await deletePushSubscriptionRecord(getOrCreateDeviceId());
        showToast('info', 'Đã tắt thông báo thiết bị');
      }
    } finally {
      setSyncingPush(false);
    }
  };

  const handleRequestNotification = async () => {
    setSyncingPush(true);
    try {
      const granted = await requestNotification();
      if (granted) {
        setNotifEnabled(true);
        setDeviceNotificationEnabled(true);
        await syncPushIdentity();
        showToast('success', 'Đã kết nối thông báo nền', 'Thiết bị đã sẵn sàng nhận thông báo mọi lúc.');
      } else {
        showToast('warning', 'Chưa thể bật Thông báo', 'Kiểm tra quyền thông báo của trình duyệt.');
      }
    } finally {
      setSyncingPush(false);
    }
  };

  const handleTestNotification = async () => {
    setTestingNotif(true);
    try {
      let granted = notificationStatus === 'granted';
      if (!granted) {
        granted = await requestNotification();
      }
      if (!granted) {
        showToast('warning', 'Chưa có quyền Thông báo', 'Vui lòng chọn Cho phép khi trình duyệt hỏi.');
        return;
      }
      const ok = await sendTestBackgroundPush(settings.stationName || 'Trạm Y Tế');
      showToast(
        'success',
        'Đã gửi thông báo thử nghiệm',
        ok ? 'Kiểm tra khay thông báo của thiết bị.' : ''
      );
    } finally {
      setTestingNotif(false);
    }
  };

  const handleRequestLocation = async () => {
    setLocating(true);
    try {
      const coords = await requestLocation();
      if (coords) {
        setLocationPref(true);
        try {
          localStorage.setItem(LOCATION_PREF_KEY, 'true');
        } catch {
          // ignore
        }
        showToast('success', 'Đã cập nhật tọa độ GPS', `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
      } else {
        showToast('warning', 'Không thể lấy vị trí', 'Kiểm tra GPS hoặc quyền vị trí trên thiết bị.');
      }
    } finally {
      setLocating(false);
    }
  };

  const handleToggleLocationPref = () => {
    const next = !locationPref;
    setLocationPref(next);
    try {
      localStorage.setItem(LOCATION_PREF_KEY, next ? 'true' : 'false');
    } catch {
      // ignore
    }
    showToast('info', next ? 'Đã bật tự động định vị GPS' : 'Đã tắt tự động gợi ý vị trí');
  };

  const handleSharePortal = async () => {
    const title =
      settings.stationName && !settings.stationName.includes('Chưa cấu hình')
        ? settings.stationName
        : 'Cổng Thông Tin Trạm Y Tế';
    const text = `${title} - Lịch tiêm chủng, lịch trực 24/7 và bản đồ GPS.`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url: window.location.origin });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(window.location.origin);
      showToast('success', 'Đã sao chép liên kết ứng dụng');
    } catch {
      showToast('info', 'Không thể sao chép tự động');
    }
  };

  const handleInstallPwa = async () => {
    if (isInstallable) {
      await install();
    } else if (isInstalled) {
      showToast('success', 'Ứng dụng đã được cài trên màn hình chính');
    } else if (isIOS) {
      showToast('info', 'Cài trên iPhone/iPad', 'Mở bằng Safari -> Chia sẻ -> Thêm vào Màn hình chính.');
    } else {
      showToast('info', 'Cài đặt ứng dụng', 'Mở Menu trình duyệt (⋮) -> Thêm vào màn hình chính.');
    }
  };

  const stations = settings.mapLocations || [];
  const nearestStation =
    userCoords && stations.length > 0
      ? [...stations]
          .map(loc => ({
            ...loc,
            distanceKm: calculateHaversineDistance(userCoords.lat, userCoords.lng, loc.lat, loc.lng),
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)[0]
      : null;

  const activeAvatar = profileForm.avatarUrl || userProfile?.avatarUrl || currentUser?.photoURL || '';
  const displayName =
    userProfile?.displayName || currentUser?.displayName || currentUser?.email || 'Khách sử dụng thiết bị';
  const verificationProgress = getUserVerificationProgress(userProfile, {
    emailVerified: Boolean(currentUser?.emailVerified),
    hasGoogleProvider,
    hasPasswordProvider,
    phoneNumber: userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser?.phoneNumber,
    twoFactorEnabled,
    smsMfaEnabled,
  });
  const hasEmailDone = verificationProgress.emailDone;
  const hasPhoneDone = verificationProgress.phoneDone;
  const verificationPercent = verificationProgress.percent;
  const isFullyVerified = verificationProgress.isFullyVerified;
  const hasCitizenVerified = Boolean(userProfile?.citizenId?.trim() && (userProfile?.phoneVerified || userProfile?.phoneNumber?.trim()));

  return (
    <div className="max-w-3xl mx-auto pb-8 space-y-4 animate-in fade-in duration-200">
      {/* Mobile-App Top Profile Summary Card */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 bg-gradient-to-br from-emerald-800 via-teal-800 to-slate-900 text-white">
          <div className="flex items-center gap-3.5">
            {currentUser ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={savingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  className="relative group shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-white/80 cursor-pointer disabled:opacity-60"
                  title="Nhấn để thay đổi ảnh đại diện"
                >
                  <UserAvatar
                    src={activeAvatar}
                    name={displayName}
                    size={60}
                    isPrimaryAdmin={isPrimaryAdmin}
                    showAdminRing
                    rounded="2xl"
                  />
                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 text-white border-2 border-emerald-900 flex items-center justify-center shadow-xs group-hover:bg-emerald-400 transition">
                    <Camera className="w-3 h-3" />
                  </span>
                </button>
              </>
            ) : (
              <div className="w-[60px] h-[60px] rounded-2xl bg-white p-1.5 flex items-center justify-center shrink-0 shadow-xs">
                <StationLogo size={46} />
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight truncate">
                  {currentUser ? displayName : 'Tài khoản & Thiết bị'}
                </h1>
                {currentUser && isFullyVerified && <VerifiedBlueTick size="md" />}
              </div>

              {currentUser ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-emerald-100">
                  <span className="font-semibold">
                    {isPrimaryAdmin
                      ? 'Quản trị cấp cao'
                      : userProfile?.accountType === 'employee'
                      ? 'Cán bộ Y tế'
                      : 'Công dân'}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 min-w-0 max-w-[230px] sm:max-w-xs">
                    <span className="truncate">
                      {hasEmailDone ? maskVerifiedValue(currentUser.email, 'email') : currentUser.email}
                    </span>
                  </span>
                </div>
              ) : (
                <p className="text-xs text-emerald-100/90 leading-snug">
                  Đăng nhập, đăng ký tài khoản hoặc cấu hình thiết bị
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1 text-emerald-200">
                  {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 text-amber-300" />}
                  <span>{isOnline ? 'Trực tuyến' : 'Ngoại tuyến'}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-200">
                  <Bell className="w-3.5 h-3.5" />
                  <span>
                    {notificationStatus === 'granted' && notifEnabled ? 'Thông báo: Bật' : 'Thông báo: Tắt'}
                  </span>
                </span>
                {currentUser && (
                  <>
                    <span className="inline-flex items-center gap-1 text-emerald-200 tabular-nums">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Xác minh: {verificationProgress.completedCount}/4 ({verificationPercent}%)</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-emerald-200">
                      <Lock className="w-3.5 h-3.5" />
                      <span>
                        {hasEmailDone ? 'Gmail: Đã xác minh' : 'Gmail: Chưa xác minh'}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {currentUser && (
            <div className="mt-4 pt-3.5 border-t border-white/15 grid grid-cols-2 gap-2.5">
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setCurrentView('admin')}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  <span>Bảng quản trị</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sendingReset}
                  onClick={() => setResetGateOpen(v => !v)}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>{sendingReset ? 'Đang gửi...' : 'Đổi mật khẩu'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => logout()}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 border border-rose-300/30 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Đăng xuất</span>
              </button>
            </div>
          )}

          {currentUser && resetGateOpen && currentUser.email && (
            <form
              onSubmit={handleVerifiedSignedInPasswordReset}
              className="mt-3 p-3.5 rounded-2xl bg-slate-900/60 border border-white/20 space-y-2.5 text-xs text-white"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
                  <span>Xác minh thông tin trước khi gửi liên kết đặt lại mật khẩu</span>
                </p>
                <button
                  type="button"
                  onClick={() => setResetGateOpen(false)}
                  className="text-emerald-200 hover:text-white font-semibold cursor-pointer"
                >
                  Đóng
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  inputMode="email"
                  required
                  value={resetCheckEmail}
                  onChange={e => setResetCheckEmail(e.target.value)}
                  onBlur={() => setResetCheckEmail(v => autoCompleteGmail(v))}
                  placeholder="Nhập chính xác Gmail / Email *"
                  className="w-full px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-emerald-100/70 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                {(userProfile?.verifiedPhone || userProfile?.phoneNumber) ? (
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={resetCheckPhone}
                    onChange={e => setResetCheckPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="Số điện thoại (10 số) đã lưu"
                    className="w-full px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-emerald-100/70 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                ) : null}
                {userProfile?.citizenId ? (
                  <input
                    type="text"
                    maxLength={12}
                    value={resetCheckCccd}
                    onChange={e => setResetCheckCccd(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    placeholder="Hoặc số CCCD đã lưu"
                    className="w-full px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white font-mono placeholder:text-emerald-100/70 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                ) : null}
                {!(userProfile?.verifiedPhone || userProfile?.phoneNumber || userProfile?.citizenId) && (
                  <input
                    type="text"
                    required
                    value={resetCheckName}
                    onChange={e => setResetCheckName(e.target.value)}
                    placeholder="Họ và tên đã đăng ký *"
                    className="w-full px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-emerald-100/70 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sendingReset}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingReset ? 'Đang gửi...' : 'Xác nhận & Gửi liên kết'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Native-Style Segmented Control */}
        <div className="p-2 bg-slate-100 dark:bg-slate-950/70 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('account')}
            className={`min-h-[42px] px-3 py-2 rounded-2xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'account'
                ? 'bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>{currentUser ? 'Hồ sơ & Xác minh' : 'Đăng nhập / Đăng ký'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('device')}
            className={`min-h-[42px] px-3 py-2 rounded-2xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === 'device'
                ? 'bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Smartphone className="w-4 h-4 shrink-0" />
            <span>Thiết bị &amp; Thông báo</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ACCOUNT & VERIFICATION */}
      {activeTab === 'account' && (
        <div className="space-y-4">
          {currentUser ? (
            <>
              {/* Grouped Summary Card (Smooth Collapsible Accordion) */}
              <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setIdentityExpanded(v => !v)}
                    aria-expanded={identityExpanded}
                    className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left cursor-pointer group"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                          Định danh y tế cá nhân
                        </h2>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {hasCitizenVerified
                          ? 'Đã hoàn thiện thông tin CCCD và số điện thoại liên lạc'
                          : 'Nhập số CCCD để tự động điền thông tin từ cơ sở dữ liệu (hoặc nhập thủ công)'}
                      </p>
                    </div>
                    <span className="p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950/50 group-hover:text-emerald-600 transition-colors shrink-0">
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-300 ease-out ${
                          identityExpanded ? 'rotate-180 text-emerald-600 dark:text-emerald-400' : ''
                        }`}
                      />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!identityExpanded || !editingProfile) {
                        setIdentityExpanded(true);
                        setEditingProfile(true);
                      } else {
                        setEditingProfile(false);
                      }
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {identityExpanded && editingProfile ? 'Thu gọn' : isProfileLocked ? 'Xem chi tiết' : 'Chỉnh sửa'}
                  </button>
                </div>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                    identityExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-slate-100 dark:border-slate-800">
                {!editingProfile ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">Họ và Tên</span>
                      <span className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                        <span>
                          {shouldMaskLockedProfileFields
                            ? maskNameForLookup(userProfile?.displayName)
                            : userProfile?.displayName || currentUser?.displayName || 'Chưa cập nhật'}
                        </span>
                        {isFullyVerified && <VerifiedBlueTick size="xs" />}
                      </span>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">Số CCCD / VNeID</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                          {userProfile?.citizenIdVerified && !canViewFullIdentity
                            ? maskVerifiedValue(userProfile.citizenId, 'cccd')
                            : userProfile?.citizenId || 'Chưa cập nhật'}
                        </span>
                        {userProfile?.citizenIdVerified && !isSuperAdmin ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            <Lock className="w-3 h-3" />
                            Đã xác minh
                          </span>
                        ) : userProfile?.citizenId && userProfile.citizenId.replace(/\D/g, '').length >= 9 && !userProfile?.citizenIdVerified ? (
                          <button
                            type="button"
                            disabled={lockingCccd}
                            onClick={() => void handleVerifyAndLockCccd(userProfile.citizenId)}
                            className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer disabled:opacity-50"
                          >
                            {lockingCccd ? 'Đang xử lý...' : 'Xác minh & Khoá'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">Số điện thoại</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                          {hasPhoneDone && !canViewFullIdentity
                            ? maskVerifiedValue(userProfile?.verifiedPhone || userProfile?.phoneNumber, 'phone')
                            : userProfile?.verifiedPhone || userProfile?.phoneNumber || 'Chưa cập nhật'}
                        </span>
                        {hasPhoneDone && !isSuperAdmin ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            <Lock className="w-3 h-3" />
                            Đã xác nhận
                          </span>
                        ) : !isProfileLocked && !hasPhoneDone && userProfile?.phoneNumber && userProfile.phoneNumber.trim() ? (
                          <button
                            type="button"
                            disabled={lockingPhone}
                            onClick={() => void handleVerifyAndLockPhone(userProfile.phoneNumber)}
                            className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer disabled:opacity-50"
                          >
                            {lockingPhone ? 'Đang khoá...' : 'Xác nhận & Khoá'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">Ngày sinh &amp; Giới tính</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {shouldMaskLockedProfileFields
                          ? [userProfile?.dob, maskGenderForLookup(userProfile?.gender)].filter(Boolean).join(' · ') || 'Chưa cập nhật'
                          : [userProfile?.dob, userProfile?.gender].filter(Boolean).join(' · ') || 'Chưa cập nhật'}
                      </span>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">Dân tộc</span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {userProfile?.ethnicity || 'Kinh'}
                      </span>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium shrink-0">Tỉnh / Thành phố</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 text-right truncate max-w-[65%]">
                        {shouldMaskLockedProfileFields ? '****' : userProfile?.provinceName || 'Chưa chọn'}
                      </span>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium shrink-0">Xã / Phường / Thị trấn</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 text-right truncate max-w-[65%]">
                        {shouldMaskLockedProfileFields ? '****' : userProfile?.wardName || 'Chưa chọn'}
                      </span>
                    </div>
                    <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                      <span className="text-slate-500 dark:text-slate-400 text-xs font-medium shrink-0">Địa chỉ cư trú</span>
                      <span
                        className="font-medium text-slate-800 dark:text-slate-200 text-right truncate max-w-[65%]"
                        title={
                          shouldMaskLockedProfileFields
                            ? undefined
                            : [userProfile?.address, userProfile?.wardName, userProfile?.provinceName].filter(Boolean).join(', ')
                        }
                      >
                        {shouldMaskLockedProfileFields
                          ? maskAddressForLookup(
                              [userProfile?.address, userProfile?.wardName, userProfile?.provinceName]
                                .filter(Boolean)
                                .join(', ')
                            )
                          : [userProfile?.address, userProfile?.wardName, userProfile?.provinceName]
                              .filter(Boolean)
                              .join(', ') ||
                            userProfile?.address ||
                            'Chưa cập nhật'}
                      </span>
                    </div>
                    {(userProfile?.accountType === 'employee' || isPrimaryAdmin) && (
                      <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px]">
                        <span className="text-slate-500 dark:text-slate-400 text-xs font-medium shrink-0">Đơn vị / Chức danh</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400 text-right truncate max-w-[65%]">
                          {[userProfile?.position, userProfile?.department].filter(Boolean).join(' · ') || 'Chưa cập nhật'}
                        </span>
                      </div>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setResetGateOpen(true);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        disabled={sendingReset}
                        className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 min-h-[48px] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                          <KeyRound className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>{sendingReset ? 'Đang gửi email đặt lại mật khẩu...' : 'Gửi email đặt lại mật khẩu'}</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      </button>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleSaveProfile} className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">

                    <div className="col-span-full">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Số CCCD / VNeID {isCccdLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        {isCccdLocked ? (
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            <span>Đã xác minh</span>
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2.5">
                            <button
                              type="button"
                              disabled={lookingUpCccd || (profileForm.citizenId || '').replace(/\D/g, '').length < 9}
                              onClick={() => void handleLookupCccdInDatabase(profileForm.citizenId, false)}
                              className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <Search className="w-3.5 h-3.5" />
                              <span>{lookingUpCccd ? 'Đang tra cứu...' : 'Tra cứu CCCD'}</span>
                            </button>
                            {!allowIdentityEditByAdmin &&
                              profileForm.citizenId &&
                              profileForm.citizenId.replace(/\D/g, '').length >= 9 &&
                              !matchedCitizenRecord && (
                                <button
                                  type="button"
                                  disabled={lockingCccd}
                                  onClick={() => void handleVerifyAndLockCccd(profileForm.citizenId)}
                                  className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer disabled:opacity-50"
                                >
                                  {lockingCccd ? 'Đang kiểm tra...' : 'Xác minh & Khoá'}
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={handleNfcScanCccd}
                              className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                              title="Quét thẻ CCCD gắn chip qua NFC"
                            >
                              <Smartphone className="w-3.5 h-3.5" />
                              <span>Quét NFC</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="text"
                          maxLength={12}
                          readOnly={isCccdLocked}
                          disabled={isCccdLocked}
                          value={
                            isCccdLocked && userProfile?.citizenIdVerified && !canViewFullIdentity
                              ? maskVerifiedValue(profileForm.citizenId || userProfile.citizenId, 'cccd')
                              : profileForm.citizenId || ''
                          }
                          onChange={e => {
                            const val = e.target.value;
                            if (matchedCitizenRecord) {
                              setMatchedCitizenRecord(null);
                            }
                            if (cccdLookupStatus !== 'idle') {
                              setCccdLookupStatus('idle');
                              setCccdLookupMessage(null);
                            }
                            lastLookedUpCccdRef.current = '';
                            setProfileForm({ ...profileForm, citizenId: val });
                          }}
                          placeholder="Nhập số CCCD (10 hoặc 12 số) để tự động tra cứu..."
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        />
                      </div>

                      {matchedCitizenRecord && !allowIdentityEditByAdmin && !userProfile?.citizenIdVerified && (
                        <div className="mt-2.5 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 space-y-2.5 text-xs">
                          <div className="flex items-start gap-2 text-emerald-900 dark:text-emerald-200">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-bold">Đã tìm thấy thông tin công dân trong cơ sở dữ liệu CCCD</div>
                              <p className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-0.5">
                                {shouldMaskLookupPreview
                                  ? 'Thông tin tra cứu được rút gọn bảo mật (hiển thị đầy đủ Ngày sinh). Vui lòng kiểm tra và bấm Xác nhận đúng thông tin & Khóa hồ sơ.'
                                  : 'Hệ thống đã tự động điền thông tin bên dưới. Vui lòng kiểm tra đúng thông tin và bấm Xác nhận đúng thông tin & Khóa hồ sơ.'}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px]">
                            <div>
                              <span className="text-slate-500">Họ và tên: </span>
                              <strong className="text-slate-900 dark:text-white">
                                {shouldMaskLookupPreview
                                  ? maskNameForLookup(matchedCitizenRecord.displayName)
                                  : matchedCitizenRecord.displayName}
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-500">Số CCCD: </span>
                              <strong className="font-mono text-slate-900 dark:text-white">
                                {shouldMaskLookupPreview
                                  ? maskVerifiedValue(
                                      matchedCitizenRecord.rawLookupDigits || matchedCitizenRecord.citizenId,
                                      'cccd'
                                    )
                                  : matchedCitizenRecord.citizenId}
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-500">Ngày sinh: </span>
                              <strong className="text-slate-900 dark:text-white">
                                {matchedCitizenRecord.dobRaw || matchedCitizenRecord.dob}
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-500">Giới tính: </span>
                              <strong className="text-slate-900 dark:text-white">
                                {shouldMaskLookupPreview
                                  ? maskGenderForLookup(matchedCitizenRecord.gender)
                                  : matchedCitizenRecord.gender}
                              </strong>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-slate-500">Địa chỉ cụ thể: </span>
                              <strong className="text-slate-900 dark:text-white">
                                {shouldMaskLookupPreview
                                  ? matchedCitizenRecord.fullAddress.startsWith('****')
                                    ? matchedCitizenRecord.fullAddress
                                    : maskAddressForLookup(matchedCitizenRecord.fullAddress)
                                  : matchedCitizenRecord.fullAddress}
                              </strong>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={lockingCccd}
                              onClick={() => void handleConfirmMatchedCitizenIdentity()}
                              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shadow-xs"
                            >
                              <ShieldCheck className="w-4 h-4" />
                              <span>{lockingCccd ? 'Đang xác nhận & khóa...' : 'Xác nhận đúng thông tin & Khóa hồ sơ'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMatchedCitizenRecord(null);
                                setCccdLookupStatus('idle');
                                setCccdLookupMessage(null);
                                lastLookedUpCccdRef.current = '';
                                setProfileForm(prev => ({
                                  ...prev,
                                  citizenId: '',
                                  displayName: userProfile?.displayName || '',
                                  dob: userProfile?.dob || '',
                                  gender: userProfile?.gender || 'Nam',
                                  provinceCode: userProfile?.provinceCode || '',
                                  provinceName: userProfile?.provinceName || '',
                                  wardCode: userProfile?.wardCode || '',
                                  wardName: userProfile?.wardName || '',
                                  address: userProfile?.address || '',
                                }));
                              }}
                              className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              Nhập CCCD khác
                            </button>
                          </div>
                        </div>
                      )}

                      {cccdLookupStatus === 'not_found' && cccdLookupMessage && !isProfileLocked && (
                        <div className="mt-2 p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 flex items-start gap-2 text-[11px] text-sky-900 dark:text-sky-200">
                          <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                          <span>{cccdLookupMessage}</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Họ và Tên * {isCoreIdentityLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                      </label>
                      <input
                        type="text"
                        required
                        readOnly={isCoreIdentityLocked}
                        disabled={isCoreIdentityLocked}
                        value={
                          shouldMaskLookupPreview
                            ? matchedCitizenRecord!.displayName
                            : shouldMaskLockedProfileFields
                            ? maskNameForLookup(profileForm.displayName)
                            : profileForm.displayName || ''
                        }
                        onChange={e => setProfileForm({ ...profileForm, displayName: e.target.value })}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Số điện thoại (10 số) {isPhoneLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        {isPhoneLocked ? (
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            <span>{userProfile?.phoneVerified ? 'Đã xác nhận' : 'Đã khóa'}</span>
                          </span>
                        ) : !isSuperAdmin && profileForm.phoneNumber && profileForm.phoneNumber.trim() && !allowIdentityEditByAdmin ? (
                          <button
                            type="button"
                            disabled={lockingPhone}
                            onClick={() => void handleVerifyAndLockPhone(profileForm.phoneNumber)}
                            className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer disabled:opacity-50"
                          >
                            {lockingPhone ? 'Đang khoá...' : 'Xác nhận & Khoá'}
                          </button>
                        ) : null}
                      </div>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          readOnly={isPhoneLocked}
                          disabled={isPhoneLocked}
                          value={
                            isPhoneLocked && userProfile?.phoneVerified && !canViewFullIdentity
                              ? maskVerifiedValue(
                                  userProfile.verifiedPhone || profileForm.phoneNumber,
                                  'phone'
                                )
                              : profileForm.phoneNumber || ''
                          }
                          onChange={e =>
                            setProfileForm({
                              ...profileForm,
                              phoneNumber: e.target.value.replace(/\D/g, '').slice(0, 10),
                            })
                          }
                          placeholder="0912345678 (10 chữ số)"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        />
                      </div>
                    </div>

                    <div className="col-span-full grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Ngày sinh {isCoreIdentityLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        <input
                          type="date"
                          readOnly={isCoreIdentityLocked}
                          disabled={isCoreIdentityLocked}
                          value={(shouldMaskLookupPreview ? matchedCitizenRecord!.dob : profileForm.dob) || ''}
                          onChange={e => setProfileForm({ ...profileForm, dob: e.target.value })}
                          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Giới tính {isCoreIdentityLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        <select
                          disabled={isCoreIdentityLocked}
                          value={
                            shouldMaskLookupPreview || shouldMaskLockedProfileFields
                              ? '****'
                              : profileForm.gender || 'Nam'
                          }
                          onChange={e => setProfileForm({ ...profileForm, gender: e.target.value as any })}
                          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        >
                          {(shouldMaskLookupPreview || shouldMaskLockedProfileFields) && (
                            <option value="****">****</option>
                          )}
                          <option value="Nam">Nam</option>
                          <option value="Nữ">Nữ</option>
                          <option value="Khác">Khác</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Dân tộc {isProfileLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        <select
                          disabled={isProfileLocked}
                          value={profileForm.ethnicity || 'Kinh'}
                          onChange={handleEthnicityChange}
                          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        >
                          {ethnicList.length > 0 ? (
                            ethnicList.map((et, idx) => (
                              <option key={`et_${et.value}_${idx}`} value={et.label}>
                                {et.label}
                              </option>
                            ))
                          ) : (
                            <option value="Kinh">Kinh</option>
                          )}
                        </select>
                      </div>
                    </div>

                    {/* Cascading selectors for Tỉnh / Thành phố & Xã / Phường / Thị trấn */}
                    <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Tỉnh / Thành phố {isCoreIdentityLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        <select
                          disabled={isCoreIdentityLocked}
                          value={
                            shouldMaskLookupPreview || shouldMaskLockedProfileFields
                              ? '****'
                              : profileForm.provinceCode || ''
                          }
                          onChange={handleProvinceChange}
                          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        >
                          {(shouldMaskLookupPreview || shouldMaskLockedProfileFields) && (
                            <option value="****">****</option>
                          )}
                          <option value="">-- Chọn Tỉnh / Thành phố --</option>
                          {provincesList.map((p, idx) => (
                            <option key={`prov_${p.province_code}_${idx}`} value={p.province_code}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Xã / Phường / Thị trấn {isCoreIdentityLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                        </label>
                        <select
                          value={
                            shouldMaskLookupPreview || shouldMaskLockedProfileFields
                              ? '****'
                              : profileForm.wardCode || ''
                          }
                          onChange={handleWardChange}
                          disabled={isCoreIdentityLocked || !profileForm.provinceCode || availableWards.length === 0}
                          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                        >
                          {(shouldMaskLookupPreview || shouldMaskLockedProfileFields) && (
                            <option value="****">****</option>
                          )}
                          <option value="">
                            {!profileForm.provinceCode
                              ? '-- Chọn Tỉnh/Thành phố trước --'
                              : availableWards.length === 0
                              ? '-- Không có dữ liệu xã/phường --'
                              : '-- Chọn Xã / Phường / Thị trấn --'}
                          </option>
                          {availableWards.map((w, idx) => (
                            <option key={`ward_${w.ward_code}_${idx}`} value={w.ward_code}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="col-span-full">
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Địa chỉ chi tiết (Số nhà, đường, ấp/tổ dân phố) {isCoreIdentityLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                      </label>
                      <div className="relative">
                        <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="text"
                          readOnly={isCoreIdentityLocked}
                          disabled={isCoreIdentityLocked}
                          value={
                            shouldMaskLookupPreview
                              ? matchedCitizenRecord!.fullAddress
                              : shouldMaskLockedProfileFields
                              ? maskAddressForLookup(
                                  [profileForm.address, profileForm.wardName, profileForm.provinceName]
                                    .filter(Boolean)
                                    .join(', ')
                                )
                              : profileForm.address || ''
                          }
                          onChange={e => setProfileForm({ ...profileForm, address: e.target.value })}
                          placeholder="Ví dụ: 124 Đường Nguyễn Ảnh Thủ, Tổ dân phố 1..."
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                        />
                      </div>
                      {!shouldMaskLookupPreview && !shouldMaskLockedProfileFields && (profileForm.wardName || profileForm.provinceName) && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mt-1">
                          Địa chỉ đầy đủ:{' '}
                          {[profileForm.address, profileForm.wardName, profileForm.provinceName]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                    </div>

                    {(userProfile?.accountType === 'employee' || isPrimaryAdmin) && (
                      <>
                        <div className="col-span-full pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                          <Stethoscope className="w-4 h-4" />
                          <span>Nhân sự Y tế</span>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Khoa / Phòng {isProfileLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                          </label>
                          <input
                            type="text"
                            readOnly={isProfileLocked}
                            disabled={isProfileLocked}
                            value={profileForm.department || ''}
                            onChange={e => setProfileForm({ ...profileForm, department: e.target.value })}
                            className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Chức danh {isProfileLocked && <Lock className="w-3 h-3 inline ml-1 text-amber-600" />}
                          </label>
                          <input
                            type="text"
                            readOnly={isProfileLocked}
                            disabled={isProfileLocked}
                            value={profileForm.position || ''}
                            onChange={e => setProfileForm({ ...profileForm, position: e.target.value })}
                            className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                          />
                        </div>
                      </>
                    )}

                    <div className={`col-span-full ${isProfileLocked ? 'flex justify-end' : 'grid grid-cols-2 gap-2.5'} pt-2`}>
                      <button
                        type="button"
                        onClick={() => setEditingProfile(false)}
                        className="min-h-[44px] px-5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                      >
                        {isProfileLocked ? 'Đóng' : 'Hủy'}
                      </button>
                      {!isProfileLocked && (
                        <button
                          type="submit"
                          disabled={savingProfile || lockingCccd}
                          className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm shadow-xs transition cursor-pointer disabled:opacity-50"
                        >
                          {matchedCitizenRecord && !allowIdentityEditByAdmin && !userProfile?.citizenIdVerified
                            ? lockingCccd
                              ? 'Đang xác nhận...'
                              : 'Xác nhận & Khóa hồ sơ'
                            : savingProfile
                            ? 'Đang lưu...'
                            : 'Lưu định danh'}
                        </button>
                      )}
                    </div>
                  </form>
                )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Khoá 2FA Authenticator & Thiết lập Mật khẩu / Quên mật khẩu */}
              <AccountSecurityCard
                settings={settings}
                onOpenIdentityCard={() => {
                  setIdentityExpanded(true);
                  setEditingProfile(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />

              {/* Thẻ Sao lưu & Khôi phục dữ liệu định danh cá nhân */}
              <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="p-4 sm:px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 shrink-0">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                        Sao lưu &amp; Khôi phục dữ liệu cá nhân
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Lưu trữ Định danh Y tế cá nhân, Bảo mật/Xác minh, Khoá định danh, Lịch sử hoạt động &amp; Tuỳ chọn thiết bị ra tệp JSON
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-3.5">
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-800 dark:text-slate-200">
                        Bảo toàn trọn vẹn Dữ liệu Cá nhân &amp; Bảo mật Tài khoản (Chuẩn v3.0)
                      </p>
                      <p>
                        Tệp sao lưu JSON bao gồm đầy đủ Định danh Y tế cá nhân, Trạng thái xác minh 4 bước &amp; khoá định danh (Email, SĐT, CCCD), cấu hình bảo mật Authenticator 2FA, SMS MFA, Thiết bị tin cậy, Lịch hẹn/Phản ánh/SOS của bạn và các tuỳ chọn thiết bị. Hãy bảo quản tệp ở nơi an toàn.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleExportPersonalBackup}
                      className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
                      title="Tải tệp JSON chứa toàn bộ dữ liệu hồ sơ cá nhân về máy"
                    >
                      <HardDriveDownload className="w-4 h-4 shrink-0" />
                      <span>Xuất sao lưu JSON</span>
                    </button>

                    <input
                      ref={personalBackupInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportPersonalBackup}
                    />
                    <button
                      type="button"
                      onClick={() => personalBackupInputRef.current?.click()}
                      className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition cursor-pointer"
                      title="Chọn tệp JSON sao lưu cá nhân để phục hồi thông tin định danh"
                    >
                      <RotateCcw className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Khôi phục từ tệp</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyProfileSummary}
                      className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition cursor-pointer"
                      title="Sao chép toàn bộ thông tin thẻ định danh vào bộ nhớ tạm"
                    >
                      {copiedCard ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-emerald-700 dark:text-emerald-400">Đã sao chép!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>Sao chép thông tin thẻ</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {resetSentTo && (
                <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    Đã gửi liên kết đặt lại mật khẩu tới <strong>{resetSentTo}</strong>. Kiểm tra hộp thư đến hoặc Spam.
                  </span>
                </div>
              )}
            </>
          ) : (
            /* Sign In / Register Card */
            <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              {forgotMode ? (
                <div className="space-y-4 text-sm animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-emerald-600" />
                      <span>Đặt lại mật khẩu</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode(false);
                        setResetSentTo(null);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Quay lại</span>
                    </button>
                  </div>

                  {resetSentTo && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>Đã gửi liên kết đặt lại mật khẩu tới {maskVerifiedValue(resetSentTo, 'email')}.</span>
                    </div>
                  )}

                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Nhập chính xác Gmail cùng Số điện thoại (10 số) hoặc Số CCCD đã xác minh để đối chiếu trước khi gửi liên kết khôi phục.
                  </p>

                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      void handleSendUnauthPasswordReset();
                    }}
                    className="space-y-3"
                  >
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                      <input
                        type="text"
                        inputMode="email"
                        required
                        value={resetEmail}
                        onChange={e => setResetEmail(e.target.value)}
                        onBlur={() => setResetEmail(v => autoCompleteGmail(v))}
                        placeholder="Gmail (tự thêm @gmail.com) *"
                        className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={resetPhone}
                        onChange={e => setResetPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="Số điện thoại đã xác minh (10 số)"
                        className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="relative">
                      <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={12}
                        value={resetCccd}
                        onChange={e => setResetCccd(e.target.value.replace(/\D/g, '').slice(0, 12))}
                        placeholder="Hoặc Số CCCD đã xác minh (12 số)"
                        className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={sendingReset}
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      <Send className="w-4 h-4" />
                      <span>{sendingReset ? 'Đang gửi...' : 'Đối chiếu & Gửi liên kết khôi phục'}</span>
                    </button>
                  </form>
                </div>
              ) : (
                <>
                  {/* Segmented Login / Register Switch */}
                  <div className="p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={`min-h-[40px] rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
                        authMode === 'login'
                          ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Đăng nhập
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={`min-h-[40px] rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
                        authMode === 'register'
                          ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Đăng ký tài khoản
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleGoogleSignIn}
                    className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-100 shadow-xs transition flex items-center justify-center gap-2.5 cursor-pointer"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                      />
                    </svg>
                    <span>{authMode === 'register' ? 'Đăng ký nhanh với Google' : 'Đăng nhập nhanh với Google'}</span>
                  </button>

                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-slate-100 dark:border-slate-800" />
                    <span className="flex-shrink mx-3 text-[11px] text-slate-400 uppercase font-semibold">
                      hoặc email
                    </span>
                    <div className="flex-grow border-t border-slate-100 dark:border-slate-800" />
                  </div>

                  {authMode === 'login' ? (
                    <form onSubmit={handleAuthSubmit} className="space-y-3 text-sm">
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="text"
                          inputMode="email"
                          required
                          autoComplete="username"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          onBlur={() => setEmail(v => autoCompleteGmail(v))}
                          placeholder="tenban (tự thêm @gmail.com) hoặc email"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="Mật khẩu"
                          className="w-full min-h-[44px] pl-9 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                          aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-0.5">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={e => setRememberMe(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                          <span className="font-medium">Nhớ mật khẩu</span>
                        </label>

                        <button
                          type="button"
                          onClick={() => {
                            setResetEmail(email);
                            setResetSentTo(null);
                            setForgotMode(true);
                          }}
                          className="text-emerald-700 dark:text-emerald-400 hover:underline font-semibold cursor-pointer"
                        >
                          Quên mật khẩu?
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition cursor-pointer disabled:opacity-60"
                      >
                        {submitting ? 'Đang xác thực...' : 'Đăng nhập'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleRegisterSubmit} className="space-y-3 text-sm">
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="text"
                          required
                          value={regName}
                          onChange={e => setRegName(e.target.value)}
                          placeholder="Họ và tên *"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="text"
                          inputMode="email"
                          required
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          onBlur={() => setEmail(v => autoCompleteGmail(v))}
                          placeholder="Gmail (tự thêm @gmail.com khi nhập tên) *"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={regPhone}
                          onChange={e => setRegPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="Số điện thoại 10 số (tuỳ chọn)"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="relative">
                        <Ticket className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type="text"
                          value={referralCode}
                          onChange={e => {
                            const val = e.target.value.toUpperCase();
                            setReferralCode(val);
                            setPendingReferralCode(val);
                          }}
                          placeholder="Mã giới thiệu Cán bộ Y tế (tuỳ chọn)"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="Mật khẩu (>= 6 ký tự) *"
                          className="w-full min-h-[44px] pl-9 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={regConfirmPassword}
                          onChange={e => setRegConfirmPassword(e.target.value)}
                          placeholder="Nhập lại mật khẩu *"
                          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 shadow-xs transition cursor-pointer disabled:opacity-60"
                      >
                        {submitting ? 'Đang tạo tài khoản...' : 'Đăng ký & Xác minh'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}

          {/* Hiển thị phiên bản ứng dụng & Nút cập nhật đi kèm */}
          {renderVersionCard()}

          {/* Liên hệ Đội ngũ Phần mềm & Hỗ trợ Kỹ thuật */}
          <SoftwareTeamContactCard contact={settings.softwareTeamContact} />
        </div>
      )}

      {/* TAB 2: DEVICE SETTINGS & BACKGROUND WEB PUSH */}
      {activeTab === 'device' && (
        <div className="space-y-4">
          {/* Group 1: Background Notifications */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Thông báo đẩy nền
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Nhận tin mọi lúc kể cả khi đã đóng trình duyệt
                  </p>
                </div>
              </div>

              {!notifSupported ? (
                <span className="text-xs font-semibold text-slate-400">Không hỗ trợ</span>
              ) : notificationStatus === 'granted' && notifEnabled ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Đã bật</span>
                </span>
              ) : notificationStatus === 'denied' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Đang chặn</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Chưa bật</span>
                </span>
              )}
            </div>

            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4 min-h-[56px]">
              <div className="text-sm">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  Kích hoạt nhận tin tự động
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mỗi thông báo chỉ báo 1 lần và mở thẳng vào chi tiết khi chạm
                </p>
              </div>
              <button
                type="button"
                role="switch"
                disabled={syncingPush}
                aria-checked={notifEnabled && notificationStatus === 'granted'}
                onClick={handleToggleNotifPref}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-60 ${
                  notifEnabled && notificationStatus === 'granted'
                    ? 'bg-emerald-600'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    notifEnabled && notificationStatus === 'granted' ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {notificationStatus === 'denied' && (
              <div className="px-4 sm:px-5 py-3 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                <Info className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>Mở biểu tượng ổ khóa trên thanh địa chỉ trình duyệt và bật lại quyền Thông báo.</span>
              </div>
            )}

            {notifSupported && (
              <div className="px-4 sm:px-5 py-3.5 grid grid-cols-2 gap-2.5">
                {notificationStatus !== 'granted' ? (
                  <button
                    type="button"
                    disabled={syncingPush}
                    onClick={handleRequestNotification}
                    className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <Bell className="w-4 h-4 shrink-0" />
                    <span>{syncingPush ? 'Đang bật...' : 'Cấp quyền ngay'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={syncingPush}
                    onClick={handleRequestNotification}
                    className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{syncingPush ? 'Đang đồng bộ...' : 'Đồng bộ kênh đẩy'}</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={testingNotif}
                  onClick={handleTestNotification}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{testingNotif ? 'Đang gửi...' : 'Thử thông báo'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Group 2: GPS & Map */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Định vị GPS
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tự động gợi ý điểm y tế gần vị trí hiện tại
                  </p>
                </div>
              </div>

              {!geoSupported ? (
                <span className="text-xs font-semibold text-slate-400">Không hỗ trợ</span>
              ) : locationStatus === 'granted' ? (
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Đã định vị</span>
              ) : (
                <span className="text-xs font-bold text-amber-600">Chưa định vị</span>
              )}
            </div>

            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4 min-h-[56px]">
              <div className="text-sm">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  Tự động cập nhật mỗi phiên
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {userCoords
                    ? `Tọa độ: ${userCoords.lat.toFixed(4)}, ${userCoords.lng.toFixed(4)}${
                        nearestStation
                          ? ` · Gần ${nearestStation.name} (${nearestStation.distanceKm.toFixed(1)} km · ~${estimateDrivingMinutes(nearestStation.distanceKm)}p)`
                          : ''
                      }`
                    : 'Vuốt xuống để làm mới tọa độ khi mở bản đồ'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={locationPref}
                onClick={handleToggleLocationPref}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  locationPref ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    locationPref ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="px-4 sm:px-5 py-3.5 grid grid-cols-2 gap-2.5">
              {geoSupported && (
                <button
                  type="button"
                  disabled={locating}
                  onClick={handleRequestLocation}
                  className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Navigation className={`w-4 h-4 shrink-0 ${locating ? 'animate-spin' : ''}`} />
                  <span>{locating ? 'Đang lấy...' : 'Lấy GPS'}</span>
                </button>
              )}

              {nearestStation ? (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${nearestStation.lat},${nearestStation.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <span>Google Maps</span>
                  <ExternalLink className="w-4 h-4 text-emerald-600 shrink-0" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setCurrentView('map')}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Mở bản đồ</span>
                </button>
              )}
            </div>
          </div>

          {/* Group 3: App Install & Share */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Ứng dụng trên thiết bị
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Thêm lên màn hình chính để nhận thông báo và mở nhanh
                  </p>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-5 py-3.5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleInstallPwa}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>{isInstalled ? 'Đã cài App' : 'Thêm vào máy'}</span>
              </button>

              <button
                type="button"
                onClick={handleSharePortal}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Chia sẻ</span>
              </button>
            </div>
          </div>

          {/* Group 4: Dark Mode Theme Switcher */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Giao diện hiển thị (Dark Mode)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chuyển đổi giữa chế độ nền sáng và nền tối bảo vệ mắt
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                {isDarkMode ? 'Đang bật Tối' : 'Đang bật Sáng'}
              </span>
            </div>

            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4 min-h-[56px]">
              <div className="text-sm">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  Chế độ tối (Dark Theme)
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Lưu tùy chọn trực tiếp vào thiết bị của bạn
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDarkMode}
                onClick={handleToggleDarkMode}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  isDarkMode ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    isDarkMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Group 5: Phiên bản ứng dụng & Cập nhật đi kèm */}
          {renderVersionCard()}

          {/* Group 6: Liên hệ Đội ngũ Phần mềm & Hỗ trợ Kỹ thuật */}
          <SoftwareTeamContactCard contact={settings.softwareTeamContact} />
        </div>
      )}

      {nfcFallbackModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nfc-fallback-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <h3
                  id="nfc-fallback-title"
                  className="text-sm sm:text-base font-bold text-slate-900 dark:text-white"
                >
                  Nhập mã số CCCD gắn chip
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNfcFallbackModalOpen(false)}
                aria-label="Đóng"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmNfcFallback} className="p-5 space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Thiết bị chưa bật hoặc trình duyệt chưa hỗ trợ Web NFC trực tiếp. Vui lòng nhập mã số CCCD gắn chip (12 chữ số) để điền vào hồ sơ:
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={15}
                autoFocus
                value={nfcFallbackInput}
                onChange={e => setNfcFallbackInput(e.target.value)}
                placeholder="Ví dụ: 001090012345"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm font-mono font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setNfcFallbackModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Áp dụng số CCCD
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
