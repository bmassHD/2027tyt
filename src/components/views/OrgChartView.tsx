import React, { useMemo, useState } from 'react';
import {
  Network,
  Building2,
  UserCheck,
  Users,
  Settings,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Search,
  Phone,
  Award,
  X,
  ArrowUp,
  ArrowDown,
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  RotateCcw,
  Table,
} from 'lucide-react';
import {
  OrgChartConfig,
  OrgChartDepartment,
  OrgChartMember,
  SystemSettings,
} from '../../types';
import { updateSystemSettings, logAuditEvent } from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { RevealOnScroll } from '../common/RevealOnScroll';
import {
  createDefaultOrgChart,
  createEmptyOrgChart,
  DEFAULT_ORG_CHART,
  exportOrgChartWorkbook,
  parseOrgChartWorkbook,
  ParsedOrgChartImportResult,
} from '../../data/defaultOrgChart';

interface OrgChartViewProps {
  settings: SystemSettings;
  settingsLoaded?: boolean;
  onOpenPersonnelDirectory?: () => void;
}

function createEmptyMember(position: string): OrgChartMember {
  return {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    fullName: '',
    position,
    professionalTitle: '',
    phone: '',
  };
}

function createEmptyDepartment(): OrgChartDepartment {
  return {
    id: `dept_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    description: '',
    head: createEmptyMember('Trưởng khoa'),
    deputies: [],
    staff: [],
  };
}

function formatNumberedDepartmentName(name: string, index: number): string {
  const trimmed = name.trim();
  if (/^\d+\s*[.\-_:]/.test(trimmed)) return trimmed;
  return `${index + 1}. ${trimmed}`;
}

export const OrgChartView: React.FC<OrgChartViewProps> = ({
  settings,
  settingsLoaded = true,
  onOpenPersonnelDirectory,
}) => {
  const { currentUser, userProfile, isAdmin } = useAuth();
  const { showToast, showConfirm } = useToast();

  const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importPreview, setImportPreview] = useState<ParsedOrgChartImportResult | null>(null);

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
      updatedAt: raw?.updatedAt,
    };
  }, [settings.orgChart, hasPersistedOrgData]);

  const hasAnyOrgData = Boolean(
    orgChart.director?.fullName?.trim() ||
      orgChart.deputyDirectors.length > 0 ||
      orgChart.departments.length > 0
  );

  // Editor working copy state
  const [draftChart, setDraftChart] = useState<OrgChartConfig>(() => createEmptyOrgChart());

  const openEditorModal = () => {
    setDraftChart({
      director: orgChart.director
        ? { ...orgChart.director }
        : createEmptyMember('Giám đốc'),
      deputyDirectors: orgChart.deputyDirectors.map(d => ({ ...d })),
      departments: orgChart.departments.map(dept => ({
        ...dept,
        head: dept.head ? { ...dept.head } : createEmptyMember('Trưởng khoa'),
        deputies: (dept.deputies || []).map(p => ({ ...p })),
        staff: (dept.staff || []).map(s => ({ ...s })),
      })),
    });
    setShowEditor(true);
  };

  const handleApplyDefaultStructure = async () => {
    setSaving(true);
    try {
      const payload: OrgChartConfig = {
        ...createDefaultOrgChart(),
        updatedAt: new Date().toISOString(),
      };
      await updateSystemSettings({
        orgChart: payload,
        updatedAt: new Date().toISOString(),
      });
      await logAuditEvent(
        'Khởi tạo khung 5 Khoa/Phòng trống',
        'Sơ đồ tổ chức',
        `Khởi tạo ${payload.departments.length} Khoa/Phòng chuẩn (chưa có nhân sự)`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );
      showToast('success', 'Đã khởi tạo khung 5 Khoa/Phòng (chưa có nhân sự)');
    } catch (err: any) {
      showToast('error', 'Không thể lưu sơ đồ mặc định', err?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadSampleExcel = () => {
    exportOrgChartWorkbook(createDefaultOrgChart(), 'mau_import_so_do_to_chuc_6_sheet.xlsx');
    showToast(
      'success',
      'Đã tải file Excel mẫu (6 sheet)',
      'Mỗi khoa/phòng có 1 sheet riêng kèm mẫu Trưởng khoa và Nhân viên để điền và import lại.'
    );
  };

  const handleExportCurrentExcel = () => {
    exportOrgChartWorkbook(orgChart, 'so_do_to_chuc_hien_tai.xlsx');
    showToast('success', 'Đã xuất Sơ đồ tổ chức hiện tại ra Excel (6 sheet)');
  };

  const handleImportExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseOrgChartWorkbook(buf, orgChart);
      setImportPreview(parsed);
    } catch (err: any) {
      showToast('error', 'Không thể đọc file Excel', err?.message || 'Vui lòng dùng file mẫu Excel (.xlsx) hợp lệ.');
    }
  };

  const handleConfirmSaveImport = async () => {
    if (!importPreview) return;
    setSaving(true);
    try {
      const payload: OrgChartConfig = {
        ...importPreview.orgChart,
        updatedAt: new Date().toISOString(),
      };
      await updateSystemSettings({
        orgChart: payload,
        updatedAt: new Date().toISOString(),
      });
      await logAuditEvent(
        'Import Sơ đồ tổ chức từ Excel',
        'Sơ đồ tổ chức',
        `Đã import ${importPreview.sheetSummaries.length} sheet (${payload.departments.length} Khoa/Phòng)`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );
      showToast('success', 'Đã import & lưu Sơ đồ tổ chức thành công');
      setImportPreview(null);
    } catch (err: any) {
      showToast('error', 'Lưu dữ liệu Import thất bại', err?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadImportIntoEditor = () => {
    if (!importPreview) return;
    setDraftChart({
      director: importPreview.orgChart.director
        ? { ...importPreview.orgChart.director }
        : createEmptyMember('Giám đốc'),
      deputyDirectors: importPreview.orgChart.deputyDirectors.map(d => ({ ...d })),
      departments: importPreview.orgChart.departments.map(dept => ({
        ...dept,
        head: dept.head ? { ...dept.head } : createEmptyMember('Trưởng khoa'),
        deputies: (dept.deputies || []).map(p => ({ ...p })),
        staff: (dept.staff || []).map(s => ({ ...s })),
      })),
    });
    setImportPreview(null);
    setShowEditor(true);
    showToast('info', 'Đã nạp dữ liệu Excel vào trình chỉnh sửa', 'Kiểm tra và bấm "Lưu sơ đồ tổ chức" để hoàn tất.');
  };

  const handleSaveOrgChart = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanedDirector =
        draftChart.director && draftChart.director.fullName.trim()
          ? {
              ...draftChart.director,
              fullName: draftChart.director.fullName.trim(),
              position: draftChart.director.position.trim() || 'Giám đốc',
              professionalTitle: draftChart.director.professionalTitle.trim(),
              phone: draftChart.director.phone?.trim() || undefined,
            }
          : undefined;

      const cleanedDeputies = draftChart.deputyDirectors
        .filter(d => d.fullName.trim() !== '')
        .map(d => ({
          ...d,
          fullName: d.fullName.trim(),
          position: d.position.trim() || 'Phó Giám đốc',
          professionalTitle: d.professionalTitle.trim(),
          phone: d.phone?.trim() || undefined,
        }));

      const cleanedDepartments: OrgChartDepartment[] = draftChart.departments
        .filter(dept => dept.name.trim() !== '')
        .map(dept => ({
          id: dept.id,
          name: dept.name.trim(),
          description: dept.description?.trim() || undefined,
          head:
            dept.head && dept.head.fullName.trim()
              ? {
                  ...dept.head,
                  fullName: dept.head.fullName.trim(),
                  position: dept.head.position.trim() || 'Trưởng khoa',
                  professionalTitle: dept.head.professionalTitle.trim(),
                  phone: dept.head.phone?.trim() || undefined,
                }
              : undefined,
          deputies: (dept.deputies || [])
            .filter(p => p.fullName.trim() !== '')
            .map(p => ({
              ...p,
              fullName: p.fullName.trim(),
              position: p.position.trim() || 'Phó khoa',
              professionalTitle: p.professionalTitle.trim(),
              phone: p.phone?.trim() || undefined,
            })),
          staff: (dept.staff || [])
            .filter(s => s.fullName.trim() !== '')
            .map(s => ({
              ...s,
              fullName: s.fullName.trim(),
              position: s.position.trim() || 'Nhân viên',
              professionalTitle: s.professionalTitle.trim(),
              phone: s.phone?.trim() || undefined,
            })),
        }));

      const payload: OrgChartConfig = {
        director: cleanedDirector,
        deputyDirectors: cleanedDeputies,
        departments: cleanedDepartments,
        excludedSyncedUids: orgChart.excludedSyncedUids,
        updatedAt: new Date().toISOString(),
      };

      await updateSystemSettings({
        orgChart: payload,
        updatedAt: new Date().toISOString(),
      });

      await logAuditEvent(
        'Cập nhật Sơ đồ tổ chức',
        'Sơ đồ tổ chức',
        `Cập nhật ${cleanedDeputies.length} Phó GĐ và ${cleanedDepartments.length} Khoa/Phòng`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );

      showToast('success', 'Đã lưu Sơ đồ tổ chức Trạm Y tế');
      setShowEditor(false);
    } catch (err: any) {
      showToast('error', 'Lưu sơ đồ tổ chức thất bại', err?.message);
    } finally {
      setSaving(false);
    }
  };

  // Stats summary
  const totalStaffCount = useMemo(() => {
    let count = orgChart.director?.fullName?.trim() ? 1 : 0;
    count += orgChart.deputyDirectors.length;
    orgChart.departments.forEach(dept => {
      if (dept.head?.fullName?.trim()) count += 1;
      count += (dept.deputies || []).length;
      count += (dept.staff || []).length;
    });
    return count;
  }, [orgChart]);

  // Filtered departments for viewing
  const visibleDepartments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orgChart.departments.filter(dept => {
      if (selectedDeptId !== 'all' && dept.id !== selectedDeptId) return false;
      if (!q) return true;
      const haystacks = [
        dept.name,
        dept.description || '',
        dept.head?.fullName || '',
        dept.head?.professionalTitle || '',
        ...(dept.deputies || []).flatMap(p => [p.fullName, p.professionalTitle, p.position]),
        ...(dept.staff || []).flatMap(s => [s.fullName, s.professionalTitle, s.position]),
      ]
        .join(' ')
        .toLowerCase();
      return haystacks.includes(q);
    });
  }, [orgChart.departments, selectedDeptId, searchTerm]);

  if (!settingsLoaded) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        <div className="h-80 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <RevealOnScroll immediate>
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <span>CƠ CẤU TỔ CHỨC</span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="tabular-nums">{orgChart.departments.length} khoa / phòng</span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="tabular-nums">{totalStaffCount} nhân sự</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
              Sơ Đồ Tổ Chức Bộ Máy Trạm Y Tế
            </h1>

            <p className="text-sm sm:text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              Ban Giám đốc đến từng Khoa/Phòng, Trưởng/Phó khoa và chức danh chuyên môn của nhân sự.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-start lg:justify-end gap-2 shrink-0 self-start lg:self-center">
            {onOpenPersonnelDirectory && (
              <button
                type="button"
                onClick={onOpenPersonnelDirectory}
                className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Table className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Danh sách nhân lực / khoa phòng</span>
              </button>
            )}

            {isAdmin && (
              <div className="hidden lg:flex flex-wrap items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadSampleExcel}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Tải mẫu Excel (6 sheet)</span>
                </button>

                <label className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Import Excel</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportExcelFile}
                    className="hidden"
                  />
                </label>

                {!hasPersistedOrgData && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleApplyDefaultStructure}
                    className="px-3.5 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-xs sm:text-sm font-semibold text-emerald-800 dark:text-emerald-200 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Lưu mặc định</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={openEditorModal}
                  className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm transition inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  <span>Chỉnh sửa sơ đồ</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </RevealOnScroll>

      {/* Filter & Search Bar */}
      {hasAnyOrgData && orgChart.departments.length > 0 && (
        <RevealOnScroll title="Tra cứu khoa phòng & nhân sự">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setSelectedDeptId('all')}
                className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedDeptId === 'all'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Tất cả ({orgChart.departments.length})
              </button>
              {orgChart.departments.map((dept, deptIdx) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelectedDeptId(dept.id)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedDeptId === dept.id
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {formatNumberedDepartmentName(dept.name, deptIdx)}
                </button>
              ))}
            </div>

            <div className="relative md:w-72 shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Tìm tên cán bộ, chức danh..."
                className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </RevealOnScroll>
      )}

      {/* Main Top-Down Branching Hierarchy */}
      {!hasAnyOrgData ? (
        <RevealOnScroll title="Sơ đồ tổ chức">
          <div className="p-10 rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <Network className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Chưa thiết lập Sơ đồ tổ chức chi tiết
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
                Quản trị viên có thể khởi tạo sơ đồ mẫu hoặc tự nhập Giám đốc, Phó Giám đốc, các Khoa/Phòng, Trưởng/Phó khoa và danh sách nhân viên kèm chức danh chuyên môn.
              </p>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleApplyDefaultStructure}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-200 transition cursor-pointer whitespace-nowrap"
                >
                  Khởi tạo 5 Khoa/Phòng mặc định
                </button>
                <button
                  type="button"
                  onClick={openEditorModal}
                  className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition cursor-pointer whitespace-nowrap"
                >
                  + Thiết lập sơ đồ
                </button>
              </div>
            )}
          </div>
        </RevealOnScroll>
      ) : (
        <RevealOnScroll title="Cây phân cấp nhân sự">
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-5 sm:p-8 space-y-0">
            {/* LEVEL 0: BAN GIÁM ĐỐC */}
            <div className="flex flex-col items-center mb-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                Ban Giám Đốc
              </span>
            </div>

            {/* LEVEL 1: GIÁM ĐỐC */}
            <div className="flex flex-col items-center">
              <div className="w-full max-w-md rounded-2xl bg-gradient-to-br from-emerald-800 via-teal-800 to-slate-900 text-white p-5 sm:p-6 shadow-sm border border-emerald-700/60 text-center space-y-2">
                <div className="text-xs font-bold uppercase tracking-widest text-emerald-200">
                  {orgChart.director?.position || 'Giám đốc'}
                </div>
                <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  {orgChart.director?.fullName || 'Chưa cập nhật Giám đốc'}
                </h2>
                <div className="pt-1 border-t border-white/15 text-sm text-emerald-100 flex items-center justify-center gap-1.5">
                  <Award className="w-4 h-4 text-emerald-300 shrink-0" />
                  <span>
                    {orgChart.director?.professionalTitle || 'Chức danh chuyên môn: Đang cập nhật'}
                  </span>
                </div>
                {orgChart.director?.phone && (
                  <div className="text-xs text-emerald-200 font-mono tabular-nums pt-0.5">
                    ĐT: {orgChart.director.phone}
                  </div>
                )}
              </div>

              {/* Trunk down to Deputy Directors or Departments */}
              {(orgChart.deputyDirectors.length > 0 || visibleDepartments.length > 0) && (
                <div className="w-0.5 h-8 bg-emerald-500/70 dark:bg-emerald-700" aria-hidden="true" />
              )}
            </div>

            {/* LEVEL 2: PHÓ GIÁM ĐỐC (Branched horizontally from Director trunk) */}
            {orgChart.deputyDirectors.length > 0 && (
              <div className="flex flex-col items-center">
                {orgChart.deputyDirectors.length === 1 ? (
                  <div className="w-full max-w-sm rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 p-4 sm:p-5 text-center space-y-1.5">
                    <div className="text-xs font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
                      {orgChart.deputyDirectors[0].position || 'Phó Giám đốc'}
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                      {orgChart.deputyDirectors[0].fullName}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Chức danh chuyên môn:{' '}
                      </span>
                      <span className="font-medium">
                        {orgChart.deputyDirectors[0].professionalTitle || 'Đang cập nhật'}
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="w-full max-w-4xl">
                    {/* Horizontal branch rail across Phó Giám đốc (desktop/tablet) */}
                    <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-4 relative">
                      {orgChart.deputyDirectors.map((dd, idx) => {
                        const isFirst = idx === 0;
                        const isLast = idx === orgChart.deputyDirectors.length - 1;
                        return (
                          <div key={dd.id} className="flex flex-col items-center relative">
                            {/* Top horizontal connector cap */}
                            <div className="w-full h-5 relative flex justify-center" aria-hidden="true">
                              {!isFirst && (
                                <div className="absolute top-0 left-0 right-1/2 h-0.5 bg-emerald-500/70 dark:bg-emerald-700" />
                              )}
                              {!isLast && (
                                <div className="absolute top-0 left-1/2 right-0 h-0.5 bg-emerald-500/70 dark:bg-emerald-700" />
                              )}
                              <div className="w-0.5 h-full bg-emerald-500/70 dark:bg-emerald-700" />
                            </div>

                            <div className="w-full h-full rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 p-4 text-center space-y-1.5 flex flex-col justify-center">
                              <div className="text-xs font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
                                {dd.position || 'Phó Giám đốc'}
                              </div>
                              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                                {dd.fullName}
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
                                {dd.professionalTitle || 'Chức danh chuyên môn: Đang cập nhật'}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Stacked clean cards with vertical branch spine on mobile */}
                    <div className="sm:hidden space-y-3">
                      {orgChart.deputyDirectors.map(dd => (
                        <div
                          key={dd.id}
                          className="rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 p-4 text-center space-y-1"
                        >
                          <div className="text-xs font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
                            {dd.position || 'Phó Giám đốc'}
                          </div>
                          <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                            {dd.fullName}
                          </h3>
                          <p className="text-sm text-slate-600 dark:text-slate-300">
                            {dd.professionalTitle || 'Đang cập nhật'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vertical trunk from Deputy Directors down to Departments */}
                {visibleDepartments.length > 0 && (
                  <div className="w-0.5 h-9 bg-emerald-500/70 dark:bg-emerald-700" aria-hidden="true" />
                )}
              </div>
            )}

            {/* LEVEL 3 -> 6: KHOA / PHÒNG -> TRƯỞNG KHOA -> PHÓ KHOA -> NHÂN VIÊN */}
            {visibleDepartments.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Không tìm thấy Khoa/Phòng hoặc nhân sự phù hợp với bộ lọc.
              </div>
            ) : (
              <div className="pt-0">
                {/* Horizontal connector header bar across department branches on lg screens */}
                {visibleDepartments.length > 1 && (
                  <div
                    className="hidden lg:block h-0.5 bg-emerald-500/60 dark:bg-emerald-700 mx-auto"
                    style={{
                      width:
                        visibleDepartments.length === 2
                          ? '52%'
                          : visibleDepartments.length >= 3
                          ? '68%'
                          : '0%',
                    }}
                    aria-hidden="true"
                  />
                )}

                <div
                  className={`grid grid-cols-1 gap-6 items-stretch ${
                    visibleDepartments.length === 1
                      ? 'max-w-xl mx-auto'
                      : visibleDepartments.length === 2
                      ? 'lg:grid-cols-2'
                      : 'lg:grid-cols-3'
                  }`}
                >
                  {visibleDepartments.map(dept => {
                    const deputies = dept.deputies || [];
                    const staff = dept.staff || [];
                    const hasHead = Boolean(dept.head?.fullName?.trim());
                    const origIndex = orgChart.departments.findIndex(d => d.id === dept.id);
                    const displayDeptTitle = formatNumberedDepartmentName(
                      dept.name,
                      origIndex >= 0 ? origIndex : 0
                    );

                    return (
                      <section key={dept.id} className="flex flex-col items-center">
                        {/* Vertical drop stem connecting department branch to horizontal distributor */}
                        <div
                          className="hidden lg:block w-0.5 h-6 bg-emerald-500/60 dark:bg-emerald-700"
                          aria-hidden="true"
                        />

                        <div className="w-full flex-1 rounded-2xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col">
                          {/* Level 3: Khoa / Phòng Node */}
                          <div className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 p-4 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              <span className="inline-flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Khoa / Phòng</span>
                              </span>
                              <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                {(hasHead ? 1 : 0) + deputies.length + staff.length} nhân sự
                              </span>
                            </div>

                            <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                              {displayDeptTitle}
                            </h3>

                            {dept.description && (
                              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                {dept.description}
                              </p>
                            )}
                          </div>

                          {/* Downward Sequential Hierarchy inside Department */}
                          {(hasHead || deputies.length > 0 || staff.length > 0) && (
                            <div className="pl-5 sm:pl-6 pt-3 relative space-y-3 flex-1">
                              {/* Continuous vertical tree line on the left inside the department */}
                              <div
                                className="absolute left-2.5 top-0 bottom-4 w-px bg-emerald-400/70 dark:bg-emerald-700"
                                aria-hidden="true"
                              />

                              {/* Level 4: Trưởng khoa */}
                              {hasHead && dept.head && (
                                <div className="relative">
                                  <div
                                    className="absolute -left-3.5 sm:-left-3.5 top-5 w-3.5 h-px bg-emerald-400/70 dark:bg-emerald-700"
                                    aria-hidden="true"
                                  />
                                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-teal-300 dark:border-teal-800 p-3.5 space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                                      <span className="inline-flex items-center gap-1.5">
                                        <UserCheck className="w-3.5 h-3.5 shrink-0" />
                                        <span>{dept.head.position || 'Trưởng khoa'}</span>
                                      </span>
                                    </div>
                                    <div className="text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                                      {dept.head.fullName}
                                    </div>
                                    <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-snug">
                                      <span className="text-slate-400 dark:text-slate-500">
                                        Chức danh chuyên môn:{' '}
                                      </span>
                                      <span className="font-semibold">
                                        {dept.head.professionalTitle || 'Đang cập nhật'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Level 5: Phó khoa (nếu có) */}
                              {deputies.length > 0 && (
                                <div className="space-y-2.5">
                                  {deputies.map(dep => (
                                    <div key={dep.id} className="relative">
                                      <div
                                        className="absolute -left-3.5 top-5 w-3.5 h-px bg-emerald-400/70 dark:bg-emerald-700"
                                        aria-hidden="true"
                                      />
                                      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-3.5 space-y-1">
                                        <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                          {dep.position || 'Phó khoa'}
                                        </div>
                                        <div className="text-[15px] font-bold text-slate-900 dark:text-white leading-snug">
                                          {dep.fullName}
                                        </div>
                                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-snug">
                                          <span className="text-slate-400 dark:text-slate-500">
                                            Chức danh chuyên môn:{' '}
                                          </span>
                                          <span className="font-medium">
                                            {dep.professionalTitle || 'Đang cập nhật'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Level 6: Nhân viên của khoa phòng đó */}
                              {staff.length > 0 && (
                                <div className="space-y-2 pt-1">
                                  <div className="relative pl-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <div
                                      className="absolute -left-3.5 top-1/2 w-3.5 h-px bg-emerald-400/70 dark:bg-emerald-700"
                                      aria-hidden="true"
                                    />
                                    <Users className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                    <span>Nhân viên chuyên môn ({staff.length})</span>
                                  </div>

                                  <div className="space-y-2 pl-3 relative">
                                    <div
                                      className="absolute left-0 top-0 bottom-4 w-px bg-slate-300 dark:bg-slate-700"
                                      aria-hidden="true"
                                    />
                                    {staff.map(member => (
                                      <div key={member.id} className="relative">
                                        <div
                                          className="absolute -left-3 top-4 w-3 h-px bg-slate-300 dark:bg-slate-700"
                                          aria-hidden="true"
                                        />
                                        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 space-y-0.5">
                                          <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                                              {member.fullName}
                                            </span>
                                            {member.position && member.position !== 'Nhân viên' && (
                                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                                                {member.position}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                                            <span className="text-slate-400 dark:text-slate-500">
                                              Chức danh:{' '}
                                            </span>
                                            <span>
                                              {member.professionalTitle || 'Nhân viên y tế'}
                                            </span>
                                          </div>
                                          {member.phone && (
                                            <div className="text-xs text-emerald-700 dark:text-emerald-400 font-mono tabular-nums flex items-center gap-1 pt-0.5">
                                              <Phone className="w-3 h-3 shrink-0" />
                                              <span>{member.phone}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </RevealOnScroll>
      )}

      {/* Mobile Bottom Admin Action Buttons */}
      {isAdmin && (
        <div className="lg:hidden rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Công cụ quản trị Sơ đồ tổ chức
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={handleDownloadSampleExcel}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 transition inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tải mẫu Excel (6 sheet)</span>
            </button>

            <label className="w-full px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap">
              <Upload className="w-4 h-4 shrink-0" />
              <span>Import Excel</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImportExcelFile}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={openEditorModal}
              className="w-full px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Chỉnh sửa sơ đồ</span>
            </button>
          </div>

          {!hasPersistedOrgData && (
            <button
              type="button"
              disabled={saving}
              onClick={handleApplyDefaultStructure}
              className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 dark:text-emerald-200 transition inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Lưu cấu trúc mặc định vào hệ thống</span>
            </button>
          )}
        </div>
      )}

      {/* Admin Editor Modal */}
      {showEditor && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Network className="w-5 h-5 text-emerald-600" />
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  Cấu Hình Sơ Đồ Tổ Chức Trạm Y Tế
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCurrentExcel}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Xuất Excel (6 sheet)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    showConfirm({
                      title: 'Khôi phục 5 Khoa/Phòng mặc định?',
                      message:
                        'Thao tác này sẽ nạp lại Ban Giám đốc và 5 Khoa/Phòng chuẩn vào khung chỉnh sửa (bấm Lưu để áp dụng).',
                      confirmText: 'Khôi phục',
                      cancelText: 'Hủy',
                      onConfirm: () => {
                        setDraftChart(createDefaultOrgChart());
                        showToast('info', 'Đã nạp 5 Khoa/Phòng mặc định vào trình chỉnh sửa');
                      },
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-xs font-semibold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Mặc định 5 Khoa/Phòng</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveOrgChart} className="space-y-6 text-xs sm:text-sm">
              {/* Section 1: Giám đốc */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  1. Giám Đốc / Lãnh Đạo Cao Nhất
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Họ và tên Giám đốc
                    </label>
                    <input
                      type="text"
                      value={draftChart.director?.fullName || ''}
                      onChange={e =>
                        setDraftChart(prev => ({
                          ...prev,
                          director: {
                            ...(prev.director || createEmptyMember('Giám đốc')),
                            fullName: e.target.value,
                          },
                        }))
                      }
                      placeholder="Ví dụ: Họ và tên Giám đốc"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Chức danh chuyên môn
                    </label>
                    <input
                      type="text"
                      value={draftChart.director?.professionalTitle || ''}
                      onChange={e =>
                        setDraftChart(prev => ({
                          ...prev,
                          director: {
                            ...(prev.director || createEmptyMember('Giám đốc')),
                            professionalTitle: e.target.value,
                          },
                        }))
                      }
                      placeholder="Bác sĩ Chuyên khoa I · Y tế công cộng"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Số điện thoại liên hệ
                    </label>
                    <input
                      type="text"
                      value={draftChart.director?.phone || ''}
                      onChange={e =>
                        setDraftChart(prev => ({
                          ...prev,
                          director: {
                            ...(prev.director || createEmptyMember('Giám đốc')),
                            phone: e.target.value,
                          },
                        }))
                      }
                      placeholder="028 xxxx xxxx"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Phó Giám đốc */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    2. Phó Giám Đốc ({draftChart.deputyDirectors.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftChart(prev => ({
                        ...prev,
                        deputyDirectors: [
                          ...prev.deputyDirectors,
                          createEmptyMember('Phó Giám đốc'),
                        ],
                      }))
                    }
                    className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm Phó Giám đốc</span>
                  </button>
                </div>

                {draftChart.deputyDirectors.length === 0 ? (
                  <p className="text-xs text-slate-500">Chưa có Phó Giám đốc.</p>
                ) : (
                  <div className="space-y-2.5">
                    {draftChart.deputyDirectors.map((dd, ddIdx) => (
                      <div
                        key={dd.id}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700"
                      >
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            value={dd.fullName}
                            onChange={e =>
                              setDraftChart(prev => ({
                                ...prev,
                                deputyDirectors: prev.deputyDirectors.map((item, i) =>
                                  i === ddIdx ? { ...item, fullName: e.target.value } : item
                                ),
                              }))
                            }
                            placeholder="Họ tên Phó Giám đốc..."
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                          />
                        </div>
                        <div className="sm:col-span-6">
                          <input
                            type="text"
                            value={dd.professionalTitle}
                            onChange={e =>
                              setDraftChart(prev => ({
                                ...prev,
                                deputyDirectors: prev.deputyDirectors.map((item, i) =>
                                  i === ddIdx
                                    ? { ...item, professionalTitle: e.target.value }
                                    : item
                                ),
                              }))
                            }
                            placeholder="Chức danh chuyên môn (vd: BS CKI Nội tổng hợp)..."
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                          />
                        </div>
                        <div className="sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftChart(prev => ({
                                ...prev,
                                deputyDirectors: prev.deputyDirectors.filter((_, i) => i !== ddIdx),
                              }))
                            }
                            className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                            title="Xóa"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 3: Các Khoa / Phòng -> Trưởng khoa -> Phó khoa -> Nhân viên */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    3. Các Khoa / Phòng Chuyên Môn ({draftChart.departments.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftChart(prev => ({
                        ...prev,
                        departments: [...prev.departments, createEmptyDepartment()],
                      }))
                    }
                    className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm Khoa / Phòng</span>
                  </button>
                </div>

                {draftChart.departments.map((dept, deptIdx) => {
                  const moveDept = (dir: -1 | 1) => {
                    const targetIdx = deptIdx + dir;
                    if (targetIdx < 0 || targetIdx >= draftChart.departments.length) return;
                    setDraftChart(prev => {
                      const next = [...prev.departments];
                      const [moved] = next.splice(deptIdx, 1);
                      next.splice(targetIdx, 0, moved);
                      return { ...prev, departments: next };
                    });
                  };

                  return (
                  <div
                    key={dept.id}
                    className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums w-6">
                          #{deptIdx + 1}
                        </span>
                        <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                          <button
                            type="button"
                            disabled={deptIdx === 0}
                            onClick={() => moveDept(-1)}
                            className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition"
                            title="Di chuyển lên"
                            aria-label="Di chuyển khoa phòng lên"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                          <button
                            type="button"
                            disabled={deptIdx === draftChart.departments.length - 1}
                            onClick={() => moveDept(1)}
                            className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition"
                            title="Di chuyển xuống"
                            aria-label="Di chuyển khoa phòng xuống"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                        <input
                          type="text"
                          value={dept.name}
                          onChange={e =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx ? { ...d, name: e.target.value } : d
                              ),
                            }))
                          }
                          placeholder={`Tên Khoa / Phòng #${deptIdx + 1}...`}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-xs sm:text-sm"
                        />
                        <input
                          type="text"
                          value={dept.description || ''}
                          onChange={e =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx ? { ...d, description: e.target.value } : d
                              ),
                            }))
                          }
                          placeholder="Chức năng tóm tắt của khoa/phòng..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setDraftChart(prev => ({
                            ...prev,
                            departments: prev.departments.filter((_, i) => i !== deptIdx),
                          }))
                        }
                        className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl cursor-pointer shrink-0 self-end sm:self-center"
                        title="Xóa Khoa / Phòng"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Trưởng khoa */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-teal-700 dark:text-teal-400">
                        Trưởng khoa / Trưởng phòng
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <input
                          type="text"
                          value={dept.head?.fullName || ''}
                          onChange={e =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx
                                  ? {
                                      ...d,
                                      head: {
                                        ...(d.head || createEmptyMember('Trưởng khoa')),
                                        fullName: e.target.value,
                                      },
                                    }
                                  : d
                              ),
                            }))
                          }
                          placeholder="Họ và tên Trưởng khoa..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                        />
                        <input
                          type="text"
                          value={dept.head?.position || 'Trưởng khoa'}
                          onChange={e =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx
                                  ? {
                                      ...d,
                                      head: {
                                        ...(d.head || createEmptyMember('Trưởng khoa')),
                                        position: e.target.value,
                                      },
                                    }
                                  : d
                              ),
                            }))
                          }
                          placeholder="Chức vụ (Trưởng khoa / Trưởng phòng)"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                        <input
                          type="text"
                          value={dept.head?.professionalTitle || ''}
                          onChange={e =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx
                                  ? {
                                      ...d,
                                      head: {
                                        ...(d.head || createEmptyMember('Trưởng khoa')),
                                        professionalTitle: e.target.value,
                                      },
                                    }
                                  : d
                              ),
                            }))
                          }
                          placeholder="Chức danh chuyên môn (vd: Bác sĩ Đa khoa)..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                      </div>
                    </div>

                    {/* Phó khoa */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          Phó khoa / Phó phòng ({(dept.deputies || []).length})
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx
                                  ? {
                                      ...d,
                                      deputies: [...(d.deputies || []), createEmptyMember('Phó khoa')],
                                    }
                                  : d
                              ),
                            }))
                          }
                          className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Thêm Phó khoa
                        </button>
                      </div>

                      {(dept.deputies || []).map((dep, depIdx) => (
                        <div key={dep.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={dep.fullName}
                              onChange={e =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          deputies: (d.deputies || []).map((p, j) =>
                                            j === depIdx ? { ...p, fullName: e.target.value } : p
                                          ),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              placeholder="Họ tên Phó khoa..."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <input
                              type="text"
                              value={dep.position}
                              onChange={e =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          deputies: (d.deputies || []).map((p, j) =>
                                            j === depIdx ? { ...p, position: e.target.value } : p
                                          ),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              placeholder="Phó khoa / Phó phòng"
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={dep.professionalTitle}
                              onChange={e =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          deputies: (d.deputies || []).map((p, j) =>
                                            j === depIdx
                                              ? { ...p, professionalTitle: e.target.value }
                                              : p
                                          ),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              placeholder="Chức danh chuyên môn..."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                            />
                          </div>
                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          deputies: (d.deputies || []).filter((_, j) => j !== depIdx),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Nhân viên của khoa phòng */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          Nhân viên của khoa / phòng ({(dept.staff || []).length})
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftChart(prev => ({
                              ...prev,
                              departments: prev.departments.map((d, i) =>
                                i === deptIdx
                                  ? {
                                      ...d,
                                      staff: [...(d.staff || []), createEmptyMember('Nhân viên')],
                                    }
                                  : d
                              ),
                            }))
                          }
                          className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Thêm nhân viên
                        </button>
                      </div>

                      {(dept.staff || []).map((st, stIdx) => (
                        <div key={st.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={st.fullName}
                              onChange={e =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          staff: d.staff.map((m, j) =>
                                            j === stIdx ? { ...m, fullName: e.target.value } : m
                                          ),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              placeholder="Họ và tên nhân viên..."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                            />
                          </div>
                          <div className="sm:col-span-5">
                            <input
                              type="text"
                              value={st.professionalTitle}
                              onChange={e =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          staff: d.staff.map((m, j) =>
                                            j === stIdx
                                              ? { ...m, professionalTitle: e.target.value }
                                              : m
                                          ),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              placeholder="Chức danh chuyên môn (vd: Cử nhân Điều dưỡng)..."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <input
                              type="text"
                              value={st.phone || ''}
                              onChange={e =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          staff: d.staff.map((m, j) =>
                                            j === stIdx ? { ...m, phone: e.target.value } : m
                                          ),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              placeholder="SĐT (tuỳ chọn)"
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                            />
                          </div>
                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftChart(prev => ({
                                  ...prev,
                                  departments: prev.departments.map((d, i) =>
                                    i === deptIdx
                                      ? {
                                          ...d,
                                          staff: d.staff.filter((_, j) => j !== stIdx),
                                        }
                                      : d
                                  ),
                                }))
                              }
                              className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Lưu sơ đồ tổ chức</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Multi-Sheet Excel Import Preview Modal */}
      {importPreview && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                    Xem Trước Import Sơ Đồ Tổ Chức (Excel)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Đã đọc {importPreview.sheetSummaries.length} sheet theo từng Ban Giám đốc / Khoa / Phòng
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-3">
              {importPreview.sheetSummaries.map((item, idx) => (
                <div
                  key={`${item.sheetName}_${idx}`}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                        {item.targetLabel}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        (Sheet: {item.sheetName})
                      </span>
                    </div>
                    {item.isLeadership ? (
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        Giám đốc: <strong>{item.directorName || 'Chưa có'}</strong> · Phó Giám đốc:{' '}
                        <strong>{item.deputyDirectorCount || 0}</strong>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        Trưởng khoa/phòng: <strong>{item.headName || 'Chưa có'}</strong> · Phó:{' '}
                        <strong>{item.deputiesCount}</strong> · Nhân viên: <strong>{item.staffCount}</strong>
                      </div>
                    )}
                  </div>

                  <span className="px-3 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums shrink-0 self-start sm:self-center">
                    {item.totalMembers} nhân sự
                  </span>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleLoadImportIntoEditor}
                className="px-4 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-xs font-bold text-blue-700 dark:text-blue-300 cursor-pointer"
              >
                Chỉnh sửa trước khi lưu
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmSaveImport}
                className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Xác nhận Import &amp; Lưu ngay</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
