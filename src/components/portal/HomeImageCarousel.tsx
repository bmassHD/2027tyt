import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X, Sparkles, Image as ImageIcon, Calendar } from 'lucide-react';

export interface CarouselSlide {
  id: string;
  imageUrl: string;
  title: string;
  subtitle?: string;
  tag?: string;
  date?: string;
}

interface HomeImageCarouselProps {
  slides?: CarouselSlide[];
}

export const HomeImageCarousel: React.FC<HomeImageCarouselProps> = ({ slides = [] }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<CarouselSlide | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const slideCount = slides?.length || 0;

  useEffect(() => {
    if (slideCount === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex(prev => (prev >= slideCount ? 0 : prev));
  }, [slideCount]);

  useEffect(() => {
    if (slideCount <= 1 || isPaused || lightboxImage) return;

    const timer = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % slideCount);
    }, 4500);

    return () => clearInterval(timer);
  }, [isPaused, lightboxImage, slideCount]);

  // If no highlight images are configured, hide the section entirely
  if (!slides || slides.length === 0) {
    return null;
  }

  const safeIndex = activeIndex < slides.length ? activeIndex : 0;
  const currentSlide = slides[safeIndex] || slides[0];
  const maxThumbnails = 3;
  const displayThumbnails = slides.slice(0, maxThumbnails);
  const remainingCount = slides.length - maxThumbnails;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="space-y-4"
    >
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
            <ImageIcon className="w-4 h-4" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
            Hình Ảnh Hoạt Động Nổi Bật
          </h3>
        </div>

        {/* Manual Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveIndex(prev => (prev === 0 ? slides.length - 1 : prev - 1))}
            className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition cursor-pointer"
            title="Ảnh trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveIndex(prev => (prev + 1) % slides.length)}
            className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition cursor-pointer"
            title="Ảnh tiếp theo"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2-Panel Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        {/* Panel 1: Large Image Frame (col-span-7) */}
        <div
          onClick={() => setLightboxImage(currentSlide)}
          className="lg:col-span-7 relative h-72 sm:h-80 rounded-2xl overflow-hidden cursor-pointer group shadow-md border border-slate-200 dark:border-slate-800"
        >
          <img
            src={currentSlide.imageUrl}
            alt={currentSlide.title}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent" />

          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="p-2 rounded-xl bg-black/60 text-white backdrop-blur-md flex items-center gap-1 text-xs">
              <Maximize2 className="w-3.5 h-3.5" /> Phóng to
            </span>
          </div>

          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white">
            <span className="text-xs font-mono text-emerald-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> {currentSlide.date || 'Hôm nay'}
            </span>
            {currentSlide.tag && (
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">
                {currentSlide.tag}
              </span>
            )}
          </div>
        </div>

        {/* Panel 2: Title & Detailed Content Panel (col-span-5) */}
        <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>Hoạt động y tế cơ sở</span>
            </div>

            <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white leading-snug">
              {currentSlide.title}
            </h3>

            <p className="text-sm sm:text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed text-justify">
              {currentSlide.subtitle || 'Hoạt động chuyên môn và chăm sóc sức khỏe nhân dân cơ sở.'}
            </p>
          </div>

          {/* Thumbnails selector list with +XX hover badge if many images */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Danh sách ảnh hoạt động ({slides.length}):
            </span>
            <div className="grid grid-cols-4 gap-2">
              {displayThumbnails.map((slide, sIdx) => (
                <div
                  key={slide.id}
                  onClick={() => setActiveIndex(sIdx)}
                  className={`h-14 rounded-xl overflow-hidden cursor-pointer border-2 transition ${
                    sIdx === activeIndex
                      ? 'border-emerald-600 ring-2 ring-emerald-500/30 scale-105'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={slide.imageUrl} alt={slide.title} className="w-full h-full object-cover" />
                </div>
              ))}

              {/* Last thumbnail or extra badge if remainingCount > 0 */}
              {remainingCount > 0 && slides.length > maxThumbnails && (
                <div
                  onClick={() => setActiveIndex(maxThumbnails)}
                  className="relative h-14 rounded-xl overflow-hidden cursor-pointer border-2 border-transparent opacity-90 hover:opacity-100 bg-slate-900 flex items-center justify-center text-white font-bold text-xs group"
                >
                  <img
                    src={slides[maxThumbnails].imageUrl}
                    alt="More"
                    className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:scale-105 transition"
                  />
                  <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                    <span className="text-xs font-black text-amber-300">+{remainingCount}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Zoom Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[150] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl w-full rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl space-y-4 p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Chi Tiết Hoạt Động Y Tế
              </span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden max-h-[70vh] flex items-center justify-center bg-black">
              <img
                src={lightboxImage.imageUrl}
                alt={lightboxImage.title}
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>

            <div className="space-y-1 px-2 pb-2">
              <h3 className="text-base font-bold text-white leading-snug">
                {lightboxImage.title}
              </h3>
              {lightboxImage.subtitle && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  {lightboxImage.subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
