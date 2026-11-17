import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin,
  ExternalLink,
  Phone,
  Clock,
  Car,
  AlertCircle,
  Layers,
  Building2,
  Map as MapIcon,
  User,
} from 'lucide-react';
import L from 'leaflet';
import { MapLocation } from '../../types';

interface StationMapSectionProps {
  locations?: MapLocation[];
  stationName?: string;
  defaultAddress?: string;
  embedded?: boolean;
}

const GEO_SESSION_COORDS_KEY = 'tyt_geo_coords';
const GEO_SESSION_PROMPTED_KEY = 'tyt_geo_prompted';

// Haversine formula to compute distance in kilometers between two GPS coordinates
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Estimate driving time in minutes based on distance
export function estimateDrivingMinutes(distanceKm: number): number {
  const speedKmH = 30;
  const minutes = Math.round((distanceKm / speedKmH) * 60) + 2;
  return Math.max(minutes, 2);
}

function readCachedSessionCoords(): { lat: number; lng: number } | null {
  try {
    const raw = sessionStorage.getItem(GEO_SESSION_COORDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    // Ignore storage read error
  }
  return null;
}

export const StationMapSection: React.FC<StationMapSectionProps> = ({
  locations = [],
  embedded = false,
}) => {
  const activeLocations = [...locations].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return 0;
  });

  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(
    activeLocations.find(l => l.isPrimary) || activeLocations[0] || null
  );

  // Symmetrical map tile mode: 'satellite' | 'streets'
  const [mapTileType, setMapTileType] = useState<'streets' | 'satellite'>('satellite');

  // Auto-acquired geolocation stored for current session
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() =>
    readCachedSessionCoords()
  );
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);

  // Leaflet map refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Request user geolocation & persist for current session
  const requestGeoLocation = useCallback((recenterMap = false) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Trình duyệt không hỗ trợ định vị GPS.');
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
        setUserLocation(coords);
        setIsLocating(false);
        try {
          sessionStorage.setItem(GEO_SESSION_COORDS_KEY, JSON.stringify(coords));
          sessionStorage.setItem(GEO_SESSION_PROMPTED_KEY, '1');
        } catch {
          // Ignore storage error
        }

        if (recenterMap && mapInstanceRef.current) {
          mapInstanceRef.current.setView([coords.lat, coords.lng], 15, { animate: true });
        }
      },
      err => {
        setIsLocating(false);
        try {
          sessionStorage.setItem(GEO_SESSION_PROMPTED_KEY, '1');
        } catch {
          // Ignore storage error
        }
        if (err.code === 1) {
          setGeoError('Vui lòng cấp quyền vị trí trình duyệt để tự động định vị.');
        } else {
          setGeoError('Chưa lấy được tọa độ GPS. Vuốt xuống để thử lại.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Automatically acquire GPS once per session (and always auto-update if already granted)
  useEffect(() => {
    let cancelled = false;

    const autoInitLocation = async () => {
      const alreadyPrompted = (() => {
        try {
          return sessionStorage.getItem(GEO_SESSION_PROMPTED_KEY) === '1';
        } catch {
          return false;
        }
      })();

      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          if (cancelled) return;
          if (status.state === 'granted') {
            requestGeoLocation(false);
            return;
          }
          if (status.state === 'denied') {
            setGeoError('Quyền định vị đang tắt trong cài đặt trình duyệt.');
            return;
          }
        } catch {
          // Permissions API not supported for geolocation -> fall through
        }
      }

      if (!alreadyPrompted && !cancelled) {
        requestGeoLocation(false);
      }
    };

    autoInitLocation();
    return () => {
      cancelled = true;
    };
  }, [requestGeoLocation]);

  // Refresh GPS automatically on pull-to-refresh event from AppShell
  useEffect(() => {
    const onRefreshLocation = () => {
      requestGeoLocation(true);
    };
    window.addEventListener('tyt:refresh-location', onRefreshLocation);
    return () => window.removeEventListener('tyt:refresh-location', onRefreshLocation);
  }, [requestGeoLocation]);

  // Keep selectedLocation updated if locations list changes
  useEffect(() => {
    if (locations.length > 0 && !selectedLocation) {
      setSelectedLocation(locations.find(l => l.isPrimary) || locations[0]);
    }
  }, [locations, selectedLocation]);

  // Clean up Leaflet instance on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
        markersLayerRef.current = null;
      }
    };
  }, []);

  // Distance calculation
  const locationsWithDistance = activeLocations.map(loc => {
    let distanceKm: number | null = null;
    let driveMinutes: number | null = null;

    if (userLocation) {
      distanceKm = calculateHaversineDistance(
        userLocation.lat,
        userLocation.lng,
        loc.lat,
        loc.lng
      );
      driveMinutes = estimateDrivingMinutes(distanceKm);
    }

    return {
      ...loc,
      distanceKm,
      driveMinutes,
    };
  });

  const sortedLocations = [...locationsWithDistance].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    if (a.distanceKm !== null && b.distanceKm !== null) {
      return a.distanceKm - b.distanceKm;
    }
    return 0;
  });

  const nearestLocation =
    userLocation && locationsWithDistance.length > 0
      ? [...locationsWithDistance].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))[0]
      : null;

  // Initialize and update Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (activeLocations.length === 0 && !userLocation) return;

    const initialCenter: [number, number] = selectedLocation
      ? [selectedLocation.lat, selectedLocation.lng]
      : userLocation
      ? [userLocation.lat, userLocation.lng]
      : [10.7516, 106.7024];

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 14,
        zoomControl: true,
        attributionControl: false,
      });

      const initialTileUrl =
        mapTileType === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      const tileLayer = L.tileLayer(initialTileUrl, { maxZoom: 19 }).addTo(map);
      const markersLayer = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
      tileLayerRef.current = tileLayer;
      markersLayerRef.current = markersLayer;
    } else if (tileLayerRef.current) {
      const newUrl =
        mapTileType === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      tileLayerRef.current.setUrl(newUrl);
    }

    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    const createStationIcon = (isPrimary: boolean, isSelected: boolean) =>
      L.divIcon({
        className: 'custom-medical-pin',
        html: `
          <div style="
            background: ${isSelected ? '#047857' : isPrimary ? '#dc2626' : '#0284c7'};
            color: white;
            border-radius: 50%;
            width: ${isSelected ? '38px' : '32px'};
            height: ${isSelected ? '38px' : '32px'};
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.45);
            border: 3px solid white;
            font-weight: bold;
            font-size: 16px;
            cursor: pointer;
          ">
            ✚
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

    activeLocations.forEach(loc => {
      const isSelected = selectedLocation && loc.id === selectedLocation.id;
      const marker = L.marker([loc.lat, loc.lng], {
        icon: createStationIcon(!!loc.isPrimary, !!isSelected),
      });

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; min-width: 180px;">
          <strong style="color: #065f46; font-size: 13px;">${loc.name}</strong><br/>
          <span style="color: #4b5563;">${loc.address}</span><br/>
          ${loc.phone ? `<span style="color: #dc2626; font-weight: 600;">ĐT: ${loc.phone}</span><br/>` : ''}
          ${loc.workingHours ? `<span style="color: #6b7280; font-size: 11px;">${loc.workingHours}</span>` : ''}
        </div>
      `);

      marker.on('click', () => {
        setSelectedLocation(loc);
      });

      markersLayer.addLayer(marker);
    });

    if (userLocation) {
      const userIcon = L.divIcon({
        className: 'user-geo-pin',
        html: `
          <div style="
            background: #2563eb;
            color: white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.3);
            border: 3px solid white;
            font-size: 10px;
          ">●</div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon });
      userMarker.bindPopup('<strong>Vị trí của bạn</strong>');
      markersLayer.addLayer(userMarker);
    }
  }, [activeLocations, selectedLocation, userLocation, mapTileType]);

  const getGoogleMapsDirUrl = (loc: MapLocation) => {
    if (userLocation) {
      return `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${loc.lat},${loc.lng}&travelmode=driving`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  };

  const getAppleMapsDirUrl = (loc: MapLocation) => {
    if (userLocation) {
      return `https://maps.apple.com/?saddr=${userLocation.lat},${userLocation.lng}&daddr=${loc.lat},${loc.lng}&dirflg=d`;
    }
    return `https://maps.apple.com/?ll=${loc.lat},${loc.lng}&q=${encodeURIComponent(loc.name)}`;
  };

  return (
    <div
      data-section-title={!embedded ? 'Bản đồ điểm y tế' : undefined}
      className={
        embedded
          ? 'p-5 sm:p-6 space-y-5'
          : 'rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden p-5 sm:p-7 space-y-5'
      }
    >
      {/* Header & Symmetrical Tile Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="min-w-0 space-y-1">
          {!embedded && (
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Mạng Lưới Điểm Y Tế &amp; GPS
            </h2>
          )}
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {isLocating
              ? 'Đang tự động xác định vị trí...'
              : userLocation
              ? 'Đã định vị tự động · Vuốt xuống để cập nhật'
              : 'Vuốt xuống để cập nhật vị trí GPS'}
          </p>
        </div>

        {/* Strictly Symmetrical 2-Button Toggle */}
        <div className="grid grid-cols-2 w-full sm:w-64 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs sm:text-sm font-semibold shrink-0">
          <button
            type="button"
            onClick={() => setMapTileType('satellite')}
            className={`px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
              mapTileType === 'satellite'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>Vệ tinh</span>
          </button>

          <button
            type="button"
            onClick={() => setMapTileType('streets')}
            className={`px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
              mapTileType === 'streets'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MapIcon className="w-4 h-4 shrink-0" />
            <span>Giao thông</span>
          </button>
        </div>
      </div>

      {/* Geolocation notice if blocked */}
      {geoError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm text-rose-800 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{geoError}</span>
        </div>
      )}

      {/* Nearest location banner */}
      {nearestLocation && (
        <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-emerald-700 text-white shrink-0">
              <Car className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                Điểm y tế gần nhất
              </span>
              <strong className="text-sm sm:text-base text-slate-900 dark:text-white block truncate">
                {nearestLocation.name}
              </strong>
              <div className="text-slate-600 dark:text-slate-300 text-xs mt-0.5 tabular-nums">
                {nearestLocation.distanceKm?.toFixed(1)} km · ~{nearestLocation.driveMinutes} phút
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
            <a
              href={getGoogleMapsDirUrl(nearestLocation)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 font-semibold text-xs flex items-center justify-center gap-1.5 transition whitespace-nowrap"
            >
              <span>Google Maps</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
            <a
              href={getAppleMapsDirUrl(nearestLocation)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 font-semibold text-xs flex items-center justify-center gap-1.5 transition whitespace-nowrap"
            >
              <span>Apple Maps</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        </div>
      )}

      {/* Map Canvas & Station List */}
      {activeLocations.length === 0 ? (
        <div className="p-10 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
            <Building2 className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
            Chưa có điểm y tế
          </h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Quản trị viên có thể bổ sung tọa độ các điểm trạm trong Bảng Quản trị.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Leaflet Map Canvas */}
          <div className="lg:col-span-2 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner h-[360px] sm:h-[440px] relative isolate z-0">
            <div ref={mapContainerRef} className="w-full h-full" />

            <div className="absolute top-3 left-3 z-10 pointer-events-none bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-semibold text-white whitespace-nowrap tabular-nums shadow-sm">
              {mapTileType === 'satellite' ? 'Vệ tinh' : 'Giao thông'} · {activeLocations.length} điểm
            </div>
          </div>

          {/* Location Selector Cards */}
          <div className="space-y-3 overflow-y-auto max-h-[440px] pr-0.5">
            {sortedLocations.map(loc => {
              const isSelected = selectedLocation && loc.id === selectedLocation.id;

              return (
                <div
                  key={loc.id}
                  onClick={() => {
                    setSelectedLocation(loc);
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.setView([loc.lat, loc.lng], 15, { animate: true });
                    }
                  }}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-500 shadow-xs'
                      : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                          loc.isPrimary ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        ✚
                      </span>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-tight truncate">
                        {loc.name}
                      </h3>
                    </div>

                    {loc.isPrimary && (
                      <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap shrink-0">
                        Điểm chính
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-slate-600 dark:text-slate-400 text-xs pl-8">
                    <p className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{loc.address}</span>
                    </p>
                    {loc.headName && (
                      <p className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 truncate">
                        <User className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">{loc.headName}</span>
                      </p>
                    )}
                    {loc.phone && (
                      <p className="flex items-center gap-1.5 tabular-nums">
                        <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{loc.phone}</span>
                      </p>
                    )}
                    {loc.workingHours && (
                      <p className="flex items-center gap-1.5 truncate">
                        <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span className="truncate">{loc.workingHours}</span>
                      </p>
                    )}
                  </div>

                  {loc.distanceKm !== null && (
                    <div className="pl-8 text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {loc.distanceKm.toFixed(1)} km · ~{loc.driveMinutes} phút
                    </div>
                  )}

                  <div className="pl-8 pt-2 flex items-center gap-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <a
                      href={getGoogleMapsDirUrl(loc)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <span>Google Maps</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <a
                      href={getAppleMapsDirUrl(loc)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="font-semibold text-slate-600 dark:text-slate-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <span>Apple Maps</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
