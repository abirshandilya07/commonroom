import {flushSync} from 'react-dom';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
export type Theme = 'light' | 'dark';
const key = 'commonroom-theme';
function systemTheme(): Theme { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function preference(): Theme | null {
  try { const value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : null; }
  catch { return null; }
}
// Color palettes are independent of light/dark; each defines both variants in index.css.
export const PALETTES = [
  {id: 'grape', name: 'Grape', swatch: ['#7041a0', '#c4a0ef']},
  {id: 'ocean', name: 'Ocean', swatch: ['#1f62b8', '#8ec0ff']},
  {id: 'forest', name: 'Forest', swatch: ['#1d7a55', '#7fd8af']},
  {id: 'sunset', name: 'Sunset', swatch: ['#c2410c', '#ffab7a']},
  {id: 'rose', name: 'Rose', swatch: ['#be185d', '#ff9cc6']},
  {id: 'slate', name: 'Slate', swatch: ['#3f5168', '#a9bcd4']},
] as const;
export type Palette = typeof PALETTES[number]['id'];
const paletteKey = 'commonroom-palette';
function savedPalette(): Palette {
  try { const value = localStorage.getItem(paletteKey); return PALETTES.some(p => p.id === value) ? value as Palette : 'grape'; } catch { return 'grape'; }
}
const ThemeContext = createContext<{theme: Theme; toggle: () => void; palette: Palette; setPalette: (p: Palette) => void} | null>(null);
export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const transition = useRef<ViewTransition | null>(null);
  const [palette, setPaletteState] = useState<Palette>(savedPalette);
  useLayoutEffect(() => {if (palette === 'grape') delete document.documentElement.dataset.palette; else document.documentElement.dataset.palette = palette;}, [palette]);
  const setPalette = (next: Palette) => {try {localStorage.setItem(paletteKey, next);} catch {/* this page still changes */} setPaletteState(next);};
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#16121c' : '#36143e');

  }, [theme]);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const change = () => { if (!preference()) setTheme(systemTheme()); };
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) setTheme(preference() || systemTheme()); if (event.key === paletteKey || event.key === null) setPaletteState(savedPalette()); };
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
  return <ThemeContext.Provider value={{theme, toggle, palette, setPalette}}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme requires ThemeProvider');
  return context;
}
