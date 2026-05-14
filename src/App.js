import React, { useEffect, useState } from 'react';
import './App.css';

const API_BASE = 'http://localhost:5001';
const emptyForm = {
  id: '',
  jira_link: '',
  sf_case: '',
  description: '',
  solution: '',
  summary: '',
  related_page_ids: [],
  deleted_at: null,
};
const initialAssistantMessage = {
  role: 'assistant',
  content:
    'Ask about symptoms, fixes, or a known case. I will answer only from the saved knowledge pages and cite the pages I use.',
  citations: [],
  refusal: false,
};

const normalizeEntry = (entry = {}) => ({
  id: entry.id || '',
  jira_link: entry.jira_link || '',
  sf_case: entry.sf_case || '',
  description: entry.description || '',
  solution: entry.solution || '',
  summary: entry.summary || '',
  related_page_ids: Array.isArray(entry.related_page_ids)
    ? [...new Set(entry.related_page_ids.filter(Boolean))]
    : [],
  deleted_at: entry.deleted_at || null,
});

const splitLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const normalizeText = (value) => value.toLowerCase();

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function App() {
  const [entries, setEntries] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('active');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [formData, setFormData] = useState(emptyForm);
  const [assistantMessages, setAssistantMessages] = useState([initialAssistantMessage]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantError, setAssistantError] = useState('');
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);

  const loadEntries = async (showLoader = false) => {
    if (showLoader) {
      setIsLoading(true);
    }

    try {
      const data = await requestJson('/api/knowledge?view=all');
      setEntries(data.map(normalizeEntry));
      setErrorMessage('');
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        'Knowledge pages could not be loaded. Check that the API is running on port 5001.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEntries(true);
  }, []);

  const activeEntries = entries.filter((entry) => !entry.deleted_at);
  const archivedEntries = entries.filter((entry) => entry.deleted_at);
  const activeEntryMap = activeEntries.reduce((result, entry) => {
    result[entry.id] = entry;
    return result;
  }, {});
  const allEntryMap = entries.reduce((result, entry) => {
    result[entry.id] = entry;
    return result;
  }, {});

  const buildSearchableText = (entry) => {
    const relatedSummaries = entry.related_page_ids
      .map((relatedId) => activeEntryMap[relatedId]?.summary || '')
      .join(' ');

    return normalizeText(
      [
        entry.summary,
        entry.sf_case,
        entry.description,
        entry.solution,
        entry.jira_link,
        relatedSummaries,
      ].join(' ')
    );
  };

  const visibleEntries = [...entries]
    .filter((entry) => {
      if (activeFilter === 'active') {
        return !entry.deleted_at;
      }

      if (activeFilter === 'archived') {
        return Boolean(entry.deleted_at);
      }

      return true;
    })
    .filter((entry) => buildSearchableText(entry).includes(normalizeText(searchQuery)))
    .reverse();

  const availableReferenceEntries = activeEntries.filter((entry) => entry.id !== formData.id);
  const hasArchivedReferences = formData.related_page_ids.some(
    (relatedId) => !activeEntryMap[relatedId] && allEntryMap[relatedId]
  );

  const filters = [
    { id: 'active', label: 'Active' },
    { id: 'archived', label: 'Archived' },
    { id: 'all', label: 'All' },
  ];

  const resetForm = () => {
    setFormData(emptyForm);
  };

  const handleChange = (field, value) => {
    setFormData((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const toggleRelatedPage = (pageId) => {
    setFormData((current) => {
      const nextIds = current.related_page_ids.includes(pageId)
        ? current.related_page_ids.filter((item) => item !== pageId)
        : [...current.related_page_ids, pageId];

      return {
        ...current,
        related_page_ids: nextIds,
      };
    });
  };

  const handleEdit = (entry) => {
    setFormData(normalizeEntry(entry));
    setErrorMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);

    const payload = {
      summary: formData.summary,
      sf_case: formData.sf_case,
      jira_link: formData.jira_link,
      description: formData.description,
      solution: formData.solution,
      related_page_ids: formData.related_page_ids,
    };

    try {
      if (formData.id) {
        await requestJson(`/api/knowledge/${formData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await requestJson('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await loadEntries();
      resetForm();
      setErrorMessage('');
    } catch (error) {
      console.error('Error saving data:', error);
      setErrorMessage(error.message || 'The knowledge page was not saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async (entry) => {
    if (!window.confirm(`Archive "${entry.summary}"?`)) {
      return;
    }

    try {
      await requestJson(`/api/knowledge/${entry.id}/archive`, { method: 'POST' });
      await loadEntries();

      if (formData.id === entry.id) {
        resetForm();
      }
    } catch (error) {
      setErrorMessage(error.message || 'The page could not be archived.');
    }
  };

  const handleRestore = async (entry) => {
    try {
      await requestJson(`/api/knowledge/${entry.id}/restore`, { method: 'POST' });
      await loadEntries();
    } catch (error) {
      setErrorMessage(error.message || 'The page could not be restored.');
    }
  };

  const handleAssistantSubmit = async (event) => {
    event.preventDefault();
    const trimmedInput = assistantInput.trim();

    if (!trimmedInput) {
      return;
    }

    const userMessage = { role: 'user', content: trimmedInput };
    const outgoingMessages = [...assistantMessages, userMessage]
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setAssistantMessages((current) => [...current, userMessage]);
    setAssistantInput('');
    setAssistantError('');
    setIsAssistantLoading(true);

    try {
      const response = await requestJson('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: outgoingMessages,
          view: 'active',
        }),
      });

      setAssistantMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: response.answer,
          citations: Array.isArray(response.citations) ? response.citations : [],
          refusal: Boolean(response.refusal),
        },
      ]);
    } catch (error) {
      console.error('Assistant error:', error);
      setAssistantError(error.message || 'The assistant could not answer right now.');
    } finally {
      setIsAssistantLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />

      <main className="app-frame">
        <section className="hero card">
          <div className="hero-copy">
            <p className="eyebrow">Support Enablement</p>
            <h1>Knowledge pages that are easier to scan, trust, and reuse.</h1>
            <p className="hero-text">
              Link related incidents together, retire outdated pages safely, and let support
              teammates ask grounded questions against the current knowledge library.
            </p>
          </div>

          <div className="hero-stats" aria-label="Knowledge base metrics">
            <div className="stat-tile">
              <span className="stat-value">{activeEntries.length}</span>
              <span className="stat-label">Active pages</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{archivedEntries.length}</span>
              <span className="stat-label">Archived pages</span>
            </div>
            <div className="stat-tile accent">
              <span className="stat-value">{visibleEntries.length}</span>
              <span className="stat-label">Visible now</span>
            </div>
          </div>
        </section>

        <div className="workspace">
          <section className="composer card">
            <div className="section-heading">
              <p className="eyebrow">{formData.id ? 'Edit Page' : 'Create Page'}</p>
              <h2>{formData.id ? 'Update a support article' : 'Add a defined support article'}</h2>
              <p>
                Capture the issue, resolution, and related pages so the knowledge base can answer
                faster and with better context.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="entry-form">
              <div className="input-group">
                <label htmlFor="summary">Summary *</label>
                <input
                  id="summary"
                  placeholder="Login flow fails after SSO redirect"
                  required
                  value={formData.summary}
                  onChange={(event) => handleChange('summary', event.target.value)}
                />
              </div>

              <div className="two-column-grid">
                <div className="input-group">
                  <label htmlFor="sf-case">Salesforce Case *</label>
                  <input
                    id="sf-case"
                    placeholder="00123456"
                    required
                    value={formData.sf_case}
                    onChange={(event) => handleChange('sf_case', event.target.value)}
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="jira-link">JIRA Link</label>
                  <input
                    id="jira-link"
                    placeholder="https://jira.company.com/browse/OPS-421"
                    value={formData.jira_link}
                    onChange={(event) => handleChange('jira_link', event.target.value)}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="description">Issue definition *</label>
                <textarea
                  id="description"
                  placeholder="What the customer saw, when it happened, and how it impacted them."
                  required
                  rows="5"
                  value={formData.description}
                  onChange={(event) => handleChange('description', event.target.value)}
                />
              </div>

              <div className="input-group">
                <label htmlFor="solution">Resolution steps *</label>
                <textarea
                  id="solution"
                  placeholder="1. Confirm the tenant SSO certificate.
2. Re-sync the IdP metadata.
3. Re-run the login validation."
                  required
                  rows="6"
                  value={formData.solution}
                  onChange={(event) => handleChange('solution', event.target.value)}
                />
              </div>

              <div className="input-group">
                <label>Related pages</label>
                <div className="reference-picker">
                  {availableReferenceEntries.length === 0 ? (
                    <p className="helper-text">Create another active page first to link knowledge pages.</p>
                  ) : (
                    availableReferenceEntries.map((entry) => (
                      <label key={entry.id} className="reference-option">
                        <input
                          type="checkbox"
                          checked={formData.related_page_ids.includes(entry.id)}
                          onChange={() => toggleRelatedPage(entry.id)}
                        />
                        <span>
                          <strong>{entry.summary}</strong>
                          <small>SF Case {entry.sf_case}</small>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {hasArchivedReferences ? (
                  <p className="helper-text warning-text">
                    One or more saved references are archived and will appear as unavailable until
                    those pages are restored.
                  </p>
                ) : null}
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={isSaving}>
                  {isSaving
                    ? 'Saving...'
                    : formData.id
                      ? 'Save page changes'
                      : 'Save knowledge page'}
                </button>

                {formData.id ? (
                  <button type="button" className="btn-secondary" onClick={resetForm}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="library">
            <div className="library-toolbar card">
              <div className="section-heading">
                <p className="eyebrow">Knowledge Library</p>
                <h2>Search, link, and maintain support pages</h2>
              </div>

              <div className="search-panel">
                <input
                  type="text"
                  className="search-bar"
                  placeholder="Search summaries, case IDs, symptoms, fixes, or related pages"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />

                <div className="filter-row" role="tablist" aria-label="Knowledge page filters">
                  {filters.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={`filter-chip ${activeFilter === filter.id ? 'active' : ''}`}
                      onClick={() => setActiveFilter(filter.id)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {errorMessage ? <div className="feedback-banner">{errorMessage}</div> : null}

            <div className="library-grid">
              <div className="entries-list">
                {isLoading ? (
                  <div className="empty-state card">
                    <h3>Loading knowledge pages</h3>
                    <p>The app is fetching saved support articles from the backend.</p>
                  </div>
                ) : visibleEntries.length === 0 ? (
                  <div className="empty-state card">
                    <h3>No pages match this view</h3>
                    <p>Try a broader search term or switch archive filters to reveal more pages.</p>
                  </div>
                ) : (
                  visibleEntries.map((item) => {
                    const issueLines = splitLines(item.description);
                    const solutionLines = splitLines(item.solution);
                    const resolvedReferences = item.related_page_ids
                      .map((relatedId) => activeEntryMap[relatedId])
                      .filter(Boolean);
                    const unresolvedCount = item.related_page_ids.filter(
                      (relatedId) => !activeEntryMap[relatedId]
                    ).length;

                    return (
                      <article
                        key={item.id}
                        id={`knowledge-${item.id}`}
                        className={`entry-card card ${item.deleted_at ? 'archived-card' : ''}`}
                      >
                        <div className="entry-topline">
                          <div>
                            <p className="entry-kicker">Knowledge page</p>
                            <h3>{item.summary}</h3>
                          </div>

                          <div className="entry-badges">
                            <span className="badge case-badge">SF Case {item.sf_case}</span>
                            <span className={`badge ${item.deleted_at ? 'archived-badge' : 'linked-badge'}`}>
                              {item.deleted_at ? 'Archived' : 'Active'}
                            </span>
                            <span className="badge muted-badge">
                              {item.related_page_ids.length} related
                            </span>
                          </div>
                        </div>

                        <div className="entry-grid">
                          <section className="entry-block">
                            <h4>Issue definition</h4>
                            {issueLines.map((line, lineIndex) => (
                              <p key={`${item.id}-issue-${lineIndex}`}>{line}</p>
                            ))}
                          </section>

                          <section className="entry-block">
                            <h4>Resolution</h4>
                            {solutionLines.length > 1 ? (
                              <ol className="solution-list">
                                {solutionLines.map((line, lineIndex) => (
                                  <li key={`${item.id}-solution-${lineIndex}`}>{line}</li>
                                ))}
                              </ol>
                            ) : (
                              solutionLines.map((line, lineIndex) => (
                                <p key={`${item.id}-solution-single-${lineIndex}`}>{line}</p>
                              ))
                            )}
                          </section>
                        </div>

                        <section className="related-pages-block">
                          <div className="related-pages-heading">
                            <h4>Related pages</h4>
                            <span>{item.related_page_ids.length || 0} linked</span>
                          </div>

                          {resolvedReferences.length > 0 ? (
                            <div className="related-pages-list">
                              {resolvedReferences.map((relatedEntry) => (
                                <a
                                  key={relatedEntry.id}
                                  href={`#knowledge-${relatedEntry.id}`}
                                  className="related-chip"
                                >
                                  {relatedEntry.summary}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <p className="helper-text">No active related pages are linked to this article.</p>
                          )}

                          {unresolvedCount > 0 ? (
                            <p className="helper-text warning-text">Referenced page unavailable.</p>
                          ) : null}
                        </section>

                        <div className="entry-footer">
                          <span className="entry-reference">
                            {item.jira_link
                              ? 'Linked engineering reference available.'
                              : 'No engineering link attached yet.'}
                          </span>

                          <div className="entry-actions">
                            {!item.deleted_at ? (
                              <>
                                <button
                                  type="button"
                                  className="text-action"
                                  onClick={() => handleEdit(item)}
                                >
                                  Edit page
                                </button>
                                <button
                                  type="button"
                                  className="text-action danger-action"
                                  onClick={() => handleArchive(item)}
                                >
                                  Delete page
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="text-action"
                                onClick={() => handleRestore(item)}
                              >
                                Restore page
                              </button>
                            )}

                            {item.jira_link ? (
                              <a
                                href={item.jira_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="jira-link"
                              >
                                Open JIRA
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              <aside className="assistant-panel card">
                <div className="assistant-header">
                  <div>
                    <p className="eyebrow">AI Assistant</p>
                    <h2>Grounded support chat</h2>
                  </div>
                  <span className="assistant-badge">KB-only</span>
                </div>

                <div className="assistant-messages" aria-live="polite">
                  {assistantMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`chat-bubble ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'} ${
                        message.refusal ? 'refusal-bubble' : ''
                      }`}
                    >
                      <span className="chat-role">
                        {message.role === 'user' ? 'Support user' : 'Assistant'}
                      </span>
                      <p>{message.content}</p>

                      {message.citations?.length ? (
                        <div className="citation-list">
                          {message.citations.map((citation) => (
                            <span key={citation.id} className="citation-chip">
                              {citation.summary} · {citation.sf_case}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {isAssistantLoading ? (
                    <div className="chat-bubble assistant-bubble">
                      <span className="chat-role">Assistant</span>
                      <p>Reviewing the saved pages and matching evidence...</p>
                    </div>
                  ) : null}
                </div>

                {assistantError ? <div className="feedback-banner">{assistantError}</div> : null}

                <form onSubmit={handleAssistantSubmit} className="assistant-form">
                  <textarea
                    className="assistant-input"
                    rows="4"
                    placeholder="Ask about a symptom, a case ID, or the next troubleshooting step."
                    value={assistantInput}
                    onChange={(event) => setAssistantInput(event.target.value)}
                  />
                  <button type="submit" className="btn-primary" disabled={isAssistantLoading}>
                    {isAssistantLoading ? 'Thinking...' : 'Ask assistant'}
                  </button>
                </form>
              </aside>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
