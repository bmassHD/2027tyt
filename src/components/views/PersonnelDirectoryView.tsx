import React, { useMemo, useState } from 'react';
import {
  Users,
  Building2,
  UserPlus,
  Search,
  Download,
  FileSpreadsheet,
  Network,
  Edit,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Phone,
  CheckCircle2,
  Save,
  RefreshCw,
  X,
  Table,
  LayoutList,
  RotateCcw,
} from 'lucide-react';
import {
  OrgChartConfig,
  OrgChartDepartment,
  OrgChartMember,
  SystemSettings,
  UserProfile,
} from '../../types';
import { updateSystemSettings, logAuditEvent } from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatPhoneNumber } from '../../utils/phoneUtils';
import { RevealOnScroll } from '../common/RevealOnScroll';
import {
  createDefaultOrgChart,
  DEFAULT_ORG_CHART,
  exportOrgChartWorkbook,
} from '../../data/defaultOrgChart';
import {
  OrgRoleKey,
  cloneOrgChartConfig,
  findMatchingUserForMember,
  maskCccdForPublic,
  normalizeCccd,
  syncMemberToUserAccount,
  syncUsersIntoOrgChart,
} from '../../services/orgPersonnelSyncService';

interface PersonnelDirectoryViewProps {
  settings: SystemSettings;
  settingsLoaded?: boolean;
  users?: UserProfile[];
  embeddedInAdmin?: boolean;
  onOpenOrgChart?: () => void;
  onRefreshUsers?: () => void;
}

type DirectoryTab = 'personnel' | 'departments';
type PersonnelDisplayMode = 'table' | 'grouped';
type RoleTierFilter = 'all' | 'leadership' | 'head' | 'deputy' | 'staff';

interface FlattenedPersonnelRow {
  id: string;
  unitType: 'leadership' | 'department';
  unitId: string; // 'leadership' | dept.id
  unitName: string;
  unitOrder: number;
  roleKey: OrgRoleKey;
  roleLabel: string;
  roleTier: 'leadership' | 'head' | 'deputy' | 'staff';
  member: OrgChartMember;
}

interface MemberFormState {
  mode: 'add' | 'edit';
  originalUnitId?: string;
  originalRoleKey?: OrgRoleKey;
  memberId: string;
  unitId: string; // 'leadership' | dept.id
  roleKey: OrgRoleKey;
  fullName: string;
  cccd: string;
  position: string;
  professionalTitle: string;
  phone: string;
  notes: string;
  linkedUid?: string;
  isSyncedFromUser?: boolean;
}

interface DepartmentFormState {
  mode: 'add' | 'edit';
  deptId: string;
  name: string;
  description: string;
}

const ROLE_DEFAULT_POSITIONS: Record<OrgRoleKey, string> = {
  director: 'Giám đốc',
  deputy_director: 'Phó Giám đốc',
  head: 'Trưởng khoa',
  deputy: 'Phó khoa',
  staff: 'Nhân viên',
};

const ROLE_LABELS: Record<OrgRoleKey, string> = {
  director: 'Giám đốc',
  deputy_director: 'Phó Giám đốc',
  head: 'Trưởng khoa / phòng',
  deputy: 'Phó khoa / phòng',
  staff: 'Nhân viên',
};

const ROLE_TEXT_COLORS: Record<OrgRoleKey, string> = {
  director: 'text-emerald-700 dark:text-emerald-400',
  deputy_director: 'text-teal-700 dark:text-teal-400',
  head: 'text-sky-700 dark:text-sky-400',
  deputy: 'text-indigo-700 dark:text-indigo-400',
  staff: 'text-slate-700 dark:text-slate-300',
};

function createNewId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function formatDepartmentLabel(name: string, index: number): string {
  const trimmed = name.trim();
  if (/^\d+\s*[.\-_:]/.test(trimmed)) return trimmed;
  return `${index + 1}. ${trimmed}`;
}

function escapeCsvCell(value: string): string {
  const safe = value.replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function buildDisplayNoteText(member: OrgChartMember): string {
  const parts: string[] = [];
  if (member.isSyncedFromUser) {
    parts.push('Đã đồng bộ');
  }
  if (member.notes?.trim()) {
    parts.push(member.notes.trim());
  }
  return parts.join(' · ');
}

export const PersonnelDirectoryView: React.FC<PersonnelDirectoryViewProps> = ({
  settings,
  settingsLoaded = true,
  users = [],
  embeddedInAdmin = false,
  onOpenOrgChart,
  onRefreshUsers,
}) => {
  const { currentUser, userProfile, isAdmin, isStaff } = useAuth();
  const { showToast, showConfirm } = useToast();

  const [activeTab, setActiveTab] = useState<DirectoryTab>('personnel');
  const [displayMode, setDisplayMode] = useState<PersonnelDisplayMode>('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [roleTierFilter, setRoleTierFilter] = useState<RoleTierFilter>('all');
  const [expandedDeptIds, setExpandedDeptIds] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [syncingFromUsers, setSyncingFromUsers] = useState(false);

  const [memberForm, setMemberForm] = useState<MemberFormState | null>(null);
  const [deptForm, setDeptForm] = useState<DepartmentFormState | null>(null);

  const canViewFullCccd = isAdmin || isStaff;

  const hasPersistedOrgData = useMemo(() => {
    const raw = settings.orgChart;
    if (!raw) return false;
    return Boolean(
      raw.director?.fullName?.trim() ||
        (Array.isArray(raw.deputyDirectors) && raw.deputyDirectors.length > 0) ||
        (Array.isArray(raw.departments) && raw.departments.length > 0)
    );
  }, [settings.orgChart]);

  const orgChart: OrgChartConfig = useMemo(() => {
    const raw = settings.orgChart;
    if (!hasPersistedOrgData) {
      return DEFAULT_ORG_CHART;
    }
    return {
      director: raw?.director,
      deputyDirectors: Array.isArray(raw?.deputyDirectors) ? raw.deputyDirectors : [],
      departments: Array.isArray(raw?.departments) ? raw.departments : [],
      excludedSyncedUids: Array.isArray(raw?.excludedSyncedUids) ? raw.excludedSyncedUids : undefined,
      updatedAt: raw?.updatedAt,
    };
  }, [settings.orgChart, hasPersistedOrgData]);

  const formatVisibleCccd = (cccd?: string): string => {
    const clean = normalizeCccd(cccd);
    if (!clean) return '';
    return canViewFullCccd ? clean : maskCccdForPublic(clean);
  };

  // Flatten all members from orgChart into structured directory rows
  const allPersonnelRows: FlattenedPersonnelRow[] = useMemo(() => {
    const rows: FlattenedPersonnelRow[] = [];

    if (orgChart.director?.fullName?.trim()) {
      rows.push({
        id: orgChart.director.id || 'director',
        unitType: 'leadership',
        unitId: 'leadership',
        unitName: 'Ban Giám đốc',
        unitOrder: 0,
        roleKey: 'director',
        roleLabel: ROLE_LABELS.director,
        roleTier: 'leadership',
        member: orgChart.director,
      });
    }

    orgChart.deputyDirectors.forEach((dd, idx) => {
      if (!dd.fullName?.trim()) return;
      rows.push({
        id: dd.id || `dd_${idx}`,
        unitType: 'leadership',
        unitId: 'leadership',
        unitName: 'Ban Giám đốc',
        unitOrder: 0,
        roleKey: 'deputy_director',
        roleLabel: ROLE_LABELS.deputy_director,
        roleTier: 'leadership',
        member: dd,
      });
    });

    orgChart.departments.forEach((dept, deptIdx) => {
      const deptLabel = formatDepartmentLabel(dept.name || `Khoa/Phòng #${deptIdx + 1}`, deptIdx);

      if (dept.head?.fullName?.trim()) {
        rows.push({
          id: dept.head.id || `head_${dept.id}`,
          unitType: 'department',
          unitId: dept.id,
          unitName: deptLabel,
          unitOrder: deptIdx + 1,
          roleKey: 'head',
          roleLabel: ROLE_LABELS.head,
          roleTier: 'head',
          member: dept.head,
        });
      }

      (dept.deputies || []).forEach((dep, depIdx) => {
        if (!dep.fullName?.trim()) return;
        rows.push({
          id: dep.id || `dep_${dept.id}_${depIdx}`,
          unitType: 'department',
          unitId: dept.id,
          unitName: deptLabel,
          unitOrder: deptIdx + 1,
          roleKey: 'deputy',
          roleLabel: ROLE_LABELS.deputy,
          roleTier: 'deputy',
          member: dep,
        });
      });

      (dept.staff || []).forEach((st, stIdx) => {
        if (!st.fullName?.trim()) return;
        rows.push({
          id: st.id || `st_${dept.id}_${stIdx}`,
          unitType: 'department',
          unitId: dept.id,
          unitName: deptLabel,
          unitOrder: deptIdx + 1,
          roleKey: 'staff',
          roleLabel: ROLE_LABELS.staff,
          roleTier: 'staff',
          member: st,
        });
      });
    });

    return rows;
  }, [orgChart]);

  // Summary metrics
  const stats = useMemo(() => {
    const leadershipCount =
      (orgChart.director?.fullName?.trim() ? 1 : 0) +
      orgChart.deputyDirectors.filter(d => d.fullName?.trim()).length;

    let managerCount = 0;
    let staffCount = 0;
    let syncedCount = 0;

    if (orgChart.director?.fullName?.trim() && orgChart.director.isSyncedFromUser) syncedCount++;
    orgChart.deputyDirectors.forEach(d => {
      if (d.fullName?.trim() && d.isSyncedFromUser) syncedCount++;
    });

    orgChart.departments.forEach(dept => {
      if (dept.head?.fullName?.trim()) {
        managerCount += 1;
        if (dept.head.isSyncedFromUser) syncedCount++;
      }
      (dept.deputies || []).forEach(p => {
        if (p.fullName?.trim()) {
          managerCount += 1;
          if (p.isSyncedFromUser) syncedCount++;
        }
      });
      (dept.staff || []).forEach(s => {
        if (s.fullName?.trim()) {
          staffCount += 1;
          if (s.isSyncedFromUser) syncedCount++;
        }
      });
    });

    return {
      totalMembers: leadershipCount + managerCount + staffCount,
      leadershipCount,
      managerCount,
      departmentCount: orgChart.departments.length,
      syncedCount,
    };
  }, [orgChart]);

  // Filtered personnel rows
  const filteredPersonnel = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allPersonnelRows.filter(row => {
      if (unitFilter !== 'all' && row.unitId !== unitFilter) return false;
      if (roleTierFilter !== 'all' && row.roleTier !== roleTierFilter) return false;
      if (!q) return true;
      const haystack = [
        row.member.fullName,
        canViewFullCccd ? row.member.cccd || '' : '',
        row.member.position,
        row.member.professionalTitle,
        row.member.phone || '',
        row.member.notes || '',
        row.member.isSyncedFromUser ? 'đã đồng bộ da dong bo' : '',
        row.unitName,
        row.roleLabel,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allPersonnelRows, unitFilter, roleTierFilter, searchTerm, canViewFullCccd]);

  // Grouped personnel by unit
  const groupedPersonnel = useMemo(() => {
    const groups = new Map<
      string,
      {
        unitId: string;
        unitName: string;
        unitType: 'leadership' | 'department';
        description?: string;
        rows: FlattenedPersonnelRow[];
      }
    >();

    if (unitFilter === 'all' || unitFilter === 'leadership') {
      const leadershipRows = filteredPersonnel.filter(r => r.unitId === 'leadership');
      if (leadershipRows.length > 0 || (!searchTerm.trim() && roleTierFilter === 'all')) {
        groups.set('leadership', {
          unitId: 'leadership',
          unitName: 'Ban Giám đốc',
          unitType: 'leadership',
          description: 'Lãnh đạo điều hành chung toàn bộ hoạt động Trạm Y tế',
          rows: leadershipRows,
        });
      }
    }

    orgChart.departments.forEach((dept, idx) => {
      if (unitFilter !== 'all' && unitFilter !== dept.id) return;
      const deptRows = filteredPersonnel.filter(r => r.unitId === dept.id);
      if (deptRows.length > 0 || (!searchTerm.trim() && roleTierFilter === 'all')) {
        groups.set(dept.id, {
          unitId: dept.id,
          unitName: formatDepartmentLabel(dept.name, idx),
          unitType: 'department',
          description: dept.description,
          rows: deptRows,
        });
      }
    });

    return Array.from(groups.values());
  }, [filteredPersonnel, orgChart.departments, unitFilter, searchTerm, roleTierFilter]);

  // Filtered departments list for Departments tab
  const filteredDepartments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orgChart.departments
      .map((dept, index) => ({ dept, index }))
      .filter(({ dept }) => {
        if (!q) return true;
        const haystack = [
          dept.name,
          dept.description || '',
          dept.head?.fullName || '',
          dept.head?.professionalTitle || '',
          ...(dept.deputies || []).flatMap(p => [p.fullName, p.professionalTitle, p.phone || '']),
          ...(dept.staff || []).flatMap(s => [s.fullName, s.professionalTitle, s.phone || '']),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
  }, [orgChart.departments, searchTerm]);

  const persistOrgChart = async (
    nextChart: OrgChartConfig,
    auditAction: string,
    auditDetail: string,
    successTitle?: string
  ) => {
    setSaving(true);
    try {
      const payload: OrgChartConfig = {
        ...nextChart,
        updatedAt: new Date().toISOString(),
      };
      await updateSystemSettings({
        orgChart: payload,
        updatedAt: new Date().toISOString(),
      });
      await logAuditEvent(auditAction, 'Nhân lực & Khoa phòng', auditDetail, {
        uid: currentUser?.uid || 'admin',
        name: userProfile?.displayName || 'Admin',
      });
      if (successTitle) {
        showToast('success', successTitle);
      }
      return true;
    } catch (err: any) {
      showToast('error', 'Không thể lưu dữ liệu vào hệ thống', err?.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const getEditableBaseChart = (): OrgChartConfig =>
    hasPersistedOrgData ? cloneOrgChartConfig(orgChart) : createDefaultOrgChart();

  const handleApplyDefaultStructure = async () => {
    await persistOrgChart(
      createDefaultOrgChart(),
      'Khởi tạo Sơ đồ nhân lực mặc định',
      'Lưu Ban Giám đốc và 5 Khoa/Phòng tiêu chuẩn vào Firestore',
      'Đã lưu cấu trúc 5 Khoa/Phòng mặc định'
    );
  };

  const handleSyncFromUserAccounts = async () => {
    if (!isAdmin) return;
    if (!users || users.length === 0) {
      showToast('info', 'Chưa có tài khoản người dùng nào để đồng bộ');
      return;
    }

    setSyncingFromUsers(true);
    try {
      const baseChart = getEditableBaseChart();
      const result = syncUsersIntoOrgChart(baseChart, users, { ignoreExclusions: true });

      if (!result.changed) {
        showToast(
          'info',
          'Dữ liệu đã đồng bộ',
          'Toàn bộ tài khoản cán bộ/nhân viên đã khớp với danh sách Nhân lực & Khoa phòng.'
        );
        return;
      }

      const ok = await persistOrgChart(
        result.nextChart,
        'Đồng bộ Nhân lực từ Tài khoản người dùng',
        `Thêm mới ${result.addedCount} · Cập nhật ${result.updatedCount} nhân sự từ danh sách Tài khoản`,
        `Đồng bộ thành công: +${result.addedCount} mới, ${result.updatedCount} cập nhật`
      );
      if (ok) {
        onRefreshUsers?.();
      }
    } finally {
      setSyncingFromUsers(false);
    }
  };

  const handleExportExcel = () => {
    exportOrgChartWorkbook(orgChart, 'quan_ly_nhan_luc_khoa_phong.xlsx');
    showToast('success', 'Đã xuất bảng Nhân lực & Khoa phòng ra Excel (6 sheet)');
  };

  const handleExportCsv = () => {
    const header = [
      'STT',
      'Họ và tên',
      'Số CCCD',
      'Đơn vị / Khoa phòng',
      'Vai trò sơ đồ',
      'Chức vụ',
      'Chức danh chuyên môn',
      'Số điện thoại',
      'Ghi chú',
    ];
    const csvLines = [
      header.map(escapeCsvCell).join(','),
      ...filteredPersonnel.map((row, idx) =>
        [
          String(idx + 1),
          row.member.fullName,
          formatVisibleCccd(row.member.cccd),
          row.unitName,
          row.roleLabel,
          row.member.position || row.roleLabel,
          row.member.professionalTitle || '',
          row.member.phone || '',
          buildDisplayNoteText(row.member),
        ]
          .map(escapeCsvCell)
          .join(',')
      ),
    ];

    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'danh_sach_nhan_luc_tram_y_te.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('success', `Đã xuất ${filteredPersonnel.length} nhân sự ra file CSV`);
  };

  // Open Member Modal (Add or Edit)
  const openAddMemberModal = (presetUnitId?: string, presetRoleKey?: OrgRoleKey) => {
    const defaultUnitId =
      presetUnitId ||
      (unitFilter !== 'all' ? unitFilter : orgChart.departments[0]?.id || 'leadership');
    const isLeadership = defaultUnitId === 'leadership';
    const defaultRole: OrgRoleKey = presetRoleKey
      ? presetRoleKey
      : isLeadership
      ? orgChart.director?.fullName?.trim()
        ? 'deputy_director'
        : 'director'
      : 'staff';

    setMemberForm({
      mode: 'add',
      memberId: createNewId('m'),
      unitId: defaultUnitId,
      roleKey: defaultRole,
      fullName: '',
      cccd: '',
      position: ROLE_DEFAULT_POSITIONS[defaultRole],
      professionalTitle: '',
      phone: '',
      notes: '',
      isSyncedFromUser: false, // Nhập thủ công -> không hiện chữ "Đã đồng bộ"
    });
  };

  const openEditMemberModal = (row: FlattenedPersonnelRow) => {
    setMemberForm({
      mode: 'edit',
      originalUnitId: row.unitId,
      originalRoleKey: row.roleKey,
      memberId: row.member.id || createNewId('m'),
      unitId: row.unitId,
      roleKey: row.roleKey,
      fullName: row.member.fullName || '',
      cccd: row.member.cccd || '',
      position: row.member.position || ROLE_DEFAULT_POSITIONS[row.roleKey],
      professionalTitle: row.member.professionalTitle || '',
      phone: row.member.phone || '',
      notes: row.member.notes || '',
      linkedUid: row.member.linkedUid,
      isSyncedFromUser: row.member.isSyncedFromUser,
    });
  };

  const handleMemberUnitChange = (newUnitId: string) => {
    setMemberForm(prev => {
      if (!prev) return null;
      const isNextLeadership = newUnitId === 'leadership';
      let nextRole = prev.roleKey;
      if (isNextLeadership && prev.roleKey !== 'director' && prev.roleKey !== 'deputy_director') {
        nextRole = 'deputy_director';
      } else if (!isNextLeadership && (prev.roleKey === 'director' || prev.roleKey === 'deputy_director')) {
        nextRole = 'staff';
      }
      const wasDefaultPos = Object.values(ROLE_DEFAULT_POSITIONS).includes(prev.position.trim());
      return {
        ...prev,
        unitId: newUnitId,
        roleKey: nextRole,
        position: wasDefaultPos || !prev.position.trim() ? ROLE_DEFAULT_POSITIONS[nextRole] : prev.position,
      };
    });
  };

  const handleMemberRoleChange = (newRoleKey: OrgRoleKey) => {
    setMemberForm(prev => {
      if (!prev) return null;
      const wasDefaultPos = Object.values(ROLE_DEFAULT_POSITIONS).includes(prev.position.trim());
      return {
        ...prev,
        roleKey: newRoleKey,
        position: wasDefaultPos || !prev.position.trim() ? ROLE_DEFAULT_POSITIONS[newRoleKey] : prev.position,
      };
    });
  };

  // Live matched user account in modal when typing CCCD / Name / Phone
  const matchedModalUser = useMemo(() => {
    if (!memberForm || users.length === 0) return undefined;
    return findMatchingUserForMember(
      {
        linkedUid: memberForm.linkedUid,
        cccd: memberForm.cccd,
        fullName: memberForm.fullName,
        phone: memberForm.phone,
      },
      users
    );
  }, [memberForm, users]);

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberForm) return;

    const fullName = memberForm.fullName.trim();
    if (!fullName) {
      showToast('error', 'Vui lòng nhập họ và tên nhân sự');
      return;
    }

    const cleanCccd = normalizeCccd(memberForm.cccd);
    if (cleanCccd && !/^[0-9]{9,12}$/.test(cleanCccd)) {
      showToast('error', 'Số CCCD / CMND chưa hợp lệ', 'Vui lòng nhập 9 hoặc 12 chữ số.');
      return;
    }

    const nextChart = getEditableBaseChart();
    const resolvedLinkedUid = matchedModalUser?.uid || memberForm.linkedUid;

    const memberPayload: OrgChartMember = {
      id: memberForm.memberId || createNewId('m'),
      fullName,
      cccd: cleanCccd || undefined,
      position: memberForm.position.trim() || ROLE_DEFAULT_POSITIONS[memberForm.roleKey],
      professionalTitle: memberForm.professionalTitle.trim(),
      phone: memberForm.phone.trim() || undefined,
      notes: memberForm.notes.trim() || undefined,
      linkedUid: resolvedLinkedUid || undefined,
      // Giữ nguyên cờ isSyncedFromUser nếu đang sửa nhân sự tự đồng bộ; thêm mới thủ công luôn là false
      isSyncedFromUser: memberForm.mode === 'edit' ? Boolean(memberForm.isSyncedFromUser) : false,
    };

    // Remove existing entry if editing (handles same-slot update & cross-unit transfer safely)
    if (memberForm.mode === 'edit' && memberForm.originalUnitId && memberForm.originalRoleKey) {
      if (memberForm.originalUnitId === 'leadership') {
        if (memberForm.originalRoleKey === 'director') {
          nextChart.director = undefined;
        } else {
          nextChart.deputyDirectors = nextChart.deputyDirectors.filter(
            d => d.id !== memberForm.memberId
          );
        }
      } else {
        nextChart.departments = nextChart.departments.map(dept => {
          if (dept.id !== memberForm.originalUnitId) return dept;
          return {
            ...dept,
            head:
              memberForm.originalRoleKey === 'head' && dept.head?.id === memberForm.memberId
                ? undefined
                : dept.head,
            deputies: (dept.deputies || []).filter(p => p.id !== memberForm.memberId),
            staff: (dept.staff || []).filter(s => s.id !== memberForm.memberId),
          };
        });
      }
    }

    // Insert into target slot
    let targetUnitLabel = 'Ban Giám đốc';
    if (memberForm.unitId === 'leadership') {
      if (memberForm.roleKey === 'director') {
        if (nextChart.director && nextChart.director.fullName?.trim()) {
          nextChart.deputyDirectors = [
            {
              ...nextChart.director,
              position:
                nextChart.director.position === 'Giám đốc'
                  ? 'Phó Giám đốc'
                  : nextChart.director.position,
            },
            ...nextChart.deputyDirectors,
          ];
        }
        nextChart.director = memberPayload;
      } else {
        nextChart.deputyDirectors = [...nextChart.deputyDirectors, memberPayload];
      }
    } else {
      const targetIdx = nextChart.departments.findIndex(d => d.id === memberForm.unitId);
      if (targetIdx === -1) {
        showToast('error', 'Không tìm thấy Khoa/Phòng được chọn');
        return;
      }
      const targetDept = nextChart.departments[targetIdx];
      targetUnitLabel = targetDept.name;

      if (memberForm.roleKey === 'head') {
        if (targetDept.head && targetDept.head.fullName?.trim()) {
          targetDept.staff = [
            {
              ...targetDept.head,
              position:
                targetDept.head.position === 'Trưởng khoa' ||
                targetDept.head.position === 'Trưởng phòng'
                  ? 'Nhân viên'
                  : targetDept.head.position,
            },
            ...(targetDept.staff || []),
          ];
        }
        targetDept.head = memberPayload;
      } else if (memberForm.roleKey === 'deputy') {
        targetDept.deputies = [...(targetDept.deputies || []), memberPayload];
      } else {
        targetDept.staff = [...(targetDept.staff || []), memberPayload];
      }
    }

    // If linkedUid was previously in excludedSyncedUids, un-exclude it
    if (resolvedLinkedUid && nextChart.excludedSyncedUids?.includes(resolvedLinkedUid)) {
      nextChart.excludedSyncedUids = nextChart.excludedSyncedUids.filter(
        uid => uid !== resolvedLinkedUid
      );
    }

    const ok = await persistOrgChart(
      nextChart,
      memberForm.mode === 'add' ? 'Thêm nhân sự vào sơ đồ tổ chức' : 'Cập nhật thông tin nhân sự',
      `${memberPayload.fullName}${cleanCccd ? ` (CCCD: ${cleanCccd})` : ''} · ${ROLE_LABELS[memberForm.roleKey]} - ${targetUnitLabel}`
    );

    if (ok) {
      // Đồng bộ ngược sang collection `users` bên mục "Tài khoản" nếu nhân lực này cũng là người dùng
      let syncedToAccount = false;
      if (users.length > 0) {
        try {
          const syncRes = await syncMemberToUserAccount(
            memberPayload,
            memberForm.unitId,
            targetUnitLabel,
            memberForm.roleKey,
            users
          );
          syncedToAccount = syncRes.synced;
          if (syncRes.synced) {
            onRefreshUsers?.();
          }
        } catch (syncErr) {
          console.warn('Sync member to user account error:', syncErr);
        }
      }

      if (syncedToAccount) {
        showToast(
          'success',
          memberForm.mode === 'add'
            ? `Đã thêm ${memberPayload.fullName} & đồng bộ sang mục Tài khoản`
            : `Đã cập nhật ${memberPayload.fullName} & đồng bộ sang mục Tài khoản`
        );
      } else {
        showToast(
          'success',
          memberForm.mode === 'add'
            ? `Đã thêm ${memberPayload.fullName} vào ${targetUnitLabel}`
            : `Đã cập nhật thông tin ${memberPayload.fullName}`
        );
      }
      setMemberForm(null);
    }
  };

  const handleDeleteMember = (row: FlattenedPersonnelRow) => {
    showConfirm({
      title: `Xóa nhân sự "${row.member.fullName}"?`,
      message: `Nhân sự này sẽ được gỡ khỏi ${row.unitName} (${row.roleLabel}) và đồng bộ với Sơ đồ tổ chức.`,
      confirmText: 'Xóa nhân sự',
      cancelText: 'Hủy',
      onConfirm: async () => {
        const nextChart = getEditableBaseChart();
        if (row.unitId === 'leadership') {
          if (row.roleKey === 'director') {
            nextChart.director = undefined;
          } else {
            nextChart.deputyDirectors = nextChart.deputyDirectors.filter(d => d.id !== row.member.id);
          }
        } else {
          nextChart.departments = nextChart.departments.map(dept => {
            if (dept.id !== row.unitId) return dept;
            return {
              ...dept,
              head:
                row.roleKey === 'head' && dept.head?.id === row.member.id ? undefined : dept.head,
              deputies: (dept.deputies || []).filter(p => p.id !== row.member.id),
              staff: (dept.staff || []).filter(s => s.id !== row.member.id),
            };
          });
        }

        // Prevent immediate auto-resurrection when deleting a user-synced member
        if (row.member.linkedUid) {
          const prevExcluded = nextChart.excludedSyncedUids || [];
          if (!prevExcluded.includes(row.member.linkedUid)) {
            nextChart.excludedSyncedUids = [...prevExcluded, row.member.linkedUid];
          }
        }

        await persistOrgChart(
          nextChart,
          'Xóa nhân sự khỏi sơ đồ tổ chức',
          `Đã xóa ${row.member.fullName} (${row.roleLabel} - ${row.unitName})`,
          `Đã xóa ${row.member.fullName} khỏi danh sách`
        );
      },
    });
  };

  // Department CRUD
  const openAddDeptModal = () => {
    setDeptForm({
      mode: 'add',
      deptId: createNewId('dept'),
      name: '',
      description: '',
    });
  };

  const openEditDeptModal = (dept: OrgChartDepartment) => {
    setDeptForm({
      mode: 'edit',
      deptId: dept.id,
      name: dept.name,
      description: dept.description || '',
    });
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm) return;

    const cleanName = deptForm.name.trim();
    if (!cleanName) {
      showToast('error', 'Vui lòng nhập tên Khoa / Phòng');
      return;
    }

    const nextChart = getEditableBaseChart();
    if (deptForm.mode === 'add') {
      nextChart.departments = [
        ...nextChart.departments,
        {
          id: deptForm.deptId || createNewId('dept'),
          name: cleanName,
          description: deptForm.description.trim() || undefined,
          deputies: [],
          staff: [],
        },
      ];
    } else {
      nextChart.departments = nextChart.departments.map(d =>
        d.id === deptForm.deptId
          ? {
              ...d,
              name: cleanName,
              description: deptForm.description.trim() || undefined,
            }
          : d
      );
    }

    const ok = await persistOrgChart(
      nextChart,
      deptForm.mode === 'add' ? 'Thêm Khoa / Phòng mới' : 'Cập nhật Khoa / Phòng',
      `${cleanName}`,
      deptForm.mode === 'add' ? `Đã thêm Khoa/Phòng "${cleanName}"` : `Đã cập nhật "${cleanName}"`
    );

    if (ok) {
      setDeptForm(null);
    }
  };

  const handleMoveDepartment = async (deptIndex: number, dir: -1 | 1) => {
    const targetIdx = deptIndex + dir;
    if (targetIdx < 0 || targetIdx >= orgChart.departments.length) return;
    const nextChart = getEditableBaseChart();
    const [moved] = nextChart.departments.splice(deptIndex, 1);
    nextChart.departments.splice(targetIdx, 0, moved);
    await persistOrgChart(
      nextChart,
      'Sắp xếp thứ tự Khoa / Phòng',
      `Di chuyển "${moved.name}" từ vị trí #${deptIndex + 1} sang #${targetIdx + 1}`,
      'Đã cập nhật thứ tự Khoa / Phòng'
    );
  };

  const handleDeleteDepartment = (dept: OrgChartDepartment) => {
    const totalInDept =
      (dept.head?.fullName?.trim() ? 1 : 0) +
      (dept.deputies || []).filter(p => p.fullName?.trim()).length +
      (dept.staff || []).filter(s => s.fullName?.trim()).length;

    showConfirm({
      title: `Xóa "${dept.name}"?`,
      message:
        totalInDept > 0
          ? `Khoa/Phòng này đang có ${totalInDept} nhân sự. Xóa Khoa/Phòng sẽ xóa toàn bộ danh sách nhân sự thuộc đơn vị này khỏi Sơ đồ tổ chức.`
          : 'Khoa/Phòng này chưa có nhân sự và sẽ bị xóa khỏi Sơ đồ tổ chức.',
      confirmText: 'Xóa Khoa/Phòng',
      cancelText: 'Hủy',
      onConfirm: async () => {
        const nextChart = getEditableBaseChart();
        nextChart.departments = nextChart.departments.filter(d => d.id !== dept.id);
        if (unitFilter === dept.id) setUnitFilter('all');
        await persistOrgChart(
          nextChart,
          'Xóa Khoa / Phòng khỏi sơ đồ tổ chức',
          `Đã xóa "${dept.name}" (${totalInDept} nhân sự)`,
          `Đã xóa "${dept.name}"`
        );
      },
    });
  };

  const toggleExpandDept = (deptId: string) => {
    setExpandedDeptIds(prev => ({ ...prev, [deptId]: !prev[deptId] }));
  };

  const expandAllDepts = () => {
    const next: Record<string, boolean> = {};
    orgChart.departments.forEach(d => {
      next[d.id] = true;
    });
    setExpandedDeptIds(next);
  };

  const collapseAllDepts = () => {
    setExpandedDeptIds({});
  };

  const hasActiveFilters = Boolean(
    searchTerm.trim() || unitFilter !== 'all' || roleTierFilter !== 'all'
  );

  const resetFilters = () => {
    setSearchTerm('');
    setUnitFilter('all');
    setRoleTierFilter('all');
  };

  // Warning notice inside member modal if replacing existing single-slot head/director
  const slotReplaceWarning = useMemo(() => {
    if (!memberForm) return null;
    if (memberForm.unitId === 'leadership' && memberForm.roleKey === 'director') {
      const currentDir = orgChart.director;
      if (
        currentDir?.fullName?.trim() &&
        (memberForm.mode === 'add' || currentDir.id !== memberForm.memberId)
      ) {
        return `Lưu ý: Hiện đã có Giám đốc (${currentDir.fullName}). Khi lưu, người tiền nhiệm sẽ tự động chuyển xuống danh sách Phó Giám đốc để tránh mất dữ liệu.`;
      }
    }
    if (memberForm.unitId !== 'leadership' && memberForm.roleKey === 'head') {
      const dept = orgChart.departments.find(d => d.id === memberForm.unitId);
      const currentHead = dept?.head;
      if (
        currentHead?.fullName?.trim() &&
        (memberForm.mode === 'add' || currentHead.id !== memberForm.memberId)
      ) {
        return `Lưu ý: Đơn vị này hiện đang có Trưởng khoa/phòng (${currentHead.fullName}). Khi lưu, người tiền nhiệm sẽ tự động chuyển xuống danh sách Nhân viên của đơn vị.`;
      }
    }
    return null;
  }, [memberForm, orgChart]);

  if (!settingsLoaded) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        </div>
        <div className="h-96 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <RevealOnScroll immediate>
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-6 sm:p-8 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <span>DANH BẠ TỔ CHỨC</span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
              <span className="tabular-nums">{stats.departmentCount} khoa / phòng</span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
              <span className="tabular-nums">{stats.totalMembers} nhân sự</span>
              {stats.syncedCount > 0 && (
                <>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                  <span className="tabular-nums">{stats.syncedCount} đã đồng bộ tài khoản</span>
                </>
              )}
            </div>

            {embeddedInAdmin ? (
              <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Quản Lý Nhân Lực &amp; Khoa Phòng (Đồng Bộ Tài Khoản &amp; Sơ Đồ Tổ Chức)
              </h3>
            ) : (
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                Quản Lý Nhân Lực &amp; Khoa Phòng
              </h1>
            )}

            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              Danh sách tập trung toàn bộ nhân sự và cơ cấu Khoa/Phòng theo Sơ đồ tổ chức Trạm Y tế, tự động đồng bộ 2 chiều với mục Tài khoản người dùng theo CCCD.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-start xl:justify-end gap-2 shrink-0">
            {onOpenOrgChart && (
              <button
                type="button"
                onClick={onOpenOrgChart}
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Network className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Sơ đồ dạng cây</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Xuất Excel (6 sheet)</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Xuất CSV</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                disabled={syncingFromUsers || saving}
                onClick={handleSyncFromUserAccounts}
                className="px-3.5 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-xs sm:text-sm font-semibold text-emerald-800 dark:text-emerald-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 text-emerald-600 shrink-0 ${syncingFromUsers ? 'animate-spin' : ''}`} />
                <span>Đồng bộ từ Tài khoản</span>
              </button>
            )}

            {isAdmin && !hasPersistedOrgData && (
              <button
                type="button"
                disabled={saving}
                onClick={handleApplyDefaultStructure}
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Lưu mặc định</span>
              </button>
            )}

            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={openAddDeptModal}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Thêm Khoa / Phòng</span>
                </button>

                <button
                  type="button"
                  onClick={() => openAddMemberModal()}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>Thêm nhân sự</span>
                </button>
              </>
            )}
          </div>
        </div>
      </RevealOnScroll>

      {/* 4-column Summary Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Tổng nhân sự toàn trạm
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {stats.totalMembers}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Theo Sơ đồ tổ chức hiện hành
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Ban Giám đốc
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {stats.leadershipCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Giám đốc &amp; Phó Giám đốc
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Quản lý Khoa / Phòng
          </div>
          <div className="text-2xl font-extrabold text-sky-700 dark:text-sky-400 tabular-nums">
            {stats.managerCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Trưởng &amp; Phó khoa / phòng
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Khoa / Phòng chuyên môn
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
            {stats.departmentCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Đơn vị trực thuộc Trạm Y tế
          </div>
        </div>
      </div>

      {/* Toolbar: Tabs + Filters */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Mode Tabs */}
          <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setActiveTab('personnel')}
              className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'personnel'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Danh sách Nhân lực</span>
              <span className="font-mono tabular-nums text-xs opacity-75">
                ({filteredPersonnel.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('departments')}
              className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'departments'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Danh sách Khoa / Phòng</span>
              <span className="font-mono tabular-nums text-xs opacity-75">
                ({filteredDepartments.length})
              </span>
            </button>
          </div>

          {/* Right side controls */}
          {activeTab === 'personnel' ? (
            <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start lg:self-auto">
              <button
                type="button"
                onClick={() => setDisplayMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  displayMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Table className="w-3.5 h-3.5 shrink-0" />
                <span>Dạng bảng</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('grouped')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  displayMode === 'grouped'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5 shrink-0" />
                <span>Nhóm theo đơn vị</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 self-start lg:self-auto">
              <button
                type="button"
                onClick={expandAllDepts}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                Mở tất cả thành viên
              </button>
              <button
                type="button"
                onClick={collapseAllDepts}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                Thu gọn
              </button>
            </div>
          )}
        </div>

        {/* Search & Filter Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className={activeTab === 'personnel' ? 'lg:col-span-5 relative' : 'lg:col-span-10 relative'}>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={
                activeTab === 'personnel'
                  ? canViewFullCccd
                    ? 'Tìm theo họ tên, CCCD, chuyên môn, SĐT, ghi chú...'
                    : 'Tìm theo họ tên, chuyên môn, SĐT, ghi chú...'
                  : 'Tìm theo tên Khoa/Phòng, chức năng, Trưởng/Phó khoa...'
              }
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {activeTab === 'personnel' && (
            <>
              <div className="lg:col-span-4">
                <select
                  value={unitFilter}
                  onChange={e => setUnitFilter(e.target.value)}
                  aria-label="Lọc theo Đơn vị hoặc Khoa phòng"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="all">Tất cả đơn vị ({stats.departmentCount + 1})</option>
                  <option value="leadership">Ban Giám đốc</option>
                  {orgChart.departments.map((d, idx) => (
                    <option key={d.id} value={d.id}>
                      {formatDepartmentLabel(d.name, idx)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <select
                  value={roleTierFilter}
                  onChange={e => setRoleTierFilter(e.target.value as RoleTierFilter)}
                  aria-label="Lọc theo Cấp bậc"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="all">Tất cả vai trò</option>
                  <option value="leadership">Ban Giám đốc</option>
                  <option value="head">Trưởng khoa / phòng</option>
                  <option value="deputy">Phó khoa / phòng</option>
                  <option value="staff">Nhân viên</option>
                </select>
              </div>
            </>
          )}

          <div className={activeTab === 'personnel' ? 'lg:col-span-1 flex justify-end' : 'lg:col-span-2 flex justify-end'}>
            <button
              type="button"
              disabled={!hasActiveFilters}
              onClick={resetFilters}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              title="Xóa bộ lọc"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              <span>Đặt lại</span>
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: PERSONNEL TABLE OR GROUPED LIST */}
      {activeTab === 'personnel' && (
        <>
          {filteredPersonnel.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center space-y-3">
              <Users className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  {hasActiveFilters
                    ? 'Không tìm thấy nhân sự phù hợp với bộ lọc'
                    : 'Chưa có nhân sự nào trong Sơ đồ tổ chức'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {hasActiveFilters
                    ? 'Thử thay đổi từ khóa tìm kiếm hoặc chọn lại đơn vị / cấp bậc khác.'
                    : 'Thêm nhân sự đầu tiên vào Ban Giám đốc hoặc các Khoa/Phòng chuyên môn.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Đặt lại bộ lọc
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => openAddMemberModal()}
                    className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Thêm nhân sự</span>
                  </button>
                )}
              </div>
            </div>
          ) : displayMode === 'table' ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-[13px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      <th className="py-3 px-4 w-14 text-right">STT</th>
                      <th className="py-3 px-4">Họ và tên</th>
                      <th className="py-3 px-4 whitespace-nowrap">CCCD</th>
                      <th className="py-3 px-4">Đơn vị / Khoa phòng</th>
                      <th className="py-3 px-4">Vai trò &amp; Chức vụ</th>
                      <th className="py-3 px-4">Chức danh chuyên môn</th>
                      <th className="py-3 px-4 whitespace-nowrap">Điện thoại</th>
                      <th className="py-3 px-4">Ghi chú</th>
                      {isAdmin && <th className="py-3 px-4 text-right whitespace-nowrap">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredPersonnel.map((row, idx) => {
                      const visibleCccd = formatVisibleCccd(row.member.cccd);
                      const hasSyncNote = Boolean(row.member.isSyncedFromUser);
                      const manualNote = row.member.notes?.trim() || '';

                      return (
                        <tr
                          key={`${row.unitId}_${row.roleKey}_${row.id}_${idx}`}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            {row.member.fullName}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-200">
                            {visibleCccd || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200">
                            {row.unitName}
                          </td>
                          <td className="py-3 px-4">
                            <div className={`font-bold ${ROLE_TEXT_COLORS[row.roleKey]}`}>
                              {row.roleLabel}
                            </div>
                            {row.member.position &&
                              row.member.position.trim().toLowerCase() !==
                                row.roleLabel.trim().toLowerCase() && (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {row.member.position}
                                </div>
                              )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                            {row.member.professionalTitle || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                            {row.member.phone ? (
                              <a
                                href={`tel:${row.member.phone}`}
                                className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline font-semibold"
                              >
                                <Phone className="w-3 h-3 shrink-0" />
                                <span>{formatPhoneNumber(row.member.phone, canViewFullCccd)}</span>
                              </a>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            {hasSyncNote ? (
                              <div className="space-y-0.5">
                                <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                                  Đã đồng bộ
                                </div>
                                {manualNote && (
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {manualNote}
                                  </div>
                                )}
                              </div>
                            ) : manualNote ? (
                              <span className="text-slate-600 dark:text-slate-300">{manualNote}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditMemberModal(row)}
                                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-emerald-700 dark:hover:text-emerald-400 transition cursor-pointer"
                                  title="Sửa / Chuyển đơn vị"
                                  aria-label={`Sửa ${row.member.fullName}`}
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMember(row)}
                                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                                  title="Xóa nhân sự"
                                  aria-label={`Xóa ${row.member.fullName}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Grouped List by Unit */
            <div className="space-y-4">
              {groupedPersonnel.map(group => (
                <div
                  key={group.unitId}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                >
                  <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                          {group.unitName}
                        </h3>
                        <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {group.rows.length} nhân sự
                        </span>
                      </div>
                      {group.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {group.description}
                        </p>
                      )}
                    </div>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openAddMemberModal(group.unitId)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-center"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm vào đơn vị này</span>
                      </button>
                    )}
                  </div>

                  {group.rows.length === 0 ? (
                    <div className="px-5 py-6 text-xs text-slate-500 dark:text-slate-400">
                      Chưa có nhân sự nào được phân công vào đơn vị này.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {group.rows.map((row, idx) => {
                        const visibleCccd = formatVisibleCccd(row.member.cccd);
                        const hasSyncNote = Boolean(row.member.isSyncedFromUser);
                        const manualNote = row.member.notes?.trim() || '';

                        return (
                          <div
                            key={`${row.unitId}_${row.roleKey}_${row.id}_${idx}`}
                            className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-xs font-mono tabular-nums text-slate-400 w-5">
                                  {idx + 1}.
                                </span>
                                <span className="text-sm font-bold text-slate-900 dark:text-white">
                                  {row.member.fullName}
                                </span>
                                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                <span className={`text-xs font-bold ${ROLE_TEXT_COLORS[row.roleKey]}`}>
                                  {row.member.position || row.roleLabel}
                                </span>
                                {hasSyncNote && (
                                  <>
                                    <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                      Đã đồng bộ
                                    </span>
                                  </>
                                )}
                              </div>
                              <div className="pl-7 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {visibleCccd && (
                                  <>
                                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                      CCCD: {visibleCccd}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                  </>
                                )}
                                <span>{row.member.professionalTitle || 'Chưa cập nhật chức danh chuyên môn'}</span>
                                {row.member.phone && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <a
                                      href={`tel:${row.member.phone}`}
                                      className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 hover:underline font-semibold"
                                    >
                                      {row.member.phone}
                                    </a>
                                  </>
                                )}
                                {manualNote && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{manualNote}</span>
                                  </>
                                )}
                              </div>
                            </div>

                            {isAdmin && (
                              <div className="flex items-center gap-1 pl-7 sm:pl-0 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openEditMemberModal(row)}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                  <span>Sửa</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMember(row)}
                                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                  title="Xóa"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 2: DEPARTMENTS TABLE WITH EXPANDABLE MEMBER DRAWER */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          {/* Ban Giám đốc Summary Row Card */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Đơn vị điều hành cấp Trạm
              </div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Ban Giám đốc Trạm Y tế ({stats.leadershipCount} nhân sự)
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                <span>
                  Giám đốc:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {orgChart.director?.fullName?.trim() || 'Chưa cập nhật'}
                  </strong>
                </span>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                <span>
                  Phó Giám đốc:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {orgChart.deputyDirectors.length > 0
                      ? orgChart.deputyDirectors.map(d => d.fullName).join(', ')
                      : 'Chưa có'}
                  </strong>
                </span>
              </div>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openAddMemberModal('leadership', 'director')}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Cập nhật Giám đốc / Phó GĐ</span>
                </button>
              </div>
            )}
          </div>

          {/* Departments Data Table */}
          {filteredDepartments.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center space-y-3">
              <Building2 className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Không có Khoa / Phòng nào phù hợp
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Thêm Khoa/Phòng chuyên môn mới hoặc đặt lại từ khóa tìm kiếm.
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openAddDeptModal}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Khoa / Phòng</span>
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-[13px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      <th className="py-3 px-4 w-20">STT</th>
                      <th className="py-3 px-4">Tên Khoa / Phòng &amp; Chức năng</th>
                      <th className="py-3 px-4">Trưởng khoa / phòng</th>
                      <th className="py-3 px-4">Phó khoa / phòng</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Nhân viên</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Tổng nhân sự</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredDepartments.map(({ dept, index }) => {
                      const deputiesList = dept.deputies || [];
                      const staffList = dept.staff || [];
                      const totalCount =
                        (dept.head?.fullName?.trim() ? 1 : 0) +
                        deputiesList.filter(p => p.fullName?.trim()).length +
                        staffList.filter(s => s.fullName?.trim()).length;
                      const isExpanded = Boolean(expandedDeptIds[dept.id]);

                      // Collect members in this department for expandable detail
                      const deptMembers: FlattenedPersonnelRow[] = [];
                      if (dept.head?.fullName?.trim()) {
                        deptMembers.push({
                          id: dept.head.id,
                          unitType: 'department',
                          unitId: dept.id,
                          unitName: formatDepartmentLabel(dept.name, index),
                          unitOrder: index + 1,
                          roleKey: 'head',
                          roleLabel: ROLE_LABELS.head,
                          roleTier: 'head',
                          member: dept.head,
                        });
                      }
                      deputiesList.forEach(dep => {
                        if (!dep.fullName?.trim()) return;
                        deptMembers.push({
                          id: dep.id,
                          unitType: 'department',
                          unitId: dept.id,
                          unitName: formatDepartmentLabel(dept.name, index),
                          unitOrder: index + 1,
                          roleKey: 'deputy',
                          roleLabel: ROLE_LABELS.deputy,
                          roleTier: 'deputy',
                          member: dep,
                        });
                      });
                      staffList.forEach(st => {
                        if (!st.fullName?.trim()) return;
                        deptMembers.push({
                          id: st.id,
                          unitType: 'department',
                          unitId: dept.id,
                          unitName: formatDepartmentLabel(dept.name, index),
                          unitOrder: index + 1,
                          roleKey: 'staff',
                          roleLabel: ROLE_LABELS.staff,
                          roleTier: 'staff',
                          member: st,
                        });
                      });

                      return (
                        <React.Fragment key={dept.id}>
                          <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3.5 px-4 align-top">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                                  #{index + 1}
                                </span>
                                {isAdmin && !searchTerm.trim() && (
                                  <div className="inline-flex flex-col">
                                    <button
                                      type="button"
                                      disabled={saving || index === 0}
                                      onClick={() => handleMoveDepartment(index, -1)}
                                      className="p-0.5 text-slate-400 hover:text-emerald-700 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                                      title="Di chuyển lên"
                                      aria-label={`Di chuyển ${dept.name} lên`}
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={saving || index === orgChart.departments.length - 1}
                                      onClick={() => handleMoveDepartment(index, 1)}
                                      className="p-0.5 text-slate-400 hover:text-emerald-700 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                                      title="Di chuyển xuống"
                                      aria-label={`Di chuyển ${dept.name} xuống`}
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <div className="font-bold text-slate-900 dark:text-white">
                                {dept.name}
                              </div>
                              {dept.description && (
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">
                                  {dept.description}
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {dept.head?.fullName?.trim() ? (
                                <div>
                                  <div className="font-semibold text-slate-900 dark:text-white">
                                    {dept.head.fullName}
                                  </div>
                                  {dept.head.professionalTitle && (
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                      {dept.head.professionalTitle}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400">Chưa bổ nhiệm</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              {deputiesList.length > 0 ? (
                                <div className="space-y-0.5">
                                  {deputiesList.map(dep => (
                                    <div key={dep.id} className="text-slate-700 dark:text-slate-300 font-medium">
                                      {dep.fullName}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {staffList.length}
                            </td>

                            <td className="py-3.5 px-4 align-top text-right font-mono font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {totalCount}
                            </td>

                            <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleExpandDept(dept.id)}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  {isExpanded ? (
                                    <>
                                      <ChevronUp className="w-3.5 h-3.5" />
                                      <span>Thu gọn</span>
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-3.5 h-3.5" />
                                      <span>Nhân sự ({totalCount})</span>
                                    </>
                                  )}
                                </button>

                                {isAdmin && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openAddMemberModal(dept.id, 'staff')}
                                      className="p-1.5 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition cursor-pointer"
                                      title="Thêm nhân sự vào khoa/phòng này"
                                      aria-label={`Thêm nhân sự vào ${dept.name}`}
                                    >
                                      <UserPlus className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditDeptModal(dept)}
                                      className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                                      title="Sửa tên & chức năng khoa/phòng"
                                      aria-label={`Sửa ${dept.name}`}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDepartment(dept)}
                                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                                      title="Xóa khoa/phòng"
                                      aria-label={`Xóa ${dept.name}`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expanded inline members list */}
                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-950/40">
                              <td colSpan={7} className="px-6 py-4">
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                      Danh sách thành viên · {dept.name} ({deptMembers.length} người)
                                    </span>
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() => openAddMemberModal(dept.id, 'staff')}
                                        className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                        <span>Thêm nhân sự vào {dept.name}</span>
                                      </button>
                                    )}
                                  </div>

                                  {deptMembers.length === 0 ? (
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                      Khoa/Phòng này chưa có nhân sự được gán.
                                    </p>
                                  ) : (
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                                      {deptMembers.map((mRow, mIdx) => {
                                        const visibleCccd = formatVisibleCccd(mRow.member.cccd);
                                        const hasSyncNote = Boolean(mRow.member.isSyncedFromUser);
                                        return (
                                          <div
                                            key={`${mRow.roleKey}_${mRow.id}_${mIdx}`}
                                            className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                                          >
                                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                                              <span className="font-mono tabular-nums text-slate-400 w-5">
                                                {mIdx + 1}.
                                              </span>
                                              <span className="font-bold text-slate-900 dark:text-white">
                                                {mRow.member.fullName}
                                              </span>
                                              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                              <span className={`font-bold ${ROLE_TEXT_COLORS[mRow.roleKey]}`}>
                                                {mRow.member.position || mRow.roleLabel}
                                              </span>
                                              {visibleCccd && (
                                                <>
                                                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                                    CCCD: {visibleCccd}
                                                  </span>
                                                </>
                                              )}
                                              {mRow.member.professionalTitle && (
                                                <>
                                                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                                  <span className="text-slate-600 dark:text-slate-300">
                                                    {mRow.member.professionalTitle}
                                                  </span>
                                                </>
                                              )}
                                              {mRow.member.phone && (
                                                <>
                                                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                                  <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                                                    {mRow.member.phone}
                                                  </span>
                                                </>
                                              )}
                                              {hasSyncNote && (
                                                <>
                                                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                                    Đã đồng bộ
                                                  </span>
                                                </>
                                              )}
                                            </div>

                                            {isAdmin && (
                                              <div className="flex items-center gap-1 self-end sm:self-center">
                                                <button
                                                  type="button"
                                                  onClick={() => openEditMemberModal(mRow)}
                                                  className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                                                >
                                                  Sửa
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleDeleteMember(mRow)}
                                                  className="px-2 py-1 rounded-md text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold cursor-pointer"
                                                >
                                                  Xóa
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Thêm / Sửa Nhân sự */}
      {memberForm && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-xl w-full overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-600" />
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  {memberForm.mode === 'add' ? 'Thêm Nhân Sự Mới' : 'Cập Nhật Nhân Sự'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMemberForm(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMember} className="p-6 space-y-4 text-xs sm:text-sm overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Đơn vị / Khoa phòng <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={memberForm.unitId}
                    onChange={e => handleMemberUnitChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value="leadership">Ban Giám đốc</option>
                    {orgChart.departments.map((d, idx) => (
                      <option key={d.id} value={d.id}>
                        {formatDepartmentLabel(d.name, idx)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Vai trò trong sơ đồ <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={memberForm.roleKey}
                    onChange={e => handleMemberRoleChange(e.target.value as OrgRoleKey)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    {memberForm.unitId === 'leadership' ? (
                      <>
                        <option value="director">Giám đốc</option>
                        <option value="deputy_director">Phó Giám đốc</option>
                      </>
                    ) : (
                      <>
                        <option value="head">Trưởng khoa / Trưởng phòng</option>
                        <option value="deputy">Phó khoa / Phó phòng</option>
                        <option value="staff">Nhân viên</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {slotReplaceWarning && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  {slotReplaceWarning}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Họ và tên <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={memberForm.fullName}
                    onChange={e => setMemberForm({ ...memberForm, fullName: e.target.value })}
                    placeholder="Ví dụ: Họ và tên cán bộ / nhân viên"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Số CCCD / CMND (12 số)
                  </label>
                  <input
                    type="text"
                    maxLength={12}
                    value={memberForm.cccd}
                    onChange={e => setMemberForm({ ...memberForm, cccd: e.target.value })}
                    placeholder="0790xxxxxxxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {matchedModalUser && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                  Phát hiện tài khoản người dùng khớp thông tin:{' '}
                  <strong>{matchedModalUser.displayName}</strong> ({matchedModalUser.email}). Khi lưu, thông tin đơn vị, chức vụ, CCCD sẽ được đồng bộ sang mục <strong>Tài khoản</strong>.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Chức vụ hiển thị
                  </label>
                  <input
                    type="text"
                    value={memberForm.position}
                    onChange={e => setMemberForm({ ...memberForm, position: e.target.value })}
                    placeholder={ROLE_DEFAULT_POSITIONS[memberForm.roleKey]}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Số điện thoại liên hệ
                  </label>
                  <input
                    type="text"
                    value={memberForm.phone}
                    onChange={e => setMemberForm({ ...memberForm, phone: e.target.value })}
                    placeholder="09xx xxx xxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Chức danh chuyên môn / Trình độ
                </label>
                <input
                  type="text"
                  value={memberForm.professionalTitle}
                  onChange={e =>
                    setMemberForm({ ...memberForm, professionalTitle: e.target.value })
                  }
                  placeholder="Ví dụ: Bác sĩ Đa khoa, Cử nhân Điều dưỡng, Dược sĩ Đại học..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ghi chú phân công (tùy chọn)
                </label>
                <input
                  type="text"
                  value={memberForm.notes}
                  onChange={e => setMemberForm({ ...memberForm, notes: e.target.value })}
                  placeholder="Ví dụ: Phụ trách tiêm chủng mở rộng / Trực cấp cứu..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setMemberForm(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{memberForm.mode === 'add' ? 'Thêm nhân sự' : 'Lưu thay đổi'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Thêm / Sửa Khoa / Phòng */}
      {deptForm && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-600" />
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  {deptForm.mode === 'add' ? 'Thêm Khoa / Phòng Mới' : 'Chỉnh Sửa Khoa / Phòng'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDeptForm(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDepartment} className="p-6 space-y-4 text-xs sm:text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tên Khoa / Phòng <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={deptForm.name}
                  onChange={e => setDeptForm({ ...deptForm, name: e.target.value })}
                  placeholder="Ví dụ: Khoa Khám bệnh – Chữa bệnh"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Chức năng, nhiệm vụ tóm tắt
                </label>
                <textarea
                  rows={3}
                  value={deptForm.description}
                  onChange={e => setDeptForm({ ...deptForm, description: e.target.value })}
                  placeholder="Mô tả ngắn gọn nhiệm vụ chuyên môn của Khoa/Phòng..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeptForm(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{deptForm.mode === 'add' ? 'Tạo Khoa / Phòng' : 'Lưu thay đổi'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
