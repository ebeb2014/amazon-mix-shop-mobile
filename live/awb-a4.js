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
 async function prepareFile(file){
  if(!file||file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw new Error('Alege fișierul PDF descărcat de la GLS.');
  return prepareBytes(await file.arrayBuffer());
 }
 window.amsGLSA4={prepare,prepareFile};
})();
