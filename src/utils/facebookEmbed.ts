export type ResolvedFacebookKind = 'post' | 'video' | 'page' | 'profile';

export interface ParsedFacebookEmbed {
  isValid: boolean;
  postUrl: string;
  pluginUrl: string;
  isVideo: boolean;
  detectedKind: ResolvedFacebookKind;
  iframeHeight?: number;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isFacebookHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'facebook.com' ||
    host.endsWith('.facebook.com') ||
    host === 'fb.watch' ||
    host === 'fb.com' ||
    host.endsWith('.fb.com')
  );
}

export function normalizeFacebookUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!isFacebookHostname(url.hostname)) return '';
    if (
      url.hostname === 'm.facebook.com' ||
      url.hostname === 'mbasic.facebook.com' ||
      url.hostname === 'web.facebook.com' ||
      url.hostname === 'facebook.com'
    ) {
      url.hostname = 'www.facebook.com';
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function isFacebookVideoUrl(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  return (
    lower.includes('plugins/video.php') ||
    lower.includes('/videos/') ||
    lower.includes('/watch') ||
    lower.includes('/reel/') ||
    lower.includes('/reels/') ||
    lower.includes('/share/v/') ||
    lower.includes('/share/r/') ||
    lower.includes('fb.watch')
  );
}

export function detectFacebookKindFromUrl(urlStr: string): ResolvedFacebookKind {
  const lower = (urlStr || '').toLowerCase();
  if (!lower) return 'post';

  if (lower.includes('plugins/page.php') || lower.includes('/pages/') || lower.includes('/pg/')) {
    return 'page';
  }
  if (isFacebookVideoUrl(lower)) {
    return 'video';
  }
  if (
    lower.includes('plugins/post.php') ||
    lower.includes('/posts/') ||
    lower.includes('/permalink.php') ||
    lower.includes('/photo') ||
    lower.includes('/story.php') ||
    lower.includes('/share/') ||
    lower.includes('story_fbid=') ||
    lower.includes('fbid=') ||
    lower.includes('pfbid') ||
    lower.includes('/events/')
  ) {
    return 'post';
  }
  if (lower.includes('/profile.php') || lower.includes('/people/')) {
    return 'profile';
  }

  try {
    const parsed = new URL(normalizeFacebookUrl(urlStr) || urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    // e.g. https://www.facebook.com/TramYTePhuongHiepThanh -> single slug = Fanpage or Personal Profile
    if (
      segments.length === 1 &&
      !['share', 'sharer.php', 'watch', 'reel', 'reels', 'events', 'groups'].includes(
        segments[0].toLowerCase()
      )
    ) {
      return 'page';
    }
  } catch {
    // ignore URL parse failure
  }

  return 'post';
}

export function buildFacebookPluginUrl(
  targetUrl: string,
  options?: {
    width?: number;
    height?: number;
    kind?: ResolvedFacebookKind;
    isVideo?: boolean;
    showText?: boolean;
    hideCover?: boolean;
    hideTimeline?: boolean;
  }
): string {
  const width = Math.max(320, Math.min(750, Math.round(options?.width ?? 500)));
  const resolvedKind: ResolvedFacebookKind =
    options?.kind ||
    (options?.isVideo ? 'video' : detectFacebookKindFromUrl(targetUrl));

  if (resolvedKind === 'page') {
    const height = Math.max(
      options?.hideTimeline ? 130 : 280,
      Math.min(900, Math.round(options?.height ?? (options?.hideTimeline ? 130 : 540)))
    );
    const params = new URLSearchParams({
      href: targetUrl,
      tabs: options?.hideTimeline ? '' : 'timeline',
      width: String(width),
      height: String(height),
      small_header: 'false',
      adapt_container_width: 'true',
      hide_cover: options?.hideCover ? 'true' : 'false',
      show_facepile: 'true',
    });
    return `https://www.facebook.com/plugins/page.php?${params.toString()}`;
  }

  const isVideo = resolvedKind === 'video' || Boolean(options?.isVideo);
  const showText = options?.showText !== false;
  const endpoint = isVideo
    ? 'https://www.facebook.com/plugins/video.php'
    : 'https://www.facebook.com/plugins/post.php';

  const params = new URLSearchParams({
    href: targetUrl,
    show_text: showText ? 'true' : 'false',
    width: String(width),
  });

  return `${endpoint}?${params.toString()}`;
}

export function parseFacebookEmbedInput(
  rawInput: string,
  width = 500
): ParsedFacebookEmbed {
  const input = (rawInput || '').trim();
  if (!input) {
    return {
      isValid: false,
      postUrl: '',
      pluginUrl: '',
      isVideo: false,
      detectedKind: 'post',
    };
  }

  let candidateUrl = input;
  let iframeHeight: number | undefined;

  if (/<iframe/i.test(input)) {
    const srcMatch = input.match(/src=["']([^"']+)["']/i);
    const heightMatch = input.match(/height=["']?(\d+)["']?/i);
    if (heightMatch) {
      const h = parseInt(heightMatch[1], 10);
      if (!Number.isNaN(h) && h > 100 && h < 3000) {
        iframeHeight = h;
      }
    }
    if (!srcMatch?.[1]) {
      return {
        isValid: false,
        postUrl: '',
        pluginUrl: '',
        isVideo: false,
        detectedKind: 'post',
      };
    }
    candidateUrl = decodeHtmlEntities(srcMatch[1].trim());
  }

  const normalized = normalizeFacebookUrl(candidateUrl);
  if (!normalized) {
    return {
      isValid: false,
      postUrl: '',
      pluginUrl: '',
      isVideo: false,
      detectedKind: 'post',
    };
  }

  try {
    const parsed = new URL(normalized);
    if (
      parsed.pathname.includes('/plugins/post.php') ||
      parsed.pathname.includes('/plugins/video.php') ||
      parsed.pathname.includes('/plugins/page.php')
    ) {
      const innerHref = parsed.searchParams.get('href');
      const detectedKind: ResolvedFacebookKind = parsed.pathname.includes('/plugins/page.php')
        ? 'page'
        : parsed.pathname.includes('/plugins/video.php')
        ? 'video'
        : 'post';
      if (innerHref) {
        const cleanPostUrl = normalizeFacebookUrl(innerHref) || innerHref;
        return {
          isValid: true,
          postUrl: cleanPostUrl,
          pluginUrl: buildFacebookPluginUrl(cleanPostUrl, {
            width,
            kind: detectedKind,
            showText: true,
          }),
          isVideo: detectedKind === 'video',
          detectedKind,
          iframeHeight,
        };
      }
    }

    const detectedKind = detectFacebookKindFromUrl(normalized);
    return {
      isValid: true,
      postUrl: normalized,
      pluginUrl: buildFacebookPluginUrl(normalized, {
        width,
        kind: detectedKind,
        showText: true,
      }),
      isVideo: detectedKind === 'video',
      detectedKind,
      iframeHeight,
    };
  } catch {
    return {
      isValid: false,
      postUrl: '',
      pluginUrl: '',
      isVideo: false,
      detectedKind: 'post',
    };
  }
}

export function formatFollowersLabel(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) {
    const formatted = Number(trimmed).toLocaleString('vi-VN');
    return `${formatted} người theo dõi`;
  }
  if (/người theo dõi|follower/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} người theo dõi`;
}

export function getYouTubeEmbedId(rawInput: string): string | null {
  const input = (rawInput || '').trim();
  if (!input) return null;
  let target = input;
  if (/<iframe/i.test(input)) {
    const srcMatch = input.match(/src=["']([^"']+)["']/i);
    if (srcMatch?.[1]) target = decodeHtmlEntities(srcMatch[1]);
  }
  const shortsMatch = target.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch?.[1]) return shortsMatch[1];

  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = target.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export function detectEmbedTypeFromInput(rawInput: string): 'facebook' | 'youtube' | null {
  const input = (rawInput || '').toLowerCase();
  if (!input.trim()) return null;
  if (
    input.includes('facebook.com') ||
    input.includes('fb.watch') ||
    input.includes('fb.com')
  ) {
    return 'facebook';
  }
  if (input.includes('youtube.com') || input.includes('youtu.be')) {
    return 'youtube';
  }
  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeComparableText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s\-–—:|.,!?·•"'“”‘’()[\]]+/g, ' ')
    .trim();
}

function isHashtagOrNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // Line consisting only of #hashtags or URLs
  const withoutTags = trimmed
    .replace(/#[\p{L}\p{N}_-]+/gu, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\s\-–—·•.,!?:;|/\\]+/g, '')
    .trim();
  // Require at least 2 letters or digits
  return !/[\p{L}\p{N}]{2}/u.test(withoutTags);
}

export function cleanFacebookPostContent(
  rawContent: string,
  pageOrAuthorName?: string
): string {
  let text = (rawContent || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  // Strip Facebook video/reel leading engagement counters like "12K views · 340 reactions | ..."
  text = text.replace(
    /^\s*(?:[\d.,]+\s*[KkMmBb]?\s*(?:views?|lượt xem|reactions?|cảm xúc|likes?|lượt thích|comments?|bình luận|shares?|lượt chia sẻ)\s*[·|•,-]*\s*){1,4}/i,
    ''
  ).trim();

  // Strip leading author/page name prefix if Facebook prepended "Page Name: ..." or "Page Name - ..."
  const cleanAuthor = (pageOrAuthorName || '').replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  if (cleanAuthor && cleanAuthor.length >= 2) {
    const authorRegex = new RegExp(
      `^${escapeRegExp(cleanAuthor)}\\s*(?:[:\\-–—·|•]|đã đăng|shared|posted)?\\s*`,
      'i'
    );
    text = text.replace(authorRegex, '').trim();
  }

  // If what remains is literally the page/profile name itself or Facebook boilerplate, discard
  const normText = normalizeComparableText(text);
  const normAuthor = normalizeComparableText(cleanAuthor);
  if (!normText || (normAuthor && normText === normAuthor)) {
    return '';
  }
  if (/^(log in|đăng nhập|log into facebook|xem trên facebook|see more on facebook)$/i.test(text.trim())) {
    return '';
  }

  return text;
}

/**
 * Extracts a concise, readable post title strictly from a portion of the Facebook post content.
 * Never returns the Fanpage name or personal profile name.
 */
export function deriveFacebookPostTitle(
  rawContent: string,
  pageOrAuthorName?: string,
  maxLength = 95
): string {
  const cleaned = cleanFacebookPostContent(rawContent, pageOrAuthorName);
  if (!cleaned) return '';

  const normAuthor = normalizeComparableText(
    (pageOrAuthorName || '').replace(/\s*\|\s*Facebook\s*$/i, '').trim()
  );

  const rawLines = cleaned
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l || isHashtagOrNoiseLine(l)) return false;
      if (normAuthor && normalizeComparableText(l) === normAuthor) return false;
      return true;
    });

  if (rawLines.length === 0) return '';

  let candidate = rawLines[0]
    .replace(/^[•\-–—*▶►✓✔👉🔥📢📣🚨⚠️✅📌⭐🩺💊🏥❤️💙💚💛💜🤍🖤✨🎉🎊]+\s*/u, '')
    .trim();

  // If the first line is just a short label (e.g. "THÔNG BÁO"), append the start of the second line
  if (candidate.length < 22 && rawLines.length > 1) {
    const second = rawLines[1]
      .replace(/^[•\-–—*▶►✓✔👉🔥📢📣🚨⚠️✅📌⭐🩺💊🏥❤️💙💚💛💜🤍🖤✨🎉🎊]+\s*/u, '')
      .trim();
    if (second) {
      candidate = /[:\-–—.!?]$/.test(candidate)
        ? `${candidate} ${second}`
        : `${candidate}: ${second}`;
    }
  }

  // Strip trailing inline hashtags at the end of the selected line
  candidate = candidate.replace(/(?:\s+#[\p{L}\p{N}_-]+)+$/gu, '').replace(/\s+/g, ' ').trim();
  if (!candidate) return '';

  // Prefer ending at the first natural sentence boundary if reasonably sized
  if (candidate.length > maxLength) {
    const sentenceMatch = candidate.match(/^(.{20,105}?)[.!?…](?:\s|$)/);
    if (sentenceMatch?.[1] && sentenceMatch[1].trim().length <= maxLength) {
      return sentenceMatch[1].trim();
    }
    const sliced = candidate.slice(0, maxLength - 3);
    const lastSpace = sliced.lastIndexOf(' ');
    const finalSlice = lastSpace >= 25 ? sliced.slice(0, lastSpace) : sliced;
    return `${finalSlice.trim()}...`;
  }

  return candidate;
}

export function deriveFacebookPostSummary(
  rawContent: string,
  title: string,
  pageOrAuthorName?: string,
  maxLength = 240
): string {
  const cleaned = cleanFacebookPostContent(rawContent, pageOrAuthorName)
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return title;
  if (cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength - 3);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
}

