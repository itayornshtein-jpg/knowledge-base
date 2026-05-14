import React, { useState, useMemo, useEffect, useCallback } from 'react';
import ArticleCard from './ArticleCard';
import SkeletonCard from './SkeletonCard';
import { useDebounce } from '../hooks/useDebounce';

const PAGE_SIZE = 20;

function buildSearchableText(entry, activeEntryMap) {
  const relatedSummaries = entry.related_page_ids
    .map((id) => activeEntryMap[id]?.summary || '')
    .join(' ');

  return [
    entry.summary,
    entry.sf_case,
    entry.description,
    entry.solution,
    entry.jira_link,
    relatedSummaries,
    entry.images.length ? 'has pictures' : '',
  ]
    .join(' ')
    .toLowerCase();
}

function ArticleList({
  entries,
  isLoading,
  errorMessage,
  activeFilter,
  activeCategoryId,
  searchQuery,
  onViewDetail,
  onEdit,
  onArchive,
  onRestore,
}) {
  const [sortOrder, setSortOrder] = useState('newest');
  const [page, setPage] = useState(1);

  const debouncedQuery = useDebounce(searchQuery, 300);

  const activeEntryMap = useMemo(
    () =>
      entries.reduce((m, e) => {
        if (!e.deleted_at) m[e.id] = e;
        return m;
      }, {}),
    [entries]
  );

  const visibleEntries = useMemo(() => {
    let result = entries.filter((e) => {
      if (activeFilter === 'active') return !e.deleted_at;
      if (activeFilter === 'archived') return Boolean(e.deleted_at);
      return true;
    });

    if (activeCategoryId) {
      result = result.filter((e) => e.category_id === activeCategoryId);
    }

    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter((e) => buildSearchableText(e, activeEntryMap).includes(q));
    }

    if (sortOrder === 'newest') return [...result].reverse();
    if (sortOrder === 'references')
      return [...result].sort((a, b) => b.related_page_ids.length - a.related_page_ids.length);
    return result;
  }, [entries, activeFilter, activeCategoryId, debouncedQuery, sortOrder, activeEntryMap]);

  useEffect(() => {
    setPage(1);
  }, [activeFilter, activeCategoryId, debouncedQuery, sortOrder]);

  const pageCount = Math.ceil(visibleEntries.length / PAGE_SIZE);
  const pageEntries = visibleEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handlePrev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const handleNext = useCallback(() => setPage((p) => Math.min(pageCount, p + 1)), [pageCount]);

  return (
    <section className="library">
      <div className="library-toolbar card">
        <div className="toolbar-row">
          <div className="toolbar-meta">
            <p className="eyebrow">Knowledge Library</p>
            <span className="helper-text">
              {isLoading ? 'Loading…' : `${visibleEntries.length} page${visibleEntries.length !== 1 ? 's' : ''} found`}
            </span>
          </div>
          <select
            className="sort-select"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            aria-label="Sort order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="references">Most references</option>
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
        ) : visibleEntries.length === 0 ? (
          <div className="empty-state card">
            <h3>No pages match this view</h3>
            <p>Try a broader search term or switch the view filter to reveal more pages.</p>
          </div>
        ) : (
          pageEntries.map((entry) => (
            <ArticleCard
              key={entry.id}
              entry={entry}
              searchQuery={debouncedQuery}
              onView={onViewDetail}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
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
            disabled={page === 1}
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
            disabled={page === pageCount}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

export default ArticleList;
