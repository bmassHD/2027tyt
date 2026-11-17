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
    const rawUrls: unknown = req.body?.urls;
    if (!Array.isArray(rawUrls)) {
      return res.status(400).json({ error: 'Mảng urls là bắt buộc' });
    }

    const urls = rawUrls
      .slice(0, 100)
      .map(u => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean);

    const parseCoordsFromUrl = (urlStr: string): { lat: number; lng: number } | null => {
      let m = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (!m) m = urlStr.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (!m) m = urlStr.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (!m) return null;
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
      return { lat, lng };
    };

    const resolveSingle = async (inputUrl: string) => {
      const direct = parseCoordsFromUrl(inputUrl);
      if (direct) {
        return { inputUrl, resolvedUrl: inputUrl, lat: direct.lat, lng: direct.lng };
      }
      try {
        const parsed = new URL(inputUrl);
        const allowedHost =
          parsed.hostname === 'maps.app.goo.gl' ||
          parsed.hostname === 'goo.gl' ||
          parsed.hostname.endsWith('.google.com') ||
          parsed.hostname === 'google.com';
        if (!allowedHost) {
          return { inputUrl, resolvedUrl: inputUrl, lat: null, lng: null };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
          const resp = await fetch(inputUrl, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; TramYTePortal/3.0)',
            },
          });
          const finalUrl = resp.url || inputUrl;
          const coords = parseCoordsFromUrl(finalUrl);
          return {
            inputUrl,
            resolvedUrl: finalUrl,
            lat: coords?.lat ?? null,
            lng: coords?.lng ?? null,
          };
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return { inputUrl, resolvedUrl: inputUrl, lat: null, lng: null };
      }
    };

    const results: Array<{
      inputUrl: string;
      resolvedUrl: string;
      lat: number | null;
      lng: number | null;
    }> = [];
    const BATCH_SIZE = 8;
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const chunk = urls.slice(i, i + BATCH_SIZE);
      const settled = await Promise.all(chunk.map(resolveSingle));
      results.push(...settled);
    }

    return res.status(200).json({ results });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Lỗi xử lý đường dẫn bản đồ' });
  }
}
