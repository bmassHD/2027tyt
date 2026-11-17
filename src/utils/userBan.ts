import { UserProfile } from '../types';

export const BAN_BOOTSTRAP_ADMIN_EMAILS = [
  'sonlyhongduc@gmail.com',
  'sonlyhongduc2003@gmail.com',
  'tytvtd@gmail.com',
];

export type BanDurationPresetKey = '1h' | '24h' | '3d' | '7d' | '30d' | 'custom';

export interface BanDurationPreset {
  key: BanDurationPresetKey;
  label: string;
  durationMs?: number;
}

export const BAN_DURATION_PRESETS: BanDurationPreset[] = [
  { key: '1h', label: '1 giờ', durationMs: 60 * 60 * 1000 },
  { key: '24h', label: '24 giờ (1 ngày)', durationMs: 24 * 60 * 60 * 1000 },
  { key: '3d', label: '3 ngày', durationMs: 3 * 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7 ngày', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: '30 ngày', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { key: 'custom', label: 'Tùy chỉnh thời gian' },
];

export function isProtectedSuperAdminProfile(profile?: Partial<UserProfile> | null): boolean {
  if (!profile) return false;
  if (profile.role === 'super_admin') return true;
  const email = (profile.email || '').trim().toLowerCase();
  return Boolean(email && BAN_BOOTSTRAP_ADMIN_EMAILS.includes(email));
}

export function getBannedUntilMs(profile?: Partial<UserProfile> | null): number | null {
  if (!profile) return null;
  if (typeof profile.bannedUntilMs === 'number' && Number.isFinite(profile.bannedUntilMs) && profile.bannedUntilMs > 0) {
    return profile.bannedUntilMs;
  }
  if (profile.bannedUntil && typeof profile.bannedUntil === 'string') {
    const parsed = new Date(profile.bannedUntil).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function isUserTemporaryBanExpired(
  profile?: Partial<UserProfile> | null,
  nowMs: number = Date.now()
): boolean {
  if (!profile || profile.status !== 'banned') return false;
  if (profile.banType !== 'temporary') return false;
  const untilMs = getBannedUntilMs(profile);
  if (!untilMs) return false;
  return nowMs >= untilMs;
}

export function isUserActivelyBanned(
  profile?: Partial<UserProfile> | null,
  nowMs: number = Date.now()
): boolean {
  if (!profile) return false;
  if (isProtectedSuperAdminProfile(profile)) return false;
  if (profile.status !== 'banned') return false;
  if (profile.banType === 'temporary') {
    const untilMs = getBannedUntilMs(profile);
    if (untilMs !== null) {
      return nowMs < untilMs;
    }
  }
  return true;
}

export function getEffectiveUserStatus(
  profile?: Partial<UserProfile> | null,
  nowMs: number = Date.now()
): UserProfile['status'] {
  if (!profile) return 'active';
  if (isProtectedSuperAdminProfile(profile)) return 'active';
  if (profile.status === 'banned' && isUserTemporaryBanExpired(profile, nowMs)) {
    return 'active';
  }
  return profile.status || 'active';
}

export function formatBanTimestampVi(isoOrMs?: string | number | null): string {
  if (isoOrMs === undefined || isoOrMs === null || isoOrMs === '') return '—';
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBanRemainingVi(
  bannedUntil?: string | number | null,
  nowMs: number = Date.now()
): string {
  if (bannedUntil === undefined || bannedUntil === null || bannedUntil === '') {
    return 'Vô thời hạn';
  }
  const targetMs = typeof bannedUntil === 'number' ? bannedUntil : new Date(bannedUntil).getTime();
  if (!Number.isFinite(targetMs)) return 'Không xác định';
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return 'Đã hết hạn';

  const totalMinutes = Math.ceil(diffMs / 60000);
  if (totalMinutes < 60) {
    return `Còn ${totalMinutes} phút`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `Còn ${totalHours} giờ ${remMinutes} phút` : `Còn ${totalHours} giờ`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `Còn ${days} ngày ${remHours} giờ` : `Còn ${days} ngày`;
}

export function toLocalDateTimeInputValue(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
