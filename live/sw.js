const CACHE='ams-live-offline-v1';
const offlineUrl=new URL('offline.html',self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add(offlineUrl)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ams-live-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||event.request.mode!=='navigate'||!url.href.startsWith(self.registration.scope))return;
  event.respondWith(fetch(event.request).catch(async()=>await caches.match(offlineUrl)||new Response('Conectează-te la internet pentru a deschide Amazon Mix Shop.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});

self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification('Amazon Mix Shop',{body:data.body||'Actualizare în aplicația Live',tag:data.tag||'ams-live',icon:new URL('icons/icon-192.png',self.registration.scope).href,data:{url:new URL('#notificari',self.registration.scope).href}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL('#notificari',self.registration.scope).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  const client=clients.find(c=>c.url.startsWith(self.registration.scope));
  if(client){await client.navigate(url);return client.focus();}return self.clients.openWindow(url);
 }));
});
