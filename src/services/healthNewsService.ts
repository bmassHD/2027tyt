export interface ExternalApiNewsItem {
  id: string;
  title: string;
  summary: string;
  imageUrl: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  publishedDisplay?: string;
  category: string;
}

export const FALLBACK_HEALTH_NEWS: ExternalApiNewsItem[] = [
  {
    id: 'rss_fallback_1',
    title: 'Khuyến cáo phòng chống các bệnh truyền nhiễm mùa giao mùa',
    summary:
      'Bộ Y tế khuyến cáo người dân nâng cao cảnh giác, thực hiện tiêm chủng đầy đủ và giữ gìn vệ sinh cá nhân để phòng ngừa các bệnh đường hô hấp, cúm mùa và sốt xuất huyết.',
    imageUrl: '/seoapp.jpg',
    sourceName: 'Báo Sức Khỏe & Đời Sống',
    sourceUrl: 'https://suckhoedoisong.vn',
    publishedAt: new Date().toISOString().split('T')[0],
    publishedDisplay: new Date().toLocaleDateString('vi-VN') + ' 08:30',
    category: 'Phòng chống dịch',
  },
  {
    id: 'rss_fallback_2',
    title: 'Lợi ích thiết thực của việc khám sức khỏe định kỳ cho người cao tuổi',
    summary:
      'Khám sức khỏe định kỳ giúp phát hiện sớm các bệnh mạn tính không lây như tăng huyết áp, đái tháo đường, tim mạch để điều trị kịp thời và nâng cao chất lượng tuổi già.',
    imageUrl: '/seoapp.png',
    sourceName: 'Báo Sức Khỏe & Đời Sống',
    sourceUrl: 'https://suckhoedoisong.vn',
    publishedAt: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    publishedDisplay: new Date(Date.now() - 86400000).toLocaleDateString('vi-VN') + ' 10:15',
    category: 'Y Tế',
  },
  {
    id: 'rss_fallback_3',
    title: 'Hướng dẫn tự chăm sóc và dinh dưỡng hợp lý khi mắc sốt xuất huyết nhẹ tại nhà',
    summary:
      'Cẩm nang hướng dẫn theo dõi các dấu hiệu cảnh báo nguy hiểm, bù nước điện giải đúng cách và chế độ dinh dưỡng giúp người bệnh mau hồi phục.',
    imageUrl: '/seoapp.jpg',
    sourceName: 'Báo Sức Khỏe & Đời Sống',
    sourceUrl: 'https://suckhoedoisong.vn',
    publishedAt: new Date(Date.now() - 172800000).toISOString().split('T')[0],
    publishedDisplay: new Date(Date.now() - 172800000).toLocaleDateString('vi-VN') + ' 14:00',
    category: 'Giáo dục sức khỏe',
  },
  {
    id: 'rss_fallback_4',
    title: 'Tăng cường tiêm chủng vaccine phòng bệnh cho trẻ em trước thềm năm học mới',
    summary:
      'Trạm Y tế tổ chức tiêm chủng mở rộng định kỳ hàng tháng, đảm bảo an toàn tiêm chủng và đầy đủ các loại vaccine theo chương trình quốc gia.',
    imageUrl: '/seoapp.png',
    sourceName: 'Báo Sức Khỏe & Đời Sống',
    sourceUrl: 'https://suckhoedoisong.vn',
    publishedAt: new Date(Date.now() - 259200000).toISOString().split('T')[0],
    publishedDisplay: new Date(Date.now() - 259200000).toLocaleDateString('vi-VN') + ' 09:00',
    category: 'Tiêm chủng',
  },
];

export async function fetchHealthNews(): Promise<{
  items: ExternalApiNewsItem[];
  lastBuildDate: string;
  sourceUrl: string;
  error?: string;
  statusCode?: number;
  isFallback?: boolean;
}> {
  const RSS_SOURCE = 'https://suckhoedoisong.vn/y-te.rss';

  // Call the official backend endpoint /api/health-news-rss (Vercel Serverless & Node Express)
  try {
    const res = await fetch('/api/health-news-rss', {
      headers: {
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        return {
          items: data.items,
          lastBuildDate: data.lastBuildDate || new Date().toLocaleDateString('vi-VN'),
          sourceUrl: data.source || RSS_SOURCE,
          statusCode: res.status,
          isFallback: false,
        };
      }
      if (data.error) {
        return {
          items: FALLBACK_HEALTH_NEWS,
          lastBuildDate: new Date().toLocaleDateString('vi-VN'),
          sourceUrl: RSS_SOURCE,
          statusCode: data.statusCode || res.status,
          error: data.error,
          isFallback: true,
        };
      }
    } else {
      let errorMsg = `Máy chủ trả về mã HTTP ${res.status} (${res.statusText})`;
      try {
        const errorJson = await res.json();
        if (errorJson?.error) {
          errorMsg = errorJson.error;
        }
      } catch {
        // use default error message
      }
      return {
        items: FALLBACK_HEALTH_NEWS,
        lastBuildDate: new Date().toLocaleDateString('vi-VN'),
        sourceUrl: RSS_SOURCE,
        statusCode: res.status,
        error: errorMsg,
        isFallback: true,
      };
    }
  } catch (err: any) {
    return {
      items: FALLBACK_HEALTH_NEWS,
      lastBuildDate: new Date().toLocaleDateString('vi-VN'),
      sourceUrl: RSS_SOURCE,
      statusCode: 0,
      error: `Không thể kết nối đến máy chủ API: ${err?.message || 'Lỗi mạng'}`,
      isFallback: true,
    };
  }

  return {
    items: FALLBACK_HEALTH_NEWS,
    lastBuildDate: new Date().toLocaleDateString('vi-VN'),
    sourceUrl: RSS_SOURCE,
    isFallback: true,
  };
}
