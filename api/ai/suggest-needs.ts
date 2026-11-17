import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

function safeParseJsonObject(rawText?: string): Record<string, any> | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const stripped = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!stripped) return null;
  try {
    const parsed = JSON.parse(stripped);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Yêu cầu Gemini AI vượt quá thời gian chờ (timeout).')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTransientError(err: any): boolean {
  const status = Number(err?.status || err?.statusCode || err?.code);
  if (status === 429 || status === 500 || status === 503 || status === 504) return true;
  return /UNAVAILABLE|503|high demand|overloaded|ETIMEDOUT|ECONNRESET|fetch failed/i.test(
    String(err?.message || err || '')
  );
}

function formatGeminiError(err: any): { status: number; message: string } {
  let rawMsg = String(err?.message || err || 'Lỗi kết nối Gemini AI.');
  let parsedCode = Number(err?.status || err?.statusCode || err?.code);
  try {
    const parsed = JSON.parse(rawMsg);
    if (parsed?.error?.message) rawMsg = String(parsed.error.message);
    if (!parsedCode && parsed?.error?.code) parsedCode = Number(parsed.error.code);
  } catch {
    // keep rawMsg
  }
  if (/timeout|vượt quá thời gian/i.test(rawMsg)) {
    return { status: 504, message: 'Yêu cầu Gemini AI vượt quá thời gian chờ. Vui lòng thử lại.' };
  }
  if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(rawMsg) || parsedCode === 403) {
    return { status: 403, message: 'GEMINI_API_KEY không hợp lệ hoặc chưa đủ quyền (kiểm tra Settings > Secrets).' };
  }
  if (/RESOURCE_EXHAUSTED/i.test(rawMsg) || parsedCode === 429) {
    return { status: 429, message: 'Đã vượt giới hạn lưu lượng Gemini API (429). Vui lòng thử lại sau.' };
  }
  if (/UNAVAILABLE|high demand/i.test(rawMsg) || parsedCode === 503) {
    return { status: 503, message: 'Máy chủ Gemini AI đang cao tải tạm thời (503). Vui lòng thử lại sau ít giây.' };
  }
  return { status: parsedCode >= 400 && parsedCode < 600 ? parsedCode : 502, message: rawMsg };
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
    const { userQuery, role } = req.body || {};
    if (!userQuery || typeof userQuery !== 'string') {
      return res.status(400).json({ error: 'Nhu cầu không được để trống' });
    }

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ (Settings > Secrets).',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const prompt = `Bạn là Trợ lý AI Thông minh của Cổng Thông Tin Điện Tử Trạm Y Tế Xã/Phường.
Người dùng (vai trò: ${role || 'công dân'}) nhập yêu cầu: "${userQuery}".

Hãy phân tích nhu cầu và trả về JSON gợi ý tính năng phù hợp nhất trong hệ thống.
Các target có thể chọn:
- portal: Trang chủ & Giới thiệu trạm
- duty: Lịch trực 24/7 công khai trạm y tế
- map: Bản đồ định vị & Chỉ đường trạm y tế
- telehealth: Ứng dụng Bác sĩ cho mọi nhà (tư vấn trực tuyến)
- news: Tin tức truyền thông y tế
- documents: Văn bản biểu mẫu khai báo
- feedback: Gửi ý kiến phản ánh BHYT, dịch vụ
- tracking: Tra cứu tiến độ giải quyết phản ánh
- workspace: Bàn làm việc y tế (dành cho cán bộ)`;

    const delays = [500, 1200];
    let response: any;
    let lastErr: any;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        response = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  suggestedTarget: { type: Type.STRING },
                  reasoning: { type: Type.STRING },
                  recommendedActions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        target: { type: Type.STRING },
                      },
                    },
                  },
                },
              },
            },
          }),
          10000
        );
        break;
      } catch (err: any) {
        lastErr = err;
        if (attempt < delays.length && isTransientError(err)) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
          continue;
        }
        throw err;
      }
    }
    if (!response) throw lastErr;

    const parsedData = safeParseJsonObject(response.text);
    if (!parsedData || !parsedData.suggestedTarget) {
      return res.status(502).json({ error: 'Gemini AI trả về định dạng JSON không hợp lệ.' });
    }

    return res.json(parsedData);
  } catch (error: any) {
    console.error('AI Suggestion error:', error?.message || error);
    const { status, message } = formatGeminiError(error);
    return res.status(status).json({ error: message });
  }
}
