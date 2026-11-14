// MyGLS Romania API: https://api.mygls.ro/docs/MyGLS_API.pdf
export function glsDate(value) {
 const time=typeof value==='number'?value:Date.parse(value+'T12:00:00+02:00');
 if(!Number.isFinite(time))throw new Error('Dată invalidă.');
 return `/Date(${time})/`;
}
export function labelBytes(value) {
 const bytes=Array.isArray(value)?Uint8Array.from(value):typeof value==='string'?Uint8Array.from(atob(value),c=>c.charCodeAt(0)):new Uint8Array();
 if(bytes.length<5||bytes.length>10485760||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('GLS nu a returnat o etichetă PDF validă. Verifică rezultatul înainte de reluare.');
 return bytes;
}
export function matchingParcel(list,reference) {
 const matches=(list||[]).filter(p=>(p.ClientReference||p.Parcel?.ClientReference)===reference);
 if(matches.length!==1)throw new Error(matches.length?'GLS a returnat mai multe colete pentru această comandă. Verifică în MyGLS.':'Coletul nu a fost găsit în MyGLS. Cererea rămâne blocată pentru a evita dublarea; verifică în contul GLS.');
 return matches[0];
}
export function validateSettings(c) {
 if(!c || !['production','test'].includes(c.mode)||!Number.isInteger(Number(c.ClientNumber))||Number(c.ClientNumber)<=0||!String(c.Username||'').includes('@'))throw new Error('Completează emailul MyGLS și codul de client GLS.');
 const a=c.PickupAddress;
 if(!a||!a.Name||!a.Street||!/^\d+$/.test(a.HouseNumber)||!a.City||!/^\d{6}$/.test(a.ZipCode)||!a.ContactPhone)throw new Error('Completează adresa de ridicare: nume, stradă, număr numeric, localitate, cod poștal de 6 cifre și telefon.');
 if(!['A4_2x2','Thermo'].includes(c.TypeOfPrinter))throw new Error('Format de etichetă invalid.');
 return {...c,ClientNumber:Number(c.ClientNumber),PickupAddress:{...a,CountryIsoCode:'RO'}};
}
