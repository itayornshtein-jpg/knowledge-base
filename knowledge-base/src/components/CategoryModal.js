import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#64748b',
];

function CategoryModal({ categories, onCreate, onDelete, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), color });
      setName('');
      setError('');
    } catch (err) {
      setError(err.message || 'Could not create category.');
    } finally {
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Manage categories"
        style={{ maxWidth: 480 }}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2 className="modal-title">Manage categories</h2>
          </div>
          <button type="button" className="modal-close-btn text-action" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Create new */}
        <form onSubmit={handleCreate} style={{ marginBottom: '1.5rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>New category</p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Category name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
          {error && <p className="feedback-banner" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </form>

        {/* Existing list */}
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Existing categories</p>
        {categories.length === 0 ? (
          <p className="helper-text">No categories yet. Create one above.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {categories.map((cat) => (
              <li
                key={cat.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--color-border-tertiary)',
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: cat.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: '0.875rem' }}>{cat.name}</span>
                <span className="category-count" style={{ marginRight: '0.5rem' }}>
                  {cat.article_count ?? 0} articles
                </span>
                <button
                  type="button"
                  className="text-action danger-action"
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => onDelete(cat.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="form-actions" style={{ marginTop: '1.5rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CategoryModal;
