import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const prefix='/amazon-mix-shop-mobile/live/';
const root=new URL('../',import.meta.url);
const files=new Set(['index.html','app.js','auth.js','catalog.js','pwa.js','style.css','manifest.webmanifest','sw.js','offline.html','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png']);
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webmanifest:'application/manifest+json'};
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const port=Number(arg('--port')||process.env.PORT||4173),host=arg('--host')||'127.0.0.1';
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(302,{Location:prefix}).end();return;}
  if(path==='/__qa/mobile'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><title>AMS Live · Mobile QA</title><style>body{background:#ddd;margin:20px}iframe{width:390px;height:844px;border:0}</style><iframe title="Aplicație pe telefon" src="'+prefix+'"></iframe>');return;}
  let file=path.startsWith(prefix)?path.slice(prefix.length)||'index.html':null;
  if(path==='/amazon-mix-shop-mobile/config.js')file='../config.js';
  if(!file||(!files.has(file)&&file!=='../config.js')){res.writeHead(404).end();return;}
  try{res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]+'; charset=utf-8','Cache-Control':'no-store'}).end(await readFile(new URL(file,root)));}
  catch{res.writeHead(404).end();}
}).listen(port,host,()=>console.log('AMS Live development server ready'));
