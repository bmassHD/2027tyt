import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowRight,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Globe,
  Newspaper,
  Rss,
} from 'lucide-react';
import { Post } from '../../types';
import { ExternalApiNewsItem } from '../../services/healthNewsService';
import { GitHubService } from '../../services/githubService';
import { FacebookPostEmbed } from '../common/FacebookPostEmbed';
import { getYouTubeEmbedId } from '../../utils/facebookEmbed';
import { sortPostsForDisplay } from '../../utils/postSorting';

interface HomeNewsCarouselProps {
  posts: Post[];
  rssItems: ExternalApiNewsItem[];
  loadingPosts: boolean;
  loadingRss: boolean;
  onOpenAllNews: (initialTab?: 'api' | 'station') => void;
  onSelectPost: (post: Post) => void;
}

interface NewsSlide {
  id: string;
  kind: 'station' | 'rss';
  title: string;
  summary: string;
  imageUrl: string;
  meta: string;
  views?: number;
  href?: string;
  post?: Post;
}

const LOCAL_FALLBACK_COVERS = [
  '/seoapp.jpg',
  '/seoapp.png',
];

interface CarouselRowProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  slides: NewsSlide[];
  loading: boolean;
  emptyText: string;
  autoScrollOffsetMs?: number;
  onOpenAll: () => void;
  onSelectPost: (post: Post) => void;
}

const CarouselRow: React.FC<CarouselRowProps> = ({
  title,
  subtitle,
  icon: Icon,
  slides,
  loading,
  emptyText,
  autoScrollOffsetMs = 0,
  onOpenAll,
  onSelectPost,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const activeIndexRef = useRef(0);

  const scrollToSlide = (targetIdx: number, isAutoAdvance = false) => {
    const container = trackRef.current;
    if (!container || slides.length === 0) return;

    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    let normalized = ((targetIdx % slides.length) + slides.length) % slides.length;

    if (isAutoAdvance && container.scrollLeft >= maxScroll - 4 && targetIdx > activeIndexRef.current) {
      normalized = 0;
    }

    const cardEl = container.children[normalized] as HTMLElement | undefined;
    if (cardEl) {
      const targetLeft = Math.min(maxScroll, Math.max(0, cardEl.offsetLeft));
      container.scrollTo({
        left: targetLeft,
        behavior: 'smooth',
      });
    }
    activeIndexRef.current = normalized;
    setActiveIndex(normalized);
  };

  useEffect(() => {
    if (activeIndexRef.current >= slides.length) {
      activeIndexRef.current = 0;
      setActiveIndex(0);
    }
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || isPaused) return;
    let intervalId = 0;
    const startTimer = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        const next = activeIndexRef.current + 1;
        scrollToSlide(next, true);
      }, 4200);
    }, autoScrollOffsetMs);

    return () => {
      window.clearTimeout(startTimer);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [slides.length, isPaused, autoScrollOffsetMs]);

  const handleTrackScroll = () => {
    const container = trackRef.current;
    if (!container || container.children.length === 0) return;

    const scrollLeft = container.scrollLeft;
    let closestIdx = 0;
    let minDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i] as HTMLElement;
      const dist = Math.abs(child.offsetLeft - scrollLeft);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx !== activeIndexRef.current) {
      activeIndexRef.current = closestIdx;
      setActiveIndex(closestIdx);
    }
  };

  return (
    <div
      className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
              {title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {slides.length > 1 && (
            <div className="hidden sm:flex items-center gap-1.5 mr-1">
              <span className="text-xs font-mono font-bold text-slate-400 tabular-nums whitespace-nowrap mr-1">
                {String(activeIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={() => scrollToSlide(activeIndex - 1)}
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                aria-label="Tin trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollToSlide(activeIndex + 1)}
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                aria-label="Tin tiếp"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onOpenAll}
            className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Tất cả</span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </div>

      {loading && slides.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          <div className="h-60 rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="hidden sm:block h-60 rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="hidden lg:block h-60 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : slides.length === 0 ? (
        <p className="text-sm text-slate-500 py-3">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          <div
            ref={trackRef}
            onScroll={handleTrackScroll}
            className="relative flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar touch-pan-x pb-1"
          >
            {slides.map((slide, idx) => {
              if (slide.kind === 'station' && slide.post) {
                const post = slide.post;
                const ytId =
                  post.embedUrl && post.embedType === 'youtube'
                    ? getYouTubeEmbedId(post.embedUrl)
                    : null;
                const coverMedia = post.mediaItems?.find(m => m.type !== 'video' && m.url);
                const coverImageSrc = coverMedia
                  ? GitHubService.toRawGitHubUrl(coverMedia.url)
                  : '';
                const hasBrokenCover = Boolean(brokenImages[slide.id]);

                return (
                  <div
                    key={slide.id}
                    className="w-[85%] sm:w-[calc(50%-8px)] lg:w-[calc(33.333%-11px)] snap-start shrink-0"
                  >
                    <article className="h-full p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:border-emerald-500/70 transition flex flex-col justify-between gap-3.5 group">
                      <div className="space-y-3 flex-1 flex flex-col">
                        <div className="w-full h-60 rounded-xl overflow-hidden shrink-0">
                          {ytId ? (
                            <div className="w-full h-full bg-black relative">
                              <iframe
                                src={`https://www.youtube.com/embed/${ytId}`}
                                title={post.title}
                                loading="lazy"
                                className="w-full h-full border-0"
                                allowFullScreen
                              />
                            </div>
                          ) : post.embedUrl && post.embedType === 'facebook' ? (
                            <FacebookPostEmbed
                              url={post.embedUrl}
                              title={post.title}
                              facebookMeta={post.facebookMeta}
                              fallbackText={post.content || post.summary}
                              compact
                            />
                          ) : coverImageSrc && !hasBrokenCover ? (
                            <button
                              type="button"
                              onClick={() => onSelectPost(post)}
                              className="w-full h-full bg-slate-100 dark:bg-slate-800 cursor-pointer block overflow-hidden"
                            >
                              <img
                                src={coverImageSrc}
                                alt={coverMedia?.caption || post.title}
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                onError={() =>
                                  setBrokenImages(prev => ({ ...prev, [slide.id]: true }))
                                }
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onSelectPost(post)}
                              className="w-full h-full bg-gradient-to-br from-emerald-50 via-teal-50 to-slate-100 dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-800 border border-emerald-100/80 dark:border-slate-800 cursor-pointer flex flex-col items-center justify-center gap-2 p-4 text-center"
                            >
                              <div className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 shadow-xs flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                <Newspaper className="w-5 h-5" />
                              </div>
                              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 line-clamp-2 max-w-[200px]">
                                Bản tin truyền thông Trạm Y tế
                              </span>
                            </button>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 h-5">
                          <span className="font-mono flex items-center gap-1 tabular-nums truncate">
                            <Calendar className="w-3 h-3 shrink-0" />
                            <span>{post.publishedAt}</span>
                            <span className="mx-0.5">·</span>
                            <Eye className="w-3 h-3 shrink-0" />
                            <span>{post.views || 0}</span>
                          </span>
                          <span className="font-medium text-emerald-700 dark:text-emerald-400 truncate max-w-[120px]">
                            {post.authorName || 'Trạm Y tế'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectPost(post)}
                          className="text-left cursor-pointer space-y-1.5"
                        >
                          <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug line-clamp-2 min-h-[2.45rem] group-hover:text-emerald-600 transition">
                            {slide.title}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2 min-h-[2.4rem]">
                            {slide.summary}
                          </p>
                        </button>
                      </div>

                      <div className="pt-2.5 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectPost(post)}
                          className="inline-flex items-center gap-1 hover:underline cursor-pointer"
                        >
                          <span>Đọc tin</span>
                          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      </div>
                    </article>
                  </div>
                );
              }

              const fallbackSrc = LOCAL_FALLBACK_COVERS[idx % LOCAL_FALLBACK_COVERS.length];
              const imgSrc = brokenImages[slide.id] ? fallbackSrc : slide.imageUrl || fallbackSrc;

              return (
                <div
                  key={slide.id}
                  className="w-[85%] sm:w-[calc(50%-8px)] lg:w-[calc(33.333%-11px)] snap-start shrink-0"
                >
                  <a
                    href={slide.href || '#tin-tuc'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full h-full"
                  >
                    <div className="h-full flex flex-col rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 overflow-hidden hover:border-emerald-500/70 transition group">
                      <div className="relative h-40 sm:h-44 w-full bg-slate-200 dark:bg-slate-800 overflow-hidden shrink-0">
                        <img
                          src={imgSrc}
                          alt={slide.title}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          onError={() => setBrokenImages(prev => ({ ...prev, [slide.id]: true }))}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-transparent to-transparent" />
                        <span className="absolute bottom-2.5 left-3 right-3 text-[11px] font-mono text-white/95 truncate tabular-nums">
                          {slide.meta}
                        </span>
                      </div>

                      <div className="p-4 flex-1 flex flex-col justify-between gap-2.5">
                        <div className="space-y-1.5">
                          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 min-h-[2.6rem] group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition">
                            {slide.title}
                          </h3>
                          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 line-clamp-2 min-h-[2.4rem] leading-relaxed">
                            {slide.summary || slide.title}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <span>Xem chi tiết</span>
                            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </a>
                </div>
              );
            })}
          </div>

          {slides.length > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1 sm:hidden">
              <span className="text-xs font-mono font-bold text-slate-500 tabular-nums whitespace-nowrap">
                {String(activeIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')} · Vuốt ngang
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => scrollToSlide(activeIndex - 1)}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                  aria-label="Tin trước"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSlide(activeIndex + 1)}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                  aria-label="Tin tiếp"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const HomeNewsCarousel: React.FC<HomeNewsCarouselProps> = ({
  posts,
  rssItems,
  loadingPosts,
  loadingRss,
  onOpenAllNews,
  onSelectPost,
}) => {
  const apiSlides: NewsSlide[] = useMemo(
    () =>
      rssItems.slice(0, 10).map((item, idx) => ({
        id: `rss_${item.id}`,
        kind: 'rss',
        title: item.title,
        summary: item.summary || '',
        imageUrl:
          item.imageUrl || LOCAL_FALLBACK_COVERS[(idx + 1) % LOCAL_FALLBACK_COVERS.length],
        meta: `${item.publishedDisplay || item.publishedAt || ''} · ${item.sourceName || 'Sức Khỏe & Đời Sống'}`,
        href: item.sourceUrl,
      })),
    [rssItems]
  );

  const stationSlides: NewsSlide[] = useMemo(() => {
    const sortedPosts = sortPostsForDisplay(posts);

    return sortedPosts.slice(0, 10).map(post => {
      const coverMedia = post.mediaItems?.find(m => m.type !== 'video' && m.url);
      const imageUrl = coverMedia ? GitHubService.toRawGitHubUrl(coverMedia.url) : '';

      const summaryText =
        post.summary && post.summary.trim() !== post.title.trim()
          ? post.summary.trim()
          : post.content?.trim() ||
            post.facebookMeta?.postText?.trim() ||
            (post.facebookMeta?.followersText
              ? `Facebook · ${post.facebookMeta.followersText}`
              : 'Nhấn đọc tin để theo dõi nội dung chi tiết bài viết.');

      return {
        id: `post_${post.id}`,
        kind: 'station',
        title: post.title,
        summary: summaryText,
        imageUrl,
        meta: `${post.publishedAt || ''} · ${post.authorName || 'Trạm Y tế'}`,
        views: post.views || 0,
        post,
      };
    });
  }, [posts]);

  return (
    <div className="space-y-6">
      {/* Row 1: External API / Báo Y Tế */}
      <CarouselRow
        title="Tin Y Tế Trực Tuyến"
        subtitle="Báo Sức Khỏe & Đời Sống"
        icon={Globe}
        slides={apiSlides}
        loading={loadingRss}
        emptyText="Đang đồng bộ tin tức từ Báo Sức Khỏe & Đời Sống."
        autoScrollOffsetMs={0}
        onOpenAll={() => onOpenAllNews('api')}
        onSelectPost={onSelectPost}
      />

      {/* Row 2: Station Internal Posts */}
      <CarouselRow
        title="Tin Hoạt Động Trạm Y Tế"
        subtitle="Bài viết, truyền thông giáo dục sức khỏe của Trạm"
        icon={Building2}
        slides={stationSlides}
        loading={loadingPosts}
        emptyText="Chưa có bài viết mới từ Trạm Y tế."
        autoScrollOffsetMs={1800}
        onOpenAll={() => onOpenAllNews('station')}
        onSelectPost={onSelectPost}
      />
    </div>
  );
};

// Keep Rss import acknowledged for compatibility if referenced elsewhere
export { Rss };
