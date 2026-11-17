import React from 'react';

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm animate-pulse flex flex-col gap-3"
        >
          <div className="w-12 h-12 rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded-md w-3/4 mt-1" />
          <div className="space-y-2 mt-2">
            <div className="h-3.5 bg-slate-100 dark:bg-slate-800/60 rounded w-full" />
            <div className="h-3.5 bg-slate-100 dark:bg-slate-800/60 rounded w-5/6" />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-20" />
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-16" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-pulse">
      <div className="h-12 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/60 px-4 flex items-center gap-4">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/6" />
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="p-4 flex items-center gap-4">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
            <div className="h-4 bg-slate-100 dark:bg-slate-800/60 rounded w-1/4" />
            <div className="h-4 bg-slate-100 dark:bg-slate-800/60 rounded w-1/4" />
            <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-full w-16 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
};

export const BannerSkeleton: React.FC = () => {
  return (
    <div className="w-full p-8 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 animate-pulse border border-slate-200 dark:border-slate-800 mb-8 flex flex-col md:flex-row items-center gap-6">
      <div className="w-20 h-20 rounded-2xl bg-slate-300 dark:bg-slate-700 shrink-0" />
      <div className="flex-1 w-full space-y-3">
        <div className="h-4 bg-slate-300 dark:bg-slate-700 rounded w-1/3" />
        <div className="h-8 bg-slate-300 dark:bg-slate-700 rounded w-2/3" />
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2" />
      </div>
    </div>
  );
};
