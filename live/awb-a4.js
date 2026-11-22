/* Center standard GLS A4 landscape label on portrait A4 without resizing barcode. */
(() => {
 'use strict';
 let libraryPromise;
 function loadLibrary(){
  if(window.PDFLib?.PDFDocument)return Promise.resolve(window.PDFLib);
  if(libraryPromise)return libraryPromise;
  libraryPromise=new Promise((resolve,reject)=>{
   const el=document.createElement('script');
   el.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
   el.onload=()=>window.PDFLib?.PDFDocument?resolve(window.PDFLib):reject(new Error('Biblioteca PDF indisponibilă'));
   el.onerror=()=>reject(new Error('Nu se poate încărca biblioteca PDF'));
   document.head.appendChild(el);
  }).catch(e=>{libraryPromise=null;throw e;});
  return libraryPromise;
 }
 async function prepareBytes(bytes){
  const lib=await loadLibrary();
  const source=await lib.PDFDocument.load(bytes);
  if(source.getPageCount()!==1)throw new Error('Număr neașteptat de pagini în etichetă');
  const src=source.getPages()[0],{width,height}=src.getSize();
  if(width<820||width>860||height<575||height>620)throw new Error('Format GLS diferit de A4 landscape');
  const output=await lib.PDFDocument.create();
  const labelWidth=450,labelHeight=300;
  const embedded=await output.embedPage(src,{left:0,bottom:height-labelHeight,right:labelWidth,top:height});
  const page=output.addPage([595.28,841.89]);
  page.drawPage(embedded,{x:(595.28-labelWidth)/2,y:(841.89-labelHeight)/2,width:labelWidth,height:labelHeight});
  return URL.createObjectURL(new Blob([await output.save()],{type:'application/pdf'}));
 }
 async function prepare(url){
  const response=await fetch(url,{credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error('Eroare PDF GLS: '+response.status);
  return prepareBytes(await response.arrayBuffer());
 }
 async function prepareBase64(base64){
  if(typeof base64!=='string'||base64.length<8||base64.length>15000000)throw new Error('Răspuns PDF GLS invalid.');
  const binary=atob(base64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return prepareBytes(bytes);
 }
 function printPreview(pdfWindow,blobUrl,filename){
  if(!pdfWindow||pdfWindow.closed)return false;
  const doc=pdfWindow.document;
  doc.open();
  doc.write('<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Imprimă AWB GLS centrat A4</title><style>body{margin:0;font:16px Arial,sans-serif;background:#f4f4f4}header{background:white;padding:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}button,a{font:inherit;padding:9px 14px;border-radius:6px;cursor:pointer}iframe{border:0;width:100%;height:calc(100vh - 75px)}p{margin:0}</style></head><body><header><button id="print">Imprimă AWB A4</button><a id="download" download>Descarcă PDF centrat</a><p id="status">Se deschide previzualizarea...</p></header><iframe id="pdf" title="AWB GLS centrat pe A4"></iframe></body></html>');
  doc.close();
  const frame=doc.getElementById('pdf'),button=doc.getElementById('print'),download=doc.getElementById('download'),status=doc.getElementById('status');
  download.href=blobUrl;download.download=filename;
  const print=()=>{try{frame.contentWindow.focus();frame.contentWindow.print();}catch(e){status.textContent='Apasă Ctrl+P în previzualizarea PDF.';}};
  button.addEventListener('click',print);
  frame.addEventListener('load',()=>{
   status.textContent='AWB centrat pe A4. Dacă nu apare fereastra de imprimare, apasă „Imprimă AWB A4”.';
   setTimeout(print,350);
  },{once:true});
  frame.src=blobUrl;
  return true;
 }
 async function prepareFile(file){
  if(!file||file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw new Error('Alege fișierul PDF descărcat de la GLS.');
  return prepareBytes(await file.arrayBuffer());
 }
 window.amsGLSA4={prepare,prepareFile,prepareBase64,printPreview};
})();
