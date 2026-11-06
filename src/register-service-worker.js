// Register only for a built site, so Vite development remains free of stale workers.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(error => {
      console.warn('Offline page registration failed:', error);
    });
  }, {once: true});
}
