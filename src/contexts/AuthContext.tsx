import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  linkWithCredential,
  linkWithPopup,
  linkWithPhoneNumber,
  updateProfile,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
  multiFactor,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  MultiFactorResolver,
  MultiFactorInfo,
  PhoneMultiFactorInfo,
  ConfirmationResult,
} from 'firebase/auth';
import { doc, collection, query, orderBy, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import {
  UserProfile,
  RoleType,
  AccountType,
  UserTotpSecurityDoc,
  UserVerifiedDevice,
} from '../types';
import { verifyTotpToken, normalizeRecoveryCode } from '../utils/totp';
import { normalizeVietnamPhoneToE164, isValidE164Phone } from '../utils/smsMfaUtils';
import {
  buildEmailLockId,
  buildPhoneLockId,
  buildCccdLockId,
  normalizeAndValidatePhone,
  autoCompleteGmail,
  isValidEmailAddress,
  maskEmailForLock,
  maskPhoneForLock,
  maskCccdForLock,
  checkIdentifierAvailability,
  claimExclusiveIdentifierLock,
  releaseExclusiveIdentifierLock,
  detectCurrentDeviceMeta,
} from '../utils/verifiedIdentity';
import {
  normalizeReferralCode,
  validateReferralCode,
  consumeReferralCodeUsage,
} from '../services/firebaseService';
import {
  isFirestoreWriteQuotaExceeded,
  markFirestoreWriteQuotaExceededIfMatch,
} from '../utils/firestoreQuotaGuard';
import { getBannedUntilMs, isUserActivelyBanned } from '../utils/userBan';

export const PRIMARY_ADMIN_EMAIL = 'sonlyhongduc@gmail.com';
export const BOOTSTRAP_ADMIN_EMAILS = [
  'sonlyhongduc@gmail.com',
  'sonlyhongduc2003@gmail.com',
  'tytvtd@gmail.com',
];

const TWO_FA_SESSION_PREFIX = 'tyt_2fa_session_v1_';
export const REFERRAL_SESSION_KEY = 'tyt_pending_referral_code';

export function getPendingReferralCode(): string {
  try {
    const raw = sessionStorage.getItem(REFERRAL_SESSION_KEY) || '';
    return normalizeReferralCode(raw);
  } catch {
    return '';
  }
}

export function setPendingReferralCode(code?: string | null): string {
  const normalized = normalizeReferralCode(code || '');
  try {
    if (normalized) {
      sessionStorage.setItem(REFERRAL_SESSION_KEY, normalized);
    } else {
      sessionStorage.removeItem(REFERRAL_SESSION_KEY);
    }
  } catch {
    // ignore storage restriction
  }
  return normalized;
}

export function clearPendingReferralCode(): void {
  try {
    sessionStorage.removeItem(REFERRAL_SESSION_KEY);
  } catch {
    // ignore storage restriction
  }
}

export function captureReferralCodeFromUrl(): string {
  try {
    const searchRef = new URLSearchParams(window.location.search).get('ref');
    if (searchRef) {
      return setPendingReferralCode(searchRef);
    }
    const hashQuery = window.location.hash.split('?')[1] || '';
    const hashRef = new URLSearchParams(hashQuery).get('ref');
    if (hashRef) {
      return setPendingReferralCode(hashRef);
    }
  } catch {
    // ignore
  }
  return getPendingReferralCode();
}

enum FirestoreOperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleAuthFirestoreError(
  error: unknown,
  operationType: FirestoreOperationType,
  path: string | null
) {
  markFirestoreWriteQuotaExceededIfMatch(error);
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function buildTwoFactorSessionKey(user: User): string {
  const signInToken = user.metadata?.lastSignInTime || 'active';
  return `${TWO_FA_SESSION_PREFIX}${user.uid}_${signInToken}`;
}

function clearAllTwoFactorSessionMarkers(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(TWO_FA_SESSION_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore storage restriction
  }
}

function maskPhoneForProfile(phone?: string | null): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (trimmed.includes('*') || trimmed.includes('•')) return trimmed;
  if (trimmed.length <= 6) return trimmed;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-3)}`;
}

export function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return BOOTSTRAP_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export type SignInResultStatus = 'signed_in' | 'mfa_required';

export interface PhoneVerificationSession {
  mode: 'mfa' | 'phone_link';
  normalizedPhone: string;
  verificationId?: string;
  confirmationResult?: ConfirmationResult;
}

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  activeRole: RoleType;
  activeAccountType: AccountType;
  isAdmin: boolean;
  isStaff: boolean;
  isCitizen: boolean;
  isPrimaryAdmin: boolean;
  isBanned: boolean;
  hasPasswordProvider: boolean;
  hasGoogleProvider: boolean;
  totpConfig: UserTotpSecurityDoc | null;
  twoFactorEnabled: boolean;
  twoFactorVerifiedThisSession: boolean;
  twoFactorLoading: boolean;
  requiresTwoFactorVerification: boolean;
  enrolledSmsFactors: PhoneMultiFactorInfo[];
  smsMfaEnabled: boolean;
  pendingSmsMfaResolver: MultiFactorResolver | null;
  verifiedDevices: UserVerifiedDevice[];
  currentDeviceId: string;
  currentDeviceTrusted: boolean;
  clearPendingSmsMfaResolver: () => void;
  sendVerificationEmailToCurrentUser: () => Promise<void>;
  refreshCurrentUserState: () => Promise<void>;
  linkGoogleAccount: () => Promise<void>;
  sendPhoneVerificationOtp: (
    rawPhone: string,
    passwordForReauth?: string
  ) => Promise<PhoneVerificationSession>;
  confirmPhoneVerificationOtp: (
    session: PhoneVerificationSession,
    smsCode: string
  ) => Promise<void>;
  confirmAndLockPhoneNumber: (rawPhone: string) => Promise<string>;
  verifyAndLockCitizenId: (
    rawCitizenId: string,
    verifiedDatabaseFields?: Partial<UserProfile>
  ) => Promise<void>;
  registerOrVerifyCurrentDevice: (
    method?: UserVerifiedDevice['verificationMethod'],
    customName?: string
  ) => Promise<void>;
  renameVerifiedDevice: (deviceId: string, newName: string) => Promise<void>;
  removeVerifiedDevice: (deviceId: string) => Promise<void>;
  sendSmsMfaEnrollmentCode: (
    rawPhone: string,
    recaptchaContainer?: HTMLElement | null,
    passwordForReauth?: string
  ) => Promise<{ verificationId: string; normalizedPhone: string }>;
  confirmSmsMfaEnrollment: (
    verificationId: string,
    smsCode: string,
    displayName?: string,
    normalizedPhone?: string
  ) => Promise<void>;
  unenrollSmsMfaFactor: (
    factorOrUid: MultiFactorInfo | string,
    passwordForReauth?: string
  ) => Promise<void>;
  sendSmsMfaSignInCode: (hintIndex: number, recaptchaContainer?: HTMLElement | null) => Promise<string>;
  resolveSmsMfaSignIn: (verificationId: string, smsCode: string) => Promise<void>;
  signInWithGoogle: () => Promise<SignInResultStatus>;
  loginWithEmail: (email: string, pass: string, rememberMe?: boolean) => Promise<SignInResultStatus>;
  sendPasswordReset: (email?: string) => Promise<void>;
  registerWithEmail: (
    email: string,
    pass: string,
    displayName: string,
    phone?: string,
    referralCode?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchPreviewRole: (role: RoleType, accountType: AccountType) => void;
  resetRoleToActual: () => void;
  isSimulatingRole: boolean;
  updateProfileData: (data: Partial<UserProfile>) => Promise<void>;
  linkEmailPassword: (newPassword: string) => Promise<void>;
  changeAccountPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  verifyAccountPassword: (passwordToVerify: string) => Promise<boolean>;
  verifySessionTwoFactorOtp: (
    codeOrRecovery: string
  ) => Promise<{ ok: boolean; usedRecoveryCode?: boolean; error?: string }>;
  enableTwoFactorAuth: (
    secret: string,
    verificationCode: string,
    recoveryCodes: string[],
    issuer?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  disableTwoFactorAuth: (options?: {
    verificationCode?: string;
    password?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [simulatedRole, setSimulatedRole] = useState<{ role: RoleType; accountType: AccountType } | null>(null);
  const [providerTick, setProviderTick] = useState<number>(0);
  const [banNowTick, setBanNowTick] = useState<number>(() => Date.now());

  // 2FA & SMS MFA states
  const [totpConfig, setTotpConfig] = useState<UserTotpSecurityDoc | null>(null);
  const [twoFactorLoading, setTwoFactorLoading] = useState<boolean>(false);
  const [twoFactorVerifiedThisSession, setTwoFactorVerifiedThisSession] = useState<boolean>(false);
  const [pendingSmsMfaResolver, setPendingSmsMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [verifiedDevices, setVerifiedDevices] = useState<UserVerifiedDevice[]>([]);
  const currentDeviceMeta = useRef(detectCurrentDeviceMeta());
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaSlotRef = useRef<HTMLDivElement | null>(null);

  const getOrCreatePersistentRecaptchaHost = useCallback((): HTMLElement => {
    const HOST_ID = 'tyt-firebase-recaptcha-host';
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.position = 'fixed';
      host.style.bottom = '0px';
      host.style.right = '0px';
      host.style.zIndex = '2147483000';
      document.body.appendChild(host);
    }
    return host;
  }, []);

  const clearSmsRecaptchaVerifier = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch {
        // ignore cleanup error
      }
      recaptchaVerifierRef.current = null;
    }
    const oldSlot = recaptchaSlotRef.current;
    recaptchaSlotRef.current = null;
    if (oldSlot) {
      // Hide visually while keeping layout box intact until async Google reCAPTCHA timers settle
      oldSlot.style.visibility = 'hidden';
      oldSlot.style.pointerEvents = 'none';
      oldSlot.style.opacity = '0';
      window.setTimeout(() => {
        try {
          oldSlot.remove();
        } catch {
          // ignore
        }
      }, 45_000);
    }
  }, []);

  const createFreshRecaptchaVerifier = useCallback(
    (_preferredContainer?: HTMLElement | null): {
      verifier: RecaptchaVerifier;
      errorPromise: Promise<never>;
    } => {
      clearSmsRecaptchaVerifier();
      const host = getOrCreatePersistentRecaptchaHost();
      const mountEl = document.createElement('div');
      host.appendChild(mountEl);
      recaptchaSlotRef.current = mountEl;

      let rejectErrorPromise: ((err: Error) => void) | null = null;
      const errorPromise = new Promise<never>((_resolve, reject) => {
        rejectErrorPromise = reject;
      });

      auth.languageCode = 'vi';
      const verifier = new RecaptchaVerifier(auth, mountEl, {
        size: 'invisible',
        'expired-callback': () => {
          window.setTimeout(() => clearSmsRecaptchaVerifier(), 0);
        },
        'error-callback': (rawErr?: unknown) => {
          const err = new Error('auth/captcha-check-failed');
          (err as any).code = 'auth/captcha-check-failed';
          (err as any).cause = rawErr;
          rejectErrorPromise?.(err);
          window.setTimeout(() => clearSmsRecaptchaVerifier(), 0);
        },
      });
      recaptchaVerifierRef.current = verifier;
      return { verifier, errorPromise };
    },
    [clearSmsRecaptchaVerifier, getOrCreatePersistentRecaptchaHost]
  );

  const runVerifyPhoneWithSafety = useCallback(
    async (
      runVerify: (verifier: RecaptchaVerifier) => Promise<string>,
      preferredContainer?: HTMLElement | null
    ): Promise<string> => {
      const { verifier, errorPromise } = createFreshRecaptchaVerifier(preferredContainer);
      let timeoutId: number | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          const err = new Error('auth/network-request-failed');
          (err as any).code = 'auth/network-request-failed';
          reject(err);
        }, 45_000);
      });

      try {
        auth.languageCode = 'vi';
        const verificationId = await Promise.race([
          runVerify(verifier),
          errorPromise,
          timeoutPromise,
        ]);
        return verificationId;
      } catch (err) {
        clearSmsRecaptchaVerifier();
        throw err;
      } finally {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
    },
    [clearSmsRecaptchaVerifier, createFreshRecaptchaVerifier]
  );

  const clearPendingSmsMfaResolver = useCallback(() => {
    clearSmsRecaptchaVerifier();
    setPendingSmsMfaResolver(null);
  }, [clearSmsRecaptchaVerifier]);

  const markSessionTwoFactorVerified = useCallback((user: User) => {
    try {
      sessionStorage.setItem(buildTwoFactorSessionKey(user), 'verified');
    } catch {
      // ignore storage restriction
    }
    setTwoFactorVerifiedThisSession(true);
  }, []);

  const upsertCurrentDeviceDoc = useCallback(
    async (
      uid: string,
      method: UserVerifiedDevice['verificationMethod'],
      customName?: string,
      forceTrust = true
    ) => {
      const meta = currentDeviceMeta.current;
      const now = new Date().toISOString();
      const devicePath = `users/${uid}/devices/${meta.deviceId}`;
      const existing = verifiedDevices.find((d) => d.deviceId === meta.deviceId);
      const payload: UserVerifiedDevice = {
        deviceId: meta.deviceId,
        deviceName: (customName || existing?.deviceName || meta.deviceName).slice(0, 128),
        platform: meta.platform,
        os: meta.os,
        browser: meta.browser,
        isTrusted: forceTrust ? true : Boolean(existing?.isTrusted ?? true),
        verificationMethod: method || existing?.verificationMethod || 'password',
        verifiedAt: existing?.verifiedAt || now,
        firstSeenAt: existing?.firstSeenAt || now,
        lastActiveAt: now,
      };
      try {
        await setDoc(doc(db, 'users', uid, 'devices', meta.deviceId), payload, { merge: true });
      } catch (err) {
        handleAuthFirestoreError(err, FirestoreOperationType.WRITE, devicePath);
      }
    },
    [verifiedDevices]
  );

  const syncedLockCacheRef = useRef<string>('');

  const syncVerifiedIdentityLocks = useCallback(
    async (user: User, profile?: UserProfile | null, force = false) => {
      if (isFirestoreWriteQuotaExceeded()) return;
      const now = new Date().toISOString();
      const hasGoogle = Boolean(user.providerData?.some((p) => p.providerId === 'google.com'));
      const emailIsVerified = Boolean(user.emailVerified || hasGoogle);
      const smsFactors = multiFactor(user).enrolledFactors.filter(
        (f): f is PhoneMultiFactorInfo => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID
      );
      const authPhone = smsFactors[0]?.phoneNumber || user.phoneNumber || '';

      const lockSig = [
        user.uid,
        emailIsVerified ? (user.email || '').toLowerCase() : '',
        authPhone,
        Boolean(profile?.googleLinked),
        Boolean(profile?.emailVerified),
        Boolean(profile?.phoneVerified),
      ].join('|');

      const storageKey = `tyt_id_lock_sig_${user.uid}`;
      if (!force) {
        if (syncedLockCacheRef.current === lockSig) return;
        try {
          if (
            localStorage.getItem(storageKey) === lockSig &&
            (!emailIsVerified || Boolean(profile?.emailVerified)) &&
            (!authPhone || Boolean(profile?.phoneVerified)) &&
            (!hasGoogle || Boolean(profile?.googleLinked))
          ) {
            syncedLockCacheRef.current = lockSig;
            return;
          }
        } catch {
          // ignore storage errors
        }
      }
      syncedLockCacheRef.current = lockSig;

      const updates: Partial<UserProfile> = {};
      if (hasGoogle && !profile?.googleLinked) {
        updates.googleLinked = true;
      }
      if (emailIsVerified && user.email) {
        const emailLockId = await buildEmailLockId(user.email);
        if (emailLockId) {
          await claimExclusiveIdentifierLock({
            lockId: emailLockId,
            type: 'email',
            valueMasked: maskEmailForLock(user.email),
            ownerUid: user.uid,
          }).catch((err) => {
            markFirestoreWriteQuotaExceededIfMatch(err);
          });
        }
        if (!profile?.emailVerified) {
          updates.emailVerified = true;
          updates.emailVerifiedAt = now;
        }
      }
      const profilePhone =
        profile?.verifiedPhone ||
        profile?.phoneNumber ||
        '';
      const candidatePhone =
        authPhone && !authPhone.includes('*') && !authPhone.includes('•')
          ? authPhone
          : profilePhone && !profilePhone.includes('*') && !profilePhone.includes('•')
          ? profilePhone
          : '';
      if (candidatePhone) {
        const normalized = normalizeAndValidatePhone(candidatePhone);
        const phoneLockId = buildPhoneLockId(normalized || candidatePhone);
        let lockClaimed = false;
        if (phoneLockId && normalized) {
          const lockRes = await claimExclusiveIdentifierLock({
            lockId: phoneLockId,
            type: 'phone',
            valueMasked: maskPhoneForLock(normalized),
            ownerUid: user.uid,
          }).catch((err) => {
            markFirestoreWriteQuotaExceededIfMatch(err);
            return { ok: false };
          });
          lockClaimed = Boolean(lockRes?.ok);
        }
        if ((authPhone || lockClaimed) && !profile?.phoneVerified && normalized) {
          updates.phoneVerified = true;
          updates.verifiedPhone = normalized;
          updates.phoneNumber = normalized;
          updates.phoneVerifiedAt = now;
        }
      }
      if (Object.keys(updates).length > 0 && !isFirestoreWriteQuotaExceeded()) {
        try {
          await setDoc(doc(db, 'users', user.uid), { ...updates, updatedAt: now }, { merge: true });
        } catch (err) {
          markFirestoreWriteQuotaExceededIfMatch(err);
        }
      }
      if (!isFirestoreWriteQuotaExceeded()) {
        try {
          localStorage.setItem(storageKey, lockSig);
        } catch {
          // ignore
        }
      }
    },
    []
  );

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubTotp: (() => void) | null = null;
    let unsubDevices: (() => void) | null = null;
    let syncedAdminUid = '';
    let creatingProfileForUid = '';
    let recordedSessionDeviceKey = '';

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubTotp) {
        unsubTotp();
        unsubTotp = null;
      }
      if (unsubDevices) {
        unsubDevices();
        unsubDevices = null;
      }

      setCurrentUser(user);
      setProviderTick((t) => t + 1);

      if (!user) {
        setUserProfile(null);
        setTotpConfig(null);
        setVerifiedDevices([]);
        setTwoFactorLoading(false);
        setTwoFactorVerifiedThisSession(false);
        setLoading(false);
        return;
      }

      // Check session verification state for this login session
      let isVerifiedInSession = false;
      try {
        isVerifiedInSession = sessionStorage.getItem(buildTwoFactorSessionKey(user)) === 'verified';
      } catch {
        isVerifiedInSession = false;
      }
      setTwoFactorVerifiedThisSession(isVerifiedInSession);
      setTwoFactorLoading(true);

      // Subscribe to owner's verified devices
      const devicesPath = `users/${user.uid}/devices`;
      const devicesQuery = query(
        collection(db, 'users', user.uid, 'devices'),
        orderBy('lastActiveAt', 'desc')
      );
      unsubDevices = onSnapshot(
        devicesQuery,
        (snap) => {
          const list = snap.docs.map((d) => d.data() as UserVerifiedDevice);
          setVerifiedDevices(list);
        },
        (err) => {
          console.warn('Devices snapshot fallback:', err?.message);
          if (String(err?.message || '').toLowerCase().includes('permission')) {
            try {
              handleAuthFirestoreError(err, FirestoreOperationType.LIST, devicesPath);
            } catch {
              // logged
            }
          }
        }
      );

      // Record/refresh current device presence at most once every 6 hours (unless auth method changed)
      const sessionKey = `${user.uid}_${user.metadata?.lastSignInTime || 'active'}`;
      if (recordedSessionDeviceKey !== sessionKey && !isFirestoreWriteQuotaExceeded()) {
        recordedSessionDeviceKey = sessionKey;
        const meta = currentDeviceMeta.current;
        const hasGoogle = Boolean(user.providerData?.some((p) => p.providerId === 'google.com'));
        const method: UserVerifiedDevice['verificationMethod'] = hasGoogle ? 'google' : 'password';
        const deviceSyncKey = `tyt_device_sync_${user.uid}_${meta.deviceId}`;
        let shouldWriteDevice = true;
        let hasRecordedDeviceBefore = false;
        try {
          const raw = localStorage.getItem(deviceSyncKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { ts?: number; method?: string };
            hasRecordedDeviceBefore = true;
            if (
              parsed?.method === method &&
              typeof parsed?.ts === 'number' &&
              Date.now() - parsed.ts < 6 * 60 * 60 * 1000
            ) {
              shouldWriteDevice = false;
            }
          }
        } catch {
          // ignore storage errors
        }

        if (shouldWriteDevice) {
          const now = new Date().toISOString();
          const devicePayload: Partial<UserVerifiedDevice> = {
            deviceId: meta.deviceId,
            deviceName: meta.deviceName,
            platform: meta.platform,
            os: meta.os,
            browser: meta.browser,
            isTrusted: true,
            verificationMethod: method,
            verifiedAt: now,
            lastActiveAt: now,
            ...(hasRecordedDeviceBefore ? {} : { firstSeenAt: now }),
          };
          setDoc(doc(db, 'users', user.uid, 'devices', meta.deviceId), devicePayload, {
            merge: true,
          })
            .then(() => {
              try {
                localStorage.setItem(deviceSyncKey, JSON.stringify({ ts: Date.now(), method }));
              } catch {
                // ignore
              }
            })
            .catch((err) => {
              markFirestoreWriteQuotaExceededIfMatch(err);
            });
        }
      }

      // Subscribe to strictly isolated owner-only TOTP security document
      const totpPath = `users/${user.uid}/security/totp`;
      const totpDocRef = doc(db, 'users', user.uid, 'security', 'totp');
      unsubTotp = onSnapshot(
        totpDocRef,
        (totpSnap) => {
          if (totpSnap.exists()) {
            setTotpConfig(totpSnap.data() as UserTotpSecurityDoc);
          } else {
            setTotpConfig(null);
          }
          setTwoFactorLoading(false);
        },
        (err) => {
          console.warn('TOTP security snapshot fallback:', err?.message);
          setTotpConfig(null);
          setTwoFactorLoading(false);
          if (String(err?.message || '').toLowerCase().includes('permission')) {
            try {
              handleAuthFirestoreError(err, FirestoreOperationType.GET, totpPath);
            } catch {
              // logged cleanly
            }
          }
        }
      );

      const isTargetAdmin = isBootstrapAdminEmail(user.email);
      const userHasPassword = Boolean(user.providerData?.some((p) => p.providerId === 'password'));
      const userHasGoogle = Boolean(user.providerData?.some((p) => p.providerId === 'google.com'));
      const userSmsFactors = multiFactor(user).enrolledFactors.filter(
        (f): f is PhoneMultiFactorInfo => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID
      );
      const userHasSmsMfa = userSmsFactors.length > 0;
      const firstSmsMasked = userSmsFactors[0] ? maskPhoneForProfile(userSmsFactors[0].phoneNumber) : '';
      const userDocRef = doc(db, 'users', user.uid);

      unsubProfile = onSnapshot(
        userDocRef,
        async (snap) => {
          try {
            if (snap.exists()) {
              const profile = { uid: snap.id, ...snap.data() } as UserProfile;
              let changed = false;
              if (isTargetAdmin && profile.role !== 'super_admin') {
                profile.role = 'super_admin';
                profile.accountType = 'admin';
                changed = true;
              }
              if (!profile.avatarUrl && user.photoURL) {
                profile.avatarUrl = user.photoURL;
                changed = true;
              }
              if (userHasPassword && !profile.hasPasswordLinked) {
                profile.hasPasswordLinked = true;
                changed = true;
              }
              if (userHasGoogle && !profile.googleLinked) {
                profile.googleLinked = true;
                changed = true;
              }
              if ((user.emailVerified || userHasGoogle) && !profile.emailVerified) {
                profile.emailVerified = true;
                profile.emailVerifiedAt = new Date().toISOString();
                changed = true;
              }
              if ((user.phoneNumber || userHasSmsMfa) && !profile.phoneVerified) {
                profile.phoneVerified = true;
                profile.phoneVerifiedAt = profile.phoneVerifiedAt || new Date().toISOString();
                if (!profile.verifiedPhone && (user.phoneNumber || userSmsFactors[0]?.phoneNumber)) {
                  profile.verifiedPhone = user.phoneNumber || userSmsFactors[0]?.phoneNumber || '';
                }
                changed = true;
              }
              if (Boolean(profile.smsMfaEnabled) !== userHasSmsMfa) {
                profile.smsMfaEnabled = userHasSmsMfa;
                profile.smsMfaPhoneMasked = firstSmsMasked;
                changed = true;
              } else if (userHasSmsMfa && firstSmsMasked && profile.smsMfaPhoneMasked !== firstSmsMasked) {
                profile.smsMfaPhoneMasked = firstSmsMasked;
                changed = true;
              }
              const profileIsBanned = !isTargetAdmin && isUserActivelyBanned(profile);
              if (changed && !profileIsBanned && !isFirestoreWriteQuotaExceeded()) {
                try {
                  await setDoc(userDocRef, profile, { merge: true });
                } catch (writeErr) {
                  markFirestoreWriteQuotaExceededIfMatch(writeErr);
                }
              }
              if (!profileIsBanned) {
                void syncVerifiedIdentityLocks(user, profile);
              }
              if (isTargetAdmin && syncedAdminUid !== user.uid && !isFirestoreWriteQuotaExceeded()) {
                syncedAdminUid = user.uid;
                const adminSyncKey = `tyt_admin_doc_synced_${user.uid}`;
                let adminRecentlySynced = false;
                try {
                  const lastTs = Number(localStorage.getItem(adminSyncKey) || 0);
                  adminRecentlySynced = Boolean(lastTs && Date.now() - lastTs < 24 * 60 * 60 * 1000);
                } catch {
                  // ignore
                }
                if (!adminRecentlySynced) {
                  try {
                    await setDoc(
                      doc(db, 'admins', user.uid),
                      {
                        uid: user.uid,
                        email: user.email,
                        role: 'super_admin',
                        updatedAt: new Date().toISOString(),
                      },
                      { merge: true }
                    );
                    try {
                      localStorage.setItem(adminSyncKey, String(Date.now()));
                    } catch {
                      // ignore
                    }
                  } catch (adminDocErr) {
                    markFirestoreWriteQuotaExceededIfMatch(adminDocErr);
                    console.warn('Sync admin record error:', adminDocErr);
                  }
                }
              }
              setUserProfile(profile);
              setLoading(false);
            } else if (creatingProfileForUid !== user.uid) {
              creatingProfileForUid = user.uid;
              const now = new Date().toISOString();
              const resolvedVerifiedPhone = user.phoneNumber || userSmsFactors[0]?.phoneNumber || '';

              let resolvedRole: RoleType = isTargetAdmin ? 'super_admin' : 'citizen';
              let resolvedAccountType: AccountType = isTargetAdmin ? 'admin' : 'citizen';
              let usedReferralCode = '';
              if (!isTargetAdmin) {
                const pendingRef = getPendingReferralCode();
                if (pendingRef) {
                  const refCheck = await validateReferralCode(pendingRef);
                  if (refCheck.valid && refCheck.item) {
                    resolvedRole = refCheck.item.targetRole || 'staff';
                    resolvedAccountType = 'employee';
                    usedReferralCode = refCheck.item.code;
                  }
                }
              }

              const newProfile: UserProfile = {
                uid: user.uid,
                email: user.email || '',
                displayName:
                  user.displayName ||
                  (isTargetAdmin ? 'Admin Hồng Đức' : user.email?.split('@')[0] || 'Người dùng'),
                phoneNumber: user.phoneNumber || resolvedVerifiedPhone || '',
                ...(user.photoURL ? { avatarUrl: user.photoURL } : {}),
                role: resolvedRole,
                accountType: resolvedAccountType,
                ...(usedReferralCode ? { referralCodeUsed: usedReferralCode } : {}),
                status: 'active',
                hasPasswordLinked: userHasPassword,
                googleLinked: userHasGoogle,
                emailVerified: Boolean(user.emailVerified || userHasGoogle),
                ...(user.emailVerified || userHasGoogle ? { emailVerifiedAt: now } : {}),
                phoneVerified: Boolean(resolvedVerifiedPhone || userHasSmsMfa),
                ...(resolvedVerifiedPhone ? { verifiedPhone: resolvedVerifiedPhone, phoneVerifiedAt: now } : {}),
                twoFactorEnabled: false,
                smsMfaEnabled: userHasSmsMfa,
                ...(firstSmsMasked ? { smsMfaPhoneMasked: firstSmsMasked } : {}),
                createdAt: now,
              };
              if (!isFirestoreWriteQuotaExceeded()) {
                try {
                  await setDoc(userDocRef, newProfile);
                  if (usedReferralCode) {
                    await consumeReferralCodeUsage(usedReferralCode, user.uid);
                    clearPendingReferralCode();
                  }
                } catch (createErr) {
                  markFirestoreWriteQuotaExceededIfMatch(createErr);
                }
              }
              void syncVerifiedIdentityLocks(user, newProfile);
              setUserProfile(newProfile);
              setLoading(false);

              if (isTargetAdmin && syncedAdminUid !== user.uid && !isFirestoreWriteQuotaExceeded()) {
                syncedAdminUid = user.uid;
                try {
                  await setDoc(doc(db, 'admins', user.uid), {
                    uid: user.uid,
                    email: user.email,
                    role: 'super_admin',
                    createdAt: now,
                  });
                } catch (adminDocErr) {
                  markFirestoreWriteQuotaExceededIfMatch(adminDocErr);
                  console.warn('Create admin record error:', adminDocErr);
                }
              }
            }
          } catch (err) {
            console.warn('Profile snapshot sync fallback:', err);
            setLoading(false);
          }
        },
        (err) => {
          console.warn('Profile read fallback:', err);
          setUserProfile({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || (isTargetAdmin ? 'Admin Hồng Đức' : 'Người dùng'),
            ...(user.photoURL ? { avatarUrl: user.photoURL } : {}),
            role: isTargetAdmin ? 'super_admin' : 'citizen',
            accountType: isTargetAdmin ? 'admin' : 'citizen',
            status: 'active',
            hasPasswordLinked: userHasPassword,
            createdAt: new Date().toISOString(),
          });
          setLoading(false);
        }
      );
    });

    return () => {
      if (unsubProfile) unsubProfile();
      if (unsubTotp) unsubTotp();
      if (unsubDevices) unsubDevices();
      unsubscribe();
    };
  }, [syncVerifiedIdentityLocks]);

  const signInWithGoogle = async (): Promise<SignInResultStatus> => {
    clearAllTwoFactorSessionMarkers();
    setTwoFactorVerifiedThisSession(false);
    setPendingSmsMfaResolver(null);
    await setPersistence(auth, browserLocalPersistence);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
      return 'signed_in';
    } catch (err: any) {
      if (err?.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, err);
        setPendingSmsMfaResolver(resolver);
        return 'mfa_required';
      }
      throw err;
    }
  };

  const loginWithEmail = async (
    email: string,
    pass: string,
    rememberMe = true
  ): Promise<SignInResultStatus> => {
    clearAllTwoFactorSessionMarkers();
    setTwoFactorVerifiedThisSession(false);
    setPendingSmsMfaResolver(null);
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      return 'signed_in';
    } catch (err: any) {
      if (err?.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, err);
        setPendingSmsMfaResolver(resolver);
        return 'mfa_required';
      }
      throw err;
    }
  };

  const sendPasswordReset = async (targetEmail?: string) => {
    const resolvedEmail = (targetEmail || currentUser?.email || '').trim();
    if (!resolvedEmail) {
      throw new Error('Không tìm thấy địa chỉ email để gửi liên kết đặt lại mật khẩu.');
    }
    auth.languageCode = 'vi';
    await sendPasswordResetEmail(auth, resolvedEmail);
  };

  const registerWithEmail = async (
    email: string,
    pass: string,
    displayName: string,
    phone?: string,
    referralCode?: string
  ) => {
    const cleanEmail = autoCompleteGmail(email);
    if (!isValidEmailAddress(cleanEmail)) {
      throw new Error('Địa chỉ Email / Gmail không hợp lệ.');
    }
    const cleanName = displayName.trim();
    const cleanPhone = phone ? phone.trim() : '';
    const normalizedPhone = cleanPhone ? normalizeAndValidatePhone(cleanPhone) : '';

    if (cleanPhone && !normalizedPhone) {
      throw new Error('Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
    }

    const isTargetAdmin = isBootstrapAdminEmail(cleanEmail);
    const effectiveReferral = normalizeReferralCode(referralCode || getPendingReferralCode());
    let validatedRefRole: RoleType = 'citizen';
    let validatedAccountType: AccountType = 'citizen';
    let usedReferralCode = '';

    if (!isTargetAdmin && effectiveReferral) {
      const refCheck = await validateReferralCode(effectiveReferral);
      if (!refCheck.valid || !refCheck.item) {
        throw new Error(refCheck.error || 'Mã giới thiệu không hợp lệ hoặc đã ngừng hoạt động.');
      }
      validatedRefRole = refCheck.item.targetRole || 'staff';
      validatedAccountType = 'employee';
      usedReferralCode = refCheck.item.code;
    }

    // Enforce uniqueness locks BEFORE creating account
    const emailLockId = await buildEmailLockId(cleanEmail);
    if (emailLockId) {
      const emailCheck = await checkIdentifierAvailability(emailLockId);
      if (!emailCheck.available) {
        throw new Error('Địa chỉ Email / Gmail này đã được đăng ký bởi tài khoản khác và không thể sử dụng.');
      }
    }
    const phoneLockId = normalizedPhone ? buildPhoneLockId(normalizedPhone) : '';
    if (phoneLockId) {
      const phoneCheck = await checkIdentifierAvailability(phoneLockId);
      if (!phoneCheck.available) {
        throw new Error('Số điện thoại này đã được đăng ký bởi tài khoản khác và không thể sử dụng.');
      }
    }

    clearAllTwoFactorSessionMarkers();
    await setPersistence(auth, browserLocalPersistence);
    const res = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
    if (cleanName) {
      try {
        await updateProfile(res.user, { displayName: cleanName });
      } catch {
        // non-blocking
      }
    }

    // Immediately claim email lock so password reset identity checks work immediately
    if (emailLockId) {
      await claimExclusiveIdentifierLock({
        lockId: emailLockId,
        type: 'email',
        valueMasked: maskEmailForLock(cleanEmail),
        ownerUid: res.user.uid,
      }).catch((err) => {
        console.warn('Claim email lock on signup warning:', err);
      });
    }

    // Automatically trigger Firebase email verification on signup
    try {
      auth.languageCode = 'vi';
      await sendEmailVerification(res.user);
    } catch {
      // user can resend inside Verification Hub
    }

    const now = new Date().toISOString();

    let phoneLocked = false;
    if (normalizedPhone && phoneLockId) {
      const lockRes = await claimExclusiveIdentifierLock({
        lockId: phoneLockId,
        type: 'phone',
        valueMasked: maskPhoneForLock(normalizedPhone),
        ownerUid: res.user.uid,
      });
      phoneLocked = lockRes.ok;
    }

    const profile: UserProfile = {
      uid: res.user.uid,
      email: cleanEmail,
      displayName: cleanName || cleanEmail.split('@')[0],
      phoneNumber: phoneLocked ? normalizedPhone : '',
      role: isTargetAdmin ? 'super_admin' : validatedRefRole,
      accountType: isTargetAdmin ? 'admin' : validatedAccountType,
      ...(usedReferralCode ? { referralCodeUsed: usedReferralCode } : {}),
      status: 'active',
      hasPasswordLinked: true,
      emailVerified: Boolean(res.user.emailVerified),
      phoneVerified: phoneLocked,
      ...(phoneLocked ? { verifiedPhone: normalizedPhone, phoneVerifiedAt: now } : {}),
      twoFactorEnabled: false,
      createdAt: now,
    };

    try {
      await setDoc(doc(db, 'users', res.user.uid), profile);
      if (usedReferralCode) {
        await consumeReferralCodeUsage(usedReferralCode, res.user.uid);
        clearPendingReferralCode();
      }
      if (isTargetAdmin) {
        await setDoc(doc(db, 'admins', res.user.uid), { uid: res.user.uid, email: cleanEmail, role: 'super_admin' });
      }
      await upsertCurrentDeviceDoc(res.user.uid, 'password');
    } catch (e) {
      console.warn('Save initial profile error:', e);
    }
    setUserProfile(profile);
  };

  const logout = async () => {
    clearAllTwoFactorSessionMarkers();
    clearPendingSmsMfaResolver();
    setTwoFactorVerifiedThisSession(false);
    setTotpConfig(null);
    setVerifiedDevices([]);
    await signOut(auth);
    setSimulatedRole(null);
  };

  const switchPreviewRole = (role: RoleType, accountType: AccountType) => {
    setSimulatedRole({ role, accountType });
  };

  const resetRoleToActual = () => {
    setSimulatedRole(null);
  };

  const updateProfileData = async (data: Partial<UserProfile>) => {
    if (!currentUser) return;
    const path = `users/${currentUser.uid}`;
    const ref = doc(db, 'users', currentUser.uid);

    const isSuperAdminUser =
      isBootstrapAdminEmail(currentUser.email) || userProfile?.role === 'super_admin';
    const allowEditByAdmin =
      isSuperAdminUser || Boolean(userProfile?.allowIdentityEditByAdmin);
    const isAdminUser =
      isSuperAdminUser ||
      userProfile?.role === 'admin' ||
      userProfile?.accountType === 'admin';

    const prevNormalizedPhone = normalizeAndValidatePhone(
      userProfile?.verifiedPhone || userProfile?.phoneNumber || ''
    );
    const prevPhoneLockId = prevNormalizedPhone ? buildPhoneLockId(prevNormalizedPhone) : '';
    const prevCccdDigits = (userProfile?.citizenId || '').replace(/\D/g, '');
    const prevCccdLockId = prevCccdDigits ? buildCccdLockId(prevCccdDigits) : '';

    // Handle phoneNumber uniqueness & optional update when unlocked by Admin
    let lockedNewPhone = '';
    let clearedPhone = false;
    if (data.phoneNumber !== undefined && (!userProfile?.phoneVerified || allowEditByAdmin)) {
      const rawPhone = data.phoneNumber.trim();
      if (rawPhone) {
        const normalized = normalizeAndValidatePhone(rawPhone);
        if (!normalized) {
          throw new Error('Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
        }
        if (normalized !== prevNormalizedPhone || !userProfile?.phoneVerified) {
          const lockId = buildPhoneLockId(normalized);
          const lockRes = await claimExclusiveIdentifierLock({
            lockId,
            type: 'phone',
            valueMasked: maskPhoneForLock(normalized),
            ownerUid: currentUser.uid,
          });
          if (!lockRes.ok) {
            throw new Error(lockRes.error || 'Số điện thoại này đã được tài khoản khác sử dụng.');
          }
          if (prevPhoneLockId && prevPhoneLockId !== lockId && allowEditByAdmin) {
            await releaseExclusiveIdentifierLock(prevPhoneLockId);
          }
          lockedNewPhone = normalized;
        }
      } else if (allowEditByAdmin && prevPhoneLockId) {
        await releaseExclusiveIdentifierLock(prevPhoneLockId);
        clearedPhone = true;
      }
    }

    // Handle citizenId uniqueness & optional update when unlocked by Admin
    let updatedCccdDigits: string | null = null;
    let clearedCccd = false;
    if (data.citizenId !== undefined && (!userProfile?.citizenIdVerified || allowEditByAdmin)) {
      const nextDigits = data.citizenId.replace(/\D/g, '').trim();
      if (nextDigits) {
        if (nextDigits !== prevCccdDigits) {
          if (nextDigits.length < 9 || nextDigits.length > 12) {
            throw new Error('Số CCCD/ĐDCN phải gồm từ 9 đến 12 chữ số.');
          }
          const newCccdLockId = buildCccdLockId(nextDigits);
          if (allowEditByAdmin || userProfile?.citizenIdVerified) {
            const lockRes = await claimExclusiveIdentifierLock({
              lockId: newCccdLockId,
              type: 'cccd',
              valueMasked: maskCccdForLock(nextDigits),
              ownerUid: currentUser.uid,
            });
            if (!lockRes.ok) {
              throw new Error(lockRes.error || 'Số CCCD này đã được tài khoản khác xác minh và không thể sử dụng.');
            }
            if (prevCccdLockId && prevCccdLockId !== newCccdLockId && allowEditByAdmin) {
              await releaseExclusiveIdentifierLock(prevCccdLockId);
            }
          } else {
            const check = await checkIdentifierAvailability(newCccdLockId, currentUser.uid);
            if (!check.available) {
              throw new Error('Số CCCD này đã được xác minh bởi tài khoản khác và không thể sử dụng.');
            }
          }
          updatedCccdDigits = nextDigits;
        }
      } else if (allowEditByAdmin) {
        if (prevCccdLockId) {
          await releaseExclusiveIdentifierLock(prevCccdLockId);
        }
        clearedCccd = true;
      }
    }

    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) cleaned[k] = v;
    }

    const now = new Date().toISOString();
    if (lockedNewPhone) {
      cleaned.phoneNumber = lockedNewPhone;
      cleaned.verifiedPhone = lockedNewPhone;
      cleaned.phoneVerified = true;
      cleaned.phoneVerifiedAt = now;
    } else if (clearedPhone) {
      cleaned.phoneNumber = '';
      cleaned.verifiedPhone = '';
      cleaned.phoneVerified = false;
    }

    if (updatedCccdDigits !== null) {
      cleaned.citizenId = updatedCccdDigits;
      if (userProfile?.citizenIdVerified || allowEditByAdmin) {
        cleaned.citizenIdVerified = true;
        cleaned.citizenIdVerifiedAt = now;
      }
    } else if (clearedCccd) {
      cleaned.citizenId = '';
      cleaned.citizenIdVerified = false;
      cleaned.identityVerifiedFromDatabase = false;
    }

    // Never allow overwriting verified email
    if (userProfile?.emailVerified) {
      delete cleaned.email;
      cleaned.emailVerified = true;
    }

    // Protect admin-controlled flags & ban status fields for non-admins
    if (!isAdminUser) {
      delete cleaned.allowIdentityEditByAdmin;
      delete cleaned.status;
      delete cleaned.banType;
      delete cleaned.bannedUntil;
      delete cleaned.bannedUntilMs;
      delete cleaned.banReason;
      delete cleaned.bannedAt;
      delete cleaned.bannedByUid;
      delete cleaned.bannedByName;
    }

    // When locked (not unlocked by Admin), prevent tampering with locked identity & profile fields
    if (!allowEditByAdmin) {
      if (userProfile?.phoneVerified && userProfile?.verifiedPhone) {
        cleaned.phoneNumber = userProfile.verifiedPhone;
        cleaned.verifiedPhone = userProfile.verifiedPhone;
        cleaned.phoneVerified = true;
      }
      if (userProfile?.citizenIdVerified && userProfile?.citizenId) {
        cleaned.citizenId = userProfile.citizenId;
        cleaned.citizenIdVerified = true;
      }

      const isLockedProfile = Boolean(
        userProfile?.identityVerifiedFromDatabase || userProfile?.citizenIdVerified
      );
      if (isLockedProfile && !isAdminUser) {
        const lockedKeys: (keyof UserProfile)[] = [
          'identityVerifiedFromDatabase',
          'citizenIdVerified',
          'citizenId',
          'displayName',
          'dob',
          'gender',
          'ethnicity',
          'provinceCode',
          'provinceName',
          'wardCode',
          'wardName',
          'address',
          'department',
          'position',
        ];
        for (const key of lockedKeys) {
          if (userProfile && userProfile[key] !== undefined) {
            cleaned[key] = userProfile[key];
          } else {
            delete cleaned[key];
          }
        }
      }
    }

    cleaned.updatedAt = now;
    try {
      await setDoc(ref, cleaned, { merge: true });
      setUserProfile((prev) => (prev ? { ...prev, ...cleaned } : null));
    } catch (err) {
      handleAuthFirestoreError(err, FirestoreOperationType.UPDATE, path);
    }
  };

  const linkEmailPassword = async (newPassword: string) => {
    if (!currentUser || !currentUser.email) {
      throw new Error('Không tìm thấy thông tin tài khoản email đang đăng nhập.');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Mật khẩu phải có tối thiểu 6 ký tự.');
    }

    const cred = EmailAuthProvider.credential(currentUser.email, newPassword);
    try {
      await linkWithCredential(currentUser, cred);
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/requires-recent-login') {
        await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
        await linkWithCredential(currentUser, cred);
      } else if (code === 'auth/provider-already-linked' || code === 'auth/credential-already-in-use') {
        await updatePassword(currentUser, newPassword);
      } else {
        throw err;
      }
    }

    await currentUser.reload();
    setProviderTick((t) => t + 1);
    await updateProfileData({ hasPasswordLinked: true });
  };

  const verifyAccountPassword = async (passwordToVerify: string): Promise<boolean> => {
    if (!currentUser || !currentUser.email) {
      throw new Error('Không tìm thấy email tài khoản.');
    }
    if (!passwordToVerify) return false;
    const cred = EmailAuthProvider.credential(currentUser.email, passwordToVerify);
    await reauthenticateWithCredential(currentUser, cred);
    return true;
  };

  const changeAccountPassword = async (currentPassword: string, newPassword: string) => {
    if (!currentUser || !currentUser.email) {
      throw new Error('Không tìm thấy email tài khoản.');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Mật khẩu mới phải có tối thiểu 6 ký tự.');
    }

    const hasPwd = Boolean(currentUser.providerData?.some((p) => p.providerId === 'password'));
    if (!hasPwd) {
      await linkEmailPassword(newPassword);
      return;
    }

    if (!currentPassword || !currentPassword.trim()) {
      throw new Error('Vui lòng nhập mật khẩu cũ (hiện tại) để tiếp tục.');
    }

    const cred = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, cred);

    try {
      await updatePassword(currentUser, newPassword);
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        await reauthenticateWithCredential(currentUser, cred);
        await updatePassword(currentUser, newPassword);
      } else {
        throw err;
      }
    }

    await currentUser.reload();
    setProviderTick((t) => t + 1);
  };

  const verifySessionTwoFactorOtp = async (
    codeOrRecovery: string
  ): Promise<{ ok: boolean; usedRecoveryCode?: boolean; error?: string }> => {
    if (!currentUser) {
      return { ok: false, error: 'Phiên đăng nhập đã hết hạn.' };
    }
    if (!totpConfig?.enabled || !totpConfig.secret) {
      markSessionTwoFactorVerified(currentUser);
      return { ok: true };
    }

    const cleaned = codeOrRecovery.trim();
    if (!cleaned) {
      return { ok: false, error: 'Vui lòng nhập mã OTP 6 số hoặc mã khôi phục.' };
    }

    // 1. Try 6-digit TOTP verification first
    if (/^\d{6}$/.test(cleaned.replace(/\s+/g, ''))) {
      const isValidTotp = await verifyTotpToken(totpConfig.secret, cleaned, 1);
      if (isValidTotp) {
        markSessionTwoFactorVerified(currentUser);
        return { ok: true };
      }
      return {
        ok: false,
        error: 'Mã OTP Authenticator không chính xác hoặc đã hết hạn 30 giây. Vui lòng kiểm tra lại.',
      };
    }

    // 2. Try one-time Recovery Code
    const normalizedInput = normalizeRecoveryCode(cleaned);
    const existingCodes = Array.isArray(totpConfig.recoveryCodes) ? totpConfig.recoveryCodes : [];
    const matchedIdx = existingCodes.findIndex((c) => normalizeRecoveryCode(c) === normalizedInput);

    if (matchedIdx !== -1) {
      const remainingCodes = existingCodes.filter((_, idx) => idx !== matchedIdx);
      const totpPath = `users/${currentUser.uid}/security/totp`;
      try {
        await setDoc(
          doc(db, 'users', currentUser.uid, 'security', 'totp'),
          {
            enabled: true,
            secret: totpConfig.secret,
            recoveryCodes: remainingCodes,
            issuer: totpConfig.issuer || 'Tram Y Te So',
            verifiedAt: totpConfig.verifiedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        handleAuthFirestoreError(err, FirestoreOperationType.UPDATE, totpPath);
      }
      markSessionTwoFactorVerified(currentUser);
      return { ok: true, usedRecoveryCode: true };
    }

    return { ok: false, error: 'Mã OTP hoặc mã khôi phục không hợp lệ.' };
  };

  const enableTwoFactorAuth = async (
    secret: string,
    verificationCode: string,
    recoveryCodes: string[],
    issuer = 'Tram Y Te So'
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!currentUser) {
      return { ok: false, error: 'Bạn cần đăng nhập để bật khóa 2FA.' };
    }
    const isValid = await verifyTotpToken(secret, verificationCode, 1);
    if (!isValid) {
      return {
        ok: false,
        error: 'Mã OTP 6 số chưa khớp với ứng dụng Authenticator. Hãy kiểm tra đồng hồ thiết bị và thử lại.',
      };
    }

    const now = new Date().toISOString();
    const payload: UserTotpSecurityDoc = {
      enabled: true,
      secret: secret.trim().toUpperCase(),
      recoveryCodes: recoveryCodes.slice(0, 12),
      issuer: issuer.slice(0, 128),
      verifiedAt: now,
      updatedAt: now,
    };

    const totpPath = `users/${currentUser.uid}/security/totp`;
    try {
      await setDoc(doc(db, 'users', currentUser.uid, 'security', 'totp'), payload);
    } catch (err) {
      handleAuthFirestoreError(err, FirestoreOperationType.WRITE, totpPath);
    }

    await updateProfileData({
      twoFactorEnabled: true,
      twoFactorUpdatedAt: now,
      hasPasswordLinked: Boolean(currentUser.providerData?.some((p) => p.providerId === 'password')),
    });

    setTotpConfig(payload);
    markSessionTwoFactorVerified(currentUser);
    return { ok: true };
  };

  const disableTwoFactorAuth = async (options?: {
    verificationCode?: string;
    password?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!currentUser) {
      return { ok: false, error: 'Bạn cần đăng nhập để thực hiện thao tác này.' };
    }

    const hasPwd = Boolean(currentUser.providerData?.some((p) => p.providerId === 'password'));

    if (hasPwd) {
      if (!options?.password) {
        return { ok: false, error: 'Vui lòng nhập mật khẩu tài khoản để xác nhận tắt khóa 2FA.' };
      }
      try {
        await verifyAccountPassword(options.password);
      } catch (err: any) {
        const msg = err?.code || err?.message || '';
        if (String(msg).includes('wrong-password') || String(msg).includes('invalid-credential')) {
          return { ok: false, error: 'Mật khẩu xác nhận không chính xác.' };
        }
        return { ok: false, error: 'Không thể xác thực mật khẩu. Vui lòng thử lại hoặc dùng Quên mật khẩu.' };
      }
    }

    if (totpConfig?.enabled && totpConfig.secret) {
      const code = (options?.verificationCode || '').trim();
      if (!code) {
        return { ok: false, error: 'Vui lòng nhập mã OTP 6 số từ Authenticator hoặc mã khôi phục.' };
      }
      const normalizedInput = normalizeRecoveryCode(code);
      const isRecoveryMatch = (totpConfig.recoveryCodes || []).some(
        (c) => normalizeRecoveryCode(c) === normalizedInput
      );
      const isOtpMatch = /^\d{6}$/.test(code.replace(/\s+/g, ''))
        ? await verifyTotpToken(totpConfig.secret, code, 1)
        : false;
      if (!isOtpMatch && !isRecoveryMatch) {
        return { ok: false, error: 'Mã OTP Authenticator hoặc mã khôi phục không hợp lệ.' };
      }
    }

    const totpPath = `users/${currentUser.uid}/security/totp`;
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'security', 'totp'));
    } catch (err) {
      handleAuthFirestoreError(err, FirestoreOperationType.DELETE, totpPath);
    }

    await updateProfileData({
      twoFactorEnabled: false,
      twoFactorUpdatedAt: new Date().toISOString(),
    });

    setTotpConfig(null);
    clearAllTwoFactorSessionMarkers();
    setTwoFactorVerifiedThisSession(false);
    return { ok: true };
  };

  const sendVerificationEmailToCurrentUser = async () => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để gửi email xác minh.');
    }
    auth.languageCode = 'vi';
    await sendEmailVerification(currentUser);
  };

  const refreshCurrentUserState = async () => {
    if (!currentUser) return;
    await currentUser.reload();
    setProviderTick((t) => t + 1);
    await syncVerifiedIdentityLocks(currentUser, userProfile);
  };

  const linkGoogleAccount = async () => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để liên kết Gmail / Google.');
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await linkWithPopup(currentUser, provider);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/provider-already-linked') {
        // already linked
      } else if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        throw new Error('Tài khoản Gmail / Google này đã được liên kết với một tài khoản khác và không thể sử dụng.');
      } else if (code === 'auth/requires-recent-login') {
        await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
        await linkWithPopup(currentUser, provider);
      } else {
        throw err;
      }
    }
    await currentUser.reload();
    setProviderTick((t) => t + 1);
    await syncVerifiedIdentityLocks(currentUser, userProfile);
    await upsertCurrentDeviceDoc(currentUser.uid, 'google');
  };

  const confirmAndLockPhoneNumber = async (rawPhone: string): Promise<string> => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để xác nhận số điện thoại.');
    }
    const normalizedPhone = normalizeAndValidatePhone(rawPhone);
    if (!normalizedPhone) {
      throw new Error('Số điện thoại phải gồm đúng 10 chữ số (VD: 0912345678).');
    }
    const isSuperAdminUser =
      isBootstrapAdminEmail(currentUser.email) || userProfile?.role === 'super_admin';
    const prevNormalizedPhone = normalizeAndValidatePhone(
      userProfile?.verifiedPhone || userProfile?.phoneNumber || ''
    );
    if (!isSuperAdminUser && userProfile?.phoneVerified && prevNormalizedPhone) {
      if (prevNormalizedPhone !== normalizedPhone) {
        throw new Error('Số điện thoại của tài khoản này đã được xác nhận và khoá cố định.');
      }
    }

    const lockId = buildPhoneLockId(normalizedPhone);
    const lockRes = await claimExclusiveIdentifierLock({
      lockId,
      type: 'phone',
      valueMasked: maskPhoneForLock(normalizedPhone),
      ownerUid: currentUser.uid,
    });
    if (!lockRes.ok) {
      throw new Error(lockRes.error || 'Số điện thoại này đã được tài khoản khác sử dụng.');
    }
    if (isSuperAdminUser && prevNormalizedPhone && prevNormalizedPhone !== normalizedPhone) {
      const prevLockId = buildPhoneLockId(prevNormalizedPhone);
      if (prevLockId && prevLockId !== lockId) {
        await releaseExclusiveIdentifierLock(prevLockId);
      }
    }

    const now = new Date().toISOString();
    const path = `users/${currentUser.uid}`;
    const updates = {
      phoneNumber: normalizedPhone,
      verifiedPhone: normalizedPhone,
      phoneVerified: true,
      phoneVerifiedAt: userProfile?.phoneVerifiedAt || now,
      updatedAt: now,
    };
    try {
      await setDoc(doc(db, 'users', currentUser.uid), updates, { merge: true });
      setUserProfile((prev) => (prev ? { ...prev, ...updates } : null));
    } catch (err) {
      handleAuthFirestoreError(err, FirestoreOperationType.UPDATE, path);
    }
    return normalizedPhone;
  };

  const verifyAndLockCitizenId = async (
    rawCitizenId: string,
    verifiedDatabaseFields?: Partial<UserProfile>
  ) => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để xác minh số CCCD.');
    }
    const digits = rawCitizenId.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 12) {
      throw new Error('Số CCCD/ĐDCN phải gồm từ 9 đến 12 chữ số.');
    }
    const prevDigits = (userProfile?.citizenId || '').replace(/\D/g, '');
    const lockId = buildCccdLockId(digits);
    const lockRes = await claimExclusiveIdentifierLock({
      lockId,
      type: 'cccd',
      valueMasked: maskCccdForLock(digits),
      ownerUid: currentUser.uid,
    });
    if (!lockRes.ok) {
      throw new Error(lockRes.error || 'Số CCCD này đã được tài khoản khác xác minh.');
    }
    const isSuperAdminUser =
      isBootstrapAdminEmail(currentUser.email) || userProfile?.role === 'super_admin';
    if (
      (isSuperAdminUser || userProfile?.allowIdentityEditByAdmin) &&
      prevDigits &&
      prevDigits !== digits
    ) {
      await releaseExclusiveIdentifierLock(buildCccdLockId(prevDigits));
    }
    const now = new Date().toISOString();
    const dbPayload: Partial<UserProfile> = verifiedDatabaseFields
      ? {
          displayName: (verifiedDatabaseFields.displayName || '').trim(),
          dob: verifiedDatabaseFields.dob || '',
          gender: verifiedDatabaseFields.gender || 'Nam',
          provinceCode: verifiedDatabaseFields.provinceCode || '',
          provinceName: verifiedDatabaseFields.provinceName || '',
          wardCode: verifiedDatabaseFields.wardCode || '',
          wardName: verifiedDatabaseFields.wardName || '',
          address: verifiedDatabaseFields.address || '',
          identityVerifiedFromDatabase: true,
          allowIdentityEditByAdmin: isSuperAdminUser ? true : false,
        }
      : {};

    await updateProfileData({
      ...dbPayload,
      citizenId: digits,
      citizenIdVerified: true,
      citizenIdVerifiedAt: now,
    });
  };

  const registerOrVerifyCurrentDevice = async (
    method: UserVerifiedDevice['verificationMethod'] = 'manual',
    customName?: string
  ) => {
    if (!currentUser) return;
    await upsertCurrentDeviceDoc(currentUser.uid, method, customName, true);
  };

  const renameVerifiedDevice = async (deviceId: string, newName: string) => {
    if (!currentUser) return;
    const clean = newName.trim().slice(0, 128);
    if (!clean) return;
    const target = verifiedDevices.find((d) => d.deviceId === deviceId);
    if (!target) return;
    const devicePath = `users/${currentUser.uid}/devices/${deviceId}`;
    try {
      await setDoc(
        doc(db, 'users', currentUser.uid, 'devices', deviceId),
        {
          ...target,
          deviceName: clean,
          lastActiveAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      handleAuthFirestoreError(err, FirestoreOperationType.UPDATE, devicePath);
    }
  };

  const removeVerifiedDevice = async (deviceId: string) => {
    if (!currentUser) return;
    const devicePath = `users/${currentUser.uid}/devices/${deviceId}`;
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'devices', deviceId));
    } catch (err) {
      handleAuthFirestoreError(err, FirestoreOperationType.DELETE, devicePath);
    }
  };

  const reauthenticateForMfa = async (passwordForReauth?: string) => {
    if (!currentUser) {
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    const hasPwd = Boolean(currentUser.providerData?.some((p) => p.providerId === 'password'));
    const hasGoogle = Boolean(currentUser.providerData?.some((p) => p.providerId === 'google.com'));

    if (passwordForReauth && currentUser.email) {
      const cred = EmailAuthProvider.credential(currentUser.email, passwordForReauth);
      await reauthenticateWithCredential(currentUser, cred);
      return;
    }
    if (hasGoogle && !hasPwd) {
      await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
      return;
    }
    throw new Error('REQUIRES_REAUTH_PASSWORD');
  };

  const sendSmsMfaEnrollmentCode = async (
    rawPhone: string,
    recaptchaContainer?: HTMLElement | null,
    passwordForReauth?: string
  ): Promise<{ verificationId: string; normalizedPhone: string }> => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để thiết lập xác thực SMS MFA.');
    }
    try {
      await currentUser.reload();
    } catch {
      // ignore transient reload failure
    }
    setProviderTick((t) => t + 1);

    if (!currentUser.emailVerified) {
      const unverifiedErr = new Error('auth/unverified-email');
      (unverifiedErr as any).code = 'auth/unverified-email';
      throw unverifiedErr;
    }

    const normalizedPhone = normalizeVietnamPhoneToE164(rawPhone);
    if (!isValidE164Phone(normalizedPhone)) {
      const invalidPhoneErr = new Error('auth/invalid-phone-number');
      (invalidPhoneErr as any).code = 'auth/invalid-phone-number';
      throw invalidPhoneErr;
    }

    // Enforce exclusive lock before sending SMS
    const phoneLockId = buildPhoneLockId(normalizedPhone);
    if (phoneLockId) {
      const avail = await checkIdentifierAvailability(phoneLockId, currentUser.uid);
      if (!avail.available) {
        throw new Error('Số điện thoại này đã được xác minh bởi tài khoản khác và không thể sử dụng.');
      }
    }

    const multiFactorUser = multiFactor(currentUser);
    let session;
    try {
      session = await multiFactorUser.getSession();
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        await reauthenticateForMfa(passwordForReauth);
        session = await multiFactorUser.getSession();
      } else {
        throw err;
      }
    }

    const verificationId = await runVerifyPhoneWithSafety(async (verifier) => {
      const phoneAuthProvider = new PhoneAuthProvider(auth);
      return phoneAuthProvider.verifyPhoneNumber(
        { phoneNumber: normalizedPhone, session },
        verifier
      );
    }, recaptchaContainer);

    return { verificationId, normalizedPhone };
  };

  const confirmSmsMfaEnrollment = async (
    verificationId: string,
    smsCode: string,
    displayName?: string,
    normalizedPhone?: string
  ) => {
    if (!currentUser) {
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    const cleanCode = smsCode.replace(/\s+/g, '').trim();
    if (!cleanCode) {
      throw new Error('Vui lòng nhập mã OTP từ tin nhắn SMS.');
    }

    const cred = PhoneAuthProvider.credential(verificationId, cleanCode);
    const assertion = PhoneMultiFactorGenerator.assertion(cred);
    const multiFactorUser = multiFactor(currentUser);

    await multiFactorUser.enroll(assertion, displayName?.trim() || 'Số điện thoại SMS 2FA');
    clearSmsRecaptchaVerifier();

    try {
      await currentUser.reload();
    } catch {
      // ignore reload hiccup right after token refresh revocation
    }
    setProviderTick((t) => t + 1);

    const smsFactors = multiFactor(currentUser).enrolledFactors.filter(
      (f): f is PhoneMultiFactorInfo => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
    const resolvedPhone = normalizedPhone || smsFactors[0]?.phoneNumber || '';
    const maskedPhone = maskPhoneForProfile(resolvedPhone);

    if (resolvedPhone && !resolvedPhone.includes('*')) {
      const lockId = buildPhoneLockId(resolvedPhone);
      if (lockId) {
        await claimExclusiveIdentifierLock({
          lockId,
          type: 'phone',
          valueMasked: maskPhoneForLock(resolvedPhone),
          ownerUid: currentUser.uid,
        });
      }
    }

    const now = new Date().toISOString();
    await setDoc(
      doc(db, 'users', currentUser.uid),
      {
        smsMfaEnabled: smsFactors.length > 0,
        smsMfaPhoneMasked: maskedPhone,
        phoneVerified: true,
        ...(resolvedPhone && !resolvedPhone.includes('*')
          ? { verifiedPhone: resolvedPhone, phoneNumber: resolvedPhone }
          : {}),
        phoneVerifiedAt: userProfile?.phoneVerifiedAt || now,
        updatedAt: now,
      },
      { merge: true }
    );
    await upsertCurrentDeviceDoc(currentUser.uid, 'sms_mfa');
  };

  const sendPhoneVerificationOtp = async (
    rawPhone: string,
    passwordForReauth?: string
  ): Promise<PhoneVerificationSession> => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để xác minh số điện thoại.');
    }
    const normalizedPhone = normalizeVietnamPhoneToE164(rawPhone);
    if (!isValidE164Phone(normalizedPhone)) {
      const invalidPhoneErr = new Error('auth/invalid-phone-number');
      (invalidPhoneErr as any).code = 'auth/invalid-phone-number';
      throw invalidPhoneErr;
    }

    // Exclusive lock check before sending SMS
    const phoneLockId = buildPhoneLockId(normalizedPhone);
    if (phoneLockId) {
      const avail = await checkIdentifierAvailability(phoneLockId, currentUser.uid);
      if (!avail.available) {
        throw new Error('Số điện thoại này đã được xác minh bởi tài khoản khác và không thể sử dụng.');
      }
    }

    // Prefer SMS MFA enrollment when email is verified; fall back to linkWithPhoneNumber otherwise
    if (currentUser.emailVerified) {
      try {
        const res = await sendSmsMfaEnrollmentCode(normalizedPhone, null, passwordForReauth);
        return {
          mode: 'mfa',
          normalizedPhone: res.normalizedPhone,
          verificationId: res.verificationId,
        };
      } catch (err: any) {
        const code = String(err?.code || '');
        if (
          code !== 'auth/operation-not-allowed' &&
          code !== 'auth/unsupported-first-factor' &&
          code !== 'auth/unverified-email'
        ) {
          throw err;
        }
      }
    }

    // Fallback or pre-email-verification: linkWithPhoneNumber
    const { verifier, errorPromise } = createFreshRecaptchaVerifier();
    try {
      auth.languageCode = 'vi';
      const confirmationResult = await Promise.race([
        linkWithPhoneNumber(currentUser, normalizedPhone, verifier),
        errorPromise,
      ]);
      return {
        mode: 'phone_link',
        normalizedPhone,
        confirmationResult,
      };
    } catch (err: any) {
      clearSmsRecaptchaVerifier();
      if (err?.code === 'auth/credential-already-in-use' || err?.code === 'auth/phone-number-already-exists') {
        throw new Error('Số điện thoại này đã được liên kết với tài khoản khác.');
      }
      throw err;
    }
  };

  const confirmPhoneVerificationOtp = async (
    session: PhoneVerificationSession,
    smsCode: string
  ) => {
    if (!currentUser) {
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    const cleanCode = smsCode.replace(/\s+/g, '').trim();
    if (cleanCode.length < 6) {
      throw new Error('Vui lòng nhập đủ 6 chữ số OTP.');
    }

    if (session.mode === 'mfa' && session.verificationId) {
      await confirmSmsMfaEnrollment(
        session.verificationId,
        cleanCode,
        'Số điện thoại chính',
        session.normalizedPhone
      );
      return;
    }

    if (session.mode === 'phone_link' && session.confirmationResult) {
      await session.confirmationResult.confirm(cleanCode);
      clearSmsRecaptchaVerifier();
      try {
        await currentUser.reload();
      } catch {
        // ignore
      }
      setProviderTick((t) => t + 1);
      const lockId = buildPhoneLockId(session.normalizedPhone);
      if (lockId) {
        const lockRes = await claimExclusiveIdentifierLock({
          lockId,
          type: 'phone',
          valueMasked: maskPhoneForLock(session.normalizedPhone),
          ownerUid: currentUser.uid,
        });
        if (!lockRes.ok) {
          throw new Error(lockRes.error || 'Số điện thoại đã được tài khoản khác xác minh.');
        }
      }
      const now = new Date().toISOString();
      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          phoneVerified: true,
          verifiedPhone: session.normalizedPhone,
          phoneNumber: session.normalizedPhone,
          phoneVerifiedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      await upsertCurrentDeviceDoc(currentUser.uid, 'sms_otp');
      return;
    }

    throw new Error('Phiên xác minh SMS không hợp lệ.');
  };

  const unenrollSmsMfaFactor = async (
    factorOrUid: MultiFactorInfo | string,
    passwordForReauth?: string
  ) => {
    if (!currentUser) {
      throw new Error('Bạn cần đăng nhập để thực hiện thao tác này.');
    }
    const multiFactorUser = multiFactor(currentUser);
    try {
      await multiFactorUser.unenroll(factorOrUid);
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        await reauthenticateForMfa(passwordForReauth);
        await multiFactorUser.unenroll(factorOrUid);
      } else {
        throw err;
      }
    }

    try {
      await currentUser.reload();
    } catch {
      // ignore reload hiccup
    }
    setProviderTick((t) => t + 1);

    const remainingSms = multiFactor(currentUser).enrolledFactors.filter(
      (f): f is PhoneMultiFactorInfo => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
    await updateProfileData({
      smsMfaEnabled: remainingSms.length > 0,
      smsMfaPhoneMasked: remainingSms[0] ? maskPhoneForProfile(remainingSms[0].phoneNumber) : '',
    });
  };

  const sendSmsMfaSignInCode = async (
    hintIndex: number,
    recaptchaContainer?: HTMLElement | null
  ): Promise<string> => {
    if (!pendingSmsMfaResolver) {
      throw new Error('Không tìm thấy phiên xác thực đa yếu tố đang chờ.');
    }
    const hints = pendingSmsMfaResolver.hints || [];
    const selectedHint = hints[hintIndex] || hints[0];
    if (!selectedHint) {
      throw new Error('Tài khoản chưa có số điện thoại xác thực hợp lệ.');
    }

    return runVerifyPhoneWithSafety(async (verifier) => {
      const phoneAuthProvider = new PhoneAuthProvider(auth);
      return phoneAuthProvider.verifyPhoneNumber(
        {
          multiFactorHint: selectedHint,
          session: pendingSmsMfaResolver.session,
        },
        verifier
      );
    }, recaptchaContainer);
  };

  const resolveSmsMfaSignIn = async (verificationId: string, smsCode: string) => {
    if (!pendingSmsMfaResolver) {
      throw new Error('Phiên xác thực SMS MFA đã hết hạn, vui lòng đăng nhập lại.');
    }
    const cleanCode = smsCode.replace(/\s+/g, '').trim();
    const cred = PhoneAuthProvider.credential(verificationId, cleanCode);
    const assertion = PhoneMultiFactorGenerator.assertion(cred);
    await pendingSmsMfaResolver.resolveSignIn(assertion);
    clearPendingSmsMfaResolver();
  };

  void providerTick;
  const hasPasswordProvider = Boolean(
    currentUser?.providerData?.some((p) => p.providerId === 'password')
  );
  const hasGoogleProvider = Boolean(
    currentUser?.providerData?.some((p) => p.providerId === 'google.com')
  );

  const enrolledSmsFactors: PhoneMultiFactorInfo[] = currentUser
    ? multiFactor(currentUser).enrolledFactors.filter(
        (f): f is PhoneMultiFactorInfo => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID
      )
    : [];
  const smsMfaEnabled = enrolledSmsFactors.length > 0;

  useEffect(() => {
    if (!userProfile || userProfile.status !== 'banned' || userProfile.banType !== 'temporary') {
      return;
    }
    const untilMs = getBannedUntilMs(userProfile);
    if (!untilMs) return;
    const updateNow = () => setBanNowTick(Date.now());
    updateNow();
    const diff = untilMs - Date.now();
    if (diff <= 0) return;

    const timer = window.setInterval(updateNow, 15000);
    const exactTimeout = diff <= 24 * 60 * 60 * 1000
      ? window.setTimeout(updateNow, diff + 300)
      : undefined;
    return () => {
      window.clearInterval(timer);
      if (exactTimeout !== undefined) window.clearTimeout(exactTimeout);
    };
  }, [userProfile]);

  const isPrimaryAdmin = isBootstrapAdminEmail(currentUser?.email);

  const currentActualRole: RoleType = isPrimaryAdmin
    ? 'super_admin'
    : userProfile?.role || 'citizen';

  const currentActualAccountType: AccountType = isPrimaryAdmin
    ? 'admin'
    : userProfile?.accountType || 'citizen';

  const activeRole: RoleType = simulatedRole ? simulatedRole.role : currentActualRole;
  const activeAccountType: AccountType = simulatedRole ? simulatedRole.accountType : currentActualAccountType;

  const isActualAdmin = Boolean(
    isPrimaryAdmin ||
      currentActualRole === 'super_admin' ||
      currentActualRole === 'admin' ||
      currentActualAccountType === 'admin'
  );

  const isAdmin = simulatedRole
    ? activeAccountType === 'admin' || activeRole === 'super_admin' || activeRole === 'admin'
    : isActualAdmin;

  const isStaff = simulatedRole
    ? isAdmin || activeAccountType === 'employee' || ['doctor', 'nurse', 'communicator', 'staff', 'leadership'].includes(activeRole)
    : isAdmin || activeAccountType === 'employee' || ['doctor', 'nurse', 'communicator', 'staff', 'leadership'].includes(activeRole);

  const isCitizen = !isAdmin && !isStaff;

  const isBanned = Boolean(currentUser && !isActualAdmin && isUserActivelyBanned(userProfile, banNowTick));

  const twoFactorEnabled = Boolean(
    totpConfig?.enabled && Boolean(totpConfig?.secret)
  );
  // Admin đặc cách bỏ qua xác thực 2FA khi mở khóa phiên
  const isAdminTwoFactorExempt = isActualAdmin || isAdmin;
  const requiresTwoFactorVerification = Boolean(
    currentUser &&
      !isBanned &&
      !isAdminTwoFactorExempt &&
      !twoFactorLoading &&
      twoFactorEnabled &&
      !twoFactorVerifiedThisSession
  );

  const currentDeviceId = currentDeviceMeta.current.deviceId;
  const currentDeviceTrusted = Boolean(
    verifiedDevices.find((d) => d.deviceId === currentDeviceId)?.isTrusted
  );

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        activeRole,
        activeAccountType,
        isAdmin,
        isStaff,
        isCitizen,
        isPrimaryAdmin,
        isBanned,
        hasPasswordProvider,
        hasGoogleProvider,
        totpConfig,
        twoFactorEnabled,
        twoFactorVerifiedThisSession,
        twoFactorLoading,
        requiresTwoFactorVerification,
        enrolledSmsFactors,
        smsMfaEnabled,
        pendingSmsMfaResolver,
        verifiedDevices,
        currentDeviceId,
        currentDeviceTrusted,
        clearPendingSmsMfaResolver,
        sendVerificationEmailToCurrentUser,
        refreshCurrentUserState,
        linkGoogleAccount,
        sendPhoneVerificationOtp,
        confirmPhoneVerificationOtp,
        confirmAndLockPhoneNumber,
        verifyAndLockCitizenId,
        registerOrVerifyCurrentDevice,
        renameVerifiedDevice,
        removeVerifiedDevice,
        sendSmsMfaEnrollmentCode,
        confirmSmsMfaEnrollment,
        unenrollSmsMfaFactor,
        sendSmsMfaSignInCode,
        resolveSmsMfaSignIn,
        signInWithGoogle,
        loginWithEmail,
        sendPasswordReset,
        registerWithEmail,
        logout,
        switchPreviewRole,
        resetRoleToActual,
        isSimulatingRole: !!simulatedRole,
        updateProfileData,
        linkEmailPassword,
        changeAccountPassword,
        verifyAccountPassword,
        verifySessionTwoFactorOtp,
        enableTwoFactorAuth,
        disableTwoFactorAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
