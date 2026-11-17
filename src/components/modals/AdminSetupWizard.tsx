import React, { useState } from 'react';
import {
  X,
  Save,
  Sparkles,
  Plus,
  Trash2,
} from 'lucide-react';
import { SystemSettings, EmergencyContact } from '../../types';
import {
  updateSystemSettings,
  createService,
  logAuditEvent,
  getConfiguredEmergencyContacts,
} from '../../services/firebaseService';
import { useAuth, PRIMARY_ADMIN_EMAIL } from '../../contexts/AuthContext';

interface AdminSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SystemSettings;
  onRefreshData: () => void;
}

export const AdminSetupWizard: React.FC<AdminSetupWizardProps> = ({
  isOpen,
  onClose,
  settings,
  onRefreshData,
}) => {
  const { currentUser, userProfile } = useAuth();

  const [stationName, setStationName] = useState(
    settings.stationName?.includes('Chưa cấu hình') ? '' : (settings.stationName || '')
  );
  const [subTitle, setSubTitle] = useState(settings.subTitle || '');
  const [address, setAddress] = useState(
    settings.address?.includes('Chưa cập nhật') ? '' : (settings.address || '')
  );
  const [hotline, setHotline] = useState(
    settings.hotline?.includes('Chưa cập nhật') ? '' : (settings.hotline || '')
  );
  const [email, setEmail] = useState(settings.email || '');
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>(() => {
    const existing = getConfiguredEmergencyContacts(settings);
    return existing.length > 0 ? existing : [];
  });
  const [workingHours, setWorkingHours] = useState(
    settings.workingHours?.includes('Chưa cập nhật') ? '' : (settings.workingHours || '')
  );
  const [leaderName, setLeaderName] = useState(
    settings.leaderName?.includes('Chưa cập nhật') ? '' : (settings.leaderName || '')
  );

  const [createInitialService, setCreateInitialService] = useState(true);
  const [initialServiceName, setInitialServiceName] = useState('Khám chữa bệnh BHYT & Cấp phát thuốc');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stationName.trim()) return;

    setSubmitting(true);
    try {
      const validEmergencyContacts = emergencyContacts
        .filter(item => item.phone.trim() !== '')
        .map((item, idx) => ({
          id: item.id || `ec_${idx + 1}`,
          phone: item.phone.trim(),
          note: item.note.trim(),
        }));

      await updateSystemSettings({
        stationName: stationName.trim(),
        subTitle: subTitle.trim(),
        address: address.trim(),
        hotline: hotline.trim(),
        email: email.trim(),
        emergencyContacts: validEmergencyContacts,
        emergencyPhone: validEmergencyContacts[0]?.phone || '',
        emergencyNote: validEmergencyContacts[0]?.note || '',
        workingHours: workingHours.trim(),
        leaderName: leaderName.trim(),
        updatedAt: new Date().toISOString(),
      });

      if (createInitialService && initialServiceName.trim()) {
        await createService({
          name: initialServiceName.trim(),
          category: 'kham_chua_benh',
          description: 'Khám bệnh đa khoa, quản lý bệnh mãn tính và cấp phát thuốc BHYT.',
          targetAudience: 'Người dân có thẻ BHYT',
          procedure: 'Tiếp đón CCCD/VNeID -> Khám lâm sàng -> Kê đơn',
          requiredDocuments: 'CCCD gắn chip hoặc VNeID',
          executionTime: '15 - 30 phút',
          location: 'Phòng khám đa khoa (Phòng 101)',
          contactPhone: hotline.trim(),
          inCharge: leaderName.trim() || 'Bác sĩ phụ trách',
          isActive: true,
        });
      }

      await logAuditEvent('Thiết lập ban đầu Trạm Y tế', 'Cài đặt', `Cấu hình đơn vị: ${stationName}`, {
        uid: currentUser?.uid || 'admin',
        name: userProfile?.displayName || 'Admin',
      });

      onRefreshData();
      onClose();
    } catch (e) {
      console.error('Error saving settings:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">Thiết lập Thông tin Trạm Y tế</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Quản trị viên ({PRIMARY_ADMIN_EMAIL})</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 text-sm max-h-[75vh] overflow-y-auto">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Tên đơn vị Trạm Y tế *
            </label>
            <input
              type="text"
              required
              placeholder="Ví dụ: Trạm Y tế Xã / Phường..."
              value={stationName}
              onChange={(e) => setStationName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-medium"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Hotline tiếp dân *</label>
              <input
                type="text"
                required
                value={hotline}
                onChange={(e) => setHotline(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Gmail / Email Trạm</label>
              <input
                type="email"
                placeholder="tramyte.phuong@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-semibold text-rose-800 dark:text-rose-300">Số cấp cứu 24/7 *</label>
              <button
                type="button"
                onClick={() =>
                  setEmergencyContacts(prev => [
                    ...prev,
                    { id: `ec_${Date.now()}`, phone: '', note: '' },
                  ])
                }
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm số</span>
              </button>
            </div>
            <div className="space-y-2">
              {emergencyContacts.map((contact, idx) => (
                <div key={contact.id} className="space-y-1.5 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-rose-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      required={idx === 0}
                      value={contact.phone}
                      onChange={(e) =>
                        setEmergencyContacts(prev =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, phone: e.target.value } : item
                          )
                        )
                      }
                      placeholder={`Số cấp cứu ${emergencyContacts.length > 1 ? `#${idx + 1}` : ''}`}
                      className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-bold text-rose-600"
                    />
                    {emergencyContacts.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setEmergencyContacts(prev => prev.filter((_, i) => i !== idx))
                        }
                        className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                        title="Xóa số cấp cứu"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={contact.note}
                    onChange={(e) =>
                      setEmergencyContacts(prev =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, note: e.target.value } : item
                        )
                      )
                    }
                    placeholder="Ghi chú đi kèm số cấp cứu..."
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Địa chỉ trụ sở *</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Giờ làm việc</label>
              <input
                type="text"
                value={workingHours}
                onChange={(e) => setWorkingHours(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Trưởng Trạm Y tế</label>
              <input
                type="text"
                value={leaderName}
                onChange={(e) => setLeaderName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="initSrv"
                checked={createInitialService}
                onChange={(e) => setCreateInitialService(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600"
              />
              <label htmlFor="initSrv" className="font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                Tạo dịch vụ khám ban đầu
              </label>
            </div>
            {createInitialService && (
              <input
                type="text"
                value={initialServiceName}
                onChange={(e) => setInitialServiceName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-sm"
              />
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-semibold text-sm cursor-pointer"
            >
              Để sau
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>{submitting ? 'Đang lưu...' : 'Lưu cấu hình'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
