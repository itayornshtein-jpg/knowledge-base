import { useState, useEffect, useCallback } from 'react';
import { useToast } from './useToast';

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
  is_starred: Boolean(entry.is_starred),
  view_count: typeof entry.view_count === 'number' ? entry.view_count : 0,
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

const EMPTY_STATS = { active: 0, archived: 0, total: 0, categories: 0 };

export function useEntries(params = {}) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [version, setVersion] = useState(0);
  const { show: showToast } = useToast();

  // Stable cache key for the params object
  const paramsKey = JSON.stringify({
    view: params.view || 'active',
    search: params.search || '',
    categoryId: params.categoryId || null,
    starred: typeof params.starred === 'boolean' ? params.starred : null,
    sort: params.sort || 'newest',
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
  });

  // Fetch the paginated list whenever params or version change
  useEffect(() => {
    let cancelled = false;
    const p = JSON.parse(paramsKey);
    const search = new URLSearchParams();
    search.set('view', p.view);
    if (p.search) search.set('search', p.search);
    if (p.categoryId) search.set('category_id', p.categoryId);
    if (typeof p.starred === 'boolean') search.set('starred', String(p.starred));
    search.set('sort', p.sort);
    search.set('limit', String(p.limit));
    search.set('offset', String(p.offset));

    setIsLoading(true);
    requestJson(`/api/knowledge?${search.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setEntries((data?.items || []).map(normalizeEntry));
        setTotal(data?.total || 0);
        setErrorMessage('');
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage(
          'Knowledge pages could not be loaded. Check that the API is running on port 8000.'
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [paramsKey, version]);

  // Fetch global stats independently of paged list
  useEffect(() => {
    let cancelled = false;
    requestJson('/api/knowledge/stats')
      .then((data) => {
        if (cancelled || !data) return;
        setStats(data);
      })
      .catch(() => {
        /* keep previous stats */
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

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
        category_id: formData.category_id || null,
      };
      try {
        await requestJson(path, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        refresh();
        showToast({
          type: 'success',
          message: isEdit ? 'Page updated.' : 'Page created.',
        });
      } catch (err) {
        showToast({
          type: 'error',
          message: err.message || 'Could not save page.',
          duration: 6000,
        });
        throw err;
      }
    },
    [refresh, showToast]
  );

  const restoreSilent = useCallback(
    async (entryId) => {
      await requestJson(`/api/knowledge/${entryId}/restore`, { method: 'POST' });
      refresh();
    },
    [refresh]
  );

  const archiveEntry = useCallback(
    async (entryId, summary = '') => {
      try {
        await requestJson(`/api/knowledge/${entryId}/archive`, { method: 'POST' });
        refresh();
        showToast({
          type: 'info',
          message: summary ? `Archived "${truncate(summary, 60)}"` : 'Page archived.',
          duration: 6000,
          action: {
            label: 'Undo',
            onClick: () => {
              restoreSilent(entryId).catch((err) =>
                showToast({
                  type: 'error',
                  message: err.message || 'Could not undo archive.',
                })
              );
            },
          },
        });
      } catch (err) {
        showToast({
          type: 'error',
          message: err.message || 'Could not archive page.',
        });
        throw err;
      }
    },
    [refresh, restoreSilent, showToast]
  );

  const restoreEntry = useCallback(
    async (entryId) => {
      try {
        await restoreSilent(entryId);
        showToast({ type: 'success', message: 'Page restored.' });
      } catch (err) {
        showToast({
          type: 'error',
          message: err.message || 'Could not restore page.',
        });
        throw err;
      }
    },
    [restoreSilent, showToast]
  );

  const toggleStar = useCallback(
    async (entryId) => {
      // Optimistic update for snappy feel
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, is_starred: !e.is_starred } : e))
      );
      try {
        await requestJson(`/api/knowledge/${entryId}/star`, { method: 'POST' });
        refresh();
      } catch (err) {
        // Roll back optimistic update
        setEntries((prev) =>
          prev.map((e) => (e.id === entryId ? { ...e, is_starred: !e.is_starred } : e))
        );
        showToast({
          type: 'error',
          message: err.message || 'Could not update star.',
        });
      }
    },
    [refresh, showToast]
  );

  return {
    entries,
    total,
    stats,
    isLoading,
    errorMessage,
    saveEntry,
    archiveEntry,
    restoreEntry,
    toggleStar,
    refresh,
  };
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
