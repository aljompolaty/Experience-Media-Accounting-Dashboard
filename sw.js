/* Service worker: keeps the app usable offline.
   Bump VERSION together with the ?v= query in index.html whenever a CSS/JS file changes. */

const VERSION = '4.1';
const CACHE = `xm-dashboard-v${VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    `./css/app.css?v=${VERSION}`,
    ...['util', 'store', 'calc', 'ui', 'forms', 'views', 'audit', 'sync', 'share', 'print', 'app'].map(f => `./js/${f}.js?v=${VERSION}`),
    './brand/logo-horizontal-color.webp',
    './brand/logo-horizontal-reverse.webp',
    './brand/logo-mark-color.webp',
    './fonts/thmanyahsans-Regular.woff2',
    './fonts/thmanyahsans-Medium.woff2',
    './fonts/thmanyahsans-Bold.woff2',
    './fonts/thmanyahsans-Black.woff2',
    './icons/icon-192.png',
    './icons/apple-touch-icon.png'
];

// Pinned third-party libraries, cached on first use so sync and export also work offline.
const CDN_LIBS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('xm-dashboard-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Pages: network first so an update is picked up right away, cached copy when offline.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(res => { caches.open(CACHE).then(c => c.put('./index.html', res.clone())); return res; })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Versioned app files and pinned libraries never change at the same URL: cache first.
    if (url.origin === self.location.origin || CDN_LIBS.includes(req.url)) {
        event.respondWith(
            caches.match(req).then(hit => hit || fetch(req).then(res => {
                if (res.ok || res.type === 'opaque') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                }
                return res;
            }))
        );
    }
    // Everything else (the Supabase API) goes straight to the network.
});
