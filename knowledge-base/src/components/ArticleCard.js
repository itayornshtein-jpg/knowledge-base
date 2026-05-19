import React, { useCallback } from 'react';
import { jiraTicketKey } from '../utils/jira';

function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? <mark key={i}>{part}</mark> : part
  );
}

function ArticleCard({ entry, searchQuery, onView, onEdit, onArchive, onRestore, onToggleStar }) {
  const handleArchive = useCallback(() => {
    onArchive(entry.id, entry.summary);
  }, [onArchive, entry.id, entry.summary]);

  const handleStar = useCallback(
    (e) => {
      e.stopPropagation();
      if (onToggleStar) onToggleStar(entry.id);
    },
    [onToggleStar, entry.id]
  );

  const snippet =
    entry.description.length > 120
      ? entry.description.slice(0, 120) + '…'
      : entry.description;

  const jiraKey = jiraTicketKey(entry.jira_link);

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
          {onToggleStar && (
            <button
              type="button"
              className={`star-toggle${entry.is_starred ? ' star-toggle-on' : ''}`}
              onClick={handleStar}
              aria-label={entry.is_starred ? 'Unstar this page' : 'Star this page'}
              aria-pressed={Boolean(entry.is_starred)}
              title={entry.is_starred ? 'Starred' : 'Star this page'}
            >
              {entry.is_starred ? '★' : '☆'}
            </button>
          )}
          <span className="badge case-badge">SF {highlight(entry.sf_case, searchQuery)}</span>
          {jiraKey && (
            <a
              href={entry.jira_link}
              target="_blank"
              rel="noopener noreferrer"
              className="badge jira-badge"
              onClick={(e) => e.stopPropagation()}
              title={`Open ${jiraKey} in JIRA`}
            >
              <span className="jira-badge-icon" aria-hidden="true">⌁</span>
              {jiraKey}
            </a>
          )}
          <span className={`badge ${entry.deleted_at ? 'archived-badge' : 'linked-badge'}`}>
            {entry.deleted_at ? 'Archived' : 'Active'}
          </span>
          {entry.related_page_ids.length > 0 && (
            <span className="badge muted-badge">{entry.related_page_ids.length} related</span>
          )}
          {entry.images.length > 0 && (
            <span className="badge muted-badge">{entry.images.length} pics</span>
          )}
          {entry.view_count > 0 && (
            <span className="badge muted-badge" title="View count">
              {entry.view_count} 👁
            </span>
          )}
        </div>
      </div>

      <div className="entry-footer compact-entry-footer">
        <span className="entry-reference">
          {jiraKey
            ? `Linked to ${jiraKey}`
            : 'No engineering link attached.'}
        </span>

        <div className="entry-actions">
          {!entry.deleted_at ? (
            <>
              <button type="button" className="text-action" onClick={() => onEdit(entry)}>
                Edit
              </button>
              <button
                type="button"
                className="text-action danger-action"
                onClick={handleArchive}
              >
                Archive
              </button>
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
        </div>
      </div>
    </article>
  );
}

export default ArticleCard;
