import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { cleanDataForFirestore } from './firebaseService';
import {
  OrgChartConfig,
  OrgChartDepartment,
  OrgChartMember,
  RoleType,
  UserProfile,
} from '../types';

export type OrgRoleKey = 'director' | 'deputy_director' | 'head' | 'deputy' | 'staff';

export function normalizeCccd(value?: string | null): string {
  return (value || '').replace(/[\s.-]/g, '').trim().toUpperCase();
}

export function normalizePhone(value?: string | null): string {
  return (value || '').replace(/[\s.-]/g, '').trim();
}

export function normalizeTextNoDiacritics(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function maskCccdForPublic(cccd?: string | null): string {
  const clean = normalizeCccd(cccd);
  if (!clean) return '';
  if (clean.length <= 6) return '••••••';
  return `${clean.slice(0, 3)}${'•'.repeat(Math.max(4, clean.length - 7))}${clean.slice(-4)}`;
}

export function stripDepartmentNumberPrefix(name?: string | null): string {
  return (name || '').replace(/^\d+\s*[.\-_:]\s*/, '').trim();
}

export function cloneOrgChartConfig(source: OrgChartConfig): OrgChartConfig {
  return {
    director: source.director ? { ...source.director } : undefined,
    deputyDirectors: (source.deputyDirectors || []).map(d => ({ ...d })),
    departments: (source.departments || []).map(dept => ({
      ...dept,
      head: dept.head ? { ...dept.head } : undefined,
      deputies: (dept.deputies || []).map(p => ({ ...p })),
      staff: (dept.staff || []).map(s => ({ ...s })),
    })),
    excludedSyncedUids: Array.isArray(source.excludedSyncedUids)
      ? [...source.excludedSyncedUids]
      : undefined,
    updatedAt: source.updatedAt,
  };
}

export function inferPositionFromUserRole(role?: RoleType, explicitPosition?: string): string {
  if (explicitPosition?.trim()) return explicitPosition.trim();
  switch (role) {
    case 'leadership':
      return 'Phó Giám đốc';
    default:
      return 'Nhân viên';
  }
}

export function inferProfessionalTitleFromUser(user: UserProfile): string {
  if (user.qualification?.trim()) return user.qualification.trim();
  switch (user.role) {
    case 'doctor':
      return 'Bác sĩ';
    case 'nurse':
      return 'Điều dưỡng';
    case 'communicator':
      return 'Cán bộ truyền thông y tế';
    case 'leadership':
      return 'Lãnh đạo Trạm Y tế';
    case 'staff':
      return 'Nhân viên y tế';
    default:
      return '';
  }
}

export function inferUserRoleFromOrgMember(
  roleKey: OrgRoleKey,
  position?: string,
  professionalTitle?: string,
  fallbackRole: RoleType = 'staff'
): RoleType {
  if (roleKey === 'director' || roleKey === 'deputy_director') {
    return 'leadership';
  }
  const combined = normalizeTextNoDiacritics(`${position || ''} ${professionalTitle || ''}`);
  if (combined.includes('bac si') || combined.includes('bs ')) return 'doctor';
  if (combined.includes('dieu duong') || combined.includes('ho sinh') || combined.includes('y si')) {
    return 'nurse';
  }
  if (combined.includes('truyen thong')) return 'communicator';
  return fallbackRole === 'citizen' ? 'staff' : fallbackRole;
}

/**
 * Xác định tài khoản người dùng có đủ điều kiện tự động đồng bộ vào danh sách Nhân lực hay không.
 */
export function shouldUserAutoSyncToOrgChart(user: UserProfile): boolean {
  if (!user || user.status === 'suspended') return false;
  if (user.accountType === 'employee') return true;
  if (['doctor', 'nurse', 'communicator', 'staff', 'leadership'].includes(user.role)) {
    return true;
  }
  if (
    user.accountType === 'admin' &&
    Boolean(user.department?.trim() || user.position?.trim() || normalizeCccd(user.citizenId))
  ) {
    return true;
  }
  return false;
}

/**
 * Tìm UserProfile tương ứng với một nhân sự trong OrgChart (ưu tiên linkedUid -> CCCD -> Họ tên + SĐT).
 */
export function findMatchingUserForMember(
  member: Pick<OrgChartMember, 'linkedUid' | 'cccd' | 'fullName' | 'phone'>,
  users: UserProfile[]
): UserProfile | undefined {
  if (!users || users.length === 0) return undefined;

  if (member.linkedUid) {
    const byUid = users.find(u => u.uid === member.linkedUid);
    if (byUid) return byUid;
  }

  const memberCccd = normalizeCccd(member.cccd);
  if (memberCccd.length >= 6) {
    const byCccd = users.find(u => normalizeCccd(u.citizenId) === memberCccd);
    if (byCccd) return byCccd;
  }

  const memberName = normalizeTextNoDiacritics(member.fullName);
  const memberPhone = normalizePhone(member.phone);
  if (memberName && memberPhone.length >= 8) {
    const byNamePhone = users.find(
      u =>
        normalizeTextNoDiacritics(u.displayName) === memberName &&
        normalizePhone(u.phoneNumber) === memberPhone
    );
    if (byNamePhone) return byNamePhone;
  }

  if (memberName) {
    const staffMatches = users.filter(u => {
      if (u.accountType === 'citizen' && u.role === 'citizen') return false;
      if (normalizeTextNoDiacritics(u.displayName) !== memberName) return false;
      const uCccd = normalizeCccd(u.citizenId);
      if (memberCccd && uCccd && memberCccd !== uCccd) return false;
      return true;
    });
    if (staffMatches.length === 1) return staffMatches[0];
  }

  return undefined;
}

interface ChartMemberMatch {
  unitId: string; // 'leadership' | dept.id
  roleKey: OrgRoleKey;
  member: OrgChartMember;
}

export function findMemberInOrgChartForUser(
  chart: OrgChartConfig,
  user: UserProfile
): ChartMemberMatch | null {
  const userCccd = normalizeCccd(user.citizenId);
  const userName = normalizeTextNoDiacritics(user.displayName);
  const userPhone = normalizePhone(user.phoneNumber);

  const candidates: ChartMemberMatch[] = [];
  if (chart.director) {
    candidates.push({ unitId: 'leadership', roleKey: 'director', member: chart.director });
  }
  (chart.deputyDirectors || []).forEach(dd => {
    candidates.push({ unitId: 'leadership', roleKey: 'deputy_director', member: dd });
  });
  (chart.departments || []).forEach(dept => {
    if (dept.head) {
      candidates.push({ unitId: dept.id, roleKey: 'head', member: dept.head });
    }
    (dept.deputies || []).forEach(dep => {
      candidates.push({ unitId: dept.id, roleKey: 'deputy', member: dep });
    });
    (dept.staff || []).forEach(st => {
      candidates.push({ unitId: dept.id, roleKey: 'staff', member: st });
    });
  });

  // 1. Exact linkedUid
  const byUid = candidates.find(c => c.member.linkedUid === user.uid);
  if (byUid) return byUid;

  // Chỉ khớp các nhân sự chưa liên kết với UID khác để tránh tranh chấp / lặp ghi vô hạn
  const unlinkedCandidates = candidates.filter(c => !c.member.linkedUid);

  // 2. Matching CCCD
  if (userCccd.length >= 6) {
    const byCccd = unlinkedCandidates.find(c => normalizeCccd(c.member.cccd) === userCccd);
    if (byCccd) return byCccd;
  }

  // 3. Matching Phone + Name (or Name-only for non-citizen staff when unique)
  if (userName) {
    const byNamePhone =
      userPhone.length >= 8
        ? unlinkedCandidates.find(c => {
            if (normalizeTextNoDiacritics(c.member.fullName) !== userName) return false;
            if (normalizePhone(c.member.phone) !== userPhone) return false;
            const mCccd = normalizeCccd(c.member.cccd);
            return !userCccd || !mCccd || userCccd === mCccd;
          })
        : undefined;
    if (byNamePhone) return byNamePhone;

    const isStaffAccount =
      user.accountType !== 'citizen' ||
      ['doctor', 'nurse', 'communicator', 'staff', 'leadership', 'admin', 'super_admin'].includes(
        user.role
      );

    if (isStaffAccount) {
      const byNameOnly = unlinkedCandidates.filter(c => {
        if (normalizeTextNoDiacritics(c.member.fullName) !== userName) return false;
        const mCccd = normalizeCccd(c.member.cccd);
        return !userCccd || !mCccd || userCccd === mCccd;
      });
      if (byNameOnly.length === 1) return byNameOnly[0];
    }
  }

  return null;
}

function matchDepartmentIndexForUser(
  departments: OrgChartDepartment[],
  userDeptRaw?: string
): number {
  const norm = normalizeTextNoDiacritics(stripDepartmentNumberPrefix(userDeptRaw));
  if (!norm) return 0;

  const exactIdx = departments.findIndex(
    d => normalizeTextNoDiacritics(stripDepartmentNumberPrefix(d.name)) === norm
  );
  if (exactIdx !== -1) return exactIdx;

  const partialIdx = departments.findIndex(d => {
    const dNorm = normalizeTextNoDiacritics(stripDepartmentNumberPrefix(d.name));
    return dNorm.includes(norm) || norm.includes(dNorm);
  });
  return partialIdx !== -1 ? partialIdx : 0;
}

function resolveTargetSlotForUser(
  chart: OrgChartConfig,
  user: UserProfile
): { unitId: string; roleKey: OrgRoleKey } {
  const normDept = normalizeTextNoDiacritics(user.department);
  const normPos = normalizeTextNoDiacritics(user.position);

  if (
    normDept.includes('ban giam doc') ||
    normPos === 'giam doc' ||
    normPos === 'pho giam doc' ||
    normPos === 'giam doc tram' ||
    user.role === 'leadership'
  ) {
    if (normPos === 'giam doc' && !chart.director?.fullName?.trim()) {
      return { unitId: 'leadership', roleKey: 'director' };
    }
    return { unitId: 'leadership', roleKey: 'deputy_director' };
  }

  if (chart.departments.length > 0) {
    const deptIdx = matchDepartmentIndexForUser(chart.departments, user.department);
    const dept = chart.departments[deptIdx];
    if (
      (normPos.includes('truong khoa') || normPos.includes('truong phong')) &&
      !dept.head?.fullName?.trim()
    ) {
      return { unitId: dept.id, roleKey: 'head' };
    }
    if (normPos.includes('pho khoa') || normPos.includes('pho phong')) {
      return { unitId: dept.id, roleKey: 'deputy' };
    }
    return { unitId: dept.id, roleKey: 'staff' };
  }

  return { unitId: 'leadership', roleKey: 'deputy_director' };
}

function insertMemberIntoSlot(
  chart: OrgChartConfig,
  unitId: string,
  roleKey: OrgRoleKey,
  member: OrgChartMember
): boolean {
  if (unitId === 'leadership') {
    if (roleKey === 'director') {
      if (chart.director?.fullName?.trim()) {
        chart.deputyDirectors = [
          {
            ...chart.director,
            position:
              chart.director.position === 'Giám đốc' ? 'Phó Giám đốc' : chart.director.position,
          },
          ...chart.deputyDirectors,
        ];
      }
      chart.director = member;
    } else {
      chart.deputyDirectors = [...chart.deputyDirectors, member];
    }
    return true;
  }

  const targetDept = chart.departments.find(d => d.id === unitId);
  if (!targetDept) return false;

  if (roleKey === 'head') {
    if (targetDept.head?.fullName?.trim()) {
      targetDept.staff = [
        {
          ...targetDept.head,
          position:
            targetDept.head.position === 'Trưởng khoa' || targetDept.head.position === 'Trưởng phòng'
              ? 'Nhân viên'
              : targetDept.head.position,
        },
        ...(targetDept.staff || []),
      ];
    }
    targetDept.head = member;
  } else if (roleKey === 'deputy') {
    targetDept.deputies = [...(targetDept.deputies || []), member];
  } else {
    targetDept.staff = [...(targetDept.staff || []), member];
  }
  return true;
}

function updateMemberInPlace(
  existing: OrgChartMember,
  user: UserProfile
): { next: OrgChartMember; updated: boolean } {
  const userCccd = normalizeCccd(user.citizenId);
  const userPhone = user.phoneNumber?.trim() || '';
  const userName = user.displayName?.trim() || '';
  const userQual = user.qualification?.trim() || '';
  const userPos = user.position?.trim() || '';

  const next: OrgChartMember = { ...existing };
  let updated = false;

  if (next.linkedUid !== user.uid) {
    next.linkedUid = user.uid;
    updated = true;
  }

  if (userCccd && next.cccd !== userCccd) {
    // Only overwrite non-empty CCCD if synced OR if existing CCCD is blank
    if (existing.isSyncedFromUser || !normalizeCccd(existing.cccd)) {
      next.cccd = userCccd;
      updated = true;
    }
  }

  if (existing.isSyncedFromUser) {
    if (userName && next.fullName !== userName) {
      next.fullName = userName;
      updated = true;
    }
    if (userPhone && next.phone !== userPhone) {
      next.phone = userPhone;
      updated = true;
    }
    if (userQual && next.professionalTitle !== userQual) {
      next.professionalTitle = userQual;
      updated = true;
    }
    if (userPos && next.position !== userPos) {
      next.position = userPos;
      updated = true;
    }
  } else {
    // Manually-created member: only fill missing blank phone/professionalTitle while keeping manual flag false
    if (!next.phone?.trim() && userPhone) {
      next.phone = userPhone;
      updated = true;
    }
    if (!next.professionalTitle?.trim() && userQual) {
      next.professionalTitle = userQual;
      updated = true;
    }
  }

  return { next, updated };
}

function applyUserUpdateToMemberSlot(
  chart: OrgChartConfig,
  match: ChartMemberMatch,
  user: UserProfile
): boolean {
  if (match.unitId === 'leadership') {
    if (match.roleKey === 'director' && chart.director) {
      const res = updateMemberInPlace(chart.director, user);
      chart.director = res.next;
      return res.updated;
    }
    let changed = false;
    chart.deputyDirectors = chart.deputyDirectors.map(dd => {
      if (dd.id !== match.member.id) return dd;
      const res = updateMemberInPlace(dd, user);
      if (res.updated) changed = true;
      return res.next;
    });
    return changed;
  }

  let changed = false;
  chart.departments = chart.departments.map(dept => {
    if (dept.id !== match.unitId) return dept;
    if (match.roleKey === 'head' && dept.head && dept.head.id === match.member.id) {
      const res = updateMemberInPlace(dept.head, user);
      if (res.updated) changed = true;
      return { ...dept, head: res.next };
    }
    if (match.roleKey === 'deputy') {
      return {
        ...dept,
        deputies: (dept.deputies || []).map(dep => {
          if (dep.id !== match.member.id) return dep;
          const res = updateMemberInPlace(dep, user);
          if (res.updated) changed = true;
          return res.next;
        }),
      };
    }
    return {
      ...dept,
      staff: (dept.staff || []).map(st => {
        if (st.id !== match.member.id) return st;
        const res = updateMemberInPlace(st, user);
        if (res.updated) changed = true;
        return res.next;
      }),
    };
  });
  return changed;
}

export interface OrgSyncSummary {
  nextChart: OrgChartConfig;
  changed: boolean;
  addedCount: number;
  updatedCount: number;
}

/**
 * Đồng bộ danh sách UserProfile ("Tài khoản") sang cấu trúc OrgChartConfig ("Nhân lực & Khoa phòng").
 * Nhân sự được tự động thêm sẽ có `isSyncedFromUser: true` để hiển thị ghi chú "Đã đồng bộ".
 * Nhân sự do Admin nhập thủ công giữ nguyên `isSyncedFromUser: false/undefined`.
 */
export function syncUsersIntoOrgChart(
  baseChart: OrgChartConfig,
  users: UserProfile[],
  options?: { ignoreExclusions?: boolean }
): OrgSyncSummary {
  const nextChart = cloneOrgChartConfig(baseChart);
  const excludedSet = new Set(options?.ignoreExclusions ? [] : nextChart.excludedSyncedUids || []);

  let addedCount = 0;
  let updatedCount = 0;
  let changed = false;

  if (options?.ignoreExclusions && nextChart.excludedSyncedUids?.length) {
    nextChart.excludedSyncedUids = [];
    changed = true;
  }

  const sortedUsers = [...users].sort((a, b) => (a.uid || '').localeCompare(b.uid || ''));

  sortedUsers.forEach(user => {
    if (!user.uid || excludedSet.has(user.uid)) return;

    const existingMatch = findMemberInOrgChartForUser(nextChart, user);
    if (existingMatch) {
      if (applyUserUpdateToMemberSlot(nextChart, existingMatch, user)) {
        updatedCount++;
        changed = true;
      }
      return;
    }

    if (!shouldUserAutoSyncToOrgChart(user)) return;

    const targetSlot = resolveTargetSlotForUser(nextChart, user);
    const newMember: OrgChartMember = {
      id: `sync_${user.uid.slice(0, 16)}`,
      fullName: user.displayName?.trim() || user.email?.split('@')[0] || 'Cán bộ Y tế',
      cccd: normalizeCccd(user.citizenId) || undefined,
      position: inferPositionFromUserRole(user.role, user.position),
      professionalTitle: inferProfessionalTitleFromUser(user),
      phone: user.phoneNumber?.trim() || undefined,
      linkedUid: user.uid,
      isSyncedFromUser: true,
    };

    if (insertMemberIntoSlot(nextChart, targetSlot.unitId, targetSlot.roleKey, newMember)) {
      addedCount++;
      changed = true;
    }
  });

  return { nextChart, changed, addedCount, updatedCount };
}

/**
 * Đồng bộ 1 UserProfile cụ thể vừa được Admin cập nhật ở tab "Tài khoản & Phân quyền"
 * sang "Quản Lý Nhân Lực & Khoa Phòng".
 */
export function syncSingleUserToOrgChart(
  baseChart: OrgChartConfig,
  user: UserProfile
): OrgSyncSummary {
  const cleanedBase = cloneOrgChartConfig(baseChart);
  if (cleanedBase.excludedSyncedUids?.includes(user.uid)) {
    cleanedBase.excludedSyncedUids = cleanedBase.excludedSyncedUids.filter(id => id !== user.uid);
  }
  return syncUsersIntoOrgChart(cleanedBase, [user]);
}

export interface SyncToUserResult {
  synced: boolean;
  uid?: string;
  matchedUser?: UserProfile;
}

/**
 * Khi Admin thêm hoặc cập nhật nhân lực trong "Quản Lý Nhân Lực & Khoa Phòng":
 * nếu nhân lực đó cũng là một người dùng (khớp UID, CCCD, SĐT+Tên hoặc Tên cán bộ),
 * đồng bộ ngược lại sang collection `users` bên mục "Tài khoản".
 */
export async function syncMemberToUserAccount(
  member: OrgChartMember,
  unitId: string,
  unitName: string,
  roleKey: OrgRoleKey,
  users: UserProfile[]
): Promise<SyncToUserResult> {
  const matchedUser = findMatchingUserForMember(member, users);
  if (!matchedUser) {
    return { synced: false };
  }

  const cleanCccd = normalizeCccd(member.cccd);
  const cleanDepartment =
    unitId === 'leadership' ? 'Ban Giám đốc' : stripDepartmentNumberPrefix(unitName);

  const nextAccountType =
    matchedUser.accountType === 'admin' ? 'admin' : 'employee';
  const nextRole =
    matchedUser.role === 'super_admin' || matchedUser.role === 'admin'
      ? matchedUser.role
      : inferUserRoleFromOrgMember(
          roleKey,
          member.position,
          member.professionalTitle,
          matchedUser.role
        );

  const resolvedPhoneNumber =
    matchedUser.phoneVerified && matchedUser.verifiedPhone
      ? matchedUser.verifiedPhone
      : matchedUser.phoneNumber || member.phone?.trim() || '';

  const payload = cleanDataForFirestore({
    displayName: member.fullName.trim() || matchedUser.displayName,
    citizenId: cleanCccd || matchedUser.citizenId || '',
    phoneNumber: resolvedPhoneNumber,
    department: cleanDepartment,
    position: member.position.trim() || matchedUser.position || '',
    qualification: member.professionalTitle.trim() || matchedUser.qualification || '',
    accountType: nextAccountType,
    role: nextRole,
    updatedAt: new Date().toISOString(),
  });

  await setDoc(doc(db, 'users', matchedUser.uid), payload, { merge: true });

  return {
    synced: true,
    uid: matchedUser.uid,
    matchedUser: {
      ...matchedUser,
      ...payload,
    },
  };
}
