import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  isFirestoreWriteQuotaExceeded,
  markFirestoreWriteQuotaExceededIfMatch,
} from '../utils/firestoreQuotaGuard';

export interface VisitorStats {
  onlineCount: number;
  todayCount: number;
  monthCount: number;
  yearCount: number;
  totalCount: number;
  loading: boolean;
}

const STATS_DOC_REF = () => doc(db, 'siteStats', 'summary');
const PRESENCE_SESSION_KEY = 'tyt_presence_session_v1';
const VISIT_SESSION_DAY_KEY = 'tyt_domain_visit_recorded_day';
const LAST_VISIT_LOCAL_TS_KEY = 'tyt_last_domain_visit_ts';
const LAST_HEARTBEAT_LOCAL_TS_KEY = 'tyt_presence_last_hb_ts_v1';
const ONLINE_WINDOW_MS = 600_000; // 10 minutes live presence window
const HEARTBEAT_INTERVAL_MS = 480_000; // 8 minutes between heartbeats
const MIN_HEARTBEAT_GAP_MS = 240_000; // 4 minutes minimum gap across reloads/tab switches
const MIN_VISIT_GAP_MS = 300_000; // 5 minutes minimum gap across reloads

// Bộ nhớ đệm trong phiên tải trang để tránh React StrictMode / re-render gọi trùng lặp
let pageVisitRecorded = false;
let isCurrentlyRecording = false;

/**
 * Kiểm tra xem người dùng có đang truy cập vào tên miền gốc (domain chính) hay không.
 * Chỉ tính lượt truy cập khi truy cập domain chính (domain.com, domain.com/, hoặc trang chủ).
 * KHÔNG tính khi truy cập vào các đường dẫn con sau domain (domain.com/xxx hoặc các phân hệ con).
 */
export function isRootDomainVisit(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Kiểm tra pathname: chỉ chấp nhận '/' hoặc '/index.html' hoặc rỗng.
  // Không tính bất kỳ truy cập nào có đường dẫn sau domain: domain.com/xxx
  const rawPath = window.location.pathname || '/';
  const cleanPath = rawPath.replace(/\/+$/, '') || '/';
  if (cleanPath !== '/' && cleanPath !== '/index.html') {
    return false;
  }

  // 2. Kiểm tra hash route: chỉ chấp nhận trang chủ ('', '#', '#/', '#trang-chu', '#/trang-chu', '#portal', '#/portal')
  // Không tính khi truy cập trực tiếp vào các phân hệ con (domain.com/#/xxx)
  const hash = window.location.hash || '';
  const cleanHash = hash.replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
  const allowedHomeHashes = ['', 'trang-chu', 'portal', 'home'];
  if (cleanHash && !allowedHomeHashes.includes(cleanHash)) {
    return false;
  }

  return true;
}

function getVietnamDateKeys(): { dayKey: string; monthKey: string; yearKey: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find(p => p.type === 'year')?.value || String(now.getFullYear());
  const month = parts.find(p => p.type === 'month')?.value || String(now.getMonth() + 1).padStart(2, '0');
  const day = parts.find(p => p.type === 'day')?.value || String(now.getDate()).padStart(2, '0');

  return {
    dayKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
    yearKey: `${year}`,
  };
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(PRESENCE_SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const generated = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(PRESENCE_SESSION_KEY, generated);
    return generated;
  } catch {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Ghi nhận 1 lượt truy cập khi vào domain chính (domain.com)
 * Không tính khi truy cập sau domain.com/xxx
 */
export async function recordDomainVisit(): Promise<void> {
  // Chỉ tính lượt truy cập khi truy cập domain chính, không tính truy cập sau domain.com/xxx
  if (!isRootDomainVisit()) {
    return;
  }

  // Chống ghi nhận trùng lặp trong cùng 1 lần tải trang / render component hoặc khi hết quota
  if (pageVisitRecorded || isCurrentlyRecording || isFirestoreWriteQuotaExceeded()) {
    return;
  }

  const { dayKey, monthKey, yearKey } = getVietnamDateKeys();

  // Chống spam F5 liên tục hoặc StrictMode remount: mỗi phiên tab chỉ ghi tối đa 1 lượt/ngày,
  // đồng thời giãn cách tối thiểu 5 phút giữa các lượt ghi từ cùng một trình duyệt
  try {
    if (sessionStorage.getItem(VISIT_SESSION_DAY_KEY) === dayKey) {
      pageVisitRecorded = true;
      return;
    }
    const lastRecordedTs = Number(localStorage.getItem(LAST_VISIT_LOCAL_TS_KEY) || 0);
    if (lastRecordedTs && Date.now() - lastRecordedTs < MIN_VISIT_GAP_MS) {
      pageVisitRecorded = true;
      return;
    }
  } catch {
    // ignore storage errors
  }

  pageVisitRecorded = true;
  isCurrentlyRecording = true;

  try {
    await runTransaction(db, async (tx) => {
      const ref = STATS_DOC_REF();
      const snap = await tx.get(ref);
      const nowIso = new Date().toISOString();

      if (!snap.exists()) {
        tx.set(ref, {
          dayKey,
          dayCount: 1,
          monthKey,
          monthCount: 1,
          yearKey,
          yearCount: 1,
          total: 1,
          updatedAt: nowIso,
        });
        return;
      }

      const data = snap.data() || {};
      const nextDayCount = data.dayKey === dayKey ? Number(data.dayCount || 0) + 1 : 1;
      const nextMonthCount = data.monthKey === monthKey ? Number(data.monthCount || 0) + 1 : 1;
      const nextYearCount = data.yearKey === yearKey ? Number(data.yearCount || 0) + 1 : 1;
      const nextTotal = Number(data.total || 0) + 1;

      tx.update(ref, {
        dayKey,
        dayCount: nextDayCount,
        monthKey,
        monthCount: nextMonthCount,
        yearKey,
        yearCount: nextYearCount,
        total: nextTotal,
        updatedAt: nowIso,
      });
    });

    try {
      sessionStorage.setItem(VISIT_SESSION_DAY_KEY, dayKey);
      localStorage.setItem(LAST_VISIT_LOCAL_TS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  } catch (err) {
    if (!markFirestoreWriteQuotaExceededIfMatch(err)) {
      pageVisitRecorded = false;
    }
    console.warn('Record domain visitor stat error:', err);
  } finally {
    isCurrentlyRecording = false;
  }
}

export function useVisitorStats(): VisitorStats {
  const [stats, setStats] = useState<VisitorStats>({
    onlineCount: 1,
    todayCount: 0,
    monthCount: 0,
    yearCount: 0,
    totalCount: 0,
    loading: true,
  });

  useEffect(() => {
    const sessionId = getOrCreateSessionId();
    const presenceRef = doc(db, 'onlinePresence', sessionId);

    // Ghi nhận lượt truy cập khi vào domain chính (không tính domain.com/xxx)
    void recordDomainVisit();

    let heartbeatInFlight = false;
    const sendHeartbeat = async () => {
      if (heartbeatInFlight || isFirestoreWriteQuotaExceeded() || document.visibilityState === 'hidden') {
        return;
      }
      const now = Date.now();
      try {
        const lastHbRaw = localStorage.getItem(LAST_HEARTBEAT_LOCAL_TS_KEY);
        const lastHb = lastHbRaw ? Number(lastHbRaw) : 0;
        if (lastHb && now - lastHb < MIN_HEARTBEAT_GAP_MS) {
          return;
        }
      } catch {
        // ignore storage errors
      }

      heartbeatInFlight = true;
      try {
        await setDoc(
          presenceRef,
          {
            sessionId,
            lastSeenMs: now,
            updatedAt: new Date(now).toISOString(),
          },
          { merge: true }
        );
        try {
          localStorage.setItem(LAST_HEARTBEAT_LOCAL_TS_KEY, String(now));
        } catch {
          // ignore
        }
      } catch (err) {
        markFirestoreWriteQuotaExceededIfMatch(err);
        console.warn('Presence heartbeat error:', err);
      } finally {
        heartbeatInFlight = false;
      }
    };

    void sendHeartbeat();
    const heartbeatTimer = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Subscribe to aggregate visitor counts
    const unsubStats = onSnapshot(
      STATS_DOC_REF(),
      (snap) => {
        const { dayKey, monthKey, yearKey } = getVietnamDateKeys();
        if (snap.exists()) {
          const d = snap.data();
          setStats((prev) => ({
            ...prev,
            todayCount: d.dayKey === dayKey ? Number(d.dayCount || 0) : 0,
            monthCount: d.monthKey === monthKey ? Number(d.monthCount || 0) : 0,
            yearCount: d.yearKey === yearKey ? Number(d.yearCount || 0) : 0,
            totalCount: Number(d.total || 0),
            loading: false,
          }));
        } else {
          setStats((prev) => ({ ...prev, loading: false }));
        }
      },
      () => setStats((prev) => ({ ...prev, loading: false }))
    );

    // Subscribe to live online sessions (expires automatically via ONLINE_WINDOW_MS without delete writes)
    const unsubPresence = onSnapshot(
      collection(db, 'onlinePresence'),
      (snap) => {
        const cutoff = Date.now() - ONLINE_WINDOW_MS;
        let active = 0;
        snap.docs.forEach((docSnap) => {
          const d = docSnap.data();
          if (typeof d.lastSeenMs === 'number' && d.lastSeenMs >= cutoff) {
            active++;
          }
        });
        setStats((prev) => ({ ...prev, onlineCount: Math.max(1, active) }));
      },
      () => {}
    );

    return () => {
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubStats();
      unsubPresence();
    };
  }, []);

  return stats;
}
