import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  KeyRound,
  Smartphone,
  QrCode,
  Copy,
  Check,
  Download,
  Eye,
  EyeOff,
  Send,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Phone,
  Trash2,
  MailCheck,
  Laptop,
  Pencil,
  Shield,
  CreditCard,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAuditEvent } from '../../services/firebaseService';
import { SystemSettings, UserVerifiedDevice } from '../../types';
import {
  generateTotpSecret,
  generateRecoveryCodes,
  buildOtpAuthUri,
  generateTotpQrDataUrl,
} from '../../utils/totp';
import { formatFirebaseGoogleAuthError, formatFirebaseSmsMfaError } from '../../utils/smsMfaUtils';
import {
  normalizeAndValidatePhone,
  autoCompleteGmail,
  maskVerifiedValue,
} from '../../utils/verifiedIdentity';
import { VerifiedBlueTick } from '../common/VerifiedBlueTick';
import {
  ACCOUNT_SECURITY_CARD_TITLE,
  getAccountSecuritySyncItems,
  getUserVerificationProgress,
} from '../../utils/verificationBadge';

interface AccountSecurityCardProps {
  settings: SystemSettings;
  onOpenIdentityCard?: () => void;
}

type ActiveSection = 'verify' | 'phone' | 'totp_2fa' | 'password' | 'cccd' | 'devices' | null;

function formatDeviceMethod(method: UserVerifiedDevice['verificationMethod']): string {
  switch (method) {
    case 'google':
      return 'Google';
    case 'sms_mfa':
      return 'SMS 2FA';
    case 'sms_otp':
      return 'SMS OTP';
    case 'totp_2fa':
      return '2FA App';
    case 'password':
      return 'Mật khẩu';
    default:
      return 'Thủ công';
  }
}

export const AccountSecurityCard: React.FC<AccountSecurityCardProps> = ({
  settings,
  onOpenIdentityCard,
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
    twoFactorLoading,
    enrolledSmsFactors,
    smsMfaEnabled,
    verifiedDevices,
    currentDeviceId,
    currentDeviceTrusted,
    sendVerificationEmailToCurrentUser,
    refreshCurrentUserState,
    linkGoogleAccount,
    confirmAndLockPhoneNumber,
    registerOrVerifyCurrentDevice,
    renameVerifiedDevice,
    removeVerifiedDevice,
    unenrollSmsMfaFactor,
    linkEmailPassword,
    changeAccountPassword,
    sendPasswordReset,
    enableTwoFactorAuth,
    disableTwoFactorAuth,
  } = useAuth();
  const { showToast } = useToast();

  // Pillar status calculation (4 pillars * 25% = 100%)
  const resolvedRuntimePhone =
    userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser?.phoneNumber;
  const isAdminAccount = Boolean(
    isAdmin ||
      isPrimaryAdmin ||
      userProfile?.role === 'super_admin' ||
      userProfile?.role === 'admin' ||
      userProfile?.accountType === 'admin'
  );
  const securityRuntime = {
    emailVerified: currentUser?.emailVerified,
    hasGoogleProvider,
    hasPasswordProvider,
    twoFactorEnabled,
    twoFactorLoading,
    smsMfaEnabled,
    phoneNumber: resolvedRuntimePhone,
    trustedDevicesCount: verifiedDevices.length,
    currentDeviceTrusted,
    isAdmin: isAdminAccount,
  };
  const verification = getUserVerificationProgress(userProfile, securityRuntime);
  const syncItems = getAccountSecuritySyncItems(userProfile, securityRuntime);
  const itemByKey = Object.fromEntries(syncItems.map((item) => [item.key, item])) as Record<
    (typeof syncItems)[number]['key'],
    (typeof syncItems)[number]
  >;
  const isEmailVerified = verification.emailDone;
  const isPhoneVerified = verification.phoneDone;
  const isPasswordVerified = verification.passwordDone;
  const is2FAVerified = verification.twoFactorDone;
  const isCitizenIdVerified = verification.citizenIdDone;
  const verifiedCount = verification.completedCount;
  const verificationPercent = verification.percent;
  const isFullyVerified = verification.isFullyVerified;

  // Auto-expand verification panel if account is not yet fully verified
  const [expanded, setExpanded] = useState<boolean>(() => !isEmailVerified || !isPhoneVerified);
  const [activeSection, setActiveSection] = useState<ActiveSection>(() =>
    !isEmailVerified ? 'verify' : !isPhoneVerified ? 'phone' : null
  );

  // Email / Google verification state
  const [sendingEmailVerify, setSendingEmailVerify] = useState(false);
  const [refreshingEmailVerify, setRefreshingEmailVerify] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);

  // Password setup / change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwdChars, setShowPwdChars] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetGateOpen, setResetGateOpen] = useState(false);
  const [resetCheckEmail, setResetCheckEmail] = useState('');
  const [resetCheckPhone, setResetCheckPhone] = useState('');
  const [resetCheckCccd, setResetCheckCccd] = useState('');
  const [resetCheckName, setResetCheckName] = useState('');

  // 2FA Setup Wizard state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupPasswordFirst, setSetupPasswordFirst] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [setupOtpInput, setSetupOtpInput] = useState('');
  const [enabling2FA, setEnabling2FA] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // 2FA Disable & Recovery View states
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableOtp, setDisableOtp] = useState('');
  const [disabling2FA, setDisabling2FA] = useState(false);

  // Direct phone confirmation & legacy SMS MFA cleanup states
  const [phoneInput, setPhoneInput] = useState(
    userProfile?.verifiedPhone || userProfile?.phoneNumber || ''
  );
  const [confirmingPhone, setConfirmingPhone] = useState(false);
  const [unenrollingFactorUid, setUnenrollingFactorUid] = useState<string | null>(null);
  const [unenrollTargetUid, setUnenrollTargetUid] = useState<string | null>(null);
  const [unenrollPassword, setUnenrollPassword] = useState('');

  // Device management states
  const [verifyingDevice, setVerifyingDevice] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceRenameInput, setDeviceRenameInput] = useState('');
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const savedPhone = userProfile?.verifiedPhone || userProfile?.phoneNumber || '';
    if (savedPhone) {
      setPhoneInput((prev) => prev || savedPhone);
    }
  }, [userProfile?.verifiedPhone, userProfile?.phoneNumber]);

  if (!currentUser) return null;

  const issuerName =
    settings.stationName && !settings.stationName.includes('Chưa cấu hình')
      ? settings.stationName
      : 'Tram Y Te So';

  const toggleSection = (sec: Exclude<ActiveSection, null>) => {
    setExpanded(true);
    setActiveSection((prev) => (prev === sec ? null : sec));
  };

  // --- Email / Google Verification Handlers ---
  const handleSendEmailVerification = async () => {
    setSendingEmailVerify(true);
    try {
      await sendVerificationEmailToCurrentUser();
      showToast('success', 'Đã gửi link xác minh', `Kiểm tra hộp thư ${currentUser.email}`);
    } catch (err: any) {
      showToast('error', 'Không thể gửi email', formatFirebaseSmsMfaError(err));
    } finally {
      setSendingEmailVerify(false);
    }
  };

  const handleRefreshEmailVerification = async () => {
    setRefreshingEmailVerify(true);
    try {
      await refreshCurrentUserState();
      if (currentUser.emailVerified || hasGoogleProvider) {
        showToast('success', 'Gmail đã xác minh', 'Email của bạn đã được khoá duy nhất.');
      } else {
        showToast('info', 'Chưa xác nhận liên kết', 'Mở Gmail và nhấn vào đường dẫn xác minh.');
      }
    } finally {
      setRefreshingEmailVerify(false);
    }
  };

  const handleLinkGoogle = async () => {
    setLinkingGoogle(true);
    try {
      await linkGoogleAccount();
      showToast('success', 'Đã liên kết Gmail', 'Tài khoản Google đã được xác minh.');
    } catch (err: any) {
      showToast('error', 'Liên kết thất bại', formatFirebaseGoogleAuthError(err));
    } finally {
      setLinkingGoogle(false);
    }
  };

  // --- 2FA Authenticator Handlers ---
  const handleOpen2FASetup = async () => {
    setActiveSection('totp_2fa');
    setSetupOpen(true);
    setSetupOtpInput('');
    setSetupPasswordFirst('');
    setSetupPasswordConfirm('');

    const secret = generateTotpSecret(20);
    const codes = generateRecoveryCodes(8);
    setTotpSecret(secret);
    setRecoveryCodes(codes);

    try {
      const uri = buildOtpAuthUri(currentUser.email || currentUser.uid, secret, issuerName);
      const dataUrl = await generateTotpQrDataUrl(uri);
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl('');
    }
  };

  const handleRegenerateSecret = async () => {
    const secret = generateTotpSecret(20);
    const codes = generateRecoveryCodes(8);
    setTotpSecret(secret);
    setRecoveryCodes(codes);
    setSetupOtpInput('');
    try {
      const uri = buildOtpAuthUri(currentUser.email || currentUser.uid, secret, issuerName);
      const dataUrl = await generateTotpQrDataUrl(uri);
      setQrDataUrl(dataUrl);
      showToast('info', 'Đã tạo khóa 2FA mới');
    } catch {
      setQrDataUrl('');
    }
  };

  const handleSetPasswordInside2FA = async () => {
    if (setupPasswordFirst.length < 6) {
      showToast('warning', 'Mật khẩu tối thiểu 6 ký tự');
      return;
    }
    if (setupPasswordFirst !== setupPasswordConfirm) {
      showToast('warning', 'Mật khẩu xác nhận không khớp');
      return;
    }
    setSavingPassword(true);
    try {
      await linkEmailPassword(setupPasswordFirst);
      setSetupPasswordFirst('');
      setSetupPasswordConfirm('');
      showToast('success', 'Đã tạo mật khẩu', 'Tiếp tục quét QR để bật 2FA.');
    } catch (err: any) {
      showToast('error', 'Lỗi thiết lập mật khẩu', err?.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleActivate2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPasswordProvider) {
      showToast('warning', 'Vui lòng tạo mật khẩu ở Bước 1 trước');
      return;
    }
    if (setupOtpInput.replace(/\D/g, '').length !== 6) {
      showToast('warning', 'Nhập đủ 6 chữ số OTP');
      return;
    }

    setEnabling2FA(true);
    try {
      const res = await enableTwoFactorAuth(totpSecret, setupOtpInput, recoveryCodes, issuerName);
      if (!res.ok) {
        showToast('error', 'Xác thực OTP thất bại', res.error);
        setEnabling2FA(false);
        return;
      }
      await registerOrVerifyCurrentDevice('totp_2fa');
      await logAuditEvent(
        'Bật Khoá 2FA Authenticator',
        'Bảo mật tài khoản',
        `Email: ${currentUser.email}`,
        { uid: currentUser.uid, name: userProfile?.displayName || currentUser.email || 'Người dùng' }
      );
      setSetupOpen(false);
      setSetupOtpInput('');
      showToast('success', 'Đã bật Khoá 2FA Authenticator');
    } catch (err: any) {
      showToast('error', 'Không thể kích hoạt 2FA', err?.message);
    } finally {
      setEnabling2FA(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisabling2FA(true);
    try {
      const res = await disableTwoFactorAuth({
        password: disablePassword,
        verificationCode: disableOtp,
      });
      if (!res.ok) {
        showToast('error', 'Không thể tắt 2FA', res.error);
        setDisabling2FA(false);
        return;
      }
      setDisableOpen(false);
      setDisablePassword('');
      setDisableOtp('');
      showToast('info', 'Đã tắt Khoá 2FA Authenticator');
    } catch (err: any) {
      showToast('error', 'Lỗi khi tắt 2FA', err?.message);
    } finally {
      setDisabling2FA(false);
    }
  };

  // --- Password Handlers ---
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasPasswordProvider && !currentPassword.trim()) {
      showToast('warning', 'Yêu cầu nhập mật khẩu cũ', 'Vui lòng nhập mật khẩu cũ (hiện tại) để xác nhận đổi mật khẩu.');
      return;
    }
    if (newPassword.length < 6) {
      showToast('warning', 'Mật khẩu tối thiểu 6 ký tự');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('warning', 'Mật khẩu mới xác nhận không khớp');
      return;
    }
    if (hasPasswordProvider && currentPassword === newPassword) {
      showToast('warning', 'Mật khẩu mới trùng mật khẩu cũ', 'Vui lòng chọn mật khẩu mới khác mật khẩu hiện tại.');
      return;
    }

    setSavingPassword(true);
    try {
      if (!hasPasswordProvider) {
        await linkEmailPassword(newPassword);
        showToast('success', 'Đã thiết lập mật khẩu');
      } else {
        await changeAccountPassword(currentPassword, newPassword);
        showToast('success', 'Đã đổi mật khẩu');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg = String(err?.code || err?.message || '');
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        showToast('error', 'Mật khẩu cũ không chính xác');
      } else {
        showToast('error', 'Không thể cập nhật mật khẩu', err?.message);
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const handleOpenResetGate = () => {
    setResetCheckEmail('');
    setResetCheckPhone('');
    setResetCheckCccd('');
    setResetCheckName('');
    setResetGateOpen((v) => !v);
  };

  const handleSendResetEmail = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentUser.email) return;

    const enteredEmail = autoCompleteGmail(resetCheckEmail).toLowerCase();
    setResetCheckEmail(enteredEmail);
    if (!enteredEmail || enteredEmail !== currentUser.email.trim().toLowerCase()) {
      showToast('error', 'Email không khớp', 'Vui lòng nhập chính xác địa chỉ Email của tài khoản.');
      return;
    }

    const storedPhoneRaw = userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser.phoneNumber || '';
    const storedPhoneNorm = storedPhoneRaw ? normalizeAndValidatePhone(storedPhoneRaw) : '';
    if (storedPhoneNorm) {
      const enteredPhoneNorm = normalizeAndValidatePhone(resetCheckPhone);
      if (!enteredPhoneNorm || enteredPhoneNorm !== storedPhoneNorm) {
        showToast('error', 'Số điện thoại không khớp', 'Vui lòng nhập đúng số điện thoại 10 số đã gắn với tài khoản.');
        return;
      }
    }

    const storedCccdDigits = (userProfile?.citizenId || '').replace(/\D/g, '');
    if (userProfile?.citizenIdVerified && storedCccdDigits) {
      const enteredCccdDigits = resetCheckCccd.replace(/\D/g, '');
      if (!enteredCccdDigits || enteredCccdDigits !== storedCccdDigits) {
        showToast('error', 'Số CCCD không khớp', 'Vui lòng nhập chính xác số CCCD đã xác minh.');
        return;
      }
    }

    if (!storedPhoneNorm && !(userProfile?.citizenIdVerified && storedCccdDigits)) {
      const expectedName = (userProfile?.displayName || currentUser.displayName || '').trim().toLowerCase();
      if (expectedName && resetCheckName.trim().toLowerCase() !== expectedName) {
        showToast('error', 'Họ tên không khớp', 'Vui lòng nhập chính xác Họ và tên tài khoản để xác minh.');
        return;
      }
    }

    setSendingReset(true);
    try {
      await sendPasswordReset(currentUser.email);
      setResetSent(true);
      setResetGateOpen(false);
      showToast('success', 'Đã gửi link đặt lại mật khẩu', maskVerifiedValue(currentUser.email, 'email'));
    } catch (err: any) {
      showToast('error', 'Không thể gửi email', err?.message);
    } finally {
      setSendingReset(false);
    }
  };

  // --- Direct Phone Confirmation Handler (Unique in DB, No SMS OTP) ---
  const handleConfirmPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneInput.trim()) {
      showToast('warning', 'Nhập số điện thoại');
      return;
    }
    const normalizedPreview = normalizeAndValidatePhone(phoneInput);
    if (!normalizedPreview) {
      showToast(
        'warning',
        'Số điện thoại không hợp lệ',
        'Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).'
      );
      return;
    }
    setConfirmingPhone(true);
    try {
      const lockedPhone = await confirmAndLockPhoneNumber(phoneInput);
      await logAuditEvent(
        'Xác nhận số điện thoại',
        'Bảo mật tài khoản',
        `SĐT: ${lockedPhone}`,
        {
          uid: currentUser.uid,
          name: userProfile?.displayName || currentUser.email || 'Người dùng',
        }
      );
      showToast(
        'success',
        'Đã xác nhận số điện thoại',
        'Số điện thoại đã được lưu và khoá duy nhất trên hệ thống.'
      );
    } catch (err: any) {
      showToast('error', 'Không thể xác nhận số điện thoại', err?.message || 'Vui lòng thử lại.');
    } finally {
      setConfirmingPhone(false);
    }
  };

  const handleUnenrollSmsFactor = async (factorUid: string, password?: string) => {
    setUnenrollingFactorUid(factorUid);
    try {
      await unenrollSmsMfaFactor(factorUid, password);
      setUnenrollTargetUid(null);
      setUnenrollPassword('');
      showToast('info', 'Đã gỡ số SMS MFA');
    } catch (err: any) {
      if (err?.message === 'REQUIRES_REAUTH_PASSWORD') {
        setUnenrollTargetUid(factorUid);
        showToast('info', 'Nhập mật khẩu để xác nhận gỡ số');
      } else {
        showToast('error', 'Không thể gỡ số SMS', formatFirebaseSmsMfaError(err));
      }
    } finally {
      setUnenrollingFactorUid(null);
    }
  };

  // --- Verified Device Handlers ---
  const handleVerifyCurrentDevice = async () => {
    setVerifyingDevice(true);
    try {
      await registerOrVerifyCurrentDevice('manual');
      showToast('success', 'Đã xác minh thiết bị hiện tại');
    } catch (err: any) {
      showToast('error', 'Không thể xác minh thiết bị', err?.message);
    } finally {
      setVerifyingDevice(false);
    }
  };

  const handleSaveRenameDevice = async (deviceId: string) => {
    if (!deviceRenameInput.trim()) return;
    try {
      await renameVerifiedDevice(deviceId, deviceRenameInput);
      setEditingDeviceId(null);
      setDeviceRenameInput('');
      showToast('success', 'Đã đổi tên thiết bị');
    } catch (err: any) {
      showToast('error', 'Lỗi đổi tên', err?.message);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    setRemovingDeviceId(deviceId);
    try {
      await removeVerifiedDevice(deviceId);
      showToast('info', 'Đã thu hồi thiết bị');
    } catch (err: any) {
      showToast('error', 'Không thể gỡ thiết bị', err?.message);
    } finally {
      setRemovingDeviceId(null);
    }
  };

  const handleCopyText = (text: string, onCopied: () => void, label: string) => {
    try {
      navigator.clipboard.writeText(text);
      onCopied();
      showToast('success', `Đã sao chép ${label}`);
    } catch {
      showToast('error', 'Không thể sao chép');
    }
  };

  const handleDownloadRecoveryCodes = (codes: string[]) => {
    const content = [
      `MA KHOI PHUC 2FA - ${issuerName.toUpperCase()}`,
      `Tai khoan: ${currentUser.email}`,
      `Ngay tao: ${new Date().toLocaleString('vi-VN')}`,
      '',
      ...codes.map((c, idx) => `${idx + 1}. ${c}`),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ma_khoi_phuc_2fa_${currentUser.uid.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('success', 'Đã tải mã khôi phục');
  };

  const previewPhoneE164 = phoneInput.trim() ? normalizeAndValidatePhone(phoneInput) : '';

  const StatusTag = ({
    done,
    label,
    tone,
  }: {
    done: boolean;
    label?: string;
    tone?: 'emerald' | 'sky' | 'amber' | 'slate';
  }) => {
    const colorClass =
      tone === 'sky'
        ? 'text-sky-700 dark:text-sky-400'
        : done
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-slate-400 dark:text-slate-500';
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${colorClass}`}>
        {done && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
        <span>{label || (done ? 'Đã xác minh' : 'Chưa bật')}</span>
      </span>
    );
  };

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
      {/* Compact Native App Header + Verification Progress */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full px-4 sm:px-5 py-4 text-left cursor-pointer group hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                verificationPercent === 100
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
              }`}
            >
              {verificationPercent === 100 ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                <span className="truncate">{ACCOUNT_SECURITY_CARD_TITLE}</span>
                {isFullyVerified && <VerifiedBlueTick size="sm" />}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                Đã hoàn tất {verifiedCount}/4 lớp bảo vệ · {verifiedDevices.length} thiết bị
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span
              className={`text-sm font-extrabold tabular-nums ${
                verificationPercent === 100
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {verificationPercent}%
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                expanded ? 'rotate-180 text-emerald-600 dark:text-emerald-400' : ''
              }`}
            />
          </div>
        </div>

        {/* Verification Progress Bar */}
        <div className="mt-3 space-y-1.5">
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                verificationPercent === 100
                  ? 'bg-emerald-600'
                  : verificationPercent >= 50
                  ? 'bg-teal-600'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${verificationPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            <span>Tiến độ xác minh</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {verificationPercent === 100 ? 'Đã xác minh toàn phần' : `${verificationPercent}% hoàn thành`}
            </span>
          </div>
        </div>
      </button>

      {/* Native Grouped List Items */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {/* ITEM 1: XÁC MINH GMAIL / EMAIL */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('verify')}
                className="w-full min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <MailCheck className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {itemByKey.verify.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
                      <span className="truncate font-mono">
                        {itemByKey.verify.subtitle}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag
                    done={itemByKey.verify.done}
                    label={itemByKey.verify.statusLabel}
                    tone={itemByKey.verify.tone}
                  />
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeSection === 'verify' ? 'rotate-90 text-emerald-600' : ''
                    }`}
                  />
                </div>
              </button>

              {activeSection === 'verify' && (
                <div className="px-4 sm:px-5 pb-4 pt-1 bg-slate-50/70 dark:bg-slate-950/40">
                  <div className="py-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>Gmail / Email Firebase</span>
                          {isEmailVerified && <Lock className="w-3 h-3 text-emerald-600 shrink-0" />}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5">
                          {isEmailVerified
                            ? maskVerifiedValue(currentUser.email, 'email')
                            : currentUser.email}
                        </div>
                      </div>
                      <StatusTag done={isEmailVerified} label={isEmailVerified ? 'Đã xác minh' : 'Chưa xác minh'} />
                    </div>

                    {!isEmailVerified && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={sendingEmailVerify}
                          onClick={handleSendEmailVerification}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{sendingEmailVerify ? 'Đang gửi...' : 'Gửi link Firebase'}</span>
                        </button>
                        {!hasGoogleProvider && (
                          <button
                            type="button"
                            disabled={linkingGoogle}
                            onClick={handleLinkGoogle}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            <Shield className="w-3.5 h-3.5 text-blue-600" />
                            <span>{linkingGoogle ? 'Đang liên kết...' : 'Liên kết Google'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={refreshingEmailVerify}
                          onClick={handleRefreshEmailVerification}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${refreshingEmailVerify ? 'animate-spin' : ''}`} />
                          <span>Tôi đã xác minh</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ITEM 2: SỐ ĐIỆN THOẠI (ĐIỀN & XÁC NHẬN, KHÔNG TRÙNG LẶP) */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('phone')}
                className="w-full min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0">
                    <Phone className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {itemByKey.phone.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {itemByKey.phone.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag
                    done={itemByKey.phone.done}
                    label={itemByKey.phone.statusLabel}
                    tone={itemByKey.phone.tone}
                  />
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeSection === 'phone' ? 'rotate-90 text-sky-600' : ''
                    }`}
                  />
                </div>
              </button>

              {activeSection === 'phone' && (
                <div className="px-4 sm:px-5 pb-4 pt-2 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
                  {isPhoneVerified ? (
                    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white">
                              Số điện thoại đã xác nhận
                            </div>
                            <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                              {maskVerifiedValue(userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser.phoneNumber, 'phone')}
                            </div>
                          </div>
                        </div>
                        <StatusTag done label="Đã xác nhận" />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Số điện thoại này đã được khoá duy nhất trong cơ sở dữ liệu cho tài khoản của bạn.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleConfirmPhone} className="space-y-2.5">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          required
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="Nhập số điện thoại 10 số (VD: 0912345678)"
                          className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                        <button
                          type="submit"
                          disabled={confirmingPhone || !phoneInput.trim()}
                          className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          <Check className="w-4 h-4" />
                          <span>{confirmingPhone ? 'Đang lưu...' : 'Xác nhận'}</span>
                        </button>
                      </div>
                      {phoneInput.trim() && (
                        <div
                          className={`text-[11px] font-mono ${
                            previewPhoneE164
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {previewPhoneE164
                            ? `Số chuẩn hoá: ${previewPhoneE164} · Hệ thống tự kiểm tra không trùng số.`
                            : 'Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).'}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Chỉ cần điền số điện thoại và bấm Xác nhận. Mỗi số điện thoại chỉ được gắn cho 1 tài khoản duy nhất trên hệ thống.
                      </p>
                    </form>
                  )}

                  {enrolledSmsFactors.length > 0 && (
                    <div className="divide-y divide-slate-200/80 dark:divide-slate-800 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                      {enrolledSmsFactors.map((factor) => {
                        const isPromptingPwd = unenrollTargetUid === factor.uid;
                        const isRemoving = unenrollingFactorUid === factor.uid;
                        return (
                          <div key={factor.uid} className="p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Phone className="w-4 h-4 text-sky-600 shrink-0" />
                                <div className="min-w-0">
                                  <div className="font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                                    {factor.phoneNumber || 'Số đã ẩn'}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {factor.displayName || 'SMS 2FA cũ'}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={isRemoving}
                                onClick={() => void handleUnenrollSmsFactor(factor.uid)}
                                className="min-h-[38px] px-3 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>{isRemoving ? 'Đang gỡ...' : 'Gỡ'}</span>
                              </button>
                            </div>

                            {isPromptingPwd && (
                              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                                <input
                                  type="password"
                                  value={unenrollPassword}
                                  onChange={(e) => setUnenrollPassword(e.target.value)}
                                  placeholder="Nhập mật khẩu để gỡ..."
                                  className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-700 bg-slate-50 dark:bg-slate-800 text-sm"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={isRemoving || !unenrollPassword}
                                    onClick={() => void handleUnenrollSmsFactor(factor.uid, unenrollPassword)}
                                    className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                                  >
                                    Xác nhận
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setUnenrollTargetUid(null);
                                      setUnenrollPassword('');
                                    }}
                                    className="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold cursor-pointer"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ITEM 3: KHOÁ 2FA (GOOGLE / MICROSOFT AUTHENTICATOR) */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('totp_2fa')}
                className="w-full min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <QrCode className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {itemByKey.totp_2fa.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {itemByKey.totp_2fa.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag
                    done={itemByKey.totp_2fa.done}
                    label={itemByKey.totp_2fa.statusLabel}
                    tone={itemByKey.totp_2fa.tone}
                  />
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeSection === 'totp_2fa' ? 'rotate-90 text-emerald-600' : ''
                    }`}
                  />
                </div>
              </button>

              {activeSection === 'totp_2fa' && (
                <div className="px-4 sm:px-5 pb-4 pt-2 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
                  {isAdminAccount && (
                    <div className="p-3 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200 text-xs flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Đặc cách Quản trị viên:</strong> Tài khoản Admin được miễn yêu cầu xác thực 2FA khi đăng nhập. Bạn vẫn có thể bật hoặc tắt Khoá 2FA tùy chọn bên dưới.
                      </span>
                    </div>
                  )}
                  {twoFactorEnabled ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowRecoveryCodes((v) => !v)}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-emerald-600" />
                          <span>
                            {showRecoveryCodes
                              ? 'Ẩn mã khôi phục'
                              : `Mã khôi phục (${totpConfig?.recoveryCodes?.length || 0})`}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDisableOpen((v) => !v)}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold cursor-pointer"
                        >
                          {disableOpen ? 'Hủy tắt 2FA' : 'Tắt Khoá 2FA'}
                        </button>
                      </div>

                      {showRecoveryCodes && Array.isArray(totpConfig?.recoveryCodes) && (
                        <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              Mã khôi phục dự phòng (dùng 1 lần)
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyText(
                                    (totpConfig.recoveryCodes || []).join('\n'),
                                    () => {
                                      setCopiedCodes(true);
                                      setTimeout(() => setCopiedCodes(false), 2000);
                                    },
                                    'mã khôi phục'
                                  )
                                }
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                {copiedCodes ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                <span>{copiedCodes ? 'Đã chép' : 'Chép'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadRecoveryCodes(totpConfig.recoveryCodes || [])}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Tải .txt</span>
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {(totpConfig.recoveryCodes || []).map((code) => (
                              <div
                                key={code}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 font-mono text-center font-bold text-slate-800 dark:text-slate-100"
                              >
                                {code}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {disableOpen && (
                        <form
                          onSubmit={handleDisable2FA}
                          className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 space-y-2.5"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {hasPasswordProvider && (
                              <input
                                type="password"
                                required
                                value={disablePassword}
                                onChange={(e) => setDisablePassword(e.target.value)}
                                placeholder="Mật khẩu tài khoản..."
                                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
                              />
                            )}
                            <input
                              type="text"
                              required
                              value={disableOtp}
                              onChange={(e) => setDisableOtp(e.target.value)}
                              placeholder="Mã OTP 6 số hoặc mã khôi phục"
                              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-sm"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={disabling2FA}
                            className="w-full min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            {disabling2FA ? 'Đang xử lý...' : 'Xác nhận tắt 2FA'}
                          </button>
                        </form>
                      )}
                    </div>
                  ) : !setupOpen ? (
                    <button
                      type="button"
                      onClick={handleOpen2FASetup}
                      className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Thiết lập Authenticator 2FA</span>
                    </button>
                  ) : (
                    <div className="space-y-3.5">
                      {!hasPasswordProvider && (
                        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-2.5">
                          <div className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>Bước 1: Tạo mật khẩu dự phòng trước khi bật 2FA</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="password"
                              value={setupPasswordFirst}
                              onChange={(e) => setSetupPasswordFirst(e.target.value)}
                              placeholder="Mật khẩu mới (>= 6 ký tự)"
                              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-sm"
                            />
                            <input
                              type="password"
                              value={setupPasswordConfirm}
                              onChange={(e) => setSetupPasswordConfirm(e.target.value)}
                              placeholder="Nhập lại mật khẩu"
                              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-sm"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={savingPassword}
                            onClick={handleSetPasswordInside2FA}
                            className="min-h-[44px] px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer disabled:opacity-60"
                          >
                            {savingPassword ? 'Đang lưu...' : 'Lưu mật khẩu'}
                          </button>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <div className="w-36 h-36 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1.5 shrink-0">
                          {qrDataUrl ? (
                            <img src={qrDataUrl} alt="QR Code 2FA" className="w-full h-full object-contain" />
                          ) : (
                            <QrCode className="w-10 h-10 text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                          <div className="font-bold text-slate-900 dark:text-white">
                            Quét mã bằng Google / Microsoft Authenticator
                          </div>
                          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
                            <code className="flex-1 font-mono font-bold text-emerald-700 dark:text-emerald-400 break-all text-[11px]">
                              {totpSecret}
                            </code>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(
                                  totpSecret,
                                  () => {
                                    setCopiedSecret(true);
                                    setTimeout(() => setCopiedSecret(false), 2000);
                                  },
                                  'mã khóa bí mật'
                                )
                              }
                              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer shrink-0"
                            >
                              {copiedSecret ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                            <button
                              type="button"
                              onClick={handleRegenerateSecret}
                              className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-700 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Đổi mã khác</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadRecoveryCodes(recoveryCodes)}
                              className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              <span>Tải 8 mã khôi phục</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      <form onSubmit={handleActivate2FA} className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          required
                          value={setupOtpInput}
                          onChange={(e) => setSetupOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="Nhập OTP 6 số"
                          className="flex-1 min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base font-bold tracking-[0.35em] text-center"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSetupOpen(false)}
                            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                          >
                            Hủy
                          </button>
                          <button
                            type="submit"
                            disabled={enabling2FA || setupOtpInput.length < 6}
                            className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <ShieldCheck className="w-4 h-4" />
                            <span>{enabling2FA ? 'Đang bật...' : 'Kích hoạt'}</span>
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ITEM 4: MẬT KHẨU & KHÔI PHỤC */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('password')}
                className="w-full min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                    <KeyRound className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {itemByKey.password.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {itemByKey.password.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag
                    done={itemByKey.password.done}
                    label={itemByKey.password.statusLabel}
                    tone={itemByKey.password.tone}
                  />
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeSection === 'password' ? 'rotate-90 text-emerald-600' : ''
                    }`}
                  />
                </div>
              </button>

              {activeSection === 'password' && (
                <div className="px-4 sm:px-5 pb-4 pt-2 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
                  {resetSent && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Đã gửi liên kết đặt lại mật khẩu tới {maskVerifiedValue(currentUser.email, 'email')}.</span>
                    </div>
                  )}

                  {!hasPasswordProvider && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                      Tài khoản đăng nhập bằng Google chưa có mật khẩu cũ. Sau khi tạo mật khẩu tại đây, mọi lần đổi mật khẩu tiếp theo đều yêu cầu nhập mật khẩu cũ.
                    </div>
                  )}

                  <form onSubmit={handlePasswordSubmit} className="space-y-2.5">
                    {hasPasswordProvider && (
                      <div className="space-y-1">
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                          Mật khẩu cũ (hiện tại) *
                        </label>
                        <div className="relative">
                          <input
                            type={showPwdChars ? 'text' : 'password'}
                            autoComplete="current-password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Nhập mật khẩu cũ đang sử dụng"
                            className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPwdChars((v) => !v)}
                            className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                            aria-label={showPwdChars ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          >
                            {showPwdChars ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                          Mật khẩu mới *
                        </label>
                        <div className="relative">
                          <input
                            type={showPwdChars ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            minLength={6}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Tối thiểu 6 ký tự"
                            className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPwdChars((v) => !v)}
                            className="absolute right-2.5 top-2.5 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                            aria-label={showPwdChars ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          >
                            {showPwdChars ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                          Xác nhận mật khẩu mới *
                        </label>
                        <input
                          type={showPwdChars ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          minLength={6}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Nhập lại mật khẩu mới"
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={sendingReset}
                        onClick={handleOpenResetGate}
                        className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{resetGateOpen ? 'Đóng xác minh' : 'Quên mật khẩu cũ?'}</span>
                      </button>
                      <button
                        type="submit"
                        disabled={savingPassword}
                        className="min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer disabled:opacity-60"
                      >
                        {savingPassword
                          ? 'Đang lưu...'
                          : hasPasswordProvider
                          ? 'Đổi mật khẩu'
                          : 'Tạo mật khẩu'}
                      </button>
                    </div>
                  </form>

                  {resetGateOpen && (
                    <form
                      onSubmit={handleSendResetEmail}
                      className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 space-y-2.5 animate-in fade-in"
                    >
                      <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                        Xác minh thông tin định danh trước khi gửi liên kết đặt lại mật khẩu
                      </div>
                      <input
                        type="text"
                        inputMode="email"
                        required
                        placeholder="Nhập chính xác Email tài khoản *"
                        value={resetCheckEmail}
                        onChange={(e) => setResetCheckEmail(e.target.value)}
                        onBlur={() => setResetCheckEmail((v) => autoCompleteGmail(v))}
                        className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                      {Boolean(userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser.phoneNumber) && (
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          required
                          placeholder="Nhập chính xác Số điện thoại (10 số) *"
                          value={resetCheckPhone}
                          onChange={(e) => setResetCheckPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                        />
                      )}
                      {Boolean(userProfile?.citizenIdVerified && userProfile?.citizenId) && (
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={15}
                          required
                          placeholder="Nhập chính xác Số CCCD đã xác minh *"
                          value={resetCheckCccd}
                          onChange={(e) => setResetCheckCccd(e.target.value.replace(/\D/g, '').slice(0, 15))}
                          className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                        />
                      )}
                      {!(userProfile?.verifiedPhone || userProfile?.phoneNumber || currentUser.phoneNumber) &&
                        !(userProfile?.citizenIdVerified && userProfile?.citizenId) && (
                        <input
                          type="text"
                          required
                          placeholder="Nhập chính xác Họ và tên tài khoản *"
                          value={resetCheckName}
                          onChange={(e) => setResetCheckName(e.target.value)}
                          className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      )}
                      <button
                        type="submit"
                        disabled={sendingReset}
                        className="w-full min-h-[40px] px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer disabled:opacity-60"
                      >
                        {sendingReset ? 'Đang gửi...' : 'Xác nhận & Gửi liên kết khôi phục'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* ITEM 5: ĐỊNH DANH CCCD / VNEID */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('cccd')}
                className="w-full min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {itemByKey.cccd.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {itemByKey.cccd.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag
                    done={itemByKey.cccd.done}
                    label={itemByKey.cccd.statusLabel}
                    tone={itemByKey.cccd.tone}
                  />
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeSection === 'cccd' ? 'rotate-90 text-indigo-600' : ''
                    }`}
                  />
                </div>
              </button>

              {activeSection === 'cccd' && (
                <div className="px-4 sm:px-5 pb-4 pt-2 bg-slate-50/70 dark:bg-slate-950/40 space-y-2.5">
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-1 min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        {isCitizenIdVerified && <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                        <span>
                          {isCitizenIdVerified
                            ? `Số CCCD đã xác minh: ${maskVerifiedValue(userProfile?.citizenId, 'cccd')}`
                            : 'Chưa xác minh số CCCD / VNeID'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isCitizenIdVerified
                          ? 'Thông tin định danh đã được liên kết và đồng bộ với Định danh y tế cá nhân.'
                          : 'Vui lòng nhập số CCCD tại mục Định danh y tế cá nhân để tra cứu và xác minh.'}
                      </p>
                    </div>
                    {onOpenIdentityCard && (
                      <button
                        type="button"
                        onClick={onOpenIdentityCard}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shrink-0 cursor-pointer"
                      >
                        {isCitizenIdVerified ? 'Xem định danh' : 'Xác minh CCCD'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ITEM 6: QUẢN LÝ THIẾT BỊ ĐÃ XÁC MINH */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('devices')}
                className="w-full min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
                    <Smartphone className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {itemByKey.devices.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
                      {itemByKey.devices.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusTag
                    done={itemByKey.devices.done}
                    label={itemByKey.devices.statusLabel}
                    tone={itemByKey.devices.tone}
                  />
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      activeSection === 'devices' ? 'rotate-90 text-teal-600' : ''
                    }`}
                  />
                </div>
              </button>

              {activeSection === 'devices' && (
                <div className="px-4 sm:px-5 pb-4 pt-2 bg-slate-50/70 dark:bg-slate-950/40 space-y-2.5">
                  {!currentDeviceTrusted && (
                    <button
                      type="button"
                      disabled={verifyingDevice}
                      onClick={handleVerifyCurrentDevice}
                      className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>{verifyingDevice ? 'Đang xác minh...' : 'Xác minh thiết bị này'}</span>
                    </button>
                  )}

                  {verifiedDevices.length === 0 ? (
                    <div className="py-4 text-center text-slate-500 dark:text-slate-400">
                      Chưa ghi nhận thiết bị nào.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200/80 dark:divide-slate-800 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                      {verifiedDevices.map((dev) => {
                        const isCurrent = dev.deviceId === currentDeviceId;
                        const isEditing = editingDeviceId === dev.deviceId;
                        const isRemoving = removingDeviceId === dev.deviceId;
                        const isMobileOs = /Android|iOS|iPhone|iPad/i.test(dev.os || '');
                        return (
                          <div key={dev.deviceId} className="p-3.5 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                                  {isMobileOs ? (
                                    <Smartphone className="w-4 h-4" />
                                  ) : (
                                    <Laptop className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                                      {dev.deviceName}
                                    </span>
                                    {isCurrent && (
                                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                                        (Thiết bị này)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                                    {dev.platform} · {formatDeviceMethod(dev.verificationMethod)} ·{' '}
                                    {new Date(dev.lastActiveAt).toLocaleDateString('vi-VN')}
                                  </div>
                                  <div className="mt-1">
                                    <StatusTag
                                      done={dev.isTrusted}
                                      label={dev.isTrusted ? 'Đã xác minh' : 'Chưa xác minh'}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  aria-label="Đổi tên thiết bị"
                                  onClick={() => {
                                    setEditingDeviceId(isEditing ? null : dev.deviceId);
                                    setDeviceRenameInput(dev.deviceName);
                                  }}
                                  className="min-w-[40px] min-h-[40px] rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isRemoving}
                                  aria-label="Gỡ thiết bị"
                                  onClick={() => void handleDeleteDevice(dev.deviceId)}
                                  className="min-w-[40px] min-h-[40px] rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center cursor-pointer disabled:opacity-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {isEditing && (
                              <div className="flex gap-2 pt-1">
                                <input
                                  type="text"
                                  value={deviceRenameInput}
                                  onChange={(e) => setDeviceRenameInput(e.target.value)}
                                  placeholder="Tên thiết bị mới..."
                                  className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSaveRenameDevice(dev.deviceId)}
                                  className="min-h-[40px] px-3 rounded-xl bg-emerald-700 text-white font-bold cursor-pointer"
                                >
                                  Lưu
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
