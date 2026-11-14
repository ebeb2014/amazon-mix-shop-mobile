// Synthetic visual QA fixture. Only injected by the local development server.
(()=>{
const products=[['1','Robot aspirator cu stație de golire','A101',1200,'testat','11'],['2','Aspirator vertical Dreame H15 Pro','A102',1450,'resigilat','12'],['3','Set căști wireless Bluetooth','A103',90,'nou','13']].map(([id,name,code,price,condition,short_code])=>({id,name,code,price,condition,short_code,ean:'5901234123457',available:true,status:'In stoc',photos:[],detail_revision:0,condition_notes:''}));
let orders=[{id:'qa-order',number:18,customer:{name:'Client demonstrativ',phone:'0700000000',city:'București',county:'Sector 4',address:'Adresă demonstrativă'},items:[{...products[0],vat_rate:19}],status:'reserved',fulfillment:'new',goods_total:1200,shipping:25,advance:100,delivery:'curier',revision:2,created_at:'2026-11-14T11:00:00Z',notes:'Verificare accesorii înainte de ambalare.'}];
window.amsBackend={ready:true,identity:{role:'manager',primary_admin:true,user_id:'qa',owner_id:'qa',name:'DEMO · Date fictive'},photos:async()=>[],load:async()=>({state:{orders:[]}}),call:async(action,data={})=>{
 if(action==='product')return products.filter(p=>p.id===data.id);if(action==='list')return structuredClone(orders);if(action==='catalog')return products;if(action==='sessions')return [{id:'qa-session',name:'Live demonstrativ'}];if(action==='get')return structuredClone(orders.find(o=>o.id===data.id));if(action==='team')return [{id:'qa',name:'Cont demonstrativ',role:'manager',email:'demo@example.test',active:true,primary:true}];if(action==='audit')return [{actor_name:'Operator demonstrativ',action:'reserve',created_at:'2026-11-14T11:00:00Z',detail:{}}];
 if(action==='save'){const o={...data,items:data.items.map(p=>({...products.find(x=>x.id===p.id),price:p.price})),number:19,goods_total:data.items.reduce((s,x)=>s+x.price,0),status:'draft',fulfillment:'new',revision:1,created_at:new Date().toISOString()};orders.push(o);return o;}
 if(action==='reserve'){const o=orders.find(x=>x.id===data.id);o.status='reserved';o.revision++;return o;}
 throw new Error('Operațiune dezactivată în demonstrația locală.');
}};
document.body.classList.remove('signed-out');document.getElementById('account-label').textContent='DEMO · Date fictive';window.dispatchEvent(new Event('ams:signed-in'));
})();
