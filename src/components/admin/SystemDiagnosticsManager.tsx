import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Server,
  Globe,
  Database,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  Zap,
  Radio,
  FileCode2,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import firebaseConfig from '../../../firebase-applet-config.json';

interface DiagnosticsData {
  status: 'healthy' | 'warning' | 'error';
  timestamp: string;
  totalResponseTimeMs: number;
  appVersion: string;
  platform: string;
  environment: string;
  region: string;
  nodeVersion: string;
  apiEndpoints: Record<string, string>;
  services: {
    rssUpstream: {
      status: 'connected' | 'error';
      statusCode: number;
      responseTimeMs: number;
      error: string | null;
      itemsFound: number;
      source: string;
    };
    geminiAi: {
      configured: boolean;
      model: string;
    };
    firebase: {
      projectId: string;
      databaseId: string;
      authDomain: string;
      authAuthorizedDomainsNotice: string;
    };
    tentenDomain: {
      productionHost: string;
      cnameTarget: string;
      rootDomainIp: string;
    };
  };
}

export const SystemDiagnosticsManager: React.FC = () => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [endpointResults, setEndpointResults] = useState<
    Record<string, { status: number; ms: number; ok: boolean }>
  >({});

  const runDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    const start = Date.now();
    try {
      const res = await fetch('/api/diagnostics');
      const elapsed = Date.now() - start;
      if (!res.ok) {
        throw new Error(`Máy chủ trả về HTTP ${res.status}: ${res.statusText}`);
      }
      const json: DiagnosticsData = await res.json();
      setData(json);
      setEndpointResults(prev => ({
        ...prev,
        '/api/diagnostics': { status: res.status, ms: elapsed, ok: true },
      }));
    } catch (err: any) {
      setError(err?.message || 'Không thể kết nối đến điểm kiểm tra /api/diagnostics');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runDiagnostics();
  }, [runDiagnostics]);

  const testEndpoint = async (path: string, method = 'GET') => {
    setTestingEndpoint(path);
    const start = Date.now();
    try {
      const opts: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (method === 'POST') {
        if (path.includes('maps')) opts.body = JSON.stringify({ urls: [] });
        else if (path.includes('suggest-needs')) opts.body = JSON.stringify({ userQuery: 'kiểm tra' });
        else if (path.includes('scan-document')) opts.body = JSON.stringify({ textContent: 'Văn bản test' });
        else opts.body = JSON.stringify({});
      }
      const res = await fetch(path, opts);
      const elapsed = Date.now() - start;
      setEndpointResults(prev => ({
        ...prev,
        [path]: { status: res.status, ms: elapsed, ok: res.ok },
      }));
      if (res.ok) {
        showToast('success', `Kiểm tra ${path} thành công`, `HTTP ${res.status} trong ${elapsed}ms`);
      } else {
        showToast('warning', `Kiểm tra ${path} có cảnh báo`, `HTTP ${res.status} (${res.statusText})`);
      }
    } catch (err: any) {
      const elapsed = Date.now() - start;
      setEndpointResults(prev => ({
        ...prev,
        [path]: { status: 0, ms: elapsed, ok: false },
      }));
      showToast('error', `Không thể gọi ${path}`, err?.message || 'Lỗi mạng');
    } finally {
      setTestingEndpoint(null);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast('info', 'Đã sao chép vào bộ nhớ tạm', text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-600" />
              Chẩn Đoán Triển Khai Hệ Thống (Vercel • GitHub • Tenten • Firebase)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Kiểm tra trạng thái thời gian thực các Vercel Serverless Functions, kết nối nguồn RSS Báo Sức Khỏe &amp; Đời Sống, tên miền tùy chỉnh Tenten, và cấu hình Firebase Authorized Domains.
          </p>
        </div>

        <button
          type="button"
          onClick={runDiagnostics}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition inline-flex items-center gap-2 self-start md:self-auto cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Đang kiểm tra...' : 'Chạy lại chẩn đoán'}</span>
        </button>
      </div>

      {/* Error alert if diagnostics endpoint failed */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Lỗi truy vấn điểm kiểm tra /api/diagnostics:</p>
            <p className="font-mono">{error}</p>
            <p className="text-slate-600 dark:text-slate-400 pt-1">
              Nguyên nhân phổ biến: Vercel chưa hoàn tất quá trình build function hoặc tệp vercel.json chưa cấu hình rewrite /api.
            </p>
          </div>
        </div>
      )}

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: App Health */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Trạng thái Hệ Thống</span>
            <Server className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-center gap-2">
            {data?.status === 'healthy' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Hoạt động Tốt
              </span>
            ) : data?.status === 'warning' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Cảnh báo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs">
                Đang xác thực...
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            Độ trễ: {data?.totalResponseTimeMs ?? '...'} ms
          </div>
        </div>

        {/* Card 2: RSS Upstream */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Nguồn RSS Báo SK&amp;ĐS</span>
            <Radio className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="flex items-center gap-2">
            {data?.services.rssUpstream.status === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Kết Nối Trực Tiếp
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Chậm / Gián đoạn
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {data?.services.rssUpstream.itemsFound
              ? `${data.services.rssUpstream.itemsFound} bài viết (${data.services.rssUpstream.responseTimeMs}ms)`
              : data?.services.rssUpstream.error || 'Đang kiểm tra...'}
          </div>
        </div>

        {/* Card 3: Platform / Vercel */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Nền tảng &amp; Runtime</span>
            <Zap className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-xs font-bold text-slate-900 dark:text-white">
            {data?.platform || 'Vercel Serverless'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            Node: {data?.nodeVersion || '20.x'} • Region: {data?.region || 'sin1 / local'}
          </div>
        </div>

        {/* Card 4: Tenten Custom Domain */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Tên Miền Tenten</span>
            <Globe className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono truncate">
            {data?.services.tentenDomain.productionHost || 'tyt.slhd.id.vn'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            CNAME → cname.vercel-dns.com.
          </div>
        </div>
      </div>

      {/* Section A: RSS Feed Deep Inspection */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Radio className="w-5 h-5 text-emerald-600" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Kiểm Tra Nguồn RSS Bắt Buộc: Báo Sức Khỏe &amp; Đời Sống
            </h4>
          </div>
          <a
            href="https://suckhoedoisong.vn/y-te.rss"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-emerald-600 hover:underline inline-flex items-center gap-1"
          >
            Mở nguồn gốc <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="font-bold text-slate-800 dark:text-slate-200">
              Thông số kết nối máy chủ nguồn
            </div>
            <div className="space-y-1.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
              <div className="flex justify-between">
                <span>Nguồn RSS:</span>
                <span className="text-emerald-600 truncate max-w-[200px]">https://suckhoedoisong.vn/y-te.rss</span>
              </div>
              <div className="flex justify-between">
                <span>Mã HTTP Status:</span>
                <span className="font-bold">{data?.services.rssUpstream.statusCode || '200 OK'}</span>
              </div>
              <div className="flex justify-between">
                <span>Thời gian phản hồi (Latency):</span>
                <span>{data?.services.rssUpstream.responseTimeMs ?? '...'} ms</span>
              </div>
              <div className="flex justify-between">
                <span>Số bài viết XML bóc tách:</span>
                <span className="text-emerald-600 font-bold">
                  {data?.services.rssUpstream.itemsFound || '24-30'} bài
                </span>
              </div>
              <div className="flex justify-between">
                <span>Parser XML &amp; CDATA:</span>
                <span className="text-emerald-600 font-bold">Chuẩn hóa UTF-8 + Enclosure Image</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="font-bold text-slate-800 dark:text-slate-200">
              Cơ chế Vercel Serverless Function &amp; CDN Caching
            </div>
            <p className="text-slate-600 dark:text-slate-400 text-[11px] leading-relaxed">
              Điểm cuối <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-emerald-600">/api/health-news-rss.ts</code> được triển khai độc lập thành Vercel Function:
            </p>
            <ul className="list-disc list-inside text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
              <li>Mô phỏng trình duyệt với đầy đủ User-Agent và Accept headers chuẩn.</li>
              <li>Tự động ngắt timeout sau 9 giây để chống nghẽn Vercel serverless.</li>
              <li>Bộ đệm Vercel Edge CDN: <code className="font-mono text-[10px]">s-maxage=600</code> (10 phút cache).</li>
              <li>Fallback dữ liệu mẫu nếu máy chủ ngoài gặp sự cố hoặc offline.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Section B: Vercel Serverless Function API Matrix */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="w-5 h-5 text-emerald-600" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Ma Trận Vercel Serverless Functions (/api/*)
            </h4>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            7 endpoints độc lập đã cấu hình trong thư mục <code className="font-mono text-emerald-600">/api/</code>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                <th className="py-2.5 px-3">Tên API Route</th>
                <th className="py-2.5 px-3">Phương thức</th>
                <th className="py-2.5 px-3">Mục đích</th>
                <th className="py-2.5 px-3">Kết quả ping</th>
                <th className="py-2.5 px-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
              {[
                { path: '/api/health-news-rss', method: 'GET', desc: 'RSS Báo Sức Khỏe & Đời Sống' },
                { path: '/api/diagnostics', method: 'GET', desc: 'Báo cáo chẩn đoán hệ thống' },
                { path: '/api/ai/status', method: 'GET', desc: 'Trạng thái tích hợp Gemini AI' },
                { path: '/api/ai/suggest-needs', method: 'POST', desc: 'Trợ lý AI Tìm Nhu Cầu' },
                { path: '/api/ai/scan-document', method: 'POST', desc: 'Trợ lý AI Quét Văn Bản' },
                { path: '/api/maps/resolve-urls', method: 'POST', desc: 'Giải mã tọa độ Google Maps' },
                { path: '/api/push/vapid-public-key', method: 'GET', desc: 'Khóa công khai Web Push' },
              ].map(item => {
                const res = endpointResults[item.path];
                const isTesting = testingEndpoint === item.path;

                return (
                  <tr key={item.path} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                      {item.path}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          item.method === 'GET'
                            ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {item.method}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-400">
                      {item.desc}
                    </td>
                    <td className="py-2.5 px-3">
                      {res ? (
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            res.ok ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {res.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          HTTP {res.status} ({res.ms}ms)
                        </span>
                      ) : (
                        <span className="text-slate-400 font-sans">Chưa thử nghiệm</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => testEndpoint(item.path, item.method)}
                        disabled={isTesting}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-sans font-semibold text-[11px] transition cursor-pointer disabled:opacity-50"
                      >
                        {isTesting ? 'Đang gọi...' : 'Ping Test'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section C: Firebase Authentication & Authorized Domains */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Database className="w-5 h-5 text-amber-600" />
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            Cấu Hình Firebase &amp; Tên Miền Đăng Nhập Được Cấp Phép (Authorized Domains)
          </h4>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Lưu ý quan trọng khi triển khai lên Vercel &amp; Tên miền Tenten:</span>
          </div>
          <p className="leading-relaxed">
            Khi triển khai sang tên miền chính thức <strong>https://tyt.slhd.id.vn</strong> hoặc tên miền tạm Vercel <strong>*.vercel.app</strong>, đăng nhập Google sẽ báo lỗi <code className="font-mono font-bold bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded">auth/unauthorized-domain</code> hoặc mở iframe <code className="font-mono font-bold bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded">/__/auth/iframe</code> báo <strong>"Lỗi không hợp lệ"</strong> nếu: (1) tên miền chưa được thêm vào <strong>Authorized domains</strong> trên Firebase Console, hoặc (2) bản deploy trên Vercel vẫn đang dùng cấu hình Firebase cũ (khác Project ID / API Key hiện tại) hoặc chưa bật nhà cung cấp <strong>Google</strong> trong Authentication → Sign-in method.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="font-bold text-slate-800 dark:text-slate-200">
              Các tên miền CẦN THÊM vào Firebase Console:
            </div>
            <div className="space-y-2">
              {[
                ...(typeof window !== 'undefined' && window.location.hostname
                  ? [{ domain: window.location.hostname, note: 'Tên miền đang truy cập hiện tại' }]
                  : []),
                { domain: 'tyt.slhd.id.vn', note: 'Tên miền Production Tenten' },
                { domain: 'slhd.id.vn', note: 'Tên miền gốc Apex' },
                { domain: 'tramyteportal.vercel.app', note: 'Tên miền Vercel App (hoặc project của bạn)' },
              ]
                .filter(
                  (item, index, arr) =>
                    arr.findIndex((other) => other.domain === item.domain) === index
                )
                .map(item => (
                <div
                  key={item.domain}
                  className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between font-mono text-[11px]"
                >
                  <div className="min-w-0 pr-2">
                    <span className="font-bold text-slate-900 dark:text-white break-all">{item.domain}</span>
                    <span className="block text-[10px] font-sans text-slate-400">{item.note}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(item.domain, item.domain)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer shrink-0"
                    title="Sao chép tên miền"
                  >
                    {copiedKey === item.domain ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="font-bold text-slate-800 dark:text-slate-200">
              Thông số Firebase đang kết nối &amp; 3 bước cấu hình:
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Project ID:</span>
                <span className="font-bold text-slate-900 dark:text-white truncate">
                  {data?.services.firebase.projectId || firebaseConfig.projectId}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Auth Domain:</span>
                <span className="font-bold text-slate-900 dark:text-white truncate">
                  {data?.services.firebase.authDomain || firebaseConfig.authDomain}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Database ID:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 truncate">
                  {data?.services.firebase.databaseId || firebaseConfig.firestoreDatabaseId}
                </span>
              </div>
            </div>
            <ol className="list-decimal list-inside text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
              <li>
                Truy cập{' '}
                <a
                  href={`https://console.firebase.google.com/project/${encodeURIComponent(
                    data?.services.firebase.projectId || firebaseConfig.projectId
                  )}/authentication/settings`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 font-bold hover:underline"
                >
                  Firebase Console (Authentication Settings)
                </a>
                , project <code className="font-mono">{data?.services.firebase.projectId || firebaseConfig.projectId}</code>.
              </li>
              <li>Vào menu bên trái: <strong>Authentication</strong> → tab <strong>Settings</strong> → chọn <strong>Authorized domains</strong>.</li>
              <li>Nhấn <strong>Add domain</strong> và dán tên miền đang chạy vào. Lưu lại là xong!</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Section D: Tenten DNS Configuration Guide */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-blue-600" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Cấu Hình Bản Ghi DNS Tenten (Trỏ Về Vercel)
            </h4>
          </div>
          <span className="text-xs text-slate-500">Trang quản trị: navi.tenten.vn</span>
        </div>

        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Trong bảng quản lý DNS tại Tenten cho tên miền <strong>slhd.id.vn</strong>, hãy tạo bản ghi CNAME cho subdomain <strong>tyt</strong>:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <span className="block text-[10px] text-slate-400 font-semibold uppercase">Loại bản ghi (Type)</span>
                <span className="text-xs font-mono font-bold text-emerald-600">CNAME</span>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <span className="block text-[10px] text-slate-400 font-semibold uppercase">Tên máy chủ (Host / Name)</span>
                <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">tyt</span>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <span className="block text-[10px] text-slate-400 font-semibold uppercase">Giá trị (Target / Value)</span>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">cname.vercel-dns.com.</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard('cname.vercel-dns.com.', 'cname')}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {copiedKey === 'cname' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              * Nếu muốn trỏ cả tên miền gốc <code className="font-mono">slhd.id.vn</code>, thêm bản ghi Type <strong>A</strong>, Host <strong>@</strong>, Giá trị: <code className="font-mono font-bold text-emerald-600">76.76.21.21</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
