'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
export async function profileFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'Risposta del server non valida.' }));
  if (!response.ok)
    throw new Error(
      data.error ||
        (response.status === 401
          ? 'La sessione è scaduta. Accedi di nuovo.'
          : 'Operazione non completata.'),
    );
  return data as T;
}
export function useProfileResource<T>(path: string, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    try {
      const value = await profileFetch<T>(path);
      if (version === generation.current) {
        setData(value);
        setError('');
      }
    } catch (error) {
      if (version === generation.current)
        setError(
          error instanceof Error ? error.message : 'Caricamento non riuscito.',
        );
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    setData(null);
    void reload();
    const timer = interval
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void reload();
        }, interval)
      : null;
    const onChanged = () => {
      void reload();
    };
    window.addEventListener('lumi:data-changed', onChanged);
    return () => {
      invalidate();
      if (timer) window.clearInterval(timer);
      window.removeEventListener('lumi:data-changed', onChanged);
    };
  }, [reload, interval, invalidate]);
  return { data, setData, error, setError, loading, reload };
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Operazione non completata.';
}
