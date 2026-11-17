import { ProvinceItem } from '../types';

export interface CitizenDatabaseLookupRecord {
  citizenId: string;
  displayName: string;
  dob: string;
  dobRaw: string;
  gender: 'Nam' | 'Nữ' | 'Khác' | '****';
  permanentAddress: string;
  currentAddress: string;
  fullAddress: string;
}

export interface CitizenLookupResult {
  found: boolean;
  isMasked?: boolean;
  citizenId: string;
  record?: CitizenDatabaseLookupRecord;
  error?: string;
}

export interface ParsedAdministrativeAddress {
  provinceCode: string;
  provinceName: string;
  wardCode: string;
  wardName: string;
  address: string;
}

function normalizeAdminText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripProvincePrefix(raw: string): string {
  return normalizeAdminText(raw).replace(/^(tỉnh|thành phố|tp\.?)\s+/i, '').trim();
}

function stripWardPrefix(raw: string): string {
  return normalizeAdminText(raw).replace(/^(phường|xã|thị trấn)\s+/i, '').trim();
}

/**
 * Parse a full Vietnamese address string from src/data/data.json
 * (e.g. "449A/5, Khóm Chòm Xoài, Phường Hiệp Thành, Tỉnh Cà Mau")
 * into cascading provinceCode/wardCode/specific address matching /json/data.json.
 */
export function parseAddressIntoAdministrativeParts(
  fullAddress: string,
  provincesList: ProvinceItem[]
): ParsedAdministrativeAddress {
  const cleanFull = (fullAddress || '').trim();
  if (!cleanFull) {
    return {
      provinceCode: '',
      provinceName: '',
      wardCode: '',
      wardName: '',
      address: '',
    };
  }

  const segments = cleanFull
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (segments.length >= 2 && provincesList.length > 0) {
    const rawProvince = segments[segments.length - 1];
    const targetProvNorm = normalizeAdminText(rawProvince);
    const targetProvCore = stripProvincePrefix(rawProvince);

    const matchedProvince = provincesList.find(p => {
      const pNameNorm = normalizeAdminText(p.name);
      const pShortNorm = normalizeAdminText(p.short_name || '');
      const pNameCore = stripProvincePrefix(p.name);
      const pShortCore = stripProvincePrefix(p.short_name || '');
      return (
        pNameNorm === targetProvNorm ||
        pShortNorm === targetProvNorm ||
        pNameCore === targetProvCore ||
        (pShortCore && pShortCore === targetProvCore)
      );
    });

    if (matchedProvince) {
      let matchedWard = undefined;
      let consumedEndCount = 1;

      if (segments.length >= 2) {
        const rawWard = segments[segments.length - 2];
        const targetWardNorm = normalizeAdminText(rawWard);
        const targetWardCore = stripWardPrefix(rawWard);

        matchedWard = matchedProvince.wards.find(
          w => normalizeAdminText(w.name) === targetWardNorm
        );

        if (!matchedWard) {
          matchedWard = matchedProvince.wards.find(
            w => stripWardPrefix(w.name) === targetWardCore
          );
        }

        if (matchedWard) {
          consumedEndCount = 2;
        }
      }

      const detailSegments = segments.slice(0, segments.length - consumedEndCount);
      return {
        provinceCode: matchedProvince.province_code,
        provinceName: matchedProvince.name,
        wardCode: matchedWard ? matchedWard.ward_code : '',
        wardName: matchedWard ? matchedWard.name : '',
        address: detailSegments.join(', '),
      };
    }
  }

  return {
    provinceCode: '',
    provinceName: '',
    wardCode: '',
    wardName: '',
    address: cleanFull,
  };
}

export async function lookupCitizenByCccd(
  rawCitizenId: string,
  options?: { idToken?: string | null; action?: 'lookup' | 'confirm' }
): Promise<CitizenLookupResult> {
  const digits = String(rawCitizenId || '')
    .replace(/\D/g, '')
    .trim();

  if (!digits || digits.length < 9 || digits.length > 12) {
    return {
      found: false,
      citizenId: digits,
      error: 'Số CCCD/ĐDCN phải gồm từ 9 đến 12 chữ số.',
    };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.idToken) {
    headers.Authorization = `Bearer ${options.idToken}`;
  }

  const res = await fetch('/api/citizen-lookup', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      citizenId: digits,
      action: options?.action || 'lookup',
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(data?.error || 'Không thể tra cứu cơ sở dữ liệu CCCD.');
  }

  return data as CitizenLookupResult;
}
