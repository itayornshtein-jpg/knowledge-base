import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

import { useEntries } from './hooks/useEntries';
import { useCategories } from './hooks/useCategories';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ArticleList from './components/ArticleList';
import ArticleDetail from './components/ArticleDetail';
import AssistantPanel from './components/AssistantPanel';
import ComposerModal from './components/ComposerModal';
import CategoryModal from './components/CategoryModal';

function App() {
  const { entries, isLoading, errorMessage, saveEntry, archiveEntry, restoreEntry } = useEntries();
  const { categories, createCategory, deleteCategory } = useCategories();

  const [activeFilter, setActiveFilter] = useState('active');
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

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

  const activeCount = useMemo(() => entries.filter((e) => !e.deleted_at).length, [entries]);
  const archivedCount = useMemo(() => entries.filter((e) => e.deleted_at).length, [entries]);

  const visibleCount = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const activeEntryMap = entries.reduce((m, e) => {
      if (!e.deleted_at) m[e.id] = e;
      return m;
    }, {});

    return entries.filter((e) => {
      const matchesFilter =
        activeFilter === 'active'
          ? !e.deleted_at
          : activeFilter === 'archived'
          ? Boolean(e.deleted_at)
          : true;

      if (!matchesFilter) return false;
      if (activeCategoryId && e.category_id !== activeCategoryId) return false;
      if (!q) return true;

      const relatedSummaries = e.related_page_ids
        .map((id) => activeEntryMap[id]?.summary || '')
        .join(' ');
      const text = [e.summary, e.sf_case, e.description, e.solution, e.jira_link, relatedSummaries]
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    }).length;
  }, [entries, activeFilter, activeCategoryId, searchQuery]);

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
        activeCount={activeCount}
        archivedCount={archivedCount}
        visibleCount={visibleCount}
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
              isLoading={isLoading}
              errorMessage={errorMessage}
              activeFilter={activeFilter}
              activeCategoryId={activeCategoryId}
              searchQuery={searchQuery}
              onViewDetail={handleViewDetail}
              onEdit={handleEdit}
              onArchive={archiveEntry}
              onRestore={restoreEntry}
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
    </div>
  );
}

export default App;
