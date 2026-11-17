import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MessageSquareLock,
  Smartphone,
  Send,
  ShieldCheck,
  AlertCircle,
  X,
  RefreshCw,
} from 'lucide-react';
import { PhoneMultiFactorGenerator, PhoneMultiFactorInfo } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatFirebaseSmsMfaError } from '../../utils/smsMfaUtils';

export const SmsMfaChallengeModal: React.FC = () => {
  const {
    pendingSmsMfaResolver,
    clearPendingSmsMfaResolver,
    sendSmsMfaSignInCode,
    resolveSmsMfaSignIn,
  } = useAuth();
  const { showToast } = useToast();

  const [selectedHintIndex, setSelectedHintIndex] = useState(0);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState('');
  const [sendingSms, setSendingSms] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const otpInputRef = useRef<HTMLInputElement | null>(null);

  const phoneHints = useMemo(() => {
    if (!pendingSmsMfaResolver?.hints) return [];
    const filtered = pendingSmsMfaResolver.hints.filter(
      (h): h is PhoneMultiFactorInfo => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
    return filtered.length > 0
      ? filtered
      : (pendingSmsMfaResolver.hints as PhoneMultiFactorInfo[]);
  }, [pendingSmsMfaResolver]);

  useEffect(() => {
    setSelectedHintIndex(0);
    setVerificationId(null);
    setSmsCode('');
    setSendingSms(false);
    setVerifying(false);
    setCooldownSec(0);
    setError(null);
  }, [pendingSmsMfaResolver]);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setTimeout(() => setCooldownSec((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSec]);

  useEffect(() => {
    if (verificationId) {
      window.setTimeout(() => otpInputRef.current?.focus(), 80);
    }
  }, [verificationId]);

  if (!pendingSmsMfaResolver) return null;

  const activeHint = phoneHints[selectedHintIndex] || phoneHints[0];

  const handleSendSms = async () => {
    setSendingSms(true);
    setError(null);
    try {
      const vId = await sendSmsMfaSignInCode(selectedHintIndex);
      setVerificationId(vId);
      setCooldownSec(60);
      showToast(
        'success',
        'Đã gửi mã OTP qua tin nhắn SMS',
        activeHint?.phoneNumber ? `Kiểm tra tin nhắn gửi tới số ${activeHint.phoneNumber}` : undefined
      );
    } catch (err: any) {
      setError(formatFirebaseSmsMfaError(err));
    } finally {
      setSendingSms(false);
    }
  };

  const handleVerifySmsOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationId) return;
    const cleaned = smsCode.replace(/\D/g, '');
    if (cleaned.length < 6) {
      setError('Vui lòng nhập đủ 6 chữ số OTP nhận qua SMS.');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      await resolveSmsMfaSignIn(verificationId, cleaned);
      showToast('success', 'Xác thực SMS MFA thành công', 'Chào mừng bạn đăng nhập hệ thống!');
    } catch (err: any) {
      setError(formatFirebaseSmsMfaError(err));
    } finally {
      setVerifying(false);
    }
  };

  const handleCancel = () => {
    clearPendingSmsMfaResolver();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-gradient-to-br from-sky-700 via-teal-700 to-emerald-800 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-xs flex items-center justify-center shrink-0">
                <MessageSquareLock className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-sky-100/90">
                  Bước 2/2 · Xác thực SMS
                </div>
                <h2 className="text-base font-extrabold leading-tight mt-0.5">
                  Nhập mã OTP qua SMS
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              aria-label="Hủy xác thực SMS"
              className="min-w-[40px] min-h-[40px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-sky-50/90 mt-2.5 leading-snug">
            Nhập mã OTP 6 chữ số gửi về số điện thoại đã liên kết để hoàn tất đăng nhập.
          </p>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Phone selector */}
          {phoneHints.length > 0 && (
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300">
                Số điện thoại nhận mã OTP:
              </label>
              <div className="space-y-2">
                {phoneHints.map((hint, idx) => {
                  const selected = idx === selectedHintIndex;
                  return (
                    <button
                      key={hint.uid || idx}
                      type="button"
                      disabled={Boolean(verificationId)}
                      onClick={() => {
                        setSelectedHintIndex(idx);
                        setError(null);
                      }}
                      className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between gap-3 transition cursor-pointer disabled:opacity-75 ${
                        selected
                          ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-400 dark:border-sky-600 text-sky-950 dark:text-sky-100'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Smartphone className="w-4 h-4 text-sky-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-bold font-mono text-sm">
                            {hint.phoneNumber || 'Số điện thoại bảo mật'}
                          </div>
                          {hint.displayName && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {hint.displayName}
                            </div>
                          )}
                        </div>
                      </div>
                      {selected && (
                        <span className="text-xs font-bold text-sky-700 dark:text-sky-400 shrink-0">
                          Đã chọn
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!verificationId ? (
            <button
              type="button"
              disabled={sendingSms || phoneHints.length === 0}
              onClick={handleSendSms}
              className="w-full min-h-[46px] py-3 px-4 rounded-2xl bg-sky-700 hover:bg-sky-800 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60 shadow-sm"
            >
              {sendingSms ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang gửi tin nhắn SMS...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Gửi mã OTP qua tin nhắn SMS</span>
                </>
              )}
            </button>
          ) : (
            <form onSubmit={handleVerifySmsOtp} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Mã OTP 6 chữ số từ SMS *
                  </label>
                  <button
                    type="button"
                    disabled={sendingSms || cooldownSec > 0}
                    onClick={handleSendSms}
                    className="font-semibold text-sky-700 dark:text-sky-400 hover:underline disabled:text-slate-400 disabled:no-underline cursor-pointer"
                  >
                    {sendingSms
                      ? 'Đang gửi...'
                      : cooldownSec > 0
                      ? `Gửi lại sau ${cooldownSec}s`
                      : 'Gửi lại mã SMS'}
                  </button>
                </div>
                <input
                  ref={otpInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={smsCode}
                  onChange={(e) => {
                    setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (error) setError(null);
                  }}
                  placeholder="• • • • • •"
                  className="w-full min-h-[52px] px-4 py-2 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-2xl font-extrabold tracking-[0.4em] text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <button
                type="submit"
                disabled={verifying || smsCode.length < 6}
                className="w-full min-h-[46px] py-3 px-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{verifying ? 'Đang xác thực...' : 'Xác nhận & Đăng nhập'}</span>
              </button>
            </form>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Bảo mật 2 bước qua Firebase SMS MFA
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
            >
              Hủy &amp; Quay lại
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
