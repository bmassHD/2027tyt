import React, { useState, useEffect, useCallback } from 'react';
import {
  Newspaper,
  Search,
  Plus,
  Trash2,
  Calendar,
  ArrowRight,
  X,
  Share2,
  Inbox,
  ExternalLink,
  Globe,
  Building2,
  RotateCw,
  Rss,
  Edit3,
  Eye,
  FileSpreadsheet,
  LayoutGrid,
  Table2,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Post, SystemSettings } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createPost,
  updatePost,
  deletePost,
  deletePostsBatch,
  updatePostsSortOrder,
  logAuditEvent,
  recordPostViewOnce,
} from '../../services/firebaseService';
import { CardSkeleton } from '../common/SkeletonLoader';
import { RichPostEditorModal } from '../admin/RichPostEditorModal';
import { FacebookPostsImportModal } from '../admin/FacebookPostsImportModal';
import { PostManagementTable } from '../admin/PostManagementTable';
import { PaginationBar } from '../common/PaginationBar';
import { GitHubService } from '../../services/githubService';
import { RevealOnScroll } from '../common/RevealOnScroll';
import { FacebookPostEmbed } from '../common/FacebookPostEmbed';
import { getYouTubeEmbedId } from '../../utils/facebookEmbed';
import { getNextTopSortOrders, sortPostsForDisplay } from '../../utils/postSorting';

import { fetchHealthNews, ExternalApiNewsItem } from '../../services/healthNewsService';

interface NewsViewProps {
  settings?: SystemSettings;
  initialTab?: 'api' | 'station';
}

export const NewsView: React.FC<NewsViewProps> = ({
  settings,
  initialTab,
}) => {
  const { isAdmin, userProfile, currentUser, isStaff } = useAuth();
  const { showToast, showConfirm } = useToast();

  // Active News Stream Tab: 'station' (Trạm đăng) | 'api' (Bảng tin RSS Y tế)
  const [activeTab, setActiveTab] = useState<'station' | 'api'>(initialTab || 'api');

  useEffect(() => {
    if (initialTab === 'station' || initialTab === 'api') {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [rssNews, setRssNews] = useState<ExternalApiNewsItem[]>([]);
  const [rssLoading, setRssLoading] = useState(true);
  const [rssError, setRssError] = useState<string | null>(null);
  const [rssLastBuild, setRssLastBuild] = useState<string>('');
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [readingPost, setReadingPost] = useState<Post | null>(null);

  // Modal post create/edit & Excel Facebook import
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [showFacebookImportModal, setShowFacebookImportModal] = useState(false);

  // Pagination (10 bài/trang) & Admin/Staff Table Management View
  const POSTS_PAGE_SIZE = 10;
  const [stationPage, setStationPage] = useState(1);
  const [apiPage, setApiPage] = useState(1);
  const [stationViewMode, setStationViewMode] = useState<'cards' | 'table'>('cards');
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'posts'),
      snap => {
        setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const openStationPost = (post: Post) => {
    setReadingPost(post);
    void recordPostViewOnce(post.id);
  };

  const [isRssFallback, setIsRssFallback] = useState<boolean>(false);
  const [rssStatusCode, setRssStatusCode] = useState<number | undefined>(undefined);

  const fetchRssNews = useCallback(async (isManual = false) => {
    setRssLoading(true);
    setRssError(null);
    try {
      const data = await fetchHealthNews();
      setRssStatusCode(data.statusCode);
      if (Array.isArray(data.items) && data.items.length > 0) {
        setRssNews(data.items);
        setRssLastBuild(data.lastBuildDate || '');
        setBrokenImages({});
        setIsRssFallback(Boolean(data.isFallback));
        if (data.error) {
          setRssError(data.error);
        }
        if (isManual) {
          if (data.isFallback) {
            showToast('warning', 'Không thể kết nối máy chủ RSS trực tiếp', data.error || 'Đang hiển thị bản tin dự phòng.');
          } else {
            showToast('success', `Đã đồng bộ ${data.items.length} tin mới từ Báo Sức Khỏe & Đời Sống`);
          }
        }
      } else {
        setRssNews([]);
        setRssError(data.error || 'Chưa nhận được dữ liệu từ nguồn RSS.');
      }
    } catch (err: any) {
      setRssError(err?.message || 'Không thể kết nối đến máy chủ bảng tin RSS.');
    } finally {
      setRssLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchRssNews(false);
  }, [fetchRssNews]);

  useEffect(() => {
    setStationPage(1);
    setApiPage(1);
  }, [searchQuery]);

  const sortedAllPosts = sortPostsForDisplay(posts);

  const filteredPosts = sortedAllPosts.filter(
    p =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.summary.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalStationPages = Math.max(1, Math.ceil(filteredPosts.length / POSTS_PAGE_SIZE));
  const safeStationPage = Math.min(stationPage, totalStationPages);
  const paginatedStationPosts = filteredPosts.slice(
    (safeStationPage - 1) * POSTS_PAGE_SIZE,
    safeStationPage * POSTS_PAGE_SIZE
  );

  const filteredApiNews = rssNews.filter(
    n =>
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.summary.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalApiPages = Math.max(1, Math.ceil(filteredApiNews.length / POSTS_PAGE_SIZE));
  const safeApiPage = Math.min(apiPage, totalApiPages);
  const paginatedApiNews = filteredApiNews.slice(
    (safeApiPage - 1) * POSTS_PAGE_SIZE,
    safeApiPage * POSTS_PAGE_SIZE
  );

  const handleDelete = (id: string, postTitle: string) => {
    showConfirm({
      title: 'Xóa bài viết?',
      message: `Bạn có chắc chắn muốn xóa bài viết "${postTitle}" khỏi cổng thông tin?`,
      confirmText: 'Xóa bài',
      cancelText: 'Huỷ',
      isDangerous: true,
      onConfirm: async () => {
        try {
          await deletePost(id);
          await logAuditEvent('Xóa bài viết', 'Tin tức', `Xóa bài: ${postTitle}`, {
            uid: currentUser?.uid || 'admin',
            name: userProfile?.displayName || 'Admin',
          });
          showToast('success', 'Đã xóa bài viết thành công');
        } catch (err: any) {
          showToast('error', 'Không thể xóa bài viết', err?.message);
        }
      },
    });
  };

  const handleBulkDelete = (postsToDelete: Post[]) => {
    if (postsToDelete.length === 0) return;
    showConfirm({
      title: `Xoá hàng loạt ${postsToDelete.length} bài viết?`,
      message: `Bạn có chắc chắn muốn xoá vĩnh viễn ${postsToDelete.length} bài viết đã chọn khỏi cổng thông tin?`,
      confirmText: `Xoá ${postsToDelete.length} bài`,
      cancelText: 'Huỷ',
      isDangerous: true,
      onConfirm: async () => {
        setIsDeletingBulk(true);
        try {
          await deletePostsBatch(postsToDelete.map(p => p.id));
          await logAuditEvent(
            'Xoá hàng loạt bài viết',
            'Tin tức',
            `Xoá ${postsToDelete.length} bài viết`,
            {
              uid: currentUser?.uid || 'admin',
              name: userProfile?.displayName || 'Admin',
            }
          );
          showToast('success', `Đã xoá ${postsToDelete.length} bài viết thành công`);
        } catch (err: any) {
          showToast('error', 'Không thể xoá hàng loạt bài viết', err?.message);
        } finally {
          setIsDeletingBulk(false);
        }
      },
    });
  };

  const handleSaveOrder = async (orderedPosts: Post[], auditDetail?: string) => {
    if (orderedPosts.length === 0) return;
    setIsSavingOrder(true);
    try {
      const updates = orderedPosts.map((post, idx) => ({
        id: post.id,
        sortOrder: idx + 1,
      }));
      await updatePostsSortOrder(updates);
      await logAuditEvent(
        'Sắp xếp thứ tự bài viết',
        'Tin tức',
        auditDetail || `Cập nhật thứ tự hiển thị cho ${updates.length} bài viết`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );
      showToast('success', 'Đã cập nhật thứ tự hiển thị bài viết');
    } catch (err: any) {
      showToast('error', 'Không thể cập nhật thứ tự bài viết', err?.message);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleSaveRichPost = async (postData: Partial<Post>) => {
    try {
      if (editingPost) {
        await updatePost(editingPost.id, {
          title: postData.title || editingPost.title,
          summary: postData.summary || postData.title || editingPost.summary,
          content: postData.content ?? '',
          category: postData.category || editingPost.category,
          embedUrl: postData.embedUrl ?? '',
          embedType: postData.embedType || 'none',
          facebookMeta: postData.facebookMeta ?? null,
          richStyle: postData.richStyle,
          mediaItems: postData.mediaItems || [],
          updatedAt: new Date().toISOString(),
        });

        await logAuditEvent('Chỉnh sửa bài viết', 'Tin tức', `Cập nhật: ${postData.title || editingPost.title}`, {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        });

        showToast('success', 'Đã cập nhật bài viết thành công');
        setEditingPost(null);
      } else {
        const [topSortOrder] = getNextTopSortOrders(posts, 1);
        const nowIso = new Date().toISOString();
        await createPost({
          title: postData.title || 'Bài viết y tế',
          summary: postData.summary || postData.title || '',
          content: postData.content ?? '',
          category: postData.category || 'giao_duc_suc_khoe',
          embedUrl: postData.embedUrl ?? '',
          embedType: postData.embedType || 'none',
          facebookMeta: postData.facebookMeta ?? null,
          status: 'published',
          authorUid: currentUser?.uid || 'admin',
          authorName: userProfile?.displayName || 'Trạm Y tế',
          views: 1,
          publishedAt: nowIso.split('T')[0],
          createdAt: nowIso,
          ...(typeof topSortOrder === 'number' ? { sortOrder: topSortOrder } : {}),
          richStyle: postData.richStyle,
          mediaItems: postData.mediaItems || [],
        });

        await logAuditEvent('Đăng bài viết mới', 'Tin tức', `Tiêu đề: ${postData.title}`, {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        });

        setActiveTab('station');
        setStationPage(1);
        showToast('success', 'Đã xuất bản bài viết đa phương tiện thành công');
      }
      setShowCreateModal(false);
    } catch (err: any) {
      showToast('error', 'Không thể lưu bài viết', err?.message);
    }
  };

  const handleBatchImportFacebookPosts = async (postsToCreate: Array<Partial<Post>>) => {
    const baseTimeMs = Date.now();
    const today = new Date(baseTimeMs).toISOString().split('T')[0];
    const topOrders = getNextTopSortOrders(posts, postsToCreate.length);
    let createdCount = 0;
    let failedCount = 0;

    for (let idx = 0; idx < postsToCreate.length; idx += 1) {
      const postData = postsToCreate[idx];
      const sortOrder = topOrders[idx];
      // Assign slightly staggered timestamps so batch order stays intuitive even without sortOrder
      const itemCreatedAt = new Date(baseTimeMs - idx * 1000).toISOString();
      try {
        await createPost({
          title: postData.title || 'Bài viết truyền thông Facebook',
          summary: postData.summary || postData.title || '',
          content: postData.content ?? '',
          category: postData.category || 'giao_duc_suc_khoe',
          embedUrl: postData.embedUrl ?? '',
          embedType: 'facebook',
          facebookMeta: postData.facebookMeta ?? { kind: 'post', showImage: true, showText: true },
          status: 'published',
          authorUid: currentUser?.uid || 'admin',
          authorName: userProfile?.displayName || 'Trạm Y tế',
          views: 1,
          publishedAt: today,
          createdAt: itemCreatedAt,
          ...(typeof sortOrder === 'number' ? { sortOrder } : {}),
          mediaItems: postData.mediaItems || [],
        });
        createdCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    if (createdCount > 0) {
      await logAuditEvent(
        'Import bài viết Facebook',
        'Tin tức',
        `Import hàng loạt ${createdCount} bài viết Facebook từ Excel`,
        {
          uid: currentUser?.uid || 'admin',
          name: userProfile?.displayName || 'Admin',
        }
      );
      setActiveTab('station');
      setStationPage(1);
    }

    return { createdCount, failedCount };
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <RevealOnScroll immediate>
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Bảng Tin Sức Khỏe</span>
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Tin y tế Sức Khỏe &amp; Đời Sống và thông tin từ Trạm Y tế.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 shrink-0">
            {activeTab === 'api' && (
              <button
                type="button"
                onClick={() => fetchRssNews(true)}
                disabled={rssLoading}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 hover:text-emerald-700 rounded-xl text-sm font-semibold transition flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <RotateCw className={`w-4 h-4 shrink-0 ${rssLoading ? 'animate-spin text-emerald-600' : ''}`} />
                <span>Làm mới</span>
              </button>
            )}

            {(isAdmin || isStaff) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('station');
                    setStationViewMode(prev => (prev === 'table' ? 'cards' : 'table'));
                  }}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap border ${
                    activeTab === 'station' && stationViewMode === 'table'
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Table2 className="w-4 h-4 shrink-0" />
                  <span>Quản lý bài viết</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowFacebookImportModal(true)}
                  className="px-3.5 py-2 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-xl text-sm font-semibold transition flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  <span>Import Excel FB</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditingPost(null);
                    setShowCreateModal(true);
                  }}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold shadow-sm transition flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 shrink-0" /> Soạn bài
                </button>
              </>
            )}
          </div>
        </div>
      </RevealOnScroll>

      {/* Stream Tabs: RSS Health Bulletin vs Station Posts */}
      <RevealOnScroll title={activeTab === 'api' ? 'Tin tức y tế trực tuyến' : 'Tin Trạm Y tế đăng tải'}>
        <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="grid grid-cols-2 sm:flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('api')}
              className={`px-3.5 py-2 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'api'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Globe className="w-4 h-4 shrink-0" />
              <span>Báo Y tế ({rssNews.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('station')}
              className={`px-3.5 py-2 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                activeTab === 'station'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              <span>Tin Trạm ({posts.length})</span>
            </button>
          </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
          {activeTab === 'station' && (isAdmin || isStaff) && (
            <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStationViewMode('cards')}
                className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                  stationViewMode === 'cards'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Dạng thẻ</span>
              </button>
              <button
                type="button"
                onClick={() => setStationViewMode('table')}
                className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                  stationViewMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Quản lý bảng</span>
              </button>
            </div>
          )}

          {/* Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Tìm tin bài y tế..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-xs"
            />
          </div>
        </div>
      </div>

      {/* STREAM 1: Station Internal Posts */}
      {activeTab === 'station' && (
        loading ? (
          <CardSkeleton count={6} />
        ) : (isAdmin || isStaff) && stationViewMode === 'table' ? (
          <PostManagementTable
            posts={posts}
            searchQuery={searchQuery}
            onViewPost={openStationPost}
            onEditPost={post => {
              setEditingPost(post);
              setShowCreateModal(true);
            }}
            onDeleteSingle={post => handleDelete(post.id, post.title)}
            onBulkDelete={handleBulkDelete}
            onSaveOrder={handleSaveOrder}
            isSavingOrder={isSavingOrder}
            isDeletingBulk={isDeletingBulk}
          />
        ) : filteredPosts.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-400 space-y-3">
            <Inbox className="w-10 h-10 mx-auto text-slate-300" />
            <p>Chưa có bài viết nội bộ nào từ Trạm Y tế.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {paginatedStationPosts.map(post => {
              const ytId = post.embedUrl && post.embedType === 'youtube' ? getYouTubeEmbedId(post.embedUrl) : null;
              const coverMedia = post.mediaItems?.find(m => m.type !== 'video' && m.url);
              const coverImageSrc = coverMedia ? GitHubService.toRawGitHubUrl(coverMedia.url) : '';

              const cardSummary =
                post.summary && post.summary.trim() !== post.title.trim()
                  ? post.summary.trim()
                  : post.content?.trim() || 'Nhấn xem toàn văn để theo dõi nội dung chi tiết bài viết.';

              return (
                <div
                  key={post.id}
                  className="h-full p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-emerald-500/60 transition flex flex-col justify-between gap-4 group"
                >
                  <div className="space-y-3 flex-1 flex flex-col">
                    <div className="w-full h-60 rounded-2xl overflow-hidden shrink-0">
                      {ytId ? (
                        <div className="w-full h-full bg-black shadow-xs relative">
                          <iframe
                            src={`https://www.youtube.com/embed/${ytId}`}
                            title={post.title}
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
                      ) : coverImageSrc ? (
                        <div
                          onClick={() => openStationPost(post)}
                          className="w-full h-full bg-slate-100 dark:bg-slate-800 cursor-pointer relative"
                        >
                          <img
                            src={coverImageSrc}
                            alt={coverMedia?.caption || post.title}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        </div>
                      ) : (
                        <div
                          onClick={() => openStationPost(post)}
                          className="w-full h-full bg-gradient-to-br from-emerald-50 via-teal-50 to-slate-100 dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-800 border border-emerald-100/80 dark:border-slate-800 cursor-pointer flex flex-col items-center justify-center gap-2 p-4 text-center"
                        >
                          <div className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 shadow-xs flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                            <Newspaper className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 line-clamp-2 max-w-[200px]">
                            Bản tin truyền thông Trạm Y tế
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 h-5">
                      <span className="font-mono flex items-center gap-1 tabular-nums truncate">
                        <Calendar className="w-3 h-3 shrink-0" /> {post.publishedAt}
                        <span className="mx-1">·</span>
                        <Eye className="w-3 h-3 shrink-0" /> {post.views || 0}
                      </span>
                      <span className="font-medium text-emerald-700 dark:text-emerald-400 truncate max-w-[120px]">
                        {post.authorName}
                      </span>
                    </div>

                    <h3
                      onClick={() => openStationPost(post)}
                      className="font-bold text-sm text-slate-900 dark:text-white leading-snug line-clamp-2 min-h-[2.45rem] cursor-pointer group-hover:text-emerald-600 transition"
                    >
                      {post.title}
                    </h3>

                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2 min-h-[2.4rem]">
                      {cardSummary}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => openStationPost(post)}
                      className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>Xem toàn văn</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>

                    {(isAdmin || isStaff) && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPost(post);
                            setShowCreateModal(true);
                          }}
                          className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition flex items-center gap-1 cursor-pointer"
                          title="Chỉnh sửa bài viết"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Sửa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(post.id, post.title)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                          title="Xóa bài"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>

            <PaginationBar
              currentPage={safeStationPage}
              totalItems={filteredPosts.length}
              pageSize={POSTS_PAGE_SIZE}
              onPageChange={setStationPage}
            />
          </div>
        )
      )}

      {/* STREAM 2: Live RSS Health News Bulletin (suckhoedoisong.vn/y-te.rss) */}
      {activeTab === 'api' && (
        <div className="space-y-5">
          {/* Source Attribution Banner */}
          <div className="hidden px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Rss className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    Báo Sức Khỏe & Đời Sống
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Cơ quan ngôn luận Bộ Y tế
                  </span>
                  {isRssFallback ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                      Bản tin dự phòng
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Thành công
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                  Nguồn <code className="font-mono text-emerald-600 dark:text-emerald-400">https://suckhoedoisong.vn/y-te.rss</code>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {rssLastBuild && (
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Cập nhật: {rssLastBuild}
                </span>
              )}
              <button
                type="button"
                onClick={() => fetchRssNews(true)}
                disabled={rssLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <RotateCw className={`w-3.5 h-3.5 ${rssLoading ? 'animate-spin text-emerald-600' : ''}`} />
                {rssLoading ? 'Đang tải...' : 'Làm mới'}
              </button>
            </div>
          </div>

          {rssError && isRssFallback && (
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
              <span className="font-bold shrink-0">Lưu ý kết nối:</span>
              <span>{rssError} (Hệ thống tự động kích hoạt bộ tin tức dự phòng y tế để người dân vẫn theo dõi được khuyến cáo).</span>
            </div>
          )}

          {rssLoading && rssNews.length === 0 ? (
            <CardSkeleton count={6} />
          ) : rssError && rssNews.length === 0 ? (
            <div className="p-10 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <Globe className="w-10 h-10 mx-auto text-slate-300" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Không thể tải bảng tin trực tuyến lúc này
                </p>
                <p className="text-xs text-slate-500">{rssError}</p>
              </div>
              <button
                type="button"
                onClick={() => fetchRssNews(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" /> Thử tải lại
              </button>
            </div>
          ) : filteredApiNews.length === 0 ? (
            <div className="p-10 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-400 space-y-2">
              <Inbox className="w-10 h-10 mx-auto text-slate-300" />
              <p>Không tìm thấy tin y tế nào phù hợp với từ khóa tìm kiếm.</p>
            </div>
          ) : (
            (() => {
              const itemsWithImages = paginatedApiNews.filter(
                item => Boolean(item.imageUrl) && !brokenImages[item.id]
              );
              const itemsWithoutImages = paginatedApiNews.filter(
                item => !item.imageUrl || brokenImages[item.id]
              );

              return (
                <div className="space-y-6">
                  {/* Cards for RSS articles with images */}
                  {itemsWithImages.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {itemsWithImages.map(item => (
                        <article
                          key={item.id}
                          className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between group hover:border-emerald-500/60 transition"
                        >
                          <div className="space-y-3 p-4">
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block h-48 rounded-2xl overflow-hidden relative bg-slate-100 dark:bg-slate-800"
                            >
                              <img
                                src={item.imageUrl}
                                alt={item.title}
                                loading="lazy"
                                onError={() =>
                                  setBrokenImages(prev => ({ ...prev, [item.id]: true }))
                                }
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                            </a>

                            <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                              <span>{item.publishedDisplay || item.publishedAt}</span>
                              <span className="text-emerald-600 font-semibold truncate max-w-[150px]">
                                {item.sourceName}
                              </span>
                            </div>

                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <h3 className="font-bold text-base text-slate-900 dark:text-white leading-snug line-clamp-2 min-h-[2.75rem] group-hover:text-emerald-600 transition">
                                {item.title}
                              </h3>
                            </a>

                            <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-3 min-h-[3.9rem] leading-relaxed">
                              {item.summary || item.title}
                            </p>
                          </div>

                          <div className="p-4 pt-0">
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                            >
                              <span>Xem chi tiết từ nguồn</span>
                              <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  {/* List layout for articles without images */}
                  {itemsWithoutImages.length > 0 && (
                    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-sm">
                      {itemsWithoutImages.map(item => (
                        <a
                          key={item.id}
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
                        >
                          <div className="space-y-1.5 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono">
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-sans font-semibold text-[10px]">
                                {item.sourceName}
                              </span>
                              <span>{item.publishedDisplay || item.publishedAt}</span>
                            </div>
                            <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-emerald-600 transition">
                              {item.title}
                            </h3>
                            {item.summary && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                {item.summary}
                              </p>
                            )}
                          </div>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 shrink-0">
                            Xem chi tiết <ExternalLink className="w-3.5 h-3.5" />
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                  <PaginationBar
                    currentPage={safeApiPage}
                    totalItems={filteredApiNews.length}
                    pageSize={POSTS_PAGE_SIZE}
                    onPageChange={setApiPage}
                  />
                </div>
              );
            })()
          )}
        </div>
      )}
        </div>
      </RevealOnScroll>

      {/* Reading Post Modal */}
      {readingPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 sm:p-8 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{readingPost.publishedAt}</span>
                  <span>•</span>
                  <span className="text-emerald-600 font-semibold">{readingPost.authorName}</span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-snug">
                  {readingPost.title}
                </h2>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {(isAdmin || isStaff) && (
                  <button
                    type="button"
                    onClick={() => {
                      const postToEdit = readingPost;
                      setReadingPost(null);
                      setEditingPost(postToEdit);
                      setShowCreateModal(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Chỉnh sửa</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReadingPost(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
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
              <div
                className={`leading-relaxed whitespace-pre-wrap space-y-3 pt-2 ${
                  readingPost.richStyle?.fontFamily || readingPost.fontFamily || 'font-sans'
                } ${readingPost.richStyle?.fontSize || readingPost.fontSize || 'text-sm'}`}
                style={{
                  color: readingPost.richStyle?.textColor || readingPost.textColor,
                  textAlign: (readingPost.richStyle?.alignment as any) || 'left',
                }}
              >
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
                    <div
                      key={media.id || idx}
                      className={`flex flex-col ${
                        media.align === 'center'
                          ? 'items-center'
                          : media.align === 'right'
                          ? 'items-end'
                          : 'items-start'
                      }`}
                    >
                      {media.type === 'video' ? (
                        <video
                          src={mediaSrc}
                          controls
                          style={{ width: `${media.widthPercent || 100}%` }}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 max-h-[540px] bg-black"
                        />
                      ) : (
                        <img
                          src={mediaSrc}
                          alt={media.caption || readingPost.title}
                          referrerPolicy="no-referrer"
                          style={{ width: `${media.widthPercent || 100}%` }}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 max-h-[540px] object-contain"
                        />
                      )}
                      {media.caption && (
                        <span className="text-[11px] text-slate-400 italic mt-1">{media.caption}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Production Rich Post Editor Modal */}
      <RichPostEditorModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingPost(null);
        }}
        onSave={handleSaveRichPost}
        initialPost={editingPost || undefined}
        githubConfig={settings?.githubConfig}
        uploaderName={userProfile?.displayName || 'Cán bộ Y tế'}
      />

      {/* Batch Excel Import Modal for Facebook Posts */}
      <FacebookPostsImportModal
        isOpen={showFacebookImportModal}
        onClose={() => setShowFacebookImportModal(false)}
        existingPosts={posts}
        onImportPosts={handleBatchImportFacebookPosts}
      />
    </div>
  );
};
