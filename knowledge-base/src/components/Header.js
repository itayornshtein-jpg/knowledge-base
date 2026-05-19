import React, { useRef, useEffect } from 'react';

function Header({ activeCount, archivedCount, visibleCount, searchQuery, onSearchChange, onNewPage }) {
  const searchRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="app-header">
      <span className="brand eyebrow">Knowledge Base</span>

      <input
        ref={searchRef}
        type="text"
        className="search-bar header-search"
        placeholder="Search (⌘K)"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search knowledge pages"
      />

      <div className="header-stats" aria-label="Knowledge base metrics">
        <span className="stat-chip">Active {activeCount}</span>
        <span className="stat-chip">Archived {archivedCount}</span>
        <span className="stat-chip accent">Visible {visibleCount}</span>
      </div>

      <button type="button" className="btn-primary" onClick={onNewPage}>
        New Page
      </button>
    </header>
  );
}

export default Header;
