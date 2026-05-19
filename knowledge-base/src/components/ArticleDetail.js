import React, { useEffect, useMemo, useState } from 'react';
import { requestJson, normalizeEntry } from '../hooks/useEntries';

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

  // Best-effort map for resolving related-page chips (limited to entries on the current page).
  const activeEntryMap = useMemo(
    () =>
      entries.reduce((m, e) => {
        if (!e.deleted_at) m[e.id] = e;
        return m;
      }, {}),
    [entries]
  );

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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

  return (
    <article className="detail-panel card">
      <div className="detail-panel-nav">
        <button type="button" className="text-action" onClick={onClose}>
          ← Back to list
        </button>
        {!entry.deleted_at && (
          <button type="button" className="text-action" onClick={() => onEdit(entry)}>
            Edit page
          </button>
        )}
      </div>

      <p className="eyebrow">Knowledge Page</p>
      <h1 className="detail-title">{entry.summary}</h1>

      <div className="detail-meta">
        <span className="badge case-badge">SF Case {entry.sf_case}</span>
        <span className={`badge ${entry.deleted_at ? 'archived-badge' : 'linked-badge'}`}>
          {entry.deleted_at ? 'Archived' : 'Active'}
        </span>
        <span className="badge muted-badge">{entry.related_page_ids.length} related</span>
        <span className="badge muted-badge">{entry.images.length} pictures</span>
      </div>

      <div className="detail-grid">
        <section className="entry-block">
          <h4>Issue definition</h4>
          {issueLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </section>

        <section className="entry-block">
          <h4>Resolution</h4>
          {solutionLines.length > 1 ? (
            <ol className="solution-list">
              {solutionLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          ) : (
            solutionLines.map((line, i) => <p key={i}>{line}</p>)
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

      <section className="entry-block">
        <h4>References</h4>
        {entry.jira_link ? (
          <a
            href={entry.jira_link}
            target="_blank"
            rel="noopener noreferrer"
            className="jira-link"
          >
            Open JIRA
          </a>
        ) : (
          <span className="helper-text">No engineering link attached yet.</span>
        )}
      </section>
    </article>
  );
}

export default ArticleDetail;
