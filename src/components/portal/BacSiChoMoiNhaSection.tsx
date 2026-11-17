import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Smartphone,
  Video,
  ShieldCheck,
  CalendarCheck,
  ExternalLink,
  QrCode,
  Download,
} from 'lucide-react';

interface BacSiChoMoiNhaProps {
  stationName?: string;
  guideText?: string;
  androidUrl?: string;
  iosUrl?: string;
}

const DEFAULT_ANDROID_URL =
  'https://play.google.com/store/apps/details?id=vn.gov.moh.bacsichomoinha1';
const DEFAULT_IOS_URL =
  'https://apps.apple.com/vn/app/b%C3%A1c-s%C4%A9-cho-m%E1%BB%8Di-nh%C3%A0/id6453760139';

export const BacSiChoMoiNhaSection: React.FC<BacSiChoMoiNhaProps> = ({
  stationName = 'Trạm Y tế xã/phường',
  guideText,
  androidUrl = DEFAULT_ANDROID_URL,
  iosUrl = DEFAULT_IOS_URL,
}) => {
  const safeAndroidUrl = androidUrl?.trim() || DEFAULT_ANDROID_URL;
  const safeIosUrl = iosUrl?.trim() || DEFAULT_IOS_URL;

  const [androidQrDataUrl, setAndroidQrDataUrl] = useState<string>('');
  const [iosQrDataUrl, setIosQrDataUrl] = useState<string>('');

  const detectedPlatform = useMemo<'android' | 'ios' | 'other'>(() => {
    if (typeof navigator === 'undefined') return 'other';
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    return 'other';
  }, []);

  useEffect(() => {
    let active = true;
    const qrOptions = {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M' as const,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    };

    QRCode.toDataURL(safeAndroidUrl, qrOptions)
      .then(url => {
        if (active) setAndroidQrDataUrl(url);
      })
      .catch(() => {
        if (active) setAndroidQrDataUrl('');
      });

    QRCode.toDataURL(safeIosUrl, qrOptions)
      .then(url => {
        if (active) setIosQrDataUrl(url);
      })
      .catch(() => {
        if (active) setIosQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [safeAndroidUrl, safeIosUrl]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 text-white p-6 sm:p-8 shadow-xl overflow-hidden relative border border-emerald-700/40">
        <div className="relative z-10 flex flex-col lg:flex-row items-center gap-8">
          {/* Left Column: Information & Device App Download */}
          <div className="flex-1 space-y-5 text-center lg:text-left">
            <p className="inline-flex items-center gap-2 text-emerald-300 text-xs font-bold uppercase tracking-wider">
              <Video className="w-4 h-4" />
              <span>Nền tảng Y tế số Quốc gia</span>
            </p>

            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug">
              Khám Từ Xa Qua{' '}
              <span className="text-emerald-300">&ldquo;Bác Sĩ Cho Mọi Nhà&rdquo;</span>
            </h2>

            <p className="text-sm sm:text-base text-emerald-100/85 leading-relaxed max-w-xl mx-auto lg:mx-0">
              {guideText?.trim() ||
                `${stationName} triển khai tư vấn khám chữa bệnh trực tuyến qua ứng dụng của Bộ Y tế — không cần xếp hàng bốc số.`}
            </p>

            {/* Key Advantages */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 text-left">
                <Video className="w-5 h-5 text-teal-300 mb-1.5" />
                <h4 className="text-sm font-bold text-white">Video Call Bác sĩ</h4>
                <p className="text-xs text-emerald-100/80 mt-0.5">Tư vấn từ xa an toàn</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 text-left">
                <CalendarCheck className="w-5 h-5 text-emerald-300 mb-1.5" />
                <h4 className="text-sm font-bold text-white">Đặt hẹn chủ động</h4>
                <p className="text-xs text-emerald-100/80 mt-0.5">Chọn khung giờ phù hợp</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 text-left">
                <ShieldCheck className="w-5 h-5 text-amber-300 mb-1.5" />
                <h4 className="text-sm font-bold text-white">Hồ sơ y tế số</h4>
                <p className="text-xs text-emerald-100/80 mt-0.5">Lưu đơn thuốc điện tử</p>
              </div>
            </div>

            {/* 2 Symmetrical Compact Horizontal Download Buttons */}
            <div className="pt-1 grid grid-cols-2 gap-2.5 sm:gap-3 max-w-md mx-auto lg:mx-0">
              <a
                href={safeAndroidUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border transition group ${
                  detectedPlatform === 'android'
                    ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-400 text-white shadow-md'
                    : 'bg-black/50 hover:bg-black/75 border-white/20 text-white hover:border-emerald-400'
                }`}
              >
                <svg className="w-5 h-5 shrink-0 fill-current text-emerald-300" viewBox="0 0 24 24">
                  <path d="M3.609 1.814L13.793 12 3.61 22.186a2.02 2.02 0 0 1-.225-.219V2.033c.07-.078.146-.151.224-.219zm11.603 11.604l2.128 2.128-11.836 6.833 9.708-8.961zm0-2.836L5.504 1.621l11.836 6.833-2.128 2.128zm1.418 1.418l3.633 2.098a1.5 1.5 0 0 0 0-2.597l-3.633-2.098 1.418 1.418-1.418 1.179z" />
                </svg>
                <div className="text-left min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/80 font-medium">
                    Tải Android
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-white whitespace-nowrap flex items-center gap-1">
                    <span>Google Play</span>
                    <ExternalLink className="w-3 h-3 opacity-75 shrink-0" />
                  </div>
                </div>
              </a>

              <a
                href={safeIosUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border transition group ${
                  detectedPlatform === 'ios'
                    ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-400 text-white shadow-md'
                    : 'bg-black/50 hover:bg-black/75 border-white/20 text-white hover:border-teal-400'
                }`}
              >
                <svg className="w-5 h-5 shrink-0 fill-current text-slate-100" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.82 1.1-1.96.98-3.1-.95.04-2.1.63-2.77 1.43-.59.69-1.11 1.83-.97 2.94 1.06.08 2.14-.54 2.76-1.27z" />
                </svg>
                <div className="text-left min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/80 font-medium">
                    Tải iPhone/iPad
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-white whitespace-nowrap flex items-center gap-1">
                    <span>App Store</span>
                    <ExternalLink className="w-3 h-3 opacity-75 shrink-0" />
                  </div>
                </div>
              </a>
            </div>
          </div>

          {/* Right Column: Compact 4-Step Guide */}
          <div className="w-full lg:w-88 p-5 sm:p-6 rounded-3xl bg-white/10 border border-white/15 space-y-3.5">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-300 shrink-0" />
              <span>4 Bước Sử Dụng Nhanh</span>
            </h3>

            <ol className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-400 text-slate-900 font-extrabold flex items-center justify-center shrink-0 text-xs mt-0.5">
                  1
                </span>
                <div>
                  <p className="font-semibold text-white">Tải ứng dụng về điện thoại</p>
                  <p className="text-xs text-emerald-100/75">
                    Nhấn nút hoặc quét mã QR Google Play / App Store.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-400 text-slate-900 font-extrabold flex items-center justify-center shrink-0 text-xs mt-0.5">
                  2
                </span>
                <div>
                  <p className="font-semibold text-white">Xác thực số CCCD / BHYT</p>
                  <p className="text-xs text-emerald-100/75">Đăng ký bằng số điện thoại cá nhân.</p>
                </div>
              </li>

              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-400 text-slate-900 font-extrabold flex items-center justify-center shrink-0 text-xs mt-0.5">
                  3
                </span>
                <div>
                  <p className="font-semibold text-white">Chọn {stationName}</p>
                  <p className="text-xs text-emerald-100/75">Đặt lịch theo khung giờ mong muốn.</p>
                </div>
              </li>

              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-400 text-slate-900 font-extrabold flex items-center justify-center shrink-0 text-xs mt-0.5">
                  4
                </span>
                <div>
                  <p className="font-semibold text-white">Vào phòng khám Video Call</p>
                  <p className="text-xs text-emerald-100/75">Trao đổi trực tiếp cùng Bác sĩ.</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* 2 Dedicated QR Code Screens for Desktop-to-Phone App Download */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Quét Mã QR Để Tải Ứng Dụng Trên Điện Thoại
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Nếu bạn đang xem trên máy tính, hãy mở camera điện thoại hoặc Zalo để quét mã QR tương ứng bên dưới.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* QR 1: Android Google Play */}
          <div
            className={`rounded-2xl border p-5 flex flex-col sm:flex-row items-center gap-5 transition ${
              detectedPlatform === 'android'
                ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
            }`}
          >
            <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-xs shrink-0 flex flex-col items-center">
              {androidQrDataUrl ? (
                <img
                  src={androidQrDataUrl}
                  alt="Mã QR tải ứng dụng Bác sĩ cho mọi nhà trên Android Google Play"
                  className="w-36 h-36 sm:w-40 sm:h-40 object-contain"
                />
              ) : (
                <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-xl bg-slate-100 animate-pulse flex items-center justify-center text-xs text-slate-400">
                  Đang tạo QR...
                </div>
              )}
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Google Play · Android
              </span>
            </div>

            <div className="flex-1 text-center sm:text-left space-y-2.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold">
                <Smartphone className="w-3.5 h-3.5" />
                <span>Dành cho điện thoại Android</span>
              </div>
              <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Tải từ Google Play
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Quét mã bằng camera điện thoại Samsung, Oppo, Xiaomi, Vivo... để mở trang cài đặt chính thức.
              </p>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <a
                  href={safeAndroidUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition shadow-xs"
                >
                  <span>Mở Google Play</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {androidQrDataUrl && (
                  <a
                    href={androidQrDataUrl}
                    download="qr-bac-si-cho-moi-nha-android.png"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Lưu QR</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* QR 2: iOS App Store */}
          <div
            className={`rounded-2xl border p-5 flex flex-col sm:flex-row items-center gap-5 transition ${
              detectedPlatform === 'ios'
                ? 'border-teal-400 bg-teal-50/40 dark:bg-teal-950/20'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
            }`}
          >
            <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-xs shrink-0 flex flex-col items-center">
              {iosQrDataUrl ? (
                <img
                  src={iosQrDataUrl}
                  alt="Mã QR tải ứng dụng Bác sĩ cho mọi nhà trên iPhone iPad App Store"
                  className="w-36 h-36 sm:w-40 sm:h-40 object-contain"
                />
              ) : (
                <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-xl bg-slate-100 animate-pulse flex items-center justify-center text-xs text-slate-400">
                  Đang tạo QR...
                </div>
              )}
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                App Store · iPhone / iPad
              </span>
            </div>

            <div className="flex-1 text-center sm:text-left space-y-2.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[11px] font-bold">
                <Smartphone className="w-3.5 h-3.5" />
                <span>Dành cho iPhone / iPad (iOS)</span>
              </div>
              <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Tải từ App Store
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Mở ứng dụng Camera mặc định trên iPhone hoặc iPad, hướng vào mã QR để tải ứng dụng trực tiếp.
              </p>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <a
                  href={safeIosUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs"
                >
                  <span>Mở App Store</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {iosQrDataUrl && (
                  <a
                    href={iosQrDataUrl}
                    download="qr-bac-si-cho-moi-nha-ios.png"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Lưu QR</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
