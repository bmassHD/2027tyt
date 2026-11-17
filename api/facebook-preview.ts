function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractMetaContent(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    'i'
  );
  const pattern2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i'
  );
  const m = html.match(pattern1) || html.match(pattern2);
  return m?.[1] ? decodeHtmlEntities(m[1].trim()) : '';
}

function extractAllMetaImages(html: string): string[] {
  const results: string[] = [];
  const regex =
    /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url|twitter:image)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtmlEntities((match[1] || match[2] || '').trim());
    if (
      raw &&
      /^https?:\/\//i.test(raw) &&
      !raw.includes('static.xx.fbcdn.net/rsrc.php') &&
      !raw.includes('/images/fb_icon') &&
      !results.includes(raw)
    ) {
      results.push(raw);
    }
  }

  // Fallback: look for full-size scontent image URLs embedded in Facebook JSON if meta tags yielded none
  if (results.length === 0 && html) {
    const jsonImgRegex = /"(?:full_picture|image|uri)"\s*:\s*"((?:https?:\\\/\\\/|https?:\/\/)scontent[^"]+)"/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = jsonImgRegex.exec(html)) !== null && results.length < 4) {
      const unescaped = imgMatch[1]
        .replace(/\\\//g, '/')
        .replace(/\\u0025/gi, '%')
        .replace(/\\u0026/gi, '&')
        .replace(/&amp;/g, '&');
      if (
        /^https?:\/\//i.test(unescaped) &&
        !/[/_](?:s|p)(?:24|32|40|48|50|60|64|75|80)x(?:24|32|40|48|50|60|64|75|80)/i.test(unescaped) &&
        !results.includes(unescaped)
      ) {
        results.push(unescaped);
      }
    }
  }

  return results;
}

function extractJsonPostText(html: string): string {
  if (!html) return '';
  const patterns = [
    /"message"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\]){15,4000})"/,
    /"comet_sections"[\s\S]{0,600}?"text"\s*:\s*"((?:\\.|[^"\\]){20,4000})"/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) {
      try {
        const decoded = JSON.parse(`"${m[1]}"`);
        if (typeof decoded === 'string' && decoded.trim().length >= 15) {
          return decoded.trim();
        }
      } catch {
        // ignore JSON decode error
      }
    }
  }
  return '';
}

function deriveSuggestedPostTitle(content: string, authorOrPageName: string): string {
  let text = (content || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  text = text
    .replace(
      /^\s*(?:[\d.,]+\s*[KkMmBb]?\s*(?:views?|lượt xem|reactions?|cảm xúc|likes?|lượt thích|comments?|bình luận|shares?|lượt chia sẻ)\s*[·|•,-]*\s*){1,4}/i,
      ''
    )
    .trim();

  const cleanAuthor = (authorOrPageName || '').replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  if (cleanAuthor && cleanAuthor.length >= 2) {
    const escaped = cleanAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text
      .replace(new RegExp(`^${escaped}\\s*(?:[:\\-–—·|•]|đã đăng|shared|posted)?\\s*`, 'i'), '')
      .trim();
  }

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s\-–—:|.,!?·•"'“”‘’()[\]]+/g, ' ')
      .trim();

  const normAuthor = normalize(cleanAuthor);
  if (!normalize(text) || (normAuthor && normalize(text) === normAuthor)) {
    return '';
  }

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      if (normAuthor && normalize(l) === normAuthor) return false;
      const withoutTags = l
        .replace(/#[\p{L}\p{N}_-]+/gu, '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[\s\-–—·•.,!?:;|/\\]+/g, '')
        .trim();
      return /[\p{L}\p{N}]{2}/u.test(withoutTags);
    });

  if (lines.length === 0) return '';

  let candidate = lines[0]
    .replace(/^[•\-–—*▶►✓✔👉🔥📢📣🚨⚠️✅📌⭐🩺💊🏥❤️💙💚💛💜🤍🖤✨🎉🎊]+\s*/u, '')
    .trim();

  if (candidate.length < 22 && lines.length > 1) {
    const second = lines[1]
      .replace(/^[•\-–—*▶►✓✔👉🔥📢📣🚨⚠️✅📌⭐🩺💊🏥❤️💙💚💛💜🤍🖤✨🎉🎊]+\s*/u, '')
      .trim();
    if (second) {
      candidate = /[:\-–—.!?]$/.test(candidate)
        ? `${candidate} ${second}`
        : `${candidate}: ${second}`;
    }
  }

  candidate = candidate.replace(/(?:\s+#[\p{L}\p{N}_-]+)+$/gu, '').replace(/\s+/g, ' ').trim();
  if (!candidate) return '';

  const maxLength = 95;
  if (candidate.length > maxLength) {
    const sentenceMatch = candidate.match(/^(.{20,105}?)[.!?…](?:\s|$)/);
    if (sentenceMatch?.[1] && sentenceMatch[1].trim().length <= maxLength) {
      return sentenceMatch[1].trim();
    }
    const sliced = candidate.slice(0, maxLength - 3);
    const lastSpace = sliced.lastIndexOf(' ');
    return `${(lastSpace >= 25 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
  }

  return candidate;
}

function extractFollowersAndLikes(html: string, desc: string): {
  followersText: string;
  likesText: string;
} {
  const combined = `${desc}\n${html.slice(0, 120000)}`;

  // 1. Check textual patterns in Vietnamese & English (e.g., "12,5K người theo dõi", "1.234 followers")
  const textPatterns = [
    /(\d[\d.,]*\s*(?:[KkMmBb]|nghìn|ngàn|triệu)?)\s+(?:người đang theo dõi|người theo dõi)/i,
    /(\d[\d.,]*\s*[KkMmBb]?)\s+followers?/i,
  ];

  let followersText = '';
  for (const pat of textPatterns) {
    const m = combined.match(pat);
    if (m?.[1]) {
      const count = m[1].replace(/\s+/g, ' ').trim();
      followersText = `${count} người theo dõi`;
      break;
    }
  }

  // 2. Fallback to embedded JSON numeric counts in Facebook HTML
  if (!followersText) {
    const jsonCountMatch = html.match(
      /"(?:follower_count|followers_count|profile_followers_count)"\s*:\s*(\d+)/i
    );
    if (jsonCountMatch?.[1]) {
      const n = parseInt(jsonCountMatch[1], 10);
      if (!Number.isNaN(n) && n >= 0) {
        followersText = `${n.toLocaleString('vi-VN')} người theo dõi`;
      }
    }
  }

  // 3. Extract likes count if present on a Fanpage
  let likesText = '';
  const likePatterns = [
    /(\d[\d.,]*\s*(?:[KkMmBb]|nghìn|ngàn|triệu)?)\s+(?:lượt thích)/i,
    /(\d[\d.,]*\s*[KkMmBb]?)\s+likes?/i,
  ];
  for (const pat of likePatterns) {
    const m = combined.match(pat);
    if (m?.[1]) {
      likesText = `${m[1].replace(/\s+/g, ' ').trim()} lượt thích`;
      break;
    }
  }

  return { followersText, likesText };
}

function detectKind(canonicalUrl: string, html: string, desc: string): 'post' | 'video' | 'page' | 'profile' {
  const lower = canonicalUrl.toLowerCase();
  if (
    lower.includes('/videos/') ||
    lower.includes('/watch') ||
    lower.includes('/reel/') ||
    lower.includes('/reels/') ||
    lower.includes('/share/v/') ||
    lower.includes('/share/r/') ||
    lower.includes('fb.watch')
  ) {
    return 'video';
  }
  if (
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

  // Inspect HTML signals for Page vs Profile
  const iosUrl = extractMetaContent(html, 'al:ios:url').toLowerCase();
  const androidUrl = extractMetaContent(html, 'al:android:url').toLowerCase();
  if (iosUrl.includes('fb://page/') || androidUrl.includes('fb://page/')) {
    return 'page';
  }
  if (iosUrl.includes('fb://profile/') && !html.includes('"pageID"') && !/lượt thích|\blikes\b/i.test(desc)) {
    return 'profile';
  }
  if (lower.includes('/profile.php') || lower.includes('/people/')) {
    // Some New Page Experience pages also use profile.php, check page markers
    if (/lượt thích|talking about|người đang nói về điều này|"pageID"/i.test(html + ' ' + desc)) {
      return 'page';
    }
    return 'profile';
  }
  if (/lượt thích|talking about|người đang nói về điều này|"pageID"|"category_name"/i.test(html + ' ' + desc)) {
    return 'page';
  }

  try {
    const parsed = new URL(canonicalUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 1) {
      return 'page';
    }
  } catch {
    // ignore
  }

  return 'post';
}

async function fetchFacebookHtml(targetUrl: string, userAgent: string): Promise<{
  finalUrl: string;
  html: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7500);
  try {
    const response = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    const finalUrl = response.url && /^https?:\/\//i.test(response.url) ? response.url : targetUrl;
    const html = response.ok ? await response.text() : '';
    return { finalUrl, html };
  } catch {
    return { finalUrl: targetUrl, html: '' };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
  }

  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Vui lòng cung cấp đường dẫn Facebook' });
    }

    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(withProtocol);
    } catch {
      return res.status(400).json({ error: 'Đường dẫn không hợp lệ' });
    }

    const host = parsedUrl.hostname.toLowerCase();
    const isFbHost =
      host === 'facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'fb.watch' ||
      host === 'fb.com' ||
      host.endsWith('.fb.com');

    if (!isFbHost) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ đường dẫn từ Facebook' });
    }

    // Try facebookexternalhit first (often receives complete OG tags for public posts), then fallback to Googlebot
    let { finalUrl, html } = await fetchFacebookHtml(
      parsedUrl.toString(),
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
    );

    const firstDesc =
      extractMetaContent(html, 'og:description') ||
      extractMetaContent(html, 'description') ||
      extractMetaContent(html, 'twitter:description');
    const firstImages = extractAllMetaImages(html);

    if (!html || (!firstDesc && firstImages.length === 0)) {
      const retry = await fetchFacebookHtml(
        parsedUrl.toString(),
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      );
      if (retry.html) {
        html = retry.html;
        if (retry.finalUrl) {
          finalUrl = retry.finalUrl;
        }
      }
    }

    const ogUrl = extractMetaContent(html, 'og:url');
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const canonicalRaw = ogUrl || (canonicalMatch?.[1] ? decodeHtmlEntities(canonicalMatch[1]) : '') || finalUrl;

    let canonicalUrl = parsedUrl.toString();
    try {
      const u = new URL(canonicalRaw);
      if (
        u.hostname === 'm.facebook.com' ||
        u.hostname === 'mbasic.facebook.com' ||
        u.hostname === 'web.facebook.com' ||
        u.hostname === 'facebook.com'
      ) {
        u.hostname = 'www.facebook.com';
      }
      const badPaths = ['/login', '/checkpoint', '/unsupportedbrowser', '/sorry', '/home.php'];
      const isBadPath = u.pathname === '/' || badPaths.some(p => u.pathname.toLowerCase().startsWith(p));
      const inputHasStoryOrFbid =
        parsedUrl.searchParams.has('story_fbid') ||
        parsedUrl.searchParams.has('fbid') ||
        parsedUrl.searchParams.has('set');
      const resolvedLostQuery =
        inputHasStoryOrFbid &&
        !u.searchParams.has('story_fbid') &&
        !u.searchParams.has('fbid') &&
        !u.pathname.includes('/posts/') &&
        !u.pathname.includes('pfbid');

      if (u.pathname.startsWith('/login')) {
        const nextUrl = u.searchParams.get('next');
        if (nextUrl && /^https?:\/\//i.test(nextUrl)) {
          canonicalUrl = nextUrl;
        }
      } else if (!isBadPath && !resolvedLostQuery) {
        canonicalUrl = u.toString();
      }
    } catch {
      canonicalUrl = parsedUrl.toString();
    }

    const ogTitle = extractMetaContent(html, 'og:title');
    const titleTagMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const rawTitle = ogTitle || (titleTagMatch?.[1] ? decodeHtmlEntities(titleTagMatch[1].trim()) : '');
    const cleanTitle =
      rawTitle &&
      !/^(log in|đăng nhập|facebook|error|content not found)/i.test(rawTitle.trim())
        ? rawTitle.replace(/\s*\|\s*Facebook\s*$/i, '').trim()
        : '';

    const ogDesc =
      extractMetaContent(html, 'og:description') ||
      extractMetaContent(html, 'description') ||
      extractMetaContent(html, 'twitter:description') ||
      extractJsonPostText(html);
    const cleanDesc =
      ogDesc && !/^(log into facebook|đăng nhập facebook)/i.test(ogDesc.trim())
        ? ogDesc.trim()
        : '';

    const images = extractAllMetaImages(html);
    const { followersText, likesText } = extractFollowersAndLikes(html, cleanDesc);
    const detectedKind = detectKind(canonicalUrl, html, cleanDesc);
    const suggestedTitle = deriveSuggestedPostTitle(cleanDesc, cleanTitle);

    return res.status(200).json({
      success: true,
      inputUrl: parsedUrl.toString(),
      canonicalUrl,
      detectedKind,
      title: cleanTitle,
      displayName: cleanTitle,
      suggestedTitle,
      description: cleanDesc,
      followersText,
      likesText,
      images,
      isVideo: detectedKind === 'video',
      metadataAvailable: Boolean(cleanTitle || cleanDesc || images.length > 0 || followersText),
    });
  } catch (error: any) {
    return res.status(200).json({
      success: true,
      inputUrl: String(req.body?.url || ''),
      canonicalUrl: String(req.body?.url || ''),
      detectedKind: 'post',
      title: '',
      displayName: '',
      suggestedTitle: '',
      description: '',
      followersText: '',
      likesText: '',
      images: [],
      isVideo: false,
      metadataAvailable: false,
      error: error?.message || '',
    });
  }
}
