import React, { useCallback } from 'react';
import ArticleCard from './ArticleCard';
import SkeletonCard from './SkeletonCard';

function ArticleList({
  entries,
  total,
  page,
  pageSize,
  sortOrder,
  onSortChange,
  onPageChange,
  isLoading,
  errorMessage,
  searchQuery,
  onViewDetail,
  onEdit,
  onArchive,
  onRestore,
  onToggleStar,
}) {
  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));

  const handlePrev = useCallback(
    () => onPageChange((p) => Math.max(1, p - 1)),
    [onPageChange]
  );
  const handleNext = useCallback(
    () => onPageChange((p) => Math.min(pageCount, p + 1)),
    [onPageChange, pageCount]
  );

  return (
    <section className="library">
      <div className="library-toolbar card">
        <div className="toolbar-row">
          <div className="toolbar-meta">
            <p className="eyebrow">Knowledge Library</p>
            <span className="helper-text">
              {isLoading
                ? 'Loading…'
                : `${total} page${total !== 1 ? 's' : ''} found`}
            </span>
          </div>
          <select
            className="sort-select"
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Sort order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="references">Most references</option>
            <option value="popularity">Most viewed</option>
          </select>
        </div>
      </div>

      {errorMessage && <div className="feedback-banner">{errorMessage}</div>}

      <div className="entries-list">
        {isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : entries.length === 0 ? (
          <div className="empty-state card">
            <h3>No pages match this view</h3>
            <p>Try a broader search term or switch the view filter to reveal more pages.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <ArticleCard
              key={entry.id}
              entry={entry}
              searchQuery={searchQuery}
              onView={onViewDetail}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
              onToggleStar={onToggleStar}
            />
          ))
        )}
      </div>

      {pageCount > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="btn-secondary"
            onClick={handlePrev}
            disabled={page === 1 || isLoading}
          >
            ← Prev
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleNext}
            disabled={page === pageCount || isLoading}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

export default ArticleList;
