import React, { useState } from 'react';
import {
  X,
  Type,
  Palette,
  Image,
  Video,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Upload,
  Plus,
  Trash2,
  Maximize2,
  Minimize2,
  ExternalLink,
  RefreshCw,
  FolderGit2,
  Eye,
  Check,
  Copy,
  Sparkles,
} from 'lucide-react';
import { Post, PostMediaItem, GitHubConfig, FacebookEmbedKind, FacebookEmbedMeta } from '../../types';
import { GitHubService } from '../../services/githubService';
import { useToast } from '../../contexts/ToastContext';
import { FacebookPostEmbed } from '../common/FacebookPostEmbed';
import {
  deriveFacebookPostTitle,
  detectEmbedTypeFromInput,
  getYouTubeEmbedId,
  parseFacebookEmbedInput,
} from '../../utils/facebookEmbed';

interface RichPostEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (postData: Partial<Post>) => Promise<void>;
  initialPost?: Partial<Post>;
  githubConfig?: GitHubConfig;
  uploaderName: string;
}

const colorPalette = [
  { name: 'Mặc định', value: '#0f172a' },
  { name: 'Xanh y tế', value: '#059669' },
  { name: 'Xanh ngọc', value: '#0d9488' },
  { name: 'Xanh dương', value: '#0284c7' },
  { name: 'Đỏ y tế', value: '#dc2626' },
  { name: 'Tím', value: '#7c3aed' },
  { name: 'Vàng cam', value: '#d97706' },
  { name: 'Xám đậm', value: '#475569' },
];

const fontFamilies = [
  { name: 'Inter (Hiện đại / Không chân)', value: 'font-sans' },
  { name: 'Merriweather (Trang trọng / Có chân)', value: 'font-serif' },
  { name: 'Mono (Chuyên môn / Mã số)', value: 'font-mono' },
];

const fontSizes = [
  { label: 'Nhỏ (13px)', value: 'text-xs' },
  { label: 'Chuẩn (14px)', value: 'text-sm' },
  { label: 'Vừa (16px)', value: 'text-base' },
  { label: 'Lớn (18px)', value: 'text-lg' },
  { label: 'Tiêu đề nhỏ (20px)', value: 'text-xl' },
  { label: 'Tiêu đề lớn (24px)', value: 'text-2xl' },
];

export const RichPostEditorModal: React.FC<RichPostEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialPost,
  githubConfig,
  uploaderName,
}) => {
  const { showToast } = useToast();

  const [title, setTitle] = useState(initialPost?.title || '');
  const [summary, setSummary] = useState(initialPost?.summary || '');
  const [content, setContent] = useState(initialPost?.content || '');
  const [category, setCategory] = useState<Post['category']>(initialPost?.category || 'giao_duc_suc_khoe');

  // Rich Typography & Layout Styling
  const [fontFamily, setFontFamily] = useState(initialPost?.richStyle?.fontFamily || initialPost?.fontFamily || 'font-sans');
  const [fontSize, setFontSize] = useState(initialPost?.richStyle?.fontSize || initialPost?.fontSize || 'text-sm');
  const [textColor, setTextColor] = useState(initialPost?.richStyle?.textColor || initialPost?.textColor || '#0f172a');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right' | 'justify'>(initialPost?.richStyle?.alignment || 'left');

  // Media items (Images, GIFs, Videos)
  const [mediaItems, setMediaItems] = useState<PostMediaItem[]>(initialPost?.mediaItems || []);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [showAddUrlBox, setShowAddUrlBox] = useState(false);
  const [manualMediaUrl, setManualMediaUrl] = useState('');

  // Link Insertion Helper
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  // Embed URL (YouTube or Facebook)
  const [embedUrl, setEmbedUrl] = useState(initialPost?.embedUrl || '');
  const [embedType, setEmbedType] = useState<Post['embedType']>(initialPost?.embedType || 'none');
  const [fbKind, setFbKind] = useState<FacebookEmbedKind>(initialPost?.facebookMeta?.kind || 'auto');
  const [fbDisplayName, setFbDisplayName] = useState(initialPost?.facebookMeta?.displayName || '');
  const [fbFollowersText, setFbFollowersText] = useState(initialPost?.facebookMeta?.followersText || '');
  const [fbLikesText, setFbLikesText] = useState(initialPost?.facebookMeta?.likesText || '');
  const [fbBio, setFbBio] = useState(initialPost?.facebookMeta?.bio || '');
  const [fbAvatarUrl, setFbAvatarUrl] = useState(initialPost?.facebookMeta?.avatarUrl || '');
  const [fbPostText, setFbPostText] = useState(initialPost?.facebookMeta?.postText || '');
  const [fbShowImage, setFbShowImage] = useState(initialPost?.facebookMeta?.showImage !== false);
  const [fbShowText, setFbShowText] = useState(initialPost?.facebookMeta?.showText !== false);
  const [fetchingFbMeta, setFetchingFbMeta] = useState(false);
  const [fbMetaNotice, setFbMetaNotice] = useState<string | null>(null);

  // Preview Mode
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brokenMediaIds, setBrokenMediaIds] = useState<Record<string, boolean>>({});
  const [localFallbacks, setLocalFallbacks] = useState<Record<string, string>>({});

  const compressImageToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Preserve animated GIFs up to 700KB directly
      if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) {
        if (file.size <= 700 * 1024) {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Không thể đọc tệp GIF'));
          reader.readAsDataURL(file);
          return;
        }
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        try {
          const MAX_DIM = 1280;
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width >= height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh'));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          // Try WebP first (supports transparency & high compression), fallback to JPEG
          let dataUrl = canvas.toDataURL('image/webp', 0.82);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          }
          // If still large (> 320KB chars), step down quality
          if (dataUrl.length > 320_000) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.68);
          }
          URL.revokeObjectURL(objectUrl);
          resolve(dataUrl);
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        // Fallback to raw FileReader for formats canvas can't decode (e.g. SVG)
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Định dạng ảnh không hợp lệ'));
        reader.readAsDataURL(file);
      };
      img.src = objectUrl;
    });
  };

  React.useEffect(() => {
    if (isOpen) {
      setTitle(initialPost?.title || '');
      setSummary(initialPost?.summary || '');
      setContent(initialPost?.content || '');
      setCategory(initialPost?.category || 'giao_duc_suc_khoe');
      setFontFamily(initialPost?.richStyle?.fontFamily || initialPost?.fontFamily || 'font-sans');
      setFontSize(initialPost?.richStyle?.fontSize || initialPost?.fontSize || 'text-sm');
      setTextColor(initialPost?.richStyle?.textColor || initialPost?.textColor || '#0f172a');
      setTextAlign(initialPost?.richStyle?.alignment || 'left');
      setMediaItems(
        (initialPost?.mediaItems || []).map(item => ({
          ...item,
          url: GitHubService.toRawGitHubUrl(item.url),
        }))
      );
      setShowAddUrlBox(false);
      setManualMediaUrl('');
      setEmbedUrl(initialPost?.embedUrl || '');
      setEmbedType(initialPost?.embedType || 'none');
      setFbKind(initialPost?.facebookMeta?.kind || 'auto');
      setFbDisplayName(initialPost?.facebookMeta?.displayName || '');
      setFbFollowersText(initialPost?.facebookMeta?.followersText || '');
      setFbLikesText(initialPost?.facebookMeta?.likesText || '');
      setFbBio(initialPost?.facebookMeta?.bio || '');
      setFbAvatarUrl(initialPost?.facebookMeta?.avatarUrl || '');
      setFbPostText(initialPost?.facebookMeta?.postText || '');
      setFbShowImage(initialPost?.facebookMeta?.showImage !== false);
      setFbShowText(initialPost?.facebookMeta?.showText !== false);
      setFetchingFbMeta(false);
      setFbMetaNotice(null);
      setPreviewMode(false);
      setBrokenMediaIds({});
      setLocalFallbacks({});
    }
  }, [isOpen, initialPost]);

  if (!isOpen) return null;

  // Upload image/media directly (GitHub PAT if configured, with automatic compressed Data URL fallback)
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const hasGitHubConfig = Boolean(
      githubConfig?.token?.trim() &&
      githubConfig?.owner?.trim() &&
      githubConfig?.repo?.trim()
    );

    setIsUploadingMedia(true);
    let uploadedCount = 0;
    let usedDirectEmbed = false;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isVideo = file.type.startsWith('video/') || ['mp4', 'webm'].includes(ext);
        let type: PostMediaItem['type'] = 'image';
        if (ext === 'gif' || file.type === 'image/gif') type = 'gif';
        else if (isVideo) type = 'video';

        if (hasGitHubConfig && githubConfig) {
          const res = await GitHubService.uploadFile(githubConfig, file, uploaderName);

          if (res.success && res.fileItem && !res.isPrivate) {
            const rawImageUrl = GitHubService.toRawGitHubUrl(res.fileItem.downloadUrl);
            const itemId = res.fileItem.id || `${Date.now()}_${i}`;

            if (!isVideo) {
              try {
                const localPreview = await compressImageToDataUrl(file);
                setLocalFallbacks(prev => ({ ...prev, [itemId]: localPreview }));
              } catch {
                // ignore preview generation error
              }
            }

            setMediaItems(prev => [
              ...prev,
              {
                id: itemId,
                url: rawImageUrl,
                type,
                caption: file.name,
                widthPercent: 100,
                align: 'center',
              },
            ]);
            uploadedCount++;
            continue;
          }

          if (res.success && res.isPrivate && !isVideo) {
            showToast(
              'info',
              'Kho GitHub đang ở chế độ Riêng tư',
              'Ảnh được tự động nhúng trực tiếp vào bài viết để người dân xem được bình thường.'
            );
          } else if (!res.success && !isVideo) {
            showToast(
              'info',
              'Đang lưu ảnh trực tiếp vào bài viết',
              res.error ? `GitHub: ${res.error}` : undefined
            );
          } else if (!res.success && isVideo) {
            showToast('error', `Lỗi tải video: ${file.name}`, res.error);
            continue;
          }
        }

        // Direct compressed embed fallback (when GitHub PAT is not set, repo is private, or GitHub fails)
        if (isVideo) {
          if (file.size > 700 * 1024) {
            showToast(
              'warning',
              'Video quá lớn để nhúng trực tiếp',
              'Vui lòng cấu hình GitHub PAT trong Quản trị hoặc dùng mục Nhúng Video YouTube bên dưới.'
            );
            continue;
          }
          const videoDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Không đọc được tệp video'));
            reader.readAsDataURL(file);
          });
          setMediaItems(prev => [
            ...prev,
            {
              id: `${Date.now()}_${i}`,
              url: videoDataUrl,
              type: 'video',
              caption: file.name,
              widthPercent: 100,
              align: 'center',
            },
          ]);
          uploadedCount++;
          usedDirectEmbed = true;
        } else {
          try {
            const compressedDataUrl = await compressImageToDataUrl(file);
            if (!compressedDataUrl) {
              showToast('error', `Không thể đọc ảnh: ${file.name}`);
              continue;
            }
            setMediaItems(prev => [
              ...prev,
              {
                id: `${Date.now()}_${i}`,
                url: compressedDataUrl,
                type,
                caption: file.name,
                widthPercent: 100,
                align: 'center',
              },
            ]);
            uploadedCount++;
            usedDirectEmbed = true;
          } catch (err: any) {
            showToast('error', `Lỗi xử lý ảnh: ${file.name}`, err?.message);
          }
        }
      }

      if (uploadedCount > 0) {
        showToast(
          'success',
          usedDirectEmbed ? 'Đã tải ảnh vào bài viết' : 'Đã tải tệp & lấy liên kết Raw GitHub',
          `Đã thêm ${uploadedCount} tệp vào bài viết.`
        );
      }
    } finally {
      setIsUploadingMedia(false);
      e.target.value = '';
    }
  };

  // Add custom URL image/gif (auto-converts github.com/blob links to raw.githubusercontent.com)
  const handleAddMediaUrl = () => {
    const rawUrl = GitHubService.toRawGitHubUrl(manualMediaUrl);
    if (!rawUrl) {
      showToast('warning', 'Vui lòng nhập đường dẫn URL hình ảnh hoặc GIF');
      return;
    }

    const lower = rawUrl.toLowerCase();
    const newItem: PostMediaItem = {
      id: Date.now().toString(),
      url: rawUrl,
      type: lower.includes('.gif') ? 'gif' : lower.includes('.mp4') || lower.includes('.webm') ? 'video' : 'image',
      caption: '',
      widthPercent: 100,
      align: 'center',
    };
    setMediaItems(prev => [...prev, newItem]);
    setManualMediaUrl('');
    setShowAddUrlBox(false);
    if (rawUrl !== manualMediaUrl.trim()) {
      showToast('info', 'Đã tự động chuyển sang liên kết Raw GitHub', rawUrl);
    }
  };

  // Insert Hyperlink into content
  const handleInsertLink = () => {
    if (!linkUrl.trim()) return;
    const anchor = linkText.trim()
      ? `[${linkText.trim()}](${linkUrl.trim()})`
      : linkUrl.trim();

    setContent(prev => prev + ' ' + anchor + ' ');
    setShowLinkModal(false);
    setLinkText('');
    setLinkUrl('');
    showToast('info', 'Đã gắn liên kết vào nội dung bài viết');
  };

  // Update Media properties (size, alignment, caption)
  const updateMediaItem = (id: string, updates: Partial<PostMediaItem>) => {
    setMediaItems(prev =>
      prev.map(item => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const removeMediaItem = (id: string) => {
    setMediaItems(prev => prev.filter(item => item.id !== id));
  };

  const effectiveFbKind =
    fbKind !== 'auto' ? fbKind : parseFacebookEmbedInput(embedUrl).detectedKind;

  const currentFacebookMeta: FacebookEmbedMeta | null =
    embedType === 'facebook' && embedUrl.trim()
      ? {
          kind: fbKind,
          displayName: fbDisplayName.trim() || undefined,
          followersText: fbFollowersText.trim() || undefined,
          likesText: fbLikesText.trim() || undefined,
          bio: fbBio.trim() || undefined,
          avatarUrl: fbAvatarUrl.trim() || undefined,
          postText: fbPostText.trim() || undefined,
          showImage: fbShowImage,
          showText: fbShowText,
        }
      : null;

  const handleEmbedInputChange = (rawValue: string) => {
    setEmbedUrl(rawValue);
    setFbMetaNotice(null);
    const detected = detectEmbedTypeFromInput(rawValue);
    if (detected && (embedType === 'none' || detected !== embedType)) {
      setEmbedType(detected);
    }
  };

  const handleSyncFacebookMetadata = async () => {
    const raw = embedUrl.trim();
    if (!raw) {
      showToast('warning', 'Vui lòng dán đường dẫn hoặc mã nhúng Facebook trước');
      return;
    }

    const parsed = parseFacebookEmbedInput(raw);
    const targetUrl = parsed.isValid ? parsed.postUrl : raw;

    setFetchingFbMeta(true);
    setFbMetaNotice(null);
    try {
      const resp = await fetch('/api/facebook-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await resp.json();

      const parsedKind = parsed.detectedKind;
      const effectiveKindForSync: FacebookEmbedKind =
        fbKind !== 'auto' ? fbKind : parsedKind;
      const isPageOrProfileSync =
        effectiveKindForSync === 'page' || effectiveKindForSync === 'profile';

      let syncedItems = 0;
      const fetchedName = String(data?.displayName || data?.title || '').slice(0, 220);

      if (fetchedName && isPageOrProfileSync) {
        if (!fbDisplayName.trim()) {
          setFbDisplayName(fetchedName);
        }
        if (!title.trim()) {
          setTitle(fetchedName);
        }
        syncedItems++;
      }

      if (data?.followersText && isPageOrProfileSync) {
        setFbFollowersText(String(data.followersText));
        syncedItems++;
      }

      if (data?.likesText && isPageOrProfileSync) {
        setFbLikesText(String(data.likesText));
      }

      if (data?.description) {
        const desc = String(data.description).trim();
        if (!fbPostText.trim()) {
          setFbPostText(desc);
        }
        if (isPageOrProfileSync && !fbBio.trim()) {
          setFbBio(desc.length > 320 ? `${desc.slice(0, 317)}...` : desc);
        }
        if (!isPageOrProfileSync && !title.trim()) {
          const contentTitle =
            (data?.suggestedTitle ? String(data.suggestedTitle).trim() : '') ||
            deriveFacebookPostTitle(desc, fetchedName);
          if (contentTitle) {
            setTitle(contentTitle);
          }
        }
        if (!summary.trim()) {
          setSummary(desc.length > 260 ? `${desc.slice(0, 257)}...` : desc);
        }
        if (!content.trim() && !isPageOrProfileSync) {
          setContent(desc);
        }
        syncedItems++;
      }

      if (Array.isArray(data?.images) && data.images.length > 0 && isPageOrProfileSync) {
        if (!fbAvatarUrl.trim()) {
          setFbAvatarUrl(String(data.images[0]));
        }
        syncedItems += 1;
      }

      if (syncedItems > 0) {
        setFbMetaNotice(
          isPageOrProfileSync
            ? 'Đã đồng bộ thông tin & số lượng người theo dõi từ Facebook. Bạn có thể kiểm tra hoặc chỉnh sửa thêm bên dưới.'
            : 'Đã đồng bộ tiêu đề và nội dung công khai từ Facebook mà không làm thay đổi liên kết bài viết nhúng.'
        );
        showToast(
          'success',
          isPageOrProfileSync
            ? 'Đã lấy thông tin Fanpage/Trang cá nhân từ Facebook'
            : 'Đã lấy nội dung từ bài viết Facebook'
        );
      } else {
        setFbMetaNotice(
          isPageOrProfileSync
            ? 'Facebook không trả về số liệu tự động cho đường dẫn này — bạn có thể chọn đúng loại (Fanpage / Trang cá nhân) và nhập trực tiếp số lượng người theo dõi ở ô bên dưới.'
            : 'Không lấy được văn bản tự động từ Facebook cho bài viết này (liên kết bài viết nhúng giữ nguyên không thay đổi).'
        );
        showToast('info', 'Giữ nguyên bài viết Facebook nhúng hiện tại');
      }
    } catch {
      setFbMetaNotice(
        'Khung nhúng trực tiếp từ Facebook vẫn giữ nguyên và hoạt động độc lập bên dưới.'
      );
      showToast('info', 'Giữ nguyên liên kết nhúng Facebook');
    } finally {
      setFetchingFbMeta(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmbed = embedUrl.trim();
    let finalEmbedUrl = '';
    let finalEmbedType: Post['embedType'] = embedType;

    if (trimmedEmbed && finalEmbedType === 'none') {
      const autoDetected = detectEmbedTypeFromInput(trimmedEmbed);
      if (autoDetected) {
        finalEmbedType = autoDetected;
      }
    }

    if (finalEmbedType === 'facebook' && trimmedEmbed) {
      const parsedFb = parseFacebookEmbedInput(trimmedEmbed);
      if (!parsedFb.isValid) {
        showToast(
          'warning',
          'Đường dẫn hoặc mã nhúng Facebook chưa hợp lệ',
          'Vui lòng dán link Facebook (bài viết, Fanpage, trang cá nhân) hoặc thẻ <iframe ...> từ nút Nhúng.'
        );
        return;
      }
      finalEmbedUrl = parsedFb.postUrl;
    } else if (finalEmbedType === 'youtube' && trimmedEmbed) {
      finalEmbedUrl = trimmedEmbed;
    } else {
      finalEmbedType = 'none';
      finalEmbedUrl = '';
    }

    const hasEmbed = finalEmbedType !== 'none' && Boolean(finalEmbedUrl);

    if (!title.trim() || (!content.trim() && !hasEmbed)) {
      showToast(
        'warning',
        'Vui lòng điền tiêu đề và nội dung bài viết (hoặc nhúng Facebook / Video YouTube)'
      );
      return;
    }

    const totalPayloadBytes = JSON.stringify(mediaItems).length + title.length + summary.length + content.length;
    if (totalPayloadBytes > 950_000) {
      showToast(
        'warning',
        'Dung lượng ảnh đính kèm vượt giới hạn lưu trữ',
        'Vui lòng giảm bớt số lượng ảnh hoặc cấu hình GitHub PAT để lưu ảnh dung lượng lớn.'
      );
      return;
    }

    setSaving(true);
    try {
      const cleanedFbMeta: FacebookEmbedMeta | null =
        finalEmbedType === 'facebook' && finalEmbedUrl
          ? {
              kind: fbKind,
              displayName: fbDisplayName.trim() || undefined,
              followersText: fbFollowersText.trim() || undefined,
              likesText: fbLikesText.trim() || undefined,
              bio: fbBio.trim() || undefined,
              avatarUrl: fbAvatarUrl.trim() || undefined,
              postText: fbPostText.trim() || undefined,
              showImage: fbShowImage,
              showText: fbShowText,
            }
          : null;

      await onSave({
        title: title.trim(),
        summary: summary.trim() || title.trim(),
        content: content.trim(),
        category,
        fontFamily,
        fontSize,
        textColor,
        richStyle: {
          fontFamily,
          fontSize,
          textColor,
          alignment: textAlign,
        },
        mediaItems: mediaItems.map(item => ({
          ...item,
          url: GitHubService.toRawGitHubUrl(item.url),
        })),
        embedUrl: finalEmbedUrl,
        embedType: finalEmbedType,
        facebookMeta: cleanedFbMeta,
      });

      onClose();
    } catch (err: any) {
      showToast('error', 'Lưu bài viết thất bại', err?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Type className="w-5 h-5 text-emerald-600" />
              {initialPost?.id
                ? 'Chỉnh Sửa Bài Viết Truyền Thông Y Tế'
                : 'Soạn Thảo Bài Viết & Tùy Biến Bố Cục Đa Phương Tiện'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {initialPost?.id
                ? 'Cập nhật nội dung, tiêu đề, chuyên mục, liên kết và hình ảnh bài viết.'
                : 'Tùy chỉnh cỡ chữ, phông chữ, màu sắc, gắn liên kết ẩn và lưu trữ hình ảnh trên GitHub PAT.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                previewMode
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{previewMode ? 'Sửa bài' : 'Xem trước'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!previewMode ? (
            <form id="rich-post-form" onSubmit={handleSubmit} className="space-y-5 text-xs">
              {/* Title & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tiêu đề bài viết *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Chiến dịch tiêm chủng mở rộng phòng sởi và rubella..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Chuyên mục
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as any)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="giao_duc_suc_khoe">Khuyến cáo sức khỏe</option>
                    <option value="phong_chong_dich">Phòng chống dịch bệnh</option>
                    <option value="tiem_chung">Tiêm chủng mở rộng</option>
                    <option value="benh_khong_lay_nhiem">Bệnh không lây nhiễm</option>
                    <option value="tin_hoat_dong">Tin hoạt động Trạm</option>
                    <option value="an_toan_thuc_pham">An toàn thực phẩm</option>
                  </select>
                </div>
              </div>

              {/* Rich Styling Toolbar */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-slate-700 dark:text-slate-300 font-semibold">
                  {/* Font Family */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Phông chữ:</span>
                    <select
                      value={fontFamily}
                      onChange={e => setFontFamily(e.target.value)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs"
                    >
                      {fontFamilies.map(f => (
                        <option key={f.value} value={f.value}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Font Size */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Cỡ chữ:</span>
                    <select
                      value={fontSize}
                      onChange={e => setFontSize(e.target.value)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs"
                    >
                      {fontSizes.map(s => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Text Color Picker */}
                  <div className="flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-400">Màu chữ:</span>
                    <div className="flex items-center gap-1">
                      {colorPalette.map(c => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setTextColor(c.value)}
                          className={`w-5 h-5 rounded-full border transition transform hover:scale-110 ${
                            textColor === c.value ? 'ring-2 ring-emerald-500 scale-110' : ''
                          }`}
                          style={{ backgroundColor: c.value }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Alignment */}
                  <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setTextAlign('left')}
                      className={`p-1.5 ${textAlign === 'left' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'text-slate-500'}`}
                      title="Căn trái"
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTextAlign('center')}
                      className={`p-1.5 ${textAlign === 'center' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'text-slate-500'}`}
                      title="Căn giữa"
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTextAlign('right')}
                      className={`p-1.5 ${textAlign === 'right' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'text-slate-500'}`}
                      title="Căn phải"
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTextAlign('justify')}
                      className={`p-1.5 ${textAlign === 'justify' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'text-slate-500'}`}
                      title="Căn đều hai bên"
                    >
                      <AlignJustify className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Insert Hyperlink */}
                  <button
                    type="button"
                    onClick={() => setShowLinkModal(true)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-emerald-600 flex items-center gap-1"
                  >
                    <Link className="w-3.5 h-3.5" /> Gắn link / link ẩn
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Đoạn trích tóm tắt (Lead / Summary — tùy chọn)
                </label>
                <textarea
                  rows={2}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  placeholder="Tóm tắt ngắn gọn nội dung truyền thông y tế (tự lấy theo tiêu đề nếu để trống)..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Main Content Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Nội dung bài viết chi tiết {embedType === 'none' ? '*' : '(tùy chọn khi đã nhúng bài viết)'}
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Hỗ trợ định dạng văn bản, đoạn ngắt dòng và liên kết [chữ ẩn](url)
                  </span>
                </div>
                <textarea
                  rows={7}
                  required={embedType === 'none'}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  style={{ color: textColor }}
                  className={`w-full px-3.5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed ${fontFamily} ${fontSize} ${
                    textAlign === 'center'
                      ? 'text-center'
                      : textAlign === 'right'
                      ? 'text-right'
                      : textAlign === 'justify'
                      ? 'text-justify'
                      : 'text-left'
                  }`}
                  placeholder="Soạn thảo toàn văn hướng dẫn, phòng bệnh, triệu chứng, đối tượng..."
                />
              </div>

              {/* Media Management (Multiple Images, GIFs, Video & Resizing) */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Image className="w-5 h-5 text-emerald-600" />
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white">
                        Hình Ảnh, GIF & Phương Tiện ({mediaItems.length})
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        {githubConfig?.token && githubConfig?.owner && githubConfig?.repo
                          ? 'Tự động lưu lên kho GitHub PAT (hoặc nhúng trực tiếp nếu kho riêng tư).'
                          : 'Tải ảnh trực tiếp từ thiết bị (tự động nén tối ưu) hoặc dán link ảnh/GIF.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddUrlBox(prev => !prev)}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      + Chèn link ảnh/GIF
                    </button>

                    <label className="cursor-pointer px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition flex items-center gap-1.5">
                      {isUploadingMedia ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      <span>{isUploadingMedia ? 'Đang tải ảnh...' : 'Tải ảnh lên'}</span>
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/mp4"
                        className="hidden"
                        disabled={isUploadingMedia}
                        onChange={handleMediaUpload}
                      />
                    </label>
                  </div>
                </div>

                {showAddUrlBox && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="url"
                      value={manualMediaUrl}
                      onChange={e => setManualMediaUrl(e.target.value)}
                      placeholder="Dán link ảnh / GIF hoặc link GitHub (tự động chuyển sang Raw URL)..."
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleAddMediaUrl}
                        className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs cursor-pointer"
                      >
                        Thêm ảnh
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddUrlBox(false);
                          setManualMediaUrl('');
                        }}
                        className="px-2.5 py-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs"
                      >
                        Huỷ
                      </button>
                    </div>
                  </div>
                )}

                {/* Media Cards with Resize & Alignment Controls */}
                {mediaItems.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {mediaItems.map(m => {
                      const displayUrl = GitHubService.toRawGitHubUrl(m.url);
                      return (
                        <div
                          key={m.id}
                          className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5"
                        >
                          <div className="w-full h-36 rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-900 relative flex items-center justify-center">
                            {m.type === 'video' ? (
                              <video
                                src={displayUrl}
                                controls
                                className="w-full h-full object-contain bg-black"
                              />
                            ) : brokenMediaIds[m.id] ? (
                              <div className="p-3 text-center space-y-1">
                                <Image className="w-6 h-6 text-slate-400 mx-auto" />
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                  Không thể tải ảnh từ liên kết này. Hãy kiểm tra URL công khai hoặc dùng nút "Tải ảnh lên".
                                </p>
                              </div>
                            ) : (
                              <img
                                src={displayUrl}
                                alt={m.caption || 'Hình ảnh bài viết'}
                                referrerPolicy="no-referrer"
                                onError={() => {
                                  const fallback = localFallbacks[m.id];
                                  if (fallback && m.url !== fallback) {
                                    updateMediaItem(m.id, { url: fallback });
                                  } else {
                                    setBrokenMediaIds(prev => ({ ...prev, [m.id]: true }));
                                  }
                                }}
                                className="w-full h-full object-cover"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => removeMediaItem(m.id)}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-rose-600 transition cursor-pointer"
                              title="Xóa ảnh"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Direct Raw URL field + Copy button */}
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={m.url.startsWith('data:') ? '[Ảnh đã nhúng trực tiếp vào bài viết]' : m.url}
                              readOnly={m.url.startsWith('data:')}
                              onChange={e => {
                                setBrokenMediaIds(prev => ({ ...prev, [m.id]: false }));
                                updateMediaItem(m.id, {
                                  url: GitHubService.toRawGitHubUrl(e.target.value),
                                });
                              }}
                              placeholder="Liên kết Raw URL..."
                              className="flex-1 px-2 py-1 text-[10px] font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(displayUrl);
                                showToast('info', 'Đã sao chép liên kết Raw hình ảnh');
                              }}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-emerald-600 transition cursor-pointer shrink-0"
                              title="Sao chép liên kết Raw"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Caption input */}
                          <input
                            type="text"
                            value={m.caption || ''}
                            onChange={e => updateMediaItem(m.id, { caption: e.target.value })}
                            placeholder="Chú thích dưới ảnh..."
                            className="w-full px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />

                        {/* Size (Zoom in/out) & Alignment options */}
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <div className="flex items-center gap-1">
                            <span>Kích thước:</span>
                            <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                              {[25, 50, 75, 100].map(pct => (
                                <button
                                  key={pct}
                                  type="button"
                                  onClick={() => updateMediaItem(m.id, { widthPercent: pct })}
                                  className={`px-1.5 py-0.5 text-[10px] font-bold ${
                                    m.widthPercent === pct
                                      ? 'bg-emerald-600 text-white'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {pct}%
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <span>Canh lề:</span>
                            <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                              {(['left', 'center', 'right'] as const).map(align => (
                                <button
                                  key={align}
                                  type="button"
                                  onClick={() => updateMediaItem(m.id, { align })}
                                  className={`px-1.5 py-0.5 text-[10px] uppercase font-bold ${
                                    m.align === align
                                      ? 'bg-emerald-600 text-white'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {align[0]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* YouTube / Facebook Embed Section */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white block">
                        Nhúng trực tiếp Bài viết Facebook hoặc Video YouTube
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Dán link bài viết/ảnh/video Facebook hoặc mã &lt;iframe&gt; để hiển thị đầy đủ nội dung &amp; hình ảnh
                      </span>
                    </div>
                  </div>

                  <select
                    value={embedType}
                    onChange={e => {
                      const next = e.target.value as Post['embedType'];
                      setEmbedType(next);
                      setFbMetaNotice(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
                  >
                    <option value="none">Không nhúng</option>
                    <option value="facebook">Bài viết Facebook</option>
                    <option value="youtube">Video YouTube</option>
                  </select>
                </div>

                {embedType !== 'none' && (
                  <div className="space-y-3">
                    <textarea
                      rows={2}
                      value={embedUrl}
                      onChange={e => handleEmbedInputChange(e.target.value)}
                      placeholder={
                        embedType === 'youtube'
                          ? 'https://www.youtube.com/watch?v=... hoặc mã <iframe ...>'
                          : 'Dán link bài viết Facebook (https://www.facebook.com/.../posts/..., share/p/...) hoặc mã <iframe src="https://www.facebook.com/plugins/post.php?..."></iframe>'
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />

                    {embedType === 'facebook' && (
                      <div className="space-y-3">
                        {/* Kind Selector: Auto / Post / Video / Fanpage / Profile */}
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">
                            Cách hiển thị nội dung Facebook:
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(
                              [
                                { id: 'auto', label: 'Tự động' },
                                { id: 'post', label: 'Bài viết' },
                                { id: 'video', label: 'Video / Reel' },
                                { id: 'page', label: 'Fanpage' },
                                { id: 'profile', label: 'Trang cá nhân' },
                              ] as const
                            ).map(opt => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setFbKind(opt.id)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                                  fbKind === opt.id
                                    ? 'bg-blue-600 text-white shadow-2xs'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={handleSyncFacebookMetadata}
                            disabled={fetchingFbMeta || !embedUrl.trim()}
                            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                          >
                            {fetchingFbMeta ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {fetchingFbMeta
                                ? 'Đang lấy thông tin...'
                                : effectiveFbKind === 'page' || effectiveFbKind === 'profile'
                                ? 'Tải tên & số người theo dõi từ Facebook'
                                : 'Tải nội dung từ Facebook'}
                            </span>
                          </button>

                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {effectiveFbKind === 'page'
                              ? 'Fanpage: Hiển thị dòng thời gian trang & số người theo dõi.'
                              : effectiveFbKind === 'profile'
                              ? 'Trang cá nhân: Hiển thị hồ sơ kèm số lượng người theo dõi.'
                              : 'Bài viết: Hiển thị đầy đủ nội dung & hình ảnh bài viết công khai.'}
                          </span>
                        </div>

                        {/* Followers & Profile/Page details when embedding Fanpage or Personal Profile */}
                        {(effectiveFbKind === 'page' || effectiveFbKind === 'profile') && (
                          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-900/60 space-y-2.5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                  Tên Fanpage / Trang cá nhân
                                </label>
                                <input
                                  type="text"
                                  value={fbDisplayName}
                                  onChange={e => setFbDisplayName(e.target.value)}
                                  placeholder="ví dụ: Trang thông tin Trạm Y Tế..."
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                  Số lượng người theo dõi (Followers)
                                </label>
                                <input
                                  type="text"
                                  value={fbFollowersText}
                                  onChange={e => setFbFollowersText(e.target.value)}
                                  placeholder="ví dụ: 12,5K người theo dõi hoặc 3450"
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                                />
                              </div>
                            </div>

                            {effectiveFbKind === 'profile' && (
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                  Giới thiệu ngắn (tùy chọn)
                                </label>
                                <input
                                  type="text"
                                  value={fbBio}
                                  onChange={e => setFbBio(e.target.value)}
                                  placeholder="Thông tin giới thiệu hiển thị trên thẻ trang cá nhân..."
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Tick Hiện ảnh / Hiện nội dung khi đã dán link nhúng Facebook */}
                        {embedUrl.trim() && (
                          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-blue-200/80 dark:border-blue-900/60 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                Tùy chọn hiển thị bài viết Facebook đã nhúng:
                              </span>
                              <div className="flex flex-wrap items-center gap-4">
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={fbShowImage}
                                    onChange={e => {
                                      const checked = e.target.checked;
                                      setFbShowImage(checked);
                                      if (!checked && fbShowText && !fbPostText.trim() && !content.trim() && !fetchingFbMeta) {
                                        handleSyncFacebookMetadata();
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                  <span>Hiện ảnh</span>
                                </label>
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={fbShowText}
                                    onChange={e => setFbShowText(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                  <span>Hiện nội dung</span>
                                </label>
                              </div>
                            </div>

                            {!fbShowImage && fbShowText && (effectiveFbKind === 'post' || effectiveFbKind === 'video') && (
                              <div>
                                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                                  Nội dung văn bản bài viết Facebook (khi ẩn ảnh):
                                </label>
                                <textarea
                                  rows={2}
                                  value={fbPostText}
                                  onChange={e => setFbPostText(e.target.value)}
                                  placeholder="Nội dung của bài viết Facebook sẽ hiển thị ở đây (tự tải hoặc nhập bổ sung nếu Facebook hạn chế)..."
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {fbMetaNotice && (
                          <div className="px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[11px] text-blue-800 dark:text-blue-200 leading-relaxed">
                            {fbMetaNotice}
                          </div>
                        )}

                        {embedUrl.trim() && (
                          <div className="pt-1">
                            <FacebookPostEmbed
                              url={embedUrl}
                              title={title}
                              facebookMeta={currentFacebookMeta}
                              fallbackText={content || summary}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {embedType === 'youtube' && getYouTubeEmbedId(embedUrl) && (
                      <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-200 dark:border-slate-700">
                        <iframe
                          src={`https://www.youtube.com/embed/${getYouTubeEmbedId(embedUrl)}`}
                          title={title || 'Xem trước Video YouTube'}
                          className="w-full h-full border-0"
                          allowFullScreen
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </form>
          ) : (
            /* Live Preview Layout */
            <div className="space-y-6 max-w-2xl mx-auto p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-4">
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {category}
                </span>
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white leading-tight">
                  {title || 'Tiêu đề bài viết xem trước'}
                </h1>
                {summary.trim() && summary.trim() !== title.trim() && (
                  <p className="text-xs text-slate-500 font-medium italic">
                    {summary}
                  </p>
                )}
              </div>

              {embedType === 'youtube' && getYouTubeEmbedId(embedUrl) && (
                <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${getYouTubeEmbedId(embedUrl)}`}
                    title={title || 'Video YouTube'}
                    className="w-full h-full border-0"
                    allowFullScreen
                  />
                </div>
              )}

              {embedType === 'facebook' && embedUrl.trim() && (
                <FacebookPostEmbed
                  url={embedUrl}
                  title={title}
                  facebookMeta={currentFacebookMeta}
                  fallbackText={content || summary}
                />
              )}

              {/* Render Media items if any */}
              {mediaItems.map(m => {
                const displayUrl = GitHubService.toRawGitHubUrl(m.url);
                return (
                  <div
                    key={m.id}
                    className={`my-4 ${
                      m.align === 'center'
                        ? 'mx-auto text-center'
                        : m.align === 'right'
                        ? 'ml-auto text-right'
                        : 'mr-auto text-left'
                    }`}
                    style={{ width: `${m.widthPercent || 100}%` }}
                  >
                    {m.type === 'video' ? (
                      <video
                        src={displayUrl}
                        controls
                        className="rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 w-full"
                      />
                    ) : (
                      <img
                        src={displayUrl}
                        alt={m.caption || ''}
                        referrerPolicy="no-referrer"
                        className="rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 w-full"
                      />
                    )}
                    {m.caption && (
                      <p className="text-[11px] text-slate-500 mt-1 italic">{m.caption}</p>
                    )}
                  </div>
                );
              })}

              {/* Content with applied styling */}
              <div
                style={{ color: textColor }}
                className={`whitespace-pre-wrap leading-relaxed ${fontFamily} ${fontSize} ${
                  textAlign === 'center'
                    ? 'text-center'
                    : textAlign === 'right'
                    ? 'text-right'
                    : textAlign === 'justify'
                    ? 'text-justify'
                    : 'text-left'
                }`}
              >
                {content || 'Nội dung bài viết...'}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
          >
            Đóng
          </button>

          <button
            type="submit"
            form="rich-post-form"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{initialPost?.id ? 'Lưu cập nhật bài viết' : 'Xuất bản bài viết'}</span>
          </button>
        </div>
      </div>

      {/* Insert Link / Hidden Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-3.5 text-xs">
            <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
              <Link className="w-4 h-4 text-emerald-600" /> Gắn Liên Kết (Hyperlink)
            </h4>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Văn bản hiển thị (Anchor text)
              </label>
              <input
                type="text"
                value={linkText}
                onChange={e => setLinkText(e.target.value)}
                placeholder="ví dụ: Xem Thông tư 33/2015/TT-BYT..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Địa chỉ liên kết đích (URL) *
              </label>
              <input
                type="url"
                required
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://moh.gov.vn/..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleInsertLink}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold shadow-xs"
              >
                Chèn liên kết
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
