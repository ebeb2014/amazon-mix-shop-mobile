import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../',import.meta.url);

test('app assets and installed identity stay within the separate Live path',async()=>{
  const html=await readFile(new URL('index.html',root),'utf8');
  const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
  assert.equal(manifest.id,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
  assert.equal(new URL(manifest.start_url,'https://example.test/amazon-mix-shop-mobile/live/').pathname,'/amazon-mix-shop-mobile/live/');
  for(const [,ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(ref.startsWith('#'))continue;
    assert.ok(ref.startsWith('./')||ref==='../config.js','Unexpected root or external asset '+ref);
    await access(new URL(ref,root));
  }
  assert.ok(!/chatgpt|signin-with/i.test(html));
  assert.ok(html.includes('autocomplete="current-password"'));
  for(const icon of manifest.icons)await access(new URL(icon.src,root));
});

test('a pending order response cannot repopulate private data after sign-out',async()=>{
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,value:'',open:false,classList:{toggle(){}},addEventListener(){},close(){this.open=false;},replaceChildren(){this.innerHTML='';},querySelector(){return node(id+'-submit');}});
    return nodes.get(id);
  };
  const events={};let resolveLoad;
  const window={amsBackend:{ready:false,load:()=>new Promise(resolve=>{resolveLoad=resolve;})},addEventListener:(name,fn)=>{events[name]=fn;}};
  runInNewContext(await readFile(new URL('app.js',root),'utf8'),{window,document:{getElementById:node,addEventListener(){},querySelectorAll:()=>[]},navigator:{onLine:true},location:{hash:'#comenzi'},Intl,URL,crypto,structuredClone});
  window.amsBackend.ready=true;events['ams:signed-in']();
  window.amsBackend.ready=false;events['ams:signed-out']();
  resolveLoad({revision:3,state:{products:[{id:'p',name:'Private product',total:1}],orders:[],lives:[]}});
  await new Promise(setImmediate);
  assert.equal(node('content').innerHTML,'');assert.equal(node('metrics').innerHTML,'');
});

test('service worker ignores account APIs and other apps; only its own offline cache is removed',async()=>{
  const handlers={};const removed=[];let cached;
  const self={registration:{scope:'https://example.test/amazon-mix-shop-mobile/live/'},addEventListener:(event,fn)=>{handlers[event]=fn;},clients:{claim:async()=>{}},skipWaiting:async()=>{}};
  const caches={keys:async()=>['ams-mobile-v11','ams-live-offline-v0','ams-live-offline-v1'],delete:async key=>removed.push(key),open:async()=>({add:async url=>{cached=url;}})};
  runInNewContext(await readFile(new URL('sw.js',root),'utf8'),{self,caches,URL,Response});
  let pending;handlers.install({waitUntil:p=>{pending=p;}});await pending;
  assert.equal(cached,'https://example.test/amazon-mix-shop-mobile/live/offline.html');
  handlers.activate({waitUntil:p=>{pending=p;}});await pending;
  assert.deepEqual(removed,['ams-live-offline-v0']);
  for(const [url,mode,method] of [['https://database.example/auth/v1/token','cors','POST'],['https://database.example/rest/v1/rpc/ams_live_get_state','cors','POST'],['https://example.test/amazon-mix-shop-mobile/','navigate','GET']])handlers.fetch({request:{url,mode,method},respondWith(){assert.fail('Unrelated request intercepted');}});
});
