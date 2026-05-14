import React, { useState } from 'react';

const FILTERS = [
  { id: 'active', label: 'Active pages' },
  { id: 'archived', label: 'Archived pages' },
  { id: 'all', label: 'All pages' },
];

function Sidebar({
  activeFilter,
  onFilterChange,
  categories = [],
  activeCategoryId,
  onCategoryChange,
  onManageCategories,
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav className="sidebar" aria-label="Knowledge base views">
      <p className="eyebrow sidebar-section-label">Views</p>

      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`sidebar-link${activeFilter === f.id && !activeCategoryId ? ' active' : ''}`}
          onClick={() => {
            onFilterChange(f.id);
            if (onCategoryChange) onCategoryChange(null);
          }}
          aria-current={activeFilter === f.id && !activeCategoryId ? 'page' : undefined}
        >
          {f.label}
        </button>
      ))}

      {categories.length > 0 && (
        <>
          <div className="sidebar-divider" />
          <div className="sidebar-section-header">
            <p className="eyebrow sidebar-section-label" style={{ margin: 0 }}>Categories</p>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand categories' : 'Collapse categories'}
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>

          {!collapsed && (
            <>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`sidebar-link sidebar-link-category${activeCategoryId === cat.id ? ' active' : ''}`}
                  onClick={() => {
                    if (onCategoryChange) onCategoryChange(cat.id);
                    onFilterChange('active');
                  }}
                  aria-current={activeCategoryId === cat.id ? 'page' : undefined}
                >
                  <span
                    className="category-dot"
                    style={{ backgroundColor: cat.color || '#6366f1' }}
                    aria-hidden="true"
                  />
                  {cat.name}
                  {typeof cat.article_count === 'number' && (
                    <span className="category-count">{cat.article_count}</span>
                  )}
                </button>
              ))}
            </>
          )}
        </>
      )}

      <div className="sidebar-divider" />
      {onManageCategories && (
        <button
          type="button"
          className="sidebar-link sidebar-link-manage"
          onClick={onManageCategories}
        >
          + Manage categories
        </button>
      )}
    </nav>
  );
}

export default Sidebar;
