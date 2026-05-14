import { useState, useEffect, useCallback } from 'react';

// Port 8000 = new FastAPI backend. Override with REACT_APP_API_BASE in .env
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';

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
  images: Array.isArray(entry.images) ? entry.images.filter(Boolean) : [],
  deleted_at: entry.deleted_at || null,
  category_id: entry.category_id || null,
  category: entry.category || null,
  created_at: entry.created_at || null,
  updated_at: entry.updated_at || null,
});

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || 'Request failed.');
  }
  return data;
}

export { normalizeEntry, requestJson, API_BASE };

export function useEntries() {
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const data = await requestJson('/api/knowledge?view=all');
      setEntries(data.map(normalizeEntry));
      setErrorMessage('');
    } catch (err) {
      setErrorMessage(
        'Knowledge pages could not be loaded. Check that the API is running on port 5001.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const saveEntry = useCallback(
    async (formData) => {
      const isEdit = Boolean(formData.id);
      const path = isEdit ? `/api/knowledge/${formData.id}` : '/api/knowledge';
      const payload = {
        summary: formData.summary,
        sf_case: formData.sf_case,
        jira_link: formData.jira_link,
        description: formData.description,
        solution: formData.solution,
        related_page_ids: formData.related_page_ids,
        images: formData.images,
      };
      await requestJson(path, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await load();
    },
    [load]
  );

  const archiveEntry = useCallback(
    async (entryId) => {
      await requestJson(`/api/knowledge/${entryId}/archive`, { method: 'POST' });
      await load();
    },
    [load]
  );

  const restoreEntry = useCallback(
    async (entryId) => {
      await requestJson(`/api/knowledge/${entryId}/restore`, { method: 'POST' });
      await load();
    },
    [load]
  );

  return { entries, isLoading, errorMessage, saveEntry, archiveEntry, restoreEntry };
}
