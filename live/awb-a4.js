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
 let rendererPromise;
 function loadRenderer(){
  if(window.pdfjsLib?.getDocument)return Promise.resolve(window.pdfjsLib);
  if(rendererPromise)return rendererPromise;
  rendererPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
   script.onload=()=>{
    if(!window.pdfjsLib?.getDocument){reject(new Error('Motorul de imprimare PDF nu este disponibil.'));return;}
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    resolve(window.pdfjsLib);
   };
   script.onerror=()=>reject(new Error('Nu se poate încărca motorul de imprimare din Chrome.'));
   document.head.appendChild(script);
  }).catch(error=>{rendererPromise=null;throw error;});
  return rendererPromise;
 }
 async function printPreview(printWindow,blobUrl,filename){
  if(!printWindow||printWindow.closed)return false;
  // Convert PDF to high-resolution image instead of embedding it in a PDF viewer.
  // This bypasses Chrome's "always download PDFs" and the Windows Adobe association.
  const lib=await loadRenderer();
  const task=lib.getDocument({url:blobUrl});
  const pdf=await task.promise;
  if(pdf.numPages!==1)throw new Error('AWB-ul trebuie să aibă o singură pagină.');
  const page=await pdf.getPage(1);
  const viewport=page.getViewport({scale:4});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Chrome nu poate pregăti pagina pentru imprimare.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx,viewport,background:'#fff'}).promise;
  const image=canvas.toDataURL('image/png');
  try{await pdf.destroy();}catch{}
  if(printWindow.closed)return false;
  const doc=printWindow.document;
  doc.open();
  doc.write('<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Imprimă AWB GLS A4</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#e7e7e7;font:15px Arial,sans-serif}header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px;background:white}button,a{font:inherit;padding:8px 12px;cursor:pointer}#sheet{display:block;width:210mm;height:297mm;margin:18px auto;background:white;box-shadow:0 2px 15px #999}p{margin:0}@media print{html,body{margin:0;padding:0;background:white}header{display:none!important}#sheet{width:210mm;height:297mm;margin:0;box-shadow:none;page-break-after:avoid}}</style></head><body><header><button id="print" type="button">Imprimă pe A4</button><a id="download" download>Descarcă PDF centrat</a><p id="status">Previzualizare AWB, fără Adobe</p></header><img id="sheet" alt="AWB GLS centrat A4"></body></html>');
  doc.close();
  const img=doc.getElementById('sheet');
  const button=doc.getElementById('print');
  const dl=doc.getElementById('download');
  const status=doc.getElementById('status');
  dl.href=blobUrl;dl.download=filename;
  const print=()=>{try{printWindow.focus();printWindow.print();}catch(error){status.textContent='Nu se poate deschide imprimarea automat. Apasă Ctrl+P.';}};
  button.addEventListener('click',print);
  img.onload=()=>{
   status.textContent='Etichetă centrată pe A4. Dacă nu apare dialogul, apasă Imprimă pe A4.';
   setTimeout(()=>{if(!printWindow.closed)print();},400);
  };
  img.onerror=()=>{status.textContent='Previzualizarea nu s-a încărcat. Folosește butonul de descărcare PDF.';};
  img.src=image;
  return true;
 }
 async function prepareFile(file){
  if(!file||file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw new Error('Alege fișierul PDF descărcat de la GLS.');
  return prepareBytes(await file.arrayBuffer());
 }
 window.amsGLSA4={prepare,prepareFile,prepareBase64,printPreview};
})();
