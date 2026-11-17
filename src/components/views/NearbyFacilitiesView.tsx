import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MapPin,
  Phone,
  Clock,
  Navigation,
  ExternalLink,
  Search,
  Hospital,
  Stethoscope,
  Ambulance,
  Pill,
  Building2,
  LocateFixed,
  Layers,
  Map as MapIcon,
  Settings,
  X,
  User,
  Globe,
  CheckCircle2,
  AlertCircle,
  Car,
  ShieldCheck,
  Compass,
  Bike,
  Footprints,
  Crosshair,
  Route,
  Plus,
  Send,
  RefreshCw,
  History,
  Edit3,
  Clock3,
  XCircle,
  ArrowLeft,
} from 'lucide-react';
import L from 'leaflet';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';
import { NearbyFacility, NearbyFacilityType, SystemSettings } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  logAuditEvent,
  submitPendingNearbyFacility,
  resubmitPendingNearbyFacility,
  proposeApprovedFacilityEdit,
  loadLocalNearbyFacilityHistory,
  upsertLocalNearbyFacilityHistory,
} from '../../services/firebaseService';
import { getOrCreateDeviceId } from '../../services/systemNotificationService';
import { calculateHaversineDistance } from '../portal/StationMapSection';
import { WardSelector } from '../common/WardSelector';

interface NearbyFacilitiesViewProps {
  settings: SystemSettings;
  onOpenAdminManage?: () => void;
}

type OriginSource = 'gps' | 'station' | 'manual';
type TravelMode = 'motorbike' | 'car' | 'walking';

interface ReferenceOrigin {
  lat: number;
  lng: number;
  source: OriginSource;
  label: string;
}

interface RoadMetric {
  distanceKm: number;
  carMinutes: number;
  isRoadRoute: boolean;
}

interface EnrichedFacility extends NearbyFacility {
  resolvedLat: number | null;
  resolvedLng: number | null;
  straightDistanceKm: number | null;
  distanceKm: number | null;
  driveMinutes: number | null;
  carMinutes: number | null;
  motorbikeMinutes: number | null;
  walkingMinutes: number | null;
  isRoadRoute: boolean;
}

const FACILITY_TYPE_META: Record<
  NearbyFacilityType,
  { label: string; colorHex: string; icon: React.ComponentType<{ className?: string }> }
> = {
  hospital: { label: 'Bệnh viện', colorHex: '#dc2626', icon: Hospital },
  emergency_center: { label: 'Trung tâm Cấp cứu', colorHex: '#ea580c', icon: Ambulance },
  clinic: { label: 'Phòng khám', colorHex: '#0284c7', icon: Stethoscope },
  health_station: { label: 'Trạm Y tế', colorHex: '#047857', icon: Building2 },
  pharmacy: { label: 'Nhà thuốc', colorHex: '#0d9488', icon: Pill },
  other: { label: 'Cơ sở khác', colorHex: '#475569', icon: Building2 },
};

const TRAVEL_MODE_META: Record<
  TravelMode,
  { label: string; speedKmH: number; icon: React.ComponentType<{ className?: string }> }
> = {
  motorbike: { label: 'Xe máy', speedKmH: 30, icon: Bike },
  car: { label: 'Ô tô', speedKmH: 35, icon: Car },
  walking: { label: 'Đi bộ', speedKmH: 5, icon: Footprints },
};

const GEO_SESSION_COORDS_KEY = 'tyt_geo_coords';

function readCachedCoords(): { lat: number; lng: number } | null {
  try {
    const raw = sessionStorage.getItem(GEO_SESSION_COORDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === 'number' &&
      typeof parsed?.lng === 'number' &&
      isValidLatLng(parsed.lat, parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    // ignore
  }
  return null;
}

function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false;
  if (latNum === 0 && lngNum === 0) return false;
  return latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180;
}

function extractCoordsFromMapUrl(urlStr?: string): { lat: number; lng: number } | null {
  if (!urlStr) return null;
  let m = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) m = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m) m = urlStr.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

function resolveFacilityCoords(fac: NearbyFacility): { lat: number; lng: number } | null {
  const rawLat = Number(fac.lat);
  const rawLng = Number(fac.lng);
  if (isValidLatLng(rawLat, rawLng)) {
    return { lat: rawLat, lng: rawLng };
  }
  return extractCoordsFromMapUrl(fac.website);
}

function computeTravelMinutesByDistance(distanceKm: number, mode: TravelMode): number {
  if (distanceKm <= 0.05) return 1;
  if (mode === 'walking') {
    return Math.max(1, Math.round((distanceKm / 5) * 60));
  }
  if (mode === 'motorbike') {
    return Math.max(2, Math.round((distanceKm / 30) * 60) + 1);
  }
  return Math.max(2, Math.round((distanceKm / 35) * 60) + 2);
}

function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `~${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h} giờ ${m} phút` : `~${h} giờ`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const NearbyFacilitiesView: React.FC<NearbyFacilitiesViewProps> = ({
  settings,
  onOpenAdminManage,
}) => {
  const { isAdmin, currentUser, userProfile } = useAuth();
  const { showToast } = useToast();

  const primaryStation = useMemo(() => {
    const locs = settings.mapLocations || [];
    const primary = locs.find(l => l.isPrimary) || locs[0];
    if (primary && isValidLatLng(primary.lat, primary.lng)) {
      return {
        lat: Number(primary.lat),
        lng: Number(primary.lng),
        name: primary.name || settings.stationName || 'Trạm Y tế',
      };
    }
    return null;
  }, [settings.mapLocations, settings.stationName]);

  const [facilities, setFacilities] = useState<NearbyFacility[]>([]);
  const [loading, setLoading] = useState(true);

  // Public submission & edit proposal modal ("Yêu cầu thêm Cơ sở Y tế -> Lịch sử & Chỉnh sửa")
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestModalTab, setRequestModalTab] = useState<'form' | 'history'>('form');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestSuccessInfo, setRequestSuccessInfo] = useState<{
    name: string;
    mode: 'create' | 'resubmit' | 'propose_edit';
  } | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [mapsPasteLink, setMapsPasteLink] = useState('');
  const [reqLocating, setReqLocating] = useState(false);
  const [ownSubmittedDocs, setOwnSubmittedDocs] = useState<NearbyFacility[]>([]);
  const [localHistoryDocs, setLocalHistoryDocs] = useState<NearbyFacility[]>(() =>
    loadLocalNearbyFacilityHistory(null, getOrCreateDeviceId())
  );
  const [editingTarget, setEditingTarget] = useState<{
    mode: 'resubmit' | 'propose_edit';
    facility: NearbyFacility;
  } | null>(null);
  const [requestForm, setRequestForm] = useState({
    name: '',
    facilityType: 'hospital' as NearbyFacilityType,
    level: '',
    address: '',
    ward: '',
    lat: '',
    lng: '',
    phone: '',
    emergencyPhone: '',
    workingHours: '',
    is24Hours: false,
    hasEmergency: false,
    hasBhyt: true,
    services: '',
    bedCount: '',
    headName: '',
    website: '',
    notes: '',
    submittedBy: '',
  });

  const [origin, setOrigin] = useState<ReferenceOrigin | null>(() => {
    const cached = readCachedCoords();
    if (cached) {
      return {
        lat: cached.lat,
        lng: cached.lng,
        source: 'gps',
        label: 'Vị trí GPS của bạn',
      };
    }
    return null;
  });

  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('motorbike');

  // Real OSRM road metrics & selected route polyline
  const [roadMetricsMap, setRoadMetricsMap] = useState<Record<string, RoadMetric>>({});
  const [routePolylineCoords, setRoutePolylineCoords] = useState<[number, number][] | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | NearbyFacilityType>('all');
  const [only24h, setOnly24h] = useState(false);
  const [onlyEmergency, setOnlyEmergency] = useState(false);
  const [onlyBhyt, setOnlyBhyt] = useState(false);

  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [detailFacility, setDetailFacility] = useState<EnrichedFacility | null>(null);
  const [mapTileType, setMapTileType] = useState<'streets' | 'satellite'>('streets');
  const [showHealthStations, setShowHealthStations] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());


  const requestGeoLocation = useCallback(
    (recenter = false) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setGeoError('Trình duyệt không hỗ trợ định vị GPS.');
        if (primaryStation) {
          setOrigin(prev =>
            prev || {
              lat: primaryStation.lat,
              lng: primaryStation.lng,
              source: 'station',
              label: `Tọa độ ${primaryStation.name}`,
            }
          );
        }
        return;
      }

      setIsLocating(true);
      setGeoError(null);

      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          setOrigin({
            lat: coords.lat,
            lng: coords.lng,
            source: 'gps',
            label: 'Vị trí GPS của bạn',
          });
          setIsLocating(false);
          try {
            sessionStorage.setItem(GEO_SESSION_COORDS_KEY, JSON.stringify(coords));
          } catch {
            // ignore
          }
          if (recenter && mapInstanceRef.current) {
            mapInstanceRef.current.setView([coords.lat, coords.lng], 14, { animate: true });
          }
        },
        err => {
          setIsLocating(false);
          if (err.code === 1) {
            setGeoError(
              'Trình duyệt chưa cấp quyền GPS. Bạn vẫn có thể nhập tọa độ Vĩ độ / Kinh độ hoặc chọn điểm trên bản đồ để tính khoảng cách.'
            );
          } else {
            setGeoError(
              'Chưa lấy được tọa độ GPS hiện tại. Hãy bấm "Định vị lại" hoặc nhập Vĩ độ / Kinh độ.'
            );
          }
          // Fallback to primary station coordinates so distance/time is still usable immediately
          if (primaryStation) {
            setOrigin(prev =>
              prev || {
                lat: primaryStation.lat,
                lng: primaryStation.lng,
                source: 'station',
                label: `Tọa độ ${primaryStation.name} (mặc định)`,
              }
            );
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    },
    [primaryStation]
  );

  useEffect(() => {
    requestGeoLocation(false);
  }, [requestGeoLocation]);

  useEffect(() => {
    const q = query(collection(db, 'nearbyFacilities'), where('isActive', '==', true));
    const unsub = onSnapshot(
      q,
      snap => {
        setFacilities(snap.docs.map(d => ({ id: d.id, ...d.data() } as NearbyFacility)));
        setLoading(false);
      },
      error => {
        setLoading(false);
        try {
          handleFirestoreError(error, OperationType.LIST, 'nearbyFacilities');
        } catch {
          // Logged safely without crashing async snapshot listener
        }
      }
    );
    return () => unsub();
  }, []);

  // Load device/user scoped request history and subscribe realtime to user's own Firestore submissions
  useEffect(() => {
    setLocalHistoryDocs(loadLocalNearbyFacilityHistory(currentUser?.uid, deviceId));
  }, [currentUser?.uid, deviceId]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setOwnSubmittedDocs([]);
      return;
    }
    const q = query(
      collection(db, 'nearbyFacilities'),
      where('submittedByUid', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      q,
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as NearbyFacility));
        setOwnSubmittedDocs(docs);
      },
      error => {
        console.warn('Own nearbyFacilities listener:', error);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Merge local history + Firestore ownSubmittedDocs + live public approved facilities
  const requestHistoryList = useMemo(() => {
    const byId = new Map<string, NearbyFacility>();
    const livePublicMap = new Map(facilities.map(f => [f.id, f]));

    for (const item of localHistoryDocs) {
      const livePublic = livePublicMap.get(item.id);
      byId.set(item.id, livePublic ? { ...item, ...livePublic } : item);
    }

    for (const item of ownSubmittedDocs) {
      byId.set(item.id, item);
    }

    return Array.from(byId.values()).sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );
  }, [localHistoryDocs, ownSubmittedDocs, facilities]);

  const resetRequestForm = useCallback(() => {
    setEditingTarget(null);
    setRequestSuccessInfo(null);
    setRequestError(null);
    setMapsPasteLink('');
    setRequestForm({
      name: '',
      facilityType: 'hospital',
      level: '',
      address: '',
      ward: '',
      lat: origin ? origin.lat.toFixed(6) : '',
      lng: origin ? origin.lng.toFixed(6) : '',
      phone: '',
      emergencyPhone: '',
      workingHours: '',
      is24Hours: false,
      hasEmergency: false,
      hasBhyt: true,
      services: '',
      bedCount: '',
      headName: '',
      website: '',
      notes: '',
      submittedBy: userProfile?.displayName || '',
    });
  }, [origin, userProfile?.displayName]);

  const canUserEditFacility = useCallback(
    (fac: NearbyFacility) => {
      if (isAdmin) return true;
      if (currentUser && fac.submittedByUid && fac.submittedByUid === currentUser.uid) return true;
      if (fac.submitterDeviceId && fac.submitterDeviceId === deviceId) return true;
      if (localHistoryDocs.some(h => h.id === fac.id)) return true;
      return false;
    },
    [isAdmin, currentUser, deviceId, localHistoryDocs]
  );

  const openFacilityEditInModal = useCallback(
    (fac: NearbyFacility, explicitMode?: 'resubmit' | 'propose_edit') => {
      const mode: 'resubmit' | 'propose_edit' =
        explicitMode ||
        (fac.isActive || fac.approvalStatus === 'approved' ? 'propose_edit' : 'resubmit');

      if (mode === 'propose_edit' && !canUserEditFacility(fac)) {
        showToast('error', 'Không được phép', 'Bạn chỉ được đề xuất chỉnh sửa cơ sở y tế do chính bạn hoặc thiết bị của bạn đã gửi.');
        return;
      }

      const source =
        mode === 'propose_edit' && fac.pendingEditData ? fac.pendingEditData : fac;

      setEditingTarget({ mode, facility: fac });
      setRequestSuccessInfo(null);
      setRequestError(null);
      setMapsPasteLink('');
      setRequestForm({
        name: source.name || '',
        facilityType: source.facilityType || 'hospital',
        level: source.level || '',
        address: source.address || '',
        ward: source.ward || '',
        lat: Number.isFinite(Number(source.lat)) ? String(source.lat) : '',
        lng: Number.isFinite(Number(source.lng)) ? String(source.lng) : '',
        phone: source.phone || '',
        emergencyPhone: source.emergencyPhone || '',
        workingHours: source.workingHours || '',
        is24Hours: Boolean(source.is24Hours),
        hasEmergency: Boolean(source.hasEmergency),
        hasBhyt: Boolean(source.hasBhyt),
        services: source.services || '',
        bedCount:
          typeof source.bedCount === 'number' && !Number.isNaN(source.bedCount)
            ? String(source.bedCount)
            : '0',
        headName: source.headName || '',
        website: source.website || '',
        notes: source.notes || '',
        submittedBy: source.submittedBy || fac.submittedBy || userProfile?.displayName || '',
      });
      setRequestModalTab('form');
      setShowRequestModal(true);
    },
    [userProfile?.displayName, canUserEditFacility, showToast]
  );

  const handleUseStationOrigin = () => {
    if (!primaryStation) return;
    setGeoError(null);
    setOrigin({
      lat: primaryStation.lat,
      lng: primaryStation.lng,
      source: 'station',
      label: `Tọa độ ${primaryStation.name}`,
    });
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([primaryStation.lat, primaryStation.lng], 14, { animate: true });
    }
  };



  // Pre-compute baseline Haversine distances & sort order before OSRM road enrichment
  const haversineSortedFacilities = useMemo(() => {
    return facilities
      .map(fac => {
        const coords = resolveFacilityCoords(fac);
        const straightKm =
          origin && coords
            ? calculateHaversineDistance(origin.lat, origin.lng, coords.lat, coords.lng)
            : null;
        return {
          fac,
          coords,
          straightKm,
        };
      })
      .sort((a, b) => {
        if (a.straightKm !== null && b.straightKm !== null) {
          return a.straightKm - b.straightKm;
        }
        if (a.straightKm !== null) return -1;
        if (b.straightKm !== null) return 1;
        return (a.fac.order ?? 999) - (b.fac.order ?? 999) || a.fac.name.localeCompare(b.fac.name, 'vi');
      });
  }, [facilities, origin]);

  // Fetch real road distances & driving durations from OSRM Table API for up to 25 nearest facilities
  useEffect(() => {
    if (!origin || haversineSortedFacilities.length === 0) {
      setRoadMetricsMap({});
      return;
    }

    const candidates = haversineSortedFacilities
      .filter(item => item.coords !== null && item.straightKm !== null && item.straightKm <= 250)
      .slice(0, 25);

    if (candidates.length === 0) {
      setRoadMetricsMap({});
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4500);

    const fetchOsrmTable = async () => {
      try {
        const coordsParam = [
          `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`,
          ...candidates.map(c => `${c.coords!.lng.toFixed(6)},${c.coords!.lat.toFixed(6)}`),
        ].join(';');

        const url = `https://router.project-osrm.org/table/v1/driving/${coordsParam}?sources=0&annotations=distance,duration`;
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.code !== 'Ok' || !Array.isArray(data.distances?.[0]) || !Array.isArray(data.durations?.[0])) {
          return;
        }

        const distancesRow: Array<number | null> = data.distances[0];
        const durationsRow: Array<number | null> = data.durations[0];

        const nextMap: Record<string, RoadMetric> = {};
        candidates.forEach((item, idx) => {
          const distMeters = distancesRow[idx + 1];
          const durSeconds = durationsRow[idx + 1];
          if (typeof distMeters === 'number' && Number.isFinite(distMeters) && distMeters >= 0) {
            const km = Math.max(0.05, distMeters / 1000);
            const carMin =
              typeof durSeconds === 'number' && Number.isFinite(durSeconds)
                ? Math.max(1, Math.round(durSeconds / 60))
                : computeTravelMinutesByDistance(km, 'car');
            nextMap[item.fac.id] = {
              distanceKm: km,
              carMinutes: carMin,
              isRoadRoute: true,
            };
          }
        });

        setRoadMetricsMap(nextMap);
      } catch {
        // Silent graceful fallback to coordinate Haversine calculations
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    fetchOsrmTable();

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [origin, haversineSortedFacilities]);

  // Combine coordinate Haversine + OSRM road distances + mode-specific travel durations
  const enrichedFacilities: EnrichedFacility[] = useMemo(() => {
    return haversineSortedFacilities
      .map(({ fac, coords, straightKm }) => {
        const road = roadMetricsMap[fac.id];
        // Estimated road winding factor 1.25x if OSRM route not fetched yet
        const effectiveDistanceKm = road
          ? road.distanceKm
          : straightKm !== null
          ? straightKm * 1.22
          : null;

        const carMinutes =
          road && road.carMinutes > 0
            ? road.carMinutes
            : effectiveDistanceKm !== null
            ? computeTravelMinutesByDistance(effectiveDistanceKm, 'car')
            : null;

        const motorbikeMinutes =
          effectiveDistanceKm !== null
            ? computeTravelMinutesByDistance(effectiveDistanceKm, 'motorbike')
            : null;

        const walkingMinutes =
          effectiveDistanceKm !== null
            ? computeTravelMinutesByDistance(effectiveDistanceKm, 'walking')
            : null;

        const driveMinutes =
          travelMode === 'car'
            ? carMinutes
            : travelMode === 'walking'
            ? walkingMinutes
            : motorbikeMinutes;

        return {
          ...fac,
          resolvedLat: coords ? coords.lat : null,
          resolvedLng: coords ? coords.lng : null,
          straightDistanceKm: straightKm,
          distanceKm: effectiveDistanceKm,
          driveMinutes,
          carMinutes,
          motorbikeMinutes,
          walkingMinutes,
          isRoadRoute: Boolean(road?.isRoadRoute),
        };
      })
      .sort((a, b) => {
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        if (a.distanceKm !== null) return -1;
        if (b.distanceKm !== null) return 1;
        if (Boolean(a.hasEmergency) !== Boolean(b.hasEmergency)) {
          return a.hasEmergency ? -1 : 1;
        }
        return (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'vi');
      });
  }, [haversineSortedFacilities, roadMetricsMap, travelMode]);

  const filteredFacilities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedFacilities.filter(fac => {
      if (typeFilter !== 'all' && fac.facilityType !== typeFilter) return false;
      if (only24h && !fac.is24Hours) return false;
      if (onlyEmergency && !fac.hasEmergency) return false;
      if (onlyBhyt && !fac.hasBhyt) return false;
      if (q) {
        const haystack = [fac.name, fac.address, fac.ward, fac.services, fac.level, fac.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedFacilities, typeFilter, only24h, onlyEmergency, onlyBhyt, searchQuery]);

  const nearestFacility =
    origin && filteredFacilities.length > 0 && filteredFacilities[0].distanceKm !== null
      ? filteredFacilities[0]
      : null;

  // Fetch route polyline when a facility is selected
  useEffect(() => {
    if (!origin || !selectedFacilityId) {
      setRoutePolylineCoords(null);
      return;
    }

    const target = enrichedFacilities.find(f => f.id === selectedFacilityId);
    if (!target || target.resolvedLat === null || target.resolvedLng === null) {
      setRoutePolylineCoords(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4500);
    setLoadingRoute(true);

    const fetchRouteGeometry = async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng.toFixed(
          6
        )},${origin.lat.toFixed(6)};${target.resolvedLng!.toFixed(6)},${target.resolvedLat!.toFixed(
          6
        )}?overview=full&geometries=geojson`;
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) {
          setRoutePolylineCoords([
            [origin.lat, origin.lng],
            [target.resolvedLat!, target.resolvedLng!],
          ]);
          return;
        }
        const data = await resp.json();
        const route = data?.routes?.[0];
        if (route?.geometry?.coordinates && Array.isArray(route.geometry.coordinates)) {
          const latLngs: [number, number][] = route.geometry.coordinates.map(
            (pt: [number, number]) => [pt[1], pt[0]]
          );
          setRoutePolylineCoords(latLngs);

          // Also sync exact road metric for this selected facility
          if (typeof route.distance === 'number' && typeof route.duration === 'number') {
            setRoadMetricsMap(prev => ({
              ...prev,
              [target.id]: {
                distanceKm: Math.max(0.05, route.distance / 1000),
                carMinutes: Math.max(1, Math.round(route.duration / 60)),
                isRoadRoute: true,
              },
            }));
          }
        } else {
          setRoutePolylineCoords([
            [origin.lat, origin.lng],
            [target.resolvedLat!, target.resolvedLng!],
          ]);
        }
      } catch {
        setRoutePolylineCoords([
          [origin.lat, origin.lng],
          [target.resolvedLat!, target.resolvedLng!],
        ]);
      } finally {
        window.clearTimeout(timeoutId);
        setLoadingRoute(false);
      }
    };

    fetchRouteGeometry();

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [origin, selectedFacilityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up Leaflet on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
        markersLayerRef.current = null;
        routeLayerRef.current = null;
        markersMapRef.current.clear();
      }
    };
  }, []);

  // Initialize & update Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const firstValid = filteredFacilities.find(f => f.resolvedLat !== null && f.resolvedLng !== null);
    if (!firstValid && !origin) return;

    const center: [number, number] = origin
      ? [origin.lat, origin.lng]
      : firstValid
      ? [firstValid.resolvedLat!, firstValid.resolvedLng!]
      : [10.7516, 106.7024];

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center,
        zoom: 13,
        zoomControl: true,
        attributionControl: false,
      });

      const url =
        mapTileType === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      tileLayerRef.current = L.tileLayer(url, { maxZoom: 19 }).addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
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
    markersMapRef.current.clear();

    const modeLabel = TRAVEL_MODE_META[travelMode].label;

    filteredFacilities.forEach(fac => {
      if (fac.resolvedLat === null || fac.resolvedLng === null) return;
      const meta = FACILITY_TYPE_META[fac.facilityType] || FACILITY_TYPE_META.other;
      const isSelected = selectedFacilityId === fac.id;
      const pinColor = isSelected ? '#0f172a' : meta.colorHex;

      const icon = L.divIcon({
        className: 'nearby-facility-pin',
        html: `
          <div style="
            background:${pinColor};
            color:#fff;
            border-radius:50%;
            width:${isSelected ? '38px' : '32px'};
            height:${isSelected ? '38px' : '32px'};
            display:flex;
            align-items:center;
            justify-content:center;
            border:3px solid #fff;
            box-shadow:0 4px 12px rgba(0,0,0,0.4);
            font-weight:800;
            font-size:15px;
          ">✚</div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

      const marker = L.marker([fac.resolvedLat, fac.resolvedLng], { icon });
      const callNum = fac.emergencyPhone || fac.phone;

      marker.bindPopup(`
        <div style="font-family:inherit;font-size:12px;line-height:1.45;min-width:210px;">
          <div style="font-size:10px;font-weight:700;color:${meta.colorHex};text-transform:uppercase;">${escapeHtml(meta.label)}</div>
          <strong style="color:#0f172a;font-size:13px;">${escapeHtml(fac.name)}</strong><br/>
          <span style="color:#475569;">${escapeHtml(fac.address)}</span><br/>
          <span style="color:#64748b;font-size:11px;font-family:monospace;">Tọa độ: ${fac.resolvedLat.toFixed(5)}, ${fac.resolvedLng.toFixed(5)}</span><br/>
          ${
            fac.distanceKm !== null && fac.driveMinutes !== null
              ? `<span style="color:#047857;font-weight:700;">Cách ${fac.distanceKm.toFixed(1)} km · ${formatDurationMinutes(fac.driveMinutes)} (${escapeHtml(modeLabel)})</span><br/>`
              : ''
          }
          ${callNum ? `<a href="tel:${escapeHtml(callNum)}" style="color:#dc2626;font-weight:700;text-decoration:none;">☎ ${escapeHtml(callNum)}</a>` : ''}
        </div>
      `);

      marker.on('click', () => {
        setSelectedFacilityId(fac.id);
      });

      markersLayer.addLayer(marker);
      markersMapRef.current.set(fac.id, marker);
    });

    if (origin) {
      const userIcon = L.divIcon({
        className: 'nearby-user-pin',
        html: `
          <div style="
            background:#2563eb;
            color:#fff;
            border-radius:50%;
            width:22px;
            height:22px;
            display:flex;
            align-items:center;
            justify-content:center;
            box-shadow:0 0 0 6px rgba(37,99,235,0.28);
            border:3px solid #fff;
            font-size:9px;
          ">●</div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const userMarker = L.marker([origin.lat, origin.lng], { icon: userIcon });
      userMarker.bindPopup(
        `<div style="font-size:12px;"><strong>${escapeHtml(
          origin.label
        )}</strong><br/><span style="font-family:monospace;font-size:11px;">Vĩ độ: ${origin.lat.toFixed(
          5
        )} · Kinh độ: ${origin.lng.toFixed(5)}</span></div>`
      );
      markersLayer.addLayer(userMarker);
    }

    if (showHealthStations && settings.mapLocations && settings.mapLocations.length > 0) {
      settings.mapLocations.forEach(loc => {
        if (!isValidLatLng(loc.lat, loc.lng)) return;
        const isPrimaryLoc = loc.isPrimary;
        const stationIcon = L.divIcon({
          className: 'nearby-station-pin',
          html: `
            <div style="
              background:${isPrimaryLoc ? '#047857' : '#0284c7'};
              color:#fff;
              border-radius:50%;
              width:34px;
              height:34px;
              display:flex;
              align-items:center;
              justify-content:center;
              border:3px solid #fff;
              box-shadow:0 4px 12px rgba(0,0,0,0.4);
              font-weight:800;
              font-size:14px;
            ">🏥</div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const sMarker = L.marker([Number(loc.lat), Number(loc.lng)], { icon: stationIcon });
        sMarker.bindPopup(`
          <div style="font-family:inherit;font-size:12px;line-height:1.45;min-width:200px;">
            <div style="font-size:10px;font-weight:700;color:${isPrimaryLoc ? '#047857' : '#0284c7'};text-transform:uppercase;">${isPrimaryLoc ? 'Trạm Y tế Điểm Chính' : 'Trạm Y tế Điểm Phụ'}</div>
            <strong style="color:#0f172a;font-size:13px;">${escapeHtml(loc.name || 'Trạm Y tế')}</strong><br/>
            <span style="color:#475569;">${escapeHtml(loc.address || '')}</span><br/>
            ${loc.phone ? `<a href="tel:${escapeHtml(loc.phone)}" style="color:#dc2626;font-weight:700;text-decoration:none;">☎ ${escapeHtml(loc.phone)}</a>` : ''}
          </div>
        `);
        markersLayer.addLayer(sMarker);
      });
    }
  }, [filteredFacilities, origin, mapTileType, selectedFacilityId, travelMode, showHealthStations, settings.mapLocations]);

  // Draw route polyline layer whenever routePolylineCoords changes
  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    if (!routeLayer) return;
    routeLayer.clearLayers();

    if (routePolylineCoords && routePolylineCoords.length >= 2) {
      const isDirectFallback = routePolylineCoords.length === 2;
      L.polyline(routePolylineCoords, {
        color: '#2563eb',
        weight: isDirectFallback ? 3 : 4.5,
        opacity: 0.85,
        dashArray: isDirectFallback ? '8 8' : undefined,
      }).addTo(routeLayer);
    }
  }, [routePolylineCoords]);

  const getGoogleMapsUrl = (fac: EnrichedFacility) => {
    const targetLat = fac.resolvedLat ?? fac.lat;
    const targetLng = fac.resolvedLng ?? fac.lng;
    const gMode =
      travelMode === 'walking' ? 'walking' : travelMode === 'motorbike' ? 'two-wheeler' : 'driving';
    if (origin) {
      return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${targetLat},${targetLng}&travelmode=${gMode}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${targetLat},${targetLng}`;
  };

  const getAppleMapsUrl = (fac: EnrichedFacility) => {
    const targetLat = fac.resolvedLat ?? fac.lat;
    const targetLng = fac.resolvedLng ?? fac.lng;
    const dirFlg = travelMode === 'walking' ? 'w' : 'd';
    if (origin) {
      return `https://maps.apple.com/?saddr=${origin.lat},${origin.lng}&daddr=${targetLat},${targetLng}&dirflg=${dirFlg}`;
    }
    return `https://maps.apple.com/?ll=${targetLat},${targetLng}&q=${encodeURIComponent(fac.name)}`;
  };

  const focusFacilityOnMap = (fac: EnrichedFacility) => {
    setSelectedFacilityId(fac.id);
    if (mapInstanceRef.current && fac.resolvedLat !== null && fac.resolvedLng !== null) {
      if (origin) {
        const bounds = L.latLngBounds(
          [origin.lat, origin.lng],
          [fac.resolvedLat, fac.resolvedLng]
        );
        mapInstanceRef.current.fitBounds(bounds, { padding: [55, 55], maxZoom: 15, animate: true });
      } else {
        mapInstanceRef.current.setView([fac.resolvedLat, fac.resolvedLng], 15, { animate: true });
      }
      const marker = markersMapRef.current.get(fac.id);
      if (marker) marker.openPopup();
    }
  };

  const ActiveModeIcon = TRAVEL_MODE_META[travelMode].icon;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div
        data-section-title="Cơ sở Y tế lân cận"
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
            <Hospital className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Cơ Sở Y Tế Lân Cận
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {isLocating
                ? 'Đang xác định tọa độ GPS của bạn để tính khoảng cách & thời gian di chuyển...'
                : origin
                ? `${origin.label} (Vĩ độ: ${origin.lat.toFixed(5)}, Kinh độ: ${origin.lng.toFixed(5)}) · Tự động tính khoảng cách & thời gian di chuyển`
                : 'Bật GPS hoặc nhập tọa độ Vĩ độ / Kinh độ để tính khoảng cách và thời gian di chuyển đến cơ sở y tế gần nhất.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => requestGeoLocation(true)}
            disabled={isLocating}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <LocateFixed className={`w-4 h-4 ${isLocating ? 'animate-spin' : ''}`} />
            <span>{isLocating ? 'Đang định vị...' : 'Định vị GPS'}</span>
          </button>



          <button
            type="button"
            onClick={() => {
              setEditingTarget(null);
              setRequestSuccessInfo(null);
              setRequestError(null);
              setRequestModalTab('form');
              setRequestForm(prev => ({
                ...prev,
                submittedBy: prev.submittedBy || userProfile?.displayName || '',
                lat: prev.lat || (origin ? origin.lat.toFixed(6) : ''),
                lng: prev.lng || (origin ? origin.lng.toFixed(6) : ''),
              }));
              setShowRequestModal(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>
              Yêu cầu thêm Cơ sở
              {requestHistoryList.length > 0 ? ` (${requestHistoryList.length})` : ''}
            </span>
          </button>

          {isAdmin && onOpenAdminManage && (
            <button
              type="button"
              onClick={onOpenAdminManage}
              className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4" />
              <span>Quản lý (Admin)</span>
            </button>
          )}
        </div>
      </div>

      {geoError && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs sm:text-sm text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{geoError}</span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => requestGeoLocation(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              Thử định vị GPS
            </button>
          </div>
        </div>
      )}



      {/* Nearest Facility Banner */}
      {nearestFacility && (
        <div className="p-5 rounded-3xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="p-3 rounded-2xl bg-emerald-700 text-white shrink-0">
              <ActiveModeIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                <span>Cơ sở Y tế gần nhất</span>
                <span aria-hidden="true">·</span>
                <span>{FACILITY_TYPE_META[nearestFacility.facilityType]?.label}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {nearestFacility.isRoadRoute ? 'Đường bộ thực tế' : 'Ước tính theo tọa độ'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
                {nearestFacility.name}
              </h2>
              <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 tabular-nums">
                Cách{' '}
                <strong className="text-emerald-700 dark:text-emerald-300">
                  {nearestFacility.distanceKm?.toFixed(2)} km
                </strong>{' '}
                ·{' '}
                <strong className="text-slate-900 dark:text-white">
                  {nearestFacility.driveMinutes !== null
                    ? formatDurationMinutes(nearestFacility.driveMinutes)
                    : ''}
                </strong>{' '}
                ({TRAVEL_MODE_META[travelMode].label}) · {nearestFacility.address}
              </div>
              {nearestFacility.resolvedLat !== null && nearestFacility.resolvedLng !== null && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  Tọa độ cơ sở: {nearestFacility.resolvedLat.toFixed(5)},{' '}
                  {nearestFacility.resolvedLng.toFixed(5)}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {(nearestFacility.emergencyPhone || nearestFacility.phone) && (
              <a
                href={`tel:${nearestFacility.emergencyPhone || nearestFacility.phone}`}
                className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{nearestFacility.emergencyPhone || nearestFacility.phone}</span>
              </a>
            )}
            <a
              href={getGoogleMapsUrl(nearestFacility)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>Google Maps</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={() => setDetailFacility(nearestFacility)}
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs cursor-pointer whitespace-nowrap"
            >
              Chi tiết
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 sm:p-5 space-y-3.5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm tên bệnh viện, phòng khám, địa chỉ, chuyên khoa..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="md:col-span-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOnly24h(v => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                only24h
                  ? 'bg-emerald-700 border-emerald-700 text-white'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              Trực 24/7
            </button>
            <button
              type="button"
              onClick={() => setOnlyEmergency(v => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                onlyEmergency
                  ? 'bg-rose-700 border-rose-700 text-white'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              Có Cấp cứu
            </button>
            <button
              type="button"
              onClick={() => setOnlyBhyt(v => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                onlyBhyt
                  ? 'bg-blue-700 border-blue-700 text-white'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              Khám BHYT
            </button>
          </div>
        </div>

        {/* Facility Type Segmented Bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              typeFilter === 'all'
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            Tất cả ({enrichedFacilities.length})
          </button>
          {(Object.keys(FACILITY_TYPE_META) as NearbyFacilityType[]).map(typeKey => {
            const count = enrichedFacilities.filter(f => f.facilityType === typeKey).length;
            if (count === 0) return null;
            return (
              <button
                key={typeKey}
                type="button"
                onClick={() => setTypeFilter(typeKey)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  typeFilter === typeKey
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                {FACILITY_TYPE_META[typeKey].label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="p-10 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">
          Đang tải danh mục Cơ sở Y tế lân cận...
        </div>
      ) : filteredFacilities.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Hospital className="w-10 h-10 text-slate-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
              {facilities.length === 0
                ? 'Chưa có dữ liệu Cơ sở Y tế lân cận'
                : 'Không tìm thấy cơ sở y tế phù hợp bộ lọc'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {facilities.length === 0
                ? 'Quản trị viên có thể bổ sung danh sách bệnh viện, phòng khám, trung tâm cấp cứu lân cận trong mục Quản trị.'
                : 'Thử bỏ bớt điều kiện lọc hoặc tìm kiếm với từ khóa khác.'}
            </p>
          </div>
          {isAdmin && onOpenAdminManage && (
            <button
              type="button"
              onClick={onOpenAdminManage}
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
            >
              Quản lý Cơ sở Y tế lân cận
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Interactive Map */}
          <div className="lg:col-span-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums flex flex-wrap items-center gap-3">
                <span>Hiển thị {filteredFacilities.length} cơ sở y tế</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={showHealthStations}
                    onChange={e => setShowHealthStations(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                  />
                  <span>Hiển thị Trạm Y tế ({settings.mapLocations?.length || 0})</span>
                </label>
                {loadingRoute && (
                  <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                    · Đang vẽ tuyến đường...
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMapTileType('streets')}
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                    mapTileType === 'streets'
                      ? 'bg-emerald-700 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>Bản đồ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMapTileType('satellite')}
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                    mapTileType === 'satellite'
                      ? 'bg-emerald-700 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Vệ tinh</span>
                </button>
              </div>
            </div>

            <div className="h-[380px] sm:h-[500px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 relative isolate z-0">
              <div ref={mapContainerRef} className="w-full h-full" />
            </div>
          </div>

          {/* Ranked Facilities List */}
          <div className="lg:col-span-5 space-y-3 max-h-[570px] overflow-y-auto pr-0.5">
            {filteredFacilities.map((fac, idx) => {
              const meta = FACILITY_TYPE_META[fac.facilityType] || FACILITY_TYPE_META.other;
              const Icon = meta.icon;
              const isSelected = selectedFacilityId === fac.id;
              const dialPhone = fac.emergencyPhone || fac.phone;

              return (
                <div
                  key={fac.id}
                  onClick={() => focusFacilityOnMap(fac)}
                  className={`p-4 rounded-2xl border transition cursor-pointer space-y-2.5 ${
                    isSelected
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/35 border-emerald-500 shadow-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                          {origin && fac.distanceKm !== null ? `#${idx + 1} · ` : ''}
                          {meta.label}
                        </span>
                        {fac.level && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{fac.level}</span>
                          </>
                        )}
                        {fac.is24Hours && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-bold text-rose-600 dark:text-rose-400">24/7</span>
                          </>
                        )}
                        {fac.hasBhyt && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-blue-700 dark:text-blue-400">BHYT</span>
                          </>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-snug flex items-center gap-2">
                        <Icon className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                        <span className="truncate">{fac.name}</span>
                      </h3>
                    </div>

                    {fac.distanceKm !== null && fac.driveMinutes !== null && (
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                          {fac.distanceKm.toFixed(1)} km
                        </div>
                        <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          {formatDurationMinutes(fac.driveMinutes)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <p className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{fac.address}</span>
                    </p>
                    {fac.resolvedLat !== null && fac.resolvedLng !== null && (
                      <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                        Vĩ độ: {fac.resolvedLat.toFixed(5)} · Kinh độ: {fac.resolvedLng.toFixed(5)}
                      </p>
                    )}
                    {fac.services && (
                      <p className="text-slate-700 dark:text-slate-300 line-clamp-1">
                        Chuyên khoa: {fac.services}
                      </p>
                    )}
                    {fac.workingHours && (
                      <p className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span className="truncate">{fac.workingHours}</span>
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      {dialPhone && (
                        <a
                          href={`tel:${dialPhone}`}
                          onClick={e => e.stopPropagation()}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold inline-flex items-center gap-1 tabular-nums hover:bg-rose-100"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{dialPhone}</span>
                        </a>
                      )}
                      <a
                        href={getGoogleMapsUrl(fac)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1 hover:bg-slate-200"
                      >
                        <Navigation className="w-3 h-3 text-blue-600" />
                        <span>Chỉ đường</span>
                      </a>
                    </div>

                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setDetailFacility(fac);
                      }}
                      className="font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Xem chi tiết
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Facility Modal */}
      {detailFacility && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
          onClick={e => {
            if (e.target === e.currentTarget) setDetailFacility(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-emerald-700 text-white flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-100">
                  {FACILITY_TYPE_META[detailFacility.facilityType]?.label}
                  {detailFacility.level ? ` · ${detailFacility.level}` : ''}
                </div>
                <h2 className="text-lg font-extrabold leading-snug text-white">
                  {detailFacility.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailFacility(null)}
                aria-label="Đóng chi tiết"
                className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-sm">
              {detailFacility.distanceKm !== null && origin && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2.5 tabular-nums">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      {detailFacility.isRoadRoute
                        ? 'Khoảng cách đường bộ thực tế'
                        : 'Khoảng cách ước tính theo tọa độ'}
                    </span>
                    <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-200">
                      {detailFacility.distanceKm.toFixed(2)} km
                      {detailFacility.straightDistanceKm !== null
                        ? ` (Đường chim bay: ${detailFacility.straightDistanceKm.toFixed(2)} km)`
                        : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-emerald-200/70 dark:border-emerald-800/60">
                    <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/60">
                      <div className="text-[11px] text-slate-500">Xe máy</div>
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                        {detailFacility.motorbikeMinutes !== null
                          ? formatDurationMinutes(detailFacility.motorbikeMinutes)
                          : '—'}
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/60">
                      <div className="text-[11px] text-slate-500">Ô tô</div>
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                        {detailFacility.carMinutes !== null
                          ? formatDurationMinutes(detailFacility.carMinutes)
                          : '—'}
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/60">
                      <div className="text-[11px] text-slate-500">Đi bộ</div>
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                        {detailFacility.walkingMinutes !== null
                          ? formatDurationMinutes(detailFacility.walkingMinutes)
                          : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                <div className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-900 dark:text-white">Địa chỉ: </strong>
                    <span>{detailFacility.address}</span>
                    {detailFacility.ward ? <span> ({detailFacility.ward})</span> : null}
                  </div>
                </div>

                {detailFacility.phone && (
                  <div className="flex items-center gap-2.5 tabular-nums">
                    <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <strong className="text-slate-900 dark:text-white">Điện thoại: </strong>
                      <a
                        href={`tel:${detailFacility.phone}`}
                        className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
                      >
                        {detailFacility.phone}
                      </a>
                    </div>
                  </div>
                )}

                {detailFacility.emergencyPhone && (
                  <div className="flex items-center gap-2.5 tabular-nums">
                    <Ambulance className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <strong className="text-slate-900 dark:text-white">Đường dây Cấp cứu: </strong>
                      <a
                        href={`tel:${detailFacility.emergencyPhone}`}
                        className="text-rose-700 dark:text-rose-400 font-extrabold hover:underline"
                      >
                        {detailFacility.emergencyPhone}
                      </a>
                    </div>
                  </div>
                )}

                {detailFacility.workingHours && (
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-teal-600 shrink-0" />
                    <div>
                      <strong className="text-slate-900 dark:text-white">Giờ hoạt động: </strong>
                      <span>{detailFacility.workingHours}</span>
                    </div>
                  </div>
                )}

                {detailFacility.headName && (
                  <div className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <strong className="text-slate-900 dark:text-white">Người phụ trách: </strong>
                      <span>{detailFacility.headName}</span>
                    </div>
                  </div>
                )}

                {detailFacility.website && (
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                    <a
                      href={detailFacility.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                    >
                      {detailFacility.website}
                    </a>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                {detailFacility.is24Hours && (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Trực 24/7
                  </span>
                )}
                {detailFacility.hasEmergency && (
                  <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                    <ShieldCheck className="w-3.5 h-3.5" /> Tiếp nhận cấp cứu
                  </span>
                )}
                {detailFacility.hasBhyt && (
                  <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Khám BHYT
                  </span>
                )}
                {typeof detailFacility.bedCount === 'number' && detailFacility.bedCount > 0 && (
                  <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                    · Quy mô: {detailFacility.bedCount} giường
                  </span>
                )}
              </div>

              {detailFacility.services && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Chuyên khoa &amp; Dịch vụ
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                    {detailFacility.services}
                  </p>
                </div>
              )}

              {detailFacility.notes && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Hướng dẫn &amp; Ghi chú
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                    {detailFacility.notes}
                  </p>
                </div>
              )}

              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                Tọa độ cơ sở: Vĩ độ {detailFacility.resolvedLat ?? detailFacility.lat}, Kinh độ{' '}
                {detailFacility.resolvedLng ?? detailFacility.lng}
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
              {canUserEditFacility(detailFacility) ? (
                <button
                  type="button"
                  onClick={() => {
                    const target = detailFacility;
                    setDetailFacility(null);
                    openFacilityEditInModal(target, 'propose_edit');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Đề xuất chỉnh sửa</span>
                </button>
              ) : (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  * Không được đề xuất chỉnh sửa của cơ sở y tế khác.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={getGoogleMapsUrl(detailFacility)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <span>Mở Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <a
                  href={getAppleMapsUrl(detailFacility)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <span>Apple Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Public Facility Submission, Edit Proposal & History Modal (Horizontal Desktop Layout) */}
      {showRequestModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 lg:p-4 bg-slate-950/65 backdrop-blur-sm animate-in fade-in"
          onClick={e => {
            if (e.target === e.currentTarget && !submittingRequest) setShowRequestModal(false);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-6xl w-[96vw] max-h-[94vh] flex flex-col overflow-hidden">
            {/* Compact Top Header + Tab Bar */}
            <div className="px-4 sm:px-5 py-2.5 bg-emerald-700 text-white flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div className="min-w-0 flex items-center gap-2.5">
                <div className="p-1.5 rounded-xl bg-white/15 shrink-0">
                  <Hospital className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-extrabold text-white leading-tight truncate">
                    {editingTarget?.mode === 'propose_edit'
                      ? 'Yêu Cầu Chỉnh Sửa Cơ Sở Y Tế Đã Duyệt'
                      : editingTarget?.mode === 'resubmit'
                      ? 'Chỉnh Sửa & Gửi Duyệt Lại Cơ Sở Y Tế'
                      : 'Yêu Cầu Thêm Cơ Sở Y Tế Lân Cận'}
                  </h2>
                  <p className="text-[11px] text-emerald-100 leading-tight hidden sm:block">
                    Bắt buộc nhập đầy đủ thông tin (*) · Admin kiểm tra và phê duyệt trước khi hiển thị công khai.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="p-0.5 rounded-xl bg-emerald-900/50 border border-white/15 inline-flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    disabled={submittingRequest}
                    onClick={() => setRequestModalTab('form')}
                    className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer inline-flex items-center gap-1.5 ${
                      requestModalTab === 'form'
                        ? 'bg-white text-emerald-800 shadow-xs'
                        : 'text-emerald-100 hover:bg-white/10'
                    }`}
                  >
                    {editingTarget ? <Edit3 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>
                      {editingTarget?.mode === 'propose_edit'
                        ? 'Sửa & Gửi duyệt'
                        : editingTarget?.mode === 'resubmit'
                        ? 'Chỉnh sửa lại'
                        : 'Gửi yêu cầu'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={submittingRequest}
                    onClick={() => {
                      setRequestSuccessInfo(null);
                      setRequestModalTab('history');
                    }}
                    className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer inline-flex items-center gap-1.5 tabular-nums ${
                      requestModalTab === 'history'
                        ? 'bg-white text-emerald-800 shadow-xs'
                        : 'text-emerald-100 hover:bg-white/10'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Lịch sử ({requestHistoryList.length})</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={submittingRequest}
                  onClick={() => setShowRequestModal(false)}
                  className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 cursor-pointer shrink-0"
                  aria-label="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {requestModalTab === 'history' ? (
              /* Request History & Edit Management Tab */
              <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      Lịch Sử Yêu Cầu Thêm &amp; Chỉnh Sửa Cơ Sở Y Tế ({requestHistoryList.length})
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Theo dõi trạng thái xét duyệt realtime. Nếu hồ sơ chưa duyệt hoặc bị từ chối, bấm <strong>Chỉnh sửa &amp; Gửi duyệt lại</strong>. Với cơ sở đã duyệt, bấm <strong>Yêu cầu chỉnh sửa</strong> để Admin duyệt cập nhật.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      resetRequestForm();
                      setRequestModalTab('form');
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm yêu cầu mới</span>
                  </button>
                </div>

                {requestHistoryList.length === 0 ? (
                  <div className="p-10 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                    <History className="w-8 h-8 text-slate-400 mx-auto" />
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      Chưa có lịch sử yêu cầu nào từ tài khoản / thiết bị này
                    </div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Bạn có thể gửi yêu cầu thêm cơ sở y tế mới hoặc chọn nút &ldquo;Đề xuất chỉnh sửa&rdquo; khi xem chi tiết bất kỳ cơ sở nào trên bản đồ.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {requestHistoryList.map(item => {
                      const isApproved = item.isActive || item.approvalStatus === 'approved';
                      const isRejected = !isApproved && item.approvalStatus === 'rejected';
                      const isPending = !isApproved && !isRejected;
                      const isPendingEdit = isApproved && item.editStatus === 'pending_edit';
                      const isRejectedEdit = isApproved && item.editStatus === 'rejected_edit';

                      return (
                        <div
                          key={item.id}
                          className={`p-3.5 rounded-2xl border bg-white dark:bg-slate-900 flex flex-col justify-between gap-2.5 ${
                            isPendingEdit
                              ? 'border-sky-300 dark:border-sky-700 bg-sky-50/20 dark:bg-sky-950/15'
                              : isRejected || isRejectedEdit
                              ? 'border-rose-200 dark:border-rose-800 bg-rose-50/20 dark:bg-rose-950/10'
                              : isApproved
                              ? 'border-emerald-200 dark:border-emerald-800/70'
                              : 'border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/10'
                          }`}
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                                  {FACILITY_TYPE_META[item.facilityType]?.label || 'Cơ sở Y tế'}
                                  {item.level ? ` · ${item.level}` : ''}
                                </div>
                                <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug">
                                  {item.name}
                                </h4>
                              </div>

                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                                    isApproved
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                      : isRejected
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  }`}
                                >
                                  {isApproved ? (
                                    <>
                                      <CheckCircle2 className="w-3 h-3" /> Đã duyệt
                                    </>
                                  ) : isRejected ? (
                                    <>
                                      <XCircle className="w-3 h-3" /> Bị từ chối
                                    </>
                                  ) : (
                                    <>
                                      <Clock3 className="w-3 h-3" /> Chờ duyệt
                                    </>
                                  )}
                                </span>

                                {isPendingEdit && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 inline-flex items-center gap-1">
                                    <Clock3 className="w-3 h-3" /> Chờ duyệt sửa
                                  </span>
                                )}
                                {isRejectedEdit && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 inline-flex items-center gap-1">
                                    <XCircle className="w-3 h-3" /> Từ chối sửa
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-[11px] text-slate-600 dark:text-slate-400">
                              <MapPin className="w-3 h-3 inline mr-1 text-slate-400" />
                              <span>{item.address}</span>
                              {item.ward ? <span> · {item.ward}</span> : null}
                            </div>

                            {item.phone && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                                <Phone className="w-3 h-3 inline mr-1 text-emerald-600" />
                                <span>{item.phone}</span>
                                {item.emergencyPhone ? (
                                  <span className="ml-2 text-rose-600 font-semibold">
                                    Cấp cứu: {item.emergencyPhone}
                                  </span>
                                ) : null}
                              </div>
                            )}

                            {isRejected && item.rejectionReason && (
                              <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
                                <strong>Lý do từ chối:</strong> {item.rejectionReason}
                              </div>
                            )}

                            {isPendingEdit && item.pendingEditData && (
                              <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-800 dark:text-sky-300">
                                Đang chờ Admin xét duyệt bản chỉnh sửa gửi lúc{' '}
                                {new Date(item.editRequestedAt || item.pendingEditData.requestedAt).toLocaleString('vi-VN')}.
                              </div>
                            )}

                            {isRejectedEdit && item.editRejectionReason && (
                              <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
                                <strong>Lý do từ chối chỉnh sửa:</strong> {item.editRejectionReason}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              Cập nhật:{' '}
                              {new Date(item.updatedAt || item.createdAt).toLocaleString('vi-VN')}
                            </span>

                            {isPending || isRejected ? (
                              <button
                                type="button"
                                onClick={() => openFacilityEditInModal(item, 'resubmit')}
                                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Chỉnh sửa &amp; Gửi duyệt lại</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openFacilityEditInModal(item, 'propose_edit')}
                                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>
                                  {isPendingEdit || isRejectedEdit
                                    ? 'Sửa lại đề xuất chỉnh sửa'
                                    : 'Chỉnh sửa & Gửi yêu cầu sửa'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : requestSuccessInfo ? (
              <div className="p-8 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {requestSuccessInfo.mode === 'propose_edit'
                      ? 'Đã Gửi Yêu Cầu Chỉnh Sửa Thành Công!'
                      : requestSuccessInfo.mode === 'resubmit'
                      ? 'Đã Cập Nhật & Gửi Duyệt Lại Thành Công!'
                      : 'Đã Gửi Yêu Cầu Thành Công!'}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-lg mx-auto leading-relaxed">
                    {requestSuccessInfo.mode === 'propose_edit' ? (
                      <>
                        Bản đề xuất chỉnh sửa cho cơ sở{' '}
                        <strong className="text-slate-900 dark:text-white">
                          {requestSuccessInfo.name}
                        </strong>{' '}
                        đã được gửi đến Quản trị viên. Quản trị viên sẽ xem đối chiếu nội dung cũ – mới và cập nhật ngay sau khi duyệt.
                      </>
                    ) : (
                      <>
                        Hồ sơ cơ sở{' '}
                        <strong className="text-slate-900 dark:text-white">
                          {requestSuccessInfo.name}
                        </strong>{' '}
                        đã được chuyển đến Quản trị viên Trạm Y tế và đang ở trạng thái{' '}
                        <strong>Chờ duyệt</strong>.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRequestSuccessInfo(null);
                      setRequestModalTab('history');
                    }}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Xem Lịch sử &amp; Trạng thái</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => resetRequestForm()}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Gửi yêu cầu khác
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRequestModal(false)}
                    className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setRequestError(null);

                  const trimmed = {
                    name: requestForm.name.trim(),
                    level: requestForm.level.trim(),
                    address: requestForm.address.trim(),
                    ward: requestForm.ward.trim(),
                    phone: requestForm.phone.trim(),
                    emergencyPhone: requestForm.emergencyPhone.trim(),
                    workingHours: requestForm.workingHours.trim(),
                    services: requestForm.services.trim(),
                    headName: requestForm.headName.trim(),
                    website: requestForm.website.trim(),
                    notes: requestForm.notes.trim(),
                    submittedBy: requestForm.submittedBy.trim(),
                  };

                  const latNum = parseFloat(requestForm.lat.trim().replace(',', '.'));
                  const lngNum = parseFloat(requestForm.lng.trim().replace(',', '.'));
                  const bedCountRaw = requestForm.bedCount.trim();
                  const bedCountNum = bedCountRaw === '' ? NaN : Number(bedCountRaw);

                  if (
                    !trimmed.name ||
                    !trimmed.level ||
                    !trimmed.address ||
                    !trimmed.ward ||
                    !trimmed.headName ||
                    !trimmed.phone ||
                    !trimmed.emergencyPhone ||
                    !trimmed.workingHours ||
                    !trimmed.services ||
                    !trimmed.website ||
                    !trimmed.notes ||
                    !trimmed.submittedBy
                  ) {
                    const msg = 'Vui lòng điền đầy đủ TẤT CẢ các trường thông tin bắt buộc.';
                    setRequestError(msg);
                    showToast('warning', 'Thiếu thông tin bắt buộc', msg);
                    return;
                  }

                  if (!isValidLatLng(latNum, lngNum)) {
                    const msg = 'Vĩ độ / Kinh độ không hợp lệ. Vui lòng nhập hoặc lấy tọa độ GPS chính xác.';
                    setRequestError(msg);
                    showToast('warning', 'Tọa độ GPS chưa hợp lệ', msg);
                    return;
                  }

                  if (!Number.isInteger(bedCountNum) || bedCountNum < 0) {
                    const msg = 'Quy mô giường bệnh phải là số nguyên >= 0 (nhập 0 nếu không có lưu trú).';
                    setRequestError(msg);
                    showToast('warning', 'Số giường bệnh chưa hợp lệ', msg);
                    return;
                  }

                  setSubmittingRequest(true);
                  try {
                    const inputPayload = {
                      name: trimmed.name,
                      facilityType: requestForm.facilityType,
                      level: trimmed.level,
                      address: trimmed.address,
                      ward: trimmed.ward,
                      lat: latNum,
                      lng: lngNum,
                      phone: trimmed.phone,
                      emergencyPhone: trimmed.emergencyPhone,
                      workingHours: trimmed.workingHours,
                      is24Hours: requestForm.is24Hours,
                      hasEmergency: requestForm.hasEmergency,
                      hasBhyt: requestForm.hasBhyt,
                      services: trimmed.services,
                      bedCount: bedCountNum,
                      headName: trimmed.headName,
                      website: trimmed.website,
                      notes: trimmed.notes,
                      submittedBy: trimmed.submittedBy,
                    };

                    if (editingTarget?.mode === 'propose_edit') {
                      const targetFac = editingTarget.facility;
                      const { pendingEditData, editRequestedAt } =
                        await proposeApprovedFacilityEdit(targetFac.id, inputPayload);

                      const updatedHistoryEntry: NearbyFacility = {
                        ...targetFac,
                        editStatus: 'pending_edit',
                        pendingEditData,
                        editRequestedAt,
                        editRejectionReason: '',
                        updatedAt: editRequestedAt,
                        submittedByUid: targetFac.submittedByUid || currentUser?.uid || undefined,
                        submitterDeviceId: targetFac.submitterDeviceId || deviceId,
                      };
                      upsertLocalNearbyFacilityHistory(updatedHistoryEntry);
                      setLocalHistoryDocs(
                        loadLocalNearbyFacilityHistory(currentUser?.uid, deviceId)
                      );

                      await logAuditEvent(
                        'Yêu cầu chỉnh sửa Cơ sở Y tế lân cận',
                        'Cơ sở Y tế lân cận',
                        `Đề xuất chỉnh sửa cơ sở "${targetFac.name}" -> "${trimmed.name}"`,
                        {
                          uid: currentUser?.uid || 'guest',
                          name: trimmed.submittedBy || userProfile?.displayName || 'Đại diện cơ sở',
                        }
                      );

                      setRequestSuccessInfo({ name: trimmed.name, mode: 'propose_edit' });
                      setEditingTarget(null);
                      showToast(
                        'success',
                        'Đã gửi yêu cầu chỉnh sửa',
                        'Quản trị viên sẽ đối chiếu nội dung cũ - mới để phê duyệt.'
                      );
                    } else if (editingTarget?.mode === 'resubmit') {
                      const targetFac = editingTarget.facility;
                      const { updatedAt } = await resubmitPendingNearbyFacility(targetFac.id, {
                        ...inputPayload,
                        createdAt: targetFac.createdAt || new Date().toISOString(),
                        submittedByUid: targetFac.submittedByUid ?? currentUser?.uid ?? '',
                        submitterDeviceId: targetFac.submitterDeviceId || deviceId,
                      });

                      const updatedHistoryEntry: NearbyFacility = {
                        ...targetFac,
                        ...inputPayload,
                        approvalStatus: 'pending',
                        editStatus: 'none',
                        rejectionReason: '',
                        isActive: false,
                        updatedAt,
                        submittedByUid: targetFac.submittedByUid || currentUser?.uid || undefined,
                        submitterDeviceId: targetFac.submitterDeviceId || deviceId,
                      };
                      upsertLocalNearbyFacilityHistory(updatedHistoryEntry);
                      setLocalHistoryDocs(
                        loadLocalNearbyFacilityHistory(currentUser?.uid, deviceId)
                      );

                      await logAuditEvent(
                        'Chỉnh sửa & Gửi duyệt lại Cơ sở Y tế lân cận',
                        'Cơ sở Y tế lân cận',
                        `Cập nhật và gửi duyệt lại cơ sở "${trimmed.name}"`,
                        {
                          uid: currentUser?.uid || 'guest',
                          name: trimmed.submittedBy || userProfile?.displayName || 'Đại diện cơ sở',
                        }
                      );

                      setRequestSuccessInfo({ name: trimmed.name, mode: 'resubmit' });
                      setEditingTarget(null);
                      showToast(
                        'success',
                        'Đã cập nhật & gửi duyệt lại',
                        `Cơ sở "${trimmed.name}" đang chờ Quản trị viên xét duyệt.`
                      );
                    } else {
                      const created = await submitPendingNearbyFacility({
                        ...inputPayload,
                        submittedByUid: currentUser?.uid || '',
                        submitterDeviceId: deviceId,
                      });

                      const newHistoryEntry: NearbyFacility = {
                        id: created.id,
                        ...inputPayload,
                        approvalStatus: 'pending',
                        editStatus: 'none',
                        isActive: false,
                        submittedByUid: created.uid || undefined,
                        submitterDeviceId: created.deviceId,
                        createdAt: created.createdAt,
                        updatedAt: created.createdAt,
                      };
                      upsertLocalNearbyFacilityHistory(newHistoryEntry);
                      setLocalHistoryDocs(
                        loadLocalNearbyFacilityHistory(currentUser?.uid, deviceId)
                      );

                      await logAuditEvent(
                        'Đề xuất Cơ sở Y tế lân cận',
                        'Cơ sở Y tế lân cận',
                        `Gửi yêu cầu xét duyệt cơ sở "${trimmed.name}"`,
                        {
                          uid: currentUser?.uid || 'guest',
                          name: trimmed.submittedBy || userProfile?.displayName || 'Đại diện cơ sở',
                        }
                      );

                      setRequestSuccessInfo({ name: trimmed.name, mode: 'create' });
                      showToast(
                        'success',
                        'Đã gửi yêu cầu xét duyệt',
                        `Cơ sở "${trimmed.name}" đang chờ Quản trị viên duyệt.`
                      );
                    }
                  } catch (err: any) {
                    const msg =
                      err?.message || 'Không thể gửi yêu cầu. Vui lòng kiểm tra kết nối và thử lại.';
                    setRequestError(msg);
                    showToast('error', 'Gửi yêu cầu thất bại', msg);
                  } finally {
                    setSubmittingRequest(false);
                  }
                }}
                className="p-3.5 sm:p-4 space-y-2 overflow-y-auto flex-1 text-xs"
              >
                {editingTarget && (
                  <div className="px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span>
                      {editingTarget.mode === 'propose_edit' ? (
                        <>
                          <strong>Đề xuất chỉnh sửa cơ sở đã duyệt:</strong> Dữ liệu đang hiển thị của{' '}
                          <strong>{editingTarget.facility.name}</strong> vẫn được giữ nguyên cho đến khi Admin duyệt thay đổi mới.
                        </>
                      ) : (
                        <>
                          <strong>Đang chỉnh sửa hồ sơ chờ duyệt / bị từ chối:</strong>{' '}
                          <strong>{editingTarget.facility.name}</strong>. Sau khi lưu, yêu cầu sẽ được đưa lại hàng chờ duyệt.
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => resetRequestForm()}
                      className="px-2.5 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 font-bold text-sky-800 dark:text-sky-200 cursor-pointer shrink-0"
                    >
                      Chuyển sang tạo mới
                    </button>
                  </div>
                )}

                {requestError && (
                  <div className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-2 text-[11px]">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{requestError}</span>
                  </div>
                )}

                {/* Horizontal Multi-Column Grid: Designed to fit all fields cleanly on desktop without scrolling */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-x-3 gap-y-2">
                  {/* Row 1: Name, Facility Type, Level */}
                  <div className="sm:col-span-2 lg:col-span-5">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Tên Cơ sở Y tế <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.name}
                      onChange={e => setRequestForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="VD: Bệnh viện Đa khoa khu vực..., Phòng khám..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Loại hình cơ sở <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={requestForm.facilityType}
                      onChange={e =>
                        setRequestForm(prev => ({
                          ...prev,
                          facilityType: e.target.value as NearbyFacilityType,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {(Object.keys(FACILITY_TYPE_META) as NearbyFacilityType[]).map(k => (
                        <option key={k} value={k}>
                          {FACILITY_TYPE_META[k].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-4">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Tuyến / Hạng / Phân loại chuyên môn <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.level}
                      onChange={e => setRequestForm(prev => ({ ...prev, level: e.target.value }))}
                      placeholder="VD: Tuyến Tỉnh / Hạng II / Tư nhân"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  {/* Row 2: Address, WardSelector (2 selects), Head Name */}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Địa chỉ chi tiết <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.address}
                      onChange={e => setRequestForm(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Số nhà, tên đường, ấp / khu phố..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <WardSelector
                    compact
                    className="sm:col-span-2 lg:col-span-5"
                    required
                    label="Phường/Xã Khu vực"
                    value={requestForm.ward}
                    onChange={ward => setRequestForm(prev => ({ ...prev, ward }))}
                    defaultAddressHint={settings.address}
                  />

                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Người đứng đầu / Phụ trách <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.headName}
                      onChange={e => setRequestForm(prev => ({ ...prev, headName: e.target.value }))}
                      placeholder="BS. CK1 Nguyễn Văn A"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  {/* Row 3: Phone, Emergency Phone, Working Hours, Bed Count, Checkboxes */}
                  <div className="lg:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      SĐT liên hệ <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.phone}
                      onChange={e => setRequestForm(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="0293 3xxx xxx"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block font-semibold text-rose-700 dark:text-rose-400 mb-0.5 text-[11px]">
                      SĐT Cấp cứu / Trực <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.emergencyPhone}
                      onChange={e =>
                        setRequestForm(prev => ({ ...prev, emergencyPhone: e.target.value }))
                      }
                      placeholder="115 hoặc 24/7"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20 tabular-nums font-bold"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Giờ hoạt động <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.workingHours}
                      onChange={e =>
                        setRequestForm(prev => ({ ...prev, workingHours: e.target.value }))
                      }
                      placeholder="24/7 hoặc 07:00 - 20:00"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Số giường bệnh <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      required
                      value={requestForm.bedCount}
                      onChange={e => setRequestForm(prev => ({ ...prev, bedCount: e.target.value }))}
                      placeholder="0 nếu ngoại trú"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-4">
                    <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Đặc điểm tiếp nhận
                    </span>
                    <div className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={requestForm.is24Hours}
                          onChange={e =>
                            setRequestForm(prev => ({ ...prev, is24Hours: e.target.checked }))
                          }
                          className="w-3.5 h-3.5 rounded text-emerald-600"
                        />
                        <span>Trực 24/7</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={requestForm.hasEmergency}
                          onChange={e =>
                            setRequestForm(prev => ({ ...prev, hasEmergency: e.target.checked }))
                          }
                          className="w-3.5 h-3.5 rounded text-rose-600"
                        />
                        <span>Cấp cứu</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={requestForm.hasBhyt}
                          onChange={e =>
                            setRequestForm(prev => ({ ...prev, hasBhyt: e.target.checked }))
                          }
                          className="w-3.5 h-3.5 rounded text-blue-600"
                        />
                        <span>Khám BHYT</span>
                      </label>
                    </div>
                  </div>

                  {/* Row 4: Compact Horizontal GPS Bar */}
                  <div className="sm:col-span-2 lg:col-span-12 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
                    <div className="lg:col-span-2">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                        Vĩ độ (Lat) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={requestForm.lat}
                        onChange={e => setRequestForm(prev => ({ ...prev, lat: e.target.value }))}
                        placeholder="9.782600"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                        Kinh độ (Lng) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={requestForm.lng}
                        onChange={e => setRequestForm(prev => ({ ...prev, lng: e.target.value }))}
                        placeholder="105.823500"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-0.5 text-[11px]">
                        Dán link Google Maps để tự trích xuất GPS (Tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={mapsPasteLink}
                        onChange={e => {
                          const val = e.target.value;
                          setMapsPasteLink(val);
                          const extracted = extractCoordsFromMapUrl(val);
                          if (extracted) {
                            setRequestForm(prev => ({
                              ...prev,
                              lat: extracted.lat.toFixed(6),
                              lng: extracted.lng.toFixed(6),
                              website: prev.website || val,
                            }));
                            showToast('success', 'Đã tự động trích xuất tọa độ từ liên kết Google Maps');
                          }
                        }}
                        placeholder="https://www.google.com/maps/@..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                      />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-end gap-1.5">
                      {origin && (
                        <button
                          type="button"
                          onClick={() =>
                            setRequestForm(prev => ({
                              ...prev,
                              lat: origin.lat.toFixed(6),
                              lng: origin.lng.toFixed(6),
                            }))
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-100 font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Dùng điểm đang chọn
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={reqLocating}
                        onClick={() => {
                          if (!navigator.geolocation) {
                            showToast('warning', 'Trình duyệt không hỗ trợ GPS');
                            return;
                          }
                          setReqLocating(true);
                          navigator.geolocation.getCurrentPosition(
                            pos => {
                              setRequestForm(prev => ({
                                ...prev,
                                lat: pos.coords.latitude.toFixed(6),
                                lng: pos.coords.longitude.toFixed(6),
                              }));
                              setReqLocating(false);
                              showToast('success', 'Đã điền tọa độ GPS hiện tại');
                            },
                            () => {
                              setReqLocating(false);
                              showToast('warning', 'Không lấy được tọa độ GPS');
                            },
                            { enableHighAccuracy: true, timeout: 10000 }
                          );
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        <LocateFixed className={`w-3.5 h-3.5 ${reqLocating ? 'animate-spin' : ''}`} />
                        <span>{reqLocating ? 'Đang lấy...' : 'Lấy GPS hiện tại'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Row 5: Services, Website, Submitter */}
                  <div className="sm:col-span-2 lg:col-span-5">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Chuyên khoa &amp; Dịch vụ nổi bật <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.services}
                      onChange={e => setRequestForm(prev => ({ ...prev, services: e.target.value }))}
                      placeholder="Cấp cứu, Nội tổng quát, Sản phụ khoa, Xét nghiệm..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>

                  <div className="lg:col-span-4">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Website / Link Google Maps <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.website}
                      onChange={e => setRequestForm(prev => ({ ...prev, website: e.target.value }))}
                      placeholder="https://..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Họ tên &amp; SĐT người gửi <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.submittedBy}
                      onChange={e =>
                        setRequestForm(prev => ({ ...prev, submittedBy: e.target.value }))
                      }
                      placeholder="VD: Nguyễn Văn B - 0912..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>

                  {/* Row 6: Compact Notes */}
                  <div className="sm:col-span-2 lg:col-span-12">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-0.5 text-[11px]">
                      Ghi chú hướng dẫn chi tiết <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={requestForm.notes}
                      onChange={e => setRequestForm(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Cổng tiếp nhận, lối vào cấp cứu, hướng dẫn bãi đỗ xe, lưu ý cho bệnh nhân..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Footer Actions Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Tất cả mục <strong className="text-rose-600">*</strong> đều bắt buộc nhập đầy đủ trước khi gửi Admin duyệt.
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    {editingTarget && (
                      <button
                        type="button"
                        disabled={submittingRequest}
                        onClick={() => setRequestModalTab('history')}
                        className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Quay lại lịch sử</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={submittingRequest}
                      onClick={() => setShowRequestModal(false)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Đóng
                    </button>
                    <button
                      type="submit"
                      disabled={submittingRequest}
                      className="px-4 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      {submittingRequest ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {submittingRequest
                          ? 'Đang gửi...'
                          : editingTarget?.mode === 'propose_edit'
                          ? 'Gửi yêu cầu chỉnh sửa'
                          : editingTarget?.mode === 'resubmit'
                          ? 'Lưu & Gửi duyệt lại'
                          : 'Gửi yêu cầu xét duyệt'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
