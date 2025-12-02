if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const forceActivate = (registration) => {
      const worker = registration.waiting || registration.installing || registration.active;
      if (worker) {
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    };

    navigator.serviceWorker
      .register('/pwa/service-worker.js', { scope: '/' })
      .then((registration) => {
        // Force the newest SW to take control immediately.
        forceActivate(registration);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        let hasReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (hasReloaded) return;
          hasReloaded = true;
          window.location.reload();
        });
      })
      .catch((error) => {
        console.error('Service worker registration failed', error);
      });
  });
}
