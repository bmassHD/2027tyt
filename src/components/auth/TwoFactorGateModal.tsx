import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  KeyRound,
  Lock,
  LogOut,
  AlertCircle,
  Eye,
  EyeOff,
  Smartphone,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { UserAvatar } from '../common/UserAvatar';
import { VerifiedBlueTick } from '../common/VerifiedBlueTick';
import { getUserVerificationProgress } from '../../utils/verificationBadge';
import { getTotpRemainingSeconds } from '../../utils/totp';

export const TwoFactorGateModal: React.FC = () => {
  const {
    currentUser,
    userProfile,
    isPrimaryAdmin,
    isAdmin,
    isBanned,
    hasPasswordProvider,
    hasGoogleProvider,
    twoFactorEnabled,
    smsMfaEnabled,
    totpConfig,
    requiresTwoFactorVerification,
    twoFactorLoading,
    verifySessionTwoFactorOtp,
    linkEmailPassword,
    registerOrVerifyCurrentDevice,
    logout,
  } = useAuth();
  const { showToast } = useToast();

  const [authMethod, setAuthMethod] = useState<'totp' | 'recovery'>('totp');
  const [otpInput, setOtpInput] = useState('');

  // Post-OTP forced password setup for Google quick-login accounts without password
  const [needsPasswordSetupAfterOtp, setNeedsPasswordSetupAfterOtp] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(getTotpRemainingSeconds);

  useEffect(() => {
    if (!requiresTwoFactorVerification) return;
    const timer = setInterval(() => {
      setRemainingSec(getTotpRemainingSeconds());
    }, 1000);
    return () => clearInterval(timer);
  }, [requiresTwoFactorVerification]);

  // Reset modal internal state cleanly when user signs out or finishes
  useEffect(() => {
    if (!currentUser) {
      setOtpInput('');
      setError(null);
      setNeedsPasswordSetupAfterOtp(false);
      setNewPassword('');
      setConfirmNewPassword('');
    }
  }, [currentUser]);

  // Đặc cách bỏ qua xác thực 2FA đối với Admin / Super Admin; không hiển thị trên tài khoản đang bị Ban
  const isAdminExempt = Boolean(
    isPrimaryAdmin ||
      isAdmin ||
      userProfile?.role === 'super_admin' ||
      userProfile?.role === 'admin' ||
      userProfile?.accountType === 'admin'
  );

  const shouldLock =
    Boolean(currentUser) &&
    !isBanned &&
    !isAdminExempt &&
    (requiresTwoFactorVerification ||
      needsPasswordSetupAfterOtp ||
      (twoFactorLoading && Boolean(userProfile?.twoFactorEnabled)));

  if (!shouldLock || !currentUser) return null;

  const displayName =
    userProfile?.displayName || currentUser.displayName || currentUser.email || 'Người dùng';
  const avatarUrl = userProfile?.avatarUrl || currentUser.photoURL || '';

  const handleVerifyGate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await verifySessionTwoFactorOtp(otpInput);
      if (!res.ok) {
        setError(res.error || 'Mã OTP không hợp lệ.');
        setSubmitting(false);
        return;
      }

      await registerOrVerifyCurrentDevice('totp_2fa');

      if (res.usedRecoveryCode) {
        showToast(
          'warning',
          'Đã mở khóa bằng mã khôi phục',
          'Mã khôi phục này đã tự động hủy.'
        );
      } else {
        showToast('success', 'Xác thực 2FA thành công');
      }

      // If account signed in quickly via Google and has no password linked yet, guide to set one immediately
      if (!hasPasswordProvider) {
        setNeedsPasswordSetupAfterOtp(true);
        setOtpInput('');
        setSubmitting(false);
        return;
      }

      setOtpInput('');
    } catch (err: any) {
      setError(err?.message || 'Không thể xác thực phiên đăng nhập.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPasswordAfterOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSubmitting(true);
    try {
      await linkEmailPassword(newPassword);
      showToast(
        'success',
        'Đã thiết lập mật khẩu thành công!',
        'Tài khoản của bạn hiện đã có đầy đủ Mật khẩu + Khoá 2FA Authenticator.'
      );
      setNeedsPasswordSetupAfterOtp(false);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setError(err?.message || 'Không thể thiết lập mật khẩu. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Security Banner */}
        <div className="p-5 bg-gradient-to-br from-emerald-800 via-teal-800 to-slate-900 text-white">
          <div className="flex items-center gap-3.5">
            <UserAvatar
              src={avatarUrl}
              name={displayName}
              size={52}
              isPrimaryAdmin={isPrimaryAdmin}
              showAdminRing
              rounded="2xl"
            />
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-200 mb-0.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Khoá bảo mật 2FA</span>
              </div>
              <h2 className="text-base font-extrabold truncate flex items-center gap-1.5">
                <span className="truncate">{displayName}</span>
                {getUserVerificationProgress(userProfile, {
                  emailVerified: currentUser.emailVerified,
                  hasGoogleProvider,
                  hasPasswordProvider,
                  twoFactorEnabled,
                  smsMfaEnabled,
                  phoneNumber:
                    userProfile?.verifiedPhone ||
                    userProfile?.phoneNumber ||
                    currentUser.phoneNumber,
                }).isFullyVerified && <VerifiedBlueTick size="sm" />}
              </h2>
              <p className="text-xs text-emerald-100/90 truncate flex items-center gap-1">
                <span className="truncate">{currentUser.email}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-4 text-xs">
          {twoFactorLoading && !totpConfig ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-8 h-8 border-2 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin mx-auto" />
              <p className="text-slate-500 dark:text-slate-400 font-medium">
                Đang kiểm tra trạng thái khoá bảo mật 2FA...
              </p>
            </div>
          ) : needsPasswordSetupAfterOtp ? (
            /* Post-OTP Password Setup for Google Quick-Login users missing a password */
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Hoàn tất mật khẩu dự phòng (Google Quick Login)</p>
                  <p className="text-[11px] leading-relaxed">
                    Tài khoản của bạn vừa đăng nhập nhanh bằng Google và chưa có mật khẩu riêng. Hãy thiết lập mật khẩu để dùng song song với 2FA và khôi phục khi cần.
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSetPasswordAfterOtp} className="space-y-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Mật khẩu mới (tối thiểu 6 ký tự) *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Nhập mật khẩu tài khoản..."
                      className="w-full min-h-[42px] pl-9 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Xác nhận mật khẩu *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Nhập lại mật khẩu..."
                      className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{submitting ? 'Đang lưu...' : 'Lưu mật khẩu & Vào hệ thống'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNeedsPasswordSetupAfterOtp(false)}
                    className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Để sau
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* Verification Method Selector & Gate Form (OTP or Recovery Code only) */
            <form onSubmit={handleVerifyGate} className="space-y-4">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">
                  Chọn 1 phương thức xác thực để mở khóa phiên:
                </p>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMethod('totp');
                      setOtpInput('');
                      setError(null);
                    }}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      authMethod === 'totp'
                        ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5 shrink-0" />
                    <span>Mã OTP</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMethod('recovery');
                      setOtpInput('');
                      setError(null);
                    }}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      authMethod === 'recovery'
                        ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                    <span>Mã khôi phục</span>
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-slate-600 dark:text-slate-300">
                {authMethod === 'recovery' ? (
                  <KeyRound className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Smartphone className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                )}
                <p className="text-xs leading-relaxed">
                  {authMethod === 'recovery'
                    ? 'Nhập mã khôi phục dự phòng (XXXX-XXXX).'
                    : 'Nhập mã 6 số từ ứng dụng Google / Microsoft Authenticator.'}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-700 dark:text-slate-200">
                    {authMethod === 'recovery' ? 'Mã khôi phục dự phòng *' : 'Mã OTP 6 chữ số *'}
                  </label>
                  {authMethod === 'totp' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                      <Clock className="w-3 h-3" />
                      <span>Đổi mã sau {remainingSec}s</span>
                    </span>
                  )}
                </div>

                {authMethod === 'recovery' ? (
                  <input
                    type="text"
                    required
                    autoFocus
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.toUpperCase())}
                    placeholder="Ví dụ: ABCD-1234"
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-center text-base font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    maxLength={6}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full min-h-[52px] px-4 py-2.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-center text-2xl font-extrabold tracking-[0.45em] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                )}
              </div>

              {!hasPasswordProvider && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Đăng nhập nhanh Google chưa có mật khẩu riêng. Sau khi nhập OTP, hệ thống sẽ hướng dẫn bạn đặt mật khẩu bổ sung.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  (authMethod === 'totp' && otpInput.length < 6) ||
                  (authMethod === 'recovery' && !otpInput.trim())
                }
                className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{submitting ? 'Đang xác thực...' : 'Xác nhận mở khóa phiên'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-end pt-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => logout()}
                  className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 font-semibold cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Đăng xuất</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
