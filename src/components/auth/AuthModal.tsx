import React, { useState, useEffect } from 'react';
import {
  X,
  AlertCircle,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
  Eye,
  EyeOff,
  User,
  Phone,
  Ticket,
  ShieldCheck,
} from 'lucide-react';
import {
  useAuth,
  getPendingReferralCode,
  setPendingReferralCode,
  captureReferralCodeFromUrl,
} from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  autoCompleteGmail,
  isValidEmailAddress,
  normalizeAndValidatePhone,
  verifyUnauthenticatedPasswordResetIdentity,
} from '../../utils/verifiedIdentity';
import { formatFirebaseGoogleAuthError } from '../../utils/smsMfaUtils';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisteredNavigate?: () => void;
}

const REMEMBERED_LOGIN_KEY = 'tyt_remembered_login_v1';

function getSavedLogin(): { email: string; password: string; remember: boolean } {
  try {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    if (!raw) return { email: '', password: '', remember: true };
    const p = JSON.parse(raw);
    return {
      email: typeof p.email === 'string' ? p.email : '',
      password: typeof p.password === 'string' ? p.password : '',
      remember: p.remember !== false,
    };
  } catch {
    return { email: '', password: '', remember: true };
  }
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onRegisteredNavigate,
}) => {
  const { signInWithGoogle, loginWithEmail, registerWithEmail, sendPasswordReset } = useAuth();
  const { showToast } = useToast();

  const saved = getSavedLogin();
  const initialRef = captureReferralCodeFromUrl() || getPendingReferralCode();
  const [authMode, setAuthMode] = useState<'login' | 'register'>(() =>
    initialRef ? 'register' : 'login'
  );
  const [email, setEmail] = useState(saved.email);
  const [password, setPassword] = useState(saved.password);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [referralCode, setReferralCode] = useState(initialRef);
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(saved.remember);
  const [showPassword, setShowPassword] = useState(false);

  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState(saved.email);
  const [resetPhone, setResetPhone] = useState('');
  const [resetCccd, setResetCccd] = useState('');
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const refFromUrl = captureReferralCodeFromUrl();
    if (refFromUrl) {
      setReferralCode(refFromUrl);
      setAuthMode('register');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleReferralChange = (val: string) => {
    const upper = val.toUpperCase();
    setReferralCode(upper);
    setPendingReferralCode(upper);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setPendingReferralCode(referralCode);
    try {
      const status = await signInWithGoogle();
      onClose();
      if (status === 'mfa_required') return;
      if (authMode === 'register' && onRegisteredNavigate) {
        onRegisteredNavigate();
      }
    } catch (err: any) {
      setError(formatFirebaseGoogleAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanEmail = autoCompleteGmail(email);
    setEmail(cleanEmail);
    if (!isValidEmailAddress(cleanEmail)) {
      setError('Vui lòng nhập địa chỉ Email / Gmail hợp lệ.');
      return;
    }

    setLoading(true);
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
        // ignore
      }
      onClose();
      if (status === 'mfa_required') return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('user-not-found') ||
        msg.includes('wrong-password') ||
        msg.includes('invalid-credential')
      ) {
        setError('Email hoặc mật khẩu không chính xác.');
      } else {
        setError(msg || 'Có lỗi xảy ra trong quá trình xác thực.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanEmail = autoCompleteGmail(email);
    setEmail(cleanEmail);
    if (!isValidEmailAddress(cleanEmail)) {
      setError('Vui lòng nhập địa chỉ Email / Gmail hợp lệ.');
      return;
    }
    if (!regName.trim()) {
      setError('Vui lòng nhập họ và tên.');
      return;
    }
    const cleanPhone = regPhone.trim();
    if (cleanPhone && !normalizeAndValidatePhone(cleanPhone)) {
      setError('Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
      return;
    }
    if (password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    if (password !== regConfirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(true);
    try {
      await registerWithEmail(
        cleanEmail,
        password,
        regName.trim(),
        cleanPhone || undefined,
        referralCode.trim() || undefined
      );
      showToast(
        'success',
        'Đăng ký thành công!',
        referralCode.trim()
          ? 'Tài khoản Cán bộ Y tế đã được kích hoạt. Vui lòng hoàn thiện xác minh bảo mật.'
          : 'Vui lòng xác minh Gmail và xác nhận Số điện thoại trong mục Tài khoản.'
      );
      onClose();
      if (onRegisteredNavigate) {
        onRegisteredNavigate();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('email-already-in-use')) {
        setError('Địa chỉ Email này đã được đăng ký. Vui lòng đăng nhập.');
      } else {
        setError(msg || 'Không thể tạo tài khoản.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSentTo(null);
    const completedEmail = autoCompleteGmail(resetEmail);
    setResetEmail(completedEmail);

    if (resetPhone.trim() && !normalizeAndValidatePhone(resetPhone.trim())) {
      setError('Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
      return;
    }

    setLoading(true);
    try {
      const verification = await verifyUnauthenticatedPasswordResetIdentity({
        email: completedEmail,
        phone: resetPhone.trim() || undefined,
        cccd: resetCccd.trim() || undefined,
      });
      if (!verification.ok) {
        setError(verification.error || 'Thông tin xác minh không khớp.');
        return;
      }

      await sendPasswordReset(verification.normalizedEmail);
      setResetSentTo(verification.normalizedEmail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('user-not-found')) {
        setError('Không tìm thấy tài khoản nào khớp với email này.');
      } else {
        setError(msg || 'Không thể gửi email đặt lại mật khẩu.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {forgotMode
                ? 'Khôi phục mật khẩu'
                : authMode === 'register'
                ? 'Đăng ký tài khoản'
                : 'Đăng nhập'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {forgotMode
                ? 'Đối chiếu chính xác thông tin đã xác minh trước khi gửi liên kết'
                : authMode === 'register'
                ? 'Đăng ký & xác minh danh tính từng bước'
                : 'Cổng Thông Tin Trạm Y Tế'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="min-w-[40px] min-h-[40px] rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Container */}
        <div className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {forgotMode ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setForgotMode(false);
                  setError(null);
                  setResetSentTo(null);
                }}
                className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 font-semibold cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Quay lại</span>
              </button>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  Vui lòng nhập đầy đủ Email và Số điện thoại (10 số) hoặc Số CCCD đã xác minh trùng khớp với tài khoản để nhận liên kết khôi phục.
                </span>
              </div>

              {resetSentTo && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>Đã gửi liên kết đặt lại mật khẩu tới {resetSentTo}.</span>
                </div>
              )}

              <form onSubmit={handleForgotSubmit} className="space-y-2.5">
                <input
                  type="text"
                  inputMode="email"
                  required
                  placeholder="Email / Tên Gmail (tự thêm @gmail.com) *"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  onBlur={() => setResetEmail((v) => autoCompleteGmail(v))}
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                />
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="Số điện thoại đã xác minh (10 số)"
                  value={resetPhone}
                  onChange={(e) => setResetPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={15}
                  placeholder="Hoặc Số CCCD đã xác minh (nếu có)"
                  value={resetCccd}
                  onChange={(e) => setResetCccd(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{loading ? 'Đang kiểm tra & gửi...' : 'Xác minh & Gửi liên kết'}</span>
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* Segmented Switch */}
              <div className="p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                  }}
                  className={`min-h-[40px] rounded-xl font-bold transition cursor-pointer ${
                    authMode === 'login'
                      ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Đăng nhập
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setError(null);
                  }}
                  className={`min-h-[40px] rounded-xl font-bold transition cursor-pointer ${
                    authMode === 'register'
                      ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Đăng ký
                </button>
              </div>

              {referralCode.trim() && (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                  <Ticket className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>
                    Đang áp dụng mã giới thiệu <strong>{referralCode.trim()}</strong> · Tài khoản mới sẽ được cấp quyền <strong>Cán bộ Y tế</strong>.
                  </span>
                </div>
              )}

              {/* Google Sign-In */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.7-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{authMode === 'register' ? 'Đăng ký với Google' : 'Tiếp tục với Google'}</span>
              </button>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-slate-200 dark:border-slate-800 w-full"></div>
                <span className="bg-white dark:bg-slate-900 px-3 text-[10px] text-slate-400 uppercase font-mono">
                  Hoặc
                </span>
              </div>

              {authMode === 'login' ? (
                <form onSubmit={handleLoginSubmit} className="space-y-3">
                  <input
                    type="text"
                    inputMode="email"
                    required
                    autoComplete="username"
                    placeholder="Email / Tên Gmail (tự thêm @gmail.com) *"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setEmail((v) => autoCompleteGmail(v))}
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                  />

                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Mật khẩu *"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[44px] pl-3.5 pr-10 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                      />
                      <span className="font-medium">Nhớ mật khẩu</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(autoCompleteGmail(email));
                        setError(null);
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
                    disabled={loading}
                    className="w-full min-h-[44px] py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>{loading ? 'Đang xử lý...' : 'Đăng nhập'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegisterSubmit} className="space-y-2.5">
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      required
                      placeholder="Họ và tên *"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                    />
                  </div>

                  <input
                    type="text"
                    inputMode="email"
                    required
                    placeholder="Email / Tên Gmail (tự thêm @gmail.com) *"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setEmail((v) => autoCompleteGmail(v))}
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                  />

                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="Số điện thoại 10 số (tuỳ chọn)"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono"
                    />
                  </div>

                  <div className="relative">
                    <Ticket className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      placeholder="Mã giới thiệu Cán bộ Y tế (tuỳ chọn)"
                      value={referralCode}
                      onChange={(e) => handleReferralChange(e.target.value)}
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono uppercase"
                    />
                  </div>

                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      placeholder="Mật khẩu (>= 6 ký tự) *"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[44px] pl-3.5 pr-10 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    placeholder="Nhập lại mật khẩu *"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                  />

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full min-h-[44px] py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>{loading ? 'Đang tạo tài khoản...' : 'Đăng ký & Xác minh'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
