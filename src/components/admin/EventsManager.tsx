import React, { useMemo, useState } from 'react';
import {
  PartyPopper,
  Plus,
  Calendar,
  Clock,
  MapPin,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Repeat,
  BellRing,
  HeartHandshake,
  Save,
  X,
  Play,
  Download,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import { StationEvent, StationEventCategory } from '../../types';
import {
  createStationEvent,
  updateStationEvent,
  deleteStationEvent,
  formatIsoDateVN,
  getVietnamTodayKey,
  resolveEventStatus,
  sortStationEvents,
  logAuditEvent,
} from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  downloadEventsExcelTemplate,
  exportEventsToExcel,
  parseEventsExcelFile,
  ParsedEventImportRow,
} from '../../utils/eventExcelUtils';
import { EventImportModal } from '../modals/EventImportModal';

interface EventsManagerProps {
  events: StationEvent[];
  onPreviewEvent?: (event: StationEvent) => void;
}

const CATEGORY_OPTIONS: Array<{ value: StationEventCategory; label: string }> = [
  { value: 'health_day', label: 'Ngày lễ ngành Y tế' },
  { value: 'celebration', label: 'Lễ kỷ niệm đơn vị' },
  { value: 'campaign', label: 'Chiến dịch truyền thông / Sức khỏe' },
  { value: 'community', label: 'Sự kiện cộng đồng' },
  { value: 'holiday', label: 'Ngày lễ lớn / Quốc gia' },
  { value: 'other', label: 'Sự kiện khác' },
];

const HOLIDAY_PRESETS: Array<{
  label: string;
  title: string;
  mmdd: string;
  category: StationEventCategory;
  description: string;
  greetingMessage: string;
  isAnnual: boolean;
}> = [
  {
    label: 'Thầy thuốc VN 27/02',
    title: 'Kỷ niệm Ngày Thầy thuốc Việt Nam 27/02',
    mmdd: '02-27',
    category: 'health_day',
    description:
      'Kỷ niệm Ngày Thầy thuốc Việt Nam 27/02 — Tôn vinh đội ngũ y bác sĩ, điều dưỡng và nhân viên y tế cơ sở tận tụy vì sức khỏe nhân dân.',
    greetingMessage:
      'Kính chúc toàn thể đội ngũ y bác sĩ, cán bộ nhân viên Trạm Y tế luôn dồi dào sức khỏe, vững vàng y đức và hoàn thành xuất sắc sứ mệnh chăm sóc sức khỏe nhân dân!',
    isAnnual: true,
  },
  {
    label: 'Sức khỏe TG 07/04',
    title: 'Ngày Sức khỏe Thế giới 07/04',
    mmdd: '04-07',
    category: 'campaign',
    description:
      'Hưởng ứng Ngày Sức khỏe Thế giới 07/04 với các hoạt động tư vấn dự phòng, tầm soát bệnh không lây nhiễm và nâng cao nhận thức cộng đồng.',
    greetingMessage:
      'Chúc mỗi gia đình trên địa bàn luôn chủ động bảo vệ sức khỏe, sống khỏe mạnh và bình an mỗi ngày!',
    isAnnual: true,
  },
  {
    label: 'Điều dưỡng 12/05',
    title: 'Ngày Quốc tế Điều dưỡng 12/05',
    mmdd: '05-12',
    category: 'health_day',
    description:
      'Tri ân những đóng góp thầm lặng và tận tâm của đội ngũ điều dưỡng viên, hộ sinh tại tuyến y tế cơ sở.',
    greetingMessage:
      'Xin gửi lời chúc mừng trân trọng và tri ân sâu sắc nhất tới các anh/chị điều dưỡng, hộ sinh luôn tận tâm đồng hành cùng người bệnh!',
    isAnnual: true,
  },
  {
    label: 'Thiếu nhi 01/06',
    title: 'Ngày Quốc tế Thiếu nhi 01/06 & Vi chất dinh dưỡng',
    mmdd: '06-01',
    category: 'community',
    description:
      'Chào mừng Ngày Quốc tế Thiếu nhi 01/06 kết hợp chiến dịch bổ sung Vitamin A và chăm sóc dinh dưỡng cho trẻ em trên địa bàn.',
    greetingMessage:
      'Chúc các em nhỏ luôn khỏe mạnh, hay ăn chóng lớn, chăm ngoan và có một tuổi thơ thật nhiều niềm vui!',
    isAnnual: true,
  },
  {
    label: 'BHYT VN 01/07',
    title: 'Ngày Bảo hiểm Y tế Việt Nam 01/07',
    mmdd: '07-01',
    category: 'campaign',
    description:
      'Tuyên truyền chính sách Bảo hiểm Y tế toàn dân, hướng dẫn người dân đăng ký khám chữa bệnh BHYT ban đầu tại Trạm Y tế.',
    greetingMessage:
      'Tham gia Bảo hiểm Y tế — Lá chắn an sinh vững chắc cho sức khỏe của bạn và gia đình!',
    isAnnual: true,
  },
];

export const EventsManager: React.FC<EventsManagerProps> = ({
  events,
  onPreviewEvent,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast, showConfirm } = useToast();

  const todayKey = getVietnamTodayKey();
  const sortedEvents = useMemo(() => sortStationEvents(events, todayKey), [events, todayKey]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StationEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [parsingExcel, setParsingExcel] = useState(false);
  const [importRows, setImportRows] = useState<ParsedEventImportRow[] | null>(null);

  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(todayKey);
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<StationEventCategory>('celebration');
  const [description, setDescription] = useState('');
  const [greetingMessage, setGreetingMessage] = useState('');
  const [enableConfetti, setEnableConfetti] = useState(true);
  const [enableAutoPopup, setEnableAutoPopup] = useState(true);
  const [isAnnual, setIsAnnual] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const openCreateModal = () => {
    setEditing(null);
    setTitle('');
    setEventDate(getVietnamTodayKey());
    setEndDate('');
    setStartTime('');
    setEndTime('');
    setLocation('');
    setCategory('celebration');
    setDescription('');
    setGreetingMessage('');
    setEnableConfetti(true);
    setEnableAutoPopup(true);
    setIsAnnual(false);
    setIsActive(true);
    setModalOpen(true);
  };

  const openEditModal = (ev: StationEvent) => {
    setEditing(ev);
    setTitle(ev.title || '');
    setEventDate(ev.eventDate || getVietnamTodayKey());
    setEndDate(ev.endDate || '');
    setStartTime(ev.startTime || '');
    setEndTime(ev.endTime || '');
    setLocation(ev.location || '');
    setCategory(ev.category || 'celebration');
    setDescription(ev.description || '');
    setGreetingMessage(ev.greetingMessage || '');
    setEnableConfetti(ev.enableConfetti !== false);
    setEnableAutoPopup(ev.enableAutoPopup !== false);
    setIsAnnual(Boolean(ev.isAnnual));
    setIsActive(ev.isActive !== false);
    setModalOpen(true);
  };

  const applyPreset = (preset: (typeof HOLIDAY_PRESETS)[number]) => {
    const year = getVietnamTodayKey().slice(0, 4);
    setTitle(preset.title);
    setEventDate(`${year}-${preset.mmdd}`);
    setEndDate('');
    setCategory(preset.category);
    setDescription(preset.description);
    setGreetingMessage(preset.greetingMessage);
    setIsAnnual(preset.isAnnual);
    setEnableConfetti(true);
    setEnableAutoPopup(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !eventDate || !description.trim()) {
      showToast('warning', 'Thiếu thông tin', 'Vui lòng nhập tên sự kiện, ngày diễn ra và mô tả.');
      return;
    }
    if (endDate && endDate < eventDate) {
      showToast('warning', 'Ngày kết thúc không hợp lệ', 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        eventDate,
        endDate: endDate || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        location: location.trim() || undefined,
        category,
        description: description.trim(),
        greetingMessage: greetingMessage.trim() || undefined,
        enableConfetti,
        enableAutoPopup,
        isAnnual,
        isActive,
        createdBy: currentUser?.uid,
      };

      if (editing) {
        await updateStationEvent(editing.id, {
          ...editing,
          ...payload,
        });
        await logAuditEvent('Cập nhật sự kiện', 'Sự kiện', `Sửa sự kiện: ${payload.title}`, {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        });
        showToast('success', 'Đã cập nhật sự kiện', payload.title);
      } else {
        await createStationEvent(payload);
        await logAuditEvent('Thêm sự kiện mới', 'Sự kiện', `Tạo sự kiện: ${payload.title} (${eventDate})`, {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        });
        showToast('success', 'Đã thêm sự kiện mới', 'Khi đến ngày diễn ra, hệ thống sẽ tự động thông báo và bắn pháo giấy.');
      }

      setModalOpen(false);
    } catch (err: any) {
      showToast('error', 'Không thể lưu sự kiện', err?.message || 'Vui lòng kiểm tra quyền quản trị.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (ev: StationEvent) => {
    try {
      await updateStationEvent(ev.id, { ...ev, isActive: !ev.isActive });
      showToast(
        'info',
        ev.isActive ? 'Đã tạm ẩn sự kiện' : 'Đã bật hiển thị sự kiện',
        ev.title
      );
    } catch (err: any) {
      showToast('error', 'Lỗi cập nhật trạng thái', err?.message);
    }
  };

  const handleDelete = (ev: StationEvent) => {
    showConfirm({
      title: 'Xóa sự kiện?',
      message: `Bạn có chắc muốn xóa sự kiện "${ev.title}" không?`,
      confirmText: 'Xóa sự kiện',
      cancelText: 'Hủy',
      isDangerous: true,
      onConfirm: async () => {
        try {
          await deleteStationEvent(ev.id);
          await logAuditEvent('Xóa sự kiện', 'Sự kiện', `Xóa sự kiện: ${ev.title}`, {
            uid: currentUser?.uid || 'admin',
            name: userProfile?.displayName || 'Admin',
          });
          showToast('success', 'Đã xóa sự kiện');
        } catch (err: any) {
          showToast('error', 'Xóa sự kiện thất bại', err?.message);
        }
      },
    });
  };

  const handleExportExcel = () => {
    if (sortedEvents.length === 0) {
      showToast('info', 'Chưa có sự kiện nào để xuất Excel');
      return;
    }
    exportEventsToExcel(sortedEvents);
    showToast('success', `Đã xuất ${sortedEvents.length} sự kiện ra file Excel`);
  };

  const handleImportExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setParsingExcel(true);
    try {
      const parsed = await parseEventsExcelFile(file, events);
      setImportRows(parsed);
    } catch (err: any) {
      showToast(
        'error',
        'Không thể đọc file Excel',
        err?.message || 'Vui lòng dùng file mẫu Excel (.xlsx, .xls, .csv) hợp lệ.'
      );
    } finally {
      setParsingExcel(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 shrink-0">
            <PartyPopper className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Quản Lý Lịch Sự Kiện &amp; Hiệu Ứng Chúc Mừng Tự Động
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Thiết lập ngày diễn ra, tên sự kiện, mô tả và lời chúc. Hỗ trợ tải mẫu, Import và Xuất danh sách sự kiện ra Excel.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              downloadEventsExcelTemplate();
              showToast('success', 'Đã tải file Excel mẫu sự kiện');
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>Mẫu Excel</span>
          </button>

          <label className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" />
            <span>{parsingExcel ? 'Đang đọc...' : 'Import Excel'}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportExcelFile}
              disabled={parsingExcel}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3.5 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 font-semibold text-xs transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Xuất Excel</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm sự kiện mới</span>
          </button>
        </div>
      </div>

      {/* Events List */}
      {sortedEvents.length === 0 ? (
        <div className="p-12 rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-3">
          <PartyPopper className="w-10 h-10 text-amber-500 mx-auto opacity-80" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">
              Chưa có sự kiện nào được thiết lập
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Nhấn “Thêm sự kiện mới” để cài đặt ngày kỷ niệm, chiến dịch y tế hoặc sự kiện của Trạm Y tế.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {sortedEvents.map(ev => {
            const statusInfo = resolveEventStatus(ev, todayKey);
            const dateRangeText =
              ev.endDate && ev.endDate > ev.eventDate
                ? `${formatIsoDateVN(ev.eventDate)} - ${formatIsoDateVN(ev.endDate)}`
                : formatIsoDateVN(ev.eventDate);

            return (
              <div
                key={ev.id}
                className={`p-5 rounded-3xl bg-white dark:bg-slate-900 border shadow-xs transition ${
                  statusInfo.status === 'today' && ev.isActive
                    ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-400/30'
                    : 'border-slate-200 dark:border-slate-800'
                } ${!ev.isActive ? 'opacity-70' : ''}`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-2.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusInfo.status === 'today' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                          <PartyPopper className="w-3.5 h-3.5" />
                          <span>Đang diễn ra hôm nay</span>
                        </span>
                      ) : statusInfo.status === 'upcoming' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 tabular-nums">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Còn {statusInfo.daysUntil} ngày</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          <span>Đã diễn ra</span>
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {CATEGORY_OPTIONS.find(c => c.value === ev.category)?.label || 'Sự kiện'}
                      </span>

                      {ev.isAnnual && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300">
                          <Repeat className="w-3 h-3" />
                          <span>Lặp hằng năm</span>
                        </span>
                      )}

                      {!ev.isActive && (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                          Đang ẩn
                        </span>
                      )}
                    </div>

                    <h4 className="text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                      {ev.title}
                    </h4>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                        <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{dateRangeText}</span>
                      </span>
                      {(ev.startTime || ev.endTime) && (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-teal-600" />
                          <span>
                            {ev.startTime || '--:--'}
                            {ev.endTime ? ` - ${ev.endTime}` : ''}
                          </span>
                        </span>
                      )}
                      {ev.location && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-rose-500" />
                          <span>{ev.location}</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                      {ev.description}
                    </p>

                    {ev.greetingMessage && (
                      <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                        <HeartHandshake className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-bold">Lời chúc: </strong>
                          <span className="italic">{ev.greetingMessage}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <BellRing className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Thông báo tự động: {ev.enableAutoPopup ? 'BẬT' : 'TẮT'}</span>
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Bắn pháo giấy: {ev.enableConfetti ? 'BẬT' : 'TẮT'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap lg:flex-col items-center lg:items-end gap-2 shrink-0">
                    {onPreviewEvent && (
                      <button
                        type="button"
                        onClick={() => onPreviewEvent(ev)}
                        className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 text-amber-800 dark:text-amber-200 text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                        title="Xem thử thông báo và hiệu ứng bắn pháo giấy"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Xem thử</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(ev)}
                        className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                        title="Chỉnh sửa sự kiện"
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleActive(ev)}
                        className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                        title={ev.isActive ? 'Tạm ẩn sự kiện' : 'Bật hiển thị sự kiện'}
                      >
                        {ev.isActive ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(ev)}
                        className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 transition cursor-pointer"
                        title="Xóa sự kiện"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[140] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={e => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <PartyPopper className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {editing ? 'Chỉnh Sửa Sự Kiện' : 'Thiết Lập Sự Kiện Mới'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs sm:text-sm">
              {!editing && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Mẫu nhanh các ngày lễ ngành Y tế:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HOLIDAY_PRESETS.map(p => (
                      <button
                        key={p.mmdd}
                        type="button"
                        onClick={() => applyPreset(p)}
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 text-[11px] font-semibold transition cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tên sự kiện *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={256}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Ví dụ: Kỷ niệm Ngày Thầy thuốc Việt Nam 27/02"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ngày diễn ra *
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={e => setEventDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Đến ngày (tùy chọn nếu nhiều ngày)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    min={eventDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Giờ bắt đầu (tùy chọn)
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Giờ kết thúc (tùy chọn)
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Phân loại sự kiện
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as StationEventCategory)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {CATEGORY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Địa điểm tổ chức (tùy chọn)
                  </label>
                  <input
                    type="text"
                    maxLength={256}
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="Hội trường Trạm Y tế / Toàn địa bàn..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Mô tả sự kiện *
                  </label>
                  <textarea
                    required
                    rows={3}
                    maxLength={4000}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Nội dung chương trình, ý nghĩa sự kiện hoặc thông tin hướng dẫn người dân tham gia..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Lời chúc mừng kèm theo (nếu có)
                  </label>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={greetingMessage}
                    onChange={e => setGreetingMessage(e.target.value)}
                    placeholder="Ví dụ: Kính chúc quý đồng nghiệp và bà con nhân dân nhiều sức khỏe, bình an và hạnh phúc!"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/40 dark:bg-amber-950/20 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableAutoPopup}
                    onChange={e => setEnableAutoPopup(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Thông báo tự động đúng ngày
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Tự bật hộp thoại &amp; lời chúc khi truy cập
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableConfetti}
                    onChange={e => setEnableConfetti(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Hiệu ứng bắn pháo giấy
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Tự động tung pháo giấy khi hiển thị thông báo
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAnnual}
                    onChange={e => setIsAnnual(e.target.checked)}
                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Lặp lại hằng năm (theo ngày/tháng)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Phù hợp cho ngày lễ cố định như 27/02, 01/06...
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Hiển thị công khai
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Cho phép người dân xem trong tab Sự kiện
                    </div>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Đang lưu...' : editing ? 'Cập nhật sự kiện' : 'Lưu sự kiện'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Excel Import Preview Modal */}
      {importRows && (
        <EventImportModal rows={importRows} onClose={() => setImportRows(null)} />
      )}
    </div>
  );
};
