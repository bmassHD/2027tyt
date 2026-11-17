import { UserProfile } from '../types';
import { maskVerifiedValue } from './verifiedIdentity';

export interface VerificationRuntimeFlags {
  emailVerified?: boolean;
  hasGoogleProvider?: boolean;
  hasPasswordProvider?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorLoading?: boolean;
  smsMfaEnabled?: boolean;
  phoneNumber?: string | null;
  trustedDevicesCount?: number;
  currentDeviceTrusted?: boolean;
  isAdmin?: boolean;
}

export interface UserVerificationProgress {
  emailDone: boolean;
  phoneDone: boolean;
  passwordDone: boolean;
  twoFactorDone: boolean;
  citizenIdDone: boolean;
  completedCount: number;
  totalCount: 4;
  percent: number;
  isFullyVerified: boolean;
}

export interface AccountSecuritySyncItem {
  key: 'verify' | 'phone' | 'totp_2fa' | 'password' | 'cccd' | 'devices';
  title: string;
  subtitle: string;
  done: boolean;
  statusLabel: string;
  tone: 'emerald' | 'sky' | 'amber' | 'slate';
  isPillar: boolean;
}

export const ACCOUNT_SECURITY_CARD_TITLE = 'Bảo mật & Xác minh tài khoản';

/**
 * Evaluates the 4 verification pillars of an account:
 * 1. Gmail / Email verified (or linked Google provider)
 * 2. Phone number verified (or active SMS MFA)
 * 3. Password linked
 * 4. 2FA active (Authenticator TOTP or SMS MFA)
 */
export function getUserVerificationProgress(
  profile?: Partial<UserProfile> | null,
  runtime?: VerificationRuntimeFlags
): UserVerificationProgress {
  const emailDone = Boolean(
    runtime?.emailVerified ||
      runtime?.hasGoogleProvider ||
      profile?.emailVerified ||
      profile?.googleLinked
  );

  const phoneDone = Boolean(
    profile?.phoneVerified ||
      runtime?.smsMfaEnabled ||
      profile?.smsMfaEnabled ||
      runtime?.phoneNumber ||
      profile?.verifiedPhone
  );

  const passwordDone = Boolean(
    runtime?.hasPasswordProvider || profile?.hasPasswordLinked
  );

  const twoFactorDone = Boolean(
    runtime?.twoFactorEnabled ||
      profile?.twoFactorEnabled ||
      runtime?.smsMfaEnabled ||
      profile?.smsMfaEnabled
  );

  const citizenIdDone = Boolean(profile?.citizenIdVerified && profile?.citizenId);

  const completedCount =
    (emailDone ? 1 : 0) +
    (phoneDone ? 1 : 0) +
    (passwordDone ? 1 : 0) +
    (twoFactorDone ? 1 : 0);

  return {
    emailDone,
    phoneDone,
    passwordDone,
    twoFactorDone,
    citizenIdDone,
    completedCount,
    totalCount: 4,
    percent: Math.round((completedCount / 4) * 100),
    isFullyVerified: completedCount === 4,
  };
}

/**
 * Returns the synchronized ordered list of security & verification items
 * shared across AccountSecurityCard, AccountDeviceView, and AdminConsoleView.
 */
export function getAccountSecuritySyncItems(
  profile?: Partial<UserProfile> | null,
  runtime?: VerificationRuntimeFlags
): AccountSecuritySyncItem[] {
  const prog = getUserVerificationProgress(profile, runtime);
  const resolvedPhone =
    profile?.verifiedPhone || profile?.phoneNumber || runtime?.phoneNumber || '';
  const resolvedEmail = profile?.email || '';
  const isAdminAccount = Boolean(
    runtime?.isAdmin ||
      profile?.role === 'admin' ||
      profile?.role === 'super_admin' ||
      profile?.accountType === 'admin'
  );
  const devicesCount =
    typeof runtime?.trustedDevicesCount === 'number' ? runtime.trustedDevicesCount : undefined;
  const deviceDone =
    runtime?.currentDeviceTrusted !== undefined
      ? Boolean(runtime.currentDeviceTrusted)
      : Boolean(devicesCount && devicesCount > 0);

  return [
    {
      key: 'verify',
      title: 'Xác minh Gmail / Email',
      subtitle: resolvedEmail
        ? prog.emailDone
          ? maskVerifiedValue(resolvedEmail, 'email')
          : resolvedEmail
        : 'Khoá định danh Gmail duy nhất',
      done: prog.emailDone,
      statusLabel: prog.emailDone ? 'Đã xác minh' : 'Chưa xác minh',
      tone: prog.emailDone ? 'emerald' : 'slate',
      isPillar: true,
    },
    {
      key: 'phone',
      title: 'Số điện thoại',
      subtitle: prog.phoneDone
        ? `Đã xác nhận SĐT (${maskVerifiedValue(resolvedPhone, 'phone') || 'Đã liên kết'})`
        : 'Điền số điện thoại 10 số và bấm xác nhận',
      done: prog.phoneDone,
      statusLabel: prog.phoneDone ? 'Đã xác nhận' : 'Chưa xác nhận',
      tone: prog.phoneDone ? 'emerald' : 'slate',
      isPillar: true,
    },
    {
      key: 'totp_2fa',
      title: 'Khoá 2FA (Authenticator App)',
      subtitle: isAdminAccount
        ? 'Đặc cách Admin: bỏ qua xác thực 2FA khi đăng nhập'
        : 'Google / Microsoft Authenticator OTP 6 số',
      done: prog.twoFactorDone,
      statusLabel: runtime?.twoFactorLoading
        ? 'Đang tải...'
        : prog.twoFactorDone
        ? isAdminAccount
          ? 'Đang bật (Miễn 2FA)'
          : 'Đang bật'
        : isAdminAccount
        ? 'Đặc cách Admin (Miễn 2FA)'
        : 'Chưa bật',
      tone: prog.twoFactorDone ? 'emerald' : isAdminAccount ? 'sky' : 'slate',
      isPillar: true,
    },
    {
      key: 'password',
      title: 'Mật khẩu & Khôi phục',
      subtitle: prog.passwordDone
        ? 'Đổi mật khẩu (yêu cầu mật khẩu cũ) hoặc gửi link khôi phục'
        : 'Tạo mật khẩu đăng nhập trực tiếp',
      done: prog.passwordDone,
      statusLabel: prog.passwordDone ? 'Đã thiết lập' : 'Chưa đặt',
      tone: prog.passwordDone ? 'emerald' : 'slate',
      isPillar: true,
    },
    {
      key: 'cccd',
      title: 'Định danh CCCD / VNeID',
      subtitle: prog.citizenIdDone
        ? `Đã khóa số ${maskVerifiedValue(profile?.citizenId, 'cccd')}`
        : 'Xác minh & khóa số CCCD duy nhất trong hồ sơ',
      done: prog.citizenIdDone,
      statusLabel: prog.citizenIdDone ? 'Đã xác minh' : 'Chưa xác minh',
      tone: prog.citizenIdDone ? 'emerald' : 'slate',
      isPillar: false,
    },
    {
      key: 'devices',
      title: 'Thiết bị đã xác minh',
      subtitle:
        devicesCount !== undefined
          ? `${devicesCount} thiết bị tin cậy đang liên kết`
          : 'Quản lý các thiết bị tin cậy đã đăng nhập',
      done: deviceDone,
      statusLabel: deviceDone ? 'Đã xác minh' : 'Chưa xác minh',
      tone: deviceDone ? 'emerald' : 'slate',
      isPillar: false,
    },
  ];
}
