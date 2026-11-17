import React, { useState, useEffect, useMemo } from 'react';
import {
  Hospital,
  Plus,
  Edit,
  Trash2,
  MapPin,
  Phone,
  Clock,
  Search,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  LocateFixed,
  RefreshCw,
  Copy,
  Save,
  Ambulance,
  User,
  FileSpreadsheet,
  Upload,
  Download,
  AlertTriangle,
  Clock3,
  XCircle,
  GitCompare,
  ArrowRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { handleFirestoreError, OperationType } from '../../firebase/errorHandler';
import {
  NearbyFacility,
  NearbyFacilityEditPayload,
  NearbyFacilityType,
  SystemSettings,
} from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createNearbyFacility,
  updateNearbyFacility,
  deleteNearbyFacility,
  logAuditEvent,
} from '../../services/firebaseService';
import { WardSelector } from '../common/WardSelector';

interface NearbyFacilitiesManagerProps {
  settings: SystemSettings;
}

const FACILITY_TYPE_LABELS: Record<NearbyFacilityType, string> = {
  hospital: 'Bệnh viện',
  emergency_center: 'Trung tâm Cấp cứu',
  clinic: 'Phòng khám',
  health_station: 'Trạm Y tế',
  pharmacy: 'Nhà thuốc',
  other: 'Cơ sở Y tế khác',
};

interface FacilityFormState {
  name: string;
  facilityType: NearbyFacilityType;
  level: string;
  address: string;
  ward: string;
  lat: string;
  lng: string;
  phone: string;
  emergencyPhone: string;
  workingHours: string;
  is24Hours: boolean;
  hasEmergency: boolean;
  hasBhyt: boolean;
  services: string;
  bedCount: string;
  headName: string;
  website: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_FORM: FacilityFormState = {
  name: '',
  facilityType: 'hospital',
  level: '',
  address: '',
  ward: '',
  lat: '9.1769',
  lng: '105.1524',
  phone: '',
  emergencyPhone: '',
  workingHours: '07:00 - 17:00',
  is24Hours: false,
  hasEmergency: false,
  hasBhyt: true,
  services: '',
  bedCount: '',
  headName: '',
  website: '',
  notes: '',
  isActive: true,
};

interface ImportPreviewRow {
  rowNum: number;
  name: string;
  facilityType: NearbyFacilityType;
  level?: string;
  address: string;
  ward?: string;
  lat: number | null;
  lng: number | null;
  phone?: string;
  emergencyPhone?: string;
  workingHours?: string;
  is24Hours: boolean;
  hasEmergency: boolean;
  hasBhyt: boolean;
  services?: string;
  bedCount?: number;
  headName?: string;
  website?: string;
  notes?: string;
  isDuplicate: boolean;
}

function normalizeHeaderKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseBooleanFlexible(val: unknown, defaultValue: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const s = String(val ?? '').trim().toLowerCase();
  if (!s) return defaultValue;
  if (['1', 'co', 'có', 'yes', 'true', 'x', '✓', '24/7', '24/24'].includes(s)) return true;
  if (['0', 'khong', 'không', 'no', 'false'].includes(s)) return false;
  return defaultValue;
}

function inferFacilityType(rawType: unknown, nameStr: string): NearbyFacilityType {
  const s = normalizeHeaderKey(String(rawType || ''));
  const n = normalizeHeaderKey(nameStr);
  if (s === 'hospital' || s.includes('benh vien')) return 'hospital';
  if (s === 'emergency_center' || s.includes('cap cuu')) return 'emergency_center';
  if (s === 'clinic' || s.includes('phong kham')) return 'clinic';
  if (s === 'health_station' || s.includes('tram y te')) return 'health_station';
  if (s === 'pharmacy' || s.includes('nha thuoc') || s.includes('duoc')) return 'pharmacy';
  if (n.includes('benh vien')) return 'hospital';
  if (n.includes('cap cuu')) return 'emergency_center';
  if (n.includes('phong kham')) return 'clinic';
  if (n.includes('tram y te')) return 'health_station';
  if (n.includes('nha thuoc')) return 'pharmacy';
  return 'other';
}

function extractDirectCoords(urlStr?: string): { lat: number; lng: number } | null {
  if (!urlStr) return null;
  let m = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) m = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m) m = urlStr.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

function formatBoolDiff(val?: boolean): string {
  return val ? 'Có' : 'Không';
}

interface FacilityDiffItem {
  key: string;
  label: string;
  oldVal: string;
  newVal: string;
}

function getFacilityEditDiffs(
  current: NearbyFacility,
  proposed: NearbyFacilityEditPayload
): FacilityDiffItem[] {
  const fields: Array<{
    key: string;
    label: string;
    oldVal: string;
    newVal: string;
  }> = [
    { key: 'name', label: 'Tên cơ sở', oldVal: current.name || '—', newVal: proposed.name || '—' },
    {
      key: 'facilityType',
      label: 'Loại hình',
      oldVal: FACILITY_TYPE_LABELS[current.facilityType] || current.facilityType,
      newVal: FACILITY_TYPE_LABELS[proposed.facilityType] || proposed.facilityType,
    },
    { key: 'level', label: 'Tuyến / Hạng', oldVal: current.level || '—', newVal: proposed.level || '—' },
    { key: 'address', label: 'Địa chỉ', oldVal: current.address || '—', newVal: proposed.address || '—' },
    { key: 'ward', label: 'Phường/Xã Khu vực', oldVal: current.ward || '—', newVal: proposed.ward || '—' },
    {
      key: 'coords',
      label: 'Tọa độ GPS',
      oldVal: `${current.lat}, ${current.lng}`,
      newVal: `${proposed.lat}, ${proposed.lng}`,
    },
    { key: 'phone', label: 'SĐT liên hệ', oldVal: current.phone || '—', newVal: proposed.phone || '—' },
    {
      key: 'emergencyPhone',
      label: 'SĐT Cấp cứu',
      oldVal: current.emergencyPhone || '—',
      newVal: proposed.emergencyPhone || '—',
    },
    {
      key: 'workingHours',
      label: 'Giờ hoạt động',
      oldVal: current.workingHours || '—',
      newVal: proposed.workingHours || '—',
    },
    {
      key: 'is24Hours',
      label: 'Trực 24/7',
      oldVal: formatBoolDiff(current.is24Hours),
      newVal: formatBoolDiff(proposed.is24Hours),
    },
    {
      key: 'hasEmergency',
      label: 'Tiếp nhận Cấp cứu',
      oldVal: formatBoolDiff(current.hasEmergency),
      newVal: formatBoolDiff(proposed.hasEmergency),
    },
    {
      key: 'hasBhyt',
      label: 'Khám BHYT',
      oldVal: formatBoolDiff(current.hasBhyt),
      newVal: formatBoolDiff(proposed.hasBhyt),
    },
    {
      key: 'services',
      label: 'Chuyên khoa / Dịch vụ',
      oldVal: current.services || '—',
      newVal: proposed.services || '—',
    },
    {
      key: 'bedCount',
      label: 'Số giường bệnh',
      oldVal: current.bedCount !== undefined ? String(current.bedCount) : '—',
      newVal: String(proposed.bedCount),
    },
    {
      key: 'headName',
      label: 'Người phụ trách',
      oldVal: current.headName || '—',
      newVal: proposed.headName || '—',
    },
    { key: 'website', label: 'Website / Maps', oldVal: current.website || '—', newVal: proposed.website || '—' },
    { key: 'notes', label: 'Ghi chú', oldVal: current.notes || '—', newVal: proposed.notes || '—' },
  ];

  return fields.filter(f => f.oldVal.trim() !== f.newVal.trim());
}

export const NearbyFacilitiesManager: React.FC<NearbyFacilitiesManagerProps> = ({
  settings,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast, showConfirm } = useToast();

  const [facilities, setFacilities] = useState<NearbyFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | NearbyFacilityType>('all');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'pending' | 'approved' | 'hidden'>('all');

  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<NearbyFacility | null>(null);
  const [form, setForm] = useState<FacilityFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [syncingFromMap, setSyncingFromMap] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);

  // Reject reason modal state (for both new facility requests and edit proposals)
  const [rejectModalTarget, setRejectModalTarget] = useState<{
    facility: NearbyFacility;
    mode: 'reject_new' | 'reject_edit';
  } | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [rejectingSubmitting, setRejectingSubmitting] = useState(false);

  // Excel / JSON Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [parsingImport, setParsingImport] = useState(false);
  const [importingToDb, setImportingToDb] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'nearbyFacilities'),
      snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as NearbyFacility))
          .sort((a, b) => {
            const aNeedsReview =
              a.approvalStatus === 'pending' ||
              (a.editStatus === 'pending_edit' && Boolean(a.pendingEditData))
                ? 0
                : 1;
            const bNeedsReview =
              b.approvalStatus === 'pending' ||
              (b.editStatus === 'pending_edit' && Boolean(b.pendingEditData))
                ? 0
                : 1;
            if (aNeedsReview !== bNeedsReview) return aNeedsReview - bNeedsReview;
            return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
          });
        setFacilities(list);
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

  const pendingCount = useMemo(
    () =>
      facilities.filter(
        f =>
          f.approvalStatus === 'pending' ||
          (f.editStatus === 'pending_edit' && Boolean(f.pendingEditData))
      ).length,
    [facilities]
  );
  const approvedCount = useMemo(
    () => facilities.filter(f => f.isActive && f.approvalStatus !== 'pending').length,
    [facilities]
  );
  const hiddenCount = useMemo(
    () => facilities.filter(f => !f.isActive && f.approvalStatus !== 'pending').length,
    [facilities]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return facilities.filter(fac => {
      const hasPendingEdit = fac.editStatus === 'pending_edit' && Boolean(fac.pendingEditData);
      if (approvalFilter === 'pending' && fac.approvalStatus !== 'pending' && !hasPendingEdit) {
        return false;
      }
      if (approvalFilter === 'approved' && (!fac.isActive || fac.approvalStatus === 'pending')) {
        return false;
      }
      if (approvalFilter === 'hidden' && (fac.isActive || fac.approvalStatus === 'pending')) {
        return false;
      }
      if (typeFilter !== 'all' && fac.facilityType !== typeFilter) return false;
      if (q) {
        const hay = [
          fac.name,
          fac.address,
          fac.ward,
          fac.services,
          fac.phone,
          fac.headName,
          fac.submittedBy,
          fac.pendingEditData?.name,
          fac.pendingEditData?.address,
          fac.pendingEditData?.submittedBy,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [facilities, searchQuery, typeFilter, approvalFilter]);

  const openCreateModal = () => {
    setEditingItem(null);
    const firstLoc = settings.mapLocations?.[0];
    setForm({
      ...EMPTY_FORM,
      lat: firstLoc ? String(firstLoc.lat) : '10.7516',
      lng: firstLoc ? String(firstLoc.lng) : '106.7024',
    });
    setShowModal(true);
  };

  const openEditModal = (fac: NearbyFacility) => {
    setEditingItem(fac);
    setForm({
      name: fac.name,
      facilityType: fac.facilityType,
      level: fac.level || '',
      address: fac.address,
      ward: fac.ward || '',
      lat: String(fac.lat),
      lng: String(fac.lng),
      phone: fac.phone || '',
      emergencyPhone: fac.emergencyPhone || '',
      workingHours: fac.workingHours || '',
      is24Hours: Boolean(fac.is24Hours),
      hasEmergency: Boolean(fac.hasEmergency),
      hasBhyt: Boolean(fac.hasBhyt),
      services: fac.services || '',
      bedCount: typeof fac.bedCount === 'number' ? String(fac.bedCount) : '',
      headName: fac.headName || '',
      website: fac.website || '',
      notes: fac.notes || '',
      isActive: fac.isActive !== false,
    });
    setShowModal(true);
  };

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      showToast('warning', 'Trình duyệt không hỗ trợ GPS');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(prev => ({
          ...prev,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setLocatingGps(false);
        showToast('success', 'Đã điền tọa độ GPS hiện tại');
      },
      () => {
        setLocatingGps(false);
        showToast('warning', 'Không lấy được tọa độ GPS');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = parseFloat(form.lat);
    const lngNum = parseFloat(form.lng);
    if (!form.name.trim() || !form.address.trim() || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      showToast('warning', 'Thiếu thông tin bắt buộc', 'Vui lòng nhập Tên, Địa chỉ, Vĩ độ và Kinh độ hợp lệ.');
      return;
    }

    setSaving(true);
    try {
      const bedCountNum = form.bedCount.trim() ? parseInt(form.bedCount, 10) : undefined;
      const baseData: Omit<NearbyFacility, 'id' | 'createdAt' | 'updatedAt'> = {
        name: form.name.trim(),
        facilityType: form.facilityType,
        level: form.level.trim() || undefined,
        address: form.address.trim(),
        ward: form.ward.trim() || undefined,
        lat: latNum,
        lng: lngNum,
        phone: form.phone.trim() || undefined,
        emergencyPhone: form.emergencyPhone.trim() || undefined,
        workingHours: form.workingHours.trim() || undefined,
        is24Hours: form.is24Hours,
        hasEmergency: form.hasEmergency,
        hasBhyt: form.hasBhyt,
        services: form.services.trim() || undefined,
        bedCount: bedCountNum !== undefined && !Number.isNaN(bedCountNum) ? bedCountNum : undefined,
        headName: form.headName.trim() || undefined,
        website: form.website.trim() || undefined,
        notes: form.notes.trim() || undefined,
        approvalStatus: editingItem?.approvalStatus === 'pending' && form.isActive ? 'approved' : editingItem?.approvalStatus || 'approved',
        isActive: form.isActive,
      };

      if (editingItem) {
        await updateNearbyFacility(editingItem.id, {
          ...editingItem,
          ...baseData,
        });
        await logAuditEvent(
          'Cập nhật Cơ sở Y tế lân cận',
          'Cơ sở Y tế lân cận',
          `Cập nhật "${baseData.name}"`,
          { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
        );
        showToast('success', 'Đã cập nhật Cơ sở Y tế');
      } else {
        await createNearbyFacility(baseData);
        await logAuditEvent(
          'Thêm Cơ sở Y tế lân cận',
          'Cơ sở Y tế lân cận',
          `Thêm mới "${baseData.name}"`,
          { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
        );
        showToast('success', 'Đã thêm Cơ sở Y tế mới');
      }
      setShowModal(false);
      setEditingItem(null);
    } catch (err: any) {
      showToast('error', 'Lỗi khi lưu Cơ sở Y tế', err?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (fac: NearbyFacility) => {
    try {
      await updateNearbyFacility(fac.id, {
        ...fac,
        isActive: !fac.isActive,
      });
      showToast('info', !fac.isActive ? 'Đã hiển thị cơ sở công khai' : 'Đã tạm ẩn cơ sở');
    } catch (err: any) {
      showToast('error', 'Lỗi cập nhật trạng thái', err?.message);
    }
  };

  const handleDelete = (fac: NearbyFacility) => {
    showConfirm({
      title: 'Xóa Cơ sở Y tế lân cận?',
      message: `Bạn có chắc muốn xóa "${fac.name}" khỏi danh mục?`,
      confirmText: 'Xóa cơ sở',
      cancelText: 'Hủy',
      isDangerous: true,
      onConfirm: async () => {
        try {
          await deleteNearbyFacility(fac.id);
          await logAuditEvent(
            'Xóa Cơ sở Y tế lân cận',
            'Cơ sở Y tế lân cận',
            `Xóa "${fac.name}"`,
            { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
          );
          showToast('success', 'Đã xóa Cơ sở Y tế');
        } catch (err: any) {
          showToast('error', 'Lỗi khi xóa', err?.message);
        }
      },
    });
  };

  const handleImportFromMapLocations = async () => {
    const locs = settings.mapLocations || [];
    if (locs.length === 0) {
      showToast('info', 'Chưa có điểm nào trong Bản đồ Trạm để đồng bộ');
      return;
    }

    setSyncingFromMap(true);
    try {
      const existingNames = new Set(facilities.map(f => f.name.trim().toLowerCase()));
      let added = 0;
      for (const loc of locs) {
        if (existingNames.has(loc.name.trim().toLowerCase())) continue;
        await createNearbyFacility({
          name: loc.name,
          facilityType: 'health_station',
          level: loc.isPrimary ? 'Trạm Y tế Chính' : 'Phân trạm Y tế',
          address: loc.address,
          lat: loc.lat,
          lng: loc.lng,
          phone: loc.phone,
          workingHours: loc.workingHours || '07:30 - 17:00',
          is24Hours: (loc.workingHours || '').includes('24/'),
          hasEmergency: true,
          hasBhyt: true,
          headName: loc.headName,
          notes: loc.notes,
          isActive: true,
        });
        added++;
      }
      showToast(
        'success',
        added > 0 ? `Đã đồng bộ ${added} điểm từ Bản đồ Trạm` : 'Tất cả điểm trạm đã có sẵn trong danh mục'
      );
    } catch (err: any) {
      showToast('error', 'Lỗi đồng bộ', err?.message);
    } finally {
      setSyncingFromMap(false);
    }
  };

  const handleDownloadExcelTemplate = () => {
    const sampleData = [
      {
        'Tên cơ sở': 'Bệnh viện Đa khoa Cà Mau',
        'Loại hình': 'Bệnh viện',
        'Tuyến / Hạng': 'Bệnh viện Hạng I · Tuyến tỉnh',
        'Địa chỉ': '16 Hải Thượng Lãn Ông, Khóm 6, Phường 6, TP. Cà Mau',
        'Khu vực / Phường xã': 'Khu vực Cà Mau',
        'Vĩ độ (Lat)': 9.1745,
        'Kinh độ (Lng)': 105.1642,
        'Link Google Maps': '',
        'Số điện thoại': '0290 3831 015',
        'SĐT Cấp cứu': '0290 3831 115',
        'Giờ hoạt động': '24/7',
        'Trực 24/7': 'Có',
        'Có Cấp cứu': 'Có',
        'Khám BHYT': 'Có',
        'Chuyên khoa / Dịch vụ': 'Cấp cứu, Nội, Ngoại, Sản, Nhi, Hồi sức tích cực',
        'Số giường': 800,
        'Người phụ trách': 'Ban Giám đốc BVĐK Cà Mau',
        'Ghi chú': 'Bệnh viện tuyến cuối tỉnh tiếp nhận chuyển tuyến',
      },
      {
        'Tên cơ sở': 'Phòng khám Đa khoa Phương Nam',
        'Loại hình': 'Phòng khám',
        'Tuyến / Hạng': 'Phòng khám Đa khoa',
        'Địa chỉ': 'Số 102, Quốc lộ 1A, TP. Cà Mau',
        'Khu vực / Phường xã': 'Khu vực Cà Mau',
        'Vĩ độ (Lat)': '',
        'Kinh độ (Lng)': '',
        'Link Google Maps': 'https://maps.app.goo.gl/3LHCDJDx5xXkyoSX7',
        'Số điện thoại': '0290 3888 999',
        'SĐT Cấp cứu': '',
        'Giờ hoạt động': '07:00 - 20:00',
        'Trực 24/7': 'Không',
        'Có Cấp cứu': 'Không',
        'Khám BHYT': 'Có',
        'Chuyên khoa / Dịch vụ': 'Khám Nội, Xét nghiệm, Siêu âm, Chẩn đoán hình ảnh',
        'Số giường': 20,
        'Người phụ trách': '',
        'Ghi chú': 'Có thể để trống Vĩ độ/Kinh độ nếu đã điền Link Google Maps',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    ws['!cols'] = [
      { wch: 30 }, { wch: 16 }, { wch: 26 }, { wch: 42 }, { wch: 20 },
      { wch: 13 }, { wch: 13 }, { wch: 38 }, { wch: 16 }, { wch: 16 },
      { wch: 16 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 40 },
      { wch: 11 }, { wch: 22 }, { wch: 36 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CoSoYTe');
    XLSX.writeFile(wb, 'mau_import_co_so_y_te.xlsx');
    showToast('success', 'Đã tải file Excel mẫu', 'Điền thêm Bệnh viện / Phòng khám / Nhà thuốc rồi tải lên để import.');
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setParsingImport(true);
    try {
      let rawObjects: Array<Record<string, unknown>> = [];
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          throw new Error('File JSON phải là một mảng danh sách cơ sở y tế.');
        }
        rawObjects = parsed;
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) throw new Error('Không tìm thấy sheet dữ liệu trong file Excel.');
        rawObjects = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
          defval: '',
        });
      }

      const existingNames = new Set(facilities.map(f => f.name.trim().toLowerCase()));

      const normalizedRows: ImportPreviewRow[] = [];
      const urlsToResolve: string[] = [];

      rawObjects.forEach((raw, idx) => {
        const kv: Record<string, unknown> = {};
        Object.entries(raw).forEach(([k, v]) => {
          kv[normalizeHeaderKey(k)] = v;
        });

        const getVal = (...keys: string[]): string => {
          for (const k of keys) {
            const val = kv[k];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              return String(val).trim();
            }
          }
          return '';
        };

        const name = getVal('ten co so', 'don vi', 'ten don vi', 'name', 'ten', 'co so y te');
        if (!name) return;

        const ward = getVal('khu vuc phuong xa', 'khu vuc', 'ward', 'phuong xa').replace(/^[IVXLCDM]+\.\s*/i, '').trim();
        const address = getVal('dia chi', 'dia chi chi tiet', 'address') || (ward ? `${ward}, Tỉnh Cà Mau` : 'Đang cập nhật địa chỉ');
        const mapUrl = getVal('link google maps', 'google maps', 'google_maps', 'website', 'link ban do');
        const latStr = getVal('vi do lat', 'vi do', 'lat', 'latitude');
        const lngStr = getVal('kinh do lng', 'kinh do', 'lng', 'lon', 'longitude');

        let lat = latStr ? parseFloat(latStr.replace(',', '.')) : null;
        let lng = lngStr ? parseFloat(lngStr.replace(',', '.')) : null;
        if (lat !== null && Number.isNaN(lat)) lat = null;
        if (lng !== null && Number.isNaN(lng)) lng = null;

        if ((lat === null || lng === null) && mapUrl) {
          const direct = extractDirectCoords(mapUrl);
          if (direct) {
            lat = direct.lat;
            lng = direct.lng;
          } else {
            urlsToResolve.push(mapUrl);
          }
        }

        const facilityType = inferFacilityType(getVal('loai hinh', 'loai', 'facilitytype', 'type'), name);
        const workingHours = getVal('gio hoat dong', 'gio mo cua', 'workinghours') || (facilityType === 'health_station' ? 'Thường trực 24/7' : '07:00 - 17:00');
        const bedRaw = getVal('so giuong', 'quy mo', 'bedcount');
        const bedCount = bedRaw ? parseInt(bedRaw, 10) : undefined;

        normalizedRows.push({
          rowNum: idx + 1,
          name,
          facilityType,
          level: getVal('tuyen hang', 'tuyen', 'phan hang', 'level') || undefined,
          address,
          ward: ward || undefined,
          lat,
          lng,
          phone: getVal('so dien thoai', 'sdt', 'phone') || undefined,
          emergencyPhone: getVal('sdt cap cuu', 'so cap cuu', 'emergencyphone') || undefined,
          workingHours,
          is24Hours: parseBooleanFlexible(kv['truc 24 7'] ?? kv['is24hours'], workingHours.includes('24/')),
          hasEmergency: parseBooleanFlexible(kv['co cap cuu'] ?? kv['cap cuu'] ?? kv['hasemergency'], facilityType === 'hospital' || facilityType === 'emergency_center' || facilityType === 'health_station'),
          hasBhyt: parseBooleanFlexible(kv['kham bhyt'] ?? kv['bhyt'] ?? kv['hasbhyt'], true),
          services: getVal('chuyen khoa dich vu', 'chuyen khoa', 'dich vu', 'services') || undefined,
          bedCount: bedCount && !Number.isNaN(bedCount) ? bedCount : undefined,
          headName: getVal('nguoi phu trach', 'giam doc', 'headname') || undefined,
          website: mapUrl || undefined,
          notes: getVal('ghi chu', 'trang thai', 'notes') || undefined,
          isDuplicate: existingNames.has(name.toLowerCase()),
        });
      });

      // Resolve shortened Google Maps URLs (maps.app.goo.gl) via backend endpoint
      if (urlsToResolve.length > 0) {
        const uniqueUrls = Array.from(new Set(urlsToResolve));
        for (let i = 0; i < uniqueUrls.length; i += 100) {
          const batch = uniqueUrls.slice(i, i + 100);
          try {
            const resp = await fetch('/api/maps/resolve-urls', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls: batch }),
            });
            if (resp.ok) {
              const json = await resp.json();
              const resolvedMap = new Map<string, { lat: number | null; lng: number | null }>();
              (json.results || []).forEach((r: any) => {
                if (r?.inputUrl) {
                  resolvedMap.set(r.inputUrl, { lat: r.lat, lng: r.lng });
                }
              });
              normalizedRows.forEach(row => {
                if ((row.lat === null || row.lng === null) && row.website) {
                  const found = resolvedMap.get(row.website);
                  if (found && typeof found.lat === 'number' && typeof found.lng === 'number') {
                    row.lat = Number(found.lat.toFixed(6));
                    row.lng = Number(found.lng.toFixed(6));
                  }
                }
              });
            }
          } catch {
            // Keep rows without resolved coordinates flagged in preview
          }
        }
      }

      if (normalizedRows.length === 0) {
        showToast('warning', 'Không tìm thấy dòng dữ liệu hợp lệ', 'Kiểm tra lại tiêu đề cột "Tên cơ sở" / "Đơn vị" trong file.');
        return;
      }

      setImportRows(normalizedRows);
      setShowImportModal(true);
    } catch (err: any) {
      showToast('error', 'Không đọc được file Import', err?.message || 'Vui lòng dùng file .xlsx, .csv hoặc .json hợp lệ.');
    } finally {
      setParsingImport(false);
    }
  };

  const handleConfirmImportRows = async () => {
    const validRows = importRows.filter(r => {
      if (skipDuplicates && r.isDuplicate) return false;
      return typeof r.lat === 'number' && typeof r.lng === 'number';
    });

    if (validRows.length === 0) {
      showToast('warning', 'Không có dòng hợp lệ có tọa độ GPS để import');
      return;
    }

    setImportingToDb(true);
    try {
      let imported = 0;
      const CHUNK = 8;
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const batch = validRows.slice(i, i + CHUNK);
        await Promise.all(
          batch.map(async r => {
            await createNearbyFacility({
              name: r.name,
              facilityType: r.facilityType,
              level: r.level,
              address: r.address,
              ward: r.ward,
              lat: r.lat!,
              lng: r.lng!,
              phone: r.phone,
              emergencyPhone: r.emergencyPhone,
              workingHours: r.workingHours,
              is24Hours: r.is24Hours,
              hasEmergency: r.hasEmergency,
              hasBhyt: r.hasBhyt,
              services: r.services,
              bedCount: r.bedCount,
              headName: r.headName,
              website: r.website,
              notes: r.notes,
              isActive: true,
            });
            imported++;
          })
        );
      }
      await logAuditEvent(
        'Import Cơ sở Y tế lân cận',
        'Cơ sở Y tế lân cận',
        `Đã import ${imported} cơ sở y tế từ Excel/JSON`,
        { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
      );
      showToast('success', `Đã import thành công ${imported} cơ sở y tế`);
      setShowImportModal(false);
      setImportRows([]);
    } catch (err: any) {
      showToast('error', 'Lỗi khi lưu dữ liệu Import', err?.message);
    } finally {
      setImportingToDb(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Hospital className="w-5 h-5 text-emerald-600" />
            <span>Quản Lý Chi Tiết Cơ Sở Y Tế Lân Cận ({facilities.length})</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Quản lý Trạm Y tế, Bệnh viện, Phòng khám, Trung tâm cấp cứu với đầy đủ chuyên khoa, BHYT, tọa độ GPS và hỗ trợ Import Excel / Google Maps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadExcelTemplate}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Mẫu Excel</span>
          </button>

          <label className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{parsingImport ? 'Đang xử lý...' : 'Import Excel / JSON'}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.json"
              onChange={handleImportFileSelected}
              disabled={parsingImport}
              className="hidden"
            />
          </label>

          {(settings.mapLocations || []).length > 0 && (
            <button
              type="button"
              onClick={handleImportFromMapLocations}
              disabled={syncingFromMap}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{syncingFromMap ? 'Đang đồng bộ...' : 'Đồng bộ Điểm trạm'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm Cơ sở Y tế</span>
          </button>
        </div>
      </div>

      {/* Approval Status & Search Bar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setApprovalFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border tabular-nums ${
              approvalFilter === 'all'
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            Tất cả ({facilities.length})
          </button>
          <button
            type="button"
            onClick={() => setApprovalFilter('pending')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border inline-flex items-center gap-1.5 tabular-nums ${
              approvalFilter === 'pending'
                ? 'bg-amber-600 text-white border-amber-600'
                : pendingCount > 0
                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Clock3 className="w-3.5 h-3.5" />
            <span>Chờ duyệt ({pendingCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setApprovalFilter('approved')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border tabular-nums ${
              approvalFilter === 'approved'
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
            }`}
          >
            Đang công khai ({approvedCount})
          </button>
          <button
            type="button"
            onClick={() => setApprovalFilter('hidden')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border tabular-nums ${
              approvalFilter === 'hidden'
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            Đang ẩn / Từ chối ({hiddenCount})
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên cơ sở, địa chỉ, chuyên khoa, số điện thoại, người gửi..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as 'all' | NearbyFacilityType)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">Tất cả loại hình ({facilities.length})</option>
            {(Object.keys(FACILITY_TYPE_LABELS) as NearbyFacilityType[]).map(k => (
              <option key={k} value={k}>
                {FACILITY_TYPE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Facility Cards Grid */}
      {loading ? (
        <div className="p-10 text-center text-xs text-slate-500">Đang tải danh sách cơ sở y tế...</div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Hospital className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Chưa có Cơ sở Y tế lân cận nào
            </h4>
            <p className="text-xs text-slate-500">
              Thêm các bệnh viện, phòng khám đa khoa, trung tâm cấp cứu hoặc nhà thuốc quanh khu vực để người dân tìm cơ sở gần nhất.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer"
          >
            + Thêm cơ sở đầu tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(fac => {
            const isPending = fac.approvalStatus === 'pending';
            const isRejected = fac.approvalStatus === 'rejected';
            const hasPendingEdit =
              !isPending && fac.editStatus === 'pending_edit' && Boolean(fac.pendingEditData);
            const editDiffs =
              hasPendingEdit && fac.pendingEditData
                ? getFacilityEditDiffs(fac, fac.pendingEditData)
                : [];
            return (
              <div
                key={fac.id}
                className={`p-5 rounded-3xl bg-white dark:bg-slate-900 border shadow-xs flex flex-col justify-between space-y-3.5 ${
                  hasPendingEdit
                    ? 'border-sky-400 dark:border-sky-600 ring-2 ring-sky-400/20 bg-sky-50/20 dark:bg-sky-950/15'
                    : isPending
                    ? 'border-amber-400 dark:border-amber-600 ring-2 ring-amber-400/20 bg-amber-50/20 dark:bg-amber-950/15'
                    : fac.isActive
                    ? 'border-slate-200 dark:border-slate-800'
                    : 'border-slate-300 dark:border-slate-700 opacity-80'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        {FACILITY_TYPE_LABELS[fac.facilityType]}
                        {fac.level ? ` · ${fac.level}` : ''}
                      </div>
                      <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug mt-0.5">
                        {fac.name}
                      </h4>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isPending
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : isRejected
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : fac.isActive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {isPending
                          ? 'Chờ duyệt'
                          : isRejected
                          ? 'Đã từ chối'
                          : fac.isActive
                          ? 'Công khai'
                          : 'Đang ẩn'}
                      </span>

                      {hasPendingEdit && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 inline-flex items-center gap-1">
                          <GitCompare className="w-3 h-3" /> Yêu cầu sửa
                        </span>
                      )}
                    </div>
                  </div>

                  {fac.submittedBy && (
                    <div className="px-2.5 py-1.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-[11px] text-amber-900 dark:text-amber-200">
                      <strong>Người đề xuất:</strong> {fac.submittedBy}
                    </div>
                  )}

                  {isRejected && fac.rejectionReason && (
                    <div className="px-2.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
                      <strong>Lý do từ chối:</strong> {fac.rejectionReason}
                    </div>
                  )}

                  {/* Old vs New Diff Panel for Edit Proposals on Approved Facilities */}
                  {hasPendingEdit && fac.pendingEditData && (
                    <div className="p-2.5 rounded-2xl bg-sky-50/90 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-700 space-y-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2 font-bold text-sky-900 dark:text-sky-200">
                        <span className="inline-flex items-center gap-1">
                          <GitCompare className="w-3.5 h-3.5 text-sky-600" />
                          <span>Đối chiếu Nội dung Cũ ↔ Mới ({editDiffs.length} mục thay đổi)</span>
                        </span>
                        {fac.pendingEditData.submittedBy && (
                          <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-300 truncate max-w-[140px]">
                            Bởi: {fac.pendingEditData.submittedBy}
                          </span>
                        )}
                      </div>

                      {editDiffs.length === 0 ? (
                        <div className="text-sky-800 dark:text-sky-300">
                          Nội dung đề xuất trùng khớp hoàn toàn với dữ liệu đang công khai.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                          {editDiffs.map(diff => (
                            <div
                              key={diff.key}
                              className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-sky-200/80 dark:border-sky-800 space-y-1"
                            >
                              <div className="font-bold text-slate-700 dark:text-slate-200 text-[10px] uppercase tracking-wide">
                                {diff.label}
                              </div>
                              <div className="text-rose-700 dark:text-rose-400 bg-rose-50/70 dark:bg-rose-950/30 px-2 py-1 rounded-lg break-words">
                                <span className="font-bold mr-1">Cũ:</span>
                                <span className="line-through opacity-85">{diff.oldVal}</span>
                              </div>
                              <div className="text-emerald-800 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/30 px-2 py-1 rounded-lg font-semibold break-words flex items-start gap-1">
                                <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-emerald-600" />
                                <span>
                                  <strong className="mr-1">Mới:</strong>
                                  {diff.newVal}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>{fac.address}</span>
                  </p>

                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 font-mono text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between tabular-nums">
                    <span>Lat: {fac.lat}</span>
                    <span>Lng: {fac.lng}</span>
                  </div>

                  <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                    {fac.phone && (
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>ĐT: {fac.phone}</span>
                      </div>
                    )}
                    {fac.emergencyPhone && (
                      <div className="flex items-center gap-1.5 tabular-nums text-rose-700 dark:text-rose-400 font-bold">
                        <Ambulance className="w-3.5 h-3.5 shrink-0" />
                        <span>Cấp cứu: {fac.emergencyPhone}</span>
                      </div>
                    )}
                    {fac.workingHours && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span className="truncate">{fac.workingHours}</span>
                      </div>
                    )}
                    {fac.headName && (
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">{fac.headName}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                    {fac.is24Hours && <span className="text-rose-600 dark:text-rose-400">· Trực 24/7</span>}
                    {fac.hasEmergency && <span className="text-amber-700 dark:text-amber-400">· Cấp cứu</span>}
                    {fac.hasBhyt && <span className="text-blue-700 dark:text-blue-400">· BHYT</span>}
                    {fac.bedCount !== undefined ? (
                      <span className="text-slate-500 tabular-nums">· {fac.bedCount} giường</span>
                    ) : null}
                  </div>

                  {fac.services && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                      Chuyên khoa: {fac.services}
                    </p>
                  )}
                </div>

                {hasPendingEdit && fac.pendingEditData && (
                  <div className="pt-2 border-t border-sky-200/80 dark:border-sky-800/60 flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={async () => {
                        const proposed = fac.pendingEditData!;
                        try {
                          await updateNearbyFacility(fac.id, {
                            ...fac,
                            name: proposed.name,
                            facilityType: proposed.facilityType,
                            level: proposed.level,
                            address: proposed.address,
                            ward: proposed.ward,
                            lat: proposed.lat,
                            lng: proposed.lng,
                            phone: proposed.phone,
                            emergencyPhone: proposed.emergencyPhone,
                            workingHours: proposed.workingHours,
                            is24Hours: proposed.is24Hours,
                            hasEmergency: proposed.hasEmergency,
                            hasBhyt: proposed.hasBhyt,
                            services: proposed.services,
                            bedCount: proposed.bedCount,
                            headName: proposed.headName,
                            website: proposed.website,
                            notes: proposed.notes,
                            submittedBy: proposed.submittedBy || fac.submittedBy,
                            approvalStatus: 'approved',
                            isActive: true,
                            editStatus: 'none',
                            pendingEditData: undefined,
                            editRequestedAt: undefined,
                            editRejectionReason: undefined,
                          });
                          await logAuditEvent(
                            'Duyệt chỉnh sửa Cơ sở Y tế lân cận',
                            'Cơ sở Y tế lân cận',
                            `Áp dụng nội dung chỉnh sửa mới cho "${fac.name}" -> "${proposed.name}"`,
                            { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
                          );
                          showToast('success', 'Đã duyệt & cập nhật nội dung mới', proposed.name);
                        } catch (err: any) {
                          showToast('error', 'Duyệt chỉnh sửa thất bại', err?.message);
                        }
                      }}
                      className="flex-1 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Duyệt chỉnh sửa</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectReasonInput('');
                        setRejectModalTarget({ facility: fac, mode: 'reject_edit' });
                      }}
                      className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Từ chối sửa</span>
                    </button>
                  </div>
                )}

                {isPending && (
                  <div className="pt-2 border-t border-amber-200/70 dark:border-amber-800/50 flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await updateNearbyFacility(fac.id, {
                            ...fac,
                            approvalStatus: 'approved',
                            rejectionReason: undefined,
                            isActive: true,
                          });
                          await logAuditEvent(
                            'Duyệt Cơ sở Y tế lân cận',
                            'Cơ sở Y tế lân cận',
                            `Phê duyệt công khai cơ sở "${fac.name}"`,
                            { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
                          );
                          showToast('success', 'Đã duyệt & công khai cơ sở', fac.name);
                        } catch (err: any) {
                          showToast('error', 'Duyệt thất bại', err?.message);
                        }
                      }}
                      className="flex-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Duyệt &amp; Công khai</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectReasonInput('');
                        setRejectModalTarget({ facility: fac, mode: 'reject_new' });
                      }}
                      className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Từ chối</span>
                    </button>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${fac.lat},${fac.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-slate-500 hover:text-emerald-600 inline-flex items-center gap-1"
                  >
                    <span>Google Maps</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <div className="flex items-center gap-1">
                    {!isPending && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (isRejected) {
                            await updateNearbyFacility(fac.id, {
                              ...fac,
                              approvalStatus: 'approved',
                              rejectionReason: undefined,
                              isActive: true,
                            });
                            showToast('success', 'Đã duyệt lại và công khai cơ sở');
                          } else {
                            await handleToggleActive(fac);
                          }
                        }}
                        className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                        title={
                          isRejected
                            ? 'Duyệt & Công khai lại'
                            : fac.isActive
                            ? 'Ẩn khỏi trang công khai'
                            : 'Hiển thị công khai'
                        }
                      >
                        {fac.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditModal(fac)}
                      className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      title="Chỉnh sửa chi tiết"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(fac)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                      title="Xóa cơ sở"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detailed Create / Edit Modal */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Hospital className="w-5 h-5 text-emerald-600" />
                <span>
                  {editingItem ? 'Cập Nhật Chi Tiết Cơ Sở Y Tế' : 'Thêm Cơ Sở Y Tế Lân Cận Mới'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tên Cơ sở Y tế *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ví dụ: Bệnh viện Đa khoa Quận 7, Phòng khám Đa khoa..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Loại hình *
                  </label>
                  <select
                    value={form.facilityType}
                    onChange={e =>
                      setForm(prev => ({ ...prev, facilityType: e.target.value as NearbyFacilityType }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {(Object.keys(FACILITY_TYPE_LABELS) as NearbyFacilityType[]).map(k => (
                      <option key={k} value={k}>
                        {FACILITY_TYPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tuyến / Phân hạng
                  </label>
                  <input
                    type="text"
                    value={form.level}
                    onChange={e => setForm(prev => ({ ...prev, level: e.target.value }))}
                    placeholder="Tuyến Quận/Huyện, Bệnh viện Hạng II, Tư nhân..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Địa chỉ chi tiết *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.address}
                    onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Số nhà, tên đường, phường/xã, quận/huyện..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <WardSelector
                  className="sm:col-span-2"
                  label="Phường/Xã Khu vực"
                  value={form.ward}
                  onChange={ward => setForm(prev => ({ ...prev, ward }))}
                  defaultAddressHint={settings.address}
                />

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Người phụ trách / Giám đốc
                  </label>
                  <input
                    type="text"
                    value={form.headName}
                    onChange={e => setForm(prev => ({ ...prev, headName: e.target.value }))}
                    placeholder="BS. CKII Nguyễn Văn A..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Coordinates */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Tọa độ GPS (để tính khoảng cách gần nhất) *
                  </span>
                  <button
                    type="button"
                    onClick={handleUseCurrentGps}
                    disabled={locatingGps}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <LocateFixed className={`w-3 h-3 ${locatingGps ? 'animate-spin' : ''}`} />
                    <span>{locatingGps ? 'Đang lấy GPS...' : 'Lấy tọa độ hiện tại'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Vĩ độ (Latitude) *
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      required
                      value={form.lat}
                      onChange={e => setForm(prev => ({ ...prev, lat: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Kinh độ (Longitude) *
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      required
                      value={form.lng}
                      onChange={e => setForm(prev => ({ ...prev, lng: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Contacts & Hours */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Số điện thoại tổng đài
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="02xx xxxx xxxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-rose-700 dark:text-rose-400 mb-1">
                    Số Cấp cứu riêng
                  </label>
                  <input
                    type="text"
                    value={form.emergencyPhone}
                    onChange={e => setForm(prev => ({ ...prev, emergencyPhone: e.target.value }))}
                    placeholder="115 hoặc số trực cấp cứu"
                    className="w-full px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20 tabular-nums font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Giờ hoạt động
                  </label>
                  <input
                    type="text"
                    value={form.workingHours}
                    onChange={e => setForm(prev => ({ ...prev, workingHours: e.target.value }))}
                    placeholder="24/7 hoặc 07:00 - 20:00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>

              {/* Capabilities Checkboxes */}
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.is24Hours}
                    onChange={e => setForm(prev => ({ ...prev, is24Hours: e.target.checked }))}
                    className="w-4 h-4 rounded text-emerald-600"
                  />
                  <span>Trực 24/7</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.hasEmergency}
                    onChange={e => setForm(prev => ({ ...prev, hasEmergency: e.target.checked }))}
                    className="w-4 h-4 rounded text-rose-600"
                  />
                  <span>Tiếp nhận Cấp cứu</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.hasBhyt}
                    onChange={e => setForm(prev => ({ ...prev, hasBhyt: e.target.checked }))}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  <span>Khám BHYT</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded text-emerald-600"
                  />
                  <span>Hiển thị công khai</span>
                </label>
              </div>

              {/* Specialty & Capacity */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Chuyên khoa &amp; Dịch vụ nổi bật
                  </label>
                  <input
                    type="text"
                    value={form.services}
                    onChange={e => setForm(prev => ({ ...prev, services: e.target.value }))}
                    placeholder="Cấp cứu, Nội tổng quát, Sản phụ khoa, Nhi, Chẩn đoán hình ảnh..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Quy mô (giường bệnh)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.bedCount}
                    onChange={e => setForm(prev => ({ ...prev, bedCount: e.target.value }))}
                    placeholder="150"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Website / Cổng thông tin
                </label>
                <input
                  type="url"
                  value={form.website}
                  onChange={e => setForm(prev => ({ ...prev, website: e.target.value }))}
                  placeholder="https://benhvien..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ghi chú hướng dẫn chi tiết
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Cổng cấp cứu nằm ở mặt đường..., có bãi đỗ xe cấp cứu 24/7..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{editingItem ? 'Lưu thay đổi' : 'Thêm cơ sở'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel / JSON Import Preview Modal */}
      {showImportModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="space-y-0.5">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  <span>Xem Trước Dữ Liệu Import ({importRows.length} dòng)</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hệ thống tự động trích xuất tọa độ từ cột Vĩ độ/Kinh độ hoặc liên kết Google Maps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex flex-wrap items-center gap-3 tabular-nums">
                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                  Hợp lệ có GPS: {importRows.filter(r => r.lat !== null && r.lng !== null && (!skipDuplicates || !r.isDuplicate)).length}
                </span>
                <span className="text-amber-700 dark:text-amber-400 font-semibold">
                  Trùng tên: {importRows.filter(r => r.isDuplicate).length}
                </span>
                <span className="text-rose-700 dark:text-rose-400 font-semibold">
                  Thiếu GPS: {importRows.filter(r => r.lat === null || r.lng === null).length}
                </span>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={e => setSkipDuplicates(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600"
                />
                <span>Bỏ qua cơ sở đã trùng tên trong CSDL</span>
              </label>
            </div>

            <div className="p-4 sm:p-6 overflow-auto flex-1">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 uppercase">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Tên cơ sở / Đơn vị</th>
                    <th className="py-2 pr-3">Loại hình</th>
                    <th className="py-2 pr-3">SĐT</th>
                    <th className="py-2 pr-3">Tọa độ GPS</th>
                    <th className="py-2">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {importRows.map(row => {
                    const hasCoords = row.lat !== null && row.lng !== null;
                    return (
                      <tr key={row.rowNum} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 pr-3 tabular-nums text-slate-400">{row.rowNum}</td>
                        <td className="py-2 pr-3">
                          <div className="font-bold text-slate-900 dark:text-white">{row.name}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-xs">{row.address}</div>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {FACILITY_TYPE_LABELS[row.facilityType]}
                        </td>
                        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                          {row.emergencyPhone || row.phone || '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-[11px] tabular-nums whitespace-nowrap">
                          {hasCoords ? `${row.lat}, ${row.lng}` : 'Chưa có GPS'}
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          {!hasCoords ? (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5" /> Thiếu tọa độ
                            </span>
                          ) : row.isDuplicate && skipDuplicates ? (
                            <span className="text-amber-600 font-semibold">Sẽ bỏ qua (trùng)</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={handleConfirmImportRows}
                disabled={importingToDb}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {importingToDb ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{importingToDb ? 'Đang import...' : 'Xác nhận Import vào CSDL'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Request / Reject Edit Reason Modal */}
      {rejectModalTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
          onClick={e => {
            if (e.target === e.currentTarget && !rejectingSubmitting) setRejectModalTarget(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-3.5 bg-rose-600 text-white flex items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold flex items-center gap-2">
                <XCircle className="w-4 h-4" />
                <span>
                  {rejectModalTarget.mode === 'reject_edit'
                    ? 'Từ Chối Yêu Cầu Chỉnh Sửa'
                    : 'Từ Chối Yêu Cầu Thêm Cơ Sở'}
                </span>
              </h3>
              <button
                type="button"
                disabled={rejectingSubmitting}
                onClick={() => setRejectModalTarget(null)}
                className="text-white/80 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={async e => {
                e.preventDefault();
                const target = rejectModalTarget.facility;
                const reason = rejectReasonInput.trim();
                setRejectingSubmitting(true);
                try {
                  if (rejectModalTarget.mode === 'reject_edit') {
                    await updateNearbyFacility(target.id, {
                      ...target,
                      editStatus: 'rejected_edit',
                      editRejectionReason:
                        reason || 'Nội dung chỉnh sửa đề xuất chưa phù hợp hoặc cần xác minh thêm.',
                    });
                    await logAuditEvent(
                      'Từ chối chỉnh sửa Cơ sở Y tế lân cận',
                      'Cơ sở Y tế lân cận',
                      `Từ chối yêu cầu sửa cơ sở "${target.name}"${reason ? ` (${reason})` : ''}`,
                      { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
                    );
                    showToast('info', 'Đã từ chối đề xuất chỉnh sửa', target.name);
                  } else {
                    await updateNearbyFacility(target.id, {
                      ...target,
                      approvalStatus: 'rejected',
                      rejectionReason: reason || 'Hồ sơ chưa đầy đủ thông tin xác minh.',
                      isActive: false,
                    });
                    await logAuditEvent(
                      'Từ chối Cơ sở Y tế lân cận',
                      'Cơ sở Y tế lân cận',
                      `Từ chối yêu cầu cơ sở "${target.name}"${reason ? ` (${reason})` : ''}`,
                      { uid: currentUser?.uid || 'admin', name: userProfile?.displayName || 'Admin' }
                    );
                    showToast('info', 'Đã từ chối yêu cầu thêm cơ sở', target.name);
                  }
                  setRejectModalTarget(null);
                  setRejectReasonInput('');
                } catch (err: any) {
                  showToast('error', 'Thao tác thất bại', err?.message);
                } finally {
                  setRejectingSubmitting(false);
                }
              }}
              className="p-5 space-y-3 text-xs"
            >
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                {rejectModalTarget.mode === 'reject_edit' ? (
                  <>
                    Thông tin đang hiển thị của <strong>{rejectModalTarget.facility.name}</strong> vẫn được giữ nguyên. Người gửi sẽ nhìn thấy trạng thái <strong>Từ chối chỉnh sửa</strong> và lý do bên dưới để chỉnh sửa lại.
                  </>
                ) : (
                  <>
                    Cơ sở <strong>{rejectModalTarget.facility.name}</strong> sẽ được chuyển sang trạng thái <strong>Bị từ chối</strong>. Người gửi có thể chỉnh sửa và gửi duyệt lại.
                  </>
                )}
              </p>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Lý do từ chối (tùy chọn)
                </label>
                <textarea
                  rows={3}
                  value={rejectReasonInput}
                  onChange={e => setRejectReasonInput(e.target.value)}
                  placeholder="VD: Số điện thoại cấp cứu chưa chính xác, tọa độ GPS chưa khớp địa chỉ..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={rejectingSubmitting}
                  onClick={() => setRejectModalTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={rejectingSubmitting}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {rejectingSubmitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  <span>Xác nhận từ chối</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
