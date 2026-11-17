import React, { useState, useEffect } from 'react';
import { GitHubConfig, UploadedFileItem } from '../../types';
import { GitHubService } from '../../services/githubService';
import { useToast } from '../../contexts/ToastContext';
import {
  Upload,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  CheckCircle,
  Copy,
  Trash2,
  ExternalLink,
  RefreshCw,
  FolderGit2,
  KeyRound,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface GitHubFileManagerProps {
  config?: GitHubConfig;
  onSaveConfig: (config: GitHubConfig) => Promise<void>;
  uploaderName: string;
}

export const GitHubFileManager: React.FC<GitHubFileManagerProps> = ({
  config,
  onSaveConfig,
  uploaderName,
}) => {
  const { showToast, showConfirm } = useToast();

  const [formConfig, setFormConfig] = useState<GitHubConfig>({
    owner: config?.owner || '',
    repo: config?.repo || '',
    branch: config?.branch || 'main',
    token: config?.token || '',
    folderPath: config?.folderPath || 'tailieu_y_te',
    isConfigured: config?.isConfigured || false,
  });

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // File list & upload state
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');

  useEffect(() => {
    if (config) {
      setFormConfig({
        owner: config.owner || '',
        repo: config.repo || '',
        branch: config.branch || 'main',
        token: config.token || '',
        folderPath: config.folderPath || 'tailieu_y_te',
        isConfigured: config.isConfigured || false,
      });

      if (config.token && config.owner && config.repo) {
        fetchFiles(config);
      }
    }
  }, [config]);

  const fetchFiles = async (cfgToUse: GitHubConfig) => {
    setIsLoadingFiles(true);
    try {
      const list = await GitHubService.listFiles(cfgToUse);
      setFiles(list);
    } catch {
      showToast('error', 'Không thể tải danh sách tệp từ GitHub');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await GitHubService.testConnection(formConfig);
      setTestResult(res);
      if (res.success) {
        showToast('success', 'Kết nối GitHub thành công', res.message);
      } else {
        showToast('error', 'Kiểm tra thất bại', res.message);
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const test = await GitHubService.testConnection(formConfig);
      const updatedConfig: GitHubConfig = {
        ...formConfig,
        isConfigured: test.success,
      };
      await onSaveConfig(updatedConfig);
      showToast(
        test.success ? 'success' : 'warning',
        'Đã lưu cấu hình GitHub PAT',
        test.success ? 'Kho lưu trữ sẵn sàng nhận tệp tải lên.' : test.message
      );
      if (test.success) {
        fetchFiles(updatedConfig);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    if (!formConfig.token || !formConfig.owner || !formConfig.repo) {
      showToast('warning', 'Vui lòng cấu hình GitHub PAT trước khi tải tệp');
      return;
    }

    setIsUploading(true);
    let successCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setUploadProgressText(`Đang tải (${i + 1}/${selectedFiles.length}): ${file.name}`);

      const result = await GitHubService.uploadFile(formConfig, file, uploaderName);
      if (result.success && result.fileItem) {
        successCount++;
      } else {
        showToast('error', `Lỗi tải tệp: ${file.name}`, result.error);
      }
    }

    setIsUploading(false);
    setUploadProgressText('');
    e.target.value = '';

    if (successCount > 0) {
      showToast('success', 'Tải lên hoàn tất', `Đã lưu thành công ${successCount} tệp vào GitHub repo.`);
      fetchFiles(formConfig);
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    showToast('info', 'Đã sao chép liên kết tệp', url);
  };

  const handleDeleteFile = (file: UploadedFileItem) => {
    showConfirm({
      title: 'Xoá tệp khỏi kho GitHub?',
      message: `Bạn có chắc chắn muốn xoá vĩnh viễn tệp "${file.name}" khỏi repository? Thao tác này sẽ tạo một commit xoá trên nhánh ${formConfig.branch}.`,
      confirmText: 'Xoá tệp',
      cancelText: 'Huỷ',
      isDangerous: true,
      onConfirm: async () => {
        const res = await GitHubService.deleteFile(formConfig, file.path, file.sha || file.id);
        if (res.success) {
          showToast('success', 'Đã xoá tệp thành công');
          fetchFiles(formConfig);
        } else {
          showToast('error', 'Xoá tệp thất bại', res.error);
        }
      },
    });
  };

  const getFileIcon = (type: UploadedFileItem['type']) => {
    switch (type) {
      case 'image':
        return <Image className="w-5 h-5 text-emerald-500" />;
      case 'pdf':
        return <FileText className="w-5 h-5 text-rose-500" />;
      case 'word':
        return <FileText className="w-5 h-5 text-blue-500" />;
      case 'excel':
        return <FileSpreadsheet className="w-5 h-5 text-teal-600" />;
      default:
        return <File className="w-5 h-5 text-slate-400" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-8">
      {/* GitHub PAT Configuration Card */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
              <FolderGit2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Cấu hình Lưu trữ Tệp qua GitHub PAT
                {formConfig.isConfigured && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <ShieldCheck className="w-3.5 h-3.5" /> Đã kết nối
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sử dụng GitHub Personal Access Token (PAT) để lưu trữ hình ảnh, biểu mẫu Word, PDF văn bản, bảng Excel mà không tốn chi phí.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              GitHub Personal Access Token (PAT) *
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={formConfig.token}
                onChange={e => setFormConfig({ ...formConfig, token: e.target.value })}
                placeholder="ghp_xxxxxxxxxxxx hoặc github_pat_xxxx"
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Cần quyền scope: <code>repo</code> hoặc <code>contents:write</code>.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tài khoản / Tổ chức (Owner) *
            </label>
            <input
              type="text"
              required
              value={formConfig.owner}
              onChange={e => setFormConfig({ ...formConfig, owner: e.target.value })}
              placeholder="ví dụ: tram-y-te-org hoặc username"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tên Kho lưu trữ (Repository) *
            </label>
            <input
              type="text"
              required
              value={formConfig.repo}
              onChange={e => setFormConfig({ ...formConfig, repo: e.target.value })}
              placeholder="ví dụ: tyt-tai-lieu"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nhánh (Branch)
              </label>
              <input
                type="text"
                value={formConfig.branch}
                onChange={e => setFormConfig({ ...formConfig, branch: e.target.value })}
                placeholder="main"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Thư mục tải lên
              </label>
              <input
                type="text"
                value={formConfig.folderPath}
                onChange={e => setFormConfig({ ...formConfig, folderPath: e.target.value })}
                placeholder="tailieu_y_te"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>
          </div>

          {testResult && (
            <div
              className={`col-span-full p-3 rounded-xl text-xs flex items-center gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="col-span-full flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={isTesting || !formConfig.token}
              onClick={handleTestConnection}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition flex items-center gap-2"
            >
              {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              Kiểm tra kết nối
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition flex items-center gap-2"
            >
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              Lưu cấu hình GitHub
            </button>
          </div>
        </form>
      </div>

      {/* File Upload & Repository Explorer */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Kho Tệp Y Tế & Truyền Thông ({files.length} tệp)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Hỗ trợ tệp hình ảnh (.png, .jpg), biểu mẫu Word (.docx), công văn PDF, và số liệu Excel (.xlsx).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isLoadingFiles}
              onClick={() => fetchFiles(formConfig)}
              className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl bg-slate-100 dark:bg-slate-800 transition"
              title="Làm mới danh sách"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
            </button>

            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition">
              <Upload className="w-4 h-4" />
              <span>Tải tệp lên GitHub</span>
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                className="hidden"
                disabled={isUploading || !formConfig.isConfigured}
                onChange={handleFileUpload}
              />
            </label>
          </div>
        </div>

        {isUploading && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 animate-pulse">
            <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin" />
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              {uploadProgressText}
            </span>
          </div>
        )}

        {/* Files Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Tên tệp</th>
                <th className="py-3 px-3">Loại</th>
                <th className="py-3 px-3">Dung lượng</th>
                <th className="py-3 px-3">Đường dẫn tệp</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {files.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    {isLoadingFiles
                      ? 'Đang tải danh sách tệp từ GitHub...'
                      : formConfig.isConfigured
                      ? 'Chưa có tệp nào trong thư mục kho lưu trữ. Hãy nhấn "Tải tệp lên GitHub".'
                      : 'Vui lòng cấu hình và lưu GitHub PAT hợp lệ phía trên để bắt đầu tải tệp.'}
                  </td>
                </tr>
              ) : (
                files.map((file, idx) => (
                  <tr key={file.path || `${file.id}_${idx}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white flex items-center gap-2.5">
                      {getFileIcon(file.type)}
                      <span className="truncate max-w-xs" title={file.name}>
                        {file.name}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-500 uppercase text-[10px] font-semibold">
                      {file.type}
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      {formatFileSize(file.size)}
                    </td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px] truncate max-w-xs">
                      {file.path}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleCopyLink(file.downloadUrl)}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg transition"
                        title="Sao chép liên kết tải trực tiếp"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <a
                        href={file.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block p-1.5 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition"
                        title="Xem trên GitHub"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(file)}
                        className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition"
                        title="Xoá tệp"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
