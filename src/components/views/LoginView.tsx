import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { StationLogo } from '../common/StationLogo';
import { UserAvatar } from '../common/UserAvatar';
import { UserProfile } from '../../types';
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
  Ticket,
} from 'lucide-react';
import {
  getPendingReferralCode,
  setPendingReferralCode,
  captureReferralCodeFromUrl,
} from '../../contexts/AuthContext';
import {
  autoCompleteGmail,
  isValidEmailAddress,
  normalizeAndValidatePhone,
  maskVerifiedValue,
  verifyUnauthenticatedPasswordResetIdentity,
} from '../../utils/verifiedIdentity';
import { formatFirebaseGoogleAuthError } from '../../utils/smsMfaUtils';

interface LoginViewProps {
  onSuccessNavigate?: (view: string) => void;
}

const REMEMBERED_LOGIN_KEY = 'tyt_remembered_login_v1';

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
        // Center-crop square
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

export const LoginView: React.FC<LoginViewProps> = ({ onSuccessNavigate }) => {
  const {
    currentUser,
    userProfile,
    signInWithGoogle,
    loginWithEmail,
    registerWithEmail,
    sendPasswordReset,
    logout,
    updateProfileData,
    isPrimaryAdmin,
  } = useAuth();
  const { showToast } = useToast();

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
  const [rememberMe, setRememberMe] = useState(savedCreds.remember);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forgot password inline mode (unauthenticated)
  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState(savedCreds.email);
  const [resetPhone, setResetPhone] = useState('');
  const [resetCccd, setResetCccd] = useState('');
  const [sendingReset, setSendingReset] = useState(false);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  // Identity verification gate for signed-in password reset
  const [resetGateOpen, setResetGateOpen] = useState(false);
  const [resetCheckEmail, setResetCheckEmail] = useState('');
  const [resetCheckPhone, setResetCheckPhone] = useState('');
  const [resetCheckCccd, setResetCheckCccd] = useState('');
  const [resetCheckName, setResetCheckName] = useState('');

  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Profile completion state for authenticated users
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

  useEffect(() => {
    if (currentUser || userProfile) {
      setProfileForm({
        displayName: userProfile?.displayName || currentUser?.displayName || '',
        phoneNumber: userProfile?.phoneNumber || currentUser?.phoneNumber || '',
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
    }
  }, [currentUser, userProfile]);

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
      await loginWithEmail(cleanEmail, password, rememberMe);
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
      showToast('success', 'Đăng nhập thành công', cleanEmail);
      if (onSuccessNavigate) {
        onSuccessNavigate('portal');
      }
    } catch (err: any) {
      showToast('error', 'Xác thực thất bại', err?.message || 'Vui lòng kiểm tra lại thông tin');
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
      showToast(
        'success',
        'Đăng ký thành công!',
        'Tiếp tục xác minh Gmail và xác nhận Số điện thoại trong mục Tài khoản.'
      );
      if (onSuccessNavigate) {
        onSuccessNavigate('account');
      }
    } catch (err: any) {
      const msg = String(err?.code || err?.message || '');
      if (msg.includes('email-already-in-use')) {
        showToast('error', 'Email đã được đăng ký');
      } else {
        showToast('error', 'Đăng ký thất bại', err?.message || 'Vui lòng thử lại.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    try {
      await signInWithGoogle();
      showToast('success', 'Đăng nhập Google thành công');
      if (onSuccessNavigate) {
        onSuccessNavigate('portal');
      }
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
      setResetSentTo(check.normalizedEmail);
      showToast(
        'success',
        'Đã gửi liên kết đặt lại mật khẩu',
        'Kiểm tra hộp thư Gmail hoặc thư mục Spam để mở liên kết đặt mật khẩu mới.'
      );
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('user-not-found')) {
        showToast('error', 'Không tìm thấy tài khoản', 'Email này chưa được đăng ký trong hệ thống.');
      } else {
        showToast('error', 'Không thể gửi email đặt lại mật khẩu', msg || 'Vui lòng thử lại sau.');
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
        'Kiểm tra hộp thư Gmail hoặc thư mục Spam để mở liên kết.'
      );
    } catch (err: any) {
      showToast('error', 'Không thể gửi email đặt lại mật khẩu', err?.message || 'Vui lòng thử lại sau.');
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
    setSavingProfile(true);
    try {
      await updateProfileData(profileForm);
      showToast('success', 'Đã cập nhật hồ sơ người dùng', 'Thông tin định danh & ảnh đại diện của bạn đã được đồng bộ với hệ thống Trạm.');
    } catch (err: any) {
      showToast('error', 'Cập nhật thất bại', err?.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const hasGoogleProvider = Boolean(
    currentUser?.providerData?.some(p => p.providerId === 'google.com')
  );

  // If already logged in, show User Profile & Verification Dashboard
  if (currentUser) {
    const activeAvatar = profileForm.avatarUrl || userProfile?.avatarUrl || currentUser.photoURL || '';
    const displayName = userProfile?.displayName || currentUser.displayName || currentUser.email || 'Người dùng';

    return (
      <div className="max-w-4xl mx-auto py-8 px-4 animate-in fade-in duration-200 space-y-6">
        {/* Verification Status Banner */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-4">
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
                className="relative group shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer disabled:opacity-60"
                title="Nhấn để thay đổi ảnh đại diện"
              >
                <UserAvatar
                  src={activeAvatar}
                  name={displayName}
                  size={64}
                  isPrimaryAdmin={isPrimaryAdmin}
                  showAdminRing
                  rounded="2xl"
                />
                <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-600 text-white border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-xs group-hover:bg-emerald-700 transition">
                  <Camera className="w-3 h-3" />
                </span>
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    {displayName}
                  </h2>
                  {isPrimaryAdmin ? (
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> Super Admin Hệ Thống
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      {userProfile?.accountType === 'employee' ? 'Cán bộ Y tế' : 'Tài khoản Người dân'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                  <span>
                    Email:{' '}
                    <strong className="text-slate-700 dark:text-slate-300">
                      {currentUser.emailVerified || userProfile?.emailVerified || hasGoogleProvider
                        ? maskVerifiedValue(currentUser.email, 'email')
                        : currentUser.email}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>Mã định danh UID: <code className="text-[11px] font-mono">{currentUser.uid.slice(0, 10)}...</code></span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {savingAvatar ? 'Đang cập nhật ảnh đại diện...' : 'Nhấn vào ảnh đại diện bên trái để thay đổi AVT'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {currentUser.email && (
                <button
                  type="button"
                  disabled={sendingReset}
                  onClick={() => setResetGateOpen(v => !v)}
                  className="px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  title="Xác minh thông tin để gửi đường dẫn đặt / tạo mật khẩu qua Gmail"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{sendingReset ? 'Đang gửi...' : 'Đặt lại mật khẩu'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => logout()}
                className="px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Đăng xuất
              </button>
            </div>
          </div>

          {resetGateOpen && currentUser.email && (
            <form
              onSubmit={handleVerifiedSignedInPasswordReset}
              className="mt-4 p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-800/70 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  <span>Xác minh thông tin trước khi gửi liên kết đặt lại mật khẩu</span>
                </p>
                <button
                  type="button"
                  onClick={() => setResetGateOpen(false)}
                  className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 font-semibold cursor-pointer"
                >
                  Đóng
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  inputMode="email"
                  required
                  value={resetCheckEmail}
                  onChange={e => setResetCheckEmail(e.target.value)}
                  onBlur={() => setResetCheckEmail(v => autoCompleteGmail(v))}
                  placeholder="Nhập chính xác Gmail / Email tài khoản *"
                  className="w-full px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {(userProfile?.verifiedPhone || userProfile?.phoneNumber) ? (
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={resetCheckPhone}
                    onChange={e => setResetCheckPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="Số điện thoại (10 số) đã lưu"
                    className="w-full px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                ) : null}
                {userProfile?.citizenId ? (
                  <input
                    type="text"
                    maxLength={12}
                    value={resetCheckCccd}
                    onChange={e => setResetCheckCccd(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    placeholder="Hoặc số CCCD đã lưu"
                    className="w-full px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                ) : null}
                {!(userProfile?.verifiedPhone || userProfile?.phoneNumber || userProfile?.citizenId) && (
                  <input
                    type="text"
                    required
                    value={resetCheckName}
                    onChange={e => setResetCheckName(e.target.value)}
                    placeholder="Họ và tên đã đăng ký *"
                    className="w-full px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sendingReset}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingReset ? 'Đang gửi...' : 'Xác nhận & Gửi liên kết'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Security & Password Reset Feedback */}
          {(hasGoogleProvider || resetSentTo) && (
            <div className="mt-4 p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  {resetSentTo ? (
                    <>
                      <strong>Đã gửi đường dẫn đặt lại mật khẩu tới Gmail {resetSentTo}.</strong>{' '}
                      Mở Gmail (hoặc thư mục Spam) và nhấn vào liên kết của hệ thống để thiết lập mật khẩu đăng nhập trực tiếp.
                    </>
                  ) : (
                    <>
                      Bạn đang đăng nhập qua <strong>Google ({maskVerifiedValue(currentUser.email, 'email')})</strong>. Bấm <strong>“Đặt lại mật khẩu”</strong> và xác minh thông tin để nhận đường dẫn thiết lập/đổi mật khẩu gửi về Gmail của bạn.
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Quick Notice */}
          <div className="mt-4 p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/80 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
            <div className="text-xs text-teal-900 dark:text-teal-200 leading-relaxed">
              <strong>Tài khoản đã được xác thực an toàn.</strong> Để hoàn thiện hồ sơ phục vụ liên thông ứng dụng Bác sĩ cho mọi nhà và tra cứu hồ sơ sức khỏe cơ sở, vui lòng cập nhật số thẻ CCCD và địa chỉ bên dưới (nhấn vào ảnh đại diện phía trên để đổi AVT).
            </div>
          </div>
        </div>

        {/* User Information Form */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-5">
            <User className="w-5 h-5 text-emerald-600" />
            Thông Tin Chi Tiết & Định Danh Y Tế
          </h3>

          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Họ và Tên đầy đủ *
              </label>
              <input
                type="text"
                required
                value={profileForm.displayName || ''}
                onChange={e => setProfileForm({ ...profileForm, displayName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Số Căn cước công dân (CCCD / VNeID) *
                </label>
                {userProfile?.citizenIdVerified && !isPrimaryAdmin && userProfile?.role !== 'super_admin' && (
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span>Đã xác minh</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  maxLength={12}
                  readOnly={Boolean(
                    userProfile?.citizenIdVerified &&
                      !isPrimaryAdmin &&
                      userProfile?.role !== 'super_admin' &&
                      !userProfile?.allowIdentityEditByAdmin
                  )}
                  disabled={Boolean(
                    userProfile?.citizenIdVerified &&
                      !isPrimaryAdmin &&
                      userProfile?.role !== 'super_admin' &&
                      !userProfile?.allowIdentityEditByAdmin
                  )}
                  value={
                    userProfile?.citizenIdVerified &&
                    !isPrimaryAdmin &&
                    userProfile?.role !== 'super_admin' &&
                    !userProfile?.allowIdentityEditByAdmin
                      ? maskVerifiedValue(profileForm.citizenId || userProfile.citizenId, 'cccd')
                      : profileForm.citizenId || ''
                  }
                  onChange={e => setProfileForm({ ...profileForm, citizenId: e.target.value })}
                  placeholder="12 chữ số định danh cá nhân"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono disabled:opacity-70"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Số điện thoại liên lạc (10 số) *
                </label>
                {userProfile?.phoneVerified && !isPrimaryAdmin && userProfile?.role !== 'super_admin' && (
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span>Đã xác nhận</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  readOnly={Boolean(
                    userProfile?.phoneVerified &&
                      !isPrimaryAdmin &&
                      userProfile?.role !== 'super_admin' &&
                      !userProfile?.allowIdentityEditByAdmin
                  )}
                  disabled={Boolean(
                    userProfile?.phoneVerified &&
                      !isPrimaryAdmin &&
                      userProfile?.role !== 'super_admin' &&
                      !userProfile?.allowIdentityEditByAdmin
                  )}
                  value={
                    userProfile?.phoneVerified &&
                    !isPrimaryAdmin &&
                    userProfile?.role !== 'super_admin' &&
                    !userProfile?.allowIdentityEditByAdmin
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
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ngày sinh
                </label>
                <input
                  type="date"
                  value={profileForm.dob || ''}
                  onChange={e => setProfileForm({ ...profileForm, dob: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Giới tính
                </label>
                <select
                  value={profileForm.gender || 'Nam'}
                  onChange={e => setProfileForm({ ...profileForm, gender: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>
            </div>

            <div className="col-span-full">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Địa chỉ thường trú / Nơi ở hiện tại (Tổ dân phố / Ấp, Xã/Phường)
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={profileForm.address || ''}
                  onChange={e => setProfileForm({ ...profileForm, address: e.target.value })}
                  placeholder="Số nhà, đường, Khu phố/Tổ dân phố..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* If staff / employee or admin */}
            {(userProfile?.accountType === 'employee' || isPrimaryAdmin) && (
              <>
                <div className="col-span-full pt-3 border-t border-slate-100 dark:border-slate-800">
                  <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Stethoscope className="w-4 h-4" /> Thông Tin Nhân Sự Y Tế
                  </h4>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Khoa / Phòng / Tổ công tác
                  </label>
                  <input
                    type="text"
                    value={profileForm.department || ''}
                    onChange={e => setProfileForm({ ...profileForm, department: e.target.value })}
                    placeholder="Khoa Khám bệnh, Tổ Dược - Tiêm chủng, Y tế công cộng..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Chức danh / Vị trí việc làm
                  </label>
                  <input
                    type="text"
                    value={profileForm.position || ''}
                    onChange={e => setProfileForm({ ...profileForm, position: e.target.value })}
                    placeholder="Bác sĩ trưởng trạm, Điều dưỡng viên, Y sĩ đa khoa..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="col-span-full">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Trình độ chuyên môn & Chứng chỉ hành nghề
                  </label>
                  <input
                    type="text"
                    value={profileForm.qualification || ''}
                    onChange={e => setProfileForm({ ...profileForm, qualification: e.target.value })}
                    placeholder="Bác sĩ Chuyên khoa I Nội, Cử nhân Điều dưỡng, CCHN số..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </>
            )}

            <div className="col-span-full flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-6 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition cursor-pointer"
              >
                {savingProfile ? 'Đang lưu hồ sơ...' : 'Lưu thông tin định danh'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Not logged in: Show Login card (with Remember Me & Forgot Password)
  return (
    <div className="max-w-md mx-auto py-12 px-4 animate-in fade-in duration-200">
      <div className="text-center mb-8">
        <StationLogo size={68} className="mx-auto mb-3" />
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Cổng Xác Thực & Đăng Nhập
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
          Đăng nhập dành cho Cán bộ Y tế & Quản trị viên hệ thống Trạm Y tế
        </p>
      </div>

      {/* Auth Card */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        {forgotMode ? (
          <div className="space-y-4 text-xs animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-600" />
                Khôi Phục / Đặt Lại Mật Khẩu
              </h2>
              <button
                type="button"
                onClick={() => {
                  setForgotMode(false);
                  setResetSentTo(null);
                }}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lại
              </button>
            </div>

            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Vui lòng nhập chính xác địa chỉ Gmail cùng Số điện thoại (10 số) hoặc Số CCCD đã xác minh để hệ thống đối chiếu trước khi gửi liên kết khôi phục mật khẩu.
            </p>

            {resetSentTo && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Đã gửi liên kết đặt lại mật khẩu tới <strong>{maskVerifiedValue(resetSentTo, 'email')}</strong>. Vui lòng kiểm tra hộp thư đến hoặc mục Spam.
                </span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendUnauthPasswordReset();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Địa chỉ Email / Gmail *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    inputMode="email"
                    required
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    onBlur={() => setResetEmail(v => autoCompleteGmail(v))}
                    placeholder="tenban (tự thêm @gmail.com)"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Số điện thoại đã xác minh (10 số)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={resetPhone}
                    onChange={e => setResetPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="0912345678 (10 chữ số)"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Hoặc Số CCCD đã xác minh
                </label>
                <div className="relative">
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={12}
                    value={resetCccd}
                    onChange={e => setResetCccd(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    placeholder="Nhập 12 chữ số CCCD nếu đối chiếu bằng CCCD"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={sendingReset}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sendingReset ? 'Đang gửi liên kết...' : 'Đối chiếu & Gửi đường dẫn'}</span>
              </button>
            </form>
          </div>
        ) : (
          <>
            {/* Segmented Login / Register Switch */}
            <div className="p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 grid grid-cols-2 gap-1 mb-4">
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className={`min-h-[40px] rounded-xl text-xs font-bold transition cursor-pointer ${
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
                className={`min-h-[40px] rounded-xl text-xs font-bold transition cursor-pointer ${
                  authMode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Đăng ký tài khoản
              </button>
            </div>

            {/* Google Auth Button */}
            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogleSignIn}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition flex items-center justify-center gap-2 mb-4 cursor-pointer"
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

            <div className="relative flex py-2 items-center mb-4">
              <div className="flex-grow border-t border-slate-100 dark:border-slate-800" />
              <span className="flex-shrink mx-3 text-[10px] text-slate-400 uppercase font-semibold">
                hoặc email
              </span>
              <div className="flex-grow border-t border-slate-100 dark:border-slate-800" />
            </div>

            {authMode === 'login' ? (
              <form onSubmit={handleAuthSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Địa chỉ Email *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      inputMode="email"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      onBlur={() => setEmail(v => autoCompleteGmail(v))}
                      placeholder="tenban (tự thêm @gmail.com) hoặc email khác"
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Mật khẩu *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[44px] pl-9 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-0.5">
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
                  className="w-full min-h-[44px] mt-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition cursor-pointer"
                >
                  {submitting ? 'Đang xử lý...' : 'Đăng nhập'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs">
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
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
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
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
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
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
                  <Ticket className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
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
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mật khẩu (>= 6 ký tự) *"
                    className="w-full min-h-[44px] pl-9 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
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
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition cursor-pointer"
                >
                  {submitting ? 'Đang tạo tài khoản...' : 'Đăng ký & Xác minh'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
};
