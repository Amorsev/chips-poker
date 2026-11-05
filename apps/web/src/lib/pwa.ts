/**
 * Registers the service worker (public/sw.js) in production builds only: in
 * development it would cache Vite modules and hide hot updates.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
