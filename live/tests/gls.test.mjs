import test from 'node:test';
import assert from 'node:assert/strict';
import {glsDate,labelBytes,matchingParcel,validateSettings} from '../supabase/functions/ams-live-gls/protocol.mjs';
test('GLS labels reject non-PDF payloads and recover only one exact client reference',()=>{
 assert.throws(()=>labelBytes([1,2,3]));
 assert.equal(new TextDecoder().decode(labelBytes([37,80,68,70,45,49])), '%PDF-1');
 assert.throws(()=>matchingParcel([{ClientReference:'other',ParcelId:9}],'mine'));
 assert.throws(()=>matchingParcel([{ClientReference:'mine'},{ClientReference:'mine'}],'mine'));
 assert.equal(matchingParcel([{Parcel:{ClientReference:'mine'},ParcelId:9}],'mine').ParcelId,9);
 assert.match(glsDate('2026-11-14'),/^\/Date\(\d+\)\/$/);
 assert.throws(()=>glsDate('not a date'));
});
test('GLS setup requires actual account and complete Romanian pickup address',()=>{
 const c={Username:'test@example.test',ClientNumber:123,mode:'production',TypeOfPrinter:'A4_2x2',PickupAddress:{Name:'Test',Street:'Test',HouseNumber:'1',City:'Test',ZipCode:'123456',ContactPhone:'0700000000'}};
 assert.equal(validateSettings(c).PickupAddress.CountryIsoCode,'RO');
 assert.throws(()=>validateSettings({...c,ClientNumber:0}));
 assert.throws(()=>validateSettings({...c,PickupAddress:{...c.PickupAddress,ZipCode:''}}));
 assert.throws(()=>validateSettings({...c,mode:'https://attacker.test'}));
});
