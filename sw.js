// v2 cleanup worker: removes the previous cache-first worker, then unregisters itself.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('voicecraft-')).map(k => caches.delete(k)));
  await self.registration.unregister();
  const clientsList = await self.clients.matchAll({ type: 'window' });
  for (const client of clientsList) client.navigate(client.url);
})()));
