import React, { useState, useRef } from 'react';
import {
  CreditCard,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Calendar,
  User,
  Clock,
  Copy,
  Check,
  Sparkles,
  History,
} from 'lucide-react';
import { SystemSettings, BhxhCardLookupResult } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  describeBhxhHang,
  describeBhxhTuyen,
  formatBhxhDateTime,
  getNormalizedBhxhHistoryKcb,
  getNormalizedBhxhHistoryKt,
  isValidBhxhDob,
  lookupBhxhCard,
  normalizeBhxhDobInput,
  translateBhxhClientError,
} from '../../services/bhxhService';

interface BhxhLookupViewProps {
  settings: SystemSettings;
}

function isReasonableCalendarDob(normalized: string): boolean {
  if (!isValidBhxhDob(normalized)) return false;
  const currentYear = new Date().getFullYear();
  if (/^\d{4}$/.test(normalized)) {
    const year = Number(normalized);
    return year >= 1900 && year <= currentYear;
  }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || year > currentYear || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export const BhxhLookupView: React.FC<BhxhLookupViewProps> = () => {
  const { currentUser, userProfile } = useAuth();
  const { showToast } = useToast();

  // Form inputs (CCCD / Mã thẻ BHYT, Họ và tên, Ngày sinh)
  const [maThe, setMaThe] = useState('');
  const [hoTen, setHoTen] = useState('');
  const [ngaySinh, setNgaySinh] = useState('');
  const [searchingCard, setSearchingCard] = useState(false);

  // Separate output states (error or card data)
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardResult, setCardResult] = useState<BhxhCardLookupResult | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const maTheInputRef = useRef<HTMLInputElement | null>(null);

  const handlePrefillFromProfile = () => {
    if (!userProfile) return;
    if (userProfile.citizenId) setMaThe(userProfile.citizenId.trim().toUpperCase());
    if (userProfile.displayName) setHoTen(userProfile.displayName.trim());
    if (userProfile.dob) setNgaySinh(normalizeBhxhDobInput(userProfile.dob));
    setCardError(null);
    showToast('info', 'Đã điền thông tin từ hồ sơ cá nhân');
  };

  const handleCardLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setCardError(null);
    setCardResult(null);

    const cleanId = maThe.trim().toUpperCase();
    const cleanName = hoTen.trim().replace(/\s+/g, ' ');
    const rawDob = ngaySinh.trim();
    const normDob = normalizeBhxhDobInput(rawDob);

    if (!cleanId) {
      const msg = 'Vui lòng nhập Số CCCD (12 chữ số) hoặc Mã thẻ BHYT.';
      setCardError(msg);
      showToast('warning', 'Thiếu thông tin tra cứu', msg);
      return;
    }
    if (cleanId.length < 8) {
      const msg = 'Số CCCD hoặc Mã thẻ BHYT chưa đúng định dạng (cần 12 chữ số CCCD hoặc 10–15 ký tự mã thẻ).';
      setCardError(msg);
      showToast('warning', 'Mã định danh chưa hợp lệ', msg);
      return;
    }
    if (!cleanName) {
      const msg = 'Vui lòng nhập đầy đủ Họ và tên có dấu theo CCCD hoặc thẻ BHYT.';
      setCardError(msg);
      showToast('warning', 'Thiếu thông tin tra cứu', msg);
      return;
    }
    if (!rawDob) {
      const msg = 'Vui lòng nhập Ngày sinh (DD/MM/YYYY) hoặc năm sinh (YYYY).';
      setCardError(msg);
      showToast('warning', 'Thiếu thông tin tra cứu', msg);
      return;
    }
    if (!isReasonableCalendarDob(normDob)) {
      const msg = 'Ngày sinh không hợp lệ. Vui lòng nhập theo dạng Ngày/Tháng/Năm (vd: 15/08/1990) hoặc năm sinh 4 chữ số (vd: 1990).';
      setCardError(msg);
      showToast('warning', 'Ngày sinh chưa đúng định dạng', msg);
      return;
    }

    setHoTen(cleanName);
    setNgaySinh(normDob);
    setSearchingCard(true);
    try {
      const res = await lookupBhxhCard({
        maThe: cleanId,
        hoTen: cleanName,
        ngaySinh: normDob,
      });
      setCardResult(res.data);
      const sev = res.data.statusInfo?.severity;
      if (sev === 'valid') {
        showToast('success', 'Tra cứu thẻ BHYT thành công', res.data.statusInfo?.description);
      } else if (sev === 'warning') {
        showToast('warning', `Mã kết quả ${res.data.maKetQua}`, res.data.statusInfo?.description);
      } else {
        showToast('info', `Kết quả mã ${res.data.maKetQua}`, res.data.statusInfo?.description);
      }
    } catch (err: unknown) {
      const msg = translateBhxhClientError(err);
      setCardError(msg);
      showToast('error', 'Tra cứu thông tin BHYT thất bại', msg);
    } finally {
      setSearchingCard(false);
    }
  };

  const handleCopy = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedText(key);
      setTimeout(() => setCopiedText(null), 1800);
      showToast('success', 'Đã sao chép', val);
    } catch {
      showToast('info', 'Giá trị cần sao chép', val);
    }
  };

  const resetCardForm = () => {
    setMaThe('');
    setHoTen('');
    setNgaySinh('');
    setCardError(null);
    setCardResult(null);
    maTheInputRef.current?.focus();
  };

  const activeSeverity = cardResult?.statusInfo?.severity || 'error';
  const historyKcbList = getNormalizedBhxhHistoryKcb(cardResult);
  const historyKtList = getNormalizedBhxhHistoryKt(cardResult);

  return (
    <div className="max-w-3xl mx-auto pb-12 space-y-6 animate-in fade-in duration-200">
      {/* KHỐI 1: BIỂU MẪU NHẬP TRA CỨU */}
      <form
        noValidate
        onSubmit={handleCardLookup}
        className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6"
      >
        {/* Tiêu đề gọn gàng & nút điền tự động bố trí góc phải */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div className={`space-y-1 ${currentUser && userProfile ? 'text-center sm:text-left' : 'text-center w-full'}`}>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight text-balance">
              Tra cứu thông tin Bảo hiểm Y tế
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Nhập Số CCCD hoặc Mã thẻ BHYT, Họ và tên, Ngày sinh để kiểm tra giá trị thẻ
            </p>
          </div>

          {currentUser && userProfile && (
            <button
              type="button"
              onClick={handlePrefillFromProfile}
              className="self-center sm:self-auto shrink-0 h-9 px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Điền từ hồ sơ</span>
            </button>
          )}
        </div>

        {/* 3 trường nhập liệu cân đối đều nhau */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="bhxh-mathe"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Số CCCD / Mã thẻ BHYT *
            </label>
            <div className="relative">
              <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={maTheInputRef}
                id="bhxh-mathe"
                type="text"
                value={maThe}
                onChange={e => setMaThe(e.target.value.toUpperCase())}
                placeholder="VD: 079090001234"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase tabular-nums"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="bhxh-hoten"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Họ và tên *
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="bhxh-hoten"
                type="text"
                value={hoTen}
                onChange={e => setHoTen(e.target.value)}
                placeholder="Nhập họ và tên người tham gia BHYT"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="bhxh-ngaysinh"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Ngày sinh *
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="bhxh-ngaysinh"
                type="text"
                value={ngaySinh}
                onChange={e => setNgaySinh(e.target.value)}
                placeholder="DD/MM/YYYY hoặc YYYY"
                className="w-full h-11 pl-10 pr-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 tabular-nums"
              />
              <div
                title="Chọn ngày trên lịch"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition overflow-hidden"
              >
                <Calendar className="w-4 h-4 pointer-events-none" />
                <input
                  type="date"
                  aria-label="Chọn ngày sinh trên lịch"
                  title="Chọn ngày trên lịch"
                  value={
                    /^\d{2}\/\d{2}\/\d{4}$/.test(ngaySinh.trim())
                      ? `${ngaySinh.trim().slice(6, 10)}-${ngaySinh.trim().slice(3, 5)}-${ngaySinh.trim().slice(0, 2)}`
                      : ''
                  }
                  onChange={e => {
                    if (e.target.value) setNgaySinh(normalizeBhxhDobInput(e.target.value));
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Hai nút thao tác đối xứng 2 bên trái - phải */}
        <div className="grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={resetCardForm}
            className="w-full sm:w-48 h-11 px-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition"
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
            <span>Làm mới</span>
          </button>

          <button
            type="submit"
            disabled={searchingCard}
            className="w-full sm:w-48 h-11 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60 transition"
          >
            {searchingCard ? (
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Search className="w-4 h-4 shrink-0" />
            )}
            <span>{searchingCard ? 'Đang tra cứu...' : 'Tra cứu BHYT'}</span>
          </button>
        </div>
      </form>

      {/* KHỐI 2: Ô KẾT QUẢ HIỂN THỊ SẴN (SKELETON CHỜ / ĐANG TẢI / LỖI / KẾT QUẢ) */}
      <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 min-h-[430px] flex flex-col justify-between">
        {/* TRẠNG THÁI 1 & 2: ĐANG CHỜ HOẶC ĐANG TẢI (SKELETON) */}
        {!cardResult && (searchingCard || !cardError) && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Kết quả tra cứu thẻ BHYT
              </h2>
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                {searchingCard ? 'Đang kết nối BHXH...' : 'Chờ tra cứu'}
              </span>
            </div>

            <div
              className={`p-4 rounded-xl border flex items-center gap-3 ${
                searchingCard
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-50/80 dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              {searchingCard ? (
                <RefreshCw className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
              ) : (
                <CreditCard className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0" />
              )}
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="text-xs sm:text-sm font-semibold">
                  {searchingCard
                    ? 'Đang tra cứu thông tin thẻ từ Bảo hiểm Xã hội Việt Nam...'
                    : 'Nhập thông tin phía trên và nhấn Tra cứu BHYT để xem kết quả chi tiết'}
                </div>
                <div
                  className={`h-2.5 w-48 max-w-full rounded bg-slate-200/80 dark:bg-slate-700/70 ${
                    searchingCard ? 'animate-pulse' : ''
                  }`}
                />
              </div>
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm ${searchingCard ? 'animate-pulse' : ''}`}>
              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">Họ và tên</div>
                <div className="h-5 w-36 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  Ngày sinh · Giới tính
                </div>
                <div className="h-5 w-32 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">Mã thẻ BHYT</div>
                <div className="h-5 w-40 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">Mã số BHXH</div>
                <div className="h-5 w-28 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  Giá trị sử dụng thẻ
                </div>
                <div className="h-5 w-44 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  Thời điểm đủ 5 năm liên tục
                </div>
                <div className="h-5 w-28 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  Nơi ĐKKCB ban đầu
                </div>
                <div className="h-5 w-48 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
                  Cơ quan BHXH quản lý
                </div>
                <div className="h-5 w-40 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">Mã khu vực</div>
                <div className="h-5 w-20 rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <div className="text-xs font-medium text-slate-400 dark:text-slate-500">Địa chỉ</div>
                <div className="h-5 w-3/4 max-w-md rounded-md bg-slate-100 dark:bg-slate-800 mt-1.5" />
              </div>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI 3: KẾT QUẢ BÁO LỖI HIỂN THỊ TRONG Ô KẾT QUẢ (KHÔNG HIỆN NÚT CẤU HÌNH VỚI USER) */}
        {!searchingCard && cardError && !cardResult && (
          <div role="alert" className="my-auto py-8 flex flex-col items-center text-center space-y-5 animate-in fade-in duration-200">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <XCircle className="w-6 h-6" />
            </div>
            <div className="space-y-2 max-w-xl">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Không thể tra cứu thông tin Bảo hiểm Y tế
              </h2>
              <p className="text-xs sm:text-sm text-rose-700 dark:text-rose-300 leading-relaxed">
                {cardError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCardError(null);
                maTheInputRef.current?.focus();
              }}
              className="w-full sm:w-48 h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Nhập lại thông tin</span>
            </button>
          </div>
        )}

        {/* TRẠNG THÁI 4: KẾT QUẢ TRA CỨU THẺ BHYT THÀNH CÔNG */}
        {!searchingCard && cardResult && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Tiêu đề & trạng thái kết quả */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Kết quả tra cứu thẻ BHYT
              </h2>
              {cardResult.queriedAt && (
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {new Date(cardResult.queriedAt).toLocaleString('vi-VN')}
                </span>
              )}
            </div>

          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              activeSeverity === 'valid'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-100'
                : activeSeverity === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-100'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-100'
            }`}
          >
            {activeSeverity === 'valid' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : activeSeverity === 'warning' ? (
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-mono font-semibold opacity-80 tabular-nums">
                Mã kết quả: {cardResult.maKetQua || '—'}
              </div>
              <div className="text-sm sm:text-base font-extrabold">
                {cardResult.statusInfo?.description || 'Đã nhận phản hồi từ Bảo hiểm Xã hội Việt Nam'}
              </div>
              {cardResult.ghiChu && (
                <p className="text-xs opacity-90 leading-relaxed">{cardResult.ghiChu}</p>
              )}
            </div>
          </div>

          {/* Thông tin chi tiết thẻ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Họ và tên</div>
              <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                {cardResult.hoTen || hoTen || '—'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ngày sinh · Giới tính
              </div>
              <div className="font-semibold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                {[cardResult.ngaySinh || ngaySinh, cardResult.gioiTinh].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Mã thẻ BHYT</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {cardResult.maThe || '—'}
                </span>
                {cardResult.maThe && (
                  <button
                    type="button"
                    onClick={() => handleCopy(cardResult.maThe!, 'maThe')}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    title="Sao chép mã thẻ"
                  >
                    {copiedText === 'maThe' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Mã số BHXH</div>
              <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                {cardResult.maSoBHXH || '—'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Giá trị sử dụng thẻ
              </div>
              <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                {cardResult.gtTheTu || cardResult.gtTheDen
                  ? `${cardResult.gtTheTu || '—'} → ${cardResult.gtTheDen || '—'}`
                  : '—'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Thời điểm đủ 5 năm liên tục
              </div>
              <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                {cardResult.ngayDu5Nam || '—'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Nơi ĐKKCB ban đầu
              </div>
              <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                {cardResult.dkbdFacility?.ten ? (
                  <>
                    <span>{cardResult.dkbdFacility.ten}</span>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400 ml-1.5 tabular-nums">
                      ({cardResult.maDKBD})
                    </span>
                  </>
                ) : (
                  <span className="font-mono tabular-nums">{cardResult.maDKBD || '—'}</span>
                )}
              </div>
              {cardResult.dkbdFacility && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {describeBhxhTuyen(cardResult.dkbdFacility.tuyen)} ·{' '}
                  {describeBhxhHang(cardResult.dkbdFacility.hang)}
                  {cardResult.dkbdFacility.diachi ? ` · ${cardResult.dkbdFacility.diachi}` : ''}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Cơ quan BHXH quản lý
              </div>
              <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                {cardResult.cqBHXH || '—'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Mã khu vực</div>
              <div className="font-mono font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                {cardResult.maKV || 'Không có'}
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Địa chỉ</div>
              <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                {cardResult.diaChi || '—'}
              </div>
            </div>
          </div>

          {/* Thông tin thẻ cũ / mới (nếu có) */}
          {(cardResult.maTheCu ||
            cardResult.maTheMoi ||
            cardResult.gtTheTuMoi ||
            cardResult.gtTheDenMoi ||
            cardResult.maDKBDMoi ||
            cardResult.tenDKBDMoi) && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400 font-medium">Mã thẻ cũ</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                  {cardResult.maTheCu || '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400 font-medium">Mã thẻ mới</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {cardResult.maTheMoi || '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400 font-medium">Hạn thẻ mới</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                  {cardResult.gtTheTuMoi || cardResult.gtTheDenMoi
                    ? `${cardResult.gtTheTuMoi || '—'} → ${cardResult.gtTheDenMoi || '—'}`
                    : '—'}
                </div>
              </div>
              {(cardResult.maDKBDMoi || cardResult.tenDKBDMoi) && (
                <div>
                  <div className="text-slate-500 dark:text-slate-400 font-medium">Nơi ĐKKCB mới</div>
                  <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                    {cardResult.tenDKBDMoi
                      ? `${cardResult.tenDKBDMoi}${cardResult.maDKBDMoi ? ` (${cardResult.maDKBDMoi})` : ''}`
                      : cardResult.maDKBDMoi}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Lịch sử khám chữa bệnh */}
          {historyKcbList.length > 0 && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Lịch sử khám chữa bệnh ({historyKcbList.length} lượt)</span>
              </h3>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Mã hồ sơ</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Cơ sở KCB</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Ngày vào</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Ngày ra</th>
                      <th className="px-3.5 py-2.5 font-bold">Tên bệnh</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Tình trạng</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Kết quả ĐT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historyKcbList.map((item, idx) => (
                      <tr key={`${item.maHoSo || idx}-${idx}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3.5 py-2.5 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap tabular-nums">
                          {item.maHoSo || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap tabular-nums">
                          {item.tenCSKCB ? `${item.tenCSKCB} (${item.maCSKCB || '—'})` : item.maCSKCB || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {formatBhxhDateTime(item.ngayVao || item.tuNgay)}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {formatBhxhDateTime(item.ngayRa || item.denNgay)}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-800 dark:text-slate-200 min-w-[180px]">
                          {item.tenBenh || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {item.tinhTrang || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {item.kqDieuTri || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Lịch sử kiểm tra thẻ */}
          {historyKtList.length > 0 && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                <span>Lịch sử kiểm tra thẻ ({historyKtList.length})</span>
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Thời gian KT</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Người kiểm tra</th>
                      <th className="px-3.5 py-2.5 font-bold whitespace-nowrap">Mã lỗi</th>
                      <th className="px-3.5 py-2.5 font-bold">Thông báo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historyKtList.map((kt, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3.5 py-2.5 font-mono whitespace-nowrap tabular-nums">
                          {formatBhxhDateTime(kt.thoiGianKT)}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono whitespace-nowrap">
                          {kt.userKT || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono font-bold whitespace-nowrap">
                          {kt.maLoi || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300">
                          {kt.thongBao || kt.thongbao || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Nút tra cứu hồ sơ khác căn giữa */}
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={resetCardForm}
              className="w-full sm:w-52 h-10 px-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>Tra cứu hồ sơ khác</span>
            </button>
          </div>
          </div>
        )}
      </div>
    </div>
  );
};
