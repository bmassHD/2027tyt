import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();
  const RSS_URL = 'https://suckhoedoisong.vn/y-te.rss';

  // Test RSS upstream connection
  const rssStatus: {
    status: 'connected' | 'error';
    statusCode: number;
    responseTimeMs: number;
    error: string | null;
    itemsFound: number;
    source: string;
  } = {
    status: 'error',
    statusCode: 0,
    responseTimeMs: 0,
    error: null,
    itemsFound: 0,
    source: RSS_URL,
  };

  const rssStart = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const rssRes = await fetch(RSS_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; TramYTePortal/3.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    }).finally(() => {
      clearTimeout(timeout);
    });

    const elapsed = Date.now() - rssStart;
    rssStatus.statusCode = rssRes.status;
    rssStatus.responseTimeMs = elapsed;

    if (rssRes.ok) {
      const text = await rssRes.text();
      const count = (text.match(/<item>/g) || []).length;
      rssStatus.status = 'connected';
      rssStatus.itemsFound = count;
    } else {
      rssStatus.status = 'error';
      rssStatus.error = `HTTP ${rssRes.status}: ${rssRes.statusText}`;
    }
  } catch (err: any) {
    rssStatus.responseTimeMs = Date.now() - rssStart;
    rssStatus.status = 'error';
    rssStatus.error = err?.name === 'AbortError' ? 'Timeout sau 9 giây' : err?.message || 'Lỗi mạng';
  }

  // Check Environment
  const isVercel = Boolean(process.env.VERCEL);
  const vercelEnv = process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const vercelRegion = process.env.VERCEL_REGION || 'local';
  const rawGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const hasGeminiKey = Boolean(rawGeminiKey && rawGeminiKey !== 'MY_GEMINI_API_KEY');

  let firebaseDiag = {
    projectId: '',
    databaseId: '',
    authDomain: '',
  };
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      path.resolve(process.cwd(), 'firebase-applet-config.json'),
      path.resolve(moduleDir, '..', 'firebase-applet-config.json'),
    ];
    const cfgPath = candidatePaths.find((p) => fs.existsSync(p));
    if (cfgPath) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      firebaseDiag = {
        projectId: cfg.projectId || '',
        databaseId: cfg.firestoreDatabaseId || '',
        authDomain: cfg.authDomain || '',
      };
    }
  } catch {
    // ignore config read error
  }

  const totalResponseTimeMs = Date.now() - startTime;

  return res.status(200).json({
    status: rssStatus.status === 'connected' ? 'healthy' : 'warning',
    timestamp: new Date().toISOString(),
    totalResponseTimeMs,
    appVersion: 'v3.0.0 (Bản Chính Thức)',
    platform: isVercel ? 'Vercel Serverless' : 'Node.js Express / AI Studio Dev',
    environment: vercelEnv,
    region: vercelRegion,
    nodeVersion: process.version,
    apiEndpoints: {
      healthNewsRss: '/api/health-news-rss',
      diagnostics: '/api/diagnostics',
      aiStatus: '/api/ai/status',
      aiSuggestNeeds: '/api/ai/suggest-needs',
      aiScanDocument: '/api/ai/scan-document',
      mapsResolve: '/api/maps/resolve-urls',
      facebookPreview: '/api/facebook-preview',
      pushSubscribe: '/api/push/subscribe',
    },
    services: {
      rssUpstream: rssStatus,
      geminiAi: {
        configured: hasGeminiKey,
        model: 'gemini-4-hydrogen',
      },
      firebase: {
        ...firebaseDiag,
        authAuthorizedDomainsNotice:
          'Để đăng nhập Google thành công trên Vercel / Tenten, tên miền tyt.slhd.id.vn và domain.vercel.app phải được thêm vào Firebase Console > Authentication > Settings > Authorized domains.',
      },
      tentenDomain: {
        productionHost: 'tyt.slhd.id.vn',
        cnameTarget: 'cname.vercel-dns.com.',
        rootDomainIp: '76.76.21.21',
      },
    },
  });
}
