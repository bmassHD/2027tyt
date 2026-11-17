import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { VerifiedIdentifierLock, UserVerifiedDevice } from '../types';
import { normalizeVietnamPhoneToE164, isValidE164Phone } from './smsMfaUtils';
import { getOrCreateDeviceId } from '../services/systemNotificationService';
import {
  isFirestoreWriteQuotaExceeded,
  markFirestoreWriteQuotaExceededIfMatch,
} from './firestoreQuotaGuard';

/**
 * Deterministic SHA-256 hex digest with lightweight non-crypto fallback if subtle is unavailable.
 */
async function sha256Hex(input: string): Promise<string> {
  const normalized = input.trim().toLowerCase();
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function buildEmailLockId(email: string): Promise<string> {
  const clean = email.trim().toLowerCase();
  if (!clean) return '';
  const digest = await sha256Hex(clean);
  return `email_${digest}`;
}

export function autoCompleteGmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@gmail.com`;
}

export function isValidEmailAddress(email: string): boolean {
  const clean = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
}

export function normalizeAndValidatePhone(rawPhone: string): string {
  const e164 = normalizeVietnamPhoneToE164(rawPhone);
  if (!isValidE164Phone(e164)) return '';
  if (!/^\+84\d{9}$/.test(e164)) {
    return '';
  }
  return e164;
}

export function buildPhoneLockId(rawPhone: string): string {
  const e164 = normalizeAndValidatePhone(rawPhone);
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  return digits ? `phone_${digits}` : '';
}

export function buildCccdLockId(rawCccd: string): string {
  const digits = rawCccd.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return '';
  return `cccd_${digits}`;
}

export function maskEmailForLock(email: string): string {
  const clean = email.trim().toLowerCase();
  const [local, domain] = clean.split('@');
  if (!local || !domain) return '****';
  const tail = local.length > 4 ? local.slice(-4) : local;
  return `****${tail}@${domain}`;
}

export function maskPhoneForLock(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  return `****${digits.slice(-4)}`;
}

export function maskCccdForLock(rawCccd: string): string {
  const digits = rawCccd.replace(/\D/g, '');
  if (!digits) return '';
  return `****${digits.slice(-4)}`;
}

export function maskVerifiedValue(
  raw?: string | null,
  type: 'phone' | 'cccd' | 'email' = 'phone'
): string {
  const value = (raw || '').trim();
  if (!value) return '';
  if (type === 'email') {
    const [local, domain] = value.split('@');
    if (!local || !domain) {
      return `****${value.slice(-4)}`;
    }
    const tail = local.length > 4 ? local.slice(-4) : local;
    return `****${tail}@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `****${digits.slice(-4)}`;
  }
  return `****${value.slice(-4)}`;
}

export function maskNameForLookup(rawName?: string | null): string {
  const clean = (rawName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '****';
  const parts = clean.split(' ');
  if (parts.length > 1) {
    return `**** ${parts[parts.length - 1]}`;
  }
  return clean.length > 2 ? `****${clean.slice(-2)}` : '****';
}

export function maskAddressForLookup(rawAddress?: string | null): string {
  const clean = (rawAddress || '').trim();
  if (!clean) return '****';
  const segments = clean.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    return `****, ${segments[segments.length - 1]}`;
  }
  return clean.length > 4 ? `****${clean.slice(-4)}` : '****';
}

export function maskGenderForLookup(rawGender?: string | null): string {
  if (!rawGender || !rawGender.trim()) return '****';
  return '****';
}

export async function verifyUnauthenticatedPasswordResetIdentity(params: {
  email: string;
  phone?: string;
  cccd?: string;
}): Promise<{ ok: boolean; normalizedEmail: string; error?: string }> {
  const normalizedEmail = autoCompleteGmail(params.email).toLowerCase();
  if (!isValidEmailAddress(normalizedEmail)) {
    return {
      ok: false,
      normalizedEmail,
      error: 'Địa chỉ Email / Gmail không hợp lệ.',
    };
  }

  const rawPhone = (params.phone || '').trim();
  const rawCccd = (params.cccd || '').trim();

  if (!rawPhone && !rawCccd) {
    return {
      ok: false,
      normalizedEmail,
      error: 'Vui lòng nhập Số điện thoại (10 số) hoặc Số CCCD đã xác minh để đối chiếu trước khi gửi liên kết khôi phục.',
    };
  }

  let phoneLockId = '';
  if (rawPhone) {
    const normalizedPhone = normalizeAndValidatePhone(rawPhone);
    if (!normalizedPhone) {
      return {
        ok: false,
        normalizedEmail,
        error: 'Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).',
      };
    }
    phoneLockId = buildPhoneLockId(normalizedPhone);
  }

  let cccdLockId = '';
  if (rawCccd) {
    cccdLockId = buildCccdLockId(rawCccd);
    if (!cccdLockId) {
      return {
        ok: false,
        normalizedEmail,
        error: 'Số CCCD không hợp lệ (cần 9–15 chữ số).',
      };
    }
  }

  try {
    const emailLockId = await buildEmailLockId(normalizedEmail);
    const emailSnap = emailLockId
      ? await getDoc(doc(db, 'verifiedIdentifiers', emailLockId))
      : null;

    if (!emailSnap || !emailSnap.exists()) {
      return {
        ok: false,
        normalizedEmail,
        error: 'Thông tin Email chưa được xác minh hoặc không tồn tại trên hệ thống.',
      };
    }

    const emailOwnerUid = (emailSnap.data() as VerifiedIdentifierLock).ownerUid;

    if (phoneLockId) {
      const phoneSnap = await getDoc(doc(db, 'verifiedIdentifiers', phoneLockId));
      if (!phoneSnap.exists() || (phoneSnap.data() as VerifiedIdentifierLock).ownerUid !== emailOwnerUid) {
        return {
          ok: false,
          normalizedEmail,
          error: 'Số điện thoại không khớp với tài khoản Email đã nhập.',
        };
      }
    }

    if (cccdLockId) {
      const cccdSnap = await getDoc(doc(db, 'verifiedIdentifiers', cccdLockId));
      if (!cccdSnap.exists() || (cccdSnap.data() as VerifiedIdentifierLock).ownerUid !== emailOwnerUid) {
        return {
          ok: false,
          normalizedEmail,
          error: 'Số CCCD không khớp với tài khoản Email đã nhập.',
        };
      }
    }

    return { ok: true, normalizedEmail };
  } catch (err: any) {
    return {
      ok: false,
      normalizedEmail,
      error: err?.message || 'Không thể đối chiếu thông tin xác minh. Vui lòng thử lại.',
    };
  }
}

export async function checkIdentifierAvailability(
  lockId: string,
  currentUid?: string | null
): Promise<{ available: boolean; ownedByCurrentUser: boolean; valueMasked?: string }> {
  if (!lockId) {
    return { available: true, ownedByCurrentUser: false };
  }
  const path = `verifiedIdentifiers/${lockId}`;
  try {
    const snap = await getDoc(doc(db, 'verifiedIdentifiers', lockId));
    if (!snap.exists()) {
      return { available: true, ownedByCurrentUser: false };
    }
    const data = snap.data() as VerifiedIdentifierLock;
    const owned = Boolean(currentUid && data.ownerUid === currentUid);
    return {
      available: owned,
      ownedByCurrentUser: owned,
      valueMasked: data.valueMasked,
    };
  } catch (err: any) {
    markFirestoreWriteQuotaExceededIfMatch(err);
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('permission')) {
      handleFirestoreError(err, OperationType.GET, path);
    }
    return { available: true, ownedByCurrentUser: false };
  }
}

export async function claimExclusiveIdentifierLock(params: {
  lockId: string;
  type: 'email' | 'phone' | 'cccd';
  valueMasked: string;
  ownerUid: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { lockId, type, valueMasked, ownerUid } = params;
  if (!lockId || !ownerUid) {
    return { ok: false, error: 'Thông tin định danh không hợp lệ.' };
  }
  if (isFirestoreWriteQuotaExceeded()) {
    return {
      ok: false,
      error: 'Cơ sở dữ liệu đang đạt hạn mức ghi miễn phí trong ngày, vui lòng thử lại vào ngày mai.',
    };
  }

  const path = `verifiedIdentifiers/${lockId}`;
  const docRef = doc(db, 'verifiedIdentifiers', lockId);
  try {
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      const data = existing.data() as VerifiedIdentifierLock;
      if (data.ownerUid === ownerUid) {
        return { ok: true };
      }
      const label =
        type === 'email' ? 'Email/Gmail' : type === 'phone' ? 'Số điện thoại' : 'Số CCCD';
      return {
        ok: false,
        error: `${label} này đã được đăng ký và khoá duy nhất cho tài khoản khác.`,
      };
    }

    const payload: VerifiedIdentifierLock = {
      id: lockId,
      type,
      valueMasked: valueMasked.slice(0, 128),
      ownerUid,
      locked: true,
      verifiedAt: new Date().toISOString(),
    };
    await setDoc(docRef, payload);
    return { ok: true };
  } catch (err: any) {
    if (markFirestoreWriteQuotaExceededIfMatch(err)) {
      return {
        ok: false,
        error: 'Cơ sở dữ liệu đang đạt hạn mức ghi miễn phí trong ngày, vui lòng thử lại vào ngày mai.',
      };
    }
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('permission') || msg.includes('already exists')) {
      return {
        ok: false,
        error: 'Thông tin này đã được đăng ký bởi tài khoản khác và không thể sử dụng trùng lặp.',
      };
    }
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function releaseExclusiveIdentifierLock(lockId: string): Promise<void> {
  if (!lockId) return;
  const path = `verifiedIdentifiers/${lockId}`;
  try {
    await deleteDoc(doc(db, 'verifiedIdentifiers', lockId));
  } catch (err: any) {
    markFirestoreWriteQuotaExceededIfMatch(err);
    const code = String(err?.code || '').toLowerCase();
    if (code === 'not-found') return;
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function detectCurrentDeviceMeta(): Pick<
  UserVerifiedDevice,
  'deviceId' | 'deviceName' | 'platform' | 'os' | 'browser'
> {
  const deviceId = getOrCreateDeviceId();
  if (typeof navigator === 'undefined') {
    return {
      deviceId,
      deviceName: 'Thiết bị web',
      platform: 'desktop',
      os: 'Web',
      browser: 'Browser',
    };
  }

  const ua = navigator.userAgent || '';
  const isIPad =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isTablet = isIPad || (isAndroid && !/Mobile/i.test(ua));
  const isMobile = isIPhone || (isAndroid && /Mobile/i.test(ua));

  const platform: UserVerifiedDevice['platform'] = isTablet
    ? 'tablet'
    : isMobile
    ? 'mobile'
    : 'desktop';

  let os = 'Khác';
  if (isIPhone) os = 'iOS';
  else if (isIPad) os = 'iPadOS';
  else if (isAndroid) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Trình duyệt';
  if (/coc_coc_browser/i.test(ua)) browser = 'Cốc Cốc';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/FxiOS|Firefox/i.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';

  const devicePrefix =
    isIPhone ? 'iPhone' : isIPad ? 'iPad' : isAndroid ? 'Android' : os;

  return {
    deviceId,
    deviceName: `${devicePrefix} · ${browser}`,
    platform,
    os,
    browser,
  };
}
