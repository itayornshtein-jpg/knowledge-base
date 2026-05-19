import { useState, useEffect, useCallback } from 'react';
import { requestJson } from './useEntries';

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await requestJson('/api/categories');
      setCategories(data || []);
    } catch {
      // Non-fatal — categories just won't show
      setCategories([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createCategory = useCallback(
    async ({ name, color = '#6366f1', description = '' }) => {
      await requestJson('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, description }),
      });
      await load();
    },
    [load]
  );

  const deleteCategory = useCallback(
    async (id) => {
      await requestJson(`/api/categories/${id}`, { method: 'DELETE' });
      await load();
    },
    [load]
  );

  return { categories, isLoading, createCategory, deleteCategory, reload: load };
}
