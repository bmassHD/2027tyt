import {
  FeedbackAttachment,
  FeedbackAttachmentKind,
  GitHubConfig,
  UploadedFileItem,
} from '../types';
import { utf8ToBase64, base64ToUtf8 } from '../utils/base64Utils';

export const MAX_FEEDBACK_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_FEEDBACK_ATTACHMENTS = 5;

export function classifyAttachmentKind(
  fileName: string,
  mimeType?: string
): FeedbackAttachmentKind {
  const mime = (mimeType || '').toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (
    mime.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'heic', 'heif', 'avif'].includes(ext)
  ) {
    return 'image';
  }
  if (
    mime.startsWith('video/') ||
    ['mp4', 'mov', 'webm', 'mkv', 'avi', '3gp', 'm4v', 'mpeg', 'mpg'].includes(ext)
  ) {
    return 'video';
  }
  if (
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'wma'].includes(ext)
  ) {
    return 'audio';
  }
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('powerpoint') ||
    mime.includes('presentation') ||
    mime.startsWith('text/') ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'rtf', 'zip', 'rar', '7z'].includes(ext)
  ) {
    return 'document';
  }
  return 'other';
}


function base64ToBlob(base64: string, mimeType: string): Blob {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

export function inferAttachmentMimeType(fileName: string, mimeType?: string): string {
  const cleanMime = (mimeType || '').trim().toLowerCase();
  if (cleanMime && cleanMime !== 'application/octet-stream') {
    return cleanMime;
  }
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    '3gp': 'video/3gpp',
    m4v: 'video/x-m4v',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    flac: 'audio/flac',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json',
  };
  return map[ext] || cleanMime || 'application/octet-stream';
}

export class GitHubService {
  /**
   * Convert any standard GitHub file URL (/blob/ or /raw/ or ?raw=true) into a direct raw.githubusercontent.com link
   */
  public static toRawGitHubUrl(inputUrl: string): string {
    const trimmed = (inputUrl || '').trim();
    if (!trimmed) return '';

    // Base64 Data URL or Blob URL
    if (/^(data:|blob:)/i.test(trimmed)) {
      return trimmed;
    }

    // Already a raw.githubusercontent.com URL
    if (/^https?:\/\/raw\.githubusercontent\.com\//i.test(trimmed)) {
      return trimmed;
    }

    // Match https://github.com/{owner}/{repo}/blob/{branch}/{path} or /raw/{branch}/{path}
    const ghMatch = trimmed.match(
      /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+?)(?:\?.*)?$/i
    );
    if (ghMatch) {
      const [, owner, repo, branch, filePath] = ghMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    // Match Google Drive share links -> direct lh3 image link
    const driveFileMatch = trimmed.match(
      /^https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i
    );
    if (driveFileMatch) {
      return `https://lh3.googleusercontent.com/d/${driveFileMatch[1]}`;
    }
    const driveQueryMatch = trimmed.match(
      /^https?:\/\/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i
    );
    if (driveQueryMatch) {
      return `https://lh3.googleusercontent.com/d/${driveQueryMatch[1]}`;
    }

    return trimmed;
  }

  private static getHeaders(token: string) {
    return {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Test if the GitHub PAT and repository are valid and have write access
   */
  public static async testConnection(config: GitHubConfig): Promise<{ success: boolean; message: string }> {
    if (!config.token || !config.owner || !config.repo) {
      return { success: false, message: 'Vui lòng điền đầy đủ Token, Chủ sở hữu (Owner) và Tên Repo' };
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
        headers: this.getHeaders(config.token),
      });

      if (!res.ok) {
        if (res.status === 401) {
          return { success: false, message: 'Mã Token (PAT) không hợp lệ hoặc đã hết hạn.' };
        }
        if (res.status === 404) {
          return { success: false, message: 'Không tìm thấy repository hoặc Token không có quyền truy cập repo này.' };
        }
        return { success: false, message: `Lỗi kết nối GitHub (HTTP ${res.status}): ${res.statusText}` };
      }

      const repoData = await res.json();
      return {
        success: true,
        message: `Kết nối thành công tới kho ${repoData.full_name} (${repoData.default_branch})`,
      };
    } catch (err: any) {
      return { success: false, message: `Lỗi mạng khi kiểm tra GitHub: ${err?.message || err}` };
    }
  }

  /**
   * List files from repository under the configured folder path
   */
  public static async listFiles(config: GitHubConfig): Promise<UploadedFileItem[]> {
    if (!config.token || !config.owner || !config.repo) return [];

    try {
      const folder = config.folderPath?.replace(/^\/+|\/+$/g, '') || 'uploads';
      const branch = config.branch || 'main';
      const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${folder}?ref=${branch}`;

      const res = await fetch(url, {
        headers: this.getHeaders(config.token),
      });

      if (!res.ok) {
        if (res.status === 404) {
          // Folder doesn't exist yet, return empty list
          return [];
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data
        .filter((item: any) => item.type === 'file')
        .map((item: any) => {
          const ext = item.name.split('.').pop()?.toLowerCase() || '';
          let type: UploadedFileItem['type'] = 'other';
          if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) type = 'image';
          else if (ext === 'pdf') type = 'pdf';
          else if (['doc', 'docx'].includes(ext)) type = 'word';
          else if (['xls', 'xlsx', 'csv'].includes(ext)) type = 'excel';

          // CDN & raw urls
          const encodedPath = item.path
            .split('/')
            .map((seg: string) => encodeURIComponent(seg))
            .join('/');
          const rawUrl = `https://raw.githubusercontent.com/${config.owner.trim()}/${config.repo.trim()}/${encodeURIComponent(branch)}/${encodedPath}`;

          return {
            id: item.path || item.sha,
            sha: item.sha,
            name: item.name,
            path: item.path,
            size: item.size,
            downloadUrl: rawUrl,
            htmlUrl: item.html_url,
            type,
            uploadedAt: new Date().toISOString(),
            uploader: config.owner,
          };
        });
    } catch (err) {
      console.warn('GitHub listFiles error:', err);
      return [];
    }
  }

  /**
   * List backup JSON files stored under the repository backups directory
   */
  public static async listBackupFiles(config: GitHubConfig): Promise<{
    name: string;
    path: string;
    sha: string;
    size: number;
    downloadUrl: string;
    htmlUrl?: string;
  }[]> {
    const token = (config.token || '').trim();
    const owner = (config.owner || '').trim();
    const repo = (config.repo || '').trim();
    if (!token || !owner || !repo) return [];
    try {
      const folder = config.folderPath?.trim().replace(/^\/+|\/+$/g, '') || 'uploads';
      const { branch } = await this.resolveBranch(token, owner, repo, config.branch);
      const targetFolder = `${folder}/backups`;
      const encodedFolder = targetFolder
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedFolder}?ref=${encodeURIComponent(branch)}`;

      const res = await fetch(url, {
        headers: this.getHeaders(token),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data
        .filter((item: any) => item.type === 'file' && item.name.endsWith('.json'))
        .map((item: any) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size,
          downloadUrl: item.download_url,
          htmlUrl: item.html_url,
        }))
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch (err) {
      console.warn('GitHub listBackupFiles error:', err);
      return [];
    }
  }

  /**
   * Fetch raw content of a file in the repository (handles Base64 content from Contents API or raw download)
   */
  public static async fetchFileText(
    config: GitHubConfig,
    filePath: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    const token = (config.token || '').trim();
    const owner = (config.owner || '').trim();
    const repo = (config.repo || '').trim();
    if (!token || !owner || !repo) {
      return { success: false, error: 'Chưa cấu hình GitHub PAT hoặc Repository.' };
    }

    try {
      const cleanPath = filePath.replace(/^\/+/, '');
      const encodedPath = cleanPath
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
      const { branch } = await this.resolveBranch(token, owner, repo, config.branch);
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

      let res = await fetch(url, {
        headers: this.getHeaders(token),
      });

      if (!res.ok && branch) {
        res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, {
          headers: this.getHeaders(token),
        });
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (typeof data.content === 'string') {
        const text = base64ToUtf8(data.content);
        return { success: true, content: text };
      }

      if (data.download_url) {
        const dlRes = await fetch(data.download_url);
        if (dlRes.ok) {
          const text = await dlRes.text();
          return { success: true, content: text };
        }
      }

      return { success: false, error: 'Không lấy được nội dung tệp từ GitHub' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Lỗi khi đọc tệp từ GitHub' };
    }
  }

  private static async resolveBranch(
    token: string,
    owner: string,
    repo: string,
    configuredBranch?: string
  ): Promise<{ branch: string; isPrivate: boolean }> {
    let branch = (configuredBranch || '').trim() || 'main';
    let isPrivate = false;
    try {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: this.getHeaders(token),
      });
      if (repoRes.ok) {
        const repoInfo = await repoRes.json();
        isPrivate = Boolean(repoInfo.private);
        if (!configuredBranch?.trim() && repoInfo.default_branch) {
          branch = repoInfo.default_branch;
        }
      }
    } catch {
      // Proceed with configured branch
    }
    return { branch, isPrivate };
  }

  private static async putContentWithBranchFallback(
    token: string,
    owner: string,
    repo: string,
    targetPath: string,
    initialBranch: string,
    base64Content: string,
    message: string,
    sha?: string
  ): Promise<{ ok: boolean; status: number; data?: any; branch: string; error?: string }> {
    const encodedTargetPath = targetPath
      .split('/')
      .map(seg => encodeURIComponent(seg))
      .join('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedTargetPath}`;

    const attemptUpload = async (targetBranch: string) => {
      return fetch(url, {
        method: 'PUT',
        headers: this.getHeaders(token),
        body: JSON.stringify({
          message,
          content: base64Content,
          branch: targetBranch,
          ...(sha ? { sha } : {}),
        }),
      });
    };

    let branch = initialBranch;
    let res = await attemptUpload(branch);

    if (!res.ok && (res.status === 404 || res.status === 422)) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: this.getHeaders(token),
      }).catch(() => null);
      if (repoRes && repoRes.ok) {
        const repoInfo = await repoRes.json();
        if (repoInfo.default_branch && repoInfo.default_branch !== branch) {
          branch = repoInfo.default_branch;
          res = await attemptUpload(branch);
        }
      }
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      let errMsg = errJson.message || `Lỗi tải lên GitHub (HTTP ${res.status})`;
      if (Array.isArray(errJson.errors) && errJson.errors.length > 0) {
        const details = errJson.errors
          .map((e: any) => e.message || e.field || JSON.stringify(e))
          .join('; ');
        errMsg = `${errMsg} (${details})`;
      }
      return {
        ok: false,
        status: res.status,
        branch,
        error: errMsg,
      };
    }

    const data = await res.json();
    return { ok: true, status: res.status, data, branch };
  }

  /**
   * Upload a File (Image, PDF, Word, Excel) to GitHub repository via Contents API
   */
  public static async uploadFile(
    config: GitHubConfig,
    file: File,
    uploaderName: string
  ): Promise<{ success: boolean; fileItem?: UploadedFileItem; isPrivate?: boolean; error?: string }> {
    const token = (config.token || '').trim();
    const owner = (config.owner || '').trim();
    const repo = (config.repo || '').trim();
    if (!token || !owner || !repo) {
      return { success: false, error: 'Chưa cấu hình GitHub PAT hoặc Repository.' };
    }

    try {
      const folder = config.folderPath?.trim().replace(/^\/+|\/+$/g, '') || 'uploads';
      const { branch: initialBranch, isPrivate } = await this.resolveBranch(
        token,
        owner,
        repo,
        config.branch
      );

      const timestamp = Date.now();
      const sanitizedName = file.name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_');
      const targetPath = `${folder}/${timestamp}_${sanitizedName}`;

      const base64Data = await this.fileToBase64(file);
      const putRes = await this.putContentWithBranchFallback(
        token,
        owner,
        repo,
        targetPath,
        initialBranch,
        base64Data,
        `Y tế số: Tải lên tài liệu ${file.name} bởi ${uploaderName}`
      );

      if (!putRes.ok) {
        return { success: false, error: putRes.error };
      }

      const resData = putRes.data;
      const finalBranch = putRes.branch;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      let type: UploadedFileItem['type'] = 'other';
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) type = 'image';
      else if (ext === 'pdf') type = 'pdf';
      else if (['doc', 'docx'].includes(ext)) type = 'word';
      else if (['xls', 'xlsx', 'csv'].includes(ext)) type = 'excel';

      const encodedTargetPath = targetPath
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
      const fallbackRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(finalBranch)}/${encodedTargetPath}`;
      const rawUrl = resData.content?.download_url
        ? this.toRawGitHubUrl(resData.content.download_url)
        : fallbackRawUrl;

      const fileItem: UploadedFileItem = {
        id: targetPath,
        sha: resData.content?.sha,
        name: file.name,
        path: targetPath,
        size: file.size,
        downloadUrl: rawUrl,
        htmlUrl:
          resData.content?.html_url ||
          `https://github.com/${owner}/${repo}/blob/${finalBranch}/${targetPath}`,
        type,
        uploadedAt: new Date().toISOString(),
        uploader: uploaderName,
      };

      return { success: true, fileItem, isPrivate };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Lỗi không xác định khi tải lên GitHub' };
    }
  }

  /**
   * Upload a Citizen Feedback Attachment (<= 20MB: document, image, video, audio, etc.) to GitHub
   */
  public static async uploadFeedbackAttachment(
    config: GitHubConfig,
    file: File,
    ticketCode: string,
    uploaderName: string
  ): Promise<{ success: boolean; attachment?: FeedbackAttachment; error?: string }> {
    if (file.size <= 0) {
      return { success: false, error: `Tệp "${file.name}" bị rỗng (0 byte).` };
    }
    if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
      return {
        success: false,
        error: `Tệp "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB) vượt quá giới hạn tối đa 20MB.`,
      };
    }

    const token = (config.token || '').trim();
    const owner = (config.owner || '').trim();
    const repo = (config.repo || '').trim();
    if (!token || !owner || !repo) {
      return {
        success: false,
        error: 'Kho lưu trữ tệp GitHub chưa được Quản trị viên cấu hình.',
      };
    }

    try {
      const folder = config.folderPath?.trim().replace(/^\/+|\/+$/g, '') || 'uploads';
      const safeTicket = ticketCode.replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = Date.now();
      const sanitizedName = file.name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 120);
      const targetPath = `${folder}/phan-anh/${safeTicket}/${timestamp}_${sanitizedName || 'tep_dinh_kem'}`;

      const { branch: initialBranch } = await this.resolveBranch(
        token,
        owner,
        repo,
        config.branch
      );
      const base64Data = await this.fileToBase64(file);

      const putRes = await this.putContentWithBranchFallback(
        token,
        owner,
        repo,
        targetPath,
        initialBranch,
        base64Data,
        `Phản ánh ${safeTicket}: Tải tệp đính kèm ${file.name} bởi ${uploaderName}`
      );

      if (!putRes.ok) {
        return { success: false, error: putRes.error };
      }

      const resData = putRes.data;
      const finalBranch = putRes.branch;
      const encodedTargetPath = targetPath
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
      const fallbackRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(finalBranch)}/${encodedTargetPath}`;
      const rawUrlCandidate = resData.content?.download_url
        ? this.toRawGitHubUrl(resData.content.download_url)
        : fallbackRawUrl;
      // Never persist short-lived signed ?token= query strings inside Firestore
      const rawUrl = rawUrlCandidate.split('?')[0] || fallbackRawUrl;

      const attachment: FeedbackAttachment = {
        id: targetPath,
        name: file.name.slice(0, 256),
        path: targetPath,
        sha: resData.content?.sha,
        size: file.size,
        mimeType: inferAttachmentMimeType(file.name, file.type).slice(0, 128),
        kind: classifyAttachmentKind(file.name, file.type),
        downloadUrl: rawUrl.slice(0, 1024),
        htmlUrl: (
          resData.content?.html_url ||
          `https://github.com/${owner}/${repo}/blob/${finalBranch}/${encodedTargetPath}`
        ).slice(0, 1024),
        uploadedAt: new Date().toISOString(),
      };

      return { success: true, attachment };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || `Không thể tải tệp "${file.name}" lên GitHub`,
      };
    }
  }

  /**
   * Upload JSON data (e.g. feedback record backup or full system backup) to GitHub repository
   */
  public static async uploadJsonContent(
    config: GitHubConfig,
    relativeSubPath: string,
    payload: unknown,
    commitMessage: string
  ): Promise<{
    success: boolean;
    path?: string;
    downloadUrl?: string;
    htmlUrl?: string;
    error?: string;
  }> {
    const token = (config.token || '').trim();
    const owner = (config.owner || '').trim();
    const repo = (config.repo || '').trim();
    if (!token || !owner || !repo) {
      return { success: false, error: 'Chưa cấu hình GitHub PAT hoặc Repository.' };
    }

    try {
      const folder = config.folderPath?.trim().replace(/^\/+|\/+$/g, '') || 'uploads';
      const cleanSub = relativeSubPath.replace(/^\/+|\/+$/g, '');
      const targetPath = `${folder}/${cleanSub}`;
      const { branch: initialBranch } = await this.resolveBranch(
        token,
        owner,
        repo,
        config.branch
      );

      const jsonText = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      const base64Data = utf8ToBase64(jsonText);

      const putRes = await this.putContentWithBranchFallback(
        token,
        owner,
        repo,
        targetPath,
        initialBranch,
        base64Data,
        commitMessage
      );

      if (!putRes.ok) {
        return { success: false, error: putRes.error };
      }

      const resData = putRes.data;
      const finalBranch = putRes.branch;
      const encodedTargetPath = targetPath
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
      const fallbackRawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(finalBranch)}/${encodedTargetPath}`;

      return {
        success: true,
        path: targetPath,
        downloadUrl: (resData.content?.download_url
          ? this.toRawGitHubUrl(resData.content.download_url)
          : fallbackRawUrl
        ).slice(0, 1024),
        htmlUrl: (
          resData.content?.html_url ||
          `https://github.com/${owner}/${repo}/blob/${finalBranch}/${encodedTargetPath}`
        ).slice(0, 1024),
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Lỗi khi sao lưu JSON lên GitHub',
      };
    }
  }

  /**
   * Delete a file from GitHub repository
   */
  public static async deleteFile(
    config: GitHubConfig,
    path: string,
    sha: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!config.token || !config.owner || !config.repo) {
      return { success: false, error: 'Chưa cấu hình GitHub PAT' };
    }

    try {
      const branch = config.branch || 'main';
      const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;

      const res = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(config.token),
        body: JSON.stringify({
          message: `Xoá tài liệu: ${path}`,
          sha,
          branch,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { success: false, error: errJson.message || `Lỗi xoá tệp (HTTP ${res.status})` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Lỗi xoá tệp trên GitHub' };
    }
  }

  /**
   * Resolve a viewable / downloadable URL for a feedback attachment, supporting BOTH public and private GitHub repositories.
   */
  public static async fetchAttachmentObjectUrl(
    config: GitHubConfig | undefined,
    att: Pick<FeedbackAttachment, 'name' | 'path' | 'sha' | 'mimeType' | 'downloadUrl' | 'htmlUrl'>
  ): Promise<{
    url?: string;
    isObjectUrl?: boolean;
    mimeType: string;
    error?: string;
  }> {
    const resolvedMime = inferAttachmentMimeType(att.name, att.mimeType);

    let owner = (config?.owner || '').trim();
    let repo = (config?.repo || '').trim();
    let branch = (config?.branch || '').trim();
    let filePath = (att.path || '').trim().replace(/^\/+/, '');

    const htmlMatch = (att.htmlUrl || '').match(
      /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+?)(?:\?.*)?$/i
    );
    if (htmlMatch) {
      owner = decodeURIComponent(htmlMatch[1]);
      repo = decodeURIComponent(htmlMatch[2]);
      branch = decodeURIComponent(htmlMatch[3]);
      if (!filePath) {
        filePath = htmlMatch[4]
          .split('/')
          .map(seg => {
            try {
              return decodeURIComponent(seg);
            } catch {
              return seg;
            }
          })
          .join('/');
      }
    } else {
      const rawMatch = (att.downloadUrl || '').match(
        /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)(?:\?.*)?$/i
      );
      if (rawMatch) {
        owner = decodeURIComponent(rawMatch[1]);
        repo = decodeURIComponent(rawMatch[2]);
        branch = decodeURIComponent(rawMatch[3]);
        if (!filePath) {
          filePath = rawMatch[4]
            .split('/')
            .map(seg => {
              try {
                return decodeURIComponent(seg);
              } catch {
                return seg;
              }
            })
            .join('/');
        }
      }
    }

    const token = (config?.token || '').trim();
    const wrapBlobUrl = (blob: Blob) => {
      const typed = blob.slice(0, blob.size, resolvedMime);
      return {
        url: URL.createObjectURL(typed),
        isObjectUrl: true,
        mimeType: resolvedMime,
      };
    };

    if (token && owner && repo && (filePath || att.sha)) {
      const encodedPath = filePath
        .split('/')
        .filter(Boolean)
        .map(seg => encodeURIComponent(seg))
        .join('/');

      const tryContentsMetadataAndFetch = async (refParam?: string) => {
        if (!encodedPath) return null;
        const qs = refParam ? `?ref=${encodeURIComponent(refParam)}` : '';
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${qs}`;

        // 1. Direct raw stream via Contents API (supports up to 100MB, works on private repos)
        try {
          const rawRes = await fetch(apiUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.raw+json',
            },
          });
          if (rawRes.ok) {
            const rawBlob = await rawRes.blob();
            return wrapBlobUrl(rawBlob);
          }
        } catch {
          // Try JSON metadata next
        }

        // 2. JSON metadata -> inline base64 (<= 1MB) or signed download_url or git blob sha
        try {
          const metaRes = await fetch(apiUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });
          if (!metaRes.ok) return null;
          const meta = await metaRes.json();

          if (typeof meta?.content === 'string' && meta?.encoding === 'base64') {
            return wrapBlobUrl(base64ToBlob(meta.content, resolvedMime));
          }

          if (typeof meta?.download_url === 'string' && meta.download_url) {
            try {
              const dlRes = await fetch(meta.download_url);
              if (dlRes.ok) {
                return wrapBlobUrl(await dlRes.blob());
              }
            } catch {
              // Fallback to git blob sha below
            }
          }

          if (typeof meta?.sha === 'string' && meta.sha) {
            const blobRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/vnd.github.raw+json',
                },
              }
            );
            if (blobRes.ok) {
              return wrapBlobUrl(await blobRes.blob());
            }
          }
        } catch {
          return null;
        }
        return null;
      };

      const fromBranch = await tryContentsMetadataAndFetch(branch || undefined);
      if (fromBranch) return fromBranch;

      if (branch) {
        const fromDefault = await tryContentsMetadataAndFetch(undefined);
        if (fromDefault) return fromDefault;
      }

      if (att.sha) {
        try {
          const blobRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/blobs/${att.sha}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.raw+json',
              },
            }
          );
          if (blobRes.ok) {
            return wrapBlobUrl(await blobRes.blob());
          }
          const blobJsonRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/blobs/${att.sha}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json',
              },
            }
          );
          if (blobJsonRes.ok) {
            const blobData = await blobJsonRes.json();
            if (typeof blobData?.content === 'string' && blobData?.encoding === 'base64') {
              return wrapBlobUrl(base64ToBlob(blobData.content, resolvedMime));
            }
          }
        } catch {
          // Continue to public downloadUrl fallback
        }
      }
    }

    // Public URL fallback
    const cleanPublicUrl = (att.downloadUrl || '').trim();
    if (cleanPublicUrl) {
      try {
        const pubRes = await fetch(cleanPublicUrl);
        if (pubRes.ok) {
          return wrapBlobUrl(await pubRes.blob());
        }
        return {
          mimeType: resolvedMime,
          error:
            pubRes.status === 404
              ? 'Không tìm thấy tệp trên GitHub (kho lưu trữ riêng tư cần cấu hình GitHub Token hợp lệ để xem).'
              : `Không thể tải tệp (HTTP ${pubRes.status}).`,
        };
      } catch {
        // If CORS blocked fetch on a public image/media, allow direct URL as fallback
        return {
          url: cleanPublicUrl,
          isObjectUrl: false,
          mimeType: resolvedMime,
        };
      }
    }

    return {
      mimeType: resolvedMime,
      error: 'Không có đường dẫn khả dụng để mở tệp đính kèm này.',
    };
  }

  private static fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data:*;base64, prefix
        const base64 = result.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  }
}

