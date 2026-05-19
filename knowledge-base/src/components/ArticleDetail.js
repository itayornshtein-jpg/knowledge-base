import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { requestJson, normalizeEntry } from '../hooks/useEntries';
import { jiraTicketKey } from '../utils/jira';

function splitLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function ArticleDetail({ entryId, entries, onClose, onEdit }) {
  // Try to find the entry in the current paginated page; fall back to a direct fetch.
  const localEntry = useMemo(
    () => entries.find((e) => e.id === entryId),
    [entries, entryId]
  );

  const [fetched, setFetched] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    if (localEntry) {
      setFetched(null);
      setFetchError('');
      return;
    }
    if (!entryId) return;

    let cancelled = false;
    setIsFetching(true);
    setFetchError('');
    requestJson(`/api/knowledge/${entryId}`)
      .then((data) => {
        if (cancelled) return;
        setFetched(normalizeEntry(data));
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err.message || 'Could not load article.');
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entryId, localEntry]);

  const entry = localEntry || fetched;

  const activeEntryMap = useMemo(
    () =>
      entries.reduce((m, e) => {
        if (!e.deleted_at) m[e.id] = e;
        return m;
      }, {}),
    [entries]
  );

  const startEdit = useCallback(() => {
    if (entry && !entry.deleted_at) onEdit(entry);
  }, [entry, onEdit]);

  // Keyboard shortcuts: Escape closes, E starts editing (when not focused in an input)
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        startEdit();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, startEdit]);

  if (isFetching && !entry) {
    return (
      <div className="detail-panel card">
        <div className="detail-panel-nav">
          <button type="button" className="text-action" onClick={onClose}>
            ← Back to list
          </button>
        </div>
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-meta" />
        <div className="skeleton-line skeleton-snippet" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="empty-state card">
        <h3>Article not found</h3>
        <p>{fetchError || 'This page may have been deleted or the link is incorrect.'}</p>
        <button type="button" className="text-action" onClick={onClose}>
          ← Back to list
        </button>
      </div>
    );
  }

  const resolvedReferences = entry.related_page_ids
    .map((id) => activeEntryMap[id])
    .filter(Boolean);
  const unresolvedCount = entry.related_page_ids.filter((id) => !activeEntryMap[id]).length;
  const issueLines = splitLines(entry.description);
  const solutionLines = splitLines(entry.solution);
  const jiraKey = jiraTicketKey(entry.jira_link);

  return (
    <article className="detail-panel card">
      <div className="detail-panel-nav">
        <button type="button" className="text-action" onClick={onClose}>
          ← Back to list
        </button>
        {!entry.deleted_at && (
          <button
            type="button"
            className="btn-primary detail-edit-btn"
            onClick={startEdit}
            title="Edit this page (press E)"
            aria-keyshortcuts="e"
          >
            ✎ Edit page <span className="kbd-hint">E</span>
          </button>
        )}
      </div>

      <p className="eyebrow">Knowledge Page</p>
      <h1 className="detail-title">{entry.summary}</h1>

      <div className="detail-meta">
        <span className="badge case-badge">SF Case {entry.sf_case}</span>
        {jiraKey ? (
          <a
            href={entry.jira_link}
            target="_blank"
            rel="noopener noreferrer"
            className="badge jira-badge"
            title={`Open ${jiraKey} in JIRA`}
          >
            <span className="jira-badge-icon" aria-hidden="true">⌁</span>
            JIRA · {jiraKey}
          </a>
        ) : (
          <span className="badge muted-badge" title="No JIRA ticket linked">
            No JIRA ticket
          </span>
        )}
        <span className={`badge ${entry.deleted_at ? 'archived-badge' : 'linked-badge'}`}>
          {entry.deleted_at ? 'Archived' : 'Active'}
        </span>
        <span className="badge muted-badge">{entry.related_page_ids.length} related</span>
        <span className="badge muted-badge">{entry.images.length} pictures</span>
        {entry.view_count > 0 && (
          <span className="badge muted-badge" title="View count">
            {entry.view_count} 👁
          </span>
        )}
      </div>

      <div className="detail-grid">
        <section className="entry-block">
          <h4>Issue definition</h4>
          {issueLines.length > 0 ? (
            issueLines.map((line, i) => <p key={i}>{line}</p>)
          ) : (
            <p className="helper-text">No issue definition recorded.</p>
          )}
        </section>

        <section className="entry-block">
          <h4>Resolution</h4>
          {solutionLines.length > 1 ? (
            <ol className="solution-list">
              {solutionLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          ) : solutionLines.length === 1 ? (
            solutionLines.map((line, i) => <p key={i}>{line}</p>)
          ) : (
            <p className="helper-text">No resolution recorded.</p>
          )}
        </section>
      </div>

      <section className="related-pages-block">
        <div className="related-pages-heading">
          <h4>Related pages</h4>
        </div>
        <div className="related-pages-list">
          {resolvedReferences.length > 0 ? (
            resolvedReferences.map((ref) => (
              <span key={ref.id} className="related-chip">
                {ref.summary} · {ref.sf_case}
              </span>
            ))
          ) : entry.related_page_ids.length > 0 ? (
            <p className="helper-text">
              {entry.related_page_ids.length} related page
              {entry.related_page_ids.length > 1 ? 's' : ''} linked.
            </p>
          ) : (
            <p className="helper-text">No related pages are linked to this article.</p>
          )}
          {unresolvedCount > 0 && resolvedReferences.length > 0 && (
            <p className="warning-text">
              {unresolvedCount} referenced page{unresolvedCount > 1 ? 's are' : ' is'} unavailable
              (archived or deleted).
            </p>
          )}
        </div>
      </section>

      {entry.images.length > 0 && (
        <section className="entry-block picture-block">
          <h4>Pictures</h4>
          <div className="entry-image-gallery">
            {entry.images.map((img, i) => (
              <a
                key={i}
                href={img}
                target="_blank"
                rel="noopener noreferrer"
                className="entry-image-link"
              >
                <img
                  src={img}
                  alt={`${entry.summary} screenshot ${i + 1}`}
                  className="entry-image"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

export default ArticleDetail;
