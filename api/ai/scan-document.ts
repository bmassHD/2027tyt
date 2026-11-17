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

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 12000): Promise<T> {
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

  const docNameRaw = req.body?.fileName || req.body?.filename || '';
  const cleanBaseTitle = docNameRaw
    ? String(docNameRaw).replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim()
    : 'Văn bản y tế';

  try {
    const { textContent, filename, fileName, fileBase64, mimeType } = req.body || {};
    const effectiveFilename = String(filename || fileName || 'van-ban.txt');
    const normalizedText = typeof textContent === 'string' ? textContent.trim() : '';
    const hasInlineMedia =
      typeof fileBase64 === 'string' &&
      fileBase64.length > 0 &&
      typeof mimeType === 'string' &&
      (mimeType === 'application/pdf' || mimeType.startsWith('image/'));

    if (!normalizedText && !hasInlineMedia && !docNameRaw) {
      return res.status(400).json({ error: 'Nội dung tệp không được để trống' });
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

    const todayIso = new Date().toISOString().split('T')[0];
    const prompt = `Bạn là Trợ lý AI Phân Tích Văn Bản Y Tế.
Hãy đọc thông tin tập tin (tên tệp: ${effectiveFilename}) và nội dung kèm theo dưới đây:
---
${(normalizedText || effectiveFilename).slice(0, 6000)}
---

Hãy trích xuất các thông tin văn bản y tế hành chính dựa trên dữ liệu hiện có.
Các trường JSON bắt buộc:
- "title": Tên hoặc tiêu đề văn bản (tiếng Việt có dấu, rõ ràng)
- "docNumber": Số hiệu văn bản (ví dụ 12/TB-TYT hoặc 366/BHXH-CNTT)
- "issueDate": Ngày ban hành theo định dạng YYYY-MM-DD (nếu không rõ lấy ngày hôm nay: ${todayIso})
- "issuingAuthority": Cơ quan hoặc đơn vị phát hành văn bản (ví dụ: Bộ Y tế, Sở Y tế, Bảo hiểm xã hội Việt Nam, Trạm Y tế)
- "summary": Tóm tắt ngắn gọn 1-2 câu về nội dung chính
- "category": Chọn 1 trong 4 giá trị: Chỉ đạo điều hành | Tiêm chủng BHYT | Phòng chống dịch | Biểu mẫu kê khai`;

    const contentsPayload: any = hasInlineMedia
      ? {
          parts: [
            { inlineData: { mimeType: String(mimeType), data: String(fileBase64) } },
            { text: prompt },
          ],
        }
      : prompt;

    const delays = [500, 1200];
    let response: any;
    let lastErr: any;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        response = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: contentsPayload,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  docNumber: { type: Type.STRING },
                  issueDate: { type: Type.STRING },
                  issuingAuthority: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  category: { type: Type.STRING },
                },
              },
            },
          }),
          12000
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
    if (!parsedData) {
      return res.status(502).json({ error: 'Gemini AI trả về định dạng JSON không hợp lệ.' });
    }

    return res.json({
      title: typeof parsedData.title === 'string' && parsedData.title.trim() ? parsedData.title.trim() : cleanBaseTitle,
      docNumber: typeof parsedData.docNumber === 'string' && parsedData.docNumber.trim() ? parsedData.docNumber.trim() : '01/CV-TYT',
      issueDate:
        typeof parsedData.issueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsedData.issueDate.trim())
          ? parsedData.issueDate.trim()
          : todayIso,
      issuingAuthority:
        typeof parsedData.issuingAuthority === 'string' && parsedData.issuingAuthority.trim()
          ? parsedData.issuingAuthority.trim()
          : 'Trạm Y tế',
      summary: typeof parsedData.summary === 'string' && parsedData.summary.trim() ? parsedData.summary.trim() : '',
      category: typeof parsedData.category === 'string' && parsedData.category.trim() ? parsedData.category.trim() : 'Chỉ đạo điều hành',
    });
  } catch (error: any) {
    console.error('AI Document Scan error:', error?.message || error);
    const { status, message } = formatGeminiError(error);
    return res.status(status).json({ error: message });
  }
}
