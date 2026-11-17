import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  Trash2,
  Edit3,
  Eye,
  GripVertical,
  CheckSquare,
  Square,
  MinusSquare,
  Link2,
  FileText,
  Youtube,
  Share2,
  ArrowUpDown,
  Save,
  Calendar,
  Pin,
  Inbox,
} from 'lucide-react';
import { PaginationBar } from '../common/PaginationBar';
import { Post } from '../../types';
import {
  PostEmbedFilter,
  PostTableSortKey,
  POST_CATEGORY_LABELS,
  getPostFormatInfo,
  getPostTimestampKey,
  sortPostsForDisplay,
} from '../../utils/postSorting';

interface PostManagementTableProps {
  posts: Post[];
  searchQuery: string;
  onViewPost: (post: Post) => void;
  onEditPost: (post: Post) => void;
  onDeleteSingle: (post: Post) => void;
  onBulkDelete: (posts: Post[]) => Promise<void> | void;
  onSaveOrder: (orderedPosts: Post[], auditDetail?: string) => Promise<void>;
  isSavingOrder?: boolean;
  isDeletingBulk?: boolean;
}

const TABLE_PAGE_SIZE = 10;

export const PostManagementTable: React.FC<PostManagementTableProps> = ({
  posts,
  searchQuery,
  onViewPost,
  onEditPost,
  onDeleteSingle,
  onBulkDelete,
  onSaveOrder,
  isSavingOrder = false,
  isDeletingBulk = false,
}) => {
  const [embedFilter, setEmbedFilter] = useState<PostEmbedFilter>('all');
  const [sortKey, setSortKey] = useState<PostTableSortKey>('custom');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Canonical display order of all posts
  const canonicalOrderedPosts = useMemo(() => sortPostsForDisplay(posts), [posts]);

  // Remove stale selected IDs if posts were deleted
  useEffect(() => {
    const validSet = new Set(posts.map(p => p.id));
    setSelectedIds(prev => prev.filter(id => validSet.has(id)));
  }, [posts]);

  // Reset page when search, filter, or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, embedFilter, sortKey]);

  const formatCounts = useMemo(() => {
    let embedded = 0;
    let facebook = 0;
    let youtube = 0;
    let standard = 0;

    for (const p of posts) {
      const info = getPostFormatInfo(p);
      if (info.hasEmbed) {
        embedded += 1;
        if (info.embedType === 'facebook') facebook += 1;
        else if (info.embedType === 'youtube') youtube += 1;
      } else {
        standard += 1;
      }
    }

    return {
      all: posts.length,
      embedded,
      facebook,
      youtube,
      standard,
    };
  }, [posts]);

  const filteredAndSortedPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = canonicalOrderedPosts.filter(post => {
      if (q) {
        const matchesQuery =
          post.title.toLowerCase().includes(q) ||
          (post.summary || '').toLowerCase().includes(q) ||
          (post.authorName || '').toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }

      const info = getPostFormatInfo(post);
      if (embedFilter === 'embedded') return info.hasEmbed;
      if (embedFilter === 'facebook') return info.embedType === 'facebook';
      if (embedFilter === 'youtube') return info.embedType === 'youtube';
      if (embedFilter === 'standard') return !info.hasEmbed;
      return true;
    });

    if (sortKey === 'custom') {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      if (sortKey === 'newest') {
        return getPostTimestampKey(b).localeCompare(getPostTimestampKey(a));
      }
      if (sortKey === 'oldest') {
        return getPostTimestampKey(a).localeCompare(getPostTimestampKey(b));
      }
      if (sortKey === 'title_asc') {
        return a.title.localeCompare(b.title, 'vi');
      }
      if (sortKey === 'title_desc') {
        return b.title.localeCompare(a.title, 'vi');
      }
      if (sortKey === 'views_desc') {
        return (b.views || 0) - (a.views || 0);
      }
      return 0;
    });
  }, [canonicalOrderedPosts, searchQuery, embedFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedPosts.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * TABLE_PAGE_SIZE;
    return filteredAndSortedPosts.slice(start, start + TABLE_PAGE_SIZE);
  }, [filteredAndSortedPosts, safePage]);

  const pageRowIds = useMemo(() => paginatedRows.map(p => p.id), [paginatedRows]);
  const selectedOnPageCount = pageRowIds.filter(id => selectedIds.includes(id)).length;
  const allOnPageSelected = pageRowIds.length > 0 && selectedOnPageCount === pageRowIds.length;
  const someOnPageSelected = selectedOnPageCount > 0 && !allOnPageSelected;

  const toggleSelectPage = () => {
    if (allOnPageSelected) {
      const pageSet = new Set(pageRowIds);
      setSelectedIds(prev => prev.filter(id => !pageSet.has(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageRowIds])));
    }
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredAndSortedPosts.map(p => p.id);
    const allFilteredSelected =
      filteredIds.length > 0 && filteredIds.every(id => selectedIds.includes(id));

    if (allFilteredSelected) {
      const filteredSet = new Set(filteredIds);
      setSelectedIds(prev => prev.filter(id => !filteredSet.has(id)));
    } else {
      setSelectedIds(Array.from(new Set([...selectedIds, ...filteredIds])));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleMoveRelative = async (postId: string, direction: 'up' | 'down' | 'top') => {
    if (isSavingOrder) return;
    const list = [...canonicalOrderedPosts];
    const currentIdx = list.findIndex(p => p.id === postId);
    if (currentIdx === -1) return;

    let targetIdx = currentIdx;
    if (direction === 'top') {
      targetIdx = 0;
    } else if (direction === 'up') {
      // Find previous item in filteredAndSortedPosts if possible for natural visual jump
      const visibleIdx = filteredAndSortedPosts.findIndex(p => p.id === postId);
      if (visibleIdx <= 0) return;
      const prevVisibleId = filteredAndSortedPosts[visibleIdx - 1].id;
      targetIdx = list.findIndex(p => p.id === prevVisibleId);
    } else if (direction === 'down') {
      const visibleIdx = filteredAndSortedPosts.findIndex(p => p.id === postId);
      if (visibleIdx === -1 || visibleIdx >= filteredAndSortedPosts.length - 1) return;
      const nextVisibleId = filteredAndSortedPosts[visibleIdx + 1].id;
      targetIdx = list.findIndex(p => p.id === nextVisibleId);
    }

    if (targetIdx === currentIdx || targetIdx < 0 || targetIdx >= list.length) return;

    const [moved] = list.splice(currentIdx, 1);
    list.splice(targetIdx, 0, moved);

    const actionLabel =
      direction === 'top'
        ? `Đưa bài "${moved.title}" lên đầu danh sách`
        : `Di chuyển thứ tự bài "${moved.title}"`;
    await onSaveOrder(list, actionLabel);
  };

  const handleDropReorder = async (targetPostId: string) => {
    if (!draggedId || draggedId === targetPostId || isSavingOrder || sortKey !== 'custom') {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const list = [...canonicalOrderedPosts];
    const fromIdx = list.findIndex(p => p.id === draggedId);
    const toIdx = list.findIndex(p => p.id === targetPostId);

    setDraggedId(null);
    setDragOverId(null);

    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);

    await onSaveOrder(list, `Kéo thả sắp xếp bài "${moved.title}"`);
  };

  const handleApplyCurrentSortAsDisplayOrder = async () => {
    if (isSavingOrder || sortKey === 'custom') return;

    // Sort the entire canonical collection using the selected sortKey so nothing is left out
    const fullSorted = [...canonicalOrderedPosts].sort((a, b) => {
      if (sortKey === 'newest') {
        return getPostTimestampKey(b).localeCompare(getPostTimestampKey(a));
      }
      if (sortKey === 'oldest') {
        return getPostTimestampKey(a).localeCompare(getPostTimestampKey(b));
      }
      if (sortKey === 'title_asc') {
        return a.title.localeCompare(b.title, 'vi');
      }
      if (sortKey === 'title_desc') {
        return b.title.localeCompare(a.title, 'vi');
      }
      if (sortKey === 'views_desc') {
        return (b.views || 0) - (a.views || 0);
      }
      return 0;
    });

    await onSaveOrder(fullSorted, `Áp dụng sắp xếp (${sortKey}) làm thứ tự hiển thị`);
    setSortKey('custom');
  };

  const selectedPosts = useMemo(
    () => posts.filter(p => selectedIds.includes(p.id)),
    [posts, selectedIds]
  );

  const canReorderManually = sortKey === 'custom';

  return (
    <div className="space-y-4">
      {/* Filter & Sort Control Bar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Post Format Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'Tất cả', count: formatCounts.all },
                { id: 'embedded', label: 'Có nhúng', count: formatCounts.embedded },
                { id: 'facebook', label: 'Nhúng Facebook', count: formatCounts.facebook },
                { id: 'youtube', label: 'Nhúng YouTube', count: formatCounts.youtube },
                { id: 'standard', label: 'Không nhúng', count: formatCounts.standard },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEmbedFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  embedFilter === tab.id
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                    embedFilter === tab.id
                      ? 'bg-white/20 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Sort Mode Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <ArrowUpDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="font-semibold">Sắp xếp:</span>
            </div>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as PostTableSortKey)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              <option value="custom">Thứ tự hiển thị (Kéo / Lên-Xuống)</option>
              <option value="newest">Mới nhất trước</option>
              <option value="oldest">Cũ nhất trước</option>
              <option value="title_asc">Tên bài (A → Z)</option>
              <option value="title_desc">Tên bài (Z → A)</option>
              <option value="views_desc">Lượt xem cao nhất</option>
            </select>

            {sortKey !== 'custom' && (
              <button
                type="button"
                disabled={isSavingOrder}
                onClick={handleApplyCurrentSortAsDisplayOrder}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Lưu thứ tự đang sắp xếp làm thứ tự hiển thị chính thức trên cổng thông tin"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingOrder ? 'Đang lưu...' : 'Lưu làm thứ tự hiển thị'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.length > 0 && (
          <div className="p-3 rounded-xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-bold text-rose-800 dark:text-rose-200">
                Đã chọn {selectedIds.length} bài viết
              </span>
              {filteredAndSortedPosts.length > paginatedRows.length && (
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  className="text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
                >
                  {filteredAndSortedPosts.every(p => selectedIds.includes(p.id))
                    ? `Bỏ chọn tất cả (${filteredAndSortedPosts.length})`
                    : `Chọn tất cả ${filteredAndSortedPosts.length} bài đang lọc`}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
              >
                Bỏ chọn
              </button>
              <button
                type="button"
                disabled={isDeletingBulk}
                onClick={async () => {
                  await onBulkDelete(selectedPosts);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isDeletingBulk
                    ? 'Đang xoá...'
                    : `Xoá hàng loạt (${selectedIds.length})`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {filteredAndSortedPosts.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 space-y-2.5">
            <Inbox className="w-10 h-10 mx-auto text-slate-300" />
            <p>Không có bài viết nào phù hợp với bộ lọc hiện tại.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-3.5 pl-4 pr-2 w-10">
                    <button
                      type="button"
                      onClick={toggleSelectPage}
                      className="p-1 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                      title="Chọn / Bỏ chọn tất cả bài trên trang này"
                    >
                      {allOnPageSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600" />
                      ) : someOnPageSelected ? (
                        <MinusSquare className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-3.5 px-3 w-36">Thứ tự</th>
                  <th className="py-3.5 px-3 min-w-[260px]">Tên bài viết</th>
                  <th className="py-3.5 px-3 w-56">Dạng đăng</th>
                  <th className="py-3.5 px-3 w-32 hidden md:table-cell">Ngày / Xem</th>
                  <th className="py-3.5 pl-3 pr-4 w-36 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {paginatedRows.map((post, idxOnPage) => {
                  const isSelected = selectedIds.includes(post.id);
                  const formatInfo = getPostFormatInfo(post);
                  const displayIndex = (safePage - 1) * TABLE_PAGE_SIZE + idxOnPage + 1;
                  const globalFilteredIdx = (safePage - 1) * TABLE_PAGE_SIZE + idxOnPage;
                  const isFirstVisible = globalFilteredIdx === 0;
                  const isLastVisible = globalFilteredIdx === filteredAndSortedPosts.length - 1;
                  const isDragged = draggedId === post.id;
                  const isDragOver = dragOverId === post.id && draggedId !== post.id;

                  return (
                    <tr
                      key={post.id}
                      draggable={canReorderManually && !isSavingOrder}
                      onDragStart={() => setDraggedId(post.id)}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDragOverId(null);
                      }}
                      onDragOver={e => {
                        if (!canReorderManually) return;
                        e.preventDefault();
                        if (dragOverId !== post.id) setDragOverId(post.id);
                      }}
                      onDrop={e => {
                        if (!canReorderManually) return;
                        e.preventDefault();
                        void handleDropReorder(post.id);
                      }}
                      className={`transition ${
                        isSelected
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      } ${isDragged ? 'opacity-50' : ''} ${
                        isDragOver ? 'ring-2 ring-inset ring-emerald-500' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 pl-4 pr-2 align-middle">
                        <button
                          type="button"
                          onClick={() => toggleRow(post.id)}
                          className="p-1 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                          title={isSelected ? 'Bỏ chọn bài này' : 'Chọn bài này'}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Sort Order Controls */}
                      <td className="py-3 px-3 align-middle">
                        <div className="flex items-center gap-1">
                          {canReorderManually && (
                            <span
                              className="p-1 text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing"
                              title="Kéo thả để sắp xếp"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <span className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono font-bold text-[11px] text-slate-700 dark:text-slate-200">
                            {displayIndex}
                          </span>
                          {canReorderManually && (
                            <div className="flex items-center gap-0.5 ml-1">
                              <button
                                type="button"
                                disabled={isFirstVisible || isSavingOrder}
                                onClick={() => handleMoveRelative(post.id, 'up')}
                                className="p-1 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title="Di chuyển lên"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isLastVisible || isSavingOrder}
                                onClick={() => handleMoveRelative(post.id, 'down')}
                                className="p-1 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title="Di chuyển xuống"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isFirstVisible || isSavingOrder}
                                onClick={() => handleMoveRelative(post.id, 'top')}
                                className="p-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title="Đưa lên đầu danh sách"
                              >
                                <ChevronsUp className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Title & Meta */}
                      <td className="py-3 px-3 align-middle">
                        <div className="space-y-1 max-w-md">
                          <button
                            type="button"
                            onClick={() => onViewPost(post)}
                            className="font-bold text-slate-900 dark:text-white hover:text-emerald-600 text-left line-clamp-2 leading-snug cursor-pointer"
                          >
                            {post.title}
                          </button>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            {post.isPinned && (
                              <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-semibold">
                                <Pin className="w-3 h-3" /> Ghim
                              </span>
                            )}
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                              {POST_CATEGORY_LABELS[post.category] || 'Tin tức Y tế'}
                            </span>
                            <span>•</span>
                            <span className="truncate max-w-[140px]">{post.authorName}</span>
                          </div>
                        </div>
                      </td>

                      {/* Publish Format (Has Embed or Not) */}
                      <td className="py-3 px-3 align-middle">
                        <div className="space-y-1">
                          {formatInfo.embedType === 'facebook' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-semibold text-[11px]">
                              <Share2 className="w-3 h-3 shrink-0" />
                              <span>{formatInfo.label}</span>
                            </span>
                          ) : formatInfo.embedType === 'youtube' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold text-[11px]">
                              <Youtube className="w-3.5 h-3.5 shrink-0" />
                              <span>{formatInfo.label}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                              <FileText className="w-3 h-3 shrink-0" />
                              <span>{formatInfo.label}</span>
                            </span>
                          )}
                          {formatInfo.hasEmbed && post.embedUrl && (
                            <a
                              href={post.embedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-600 truncate max-w-[220px]"
                              title={post.embedUrl}
                            >
                              <Link2 className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{post.embedUrl}</span>
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Published Date & Views */}
                      <td className="py-3 px-3 align-middle hidden md:table-cell text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 shrink-0 text-slate-400" />
                          <span>{post.publishedAt}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Eye className="w-3 h-3 shrink-0 text-slate-400" />
                          <span>{post.views || 0} lượt xem</span>
                        </div>
                      </td>

                      {/* Row Actions: View, Edit, Single Delete */}
                      <td className="py-3 pl-3 pr-4 align-middle text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onViewPost(post)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition cursor-pointer"
                            title="Xem bài viết"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditPost(post)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition cursor-pointer"
                            title="Chỉnh sửa bài viết"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSingle(post)}
                            className="px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold transition inline-flex items-center gap-1 cursor-pointer"
                            title="Xoá lẻ bài viết này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Xoá</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Table Footer Pagination (10 bài/trang) */}
      <PaginationBar
        currentPage={safePage}
        totalItems={filteredAndSortedPosts.length}
        pageSize={TABLE_PAGE_SIZE}
        onPageChange={setCurrentPage}
      />
    </div>
  );
};
