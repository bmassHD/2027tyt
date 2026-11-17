export type RoleType =
  | 'super_admin'
  | 'admin'
  | 'leadership'
  | 'doctor'
  | 'nurse'
  | 'communicator'
  | 'staff'
  | 'citizen';

export type AccountType = 'citizen' | 'employee' | 'admin';

export interface EthnicItem {
  label: string;
  value: number;
}

export interface WardItem {
  ward_code: string;
  name: string;
  province_code: string;
}

export interface ProvinceItem {
  province_code: string;
  name: string;
  short_name: string;
  code?: string;
  place_type?: string;
  wards: WardItem[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  citizenId?: string;
  dob?: string;
  gender?: 'Nam' | 'Nữ' | 'Khác';
  ethnicity?: string; // Dân tộc (từ dantoc.json)
  provinceCode?: string; // Mã Tỉnh/Thành phố (từ data.json)
  provinceName?: string; // Tên Tỉnh/Thành phố (từ data.json)
  wardCode?: string; // Mã Xã/Phường/Thị trấn (từ data.json)
  wardName?: string; // Tên Xã/Phường/Thị trấn (từ data.json)
  address?: string; // Địa chỉ chi tiết (số nhà, đường, ấp/tổ dân phố)
  role: RoleType;
  accountType: AccountType;
  department?: string;
  position?: string;
  qualification?: string;
  status: 'active' | 'pending_approval' | 'suspended' | 'banned';
  banType?: 'temporary' | 'permanent';
  bannedUntil?: string;
  bannedUntilMs?: number;
  banReason?: string;
  bannedAt?: string;
  bannedByUid?: string;
  bannedByName?: string;
  avatarUrl?: string;
  twoFactorEnabled?: boolean;
  twoFactorUpdatedAt?: string;
  hasPasswordLinked?: boolean;
  smsMfaEnabled?: boolean;
  smsMfaPhoneMasked?: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  phoneVerified?: boolean;
  verifiedPhone?: string;
  phoneVerifiedAt?: string;
  citizenIdVerified?: boolean;
  citizenIdVerifiedAt?: string;
  identityVerifiedFromDatabase?: boolean;
  allowIdentityEditByAdmin?: boolean;
  googleLinked?: boolean;
  referralCodeUsed?: string;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  notes?: string;
}

export interface UserTotpSecurityDoc {
  enabled: boolean;
  secret: string;
  recoveryCodes?: string[];
  issuer?: string;
  verifiedAt?: string;
  updatedAt: string;
}

export interface VerifiedIdentifierLock {
  id: string;
  type: 'email' | 'phone' | 'cccd';
  valueMasked?: string;
  ownerUid: string;
  locked: boolean;
  verifiedAt: string;
}

export interface ReferralCodeItem {
  code: string;
  label?: string;
  active: boolean;
  targetAccountType: 'employee';
  targetRole: RoleType;
  createdByUid: string;
  createdByEmail?: string;
  createdAt: string;
  usedCount: number;
  lastUsedAt?: string;
  lastUsedByUid?: string;
}

export interface UserVerifiedDevice {
  deviceId: string;
  deviceName: string;
  platform: 'mobile' | 'tablet' | 'desktop';
  os?: string;
  browser?: string;
  isTrusted: boolean;
  verificationMethod?: 'password' | 'google' | 'sms_mfa' | 'sms_otp' | 'totp_2fa' | 'manual';
  verifiedAt: string;
  firstSeenAt?: string;
  lastActiveAt: string;
}

export interface PostMediaItem {
  id: string;
  url: string;
  type: 'image' | 'video' | 'gif';
  caption?: string;
  width?: string; // '25%', '50%', '75%', '100%'
  widthPercent?: number; // 25, 50, 75, 100
  align?: 'left' | 'center' | 'right';
  alignment?: 'left' | 'center' | 'right';
  linkUrl?: string;
}

export interface PostRichStyle {
  fontSize?: string;
  fontFamily?: string;
  textColor?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

export type FacebookEmbedKind = 'auto' | 'post' | 'video' | 'page' | 'profile';

export interface FacebookEmbedMeta {
  kind?: FacebookEmbedKind;
  displayName?: string;
  followersText?: string;
  likesText?: string;
  bio?: string;
  avatarUrl?: string;
  postText?: string;
  showImage?: boolean;
  showText?: boolean;
}

export interface Post {
  id: string;
  title: string;
  summary: string;
  content: string;
  contentHtml?: string;
  fontSize?: string;
  fontFamily?: string;
  textColor?: string;
  richStyle?: PostRichStyle;
  mediaItems?: PostMediaItem[];
  category: 'tin_hoat_dong' | 'phong_chong_dich' | 'giao_duc_suc_khoe' | 'tiem_chung' | 'benh_khong_lay_nhiem' | 'an_toan_thuc_pham';
  thumbnail?: string;
  isPinned?: boolean;
  status: 'published' | 'draft' | 'archived';
  authorUid: string;
  authorName: string;
  views: number;
  publishedAt: string;
  createdAt?: string;
  updatedAt?: string;
  sortOrder?: number;
  tags?: string[];
  embedUrl?: string; // YouTube or Facebook embed URL
  embedType?: 'youtube' | 'facebook' | 'none';
  facebookMeta?: FacebookEmbedMeta | null;
}

export interface MediaEmbedItem {
  id: string;
  title: string;
  type: 'youtube' | 'facebook';
  url: string;
  description?: string;
  publishedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'emergency' | 'vaccination' | 'schedule' | 'general';
  priority?: 'hoatoc' | 'khan' | 'binhthuong';
  target: 'all' | 'citizens' | 'employees';
  isPinned: boolean;
  expiresAt?: string;
  readByDeviceIds?: string[];
  viewCount?: number;
  createdBy: string;
  createdAt: string;
}

export interface TargetedNotification {
  id: string;
  title: string;
  content: string;
  targetType: 'all' | 'individual' | 'organization' | 'bulk_cccd';
  targetCccd?: string;
  targetPhone?: string;
  targetOrgName?: string;
  priority: 'hoatoc' | 'khan' | 'binhthuong';
  pushToDevice?: boolean;
  expiresAt?: string;
  readByUids: string[];
  readByDeviceIds?: string[];
  viewCount?: number;
  createdBy: string;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  deviceId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  uid?: string;
  citizenId?: string;
  phoneNumber?: string;
  department?: string;
  userAgent?: string;
  updatedAt: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  category: 'kham_chua_benh' | 'tiem_chung' | 'benh_khong_lay_nhiem' | 'me_va_be' | 'so_cap_cuu' | 'xet_nghiem';
  description: string;
  targetAudience: string;
  procedure: string;
  requiredDocuments: string;
  executionTime: string;
  location: string;
  contactPhone: string;
  inCharge: string;
  isActive: boolean;
  iconName?: string;
}

export type FeedbackAttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface FeedbackAttachment {
  id: string;
  name: string;
  path: string;
  sha?: string;
  size: number;
  mimeType?: string;
  kind: FeedbackAttachmentKind;
  downloadUrl: string;
  htmlUrl?: string;
  uploadedAt: string;
}

export interface FeedbackItem {
  id: string;
  ticketCode: string;
  fullName: string;
  email?: string;
  phone?: string;
  category: 'kham_chua_benh' | 'thai_do_phuc_vu' | 'co_so_vat_chat' | 'thu_tuc_bhyt' | 'y_kien_dong_gop';
  content: string;
  isAnonymous: boolean;
  status: 'new' | 'processing' | 'forwarded' | 'responded' | 'resolved' | 'rejected' | 'withdrawn';
  response?: string;
  assignedDepartment?: string;
  attachments?: FeedbackAttachment[];
  githubBackupUrl?: string;
  uid?: string;
  deviceId?: string;
  createdAt: string;
  updatedAt?: string;
  withdrawnAt?: string;
}

export interface StaffTask {
  id: string;
  title: string;
  description: string;
  assigneeUid: string;
  assigneeName: string;
  department: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'under_review' | 'completed' | 'overdue' | 'suspended';
  dueDate: string;
  createdBy: string;
  createdAt: string;
}

export interface WorkSchedule {
  id: string;
  title: string;
  type: 'duty' | 'clinic' | 'vaccine' | 'meeting' | 'community';
  date: string;
  shift: 'morning' | 'afternoon' | 'night' | 'full_day';
  staffNames: string;
  doctorName?: string;
  nurseName?: string;
  phone?: string;
  department: string;
  location: string;
  notes?: string;
  isPublic?: boolean;
}

export interface WeeklyWorkDayConfig {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Chủ nhật, 1 = Thứ 2 ... 6 = Thứ 7
  label: string;
  isWorking: boolean;
  morningHours?: string;
  afternoonHours?: string;
  departmentsSummary?: string;
  notes?: string;
}

export interface WorkScheduleConfig {
  weeklyDays: WeeklyWorkDayConfig[];
  dutyHoursSummary?: string;
  generalNote?: string;
  updatedAt?: string;
}

export interface HolidayScheduleItem {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  resumeDate?: string; // YYYY-MM-DD
  isAnnual?: boolean;
  noticeTitle?: string;
  noticeMessage?: string;
  dutyArrangement?: string;
  emergencyPhone?: string;
  headName?: string; // Người đứng đầu / Trực lãnh đạo dịp lễ (tùy chọn ghi đè)
  headPhone?: string; // Số điện thoại người đứng đầu dịp lễ (tùy chọn ghi đè)
  showBanner?: boolean;
  showModalOnEntry?: boolean;
  isActive: boolean;
  updatedAt?: string;
}

export interface MapLocation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  headName?: string; // Người đứng đầu / phụ trách điểm trạm
  workingHours?: string;
  isPrimary?: boolean;
  notes?: string;
}

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  description?: string;
  badge?: string;
}

export interface DocumentItem {
  id: string;
  docNumber: string;
  title: string;
  category: 'legal' | 'moh' | 'doh' | 'decision' | 'guideline' | 'form';
  issueDate: string;
  issuer: string;
  fileUrl?: string;
  fileType?: 'pdf' | 'docx' | 'xlsx' | 'link';
  fileSize?: string;
  fileName?: string;
  mimeType?: string;
  githubPath?: string;
  githubHtmlUrl?: string;
  githubSha?: string;
  visibility?: 'public' | 'private';
  isImportant?: boolean;
  createdAt: string;
  summary?: string;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  folderPath: string;
  isConfigured: boolean;
}

export interface UploadedFileItem {
  id: string;
  sha?: string;
  name: string;
  path: string;
  size: number;
  downloadUrl: string;
  htmlUrl: string;
  type: 'image' | 'pdf' | 'word' | 'excel' | 'other';
  uploadedAt: string;
  uploader: string;
}

export interface BackupItem {
  id: string;
  title: string;
  version: string;
  createdAt: string;
  createdBy: string;
  sizeBytes?: number;
  collectionsIncluded?: string[];
  stats: {
    postsCount: number;
    servicesCount: number;
    documentsCount: number;
    usersCount: number;
    feedbackCount: number;
    workSchedulesCount?: number;
    announcementsCount?: number;
    appointmentsCount?: number;
    tasksCount?: number;
    notificationsCount?: number;
    auditLogsCount?: number;
    adminsCount?: number;
    settingsCount?: number;
    rescueSignalsCount?: number;
    onlinePresenceCount?: number;
    nearbyFacilitiesCount?: number;
    eventsCount?: number;
    siteStatsCount?: number;
    pushSubscriptionsCount?: number;
    feedbackAttachmentsCount?: number;
    verifiedIdentifiersCount?: number;
    userDevicesCount?: number;
    bhxhServerConfigCount?: number;
    totalRecords?: number;
  };
  storageType?: 'cloud' | 'github';
  githubPath?: string;
  githubHtmlUrl?: string;
  encoding?: 'json' | 'base64';
  isAutoBackup?: boolean;
  dataJson: string;
}

export interface AuditLog {
  id: string;
  userUid: string;
  userName: string;
  action: string;
  module: string;
  details: string;
  timestamp: string;
}

export interface Appointment {
  id: string;
  ticketId: string;
  fullName: string;
  phone: string;
  serviceId: string;
  serviceName: string;
  appointmentDate: string;
  timeSlot: string;
  notes?: string;
  citizenIdMasked?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  userUid?: string;
  responseNotes?: string;
  createdAt: string;
}

export interface HighlightImage {
  id: string;
  title: string;
  caption?: string;
  imageUrl: string;
  linkUrl?: string;
  order: number;
}

export interface EmergencyContact {
  id: string;
  phone: string;
  note: string;
}

export interface VaccinationScheduleItem {
  id: string;
  title: string;
  programType: 'expanded' | 'campaign' | 'service';
  date: string; // YYYY-MM-DD (Ngày bắt đầu / Từ ngày)
  endDate?: string; // YYYY-MM-DD (Ngày kết thúc / Đến ngày, tùy chọn khi kéo dài nhiều ngày)
  startTime?: string; // HH:MM (Giờ bắt đầu chính xác để đếm ngược)
  endTime?: string; // HH:MM (Giờ kết thúc chính xác để tự động ẩn khi hết đợt)
  dateLabel?: string; // Hiển thị tùy chỉnh (vd: "Ngày 15 - 16/11/2026" hoặc "Thứ Tư hằng tuần")
  timeRange: string; // Vd: "07:30 - 11:00 · 13:30 - 16:30"
  location: string; // Điểm tiêm chính
  secondaryLocations?: string[]; // Các điểm tiêm phụ (cơ sở vệ tinh, điểm trạm khu phố/ấp)
  targetAudience: string;
  vaccines: string;
  notes?: string;
  status: 'upcoming' | 'ongoing' | 'completed' | 'postponed';
  isPinned?: boolean;
  isActive?: boolean;
  updatedAt?: string;
}

export interface StartupPopupConfig {
  enabled: boolean;
  noticeType?: 'general' | 'epidemic' | 'schedule' | 'urgent';
  title?: string;
  message?: string;
  includeTopVaccination?: boolean;
  ctaView?: 'none' | 'news' | 'duty' | 'documents' | 'map' | 'vaccination' | 'rescue' | 'nearby_facilities' | 'events';
  ctaLabel?: string;
  frequency?: 'per_session' | 'daily' | 'always';
  updatedAt?: string;
}

export interface VaccinationStartupPopupConfig {
  enabled: boolean;
  title?: string;
  message?: string;
  ctaLabel?: string;
  frequency?: 'per_session' | 'daily' | 'always';
  updatedAt?: string;
}

export type StationEventCategory =
  | 'health_day'
  | 'celebration'
  | 'community'
  | 'campaign'
  | 'holiday'
  | 'other';

export interface StationEvent {
  id: string;
  title: string;
  eventDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  location?: string;
  category: StationEventCategory;
  description: string;
  greetingMessage?: string;
  enableConfetti: boolean;
  enableAutoPopup: boolean;
  isAnnual?: boolean;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type NearbyFacilityType =
  | 'hospital'
  | 'clinic'
  | 'health_station'
  | 'emergency_center'
  | 'pharmacy'
  | 'other';

export interface NearbyFacilityEditPayload {
  name: string;
  facilityType: NearbyFacilityType;
  level: string;
  address: string;
  ward: string;
  lat: number;
  lng: number;
  phone: string;
  emergencyPhone: string;
  workingHours: string;
  is24Hours: boolean;
  hasEmergency: boolean;
  hasBhyt: boolean;
  services: string;
  bedCount: number;
  headName: string;
  website: string;
  notes: string;
  submittedBy?: string;
  requestedAt: string;
}

export interface NearbyFacility {
  id: string;
  name: string;
  facilityType: NearbyFacilityType;
  level?: string;
  address: string;
  ward?: string;
  lat: number;
  lng: number;
  phone?: string;
  emergencyPhone?: string;
  workingHours?: string;
  is24Hours?: boolean;
  hasEmergency?: boolean;
  hasBhyt?: boolean;
  services?: string;
  bedCount?: number;
  headName?: string;
  website?: string;
  notes?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  submittedBy?: string;
  submittedByUid?: string;
  submitterDeviceId?: string;
  rejectionReason?: string;
  editStatus?: 'none' | 'pending_edit' | 'rejected_edit';
  pendingEditData?: NearbyFacilityEditPayload;
  editRequestedAt?: string;
  editRejectionReason?: string;
  isActive: boolean;
  order?: number;
  createdAt: string;
  updatedAt?: string;
}

export type RescueSignalCategory =
  | 'medical_emergency'
  | 'traffic_accident'
  | 'disaster_flood'
  | 'fire_rescue'
  | 'other';

export type RescueSignalOutcome = 'on_site' | 'referred';

export interface RescueSignal {
  id: string;
  phone: string;
  extraPhone?: string;
  senderName?: string;
  senderAvatarUrl?: string;
  senderCitizenIdMasked?: string;
  senderDob?: string;
  senderGender?: 'Nam' | 'Nữ' | 'Khác';
  senderAddress?: string;
  senderVerified?: boolean;
  category: RescueSignalCategory;
  note?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  status: 'active' | 'responding' | 'resolved' | 'cancelled';
  deviceId: string;
  uid?: string;
  responderName?: string;
  responderPhone?: string;
  responderNote?: string;
  outcome?: RescueSignalOutcome;
  referredToFacility?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgChartMember {
  id: string;
  fullName: string;
  cccd?: string; // Số CCCD / CMND dùng để định danh và đồng bộ 2 chiều với Tài khoản
  position: string; // Giám đốc, Phó Giám đốc, Trưởng khoa, Phó khoa, Nhân viên
  professionalTitle: string; // Chức danh chuyên môn (BS CK I, Điều dưỡng, Dược sĩ...)
  phone?: string;
  notes?: string;
  linkedUid?: string; // UID tài khoản người dùng liên kết bên collection users
  isSyncedFromUser?: boolean; // true nếu nhân sự được tự động đồng bộ từ Tài khoản; false/undefined nếu nhập thủ công
}

export interface OrgChartDepartment {
  id: string;
  name: string;
  description?: string;
  head?: OrgChartMember; // Trưởng khoa / Trưởng phòng
  deputies?: OrgChartMember[]; // Phó khoa / Phó phòng
  staff: OrgChartMember[]; // Nhân viên của khoa phòng
}

export interface OrgChartConfig {
  director?: OrgChartMember; // Giám đốc
  deputyDirectors: OrgChartMember[]; // Phó Giám đốc
  departments: OrgChartDepartment[]; // Các khoa / phòng
  excludedSyncedUids?: string[]; // UID đã được Admin xóa thủ công khỏi danh sách nhân lực
  updatedAt?: string;
}

export interface AccessRestrictionRules {
  disableIos?: boolean;
  disableAndroid?: boolean;
  disableMobile?: boolean;
  disableIpad?: boolean;
  disablePc?: boolean;
  disableChrome?: boolean;
  disableCocCoc?: boolean;
  disableSafari?: boolean;
  disableEdge?: boolean;
  disableFirefox?: boolean;
  disableInAppBrowser?: boolean;
}

export interface AccessControlConfig {
  rules: AccessRestrictionRules;
  customMessage?: string;
  exemptAdmins?: boolean;
  updatedAt?: string;
}

export interface BhxhApiPublicConfig {
  enabled: boolean;
  baseUrl?: string;
  lookupEndpoint?: 'KQNhanLichSuKCB2024' | 'NhanLichSuKCB2024' | 'NhanLichSuKCB2018';
  defaultMaCskcb?: string;
  usernameMasked?: string;
  hasCredentials?: boolean;
  hasOfficerInfo?: boolean;
  autoLookupFacilityName?: boolean;
  showHistoryKcb?: boolean;
  updatedAt?: string;
}

export interface BhxhCskcbInfo {
  maketqua: string;
  message?: string;
  macskcb: string;
  ten?: string;
  hang?: string;
  tuyen?: string;
  diachi?: string;
  tenchuquan?: string;
  ngaysua?: string;
  macha?: string;
  hieuluc?: number | string;
  ngayngunghoatdong?: string;
  matinh?: string;
  mahuyen?: string;
}

export interface BhxhLichSuKcbItem {
  maHoSo?: string;
  maCSKCB?: string;
  tenCSKCB?: string;
  ngayVao?: string;
  ngayRa?: string;
  tuNgay?: string;
  denNgay?: string;
  tenBenh?: string;
  tinhTrang?: string;
  kqDieuTri?: string;
  lyDoVV?: string;
  TEMP1?: string;
  TEMP2?: string;
}

export interface BhxhLichSuKtItem {
  userKT?: string;
  thoiGianKT?: string;
  thongBao?: string;
  thongbao?: string;
  maLoi?: string;
}

export interface BhxhLookupStatusInfo {
  code: string;
  description: string;
  severity: 'valid' | 'warning' | 'error';
}

export interface BhxhCardLookupResult {
  maKetQua: string;
  ghiChu?: string;
  maThe?: string;
  hoTen?: string;
  ngaySinh?: string;
  gioiTinh?: string;
  diaChi?: string;
  maDKBD?: string;
  cqBHXH?: string;
  gtTheTu?: string;
  gtTheDen?: string;
  maKV?: string;
  ngayDu5Nam?: string;
  maSoBHXH?: string;
  maTheCu?: string;
  maTheMoi?: string;
  gtTheTuMoi?: string;
  gtTheDenMoi?: string;
  maDKBDMoi?: string;
  tenDKBDMoi?: string;
  dsLichSuKCB2024?: BhxhLichSuKcbItem[] | null;
  dsLichSuKT2024?: BhxhLichSuKtItem[] | null;
  dsLichSuKCB2018?: BhxhLichSuKcbItem[] | null;
  dsLichSuKT2018?: BhxhLichSuKtItem[] | null;
  dsLichSuKCB?: BhxhLichSuKcbItem[] | null;
  dsLichSuKT?: BhxhLichSuKtItem[] | null;
  endpointUsed?: string;
  statusInfo?: BhxhLookupStatusInfo;
  dkbdFacility?: BhxhCskcbInfo | null;
  queriedAt?: string;
}

export interface SystemSettings {
  stationName: string;
  parentUnitName?: string; // Tên đơn vị trực thuộc cấp trên
  subTitle: string;
  address: string;
  hotline: string;
  emergencyPhone: string;
  emergencyNote?: string; // Ghi chú đi kèm số cấp cứu khẩn cấp (vd: Tiếp nhận cấp cứu, sơ cứu 24/24...)
  emergencyContacts?: EmergencyContact[]; // Danh sách số cấp cứu 24/7 kèm ghi chú riêng từng số
  email: string;
  workingHours: string;
  leaderName: string;
  bannerNotice: string;
  bannerNoticeEnabled?: boolean; // Bật/tắt banner thông báo bình thường ở đầu trang
  vaccinationBannerEnabled?: boolean; // Bật/tắt banner đếm ngược tiêm chủng ở đầu trang
  vaccinationBannerNote?: string; // Ghi chú hiển thị kèm trên banner tiêm chủng đầu trang
  functionsSummary?: string; // Chức năng, nhiệm vụ tóm tắt
  customFunctionsAndDuties?: string; // Chức năng nhiệm vụ chi tiết nhập thủ công, mỗi dòng đầu thụt vào 1cm
  mapLocations?: MapLocation[]; // Danh sách tọa độ các cơ sở/điểm trạm y tế
  quickLinks?: QuickLink[]; // Các nhánh truy cập nhanh đến các site khác
  highlightImages?: HighlightImage[]; // Hình ảnh hoạt động y tế nổi bật (setup thủ công)
  vaccinationSchedules?: VaccinationScheduleItem[]; // Lịch tiêm chủng ưu tiên hàng đầu do Admin thiết lập
  workScheduleConfig?: WorkScheduleConfig; // Lịch làm việc cố định theo tuần của Trạm Y tế
  holidaySchedules?: HolidayScheduleItem[]; // Lịch nghỉ lễ & thông báo khi truy cập đúng ngày nghỉ lễ
  startupPopup?: StartupPopupConfig; // Cấu hình Pop-up thông báo bình thường khi mở trang
  vaccinationPopup?: VaccinationStartupPopupConfig; // Cấu hình Pop-up thông báo tiêm chủng riêng biệt khi mở trang
  orgChart?: OrgChartConfig; // Sơ đồ tổ chức trạm y tế (Giám đốc -> Phó GĐ -> Khoa/Phòng -> Trưởng/Phó khoa -> Nhân viên)
  footerContact?: {
    hotline?: string;
    emergencyPhone?: string;
    address?: string;
    email?: string;
    certNumber?: string;
    openingHours?: string;
  };
  modulesEnabled?: Record<string, boolean>;
  appBacSiChoMoiNha?: {
    enabled: boolean;
    androidUrl: string;
    iosUrl: string;
    guideText: string;
  };
  githubConfig?: GitHubConfig;
  socialLinks?: {
    facebook?: string;
    zalo?: string;
    tiktok?: string;
    youtube?: string;
  };
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  hiddenTabs?: string[];
  tabMaintenance?: Record<string, boolean>;
  accessControl?: AccessControlConfig;
  bhxhApi?: BhxhApiPublicConfig;
  aiAutomation?: {
    autoScanOnUpload?: boolean;
    autoExtractSummary?: boolean;
    autoSuggestNeeds?: boolean;
  };
  editorialBoard?: string;
  responsiblePerson?: string;
  copyrightText?: string;
  softwareTeamContact?: SoftwareTeamContactConfig;
  version?: string;
  lastBackupAt?: string;
  autoBackupGithubEnabled?: boolean;
  lastGithubBackupAt?: string;
  lastGithubBackupDay?: string;
  lastAutoGithubBackupAttemptDay?: string;
  lastAutoGithubBackupStatus?: 'success' | 'failed';
  lastAutoGithubBackupError?: string;
  updatedAt?: string;
}

export interface SoftwareTeamContactConfig {
  enabled?: boolean;
  teamName?: string;
  roleLabel?: string;
  personName?: string;
  phone?: string;
  email?: string;
  zaloUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  supportHours?: string;
  note?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}
