const CACHE_NAME = 'esqueletos-pwa-v28';
const OFFLINE_DATA_CACHE = 'esqueletos-offline-datasets-v1';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/responsive.css',
  '/script.js',
  '/pwa/pwa.js',
  '/pwa/manifest.webmanifest',
  '/ressources/logos/iphes.png',
  '/ressources/logos/cerca.png',
  '/ressources/logos/ministerio.jpg',
  '/ressources/background/blue.jpg',
  '/ressources/model/cranium.obj',
  '/ressources/model/baked_mesh_63bf1aaf.mtl',
  '/ressources/model/baked_mesh_63bf1aaf_tex0.jpeg',
  '/ressources/model/baked_mesh_63bf1aaf_ao0.jpeg',
  '/ressources/model/baked_mesh_63bf1aaf_roughness0.jpeg',
  '/ressources/model/baked_mesh_63bf1aaf_norm0.jpeg',
  '/ressources/icons/icon-192.png',
  '/ressources/icons/icon-512.png',
  '/app/index.html',
  '/app/public/css/base.css',
  '/app/public/css/dialogs.css',
  '/app/public/css/layout.css',
  '/app/public/css/top-bar.css',
  '/app/public/css/sidebar.css',
  '/app/public/css/viewer.css',
  '/app/public/css/responsive.css',
  '/app/public/css/tokens.css',
  '/app/public/css/styles.css',
  '/app/public/css/metadata.css',
  '/app/public/css/toolbar.css',
  '/app/public/css/selectors.css',
  '/app/public/js/app.js',
  '/app/public/js/data/uberonSynonymsClient.js',
  '/app/public/js/data/dataverseClient.js',
  '/app/public/js/i18n/translator.js',
  '/app/public/js/state/store.js',
  '/app/public/js/state/actions.js',
  '/app/public/js/state/selectors.js',
  '/app/public/js/utils/defaultFetch.js',
  '/app/public/js/sidebar.js',
  '/app/public/js/options.js',
  '/app/public/js/about.js',
  '/app/public/js/3d/environment.js',
  '/app/public/js/3d/scaleReference.js',
  '/app/public/js/3d/comparison.js',
  '/app/public/js/3d/clipping.js',
  '/app/public/js/3d/measurements.js',
  '/app/public/js/3d/rotation.js',
  '/app/public/js/3d/anaglyphEffect.js',
  '/app/public/js/3d/labels.js',
  '/app/public/js/3d/export.js',
  '/app/public/js/3d/viewer3d.js',
  '/app/public/js/3d/viewerApi.js',
  '/app/public/js/3d/materials.js',
  '/app/public/js/ui/search.js',
  '/app/public/js/ui/modelController.js',
  '/app/public/js/ui/loadingOverlay.js',
  '/app/public/js/ui/metadata.js',
  '/app/public/js/ui/tooltips.js',
  '/app/public/js/ui/offlineDownloads.js',
  '/app/public/js/data/offlineManager.js',
  '/app/public/js/ui/materialControls.js',
  '/app/public/js/ui/interfaceControls.js',
  '/app/public/js/ui/controllers.js',
  '/app/public/js/ui/interface.js',
  '/app/public/i18n/en.json',
  '/app/public/i18n/es.json',
  '/app/public/i18n/ca.json',
  '/app/public/i18n/fr.json',
  '/app/public/ressources/cc.png',
  '/app/public/ressources/ministerio.png',
  '/app/public/ressources/cerca.png',
  '/app/public/ressources/fecyt.jpg',
  '/app/public/ressources/iphes.png',
  '/app/public/ressources/ipheslight.png',
  '/app/public/ressources/banner.jpg',
  '/app/public/ressources/throbber.svg'
];

const FONT_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0'
];

const isDatafileRequest = (url) => {
  try {
    return new URL(url).pathname.includes('/access/datafile/');
  } catch (error) {
    return false;
  }
};

const isOfflineProxyRequest = (url) => {
  try {
    return new URL(url).pathname.startsWith('/offline-proxy');
  } catch (error) {
    return false;
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await Promise.allSettled(FONT_ASSETS.map((url) => cache.add(url)));
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const allowList = new Set([CACHE_NAME, OFFLINE_DATA_CACHE]);
      const deletions = keys
        .filter((key) => !allowList.has(key))
        .map((key) => caches.delete(key));
      return Promise.all(deletions);
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  const requestURL = new URL(event.request.url);
  const isFont = requestURL.origin.includes('fonts.googleapis.com') || requestURL.origin.includes('fonts.gstatic.com');
  const isDatafile = isDatafileRequest(event.request.url);
  const isOfflineProxy = isOfflineProxyRequest(event.request.url);

  if (isOfflineProxy) {
    event.respondWith(
      (async () => {
        const target = requestURL.searchParams.get('url');
        if (!target) {
          return Response.error();
        }
        const offlineCache = await caches.open(OFFLINE_DATA_CACHE);
        const cached = await offlineCache.match(target, { ignoreVary: true });
        if (cached) {
          return cached;
        }
        try {
          const response = await fetch(target, { mode: 'cors' });
          if (response && response.status === 200) {
            offlineCache.put(target, response.clone());
          }
          return response;
        } catch (error) {
          const fallback = await caches.match(target);
          if (fallback) {
            return fallback;
          }
          return Response.error();
        }
      })()
    );
    return;
  }

  if (isDatafile) {
    event.respondWith(
      (async () => {
        const offlineCache = await caches.open(OFFLINE_DATA_CACHE);
        const cached = await offlineCache.match(event.request, { ignoreVary: true });
        if (cached) {
          return cached;
        }
        try {
          const response = await fetch(event.request);
          if (response && response.status === 200) {
            offlineCache.put(event.request, response.clone());
          }
          return response;
        } catch (error) {
          const fallback = await caches.match(event.request);
          if (fallback) {
            return fallback;
          }
          throw error;
        }
      })()
    );
    return;
  }

  if (isFont) {
    event.respondWith(
      caches.match(event.request).then((cachedFont) => {
        if (cachedFont) {
          return cachedFont;
        }
        return fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((response) => {
          const shouldCache =
            response &&
            response.status === 200 &&
            (response.type === 'basic' || response.type === 'cors');

          if (shouldCache) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }

          return response;
        })
        .catch(() => {
          if (isNavigation) {
            const fallback = requestURL.pathname.startsWith('/app/') ? '/app/index.html' : '/index.html';
            return caches.match(fallback);
          }
          return caches.match('/index.html');
        });
    })
  );
});
