import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

import { useEntries } from './hooks/useEntries';
import { useCategories } from './hooks/useCategories';
import { useDebounce } from './hooks/useDebounce';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ArticleList from './components/ArticleList';
import ArticleDetail from './components/ArticleDetail';
import AssistantPanel from './components/AssistantPanel';
import ComposerModal from './components/ComposerModal';
import CategoryModal from './components/CategoryModal';
import ToastContainer from './components/Toast';

const PAGE_SIZE = 20;

function App() {
  const { categories, createCategory, deleteCategory } = useCategories();

  const [activeFilter, setActiveFilter] = useState('active');
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [page, setPage] = useState(1);

  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Reset to page 1 whenever a filter changes
  useEffect(() => {
    setPage(1);
  }, [activeFilter, activeCategoryId, starredOnly, debouncedSearch, sortOrder]);

  const queryParams = useMemo(
    () => ({
      view: activeFilter,
      search: debouncedSearch,
      categoryId: activeCategoryId,
      starred: starredOnly ? true : undefined,
      sort: sortOrder,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [activeFilter, debouncedSearch, activeCategoryId, starredOnly, sortOrder, page]
  );

  const {
    entries,
    total,
    stats,
    isLoading,
    errorMessage,
    saveEntry,
    archiveEntry,
    restoreEntry,
    toggleStar,
  } = useEntries(queryParams);

  // Hash-based navigation so articles are linkable
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.replace('#article-', '');
      setSelectedEntryId(hash || null);
    };
    window.addEventListener('popstate', sync);
    sync();
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const handleNewPage = useCallback(() => {
    setEditingEntry(null);
    setIsComposerOpen(true);
  }, []);

  const handleEdit = useCallback((entry) => {
    setEditingEntry(entry);
    setIsComposerOpen(true);
  }, []);

  const handleViewDetail = useCallback((entryId) => {
    setSelectedEntryId(entryId);
    window.history.pushState(null, '', `#article-${entryId}`);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedEntryId(null);
    window.history.pushState(null, '', window.location.pathname);
  }, []);

  const handleCloseComposer = useCallback(() => {
    setIsComposerOpen(false);
    setEditingEntry(null);
  }, []);

  return (
    <div className="app-shell">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />

      <Header
        activeCount={stats.active}
        archivedCount={stats.archived}
        visibleCount={total}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNewPage={handleNewPage}
      />

      <div className="app-columns">
        <Sidebar
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          categories={categories}
          activeCategoryId={activeCategoryId}
          onCategoryChange={setActiveCategoryId}
          starredOnly={starredOnly}
          onStarredToggle={() => setStarredOnly((v) => !v)}
          onManageCategories={() => setIsCategoryModalOpen(true)}
        />

        <main className="column-center">
          {selectedEntryId ? (
            <ArticleDetail
              entryId={selectedEntryId}
              entries={entries}
              onClose={handleCloseDetail}
              onEdit={handleEdit}
            />
          ) : (
            <ArticleList
              entries={entries}
              total={total}
              page={page}
              pageSize={PAGE_SIZE}
              sortOrder={sortOrder}
              onSortChange={setSortOrder}
              onPageChange={setPage}
              isLoading={isLoading}
              errorMessage={errorMessage}
              searchQuery={debouncedSearch}
              onViewDetail={handleViewDetail}
              onEdit={handleEdit}
              onArchive={archiveEntry}
              onRestore={restoreEntry}
              onToggleStar={toggleStar}
            />
          )}
        </main>

        <aside className="column-right">
          <AssistantPanel />
        </aside>
      </div>

      {isComposerOpen && (
        <ComposerModal
          entry={editingEntry}
          entries={entries}
          categories={categories}
          onSave={saveEntry}
          onClose={handleCloseComposer}
        />
      )}

      {isCategoryModalOpen && (
        <CategoryModal
          categories={categories}
          onCreate={createCategory}
          onDelete={deleteCategory}
          onClose={() => setIsCategoryModalOpen(false)}
        />
      )}

      <ToastContainer />
    </div>
  );
}

export default App;
