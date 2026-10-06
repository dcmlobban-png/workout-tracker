// Keeps the app opening with no signal. The page itself is fetched fresh whenever there is a
// connection, so a new version shows up on the next open; the cached copy is only the fallback.
const CACHE = 'tracker-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    // Saving goes straight to the network: a cached answer there would be a lie.
    if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
        fetch(e.request).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
            return res;
        }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
    );
});
