import React, { useState, useCallback } from 'react';

function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? <mark key={i}>{part}</mark> : part
  );
}

function ArticleCard({ entry, searchQuery, onView, onEdit, onArchive, onRestore }) {
  const [confirmArchive, setConfirmArchive] = useState(false);

  const handleArchive = useCallback(() => {
    onArchive(entry.id);
    setConfirmArchive(false);
  }, [onArchive, entry.id]);

  const snippet =
    entry.description.length > 120
      ? entry.description.slice(0, 120) + '…'
      : entry.description;

  return (
    <article
      className={`entry-card card entry-list-item${entry.deleted_at ? ' archived-card' : ''}`}
    >
      <div className="entry-list-row">
        <button
          type="button"
          className="entry-open-button"
          aria-label={`Open knowledge page: ${entry.summary}`}
          onClick={() => onView(entry.id)}
        >
          <span className="entry-kicker">Knowledge page</span>
          <span className="entry-list-title">{highlight(entry.summary, searchQuery)}</span>
          <span className="entry-list-meta">{highlight(snippet, searchQuery)}</span>
        </button>

        <div className="entry-badges">
          <span className="badge case-badge">SF {highlight(entry.sf_case, searchQuery)}</span>
          <span className={`badge ${entry.deleted_at ? 'archived-badge' : 'linked-badge'}`}>
            {entry.deleted_at ? 'Archived' : 'Active'}
          </span>
          {entry.related_page_ids.length > 0 && (
            <span className="badge muted-badge">{entry.related_page_ids.length} related</span>
          )}
          {entry.images.length > 0 && (
            <span className="badge muted-badge">{entry.images.length} pics</span>
          )}
        </div>
      </div>

      <div className="entry-footer compact-entry-footer">
        <span className="entry-reference">
          {entry.jira_link
            ? 'Engineering reference available.'
            : 'No engineering link attached.'}
        </span>

        <div className="entry-actions">
          {!entry.deleted_at ? (
            <>
              <button type="button" className="text-action" onClick={() => onEdit(entry)}>
                Edit
              </button>

              {confirmArchive ? (
                <>
                  <span className="confirm-inline">Archive this page?</span>
                  <button
                    type="button"
                    className="text-action danger-action"
                    onClick={handleArchive}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setConfirmArchive(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-action danger-action"
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="text-action"
              onClick={() => onRestore(entry.id)}
            >
              Restore
            </button>
          )}

          {entry.jira_link && (
            <a
              href={entry.jira_link}
              target="_blank"
              rel="noopener noreferrer"
              className="jira-link"
            >
              Open JIRA
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default ArticleCard;
