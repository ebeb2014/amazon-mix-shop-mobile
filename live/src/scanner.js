import {BrowserMultiFormatReader} from '@zxing/browser';
let controls,epoch=0;
const dialog=document.getElementById('scanner');
function stop(){epoch++;controls?.stop();controls=null;const video=document.getElementById('scan-video');video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;if(dialog.open)dialog.close();}
window.amsScan=async callback=>{
 stop();const generation=epoch;dialog.showModal();document.getElementById('scan-message').textContent='Îndreaptă camera spre etichetă.';
 try{
  const active=await new BrowserMultiFormatReader().decodeFromConstraints({video:{facingMode:{ideal:'environment'}},audio:false},document.getElementById('scan-video'),(result,error,ctrl)=>{
   if(generation!==epoch){ctrl.stop();return;}
   if(result){stop();ctrl.stop();callback(result.getText());}
  });
  if(generation!==epoch)active.stop();else controls=active;
 }catch(error){if(generation===epoch)document.getElementById('scan-message').textContent='Camera nu este disponibilă. Verifică permisiunea sau introdu codul manual.';}
};
document.getElementById('stop-scan').addEventListener('click',stop);dialog.addEventListener('cancel',stop);window.addEventListener('ams:signed-out',stop);

window.amsScanPhoto=async(file,callback)=>{
 stop();
 const generation=epoch;
 dialog.showModal();
 document.getElementById('scan-message').textContent='Se citește codul din fotografie…';
 const url=URL.createObjectURL(file);
 try{
  const result=await new BrowserMultiFormatReader().decodeFromImageUrl(url);
  if(generation!==epoch)return;
  stop();callback(result.getText());
 }catch{
  if(generation===epoch)document.getElementById('scan-message').textContent='Codul nu se poate citi. Încearcă o fotografie clară, cu toate barele vizibile, sau introdu codul manual.';
 }finally{URL.revokeObjectURL(url);}
};
