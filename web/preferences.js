'use strict';
// Apply preferences before CSS renders, including when localStorage is unavailable.
(() => {
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const preference = read('logview.theme');
  const theme = ['light', 'dark'].includes(preference) ? preference : 'system';
  const root = document.documentElement;
  root.dataset.themePreference = theme;
  root.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  root.dataset.sidebarCollapsed = String(matchMedia('(max-width: 760px)').matches || read('logview.sidebarCollapsed') === 'true');
})();
