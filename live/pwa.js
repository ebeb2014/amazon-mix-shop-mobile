(function installApp(){
  const $=id=>document.getElementById(id);
  let prompt=null;
  const installed=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const update=()=>{$('install-app').hidden=installed();$('install-login').hidden=installed();$('native-install').hidden=!prompt;};
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;update();});
  window.addEventListener('appinstalled',()=>{prompt=null;update();$('install-dialog').close();});
  for(const id of ['install-app','install-login'])$(id).onclick=()=>{$('install-dialog').showModal();};
  for(const id of ['close-install','done-install'])$(id).onclick=()=>{$('install-dialog').close();};
  $('native-install').onclick=async()=>{
    if(!prompt)return;
    const current=prompt;prompt=null;update();
    try{await current.prompt();await current.userChoice;}catch{/* Manual instructions remain available. */}
  };
  function network(){
    $('offline-notice').hidden=navigator.onLine;
    document.body.classList.toggle('is-offline',!navigator.onLine);
  }
  window.addEventListener('online',network);window.addEventListener('offline',network);
  network();update();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
})();
