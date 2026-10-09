// Runs before React/CSS paints, avoiding a light flash on a dark preference.
(() => {
  let saved;
  try { saved = localStorage.getItem('commonroom-theme'); } catch { /* storage can be unavailable */ }
  const theme = saved === 'light' || saved === 'dark' ? saved
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try { const palette = localStorage.getItem('commonroom-palette'); if (palette) document.documentElement.dataset.palette = palette; } catch { /* default palette */ }
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#16121c' : '#36143e');
})();
