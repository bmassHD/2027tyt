import React, { useEffect, useMemo, useState } from 'react';

export interface DataJsonWard {
  ward_code: string;
  name: string;
  province_code: string;
}

export interface DataJsonProvince {
  province_code: string;
  name: string;
  short_name?: string;
  code?: string;
  place_type?: string;
  wards: DataJsonWard[];
}

let cachedProvincesPromise: Promise<DataJsonProvince[]> | null = null;
let cachedProvincesData: DataJsonProvince[] | null = null;

function loadProvincesFromPublicJson(): Promise<DataJsonProvince[]> {
  if (cachedProvincesData) {
    return Promise.resolve(cachedProvincesData);
  }
  if (!cachedProvincesPromise) {
    cachedProvincesPromise = fetch('/json/data.json')
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        const list = Array.isArray(data) ? (data as DataJsonProvince[]) : [];
        cachedProvincesData = list;
        return list;
      })
      .catch(() => []);
  }
  return cachedProvincesPromise;
}

function normalizeAdminText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripProvincePrefix(name: string): string {
  return name
    .replace(/^(tinh|thanh pho|tp\.?)\s+/i, '')
    .trim();
}

function findProvinceByText(
  provinces: DataJsonProvince[],
  hintText: string
): DataJsonProvince | undefined {
  const normHint = normalizeAdminText(hintText);
  if (!normHint) return undefined;
  return provinces.find(p => {
    const full = normalizeAdminText(p.name);
    const short = normalizeAdminText(p.short_name || p.name);
    const bare = stripProvincePrefix(short);
    return (
      (full && normHint.includes(full)) ||
      (short && normHint.includes(short)) ||
      (bare.length >= 3 && normHint.includes(bare))
    );
  });
}

interface WardSelectorProps {
  value: string;
  onChange: (nextWard: string) => void;
  defaultAddressHint?: string;
  required?: boolean;
  label?: string;
  className?: string;
  compact?: boolean;
}

export const WardSelector: React.FC<WardSelectorProps> = ({
  value,
  onChange,
  defaultAddressHint,
  required = false,
  label = 'Phường/Xã Khu vực',
  className = '',
  compact = false,
}) => {
  const [provinces, setProvinces] = useState<DataJsonProvince[]>(() => cachedProvincesData || []);
  const [loading, setLoading] = useState(!cachedProvincesData);
  const [loadFailed, setLoadFailed] = useState(false);

  const [selectedProvinceCode, setSelectedProvinceCode] = useState('');
  const [selectedWardCode, setSelectedWardCode] = useState('');

  useEffect(() => {
    let active = true;
    if (cachedProvincesData && cachedProvincesData.length > 0) {
      setProvinces(cachedProvincesData);
      setLoading(false);
      return;
    }
    loadProvincesFromPublicJson().then(list => {
      if (!active) return;
      setProvinces(list);
      setLoading(false);
      if (list.length === 0) {
        setLoadFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Synchronize selected province/ward when data loads or external `value` changes
  useEffect(() => {
    if (provinces.length === 0) return;

    const trimmedVal = (value || '').trim();
    if (!trimmedVal) {
      setSelectedWardCode('');
      if (!selectedProvinceCode && defaultAddressHint) {
        const matchedProv = findProvinceByText(provinces, defaultAddressHint);
        if (matchedProv) {
          setSelectedProvinceCode(matchedProv.province_code);
        }
      }
      return;
    }

    const normVal = normalizeAdminText(trimmedVal);
    // Try matching province mentioned in `value` (e.g., "Phường Ninh Kiều, Thành phố Cần Thơ")
    let matchedProv = findProvinceByText(provinces, trimmedVal);
    if (!matchedProv && selectedProvinceCode) {
      matchedProv = provinces.find(p => p.province_code === selectedProvinceCode);
    }

    if (matchedProv) {
      const matchedWard = matchedProv.wards.find(w => {
        const nw = normalizeAdminText(w.name);
        return normVal === nw || normVal.startsWith(`${nw},`) || normVal.includes(nw);
      });
      if (matchedWard) {
        setSelectedProvinceCode(matchedProv.province_code);
        setSelectedWardCode(matchedWard.ward_code);
        return;
      }
      setSelectedProvinceCode(matchedProv.province_code);
    }

    // Fallback search across all provinces if province wasn't included in legacy `ward` text
    for (const p of provinces) {
      const w = p.wards.find(item => {
        const nw = normalizeAdminText(item.name);
        return normVal === nw || normVal.startsWith(`${nw},`);
      });
      if (w) {
        setSelectedProvinceCode(p.province_code);
        setSelectedWardCode(w.ward_code);
        return;
      }
    }

    setSelectedWardCode('');
  }, [provinces, value, defaultAddressHint, selectedProvinceCode]);

  const currentProvince = useMemo(
    () => provinces.find(p => p.province_code === selectedProvinceCode),
    [provinces, selectedProvinceCode]
  );

  const wardsInProvince = useMemo(() => currentProvince?.wards || [], [currentProvince]);

  const hasUnmatchedLegacyValue = Boolean(value.trim() && !selectedWardCode && provinces.length > 0);

  const handleProvinceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pCode = e.target.value;
    setSelectedProvinceCode(pCode);
    setSelectedWardCode('');
    if (value) {
      onChange('');
    }
  };

  const handleWardChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const wCode = e.target.value;
    setSelectedWardCode(wCode);
    if (!wCode || !currentProvince) {
      onChange('');
      return;
    }
    const wardObj = wardsInProvince.find(w => w.ward_code === wCode);
    if (!wardObj) {
      onChange('');
      return;
    }
    const provLabel = currentProvince.short_name || currentProvince.name;
    const formatted = `${wardObj.name}, ${provLabel}`.slice(0, 128);
    onChange(formatted);
  };

  const inputPad = compact ? 'px-2.5 py-1.5 text-xs rounded-lg' : 'px-3 py-2 rounded-xl';
  const labelMargin = compact ? 'mb-0.5 text-[11px]' : 'mb-1';

  if (loadFailed) {
    return (
      <div className={className}>
        <label className={`block font-semibold text-slate-700 dark:text-slate-300 ${labelMargin}`}>
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
        <input
          type="text"
          required={required}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Nhập Phường/Xã, Tỉnh/Thành phố"
          className={`w-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${inputPad}`}
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <label className={`block font-semibold text-slate-700 dark:text-slate-300 ${labelMargin}`}>
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-2' : 'gap-2.5'}`}>
        <select
          required={required && !hasUnmatchedLegacyValue}
          disabled={loading}
          value={selectedProvinceCode}
          onChange={handleProvinceChange}
          aria-label="Chọn Tỉnh / Thành phố"
          className={`w-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${inputPad}`}
        >
          <option value="">
            {loading ? 'Đang tải Tỉnh / Thành phố...' : '-- Chọn Tỉnh / Thành phố --'}
          </option>
          {provinces.map(p => (
            <option key={p.province_code} value={p.province_code}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          required={required && !hasUnmatchedLegacyValue}
          disabled={loading || !currentProvince}
          value={selectedWardCode}
          onChange={handleWardChange}
          aria-label="Chọn Phường / Xã"
          className={`w-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 ${inputPad}`}
        >
          <option value="">
            {!currentProvince
              ? '-- Chọn Tỉnh/TP trước --'
              : `-- Chọn Phường/Xã (${wardsInProvince.length}) --`}
          </option>
          {wardsInProvince.map(w => (
            <option key={w.ward_code} value={w.ward_code}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {hasUnmatchedLegacyValue && (
        <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400 leading-tight">
          Hiện tại: <strong>{value}</strong> · Chọn lại Tỉnh/TP và Phường/Xã để chuẩn hóa.
        </p>
      )}
    </div>
  );
};
