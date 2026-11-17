import { Post } from '../types';

export type PostEmbedFilter = 'all' | 'embedded' | 'facebook' | 'youtube' | 'standard';
export type PostTableSortKey =
  | 'custom'
  | 'newest'
  | 'oldest'
  | 'title_asc'
  | 'title_desc'
  | 'views_desc';

export interface PostFormatInfo {
  hasEmbed: boolean;
  embedType: 'facebook' | 'youtube' | 'none';
  label: string;
  shortLabel: string;
  subLabel: string;
}

export function getPostTimestampKey(post: Post): string {
  if (post.createdAt) return post.createdAt;
  if (post.publishedAt) return `${post.publishedAt}T00:00:00.000Z`;
  return post.updatedAt || '';
}

export function sortPostsForDisplay(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const aPinned = Boolean(a.isPinned);
    const bPinned = Boolean(b.isPinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    const aHasOrder = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder);
    const bHasOrder = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder);

    if (aHasOrder && bHasOrder) {
      if ((a.sortOrder as number) !== (b.sortOrder as number)) {
        return (a.sortOrder as number) - (b.sortOrder as number);
      }
    } else if (aHasOrder !== bHasOrder) {
      // Newly created posts without sortOrder appear before older sorted items if newer by timestamp
      const timeCmp = getPostTimestampKey(b).localeCompare(getPostTimestampKey(a));
      if (timeCmp !== 0) return timeCmp;
      return aHasOrder ? 1 : -1;
    }

    const timeCmp = getPostTimestampKey(b).localeCompare(getPostTimestampKey(a));
    if (timeCmp !== 0) return timeCmp;

    const updCmp = (b.updatedAt || '').localeCompare(a.updatedAt || '');
    if (updCmp !== 0) return updCmp;

    return b.id.localeCompare(a.id);
  });
}

export function getNextTopSortOrders(existingPosts: Post[], count = 1): Array<number | undefined> {
  const existingOrders = existingPosts
    .map(p => p.sortOrder)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  if (existingOrders.length === 0) {
    return Array.from({ length: count }, () => undefined);
  }

  const minOrder = Math.min(...existingOrders);
  return Array.from({ length: count }, (_, idx) => minOrder - count + idx);
}

export function getPostFormatInfo(post: Post): PostFormatInfo {
  const cleanEmbedUrl = (post.embedUrl || '').trim();
  if (cleanEmbedUrl && post.embedType === 'facebook') {
    const fbKind = post.facebookMeta?.kind;
    const subLabel =
      fbKind === 'video'
        ? 'Video Facebook'
        : fbKind === 'page'
        ? 'Fanpage Facebook'
        : fbKind === 'profile'
        ? 'Trang cá nhân Facebook'
        : 'Bài viết Facebook';
    return {
      hasEmbed: true,
      embedType: 'facebook',
      label: `Có nhúng · ${subLabel}`,
      shortLabel: 'Nhúng Facebook',
      subLabel,
    };
  }

  if (cleanEmbedUrl && post.embedType === 'youtube') {
    return {
      hasEmbed: true,
      embedType: 'youtube',
      label: 'Có nhúng · Video YouTube',
      shortLabel: 'Nhúng YouTube',
      subLabel: 'Video YouTube',
    };
  }

  const hasImage = Boolean(post.mediaItems?.some(m => m.url));
  return {
    hasEmbed: false,
    embedType: 'none',
    label: hasImage ? 'Không nhúng · Bài viết có ảnh/media' : 'Không nhúng · Bài viết thường',
    shortLabel: 'Không nhúng',
    subLabel: hasImage ? 'Bài viết có ảnh/media' : 'Bài viết văn bản',
  };
}

export const POST_CATEGORY_LABELS: Record<Post['category'], string> = {
  tin_hoat_dong: 'Tin hoạt động',
  phong_chong_dich: 'Phòng chống dịch',
  giao_duc_suc_khoe: 'Giáo dục sức khỏe',
  tiem_chung: 'Tiêm chủng',
  benh_khong_lay_nhiem: 'Bệnh không lây nhiễm',
  an_toan_thuc_pham: 'An toàn thực phẩm',
};
