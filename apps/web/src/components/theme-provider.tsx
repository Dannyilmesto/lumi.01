'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme | null;
  toggleTheme: () => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let storedTheme: string | null = null;
    try {
      storedTheme = window.localStorage.getItem('lumi-theme');
    } catch {
      // Theme still follows the operating-system preference if storage is unavailable.
    }
    const initialTheme: Theme =
      storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    document.documentElement.dataset.theme = initialTheme;
    setTheme(initialTheme);
  }, []);

  function toggleTheme() {
    const currentTheme =
      theme ??
      (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem('lumi-theme', nextTheme);
    } catch {
      // Apply the selection for this session even when persistence is unavailable.
    }
    setTheme(nextTheme);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeToggle deve essere usato dentro ThemeProvider.');

  const { theme, toggleTheme } = context;
  const nextTheme = theme === null ? null : theme === 'dark' ? 'chiaro' : 'scuro';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={nextTheme ? `Attiva modalità ${nextTheme}` : 'Cambia tema'}
      title={nextTheme ? `Attiva modalità ${nextTheme}` : 'Cambia tema'}
      aria-pressed={theme === 'dark'}
      className="theme-toggle"
      suppressHydrationWarning
    >
      <svg
        className="theme-icon theme-icon-sun"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      </svg>
      <svg
        className="theme-icon theme-icon-moon"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M20.2 15.4A8.6 8.6 0 0 1 8.6 3.8 8.6 8.6 0 1 0 20.2 15.4Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
      <span suppressHydrationWarning>
        {theme === null ? 'Tema' : theme === 'dark' ? 'Chiaro' : 'Scuro'}
      </span>
    </button>
  );
}
