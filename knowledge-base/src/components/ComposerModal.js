import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { normalizeEntry, requestJson } from '../hooks/useEntries';
import { useToast } from '../hooks/useToast';
// categories prop is an array of { id, name, color } passed from App

const emptyForm = {
  id: '',
  jira_link: '',
  sf_case: '',
  description: '',
  solution: '',
  summary: '',
  related_page_ids: [],
  images: [],
  deleted_at: null,
  category_id: null,
};

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function ComposerModal({ entry, entries, categories = [], onSave, onClose }) {
  const [formData, setFormData] = useState(entry ? normalizeEntry(entry) : { ...emptyForm });
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [relatedSearchQuery, setRelatedSearchQuery] = useState('');
  const [isFetchingSF, setIsFetchingSF] = useState(false);
  const { show: showToast } = useToast();
  const summaryRef = useRef(null);

  // Autofocus the first field when the modal opens
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  const activeEntries = entries.filter((e) => !e.deleted_at);
  const availableEntries = activeEntries.filter((e) => e.id !== formData.id);
  const filteredEntries = availableEntries.filter((e) =>
    `${e.summary} ${e.sf_case}`.toLowerCase().includes(relatedSearchQuery.toLowerCase())
  );
  const hasArchivedRefs = formData.related_page_ids.some((id) => {
    const activeMap = activeEntries.reduce((m, e) => { m[e.id] = e; return m; }, {});
    const allMap = entries.reduce((m, e) => { m[e.id] = e; return m; }, {});
    return !activeMap[id] && allMap[id];
  });

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleRelatedPage = useCallback((pageId) => {
    setFormData((prev) => {
      const next = prev.related_page_ids.includes(pageId)
        ? prev.related_page_ids.filter((id) => id !== pageId)
        : [...prev.related_page_ids, pageId];
      return { ...prev, related_page_ids: next };
    });
  }, []);

  const handleImageUpload = useCallback(async (event) => {
    const { files } = event.target;
    if (!files || files.length === 0) return;
    try {
      const images = await Promise.all(Array.from(files).map(readImageFile));
      setFormData((prev) => ({
        ...prev,
        images: [...prev.images, ...images.filter(Boolean)],
      }));
      setErrorMessage('');
    } catch (err) {
      setErrorMessage(err.message || 'The selected image could not be added.');
    } finally {
      event.target.value = '';
    }
  }, []);

  const removeImage = useCallback((index) => {
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'The page could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  // Cmd/Ctrl+Enter submits the form from any focused field
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const form = e.target?.closest?.('form');
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleFetchFromSF = useCallback(async () => {
    const caseNumber = (formData.sf_case || '').trim();
    if (!caseNumber) {
      setErrorMessage('Enter a Salesforce case number first.');
      return;
    }
    setIsFetchingSF(true);
    setErrorMessage('');
    try {
      const data = await requestJson(
        `/api/integrations/salesforce/case/${encodeURIComponent(caseNumber)}`
      );
      const incomingResolution = (data?.resolution || '').trim();
      const incomingDescription = (data?.description || '').trim();
      const subject = (data?.subject || '').trim();

      if (!incomingResolution && !incomingDescription) {
        showToast({
          type: 'info',
          message: `SF case ${data?.case_number || caseNumber} has no resolution comments yet.`,
        });
        return;
      }

      setFormData((prev) => {
        const next = { ...prev };
        if (incomingResolution) {
          const existing = (prev.solution || '').trim();
          next.solution = existing
            ? `${existing}\n\n--- From SF ${data.case_number} ---\n${incomingResolution}`
            : incomingResolution;
        }
        // Only fill description and summary when they're empty — never overwrite the user's text
        if (!prev.description?.trim() && incomingDescription) {
          next.description = incomingDescription;
        }
        if (!prev.summary?.trim() && subject) {
          next.summary = subject;
        }
        return next;
      });

      showToast({
        type: 'success',
        message: `Pulled resolution from SF case ${data?.case_number || caseNumber}.`,
      });
    } catch (err) {
      const msg = err.message || 'Could not fetch from Salesforce.';
      // 503 from backend means Salesforce isn't configured — surface a clear hint
      showToast({
        type: 'error',
        message: msg.includes('not configured')
          ? 'Salesforce is not configured on the backend. See backend/.env (SF_* variables).'
          : msg,
        duration: 7000,
      });
    } finally {
      setIsFetchingSF(false);
    }
  }, [formData.sf_case, showToast]);

  const isEdit = Boolean(formData.id);

  return ReactDOM.createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit knowledge page' : 'Create knowledge page'}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{isEdit ? 'Edit Page' : 'Create Page'}</p>
            <h2 className="modal-title">
              {isEdit ? 'Update a support article' : 'Add a defined support article'}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn text-action"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          <div className="input-group">
            <label htmlFor="modal-summary">Summary *</label>
            <input
              id="modal-summary"
              ref={summaryRef}
              placeholder="Login flow fails after SSO redirect"
              required
              value={formData.summary}
              onChange={(e) => handleChange('summary', e.target.value)}
            />
          </div>

          <div className="two-column-grid">
            <div className="input-group">
              <label htmlFor="modal-sf-case">Salesforce Case *</label>
              <div className="input-with-action">
                <input
                  id="modal-sf-case"
                  placeholder="00123456"
                  required
                  value={formData.sf_case}
                  onChange={(e) => handleChange('sf_case', e.target.value)}
                />
                <button
                  type="button"
                  className="text-action sf-fetch-btn"
                  onClick={handleFetchFromSF}
                  disabled={isFetchingSF || !formData.sf_case?.trim()}
                  title="Pull Subject + Resolution from Salesforce by case number"
                >
                  {isFetchingSF ? 'Fetching…' : 'Pull from SF'}
                </button>
              </div>
              <p className="helper-text">
                Press <strong>Pull from SF</strong> to fill the resolution from the linked case's
                comments.
              </p>
            </div>
            <div className="input-group">
              <label htmlFor="modal-jira-link">JIRA Link</label>
              <input
                id="modal-jira-link"
                placeholder="https://jira.company.com/browse/OPS-421"
                value={formData.jira_link}
                onChange={(e) => handleChange('jira_link', e.target.value)}
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="modal-description">Issue definition *</label>
            <textarea
              id="modal-description"
              placeholder="What the customer saw, when it happened, and how it impacted them."
              required
              rows="6"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
            />
          </div>

          <div className="input-group">
            <div className="input-group-header">
              <label htmlFor="modal-solution">Resolution steps *</label>
              <button
                type="button"
                className="text-action sf-fetch-btn-inline"
                onClick={handleFetchFromSF}
                disabled={isFetchingSF || !formData.sf_case?.trim()}
                title="Pull Resolution from the linked SF case"
              >
                {isFetchingSF ? 'Fetching…' : '↓ Pull from SF case'}
              </button>
            </div>
            <textarea
              id="modal-solution"
              placeholder={`1. Confirm the tenant SSO certificate.\n2. Re-sync the IdP metadata.\n3. Re-run the login validation.`}
              required
              rows="10"
              value={formData.solution}
              onChange={(e) => handleChange('solution', e.target.value)}
            />
          </div>

          {categories.length > 0 && (
            <div className="input-group">
              <label htmlFor="modal-category">Category</label>
              <select
                id="modal-category"
                value={formData.category_id || ''}
                onChange={(e) => handleChange('category_id', e.target.value || null)}
              >
                <option value="">— Uncategorised —</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="input-group">
            <label>Related pages</label>
            <input
              type="text"
              className="related-search-input"
              placeholder="Search related pages by summary or SF case"
              value={relatedSearchQuery}
              onChange={(e) => setRelatedSearchQuery(e.target.value)}
            />
            <div className="reference-picker">
              {availableEntries.length === 0 ? (
                <p className="helper-text">
                  Create another active page first to link knowledge pages.
                </p>
              ) : filteredEntries.length === 0 ? (
                <p className="helper-text">No related pages match this search.</p>
              ) : (
                filteredEntries.map((e) => (
                  <label key={e.id} className="reference-option">
                    <input
                      type="checkbox"
                      checked={formData.related_page_ids.includes(e.id)}
                      onChange={() => toggleRelatedPage(e.id)}
                    />
                    <span>
                      <strong>{e.summary}</strong>
                      <small>SF Case {e.sf_case}</small>
                    </span>
                  </label>
                ))
              )}
            </div>
            {hasArchivedRefs && (
              <p className="helper-text warning-text">
                One or more saved references are archived and will appear as unavailable until
                restored.
              </p>
            )}
          </div>

          <div className="input-group">
            <label htmlFor="modal-images">Pictures</label>
            <input
              id="modal-images"
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
            />
            <p className="helper-text">
              Add screenshots or visual references. They stay hidden on cards until clicked.
            </p>
            {formData.images.length > 0 && (
              <div className="image-preview-grid">
                {formData.images.map((img, i) => (
                  <div
                    key={`${formData.id || 'draft'}-img-${i}`}
                    className="image-preview-card"
                  >
                    <img
                      src={img}
                      alt={`Page upload ${i + 1}`}
                      className="image-preview"
                      loading="lazy"
                    />
                    <button
                      type="button"
                      className="text-action danger-action image-remove-button"
                      onClick={() => removeImage(i)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {errorMessage && <div className="feedback-banner">{errorMessage}</div>}

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : isEdit ? 'Save page changes' : 'Save knowledge page'}
              <span className="kbd-hint">⌘↵</span>
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel <span className="kbd-hint">Esc</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default ComposerModal;
