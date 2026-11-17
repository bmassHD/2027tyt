import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  Share2,
  UserCheck,
  Users,
  ThumbsUp,
  Flag,
  FileText,
} from 'lucide-react';
import { FacebookEmbedMeta } from '../../types';
import {
  buildFacebookPluginUrl,
  formatFollowersLabel,
  parseFacebookEmbedInput,
  ResolvedFacebookKind,
} from '../../utils/facebookEmbed';

interface FacebookPostEmbedProps {
  url: string;
  title?: string;
  compact?: boolean;
  facebookMeta?: FacebookEmbedMeta | null;
  fallbackText?: string;
  className?: string;
}

export const FacebookPostEmbed: React.FC<FacebookPostEmbedProps> = ({
  url,
  title,
  compact = false,
  facebookMeta,
  fallbackText = '',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rawWidth, setRawWidth] = useState<number>(compact ? 350 : 500);
  const [dynamicHeight, setDynamicHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const initialParsed = useMemo(
    () => parseFacebookEmbedInput(url, rawWidth),
    [url, rawWidth]
  );

  const effectiveKind: ResolvedFacebookKind = useMemo(() => {
    if (facebookMeta?.kind && facebookMeta.kind !== 'auto') {
      return facebookMeta.kind;
    }
    return initialParsed.detectedKind;
  }, [facebookMeta?.kind, initialParsed.detectedKind]);

  const pluginRequestWidth = useMemo(() => {
    if (effectiveKind === 'page') {
      return Math.max(180, Math.min(500, rawWidth));
    }
    if (effectiveKind === 'video') {
      return Math.max(220, Math.min(750, rawWidth));
    }
    return Math.max(350, Math.min(750, rawWidth));
  }, [effectiveKind, rawWidth]);

  const parsed = useMemo(
    () => parseFacebookEmbedInput(url, pluginRequestWidth),
    [url, pluginRequestWidth]
  );

  const showImage = facebookMeta?.showImage !== false;
  const showText = facebookMeta?.showText !== false;

  useEffect(() => {
    setLoaded(false);
    setAvatarError(false);
    setDynamicHeight(null);
  }, [url, effectiveKind, showImage, showText]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.origin || !event.origin.includes('facebook.com')) return;
      try {
        const data =
          typeof event.data === 'string' && event.data.trim().startsWith('{')
            ? JSON.parse(event.data)
            : event.data;
        const h = Number(data?.height || data?.data?.height);
        if (!Number.isNaN(h) && h >= 120 && h <= 1400) {
          setDynamicHeight(Math.round(h));
        }
      } catch {
        // ignore unrelated cross-origin messages
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) {
        setRawWidth(prev => (Math.abs(prev - w) >= 4 ? w : prev));
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  if (!parsed.isValid) {
    return (
      <div
        className={`p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs flex items-center justify-between gap-2 ${
          compact ? 'h-full' : ''
        } ${className}`}
      >
        <span className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5 shrink-0" />
          <span>Liên kết Facebook</span>
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-600 dark:text-blue-300 font-bold hover:underline inline-flex items-center gap-1 shrink-0"
          >
            <span>Mở trên Facebook</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  const followersDisplay = formatFollowersLabel(facebookMeta?.followersText);
  const likesDisplay = (facebookMeta?.likesText || '').trim();
  const displayName = (facebookMeta?.displayName || '').trim() || title || 'Facebook';
  const avatarSrc = showImage && !avatarError ? facebookMeta?.avatarUrl : '';
  const initialLetter = displayName.charAt(0).toUpperCase() || 'F';
  const resolvedPostText =
    (facebookMeta?.postText || '').trim() ||
    (facebookMeta?.bio || '').trim() ||
    fallbackText.trim();

  // MODE A: Personal Profile Card
  if (effectiveKind === 'profile') {
    return (
      <div
        ref={containerRef}
        className={`rounded-2xl border border-indigo-200/90 dark:border-indigo-900/60 bg-white dark:bg-slate-900 overflow-hidden shadow-xs ${
          compact ? 'h-full flex flex-col' : ''
        } ${className}`}
      >
        {/* Top Cover Accent */}
        <div
          className={`${
            compact ? 'h-12 pt-2.5' : 'h-16 sm:h-20 pt-3'
          } bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 relative px-4 flex items-start justify-between shrink-0`}
        >
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-xs text-white text-[11px] font-semibold">
            <UserCheck className="w-3 h-3" />
            <span>Trang cá nhân Facebook</span>
          </span>
          <a
            href={parsed.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-[11px] font-semibold transition"
          >
            <span>Mở Facebook</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Profile Info Body */}
        <div
          className={`px-4 pb-3.5 pt-0 relative ${
            compact ? 'flex-1 flex flex-col justify-between gap-2' : 'space-y-3 pb-4'
          }`}
        >
          <div className={`flex flex-wrap items-end justify-between gap-2 ${compact ? '-mt-6' : '-mt-8 gap-3'}`}>
            <div className="flex items-end gap-3 min-w-0">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  className={`${
                    compact ? 'w-12 h-12' : 'w-16 h-16'
                  } rounded-2xl object-cover border-4 border-white dark:border-slate-900 bg-slate-100 shadow-md shrink-0`}
                />
              ) : (
                <div
                  className={`${
                    compact ? 'w-12 h-12 text-lg' : 'w-16 h-16 text-xl'
                  } rounded-2xl border-4 border-white dark:border-slate-900 bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-extrabold flex items-center justify-center shadow-md shrink-0`}
                >
                  {initialLetter}
                </div>
              )}
              <div className={`min-w-0 ${compact ? 'pt-6' : 'pt-8'}`}>
                <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {displayName}
                </h4>
                <p className="text-[11px] text-slate-400 truncate font-mono">
                  {parsed.postUrl.replace(/^https?:\/\/(www\.)?/, '')}
                </p>
              </div>
            </div>

            {!compact && (
              <a
                href={parsed.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition shrink-0"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Theo dõi trang cá nhân</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Followers Highlight */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/70 text-indigo-900 dark:text-indigo-200">
              <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div className="text-xs">
                <span className="text-slate-500 dark:text-slate-400 mr-1.5">Số người theo dõi:</span>
                <span className="font-extrabold tabular-nums">
                  {followersDisplay || 'Xem trực tiếp trên Facebook'}
                </span>
              </div>
            </div>

            {likesDisplay && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/70 text-blue-800 dark:text-blue-200 text-xs font-semibold">
                <ThumbsUp className="w-3.5 h-3.5 shrink-0" />
                <span>{likesDisplay}</span>
              </div>
            )}
          </div>

          {!compact && showText && facebookMeta?.bio && (
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
              {facebookMeta.bio}
            </p>
          )}
        </div>
      </div>
    );
  }

  // MODE B: Fanpage Embed (Header with Followers badge + Official Page Plugin)
  if (effectiveKind === 'page') {
    const defaultPageHeight = !showText
      ? 130
      : compact
      ? 185
      : expanded
      ? 820
      : 540;
    const pageFrameHeight = dynamicHeight && !expanded ? Math.min(defaultPageHeight, dynamicHeight) : defaultPageHeight;
    const pagePluginSrc = buildFacebookPluginUrl(parsed.postUrl, {
      width: pluginRequestWidth,
      height: pageFrameHeight,
      kind: 'page',
      hideCover: !showImage,
      hideTimeline: !showText,
    });

    return (
      <div
        ref={containerRef}
        className={`rounded-2xl border border-sky-200/90 dark:border-sky-900/60 bg-white dark:bg-slate-900 overflow-hidden shadow-xs ${
          compact ? 'h-full flex flex-col' : ''
        } ${className}`}
      >
        <div className="px-3.5 py-2.5 bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50/70 dark:from-sky-950/60 dark:via-blue-950/50 dark:to-slate-900 border-b border-sky-100 dark:border-sky-900/60 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  className="w-7 h-7 rounded-lg object-cover border border-sky-200 shrink-0"
                />
              ) : (
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-blue-600 text-white shrink-0">
                  <Flag className="w-3.5 h-3.5" />
                </span>
              )}
              <div className="min-w-0">
                <span className="font-bold text-slate-900 dark:text-white truncate block">
                  {displayName}
                </span>
                <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wide">
                  Fanpage Facebook
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!compact && showText && (
                <button
                  type="button"
                  onClick={() => setExpanded(prev => !prev)}
                  className="px-2 py-1 rounded-lg bg-white/90 dark:bg-slate-800 border border-sky-200 dark:border-sky-800 text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 inline-flex items-center gap-1 transition cursor-pointer"
                >
                  {expanded ? (
                    <>
                      <Minimize2 className="w-3 h-3" />
                      <span>Thu gọn</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3 h-3" />
                      <span>Mở rộng</span>
                    </>
                  )}
                </button>
              )}
              <a
                href={parsed.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-blue-600 dark:text-blue-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                <span>Mở Fanpage</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {(followersDisplay || likesDisplay) && (
            <div className="flex flex-wrap items-center gap-2">
              {followersDisplay && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-sky-200/80 dark:border-sky-800 text-[11px] font-bold text-sky-800 dark:text-sky-200 tabular-nums shadow-2xs">
                  <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>{followersDisplay}</span>
                </span>
              )}
              {likesDisplay && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-blue-200/80 dark:border-blue-800 text-[11px] font-semibold text-blue-700 dark:text-blue-300 tabular-nums shadow-2xs">
                  <ThumbsUp className="w-3.5 h-3.5 shrink-0" />
                  <span>{likesDisplay}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className={`relative w-full overflow-hidden flex justify-center ${compact ? 'flex-1 min-h-0' : ''}`}>
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50/90 dark:bg-slate-950/90 text-xs text-slate-400 pointer-events-none">
              <div className="w-6 h-6 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
              <span>Đang tải Fanpage &amp; số người theo dõi từ Facebook...</span>
            </div>
          )}
          <iframe
            src={pagePluginSrc}
            title={displayName}
            width={pluginRequestWidth}
            height={pageFrameHeight}
            scrolling={compact ? 'no' : 'yes'}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            onLoad={() => setLoaded(true)}
            className="block border-0 max-w-full transition-all duration-300"
          />
        </div>
      </div>
    );
  }

  // MODE C: Individual Facebook Post / Video
  // C1: Both hidden -> compact reference card
  if (!showImage && !showText) {
    return (
      <div
        ref={containerRef}
        className={`p-4 rounded-2xl bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs flex items-center justify-between gap-3 ${
          compact ? 'h-full' : ''
        } ${className}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs shrink-0">
            f
          </span>
          <div className="min-w-0">
            <span className="font-bold text-blue-950 dark:text-blue-200 block truncate">
              {title || 'Bài viết Facebook đính kèm'}
            </span>
            <span className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
              Liên kết bài viết gốc trên Facebook
            </span>
          </div>
        </div>
        <a
          href={parsed.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 transition"
        >
          <span>Xem bài gốc</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    );
  }

  // C2: Text only (showImage === false && showText === true) -> Clean text-only Facebook post card without images
  if (!showImage && showText) {
    return (
      <div
        ref={containerRef}
        className={`rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-white dark:bg-slate-900 overflow-hidden shadow-xs ${
          compact ? 'h-full flex flex-col' : ''
        } ${className}`}
      >
        <div className="px-3.5 py-2 bg-blue-50/90 dark:bg-blue-950/50 border-b border-blue-100 dark:border-blue-900/60 flex items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-600 text-white font-bold text-[11px] shrink-0">
              f
            </span>
            <span className="font-semibold text-blue-900 dark:text-blue-200 truncate">
              Nội dung bài viết Facebook (đã ẩn ảnh)
            </span>
          </div>
          <a
            href={parsed.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold text-blue-600 dark:text-blue-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <span>Xem bài gốc</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className={`p-4 space-y-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed ${compact ? 'flex-1 overflow-hidden' : ''}`}>
          {resolvedPostText ? (
            <p className={compact ? 'line-clamp-6 whitespace-pre-wrap' : 'whitespace-pre-wrap'}>
              {resolvedPostText}
            </p>
          ) : (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
              <FileText className="w-4 h-4 shrink-0 text-blue-500" />
              <span>
                Bài viết Facebook đang ở chế độ ẩn ảnh. Hãy mở bài gốc hoặc đồng bộ nội dung để xem văn bản chi tiết.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // C3: Standard embed with showImage === true (and showText either true or false)
  const postPluginSrc = buildFacebookPluginUrl(parsed.postUrl, {
    width: pluginRequestWidth,
    kind: effectiveKind,
    showText,
  });

  const needsScaleDown = effectiveKind !== 'video' && rawWidth > 0 && rawWidth < 350;
  const scaleRatio = needsScaleDown ? rawWidth / 350 : 1;

  const compactTargetVisualHeight = 204; // fills h-60 (240px) minus 36px header bar

  const baseHeight = compact
    ? needsScaleDown
      ? Math.round(compactTargetVisualHeight / scaleRatio)
      : compactTargetVisualHeight
    : parsed.iframeHeight
    ? Math.max(420, Math.min(820, parsed.iframeHeight))
    : effectiveKind === 'video'
    ? Math.round(pluginRequestWidth * 0.5625) + (showText ? 140 : 60)
    : showText
    ? 560
    : 420;

  const rawFrameHeight = compact
    ? baseHeight
    : dynamicHeight
    ? expanded
      ? Math.max(dynamicHeight, baseHeight + 240)
      : dynamicHeight
    : expanded
    ? Math.max(900, baseHeight + 280)
    : baseHeight;

  const scaledWrapperHeight = needsScaleDown ? Math.round(rawFrameHeight * scaleRatio) : rawFrameHeight;

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-white dark:bg-slate-900 overflow-hidden shadow-xs ${
        compact ? 'h-full flex flex-col' : ''
      } ${className}`}
    >
      <div className="px-3.5 py-2 bg-blue-50/90 dark:bg-blue-950/50 border-b border-blue-100 dark:border-blue-900/60 flex items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-600 text-white font-bold text-[11px] shrink-0">
            f
          </span>
          <span className="font-semibold text-blue-900 dark:text-blue-200 truncate">
            {effectiveKind === 'video'
              ? 'Video Facebook nhúng'
              : showText
              ? 'Bài viết Facebook'
              : 'Hình ảnh bài viết Facebook'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!compact && (
            <button
              type="button"
              onClick={() => setExpanded(prev => !prev)}
              className="px-2 py-1 rounded-lg bg-white/90 dark:bg-slate-800 border border-blue-200 dark:border-blue-800 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 inline-flex items-center gap-1 transition cursor-pointer"
              title={expanded ? 'Thu gọn khung hiển thị' : 'Mở rộng để xem toàn bộ'}
            >
              {expanded ? (
                <>
                  <Minimize2 className="w-3 h-3" />
                  <span>Thu gọn</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3 h-3" />
                  <span>Mở rộng</span>
                </>
              )}
            </button>
          )}
          <a
            href={parsed.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold text-blue-600 dark:text-blue-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
          >
            <span>Xem bài gốc</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <div
        className={`relative w-full overflow-hidden ${compact ? 'flex-1 min-h-0' : ''}`}
        style={!compact && needsScaleDown ? { height: `${scaledWrapperHeight}px` } : undefined}
      >
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50/90 dark:bg-slate-950/90 text-xs text-slate-400 pointer-events-none">
            <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <span>Đang tải nội dung từ Facebook...</span>
          </div>
        )}
        <iframe
          src={postPluginSrc}
          title={title || 'Bài viết Facebook'}
          width={pluginRequestWidth}
          height={rawFrameHeight}
          scrolling={compact ? 'no' : 'yes'}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          onLoad={() => setLoaded(true)}
          style={
            needsScaleDown
              ? {
                  width: `${pluginRequestWidth}px`,
                  height: `${rawFrameHeight}px`,
                  transform: `scale(${scaleRatio})`,
                  transformOrigin: 'top left',
                }
              : undefined
          }
          className={
            needsScaleDown
              ? 'block border-0 transition-all duration-300'
              : 'block w-full border-0 transition-all duration-300'
          }
        />
      </div>
    </div>
  );
};
