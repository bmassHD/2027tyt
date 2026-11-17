const QUOTA_PAUSE_STORAGE_KEY = 'tyt_firestore_write_quota_utc_day';

let memoryQuotaExceededUtcDay: string | null = null;

export function getUtcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  const code = String((err as { code?: unknown })?.code || '').toLowerCase();
  const msg = String(
    (err as { message?: unknown })?.message || (typeof err === 'string' ? err : String(err))
  ).toLowerCase();

  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('quota exceeded') ||
    msg.includes('free daily write units')
  );
}

export function isFirestoreWriteQuotaExceeded(): boolean {
  const todayUtc = getUtcDayKey();
  if (memoryQuotaExceededUtcDay === todayUtc) {
    return true;
  }
  try {
    if (localStorage.getItem(QUOTA_PAUSE_STORAGE_KEY) === todayUtc) {
      memoryQuotaExceededUtcDay = todayUtc;
      return true;
    }
  } catch {
    // ignore storage access errors
  }
  return false;
}

export function markFirestoreWriteQuotaExceeded(): void {
  const todayUtc = getUtcDayKey();
  memoryQuotaExceededUtcDay = todayUtc;
  try {
    localStorage.setItem(QUOTA_PAUSE_STORAGE_KEY, todayUtc);
  } catch {
    // ignore storage access errors
  }
}

export function markFirestoreWriteQuotaExceededIfMatch(err: unknown): boolean {
  if (isQuotaExceededError(err)) {
    markFirestoreWriteQuotaExceeded();
    return true;
  }
  return false;
}

export function getFriendlyFirestoreErrorMessage(
  err: unknown,
  fallback = 'Không thể lưu dữ liệu vào hệ thống. Vui lòng thử lại sau.'
): string {
  if (isQuotaExceededError(err) || isFirestoreWriteQuotaExceeded()) {
    return 'Cơ sở dữ liệu Firestore đã đạt hạn mức ghi miễn phí trong ngày. Các tác vụ tự động đã tạm dừng và hạn mức sẽ được đặt lại vào ngày mai.';
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
