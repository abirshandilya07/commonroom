import {flushSync} from 'react-dom';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
export type Theme = 'light' | 'dark';
const key = 'commonroom-theme';
function systemTheme(): Theme { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function preference(): Theme | null {
  try { const value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : null; }
  catch { return null; }
}
const ThemeContext = createContext<{theme: Theme; toggle: () => void} | null>(null);
export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const transition = useRef<ViewTransition | null>(null);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#16121c' : '#36143e');

  }, [theme]);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const change = () => { if (!preference()) setTheme(systemTheme()); };
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) setTheme(preference() || systemTheme()); };
    system.addEventListener('change', change);
    window.addEventListener('storage', sync);
    return () => { system.removeEventListener('change', change); window.removeEventListener('storage', sync); };
  }, []);
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(key, next); } catch { /* the toggle still works for this page */ }
    transition.current?.skipTransition();
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition.current = document.startViewTransition(() => flushSync(() => setTheme(next)));
      void transition.current.finished.catch(() => {});
    } else setTheme(next);
  };
  return <ThemeContext.Provider value={{theme, toggle}}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme requires ThemeProvider');
  return context;
}
