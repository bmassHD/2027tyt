import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Phone,
  MapPin,
  Navigation,
  AlertTriangle,
  Radio,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Layers,
  Map as MapIcon,
  ExternalLink,
  LocateFixed,
  Ambulance,
  HeartPulse,
  Flame,
  Waves,
  Car,
  XCircle,
  RefreshCw,
  Building2,
  PhoneCall,
  BarChart3,
  ArrowRightLeft,
  ShieldCheck,
  History,
  Trash2,
  X,
  Lock,
  Plus,
  UserCheck,
} from 'lucide-react';
import L from 'leaflet';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';
import {
  NearbyFacility,
  RescueSignal,
  RescueSignalCategory,
  RescueSignalOutcome,
  SystemSettings,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createRescueSignal,
  updateRescueSignal,
  deleteRescueSignal,
  getConfiguredEmergencyContacts,
} from '../../services/firebaseService';
import { getOrCreateDeviceId } from '../../services/systemNotificationService';
import {
  calculateHaversineDistance,
  estimateDrivingMinutes,
} from '../portal/StationMapSection';
import { UserAvatar } from '../common/UserAvatar';
import { VerifiedBlueTick } from '../common/VerifiedBlueTick';
import { getUserVerificationProgress } from '../../utils/verificationBadge';
import { maskVerifiedValue } from '../../utils/verifiedIdentity';

interface RescueMapViewProps {
  settings: SystemSettings;
  setCurrentView: (view: string) => void;
}

const RESCUE_PHONE_STORAGE_KEY = 'tyt_rescue_phone_v1';
const RESCUE_NAME_STORAGE_KEY = 'tyt_rescue_name_v1';

const CATEGORY_META: Record<
  RescueSignalCategory,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  medical_emergency: { label: 'Cấp cứu y tế', icon: HeartPulse },
  traffic_accident: { label: 'Tai nạn giao thông', icon: Car },
  disaster_flood: { label: 'Ngập lụt / Thiên tai', icon: Waves },
  fire_rescue: { label: 'Cháy nổ / Mắc kẹt', icon: Flame },
  other: { label: 'Khẩn cấp khác', icon: AlertTriangle },
};

function normalizePhoneInput(raw: string): string {
  return raw.replace(/[\s.\-()]/g, '').trim();
}

function isValidVietnamesePhone(raw: string): boolean {
  const cleaned = normalizePhoneInput(raw);
  return /^(0|\+84)[0-9]{8,10}$/.test(cleaned);
}

function formatRelativeTimeVi(iso?: string): string {
  if (!iso) return 'Vừa xong';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  return new Date(iso).toLocaleString('vi-VN');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSafeAvatarSrc(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

interface CombinedMedicalPoint {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  emergencyPhone?: string;
  workingHours?: string;
  is24Hours?: boolean;
  hasEmergency?: boolean;
  sourceLabel: string;
}

export const RescueMapView: React.FC<RescueMapViewProps> = ({
  settings,
  setCurrentView,
}) => {
  const {
    currentUser,
    userProfile,
    isAdmin,
    isStaff,
    hasGoogleProvider,
    hasPasswordProvider,
    twoFactorEnabled,
    smsMfaEnabled,
  } = useAuth();
  const { showToast, showConfirm } = useToast();
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);

  // Mandatory access fields for citizens: Phone + Live GPS (Admin can bypass)
  const [phoneInput, setPhoneInput] = useState<string>(() => {
    try {
      return localStorage.getItem(RESCUE_PHONE_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [confirmedPhone, setConfirmedPhone] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(RESCUE_PHONE_STORAGE_KEY) || '';
      return isValidVietnamesePhone(saved) ? normalizePhoneInput(saved) : '';
    } catch {
      return '';
    }
  });
  const [phoneError, setPhoneError] = useState<string>('');

  const [senderName, setSenderName] = useState<string>(() => {
    try {
      return localStorage.getItem(RESCUE_NAME_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [extraPhoneInput, setExtraPhoneInput] = useState<string>('');
  const [confirmedExtraPhone, setConfirmedExtraPhone] = useState<string>('');
  const [extraPhoneError, setExtraPhoneError] = useState<string>('');
  const [category, setCategory] = useState<RescueSignalCategory>('medical_emergency');
  const [noteInput, setNoteInput] = useState<string>('');

  // Mandatory GPS state (optional for Admin monitor mode)
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(true);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Real-time SOS signals & nearby facilities
  const [signals, setSignals] = useState<RescueSignal[]>([]);
  const [nearbyFacilities, setNearbyFacilities] = useState<NearbyFacility[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [signalTab, setSignalTab] = useState<'active' | 'resolved'>('active');
  const [mapTileType, setMapTileType] = useState<'satellite' | 'streets'>('streets');
  const [isBroadcasting, setIsBroadcasting] = useState<boolean>(false);
  const [isUpdatingSignal, setIsUpdatingSignal] = useState<boolean>(false);
  const [showAdminVerifyBox, setShowAdminVerifyBox] = useState<boolean>(false);
  const [, setTickNow] = useState<number>(() => Date.now());

  // Resolution / Referral modal state (for Staff / Admin)
  const [resolveModalSignal, setResolveModalSignal] = useState<RescueSignal | null>(null);
  const [resolveOutcome, setResolveOutcome] = useState<RescueSignalOutcome>('on_site');
  const [resolveFacilityInput, setResolveFacilityInput] = useState<string>('');
  const [resolveResponderNote, setResolveResponderNote] = useState<string>('');
  const [isSavingResolution, setIsSavingResolution] = useState<boolean>(false);

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const signalMarkersMapRef = useRef<Map<string, L.Marker>>(new Map());
  const lastLivePushRef = useRef<number>(0);

  const verificationProgress = useMemo(
    () =>
      getUserVerificationProgress(userProfile, {
        emailVerified: currentUser?.emailVerified,
        hasGoogleProvider,
        hasPasswordProvider,
        twoFactorEnabled,
        smsMfaEnabled,
        phoneNumber: userProfile?.verifiedPhone || userProfile?.phoneNumber,
      }),
    [
      userProfile,
      currentUser?.emailVerified,
      hasGoogleProvider,
      hasPasswordProvider,
      twoFactorEnabled,
      smsMfaEnabled,
    ]
  );

  const isVerifiedSosUser = Boolean(
    currentUser &&
      userProfile &&
      (verificationProgress.isFullyVerified ||
        userProfile.citizenIdVerified ||
        userProfile.identityVerifiedFromDatabase ||
        userProfile.phoneVerified ||
        userProfile.emailVerified ||
        currentUser.emailVerified ||
        userProfile.googleLinked)
  );

  const verifiedAvatarUrl = useMemo(
    () => (userProfile?.avatarUrl || currentUser?.photoURL || '').trim(),
    [userProfile?.avatarUrl, currentUser?.photoURL]
  );
  const verifiedDisplayName = useMemo(
    () => (userProfile?.displayName || currentUser?.displayName || '').trim(),
    [userProfile?.displayName, currentUser?.displayName]
  );
  const verifiedPhoneVal = useMemo(() => {
    const raw = userProfile?.verifiedPhone || userProfile?.phoneNumber || '';
    const cleaned = normalizePhoneInput(raw);
    return isValidVietnamesePhone(cleaned) ? cleaned : '';
  }, [userProfile?.verifiedPhone, userProfile?.phoneNumber]);
  const verifiedCitizenId = useMemo(
    () => (userProfile?.citizenId || '').trim(),
    [userProfile?.citizenId]
  );
  const verifiedDob = useMemo(() => (userProfile?.dob || '').trim(), [userProfile?.dob]);
  const verifiedGender = userProfile?.gender || '';
  const verifiedFullAddress = useMemo(
    () =>
      [userProfile?.address, userProfile?.wardName, userProfile?.provinceName]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(', '),
    [userProfile?.address, userProfile?.wardName, userProfile?.provinceName]
  );
  const verifiedEmail = useMemo(
    () => (userProfile?.email || currentUser?.email || '').trim(),
    [userProfile?.email, currentUser?.email]
  );

  // Sync & lock profile fields for logged-in verified users
  useEffect(() => {
    if (isVerifiedSosUser) {
      if (verifiedPhoneVal) {
        setPhoneInput(verifiedPhoneVal);
        setConfirmedPhone(verifiedPhoneVal);
        setPhoneError('');
        try {
          localStorage.setItem(RESCUE_PHONE_STORAGE_KEY, verifiedPhoneVal);
        } catch {
          // ignore
        }
      }
      if (verifiedDisplayName) {
        setSenderName(verifiedDisplayName);
        try {
          localStorage.setItem(RESCUE_NAME_STORAGE_KEY, verifiedDisplayName);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (userProfile?.phoneNumber && !confirmedPhone) {
      const normalized = normalizePhoneInput(userProfile.phoneNumber);
      if (isValidVietnamesePhone(normalized)) {
        setPhoneInput(normalized);
        setConfirmedPhone(normalized);
        try {
          localStorage.setItem(RESCUE_PHONE_STORAGE_KEY, normalized);
        } catch {
          // ignore
        }
      }
    }
    if (userProfile?.displayName && !senderName) {
      setSenderName(userProfile.displayName);
    }
  }, [
    isVerifiedSosUser,
    verifiedPhoneVal,
    verifiedDisplayName,
    userProfile?.phoneNumber,
    userProfile?.displayName,
    confirmedPhone,
    senderName,
  ]);

  useEffect(() => {
    setExtraPhoneInput('');
    setConfirmedExtraPhone('');
    setExtraPhoneError('');
  }, [currentUser?.uid]);

  // Refresh relative timestamps every 1s
  useEffect(() => {
    const timer = window.setInterval(() => setTickNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Mandatory GPS acquisition & continuous watch upon accessing the page
  const requestGpsLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setIsLocating(false);
      setGpsError('Thiết bị hoặc trình duyệt không hỗ trợ định vị GPS.');
      return;
    }

    setIsLocating(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      pos => {
        setUserCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setIsLocating(false);
        setGpsError(null);
      },
      err => {
        setIsLocating(false);
        if (err.code === 1) {
          setGpsError('Bắt buộc cấp quyền Vị trí (GPS) trên trình duyệt để truy cập Bản đồ Cứu hộ cứu nạn.');
        } else {
          setGpsError('Không thể thu được tín hiệu GPS. Vui lòng bật định vị thiết bị và thử lại.');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  }, []);

  useEffect(() => {
    requestGpsLocation();
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setUserCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setIsLocating(false);
        setGpsError(null);
      },
      () => {
        // Initial getCurrentPosition handles explicit errors
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [requestGpsLocation]);

  // Admin can access Rescue Map without providing GPS location or phone number
  const hasAccess = isAdmin || Boolean(confirmedPhone && userCoords);
  const canBroadcastSos = Boolean(confirmedPhone && userCoords);

  // Listen to ALL real-time rescueSignals & active nearbyFacilities once access requirements are met
  useEffect(() => {
    if (!hasAccess) return;

    const signalsQuery = query(collection(db, 'rescueSignals'));
    const unsubSignals = onSnapshot(
      signalsQuery,
      snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as RescueSignal))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setSignals(list);
      },
      error => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'rescueSignals');
        } catch {
          // Logged safely without crashing async snapshot listener
        }
      }
    );

    const facilitiesQuery = query(
      collection(db, 'nearbyFacilities'),
      where('isActive', '==', true)
    );
    const unsubFacilities = onSnapshot(
      facilitiesQuery,
      snap => {
        setNearbyFacilities(snap.docs.map(d => ({ id: d.id, ...d.data() } as NearbyFacility)));
      },
      () => {
        // Non-blocking fallback if nearbyFacilities empty/errored
      }
    );

    return () => {
      unsubSignals();
      unsubFacilities();
    };
  }, [hasAccess]);

  const activeSignals = useMemo(
    () => signals.filter(s => s.status === 'active' || s.status === 'responding'),
    [signals]
  );

  const resolvedSignals = useMemo(
    () => signals.filter(s => s.status === 'resolved'),
    [signals]
  );

  const referredSignals = useMemo(
    () => resolvedSignals.filter(s => s.outcome === 'referred'),
    [resolvedSignals]
  );

  const onSiteSignals = useMemo(
    () => resolvedSignals.filter(s => s.outcome !== 'referred'),
    [resolvedSignals]
  );

  const categoryStats = useMemo(() => {
    return (Object.keys(CATEGORY_META) as RescueSignalCategory[]).map(catKey => {
      const catResolved = resolvedSignals.filter(s => s.category === catKey);
      const catReferred = catResolved.filter(s => s.outcome === 'referred');
      const catActive = activeSignals.filter(s => s.category === catKey);
      return {
        category: catKey,
        meta: CATEGORY_META[catKey],
        totalResolved: catResolved.length,
        referredCount: catReferred.length,
        onSiteCount: catResolved.length - catReferred.length,
        activeCount: catActive.length,
      };
    });
  }, [resolvedSignals, activeSignals]);

  // Identify current device/user's own active SOS signal
  const myActiveSignal = useMemo(() => {
    return (
      activeSignals.find(
        s =>
          s.deviceId === deviceId ||
          (currentUser?.uid && s.uid === currentUser.uid) ||
          (confirmedPhone && normalizePhoneInput(s.phone) === confirmedPhone)
      ) || null
    );
  }, [activeSignals, deviceId, currentUser?.uid, confirmedPhone]);

  // Periodically sync user's live GPS into their active SOS signal if moving
  useEffect(() => {
    if (!myActiveSignal || !userCoords) return;
    const now = Date.now();
    const movedKm = calculateHaversineDistance(
      myActiveSignal.lat,
      myActiveSignal.lng,
      userCoords.lat,
      userCoords.lng
    );
    if (movedKm >= 0.03 && now - lastLivePushRef.current >= 20_000) {
      lastLivePushRef.current = now;
      void updateRescueSignal(myActiveSignal.id, {
        lat: userCoords.lat,
        lng: userCoords.lng,
        accuracy: userCoords.accuracy,
      }).catch(() => {});
    }
  }, [myActiveSignal, userCoords]);

  // Combine Station Map Locations + Nearby Healthcare Facilities + 64 Preset Health Stations
  const combinedMedicalPoints = useMemo<
    Array<CombinedMedicalPoint & { distanceKm: number | null; driveMinutes: number | null }>
  >(() => {
    const hasRefCoords = Boolean(myActiveSignal || userCoords);
    const refLat = myActiveSignal?.lat ?? userCoords?.lat ?? 9.1769;
    const refLng = myActiveSignal?.lng ?? userCoords?.lng ?? 105.1524;

    const merged: CombinedMedicalPoint[] = [];
    const seenNames = new Set<string>();

    (settings.mapLocations || []).forEach(loc => {
      const normName = loc.name.trim().toLowerCase();
      seenNames.add(normName);
      merged.push({
        id: `station_${loc.id}`,
        name: loc.name,
        address: loc.address,
        lat: loc.lat,
        lng: loc.lng,
        phone: loc.phone,
        workingHours: loc.workingHours,
        hasEmergency: true,
        sourceLabel: loc.isPrimary ? 'Trạm Y tế Chính' : 'Điểm Trạm Y tế',
      });
    });

    const appendFacility = (fac: Omit<NearbyFacility, 'createdAt' | 'updatedAt'>) => {
      const normName = fac.name.trim().toLowerCase();
      if (seenNames.has(normName)) return;
      seenNames.add(normName);
      merged.push({
        id: `fac_${fac.id}`,
        name: fac.name,
        address: fac.address,
        lat: fac.lat,
        lng: fac.lng,
        phone: fac.phone,
        emergencyPhone: fac.emergencyPhone,
        workingHours: fac.workingHours,
        is24Hours: fac.is24Hours,
        hasEmergency: fac.hasEmergency,
        sourceLabel:
          fac.facilityType === 'hospital'
            ? 'Bệnh viện'
            : fac.facilityType === 'emergency_center'
            ? 'Trung tâm Cấp cứu'
            : fac.facilityType === 'clinic'
            ? 'Phòng khám'
            : fac.facilityType === 'pharmacy'
            ? 'Nhà thuốc'
            : 'Trạm Y tế',
      });
    };

    nearbyFacilities.forEach(appendFacility);

    return merged
      .map(pt => {
        if (!hasRefCoords) {
          return {
            ...pt,
            distanceKm: null,
            driveMinutes: null,
          };
        }
        const distanceKm = calculateHaversineDistance(refLat, refLng, pt.lat, pt.lng);
        return {
          ...pt,
          distanceKm,
          driveMinutes: estimateDrivingMinutes(distanceKm),
        };
      })
      .sort((a, b) => {
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        if (Boolean(a.hasEmergency) !== Boolean(b.hasEmergency)) {
          return a.hasEmergency ? -1 : 1;
        }
        return a.name.localeCompare(b.name, 'vi');
      });
  }, [settings.mapLocations, nearbyFacilities, myActiveSignal, userCoords]);

  const emergencyContacts = useMemo(() => getConfiguredEmergencyContacts(settings), [settings]);

  // Clean up Leaflet on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
        markersLayerRef.current = null;
        signalMarkersMapRef.current.clear();
      }
    };
  }, []);

  // Initialize and update Leaflet Rescue Map (supports Admin viewing without userCoords)
  useEffect(() => {
    if (!hasAccess || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialCenter: [number, number] = userCoords
        ? [userCoords.lat, userCoords.lng]
        : activeSignals.length > 0
        ? [activeSignals[0].lat, activeSignals[0].lng]
        : settings.mapLocations?.[0]
        ? [settings.mapLocations[0].lat, settings.mapLocations[0].lng]
        : [9.1769, 105.1524];

      const initialZoom = userCoords ? 14 : activeSignals.length > 0 ? 13 : 10;

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: initialZoom,
        zoomControl: true,
        attributionControl: false,
      });

      const url =
        mapTileType === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      tileLayerRef.current = L.tileLayer(url, { maxZoom: 19 }).addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    } else if (tileLayerRef.current) {
      const url =
        mapTileType === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      tileLayerRef.current.setUrl(url);
    }

    const markersLayer = markersLayerRef.current;
    if (!markersLayer) return;

    markersLayer.clearLayers();
    signalMarkersMapRef.current.clear();

    // 1. Nearby Medical Facilities & Station Points
    combinedMedicalPoints.forEach(pt => {
      const medIcon = L.divIcon({
        className: 'rescue-medical-pin',
        html: `
          <div style="
            background: #047857;
            color: white;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 10px rgba(0,0,0,0.35);
            border: 2.5px solid white;
            font-weight: 800;
            font-size: 14px;
          ">✚</div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const marker = L.marker([pt.lat, pt.lng], { icon: medIcon });
      const callNum = pt.emergencyPhone || pt.phone;
      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.45; min-width: 195px;">
          <div style="font-size: 10px; font-weight: 700; color: #047857; text-transform: uppercase;">${escapeHtml(pt.sourceLabel)}</div>
          <strong style="color: #0f172a; font-size: 13px;">${escapeHtml(pt.name)}</strong><br/>
          <span style="color: #475569;">${escapeHtml(pt.address)}</span><br/>
          ${pt.distanceKm !== null ? `<span style="color: #047857; font-weight: 700;">Cách ${pt.distanceKm.toFixed(1)} km · ~${pt.driveMinutes} phút</span><br/>` : ''}
          ${callNum ? `<a href="tel:${escapeHtml(callNum)}" style="color: #dc2626; font-weight: 800; text-decoration: none;">☎ Gọi: ${escapeHtml(callNum)}</a>` : ''}
        </div>
      `);
      markersLayer.addLayer(marker);
    });

    // 2. Current User GPS Pin (when GPS coordinates are available)
    if (userCoords) {
      const userIcon = L.divIcon({
        className: 'rescue-user-pin',
        html: `
          <div style="
            background: #2563eb;
            color: white;
            border-radius: 50%;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.28);
            border: 3px solid white;
            font-size: 9px;
          ">●</div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const userMarker = L.marker([userCoords.lat, userCoords.lng], { icon: userIcon });
      userMarker.bindPopup(
        `<div style="font-size:12px;"><strong>Vị trí của bạn</strong>${confirmedPhone ? `<br/>SĐT: <strong>${escapeHtml(confirmedPhone)}</strong>` : ''}</div>`
      );
      markersLayer.addLayer(userMarker);
    }

    // 3. Active SOS Rescue Signals (+ selected resolved signal if inspected)
    const signalsOnMap = [...activeSignals];
    if (selectedSignalId) {
      const selectedResolved = resolvedSignals.find(s => s.id === selectedSignalId);
      if (selectedResolved) {
        signalsOnMap.push(selectedResolved);
      }
    }

    signalsOnMap.forEach(sig => {
      const isSelected = selectedSignalId === sig.id;
      const isResponding = sig.status === 'responding';
      const isResolved = sig.status === 'resolved';
      const catLabel = CATEGORY_META[sig.category]?.label || 'Khẩn cấp';
      const pinColor = isResolved ? '#047857' : isResponding ? '#d97706' : '#dc2626';
      const pinShadow = isResolved
        ? 'rgba(4,120,87,0.32)'
        : isResponding
        ? 'rgba(217,119,6,0.35)'
        : 'rgba(220,38,38,0.32)';

      const safeAvatar = getSafeAvatarSrc(sig.senderAvatarUrl);
      const avatarInitial = escapeHtml(
        ((sig.senderName || sig.phone || 'S').trim()[0] || 'S').toUpperCase()
      );
      const pinSize = safeAvatar ? (isSelected ? 46 : 40) : isSelected ? 34 : 28;
      const badgeContent = safeAvatar
        ? `
          <div style="
            position:relative;
            width:${pinSize}px;
            height:${pinSize}px;
            border-radius:50%;
            background:${pinColor};
            border:3px solid #ffffff;
            box-shadow:0 0 0 ${isSelected ? '10px' : '7px'} ${pinShadow};
            overflow:hidden;
            display:flex;
            align-items:center;
            justify-content:center;
            color:#ffffff;
            font-weight:900;
            font-size:15px;
          ">
            <span>${avatarInitial}</span>
            <img
              src="${escapeHtml(safeAvatar)}"
              alt="${escapeHtml(sig.senderName || sig.phone)}"
              referrerpolicy="no-referrer"
              onerror="this.style.display='none'"
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;"
            />
          </div>
        `
        : `
          <div style="
            width:${pinSize}px;
            height:${pinSize}px;
            border-radius:50%;
            background:${pinColor};
            border:3px solid #ffffff;
            box-shadow:0 0 0 ${isSelected ? '10px' : '7px'} ${pinShadow};
            display:flex;
            align-items:center;
            justify-content:center;
            color:white;
            font-weight:900;
            font-size:13px;
          ">${isResolved ? '✓' : '!'}</div>
        `;

      const sosIcon = L.divIcon({
        className: 'rescue-sos-beacon-pin',
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
            <div style="
              background:${pinColor};
              color:#ffffff;
              padding:4px 9px;
              border-radius:9999px;
              font-size:12px;
              font-weight:900;
              letter-spacing:0.03em;
              white-space:nowrap;
              border:2px solid #ffffff;
              box-shadow:0 4px 14px ${pinShadow};
              margin-bottom:5px;
            ">
              ${isResolved ? 'ĐÃ CỨU' : 'SOS'} · ${escapeHtml(sig.phone)}
            </div>
            ${badgeContent}
          </div>
        `,
        iconSize: safeAvatar ? [164, 82] : [140, 62],
        iconAnchor: safeAvatar ? [82, 74] : [70, 56],
      });

      const marker = L.marker([sig.lat, sig.lng], {
        icon: sosIcon,
        zIndexOffset: isSelected ? 1000 : 500,
      });

      const distKm = userCoords
        ? calculateHaversineDistance(userCoords.lat, userCoords.lng, sig.lat, sig.lng)
        : null;
      const gmapsUrl = userCoords
        ? `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${sig.lat},${sig.lng}&travelmode=driving`
        : `https://www.google.com/maps/search/?api=1&query=${sig.lat},${sig.lng}`;

      const popupAvatarHtml = safeAvatar
        ? `<img src="${escapeHtml(safeAvatar)}" alt="${escapeHtml(sig.senderName || sig.phone)}" referrerpolicy="no-referrer" onerror="this.style.display='none'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid ${pinColor};flex-shrink:0;" />`
        : '';

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.5; min-width: 235px;">
          <div style="display:inline-block;padding:2px 8px;border-radius:6px;background:${
            isResolved ? '#d1fae5' : isResponding ? '#fef3c7' : '#fee2e2'
          };color:${
            isResolved ? '#065f46' : isResponding ? '#92400e' : '#b91c1c'
          };font-weight:800;font-size:11px;margin-bottom:6px;">
            ${
              isResolved
                ? sig.outcome === 'referred'
                  ? 'ĐÃ CỨU · CHUYỂN TUYẾN'
                  : 'ĐÃ CỨU AN TOÀN'
                : isResponding
                ? 'ĐANG ĐIỀU PHỐI CỨU HỘ'
                : 'TÍN HIỆU CỨU HỘ KHẨN (SOS)'
            }
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin:2px 0 6px;">
            ${popupAvatarHtml}
            <div style="min-width:0;">
              <div style="font-size: 16px; font-weight: 900; color: ${pinColor};">
                ☎ ${escapeHtml(sig.phone)}
              </div>
              ${sig.extraPhone ? `<div style="font-size: 12px; font-weight: 700; color: #334155;">SĐT bổ sung: ${escapeHtml(sig.extraPhone)}</div>` : ''}
              ${sig.senderName ? `<div style="font-weight:700;color:#0f172a;">${escapeHtml(sig.senderName)}${sig.senderVerified ? ' ✓' : ''}</div>` : ''}
            </div>
          </div>
          ${sig.senderDob || sig.senderGender ? `<div style="color:#475569;font-size:11px;">${sig.senderDob ? `Ngày sinh: <strong>${escapeHtml(sig.senderDob)}</strong>` : ''}${sig.senderDob && sig.senderGender ? ' · ' : ''}${sig.senderGender ? `Giới tính: <strong>${escapeHtml(sig.senderGender)}</strong>` : ''}</div>` : ''}
          ${sig.senderCitizenIdMasked ? `<div style="color:#475569;font-size:11px;">CCCD: <strong>${escapeHtml(sig.senderCitizenIdMasked)}</strong></div>` : ''}
          ${sig.senderAddress ? `<div style="color:#475569;font-size:11px;">Địa chỉ: ${escapeHtml(sig.senderAddress)}</div>` : ''}
          <div style="color:#334155;margin-top:3px;">Tình huống: <strong>${escapeHtml(catLabel)}</strong></div>
          ${sig.referredToFacility ? `<div style="color:#0369a1;font-weight:700;">Chuyển đến: ${escapeHtml(sig.referredToFacility)}</div>` : ''}
          ${sig.note ? `<div style="color:#475569;margin-top:3px;font-style:italic;">"${escapeHtml(sig.note)}"</div>` : ''}
          <div style="color:#047857;font-weight:700;margin-top:4px;">
            ${distKm !== null ? `Cách bạn ${distKm.toFixed(2)} km · ` : ''}${formatRelativeTimeVi(sig.createdAt)}
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <a href="tel:${escapeHtml(sig.phone)}" style="background:#dc2626;color:#fff;padding:5px 10px;border-radius:8px;font-weight:700;text-decoration:none;">Gọi ngay</a>
            ${sig.extraPhone ? `<a href="tel:${escapeHtml(sig.extraPhone)}" style="background:#0f766e;color:#fff;padding:5px 10px;border-radius:8px;font-weight:700;text-decoration:none;">Gọi SĐT phụ</a>` : ''}
            <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="background:#0f172a;color:#fff;padding:5px 10px;border-radius:8px;font-weight:700;text-decoration:none;">${userCoords ? 'Chỉ đường GPS' : 'Mở Google Maps'}</a>
          </div>
        </div>
      `);

      marker.on('click', () => {
        setSelectedSignalId(sig.id);
      });

      markersLayer.addLayer(marker);
      signalMarkersMapRef.current.set(sig.id, marker);
    });
  }, [
    hasAccess,
    userCoords,
    mapTileType,
    activeSignals,
    resolvedSignals,
    selectedSignalId,
    combinedMedicalPoints,
    confirmedPhone,
    settings.mapLocations,
  ]);

  const handleConfirmPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (isVerifiedSosUser && (verifiedPhoneVal || confirmedPhone)) {
      return;
    }
    const cleaned = normalizePhoneInput(phoneInput);
    if (!isValidVietnamesePhone(cleaned)) {
      setPhoneError('Vui lòng nhập số điện thoại hợp lệ (vd: 0901234567 hoặc +84901234567).');
      return;
    }
    setPhoneError('');
    setPhoneInput(cleaned);
    setConfirmedPhone(cleaned);
    try {
      localStorage.setItem(RESCUE_PHONE_STORAGE_KEY, cleaned);
      if (!isVerifiedSosUser && senderName.trim()) {
        localStorage.setItem(RESCUE_NAME_STORAGE_KEY, senderName.trim());
      }
    } catch {
      // ignore
    }
    showToast('success', 'Đã xác nhận số điện thoại', `Số liên hệ: ${cleaned}`);
  };

  const handleConfirmExtraPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmedExtraPhone) return;
    const cleaned = normalizePhoneInput(extraPhoneInput);
    if (!isValidVietnamesePhone(cleaned)) {
      setExtraPhoneError('Vui lòng nhập số điện thoại hợp lệ (vd: 0901234567 hoặc +84901234567).');
      return;
    }
    if (cleaned === (verifiedPhoneVal || confirmedPhone)) {
      setExtraPhoneError('Số điện thoại bổ sung phải khác số điện thoại chính.');
      return;
    }
    setExtraPhoneError('');
    setExtraPhoneInput(cleaned);
    setConfirmedExtraPhone(cleaned);
    showToast('success', 'Đã thêm số điện thoại', `SĐT bổ sung ${cleaned} đã được ghi nhận và khóa.`);
  };

  const handleBroadcastSos = async () => {
    const primaryPhone = isVerifiedSosUser
      ? verifiedPhoneVal || confirmedPhone
      : confirmedPhone;
    const effectiveSenderName = isVerifiedSosUser
      ? verifiedDisplayName || senderName.trim()
      : senderName.trim();

    if (!primaryPhone || !userCoords) {
      showToast('warning', 'Thiếu thông tin bắt buộc', 'Cần số điện thoại và định vị GPS để phát tín hiệu.');
      return;
    }

    setIsBroadcasting(true);
    try {
      if (effectiveSenderName) {
        try {
          localStorage.setItem(RESCUE_NAME_STORAGE_KEY, effectiveSenderName);
        } catch {
          // ignore
        }
      }
      const newId = await createRescueSignal({
        phone: primaryPhone,
        extraPhone: confirmedExtraPhone || undefined,
        senderName: effectiveSenderName || undefined,
        senderAvatarUrl: isVerifiedSosUser && verifiedAvatarUrl ? verifiedAvatarUrl : undefined,
        senderCitizenIdMasked:
          isVerifiedSosUser && verifiedCitizenId
            ? maskVerifiedValue(verifiedCitizenId, 'cccd')
            : undefined,
        senderDob: isVerifiedSosUser && verifiedDob ? verifiedDob : undefined,
        senderGender:
          isVerifiedSosUser &&
          (verifiedGender === 'Nam' || verifiedGender === 'Nữ' || verifiedGender === 'Khác')
            ? verifiedGender
            : undefined,
        senderAddress: isVerifiedSosUser && verifiedFullAddress ? verifiedFullAddress : undefined,
        senderVerified: isVerifiedSosUser || undefined,
        category,
        note: noteInput.trim() || undefined,
        lat: userCoords.lat,
        lng: userCoords.lng,
        accuracy: userCoords.accuracy,
        deviceId,
        uid: currentUser?.uid,
      });
      setSelectedSignalId(newId);
      setNoteInput('');
      showToast(
        'error',
        'ĐÃ PHÁT TÍN HIỆU CỨU HỘ (SOS)',
        `Số ${primaryPhone} và vị trí GPS của bạn đang được hiển thị công khai.`
      );
    } catch (err: any) {
      showToast('error', 'Không thể phát tín hiệu', err?.message || 'Vui lòng thử lại hoặc gọi 115 ngay.');
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleUpdateMyCoords = async () => {
    if (!myActiveSignal || !userCoords) return;
    setIsUpdatingSignal(true);
    try {
      await updateRescueSignal(myActiveSignal.id, {
        lat: userCoords.lat,
        lng: userCoords.lng,
        accuracy: userCoords.accuracy,
      });
      showToast('success', 'Đã cập nhật tọa độ mới', `${userCoords.lat.toFixed(5)}, ${userCoords.lng.toFixed(5)}`);
    } catch (err: any) {
      showToast('error', 'Lỗi cập nhật vị trí', err?.message);
    } finally {
      setIsUpdatingSignal(false);
    }
  };

  const openResolutionModal = (sig: RescueSignal) => {
    setResolveModalSignal(sig);
    setResolveOutcome(sig.outcome || 'on_site');
    setResolveFacilityInput(sig.referredToFacility || '');
    setResolveResponderNote(sig.responderNote || '');
  };

  const handleConfirmResolutionModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveModalSignal) return;
    if (resolveOutcome === 'referred' && !resolveFacilityInput.trim()) {
      showToast('warning', 'Thiếu tên cơ sở tiếp nhận', 'Vui lòng chọn hoặc nhập cơ sở y tế chuyển tuyến.');
      return;
    }

    setIsSavingResolution(true);
    try {
      await updateRescueSignal(resolveModalSignal.id, {
        status: 'resolved',
        outcome: resolveOutcome,
        referredToFacility: resolveOutcome === 'referred' ? resolveFacilityInput.trim() : '',
        resolvedAt: resolveModalSignal.resolvedAt || new Date().toISOString(),
        responderName:
          resolveModalSignal.responderName ||
          userProfile?.displayName ||
          (isAdmin ? 'Quản trị viên' : 'Cán bộ Y tế'),
        responderPhone:
          resolveModalSignal.responderPhone ||
          userProfile?.phoneNumber ||
          settings.emergencyPhone ||
          undefined,
        responderNote: resolveResponderNote.trim() || undefined,
      });
      showToast(
        'success',
        resolveOutcome === 'referred' ? 'Đã ghi nhận chuyển tuyến' : 'Đã xác nhận cứu hộ thành công',
        resolveOutcome === 'referred'
          ? `Chuyển đến: ${resolveFacilityInput.trim()}`
          : `Số ${resolveModalSignal.phone} đã được đánh dấu an toàn.`
      );
      setResolveModalSignal(null);
    } catch (err: any) {
      showToast('error', 'Không thể lưu kết quả cứu hộ', err?.message);
    } finally {
      setIsSavingResolution(false);
    }
  };

  const handleResolveSignal = (sig: RescueSignal, nextStatus: 'responding' | 'resolved' | 'cancelled') => {
    if (nextStatus === 'resolved' && isStaff) {
      openResolutionModal(sig);
      return;
    }

    const label =
      nextStatus === 'responding'
        ? 'Xác nhận đang tiếp cận cứu hộ?'
        : nextStatus === 'cancelled'
        ? 'Hủy tín hiệu cứu hộ này?'
        : 'Đánh dấu đã an toàn & hoàn tất cứu hộ?';

    showConfirm({
      title: label,
      message: `Tín hiệu từ số điện thoại ${sig.phone}`,
      confirmText: 'Xác nhận',
      cancelText: 'Đóng',
      onConfirm: async () => {
        try {
          await updateRescueSignal(sig.id, {
            status: nextStatus,
            ...(nextStatus === 'resolved'
              ? {
                  outcome: 'on_site',
                  resolvedAt: new Date().toISOString(),
                }
              : {}),
            ...(nextStatus === 'responding' && isStaff
              ? {
                  responderName: userProfile?.displayName || 'Cán bộ Y tế',
                  responderPhone: userProfile?.phoneNumber || settings.emergencyPhone || undefined,
                }
              : {}),
          });
          showToast('success', 'Đã cập nhật trạng thái tín hiệu');
        } catch (err: any) {
          showToast('error', 'Lỗi cập nhật trạng thái', err?.message);
        }
      },
    });
  };

  const handleDeleteSignal = (sig: RescueSignal) => {
    if (!isAdmin) return;
    showConfirm({
      title: 'Xóa bản ghi tín hiệu cứu hộ?',
      message: `Xóa vĩnh viễn tín hiệu từ ${sig.phone}. Thao tác này sẽ cập nhật lại số liệu thống kê.`,
      confirmText: 'Xóa',
      cancelText: 'Hủy',
      onConfirm: async () => {
        try {
          await deleteRescueSignal(sig.id);
          if (selectedSignalId === sig.id) setSelectedSignalId(null);
          showToast('success', 'Đã xóa bản ghi tín hiệu');
        } catch (err: any) {
          showToast('error', 'Lỗi xóa bản ghi', err?.message);
        }
      },
    });
  };

  const focusSignalOnMap = (sig: RescueSignal) => {
    setSelectedSignalId(sig.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([sig.lat, sig.lng], 16, { animate: true });
      const marker = signalMarkersMapRef.current.get(sig.id);
      if (marker) {
        marker.openPopup();
      }
    }
  };

  const focusMedicalPointOnMap = (lat: number, lng: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 16, { animate: true });
    }
  };

  const renderVerifiedSosIdentityCard = () => {
    if (!isVerifiedSosUser) return null;
    const lockedPrimaryPhone = verifiedPhoneVal || confirmedPhone;
    const isPrimaryPhoneLocked = Boolean(verifiedPhoneVal || confirmedPhone);

    return (
      <div className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar
              src={verifiedAvatarUrl}
              name={verifiedDisplayName || verifiedEmail || 'Người dùng'}
              size={48}
              rounded="full"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                  {verifiedDisplayName || 'Người dùng đã xác minh'}
                </span>
                {verificationProgress.isFullyVerified && <VerifiedBlueTick size="sm" />}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {verifiedEmail || 'Tài khoản đã xác minh'}
              </div>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-lg shrink-0">
            <Lock className="w-3 h-3" />
            <span>Thông tin người SOS · Không thể chỉnh sửa</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Họ và tên
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={verifiedDisplayName || 'Chưa cập nhật'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Số điện thoại chính
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={lockedPrimaryPhone || 'Chưa có SĐT'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Số CCCD / VNeID
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={verifiedCitizenId || 'Chưa cập nhật'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Ngày sinh
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={verifiedDob || 'Chưa cập nhật'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Giới tính
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={verifiedGender || 'Chưa cập nhật'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Email tài khoản
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={verifiedEmail || 'Chưa cập nhật'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-not-allowed"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              Địa chỉ đầy đủ
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={verifiedFullAddress || 'Chưa cập nhật'}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-not-allowed"
            />
          </div>
        </div>

        {/* Add phone option (locked & non-editable once confirmed) */}
        {!isPrimaryPhoneLocked ? (
          <form onSubmit={handleConfirmPhone} className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-2">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Thêm số điện thoại liên hệ khẩn cấp * (sau khi thêm sẽ không thể chỉnh sửa)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="tel"
                required
                value={phoneInput}
                onChange={e => {
                  setPhoneInput(e.target.value);
                  setPhoneError('');
                }}
                placeholder="Nhập SĐT liên hệ (vd: 0901234567)"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm số điện thoại</span>
              </button>
            </div>
            {phoneError && <p className="text-xs text-rose-600 font-semibold">{phoneError}</p>}
          </form>
        ) : (
          <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-2">
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
              Số điện thoại bổ sung (tùy chọn · sau khi thêm sẽ không thể chỉnh sửa)
            </label>
            {confirmedExtraPhone ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  disabled
                  value={confirmedExtraPhone}
                  className="flex-1 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs font-bold text-emerald-900 dark:text-emerald-200 tabular-nums cursor-not-allowed"
                />
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Đã khóa</span>
                </span>
              </div>
            ) : (
              <form onSubmit={handleConfirmExtraPhone} className="space-y-1.5">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="tel"
                    value={extraPhoneInput}
                    onChange={e => {
                      setExtraPhoneInput(e.target.value);
                      setExtraPhoneError('');
                    }}
                    placeholder="Nhập thêm SĐT người thân/dự phòng (vd: 0912345678)"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm SĐT</span>
                  </button>
                </div>
                {extraPhoneError && (
                  <p className="text-xs text-rose-600 font-semibold">{extraPhoneError}</p>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    );
  };

  // MANDATORY ACCESS GATE: Require both Phone Number and GPS Location on entry
  if (!hasAccess) {
    return (
      <div className="max-w-2xl mx-auto py-6 space-y-6 animate-in fade-in duration-200">
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 shadow-sm overflow-hidden">
          <div className="p-6 bg-gradient-to-r from-rose-700 to-rose-800 text-white flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-white/15 shrink-0">
              <ShieldAlert className="w-7 h-7 text-white" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                Bản Đồ Cứu Hộ Cứu Nạn (SOS)
              </h1>
              <p className="text-xs sm:text-sm text-rose-100 leading-relaxed">
                Để đảm bảo xác thực liên hệ và điều phối cứu hộ chính xác, vui lòng hoàn tất 2 bước bắt buộc bên dưới khi truy cập trang này.
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Step 1: Verified Profile OR Manual Phone Number */}
            {isVerifiedSosUser ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>1. Thông tin người SOS &amp; Số điện thoại *</span>
                  </span>
                  {confirmedPhone ? (
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Đã xác thực</span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-rose-600">Cần thêm SĐT</span>
                  )}
                </div>
                {renderVerifiedSosIdentityCard()}
              </div>
            ) : (
              <form onSubmit={handleConfirmPhone} className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Phone className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>1. Số điện thoại liên hệ khẩn cấp *</span>
                  </span>
                  {confirmedPhone ? (
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Đã xác nhận</span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-rose-600">Bắt buộc</span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="tel"
                    required
                    value={phoneInput}
                    onChange={e => {
                      setPhoneInput(e.target.value);
                      setPhoneError('');
                    }}
                    placeholder="Nhập SĐT (vd: 0901234567)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <input
                    type="text"
                    value={senderName}
                    onChange={e => setSenderName(e.target.value)}
                    placeholder="Họ tên (tùy chọn)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                {phoneError && (
                  <p className="text-xs font-semibold text-rose-600">{phoneError}</p>
                )}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Số điện thoại sẽ hiển thị công khai khi bạn phát tín hiệu cứu hộ.
                  </span>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {confirmedPhone ? 'Cập nhật SĐT' : 'Xác nhận SĐT'}
                  </button>
                </div>
              </form>
            )}

            {/* Step 2: Mandatory GPS Positioning */}
            <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <LocateFixed className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>2. Định vị GPS hiện tại *</span>
                </span>
                {userCoords ? (
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Đã định vị</span>
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-amber-600">
                    {isLocating ? 'Đang lấy GPS...' : 'Chưa có GPS'}
                  </span>
                )}
              </div>

              {userCoords ? (
                <div className="text-xs font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3.5 py-2.5 tabular-nums">
                  Tọa độ hiện tại: {userCoords.lat.toFixed(6)}, {userCoords.lng.toFixed(6)}
                  {userCoords.accuracy ? ` (sai số ~${Math.round(userCoords.accuracy)}m)` : ''}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {gpsError || 'Trình duyệt đang yêu cầu quyền truy cập Vị trí (GPS). Vui lòng bấm Cho phép.'}
                  </p>
                  <button
                    type="button"
                    onClick={requestGpsLocation}
                    disabled={isLocating}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-2 transition cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin' : ''}`} />
                    <span>{isLocating ? 'Đang xác định vị trí...' : 'Cấp quyền & Lấy vị trí GPS'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Emergency Quick Dial while still in gate */}
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-rose-900 dark:text-rose-200 font-semibold">
                Cần gọi cấp cứu trực tiếp ngay lập tức?
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {emergencyContacts.map(ec => (
                  <a
                    key={ec.id}
                    href={`tel:${ec.phone}`}
                    className="px-3 py-1.5 rounded-xl bg-rose-700 text-white text-xs font-extrabold tabular-nums inline-flex items-center gap-1.5 hover:bg-rose-800 transition"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>{ec.phone}</span>
                  </a>
                ))}
                <a
                  href="tel:114"
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-extrabold tabular-nums"
                >
                  114 Cứu nạn
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Rescue Header & Verified Access Strip */}
      <div
        data-section-title="Bản đồ Cứu hộ cứu nạn"
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
      >
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Bản Đồ Cứu Hộ Cứu Nạn (SOS)
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Quản trị viên (xem không cần GPS)</span>
                  </span>
                )}
                {confirmedPhone && (
                  <>
                    {isAdmin && <span aria-hidden="true">·</span>}
                    <span>
                      SĐT xác thực: <strong className="text-slate-900 dark:text-white">{confirmedPhone}</strong>
                      {confirmedExtraPhone ? ` · SĐT bổ sung: ${confirmedExtraPhone}` : ''}
                    </span>
                    {!isVerifiedSosUser && (
                      <button
                        type="button"
                        onClick={() => setConfirmedPhone('')}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                      >
                        Đổi SĐT
                      </button>
                    )}
                  </>
                )}
                {userCoords && (
                  <>
                    {(isAdmin || confirmedPhone) && <span aria-hidden="true">·</span>}
                    <span>
                      GPS: <strong className="text-emerald-700 dark:text-emerald-400">{userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}</strong>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tile Switcher & Refresh GPS */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={requestGpsLocation}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <LocateFixed className="w-4 h-4 text-blue-600" />
            <span>{userCoords ? 'Cập nhật GPS' : 'Lấy GPS'}</span>
          </button>

          <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMapTileType('streets')}
              className={`px-3 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                mapTileType === 'streets'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Bản đồ</span>
            </button>
            <button
              type="button"
              onClick={() => setMapTileType('satellite')}
              className={`px-3 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                mapTileType === 'satellite'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Vệ tinh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Broadcast SOS Control Panel OR Active Signal Emergency Response Panel */}
      {myActiveSignal ? (
        <div className="space-y-4">
          {/* Active Broadcast Highlight Banner */}
          <div className="rounded-3xl bg-rose-700 text-white p-5 sm:p-6 shadow-lg space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-100">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                  <span>Đang phát tín hiệu cứu hộ công khai</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeTimeVi(myActiveSignal.createdAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {myActiveSignal.senderAvatarUrl && (
                    <UserAvatar
                      src={myActiveSignal.senderAvatarUrl}
                      name={myActiveSignal.senderName || myActiveSignal.phone}
                      size={48}
                      rounded="full"
                      className="ring-2 ring-white/80"
                    />
                  )}
                  <span className="text-2xl sm:text-3xl font-black tracking-wide tabular-nums bg-white text-rose-700 px-3.5 py-1 rounded-xl shadow-xs">
                    {myActiveSignal.phone}
                  </span>
                  {myActiveSignal.extraPhone && (
                    <span className="text-xs font-bold bg-white/15 border border-white/30 text-white px-2.5 py-1 rounded-lg tabular-nums">
                      SĐT bổ sung: {myActiveSignal.extraPhone}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-rose-100">
                    {CATEGORY_META[myActiveSignal.category]?.label}
                    {myActiveSignal.status === 'responding' ? ' · Đã có đơn vị tiếp cận' : ''}
                  </span>
                </div>
                <p className="text-xs text-rose-100 font-mono tabular-nums">
                  Vị trí đang phát: {myActiveSignal.lat.toFixed(6)}, {myActiveSignal.lng.toFixed(6)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleUpdateMyCoords}
                  disabled={isUpdatingSignal}
                  className="px-4 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/30 text-white text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                >
                  <LocateFixed className="w-4 h-4" />
                  <span>Cập nhật tọa độ mới</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleResolveSignal(myActiveSignal, 'resolved')}
                  className="px-4 py-2.5 rounded-xl bg-white text-rose-800 hover:bg-rose-50 text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Đã an toàn · Kết thúc SOS</span>
                </button>
              </div>
            </div>
          </div>

          {/* Emergency Numbers + Nearby Medical Points shown IMMEDIATELY upon broadcasting SOS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Emergency Numbers */}
            <div className="lg:col-span-5 rounded-3xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 p-5 space-y-3.5">
              <div className="flex items-center gap-2 text-sm font-extrabold text-rose-700 dark:text-rose-300">
                <PhoneCall className="w-4 h-4 shrink-0" />
                <span>Số Điện Thoại Cấp Cứu Khẩn Cấp 24/7</span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {emergencyContacts.map(ec => (
                  <div key={ec.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {ec.note || 'Thường trực cấp cứu Trạm Y tế'}
                      </div>
                    </div>
                    <a
                      href={`tel:${ec.phone}`}
                      className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-black tabular-nums whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>{ec.phone}</span>
                    </a>
                  </div>
                ))}
                <div className="pt-2.5 flex flex-wrap items-center gap-2">
                  <a
                    href="tel:115"
                    className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-extrabold tabular-nums"
                  >
                    115 · Cấp cứu Y tế
                  </a>
                  <a
                    href="tel:114"
                    className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-extrabold tabular-nums"
                  >
                    114 · Cứu hộ Cứu nạn
                  </a>
                  <a
                    href="tel:113"
                    className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-extrabold tabular-nums"
                  >
                    113 · Công an
                  </a>
                </div>
              </div>
            </div>

            {/* Nearby Medical Facilities */}
            <div className="lg:col-span-7 rounded-3xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-800 dark:text-emerald-300">
                  <Ambulance className="w-4 h-4 shrink-0" />
                  <span>Các Điểm Y Tế Lân Cận Gần Nhất</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentView('nearby_facilities')}
                  className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
                >
                  Xem toàn bộ danh mục
                </button>
              </div>

              {combinedMedicalPoints.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  Chưa có dữ liệu điểm y tế trong hệ thống. Vui lòng gọi ngay số cấp cứu 115 ở bên cạnh.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                  {combinedMedicalPoints.slice(0, 5).map(pt => {
                    const dialPhone = pt.emergencyPhone || pt.phone;
                    return (
                      <div
                        key={pt.id}
                        className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                            <span>{pt.sourceLabel}</span>
                            {pt.distanceKm !== null && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{pt.distanceKm.toFixed(1)} km (~{pt.driveMinutes} phút)</span>
                              </>
                            )}
                            {pt.is24Hours && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-rose-600 dark:text-rose-400 font-bold">24/7</span>
                              </>
                            )}
                          </div>
                          <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {pt.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {pt.address}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {dialPhone && (
                            <a
                              href={`tel:${dialPhone}`}
                              className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold tabular-nums inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              <Phone className="w-3 h-3" />
                              <span>{dialPhone}</span>
                            </a>
                          )}
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&origin=${myActiveSignal.lat},${myActiveSignal.lng}&destination=${pt.lat},${pt.lng}&travelmode=driving`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <span>Chỉ đường</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => focusMedicalPointOnMap(pt.lat, pt.lng)}
                            className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                            title="Xem trên bản đồ"
                          >
                            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : !canBroadcastSos && isAdmin ? (
        /* Admin Monitor Strip with Optional Phone/GPS Verification */
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 shadow-xs p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Chế độ Giám sát &amp; Điều phối Quản trị</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                Quản trị viên có thể xem toàn bộ bản đồ, theo dõi tín hiệu SOS, thống kê ca đã cứu và cập nhật chuyển tuyến mà không cần cung cấp vị trí GPS.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdminVerifyBox(prev => !prev)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showAdminVerifyBox ? 'Đóng khung phát SOS' : 'Nhập SĐT/GPS để phát SOS'}
            </button>
          </div>

          {showAdminVerifyBox && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-4">
              {isVerifiedSosUser ? (
                <div className="space-y-3">
                  {renderVerifiedSosIdentityCard()}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Định vị GPS hiện tại (bắt buộc để phát SOS)
                    </label>
                    {userCoords ? (
                      <div className="text-xs font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
                        Đã có GPS: {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={requestGpsLocation}
                        disabled={isLocating}
                        className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <LocateFixed className="w-3.5 h-3.5" />
                        <span>{isLocating ? 'Đang lấy GPS...' : 'Cấp quyền & Lấy GPS'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <form onSubmit={handleConfirmPhone} className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      1. Xác nhận SĐT liên hệ
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={e => {
                          setPhoneInput(e.target.value);
                          setPhoneError('');
                        }}
                        placeholder="Nhập SĐT (vd: 0901234567)"
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-bold tabular-nums"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        Xác nhận
                      </button>
                    </div>
                    {phoneError && <p className="text-xs text-rose-600 font-semibold">{phoneError}</p>}
                  </form>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      2. Định vị GPS (tùy chọn khi phát SOS)
                    </label>
                    {userCoords ? (
                      <div className="text-xs font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
                        Đã có GPS: {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={requestGpsLocation}
                        disabled={isLocating}
                        className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <LocateFixed className="w-3.5 h-3.5" />
                        <span>{isLocating ? 'Đang lấy GPS...' : 'Cấp quyền & Lấy GPS'}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Broadcast SOS Form */
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 shadow-xs p-5 sm:p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Phát Tín Hiệu Cứu Hộ Khẩn Cấp (SOS)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Khi phát tín hiệu, số điện thoại, ảnh đại diện và vị trí GPS của bạn sẽ được làm nổi bật công khai trên bản đồ để mọi người và lực lượng y tế hỗ trợ kịp thời.
              </p>
            </div>
          </div>

          {isVerifiedSosUser && renderVerifiedSosIdentityCard()}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(Object.keys(CATEGORY_META) as RescueSignalCategory[]).map(catKey => {
              const meta = CATEGORY_META[catKey];
              const Icon = meta.icon;
              const isSelected = category === catKey;
              return (
                <button
                  key={catKey}
                  type="button"
                  onClick={() => setCategory(catKey)}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    isSelected
                      ? 'bg-rose-700 border-rose-700 text-white shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-rose-300'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{meta.label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {!isVerifiedSosUser && (
              <div className="md:col-span-3">
                <input
                  type="text"
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  placeholder="Tên của bạn (tùy chọn)"
                  className="w-full px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            )}
            <div className={isVerifiedSosUser ? 'md:col-span-8' : 'md:col-span-5'}>
              <input
                type="text"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder="Mô tả nhanh tình trạng, số người cần cứu, điểm mốc..."
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="md:col-span-4">
              <button
                type="button"
                onClick={handleBroadcastSos}
                disabled={isBroadcasting}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-extrabold text-sm shadow-md inline-flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
              >
                <Radio className={`w-4 h-4 shrink-0 ${isBroadcasting ? 'animate-spin' : ''}`} />
                <span>{isBroadcasting ? 'Đang phát tín hiệu...' : 'PHÁT TÍN HIỆU CỨU HỘ (SOS)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rescue Outcome & Referral Statistics Dashboard */}
      <div
        data-section-title="Thống kê Cứu hộ và Chuyển tuyến"
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                Thống Kê Cứu Hộ &amp; Chuyển Tuyến
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tổng hợp số ca đã cứu hộ thành công, phân loại tình huống và số trường hợp chuyển tuyến
              </p>
            </div>
          </div>
          {resolvedSignals.length > 0 && (
            <button
              type="button"
              onClick={() => setSignalTab('resolved')}
              className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer self-start sm:self-auto"
            >
              <History className="w-3.5 h-3.5" />
              <span>Xem danh sách {resolvedSignals.length} ca đã cứu</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60">
            <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
              Tổng số ca đã cứu
            </div>
            <div className="mt-1 text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
              {resolvedSignals.length}
            </div>
            <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
              Trường hợp hoàn tất cứu hộ
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/60">
            <div className="text-xs font-bold text-sky-800 dark:text-sky-300 flex items-center gap-1">
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Đã chuyển tuyến</span>
            </div>
            <div className="mt-1 text-2xl sm:text-3xl font-black text-sky-700 dark:text-sky-400 tabular-nums">
              {referredSignals.length}
            </div>
            <div className="text-[11px] text-sky-700/80 dark:text-sky-300/80 mt-0.5 tabular-nums">
              {resolvedSignals.length > 0
                ? `${Math.round((referredSignals.length / resolvedSignals.length) * 100)}% tổng ca đã cứu`
                : 'Chưa có ca chuyển tuyến'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Xử trí tại chỗ / An toàn
            </div>
            <div className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tabular-nums">
              {onSiteSignals.length}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Ổn định không cần chuyển viện
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60">
            <div className="text-xs font-bold text-rose-800 dark:text-rose-300">
              Đang phát SOS / Tiếp nhận
            </div>
            <div className="mt-1 text-2xl sm:text-3xl font-black text-rose-700 dark:text-rose-400 tabular-nums">
              {activeSignals.length}
            </div>
            <div className="text-[11px] text-rose-700/80 dark:text-rose-300/80 mt-0.5">
              Tín hiệu đang chờ xử lý
            </div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2.5">
            Trong đó theo từng loại trường hợp:
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {categoryStats.map(item => {
              const Icon = item.meta.icon;
              return (
                <div
                  key={item.category}
                  className="p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                    <Icon className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span className="truncate">{item.meta.label}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                    <span className="text-slate-500 dark:text-slate-400">Đã cứu:</span>
                    <strong className="text-sm font-black text-emerald-700 dark:text-emerald-400">
                      {item.totalResolved}
                    </strong>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                    <span className="text-slate-500 dark:text-slate-400">Chuyển tuyến:</span>
                    <strong className="font-bold text-sky-700 dark:text-sky-400">
                      {item.referredCount}
                    </strong>
                  </div>
                  {item.activeCount > 0 && (
                    <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                      Đang phát SOS: {item.activeCount}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Split: Live Rescue Map + Public Signals List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Leaflet Interactive Map */}
        <div className="lg:col-span-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden p-3 sm:p-4 space-y-3">
          <div className="h-[420px] sm:h-[520px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 relative isolate z-0">
            <div ref={mapContainerRef} className="w-full h-full" />

            <div className="absolute top-3 left-3 z-10 pointer-events-none bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-semibold text-white whitespace-nowrap tabular-nums shadow-sm">
              {activeSignals.length} SOS đang phát · {resolvedSignals.length} đã cứu · {combinedMedicalPoints.length} điểm y tế
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>Nhấp vào nhãn đỏ SOS trên bản đồ để xem tọa độ chính xác và gọi/chỉ đường tiếp cận.</span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              ✚ Điểm y tế &amp; Bệnh viện lân cận ({combinedMedicalPoints.length})
            </span>
          </div>
        </div>

        {/* Public Real-time Signals Sidebar */}
        <div className="lg:col-span-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
          <div className="space-y-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setSignalTab('active')}
                className={`py-2 px-2.5 rounded-lg transition cursor-pointer tabular-nums ${
                  signalTab === 'active'
                    ? 'bg-rose-700 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Đang SOS ({activeSignals.length})
              </button>
              <button
                type="button"
                onClick={() => setSignalTab('resolved')}
                className={`py-2 px-2.5 rounded-lg transition cursor-pointer tabular-nums ${
                  signalTab === 'resolved'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Đã cứu ({resolvedSignals.length})
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {signalTab === 'active'
                ? 'Công khai thời gian thực cho mọi người và lực lượng y tế theo dõi'
                : 'Lịch sử các trường hợp đã cứu hộ và kết quả chuyển tuyến'}
            </p>
          </div>

          {signalTab === 'active' ? (
            activeSignals.length === 0 ? (
              <div className="py-10 px-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Hiện không có tín hiệu SOS nào
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mọi tín hiệu phát đi sẽ xuất hiện ngay lập tức tại đây và nổi bật trên bản đồ.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-0.5">
                {activeSignals.map(sig => {
                  const isSelected = selectedSignalId === sig.id;
                  const isMine = myActiveSignal?.id === sig.id;
                  const isResponding = sig.status === 'responding';
                  const catMeta = CATEGORY_META[sig.category] || CATEGORY_META.other;
                  const distKm = userCoords
                    ? calculateHaversineDistance(userCoords.lat, userCoords.lng, sig.lat, sig.lng)
                    : null;
                  const gmapsUrl = userCoords
                    ? `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${sig.lat},${sig.lng}&travelmode=driving`
                    : `https://www.google.com/maps/search/?api=1&query=${sig.lat},${sig.lng}`;

                  return (
                    <div
                      key={sig.id}
                      onClick={() => focusSignalOnMap(sig)}
                      className={`p-4 rounded-2xl border transition cursor-pointer space-y-2.5 ${
                        isSelected
                          ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 shadow-xs'
                          : 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 hover:border-rose-400'
                      }`}
                    >
                      {/* Highlighted Phone Number Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {sig.senderAvatarUrl && (
                            <UserAvatar
                              src={sig.senderAvatarUrl}
                              name={sig.senderName || sig.phone}
                              size={38}
                              rounded="full"
                              className="mt-0.5 border border-rose-200 dark:border-rose-800"
                            />
                          )}
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                              {isResponding ? 'Đang điều phối cứu hộ' : 'Đang phát tín hiệu SOS'}
                              {isMine ? ' · Của bạn' : ''}
                            </div>
                            <a
                              href={`tel:${sig.phone}`}
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 text-xl font-black text-rose-700 dark:text-rose-300 hover:underline tabular-nums tracking-wide"
                            >
                              <Phone className="w-4 h-4 shrink-0" />
                              <span>{sig.phone}</span>
                            </a>
                            {sig.extraPhone && (
                              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                SĐT bổ sung:{' '}
                                <a
                                  href={`tel:${sig.extraPhone}`}
                                  onClick={e => e.stopPropagation()}
                                  className="hover:underline text-rose-700 dark:text-rose-400"
                                >
                                  {sig.extraPhone}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>

                        {distKm !== null && (
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap shrink-0">
                            {distKm.toFixed(1)} km
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                        <div className="font-semibold flex items-center gap-1 flex-wrap">
                          <span>{catMeta.label}</span>
                          {sig.senderName && <span>· {sig.senderName}</span>}
                          {sig.senderVerified && <VerifiedBlueTick size="xs" />}
                        </div>
                        {(sig.senderDob || sig.senderGender || sig.senderCitizenIdMasked) && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">
                            {[
                              sig.senderDob ? `NS: ${sig.senderDob}` : '',
                              sig.senderGender || '',
                              sig.senderCitizenIdMasked ? `CCCD: ${sig.senderCitizenIdMasked}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                        {sig.senderAddress && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                            Địa chỉ: {sig.senderAddress}
                          </div>
                        )}
                        {sig.note && (
                          <p className="text-slate-600 dark:text-slate-400 italic leading-snug">
                            &quot;{sig.note}&quot;
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>{formatRelativeTimeVi(sig.createdAt)}</span>
                          <span>·</span>
                          <span>
                            {sig.lat.toFixed(4)}, {sig.lng.toFixed(4)}
                          </span>
                        </div>
                      </div>

                      {/* Action Row */}
                      <div className="pt-2 border-t border-rose-200/60 dark:border-rose-900/40 flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            focusSignalOnMap(sig);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Navigation className="w-3 h-3 text-rose-600" />
                          <span>Xem vị trí</span>
                        </button>

                        <a
                          href={gmapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold inline-flex items-center gap-1"
                        >
                          <span>{userCoords ? 'Chỉ đường' : 'Google Maps'}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>

                        {(isStaff || isMine) && (
                          <>
                            {isStaff && sig.status === 'active' && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleResolveSignal(sig, 'responding');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                              >
                                Tiếp nhận
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleResolveSignal(sig, isMine && !isStaff ? 'cancelled' : 'resolved');
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              {isStaff ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              <span>{isMine && !isStaff ? 'Hủy SOS' : 'Đã cứu'}</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : resolvedSignals.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
              <History className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Chưa có ca cứu hộ nào hoàn tất
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Các trường hợp đã cứu và chuyển tuyến sẽ được lưu thống kê tại đây.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-0.5">
              {resolvedSignals.map(sig => {
                const isSelected = selectedSignalId === sig.id;
                const catMeta = CATEGORY_META[sig.category] || CATEGORY_META.other;
                const isReferred = sig.outcome === 'referred';
                return (
                  <div
                    key={sig.id}
                    onClick={() => focusSignalOnMap(sig)}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer space-y-2 ${
                      isSelected
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500'
                        : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-emerald-400'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {sig.senderAvatarUrl && (
                          <UserAvatar
                            src={sig.senderAvatarUrl}
                            name={sig.senderName || sig.phone}
                            size={32}
                            rounded="full"
                            className="mt-0.5"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                                isReferred
                                  ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                              }`}
                            >
                              {isReferred ? 'Đã chuyển tuyến' : 'Đã cứu · Tại chỗ'}
                            </span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                              {sig.phone}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1 flex items-center gap-1 flex-wrap">
                            <span>{catMeta.label}</span>
                            {sig.senderName && <span>· {sig.senderName}</span>}
                            {sig.senderVerified && <VerifiedBlueTick size="xs" />}
                          </div>
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {formatRelativeTimeVi(sig.resolvedAt || sig.updatedAt)}
                      </span>
                    </div>

                    {isReferred && sig.referredToFacility && (
                      <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                        <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                        <span>Chuyển đến: {sig.referredToFacility}</span>
                      </div>
                    )}

                    {sig.responderNote && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                        Xử trí: &quot;{sig.responderNote}&quot;
                      </p>
                    )}

                    {(isStaff || isAdmin) && (
                      <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between gap-2 text-xs">
                        {isStaff && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              openResolutionModal(sig);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-400 cursor-pointer"
                          >
                            Cập nhật chuyển tuyến
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              handleDeleteSignal(sig);
                            }}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            title="Xóa bản ghi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Resolution & Referral Modal (Staff / Admin) */}
      {resolveModalSignal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmResolutionModal}
            className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Xác nhận Kết quả Cứu hộ
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  SĐT: {resolveModalSignal.phone} · {CATEGORY_META[resolveModalSignal.category]?.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResolveModalSignal(null)}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setResolveOutcome('on_site')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    resolveOutcome === 'on_site'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 text-emerald-900 dark:text-emerald-200'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-extrabold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Đã cứu · Xử trí tại chỗ</span>
                  </div>
                  <p className="text-[11px] opacity-80 mt-1">
                    Nạn nhân/bệnh nhân ổn định, không cần chuyển tuyến.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setResolveOutcome('referred')}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    resolveOutcome === 'referred'
                      ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-600 text-sky-900 dark:text-sky-200'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-extrabold flex items-center gap-1.5">
                    <ArrowRightLeft className="w-4 h-4 text-sky-600" />
                    <span>Đã cứu · Chuyển tuyến</span>
                  </div>
                  <p className="text-[11px] opacity-80 mt-1">
                    Chuyển tiếp đến Bệnh viện hoặc Cơ sở Y tế tuyến trên.
                  </p>
                </button>
              </div>

              {resolveOutcome === 'referred' && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Cơ sở tiếp nhận chuyển tuyến *
                  </label>
                  <input
                    type="text"
                    required
                    value={resolveFacilityInput}
                    onChange={e => setResolveFacilityInput(e.target.value)}
                    placeholder="VD: Bệnh viện Đa khoa Cà Mau, Trung tâm Y tế..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  {combinedMedicalPoints.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Chọn nhanh cơ sở trong danh mục:
                      </span>
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {combinedMedicalPoints.slice(0, 8).map(pt => (
                          <button
                            key={pt.id}
                            type="button"
                            onClick={() => setResolveFacilityInput(pt.name)}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                              resolveFacilityInput === pt.name
                                ? 'bg-sky-700 border-sky-700 text-white'
                                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-sky-400'
                            }`}
                          >
                            {pt.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Ghi chú tình trạng / Xử trí (tùy chọn)
                </label>
                <textarea
                  rows={2}
                  value={resolveResponderNote}
                  onChange={e => setResolveResponderNote(e.target.value)}
                  placeholder="Ghi nhận ngắn gọn hướng xử trí ban đầu, phương tiện chuyển..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setResolveModalSignal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={isSavingResolution}
                className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
              >
                {isSavingResolution ? 'Đang lưu...' : 'Lưu kết quả cứu hộ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
