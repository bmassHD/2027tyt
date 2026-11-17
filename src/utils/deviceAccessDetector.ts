import { AccessControlConfig, AccessRestrictionRules } from '../types';

export interface ClientEnvironmentInfo {
  isIos: boolean;
  isAndroid: boolean;
  isIpad: boolean;
  isMobile: boolean;
  isPc: boolean;
  isChrome: boolean;
  isCocCoc: boolean;
  isSafari: boolean;
  isEdge: boolean;
  isFirefox: boolean;
  isInAppBrowser: boolean;
  osLabel: string;
  deviceTypeLabel: string;
  browserLabel: string;
  userAgent: string;
}

export interface AccessEvaluationResult {
  isBlocked: boolean;
  matchedRuleKeys: (keyof AccessRestrictionRules)[];
  matchedLabels: string[];
  env: ClientEnvironmentInfo;
}

export interface AccessRuleDescriptor {
  key: keyof AccessRestrictionRules;
  category: 'platform' | 'browser';
  label: string;
  shortLabel: string;
  description: string;
}

export const ACCESS_RESTRICTION_ITEMS: AccessRuleDescriptor[] = [
  // Platforms & Devices
  {
    key: 'disableIos',
    category: 'platform',
    label: 'Hệ điều hành iOS (iPhone / iPad)',
    shortLabel: 'iOS',
    description: 'Chặn toàn bộ thiết bị chạy iOS và iPadOS (iPhone, iPad, iPod).',
  },
  {
    key: 'disableAndroid',
    category: 'platform',
    label: 'Hệ điều hành Android',
    shortLabel: 'Android',
    description: 'Chặn điện thoại và máy tính bảng chạy hệ điều hành Android.',
  },
  {
    key: 'disableMobile',
    category: 'platform',
    label: 'Thiết bị Mobile (Điện thoại di động)',
    shortLabel: 'Mobile',
    description: 'Chặn mọi điện thoại di động (bao gồm iPhone, Android phone...).',
  },
  {
    key: 'disableIpad',
    category: 'platform',
    label: 'Thiết bị iPad (Máy tính bảng Apple)',
    shortLabel: 'iPad',
    description: 'Chặn riêng dòng máy tính bảng iPad (bao gồm iPadOS 13+ giả lập Desktop).',
  },
  {
    key: 'disablePc',
    category: 'platform',
    label: 'Máy tính cá nhân (PC / Laptop)',
    shortLabel: 'PC',
    description: 'Chặn máy tính để bàn và Laptop (Windows, macOS, Linux, ChromeOS).',
  },
  // Browsers
  {
    key: 'disableChrome',
    category: 'browser',
    label: 'Trình duyệt Google Chrome',
    shortLabel: 'Google Chrome',
    description: 'Chặn trình duyệt Google Chrome trên máy tính và điện thoại.',
  },
  {
    key: 'disableCocCoc',
    category: 'browser',
    label: 'Trình duyệt Cốc Cốc',
    shortLabel: 'Cốc Cốc',
    description: 'Chặn trình duyệt Cốc Cốc trên Windows, macOS và di động.',
  },
  {
    key: 'disableSafari',
    category: 'browser',
    label: 'Trình duyệt Safari',
    shortLabel: 'Safari',
    description: 'Chặn trình duyệt Safari mặc định trên iPhone, iPad và macOS.',
  },
  {
    key: 'disableEdge',
    category: 'browser',
    label: 'Trình duyệt Microsoft Edge',
    shortLabel: 'Microsoft Edge',
    description: 'Chặn trình duyệt Microsoft Edge trên Windows, macOS và di động.',
  },
  {
    key: 'disableFirefox',
    category: 'browser',
    label: 'Trình duyệt Mozilla Firefox',
    shortLabel: 'Firefox',
    description: 'Chặn trình duyệt Firefox trên máy tính và di động.',
  },
  {
    key: 'disableInAppBrowser',
    category: 'browser',
    label: 'Trình duyệt trong ứng dụng (Zalo / Facebook)',
    shortLabel: 'Zalo / FB In-App',
    description: 'Chặn mở link trực tiếp bên trong Zalo, Facebook, TikTok WebView.',
  },
];

export function detectClientEnvironment(): ClientEnvironmentInfo {
  if (typeof navigator === 'undefined') {
    return {
      isIos: false,
      isAndroid: false,
      isIpad: false,
      isMobile: false,
      isPc: true,
      isChrome: false,
      isCocCoc: false,
      isSafari: false,
      isEdge: false,
      isFirefox: false,
      isInAppBrowser: false,
      osLabel: 'Không xác định',
      deviceTypeLabel: 'PC',
      browserLabel: 'Không xác định',
      userAgent: '',
    };
  }

  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '').toLowerCase();
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const uaData = (navigator as any).userAgentData as
    | {
        mobile?: boolean;
        platform?: string;
        brands?: Array<{ brand?: string; version?: string }>;
      }
    | undefined;

  // 1. OS & Form Factor
  const isExplicitIpad = /iPad/i.test(ua);
  // Modern iPadOS 13+ reports Macintosh in UA + MacIntel platform + touch points > 1
  const isIpadDesktopMode = /Macintosh/i.test(ua) && platform.includes('mac') && maxTouchPoints > 1;
  const isIpad = isExplicitIpad || isIpadDesktopMode;

  const isIphoneOrPod = /iPhone|iPod/i.test(ua);
  const isIos = isIphoneOrPod || isIpad;

  const isAndroid = /Android/i.test(ua) || (uaData?.platform || '').toLowerCase() === 'android';

  const isAndroidPhone = isAndroid && /Mobile/i.test(ua);
  const isGenericMobileUa = /Mobi|BlackBerry|IEMobile|Opera Mini|Windows Phone/i.test(ua);
  const isMobile =
    !isIpad &&
    (isIphoneOrPod || isAndroidPhone || isGenericMobileUa || Boolean(uaData?.mobile));

  const isPc = !isMobile && !isIpad;

  // 2. Browser detection (Order matters because Chromium-based browsers include "Chrome" in UA)
  const brands = (uaData?.brands || []).map(b => (b.brand || '').toLowerCase());

  const isInAppBrowser = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\/|BytedanceWebview|TikTok/i.test(ua);
  const isCocCoc = /coc_coc_browser|CocCoc/i.test(ua) || brands.some(b => b.includes('coccoc') || b.includes('cốc cốc'));
  const isEdge = /Edg\/|EdgA\/|EdgiOS\/|Edge\//i.test(ua) || brands.some(b => b.includes('edge'));
  const isFirefox = /Firefox\/|FxiOS\//i.test(ua);
  const isOpera = /OPR\/|Opera|OPT\//i.test(ua) || brands.some(b => b.includes('opera'));
  const isSamsung = /SamsungBrowser\//i.test(ua);

  const hasChromeBrand = brands.some(b => b.includes('google chrome'));
  const hasChromeUa = /Chrome\/|CriOS\//i.test(ua);
  const isChrome =
    !isCocCoc &&
    !isEdge &&
    !isOpera &&
    !isSamsung &&
    !isInAppBrowser &&
    (hasChromeBrand || hasChromeUa);

  const isSafari =
    !isChrome &&
    !isCocCoc &&
    !isEdge &&
    !isFirefox &&
    !isOpera &&
    !isSamsung &&
    !isInAppBrowser &&
    !isAndroid &&
    /Safari\//i.test(ua);

  // Human-readable labels
  let osLabel = 'Hệ điều hành khác';
  if (isIpad) osLabel = 'iPadOS / iOS';
  else if (isIos) osLabel = 'iOS';
  else if (isAndroid) osLabel = 'Android';
  else if (/Windows/i.test(ua)) osLabel = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) osLabel = 'macOS';
  else if (/CrOS/i.test(ua)) osLabel = 'ChromeOS';
  else if (/Linux/i.test(ua)) osLabel = 'Linux';

  let deviceTypeLabel = 'PC / Máy tính';
  if (isIpad) deviceTypeLabel = 'iPad';
  else if (isMobile) deviceTypeLabel = 'Mobile (Điện thoại)';

  let browserLabel = 'Trình duyệt khác';
  if (isInAppBrowser) browserLabel = 'Trình duyệt trong app (Zalo/FB)';
  else if (isCocCoc) browserLabel = 'Cốc Cốc';
  else if (isEdge) browserLabel = 'Microsoft Edge';
  else if (isFirefox) browserLabel = 'Mozilla Firefox';
  else if (isChrome) browserLabel = 'Google Chrome';
  else if (isSafari) browserLabel = 'Safari';
  else if (isSamsung) browserLabel = 'Samsung Internet';
  else if (isOpera) browserLabel = 'Opera';

  return {
    isIos,
    isAndroid,
    isIpad,
    isMobile,
    isPc,
    isChrome,
    isCocCoc,
    isSafari,
    isEdge,
    isFirefox,
    isInAppBrowser,
    osLabel,
    deviceTypeLabel,
    browserLabel,
    userAgent: ua,
  };
}

export function evaluateAccessRestriction(
  config?: AccessControlConfig | null,
  envInput?: ClientEnvironmentInfo
): AccessEvaluationResult {
  const env = envInput || detectClientEnvironment();
  const rules = config?.rules || {};
  const matchedRuleKeys: (keyof AccessRestrictionRules)[] = [];
  const matchedLabels: string[] = [];

  const checkRule = (key: keyof AccessRestrictionRules, matches: boolean, label: string) => {
    if (rules[key] && matches) {
      matchedRuleKeys.push(key);
      matchedLabels.push(label);
    }
  };

  checkRule('disableIos', env.isIos, 'Hệ điều hành iOS');
  checkRule('disableAndroid', env.isAndroid, 'Hệ điều hành Android');
  checkRule('disableMobile', env.isMobile, 'Thiết bị Mobile');
  checkRule('disableIpad', env.isIpad, 'Thiết bị iPad');
  checkRule('disablePc', env.isPc, 'Máy tính (PC)');

  checkRule('disableChrome', env.isChrome, 'Trình duyệt Google Chrome');
  checkRule('disableCocCoc', env.isCocCoc, 'Trình duyệt Cốc Cốc');
  checkRule('disableSafari', env.isSafari, 'Trình duyệt Safari');
  checkRule('disableEdge', env.isEdge, 'Trình duyệt Microsoft Edge');
  checkRule('disableFirefox', env.isFirefox, 'Trình duyệt Firefox');
  checkRule('disableInAppBrowser', env.isInAppBrowser, 'Trình duyệt trong app (Zalo/FB)');

  return {
    isBlocked: matchedRuleKeys.length > 0,
    matchedRuleKeys,
    matchedLabels,
    env,
  };
}
