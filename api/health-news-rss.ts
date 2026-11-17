export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức GET' });
  }

  const RSS_URL = 'https://suckhoedoisong.vn/y-te.rss';
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(RSS_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; TramYTePortal/3.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
    }).finally(() => {
      clearTimeout(timeout);
    });

    const elapsedMs = Date.now() - startTime;

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        source: RSS_URL,
        statusCode: response.status,
        statusText: response.statusText,
        elapsedMs,
        error: `Nguồn RSS trả về mã HTTP ${response.status} (${response.statusText})`,
        items: [],
      });
    }

    const xmlText = await response.text();
    if (!xmlText || !xmlText.includes('<rss') && !xmlText.includes('<channel')) {
      return res.status(502).json({
        success: false,
        source: RSS_URL,
        statusCode: 502,
        elapsedMs,
        error: 'Dữ liệu nhận được từ máy chủ nguồn không phải XML RSS hợp lệ',
        items: [],
      });
    }

    const stripCdata = (raw: string) =>
      raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

    const decodeHtml = (raw: string) =>
      raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(dec));

    const lastBuildMatch = xmlText.match(/<lastBuildDate>([\s\S]*?)<\/lastBuildDate>/);
    const lastBuildDate = lastBuildMatch ? stripCdata(lastBuildMatch[1]) : '';

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items: Array<{
      id: string;
      title: string;
      summary: string;
      imageUrl: string;
      sourceName: string;
      sourceUrl: string;
      publishedAt: string;
      publishedDisplay: string;
      category: string;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xmlText)) !== null && items.length < 30) {
      const itemContent = match[1];
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
      const enclosureMatch = itemContent.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
      const mediaMatch = itemContent.match(/<media:content[^>]+url=["']([^"']+)["']/i);

      const rawDesc = descMatch ? stripCdata(descMatch[1]) : '';
      const imgInDescMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
      const imageUrl =
        (enclosureMatch && enclosureMatch[1]) ||
        (mediaMatch && mediaMatch[1]) ||
        (imgInDescMatch && imgInDescMatch[1]) ||
        '';

      const cleanDesc = decodeHtml(rawDesc.replace(/<[^>]*>?/gm, ' '))
        .replace(/\s+/g, ' ')
        .trim();

      const title = titleMatch
        ? decodeHtml(stripCdata(titleMatch[1])).replace(/\s+/g, ' ').trim()
        : 'Tin y tế';

      const sourceUrl = linkMatch
        ? stripCdata(linkMatch[1])
        : 'https://suckhoedoisong.vn/y-te.htm';

      const parsedDate = pubDateMatch ? new Date(pubDateMatch[1].trim()) : new Date();
      const isValidDate = !Number.isNaN(parsedDate.getTime());
      const publishedAt = isValidDate
        ? parsedDate.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const publishedDisplay = isValidDate
        ? parsedDate.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : publishedAt;

      const summary =
        cleanDesc.length > 220 ? `${cleanDesc.slice(0, 217).trim()}...` : cleanDesc;

      items.push({
        id: `rss_${items.length + 1}`,
        title,
        summary,
        imageUrl: imageUrl.trim(),
        sourceName: 'Báo Sức Khỏe & Đời Sống',
        sourceUrl,
        publishedAt,
        publishedDisplay,
        category: 'Y Tế',
      });
    }

    // Cache on Vercel CDN for 10 minutes, serve stale while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');

    return res.status(200).json({
      success: true,
      source: RSS_URL,
      statusCode: 200,
      elapsedMs,
      itemCount: items.length,
      lastBuildDate,
      fetchedAt: new Date().toISOString(),
      items,
    });
  } catch (error: any) {
    const elapsedMs = Date.now() - startTime;
    const isTimeout = error?.name === 'AbortError';

    return res.status(504).json({
      success: false,
      source: RSS_URL,
      statusCode: isTimeout ? 504 : 500,
      elapsedMs,
      error: isTimeout
        ? 'Quá thời gian kết nối (Timeout 9s) tới nguồn RSS Báo Sức Khỏe & Đời Sống'
        : error?.message || 'Lỗi kết nối máy chủ RSS',
      items: [],
    });
  }
}
