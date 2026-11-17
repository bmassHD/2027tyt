import * as XLSX from 'xlsx';
import {
  OrgChartConfig,
  OrgChartDepartment,
  OrgChartMember,
} from '../types';

export interface OrgDepartmentSheetSpec {
  index: number;
  id: string;
  sheetName: string;
  name: string;
  defaultHeadPosition: string;
  defaultDeputyPosition: string;
  description: string;
  keywords: string[];
}

export const ORG_LEADERSHIP_SHEET_NAME = '0. Ban giam doc';

export const ORG_DEFAULT_DEPARTMENT_SPECS: OrgDepartmentSheetSpec[] = [
  {
    index: 1,
    id: 'dept_hctcns',
    sheetName: '1. Hanh chinh - TC - NS',
    name: 'Hành chính – Tài chính – Nhân sự',
    defaultHeadPosition: 'Trưởng phòng',
    defaultDeputyPosition: 'Phó phòng',
    description:
      'Công tác tổ chức cán bộ, hành chính văn thư, tài chính kế toán, tổng hợp báo cáo và quản trị cơ sở vật chất.',
    keywords: ['hanh chinh', 'tai chinh', 'nhan su', 'tc - ns', 'hctc'],
  },
  {
    index: 2,
    id: 'dept_dstebtxh',
    sheetName: '2. Dan so - Tre em - BTXH',
    name: 'Dân số – Trẻ em – Bảo trợ xã hội',
    defaultHeadPosition: 'Trưởng khoa',
    defaultDeputyPosition: 'Phó khoa',
    description:
      'Quản lý công tác dân số - kế hoạch hóa gia đình, chăm sóc sức khỏe trẻ em, người cao tuổi và bảo trợ xã hội.',
    keywords: ['dan so', 'tre em', 'bao tro', 'btxh'],
  },
  {
    index: 3,
    id: 'dept_pbattp',
    sheetName: '3. Phong benh - ATTP',
    name: 'Phòng bệnh – An toàn thực phẩm',
    defaultHeadPosition: 'Trưởng khoa',
    defaultDeputyPosition: 'Phó khoa',
    description:
      'Tiêm chủng mở rộng, giám sát phòng chống dịch bệnh truyền nhiễm, y tế học đường và bảo đảm an toàn thực phẩm.',
    keywords: ['phong benh', 'an toan thuc pham', 'attp', 'kiem soat benh'],
  },
  {
    index: 4,
    id: 'dept_kbcb',
    sheetName: '4. Kham benh - Chua benh',
    name: 'Khám bệnh – Chữa bệnh',
    defaultHeadPosition: 'Trưởng khoa',
    defaultDeputyPosition: 'Phó khoa',
    description:
      'Khám chữa bệnh BHYT ban đầu, sơ cấp cứu 24/7, chăm sóc sức khỏe sinh sản và quản lý bệnh không lây nhiễm.',
    keywords: ['kham benh', 'chua benh', 'cap cuu'],
  },
  {
    index: 5,
    id: 'dept_duoctbytcls',
    sheetName: '5. Duoc - TBYT - CLS',
    name: 'Dược – Thiết bị y tế – Cận lâm sàng',
    defaultHeadPosition: 'Trưởng khoa',
    defaultDeputyPosition: 'Phó khoa',
    description:
      'Cung ứng, bảo quản và cấp phát thuốc thiết yếu; quản lý trang thiết bị y tế, xét nghiệm và chẩn đoán hình ảnh cơ bản.',
    keywords: ['duoc', 'thiet bi', 'tbyt', 'can lam sang', 'cls'],
  },
];

export const DEFAULT_ORG_CHART: OrgChartConfig = {
  deputyDirectors: [],
  departments: [],
};

export function createEmptyOrgChart(): OrgChartConfig {
  return {
    deputyDirectors: [],
    departments: [],
  };
}

export function createDefaultOrgChart(): OrgChartConfig {
  return {
    director: undefined,
    deputyDirectors: [],
    departments: ORG_DEFAULT_DEPARTMENT_SPECS.map(spec => ({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      head: undefined,
      deputies: [],
      staff: [],
    })),
  };
}

function normalizeVietnameseText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toSafeExcelSheetName(name: string, used: Set<string>): string {
  const sanitized = name.replace(/[:\\/?*[\]]/g, '-').trim() || 'Sheet';
  let candidate = sanitized.slice(0, 31);
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = `${sanitized.slice(0, 31 - suffix.length)}${suffix}`;
    counter++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function exportOrgChartWorkbook(chart: OrgChartConfig, fileName: string): void {
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  // Sheet 0: Ban Giám đốc
  const leadershipRows: Array<Record<string, unknown>> = [];
  if (chart.director?.fullName?.trim()) {
    leadershipRows.push({
      STT: 1,
      'Vai trò': 'Giám đốc',
      'Họ và tên': chart.director.fullName,
      'Số CCCD': chart.director.cccd || '',
      'Chức vụ': chart.director.position || 'Giám đốc',
      'Chức danh chuyên môn': chart.director.professionalTitle || '',
      'Số điện thoại': chart.director.phone || '',
      'Ghi chú': chart.director.notes || (chart.director.isSyncedFromUser ? 'Đã đồng bộ' : ''),
    });
  }
  (chart.deputyDirectors || []).forEach(dd => {
    leadershipRows.push({
      STT: leadershipRows.length + 1,
      'Vai trò': 'Phó Giám đốc',
      'Họ và tên': dd.fullName,
      'Số CCCD': dd.cccd || '',
      'Chức vụ': dd.position || 'Phó Giám đốc',
      'Chức danh chuyên môn': dd.professionalTitle || '',
      'Số điện thoại': dd.phone || '',
      'Ghi chú': dd.notes || (dd.isSyncedFromUser ? 'Đã đồng bộ' : ''),
    });
  });

  if (leadershipRows.length === 0) {
    leadershipRows.push({
      STT: 1,
      'Vai trò': 'Giám đốc',
      'Họ và tên': '',
      'Số CCCD': '',
      'Chức vụ': 'Giám đốc',
      'Chức danh chuyên môn': '',
      'Số điện thoại': '',
      'Ghi chú': '',
    });
  }

  const ws0 = XLSX.utils.json_to_sheet(leadershipRows);
  ws0['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 28 },
    { wch: 16 },
    { wch: 18 },
    { wch: 40 },
    { wch: 16 },
    { wch: 24 },
  ];
  const sheet0Name = toSafeExcelSheetName(ORG_LEADERSHIP_SHEET_NAME, usedSheetNames);
  XLSX.utils.book_append_sheet(wb, ws0, sheet0Name);

  // Sheets 1..N: Each Department has its own dedicated sheet
  const depts = chart.departments || [];
  depts.forEach((dept, idx) => {
    const matchedSpec = ORG_DEFAULT_DEPARTMENT_SPECS.find(
      spec =>
        spec.id === dept.id ||
        normalizeVietnameseText(spec.name) === normalizeVietnameseText(dept.name)
    );

    const preferredTabName = matchedSpec
      ? matchedSpec.sheetName
      : `${idx + 1}. ${dept.name}`;
    const sheetName = toSafeExcelSheetName(preferredTabName, usedSheetNames);

    const rows: Array<Record<string, unknown>> = [];
    if (dept.head?.fullName?.trim()) {
      rows.push({
        STT: rows.length + 1,
        'Vai trò': 'Trưởng khoa',
        'Họ và tên': dept.head.fullName,
        'Số CCCD': dept.head.cccd || '',
        'Chức vụ': dept.head.position || matchedSpec?.defaultHeadPosition || 'Trưởng khoa',
        'Chức danh chuyên môn': dept.head.professionalTitle || '',
        'Số điện thoại': dept.head.phone || '',
        'Ghi chú': dept.head.notes || (dept.head.isSyncedFromUser ? 'Đã đồng bộ' : ''),
      });
    }

    (dept.deputies || []).forEach(dep => {
      rows.push({
        STT: rows.length + 1,
        'Vai trò': 'Phó khoa',
        'Họ và tên': dep.fullName,
        'Số CCCD': dep.cccd || '',
        'Chức vụ': dep.position || matchedSpec?.defaultDeputyPosition || 'Phó khoa',
        'Chức danh chuyên môn': dep.professionalTitle || '',
        'Số điện thoại': dep.phone || '',
        'Ghi chú': dep.notes || (dep.isSyncedFromUser ? 'Đã đồng bộ' : ''),
      });
    });

    (dept.staff || []).forEach(st => {
      rows.push({
        STT: rows.length + 1,
        'Vai trò': 'Nhân viên',
        'Họ và tên': st.fullName,
        'Số CCCD': st.cccd || '',
        'Chức vụ': st.position || 'Nhân viên',
        'Chức danh chuyên môn': st.professionalTitle || '',
        'Số điện thoại': st.phone || '',
        'Ghi chú': st.notes || (st.isSyncedFromUser ? 'Đã đồng bộ' : ''),
      });
    });

    if (rows.length === 0) {
      rows.push(
        {
          STT: 1,
          'Vai trò': 'Trưởng khoa',
          'Họ và tên': '',
          'Số CCCD': '',
          'Chức vụ': matchedSpec?.defaultHeadPosition || 'Trưởng khoa',
          'Chức danh chuyên môn': '',
          'Số điện thoại': '',
          'Ghi chú': '',
        },
        {
          STT: 2,
          'Vai trò': 'Nhân viên',
          'Họ và tên': '',
          'Số CCCD': '',
          'Chức vụ': 'Nhân viên',
          'Chức danh chuyên môn': '',
          'Số điện thoại': '',
          'Ghi chú': '',
        }
      );
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 16 },
      { wch: 28 },
      { wch: 16 },
      { wch: 18 },
      { wch: 42 },
      { wch: 16 },
      { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, fileName);
}

export interface OrgExcelSheetSummary {
  sheetName: string;
  targetLabel: string;
  isLeadership: boolean;
  directorName?: string;
  deputyDirectorCount?: number;
  headName?: string;
  deputiesCount: number;
  staffCount: number;
  totalMembers: number;
}

export interface ParsedOrgChartImportResult {
  orgChart: OrgChartConfig;
  sheetSummaries: OrgExcelSheetSummary[];
}

function getRowField(kv: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (kv[k] && kv[k].trim()) return kv[k].trim();
  }
  return '';
}

function matchDepartmentSpec(sheetName: string): OrgDepartmentSheetSpec | undefined {
  const norm = normalizeVietnameseText(sheetName);
  // Check leading index 1..5
  const numMatch = sheetName.trim().match(/^(\d+)\s*[.\-_:]/);
  if (numMatch) {
    const idx = Number(numMatch[1]);
    const byIdx = ORG_DEFAULT_DEPARTMENT_SPECS.find(s => s.index === idx);
    if (byIdx) return byIdx;
  }
  return ORG_DEFAULT_DEPARTMENT_SPECS.find(
    spec =>
      normalizeVietnameseText(spec.sheetName) === norm ||
      normalizeVietnameseText(spec.name) === norm ||
      spec.keywords.some(kw => norm.includes(kw))
  );
}

export function parseOrgChartWorkbook(
  buffer: ArrayBuffer,
  existingChart?: OrgChartConfig
): ParsedOrgChartImportResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('File Excel không chứa sheet dữ liệu nào.');
  }

  let parsedDirector: OrgChartMember | undefined;
  const parsedDeputyDirectors: OrgChartMember[] = [];
  const deptMap = new Map<string, OrgChartDepartment>();
  const extraDepartments: OrgChartDepartment[] = [];
  const sheetSummaries: OrgExcelSheetSummary[] = [];

  // Pre-seed the 5 standard departments so order 1..5 is preserved even if a sheet was omitted or empty
  ORG_DEFAULT_DEPARTMENT_SPECS.forEach(spec => {
    const existingMatch = existingChart?.departments?.find(
      d => d.id === spec.id || normalizeVietnameseText(d.name) === normalizeVietnameseText(spec.name)
    );
    deptMap.set(spec.id, {
      id: existingMatch?.id || spec.id,
      name: spec.name,
      description: existingMatch?.description || spec.description,
      head: undefined,
      deputies: [],
      staff: [],
    });
  });

  wb.SheetNames.forEach((sheetName, sheetOrder) => {
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    const normSheet = normalizeVietnameseText(sheetName);
    const isLeadershipSheet =
      /^0\s*[.\-_:]/.test(sheetName.trim()) ||
      normSheet.includes('ban giam doc') ||
      normSheet === 'giam doc';

    const parsedRows = rawRows
      .map((raw, rowIdx) => {
        const kv: Record<string, string> = {};
        Object.entries(raw).forEach(([k, v]) => {
          kv[normalizeVietnameseText(k)] = String(v ?? '').trim();
        });
        const fullName = getRowField(
          kv,
          'ho va ten',
          'ho ten',
          'ten can bo',
          'ten nhan vien',
          'nhan su',
          'name',
          'full name'
        );
        if (!fullName) return null;

        const roleRaw = getRowField(kv, 'vai tro', 'role', 'phan loai', 'nhom');
        const positionRaw = getRowField(kv, 'chuc vu', 'position', 'vi tri');
        const professionalTitle = getRowField(
          kv,
          'chuc danh chuyen mon',
          'chuc danh',
          'trinh do',
          'chuyen mon',
          'professional title'
        );
        const cccd = getRowField(kv, 'so cccd', 'cccd', 'cmnd', 'ma dinh danh', 'citizen id', 'citizenid');
        const phone = getRowField(kv, 'so dien thoai', 'dien thoai', 'sdt', 'phone');
        const notes = getRowField(kv, 'ghi chu', 'note', 'notes');

        return {
          rowIdx,
          fullName,
          cccd: cccd ? cccd.replace(/[\s.-]/g, '').toUpperCase() : undefined,
          roleRaw,
          positionRaw,
          professionalTitle,
          phone: phone || undefined,
          notes: notes || undefined,
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    if (isLeadershipSheet) {
      let ddCount = 0;
      let dirName: string | undefined;

      parsedRows.forEach(row => {
        const combinedRole = normalizeVietnameseText(`${row.roleRaw} ${row.positionRaw}`);
        const isDeputy = combinedRole.includes('pho');
        if (!isDeputy && (combinedRole.includes('giam doc') || !parsedDirector)) {
          parsedDirector = {
            id: `dir_imp_${Date.now()}_${row.rowIdx}`,
            fullName: row.fullName,
            cccd: row.cccd,
            position: row.positionRaw || 'Giám đốc',
            professionalTitle: row.professionalTitle,
            phone: row.phone,
            notes: row.notes,
          };
          dirName = row.fullName;
        } else {
          parsedDeputyDirectors.push({
            id: `dd_imp_${Date.now()}_${sheetOrder}_${row.rowIdx}`,
            fullName: row.fullName,
            cccd: row.cccd,
            position: row.positionRaw || 'Phó Giám đốc',
            professionalTitle: row.professionalTitle,
            phone: row.phone,
            notes: row.notes,
          });
          ddCount++;
        }
      });

      sheetSummaries.push({
        sheetName,
        targetLabel: 'Ban giám đốc',
        isLeadership: true,
        directorName: dirName,
        deputyDirectorCount: ddCount,
        deputiesCount: ddCount,
        staffCount: 0,
        totalMembers: (dirName ? 1 : 0) + ddCount,
      });
      return;
    }

    const spec = matchDepartmentSpec(sheetName);
    const cleanedDeptName = spec
      ? spec.name
      : sheetName.replace(/^\d+\s*[.\-_:]*\s*/, '').trim() || sheetName;

    let targetDept: OrgChartDepartment;
    if (spec && deptMap.has(spec.id)) {
      targetDept = deptMap.get(spec.id)!;
    } else {
      targetDept = {
        id: `dept_imp_${Date.now()}_${sheetOrder}`,
        name: cleanedDeptName,
        description: undefined,
        head: undefined,
        deputies: [],
        staff: [],
      };
      extraDepartments.push(targetDept);
    }

    const deputies: OrgChartMember[] = [];
    const staff: OrgChartMember[] = [];
    let head: OrgChartMember | undefined;

    parsedRows.forEach(row => {
      const combinedRole = normalizeVietnameseText(`${row.roleRaw} ${row.positionRaw}`);
      const isDeputy =
        combinedRole.includes('pho khoa') ||
        combinedRole.includes('pho phong') ||
        combinedRole.includes('pho truong') ||
        combinedRole.startsWith('pho');
      const isHead =
        !isDeputy &&
        (combinedRole.includes('truong khoa') ||
          combinedRole.includes('truong phong') ||
          combinedRole.includes('phu trach') ||
          combinedRole === 'truong');

      if (isHead && !head) {
        head = {
          id: `head_imp_${Date.now()}_${sheetOrder}_${row.rowIdx}`,
          fullName: row.fullName,
          cccd: row.cccd,
          position: row.positionRaw || spec?.defaultHeadPosition || 'Trưởng khoa',
          professionalTitle: row.professionalTitle,
          phone: row.phone,
          notes: row.notes,
        };
      } else if (isDeputy) {
        deputies.push({
          id: `dep_imp_${Date.now()}_${sheetOrder}_${row.rowIdx}`,
          fullName: row.fullName,
          cccd: row.cccd,
          position: row.positionRaw || spec?.defaultDeputyPosition || 'Phó khoa',
          professionalTitle: row.professionalTitle,
          phone: row.phone,
          notes: row.notes,
        });
      } else {
        staff.push({
          id: `st_imp_${Date.now()}_${sheetOrder}_${row.rowIdx}`,
          fullName: row.fullName,
          cccd: row.cccd,
          position: row.positionRaw || 'Nhân viên',
          professionalTitle: row.professionalTitle,
          phone: row.phone,
          notes: row.notes,
        });
      }
    });

    targetDept.head = head;
    targetDept.deputies = deputies;
    targetDept.staff = staff;

    sheetSummaries.push({
      sheetName,
      targetLabel: spec ? `${spec.index}. ${spec.name}` : cleanedDeptName,
      isLeadership: false,
      headName: head?.fullName,
      deputiesCount: deputies.length,
      staffCount: staff.length,
      totalMembers: (head ? 1 : 0) + deputies.length + staff.length,
    });
  });

  const departments: OrgChartDepartment[] = [
    ...ORG_DEFAULT_DEPARTMENT_SPECS.map(spec => deptMap.get(spec.id)!),
    ...extraDepartments,
  ];

  return {
    orgChart: {
      director: parsedDirector,
      deputyDirectors: parsedDeputyDirectors,
      departments,
      updatedAt: new Date().toISOString(),
    },
    sheetSummaries,
  };
}
