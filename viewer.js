"use strict";
const cfg=window.AMS_CONFIG;
const $=id=>document.getElementById(id);
let token=null,offset=0;
const PAGE_SIZE=100;
const fmt=n=>Number(n||0).toLocaleString("ro-RO",{minimumFractionDigits:2,maximumFractionDigits:2})+" lei";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function msg(value,error=false){$("status").textContent=value||"";$("status").className=error?"err":"muted";}
function localDate(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
async function api(path,options={}){
  const r=await fetch(cfg.supabaseUrl+path,{...options,headers:{"apikey":cfg.publishableKey,"Content-Type":"application/json",...(token?{"Authorization":"Bearer "+token}:{}),...(options.headers||{})}});
  const v=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(v?.message||v?.error_description||("HTTP "+r.status));
  return v;
}
async function signIn(){
  const email=$("email").value.trim(),password=$("password").value;
  if(!email||!password)throw new Error("Completează emailul și parola contului de vizualizare.");
  const result=await api("/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify({email,password})});
  token=result.access_token;
  // No session stored on disk on this restricted device.
  $("password").value="";
  await openDashboard();
}
async function openDashboard(){
  $("login").classList.add("hidden");$("dashboard").classList.remove("hidden");$("logout").classList.remove("hidden");
  await load(true);
}
async function load(reset){
  if(reset){offset=0;$("sales").replaceChildren();}
  const result=await api("/rest/v1/rpc/ams_viewer_sales",{method:"POST",body:JSON.stringify({p_from:$("from").value,p_to:$("to").value,p_limit:PAGE_SIZE,p_offset:offset})});
  const items=result.items||[];
  $("total").textContent=fmt(result.summary?.total);
  $("count").textContent=String(result.summary?.count||0);
  $("cash").textContent=fmt(result.summary?.cash);
  $("card").textContent=fmt(result.summary?.card);
  const fragment=document.createDocumentFragment();
  for(const item of items){
    const el=document.createElement("div");el.className="sale";
    el.innerHTML='<strong>'+esc(item.product_name||item.product_code||"Produs")+'</strong>'+
      '<div class="price">'+fmt(item.sale_price)+'</div>'+
      '<div class="muted">Cantitate: '+esc(item.quantity??1)+' · '+esc(item.sale_date||"-")+
      ' · '+esc(item.sale_time||"Ora neînregistrată")+'</div>'+
      '<div class="muted">Operator: '+esc(item.operator_name||"Neînregistrat")+
      ' · '+esc(item.payment_method||"-")+'</div>';
    fragment.append(el);
  }
  $("sales").append(fragment);offset+=items.length;
  $("more").classList.toggle("hidden",items.length<PAGE_SIZE);
  if(reset&&!items.length)$("sales").textContent="Nu există vânzări în perioada selectată.";
  msg("");
}
$("signin").onclick=()=>signIn().catch(e=>msg(e.message,true));
$("refresh").onclick=()=>load(true).catch(e=>msg(e.message,true));
$("more").onclick=()=>load(false).catch(e=>msg(e.message,true));
$("logout").onclick=()=>{token=null;offset=0;$("dashboard").classList.add("hidden");$("login").classList.remove("hidden");$("logout").classList.add("hidden");$("sales").replaceChildren();msg("");};
const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),1);
$("from").value=localDate(start);$("to").value=localDate(now);
