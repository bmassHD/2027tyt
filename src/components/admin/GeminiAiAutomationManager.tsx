import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileText,
  Search,
  RefreshCw,
  Cpu,
  Bot,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';
import { SystemSettings } from '../../types';
import { updateSystemSettings, logAuditEvent } from '../../services/firebaseService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface AiStatusData {
  ok: boolean;
  configured: boolean;
  model: string;
  provider: string;
  configuredVia: string;
  statusMessage?: string;
  capabilities: string[];
  updatedAt?: string;
}

interface GeminiAiAutomationManagerProps {
  settings?: SystemSettings;
}

export const GeminiAiAutomationManager: React.FC<GeminiAiAutomationManagerProps> = ({ settings }) => {
  const { showToast } = useToast();
  const { currentUser, userProfile } = useAuth();
  const [aiStatus, setAiStatus] = useState<AiStatusData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Automation Feature Toggles persisted to SystemSettings
  const [autoScanOnUpload, setAutoScanOnUpload] = useState<boolean>(
    settings?.aiAutomation?.autoScanOnUpload !== false
  );
  const [autoExtractSummary, setAutoExtractSummary] = useState<boolean>(
    settings?.aiAutomation?.autoExtractSummary !== false
  );
  const [autoSuggestNeeds, setAutoSuggestNeeds] = useState<boolean>(
    settings?.aiAutomation?.autoSuggestNeeds !== false
  );
  const [savingAutomation, setSavingAutomation] = useState(false);

  useEffect(() => {
    if (settings?.aiAutomation) {
      setAutoScanOnUpload(settings.aiAutomation.autoScanOnUpload !== false);
      setAutoExtractSummary(settings.aiAutomation.autoExtractSummary !== false);
      setAutoSuggestNeeds(settings.aiAutomation.autoSuggestNeeds !== false);
    }
  }, [
    settings?.aiAutomation?.autoScanOnUpload,
    settings?.aiAutomation?.autoExtractSummary,
    settings?.aiAutomation?.autoSuggestNeeds,
  ]);

  // Live Test states
  const [sampleDocText, setSampleDocText] = useState(
    'BỘ Y TẾ - QUYẾT ĐỊNH SỐ 456/QĐ-BYT NGÀY 12/03/2026 VỀ VIỆC BAN HÀNH HƯỚNG DẪN CHUYÊN MÔN TIÊM CHỦNG MỞ RỘNG VÀ GIÁM SÁT DỊCH BỆNH TRUYỀN NHIỄM TẠI TRẠM Y TẾ XÃ PHƯỜNG.'
  );
  const [testingScan, setTestingScan] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanLatency, setScanLatency] = useState<number | null>(null);

  const [sampleCitizenQuery, setSampleCitizenQuery] = useState('Tôi muốn đăng ký tiêm chủng cho bé 2 tháng tuổi');
  const [testingNeeds, setTestingNeeds] = useState(false);
  const [needsResult, setNeedsResult] = useState<any>(null);
  const [needsLatency, setNeedsLatency] = useState<number | null>(null);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/ai/status');
      if (res.ok) {
        const data = await res.json();
        setAiStatus(data);
      } else {
        setAiStatus({
          ok: false,
          configured: false,
          model: 'gemini-4-hydrogen',
          provider: 'Google Gemini AI',
          configuredVia: 'Cấu hình máy chủ (Settings > Secrets)',
          statusMessage: 'Không thể kết nối đến máy chủ AI API',
          capabilities: [],
        });
      }
    } catch {
      setAiStatus({
        ok: false,
        configured: false,
        model: 'gemini-4-hydrogen',
        provider: 'Google Gemini AI',
        configuredVia: 'Cấu hình máy chủ (Settings > Secrets)',
        statusMessage: 'Lỗi mạng khi kiểm tra trạng thái máy chủ AI',
        capabilities: [],
      });
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleToggleAutomation = async (
    key: 'autoScanOnUpload' | 'autoExtractSummary' | 'autoSuggestNeeds',
    nextVal: boolean
  ) => {
    const nextConfig = {
      autoScanOnUpload: key === 'autoScanOnUpload' ? nextVal : autoScanOnUpload,
      autoExtractSummary: key === 'autoExtractSummary' ? nextVal : autoExtractSummary,
      autoSuggestNeeds: key === 'autoSuggestNeeds' ? nextVal : autoSuggestNeeds,
    };
    if (key === 'autoScanOnUpload') setAutoScanOnUpload(nextVal);
    if (key === 'autoExtractSummary') setAutoExtractSummary(nextVal);
    if (key === 'autoSuggestNeeds') setAutoSuggestNeeds(nextVal);

    setSavingAutomation(true);
    try {
      await updateSystemSettings({ aiAutomation: nextConfig });
      await logAuditEvent(
        'Cập nhật tự động hoá Gemini AI',
        'Hệ thống',
        `${key}: ${nextVal ? 'BẬT' : 'TẮT'}`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );
      showToast('success', 'Đã lưu cấu hình tự động hoá Gemini AI');
    } catch (err: any) {
      showToast('error', 'Không thể lưu cấu hình AI', err?.message);
    } finally {
      setSavingAutomation(false);
    }
  };

  const handleTestScan = async () => {
    if (!sampleDocText.trim()) {
      showToast('warning', 'Vui lòng nhập nội dung văn bản thử nghiệm');
      return;
    }
    setTestingScan(true);
    setScanResult(null);
    setScanLatency(null);
    const start = Date.now();
    try {
      const res = await fetch('/api/ai/scan-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textContent: sampleDocText,
          fileName: 'van-ban-thu-nghiem.pdf',
        }),
      });
      const elapsed = Date.now() - start;
      setScanLatency(elapsed);
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setScanResult(data);
        showToast('success', 'Quét văn bản thành công', `Phản hồi trong ${elapsed}ms`);
      } else {
        showToast('error', 'Lỗi kiểm tra AI Quét Văn Bản', data?.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      showToast('error', 'Không thể kết nối API AI', err?.message);
    } finally {
      setTestingScan(false);
    }
  };

  const handleTestNeeds = async () => {
    if (!sampleCitizenQuery.trim()) {
      showToast('warning', 'Vui lòng nhập câu hỏi thử nghiệm');
      return;
    }
    setTestingNeeds(true);
    setNeedsResult(null);
    setNeedsLatency(null);
    const start = Date.now();
    try {
      const res = await fetch('/api/ai/suggest-needs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userQuery: sampleCitizenQuery,
          role: 'citizen',
        }),
      });
      const elapsed = Date.now() - start;
      setNeedsLatency(elapsed);
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setNeedsResult(data);
        showToast('success', 'Phân loại nhu cầu thành công', `Phản hồi trong ${elapsed}ms`);
      } else {
        showToast('error', 'Lỗi phân loại nhu cầu AI', data?.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      showToast('error', 'Không thể kết nối API AI', err?.message);
    } finally {
      setTestingNeeds(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-purple-900 via-slate-900 to-indigo-950 text-white shadow-xl border border-purple-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Google Gemini AI Engine</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Tự Động Hoá Gemini AI &amp; Đọc Văn Bản
          </h2>
          <p className="text-xs sm:text-sm text-purple-200/80 max-w-2xl">
            Tự động đọc, quét và trích xuất số hiệu, ngày ban hành, trích yếu văn bản khi thêm mới, và phân loại nhu cầu công dân thông minh qua máy chủ bảo mật.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchStatus}
          disabled={loadingStatus}
          className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-md transition flex items-center gap-2 self-start md:self-auto cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
          <span>Làm mới trạng thái</span>
        </button>
      </div>

      {/* Grid: 2 Cards (Status & Automation Switches) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Card */}
        <div className="lg:col-span-1 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
              <Cpu className="w-4 h-4 text-purple-600" />
              <span>Trạng thái Dịch vụ AI</span>
            </div>
            {aiStatus?.configured ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[11px] font-bold">
                <CheckCircle2 className="w-3 h-3" /> Sẵn sàng
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[11px] font-bold">
                <AlertCircle className="w-3 h-3" /> Dự phòng
              </span>
            )}
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-bold">
                Mô hình suy luận (Model)
              </span>
              <span className="font-mono font-bold text-purple-700 dark:text-purple-400 text-sm block mt-0.5">
                {aiStatus?.model || 'gemini-4-hydrogen'}
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Tối ưu đọc tài liệu PDF, hình ảnh văn bản và tiếng Việt hành chính.
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-bold">
                Kênh bảo mật API Key
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 block mt-0.5">
                Nạp tự động phía máy chủ (Settings &gt; Secrets)
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Toàn bộ yêu cầu AI đi qua API Proxy `/api/ai/*`, an toàn tuyệt đối không lộ khóa trên trình duyệt.
              </span>
            </div>
          </div>
        </div>

        {/* Automation Switches Card */}
        <div className="lg:col-span-2 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
              <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
              <span>Cấu Hình Quy Trình Tự Động Hoá</span>
            </div>
            {savingAutomation && (
              <span className="text-[11px] text-emerald-600 font-semibold">Đang lưu...</span>
            )}
          </div>

          <div className="space-y-3 text-xs">
            {/* Switch 1 */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-purple-600 shrink-0" />
                  <span>Tự động đọc &amp; quét văn bản ngay khi tải lên</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                  Khi chọn tệp PDF, Word, Excel hoặc Ảnh trong mục Văn bản &amp; Biểu mẫu, AI tự động trích xuất Số hiệu, Trích yếu, Ngày ban hành, Cơ quan và Tóm tắt.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={autoScanOnUpload}
                  onChange={e => void handleToggleAutomation('autoScanOnUpload', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>

            {/* Switch 2 */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Tự động tạo tóm tắt nội dung văn bản hành chính</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                  Tóm tắt ngắn gọn 1–2 câu để hiển thị trong hộp thoại &quot;Xem chi tiết&quot;, giữ bảng danh mục 1 dòng gọn gàng không xuống dòng.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={autoExtractSummary}
                  onChange={e => void handleToggleAutomation('autoExtractSummary', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>

            {/* Switch 3 */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Trợ lý AI gợi ý nhu cầu công dân thông minh</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                  Phân tích câu hỏi của công dân để định hướng nhanh đến đúng phân hệ (Tiêm chủng, BHYT, Lịch trực 24/7, Bác sĩ cho mọi nhà).
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={autoSuggestNeeds}
                  onChange={e => void handleToggleAutomation('autoSuggestNeeds', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Live Testing Console */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-base">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <span>Bàn Thử Nghiệm Tự Động Hoá AI Trực Tuyến</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Test 1: Document Scanner */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-purple-600" />
                <span>Thử nghiệm AI Quét Văn Bản</span>
              </span>
              {scanLatency !== null && (
                <span className="text-[11px] font-mono text-emerald-600 font-bold">
                  {scanLatency}ms
                </span>
              )}
            </div>

            <p className="text-slate-500 text-[11px]">
              Nhập một đoạn trích văn bản hoặc tiêu đề công văn để kiểm tra trích xuất tự động:
            </p>

            <textarea
              rows={3}
              value={sampleDocText}
              onChange={e => setSampleDocText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 text-xs"
            />

            <button
              type="button"
              disabled={testingScan}
              onClick={handleTestScan}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {testingScan ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang phân tích...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Quét văn bản mẫu</span>
                </>
              )}
            </button>

            {scanResult && (
              <div className="mt-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 space-y-1.5">
                <span className="text-[10px] font-bold text-purple-800 dark:text-purple-300 uppercase tracking-wider block">
                  Kết quả trích xuất tự động
                </span>
                <div className="space-y-1 font-mono text-[11px]">
                  <div><span className="text-slate-400">Số hiệu:</span> <span className="font-bold text-emerald-700 dark:text-emerald-400">{scanResult.docNumber}</span></div>
                  <div><span className="text-slate-400">Ngày:</span> <span className="text-slate-800 dark:text-slate-200">{scanResult.issueDate}</span></div>
                  <div><span className="text-slate-400">Cơ quan:</span> <span className="text-slate-800 dark:text-slate-200">{scanResult.issuingAuthority}</span></div>
                  <div><span className="text-slate-400">Trích yếu:</span> <span className="font-semibold text-slate-900 dark:text-white">{scanResult.title}</span></div>
                  {scanResult.summary && (
                    <div><span className="text-slate-400">Tóm tắt:</span> <span className="text-slate-700 dark:text-slate-300 font-sans">{scanResult.summary}</span></div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Test 2: Smart Need Finder */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Search className="w-4 h-4 text-emerald-600" />
                <span>Thử nghiệm Gợi ý Nhu Cầu Y Tế</span>
              </span>
              {needsLatency !== null && (
                <span className="text-[11px] font-mono text-emerald-600 font-bold">
                  {needsLatency}ms
                </span>
              )}
            </div>

            <p className="text-slate-500 text-[11px]">
              Nhập câu hỏi hoặc nhu cầu của người dân để kiểm tra phân loại:
            </p>

            <input
              type="text"
              value={sampleCitizenQuery}
              onChange={e => setSampleCitizenQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
            />

            <button
              type="button"
              disabled={testingNeeds}
              onClick={handleTestNeeds}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {testingNeeds ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang suy luận...</span>
                </>
              ) : (
                <>
                  <Bot className="w-3.5 h-3.5" />
                  <span>Phân loại nhu cầu</span>
                </>
              )}
            </button>

            {needsResult && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-1.5">
                <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
                  Phân tích nhu cầu công dân
                </span>
                <div className="space-y-1 text-[11px]">
                  <div><span className="text-slate-400">Phân hệ đề xuất:</span> <span className="font-bold text-emerald-700 dark:text-emerald-400">{needsResult.suggestedTarget}</span></div>
                  <div><span className="text-slate-400">Lý do:</span> <span className="text-slate-700 dark:text-slate-300">{needsResult.reasoning}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
