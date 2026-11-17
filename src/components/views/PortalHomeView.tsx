import React, { useState, useEffect } from 'react';
import { fetchHealthNews, ExternalApiNewsItem } from '../../services/healthNewsService';
import {
  Phone,
  Mail,
  ArrowRight,
  ShieldCheck,
  Clock,
  MapPin,
  Sparkles,
  Compass,
  X,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { SystemSettings, Post } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { StationLogo } from '../common/StationLogo';
import { RevealOnScroll } from '../common/RevealOnScroll';
import { getConfiguredEmergencyContacts, recordPostViewOnce } from '../../services/firebaseService';
import { StationMapSection } from '../portal/StationMapSection';
import { HomeImageCarousel } from '../portal/HomeImageCarousel';
import { HomeNewsCarousel } from '../portal/HomeNewsCarousel';
import { BannerSkeleton } from '../common/SkeletonLoader';
import { GitHubService } from '../../services/githubService';
import { FacebookPostEmbed } from '../common/FacebookPostEmbed';
import { getYouTubeEmbedId } from '../../utils/facebookEmbed';

interface PortalHomeViewProps {
  settings: SystemSettings;
  settingsLoaded?: boolean;
  setCurrentView: (view: string, extraQuery?: string) => void;
  openAdminSetupModal: () => void;
}

export const PortalHomeView: React.FC<PortalHomeViewProps> = ({
  settings,
  settingsLoaded = true,
  setCurrentView,
  openAdminSetupModal,
}) => {
  const { isAdmin } = useAuth();

  const [posts, setPosts] = useState<Post[]>([]);
  const [rssItems, setRssItems] = useState<ExternalApiNewsItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingRss, setLoadingRss] = useState(true);
  const [readingPost, setReadingPost] = useState<Post | null>(null);

  useEffect(() => {
    const unsubPosts = onSnapshot(
      collection(db, 'posts'),
      snap => {
        setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
        setLoadingPosts(false);
      },
      () => setLoadingPosts(false)
    );

    fetchHealthNews()
      .then(data => {
        if (Array.isArray(data.items)) {
          setRssItems(data.items.slice(0, 10));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRss(false));

    return () => {
      unsubPosts();
    };
  }, []);

  const handleOpenPost = (post: Post) => {
    setReadingPost(post);
    void recordPostViewOnce(post.id);
  };

  const isConfigured = settings.stationName && !settings.stationName.includes('Chưa cấu hình');
  const parentUnit = settings.parentUnitName || 'TRUNG TÂM Y TẾ QUẬN / HUYỆN · SỞ Y TẾ ĐỊA PHƯƠNG';
  const configuredEmergencies = getConfiguredEmergencyContacts(settings);
  const hasHotline = Boolean(settings.hotline && !settings.hotline.includes('Chưa cập nhật'));
  const hasEmail = Boolean(settings.email?.trim());

  return (
    <div className="space-y-8">
      {/* Station Identity Hero Banner */}
      <RevealOnScroll immediate>
        {!settingsLoaded ? (
          <BannerSkeleton />
        ) : (
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
              {/* Left Column: Station Identity & 2 Symmetrical Primary Buttons */}
              <div className="lg:col-span-7 p-6 sm:p-7 flex flex-col justify-between gap-5 bg-gradient-to-br from-emerald-800 via-teal-800 to-slate-900 text-white">
                <div className="flex items-start gap-4">
                  <div className="p-1.5 bg-white rounded-2xl shadow-xs shrink-0">
                    <StationLogo size={60} />
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <p className="text-xs font-bold tracking-wider uppercase text-emerald-200 truncate">
                      {parentUnit}
                    </p>

                    <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight text-balance">
                      {isConfigured ? settings.stationName : 'TRẠM Y TẾ XÃ / PHƯỜNG'}
                    </h1>

                    <p className="text-sm text-emerald-100/90 leading-relaxed line-clamp-2 max-w-xl">
                      {settings.subTitle || 'Cổng thông tin điện tử & chăm sóc sức khỏe nhân dân cơ sở.'}
                    </p>
                  </div>
                </div>

                {/* Strictly 2 Symmetrical Concise Buttons */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {!isConfigured && isAdmin ? (
                    <button
                      type="button"
                      onClick={openAdminSetupModal}
                      className="px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold text-sm inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                    >
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>Thiết lập trạm</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCurrentView('duty')}
                      className="px-3.5 py-2.5 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-sm transition inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Clock className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>Lịch trực 24/7</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setCurrentView('map')}
                    className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/25 text-white font-semibold text-sm transition inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <MapPin className="w-4 h-4 text-emerald-300 shrink-0" />
                    <span>Bản đồ y tế</span>
                  </button>
                </div>
              </div>

              {/* Right Column: Emergency Contacts Only */}
              <div className="lg:col-span-5 p-5 sm:p-6 bg-slate-50 dark:bg-slate-950/60 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 flex flex-col justify-center gap-3.5">
                {configuredEmergencies.length > 0 ? (
                  <div className="px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                      <Phone className="w-4 h-4 shrink-0 animate-pulse" />
                      <span>Số Điện Thoại Cấp Cứu 24/7</span>
                    </div>

                    <div className="divide-y divide-rose-200/70 dark:divide-rose-900/50">
                      {configuredEmergencies.map(ec => (
                        <div
                          key={ec.id}
                          className="py-1.5 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3"
                        >
                          <span className="text-xs sm:text-sm text-rose-800/90 dark:text-rose-300/90 font-medium leading-snug min-w-0 truncate">
                            {ec.note || 'Thường trực cấp cứu'}
                          </span>
                          <a
                            href={`tel:${ec.phone}`}
                            className="text-base sm:text-lg font-extrabold text-rose-700 dark:text-rose-200 hover:underline tabular-nums whitespace-nowrap shrink-0"
                          >
                            {ec.phone}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-5 rounded-2xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 text-center space-y-1">
                    <Phone className="w-5 h-5 text-rose-600 mx-auto" />
                    <span className="text-xs font-bold text-rose-700 dark:text-rose-300 block">Đường dây nóng cấp cứu</span>
                    <a href="tel:115" className="text-xl font-extrabold text-rose-700 dark:text-rose-200 tabular-nums">115</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </RevealOnScroll>

      {/* Highlight Image Carousel */}
      {settings.highlightImages && settings.highlightImages.length > 0 && (
        <RevealOnScroll title="Hình ảnh hoạt động">
          <HomeImageCarousel slides={settings.highlightImages} />
        </RevealOnScroll>
      )}

      {/* Horizontal 2-Row News Carousels (API + Station Posts) */}
      <RevealOnScroll title="Tin tức y tế mới">
        <HomeNewsCarousel
          posts={posts}
          rssItems={rssItems}
          loadingPosts={loadingPosts}
          loadingRss={loadingRss}
          onOpenAllNews={tab => setCurrentView('news', tab ? `tab=${tab}` : undefined)}
          onSelectPost={handleOpenPost}
        />
      </RevealOnScroll>

      {/* Expandable Service Sections */}
      <RevealOnScroll title="Chức năng & Bản đồ trạm">
        <div className="space-y-4">
          {/* 1. Official Functions & Duties */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-5 sm:px-6 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug truncate">
                    Chức Năng &amp; Nhiệm Vụ
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    Phạm vi chuyên môn y tế cơ sở Bộ Y tế
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-3">
              <div className="bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl p-5 sm:p-6 border border-slate-100 dark:border-slate-800/80">
                {settings.customFunctionsAndDuties ? (
                  <div className="space-y-3">
                    {settings.customFunctionsAndDuties
                      .split('\n')
                      .filter(paragraph => paragraph.trim().length > 0)
                      .map((paragraph, pIdx) => (
                        <p
                          key={pIdx}
                          className="text-sm sm:text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 text-justify [text-indent:1cm]"
                        >
                          {paragraph.trim()}
                        </p>
                      ))}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm sm:text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 text-justify">
                    <p className="[text-indent:1cm]">
                      Trạm Y tế thực hiện các dịch vụ chuyên môn về y tế dự phòng, khám chữa bệnh ban đầu, chăm sóc sức khỏe sinh sản, cung ứng thuốc thiết yếu và quản lý sức khỏe cộng đồng trên địa bàn.
                    </p>
                    <p className="[text-indent:1cm]">
                      Đơn vị thường trực tiêm chủng mở rộng an toàn, phòng chống dịch bệnh truyền nhiễm, trực cấp cứu 24/7 và triển khai hồ sơ sức khỏe điện tử toàn dân.
                    </p>
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCurrentView('admin')}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-700 text-sm font-semibold text-slate-700 dark:text-slate-300 transition inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <span>Chỉnh sửa</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 2. Map & Locations */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-5 sm:px-6 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Compass className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug truncate">
                    Bản Đồ Điểm Y Tế &amp; GPS
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    Chỉ đường đến {settings.mapLocations?.length || 1} cơ sở y tế
                  </p>
                </div>
              </div>
            </div>

            <div>
              <StationMapSection
                embedded
                locations={settings.mapLocations}
                stationName={settings.stationName}
                defaultAddress={settings.address}
              />
            </div>
          </div>
        </div>
      </RevealOnScroll>

      {/* Quick Post Reader Modal for Station News Slides */}
      {readingPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 sm:p-8 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="space-y-1 min-w-0">
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  {readingPost.publishedAt} · <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{readingPost.authorName}</span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-snug">
                  {readingPost.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setReadingPost(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {readingPost.embedUrl && readingPost.embedType === 'youtube' && getYouTubeEmbedId(readingPost.embedUrl) && (
              <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${getYouTubeEmbedId(readingPost.embedUrl)}`}
                  title={readingPost.title}
                  className="w-full h-full border-0"
                  allowFullScreen
                />
              </div>
            )}

            {readingPost.embedUrl && readingPost.embedType === 'facebook' && (
              <FacebookPostEmbed
                url={readingPost.embedUrl}
                title={readingPost.title}
                facebookMeta={readingPost.facebookMeta}
                fallbackText={readingPost.content || readingPost.summary}
              />
            )}

            {readingPost.summary && readingPost.summary.trim() !== readingPost.title.trim() && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 font-medium text-sm text-slate-700 dark:text-slate-300 leading-relaxed border border-slate-200 dark:border-slate-700">
                {readingPost.summary}
              </div>
            )}

            {readingPost.content && readingPost.content.trim() && (
              <div className="text-sm sm:text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                {readingPost.content}
              </div>
            )}

            {readingPost.mediaItems && readingPost.mediaItems.length > 0 && (() => {
              const hideFbSyncedImages =
                readingPost.embedType === 'facebook' && readingPost.facebookMeta?.showImage === false;
              const visibleMedia = hideFbSyncedImages
                ? readingPost.mediaItems.filter(m => m.caption !== 'Hình ảnh từ bài viết Facebook')
                : readingPost.mediaItems;
              if (visibleMedia.length === 0) return null;
              return (
              <div className="space-y-3 pt-2">
                {visibleMedia.map((media, idx) => {
                  const mediaSrc = GitHubService.toRawGitHubUrl(media.url);
                  return (
                    <div key={media.id || idx} className="space-y-1">
                      {media.type === 'video' ? (
                        <video
                          src={mediaSrc}
                          controls
                          className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 max-h-[520px] bg-black"
                        />
                      ) : (
                        <img
                          src={mediaSrc}
                          alt={media.caption || readingPost.title}
                          referrerPolicy="no-referrer"
                          className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 max-h-[520px] object-contain"
                        />
                      )}
                      {media.caption && (
                        <span className="text-xs text-slate-400 block">{media.caption}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setReadingPost(null);
                  setCurrentView('news', 'tab=station');
                }}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <span>Mở bảng tin</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
