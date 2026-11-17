export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức GET' });
  }

  const rawKey = (process.env.GEMINI_API_KEY || '').trim();
  const configured = Boolean(rawKey && rawKey !== 'MY_GEMINI_API_KEY');

  return res.json({
    ok: true,
    configured,
    model: 'gemini-4-hydrogen',
    provider: 'Google Gemini AI',
    configuredVia: 'Biến môi trường bảo mật phía máy chủ (Settings > Secrets)',
    statusMessage: configured
      ? 'Sẵn sàng tự động đọc, quét và trích xuất thông tin văn bản khi tải lên'
      : 'Hệ thống đang hoạt động với bộ phân tích dự phòng (vui lòng gắn GEMINI_API_KEY tại Settings > Secrets)',
    capabilities: [
      'Tự động đọc & quét tài liệu đa phương thức (PDF, Word, Ảnh văn bản)',
      'Trích xuất tự động: Số hiệu, Tiêu đề, Ngày ban hành, Cơ quan ban hành, Thể loại, Tóm tắt',
      'Giao diện hiển thị văn bản 1 dòng chuẩn hóa kèm chức năng xem chi tiết',
      'Trợ lý thông minh phân loại và gợi ý dịch vụ y tế cho công dân',
    ],
    updatedAt: new Date().toISOString(),
  });
}
