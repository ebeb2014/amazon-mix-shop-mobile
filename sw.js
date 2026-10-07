const CACHE = "ams-mobile-v10";
const ASSETS = ["./","./index.html","./styles.css?v=10","./app.js?v=10","./config.js","./manifest.webmanifest","./icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: "no-store" }).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy));
      return resp;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
  );
});


self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "Amazon Mix Shop", body: "Ai o cerere nouă de aprobare." };
  }

  const title = data.title || "Amazon Mix Shop";
  const options = {
    body: data.body || "Ai o cerere nouă de aprobare.",
    tag: data.tag || "ams-approval",
    renotify: true,
    data: {
      url: data.url || "./?approval=1",
      approval_id: data.approval_id || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "./";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(windowClients => {
        for (const client of windowClients) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return clients.openWindow(target);
      })
  );
});
