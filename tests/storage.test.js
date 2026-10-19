import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
import { openDatabase } from '../js/db.js';
import { DB_NAME, STORES, STORE_NAMES, stateOf, uuid, now } from '../js/schema.js';
globalThis.indexedDB=indexedDB;
const remove=()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(DB_NAME);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
async function setup(fn){await remove();const clients=[];const open=async()=>{const db=await openDatabase();clients.push(db);return db;};try{await fn(await open(),open);}finally{clients.forEach(db=>db.close());await remove();}}
function addFixture(s){const at=now(),v={revision:1,createdAt:at,updatedAt:at},policyId=uuid(),periodId=uuid(),categoryId=uuid();s.periodPolicies.push({id:policyId,startDay:1,effectiveFrom:'2026-10-01',...v});s.periods.push({id:periodId,policyId,startDate:'2026-10-01',endDate:'2026-10-31',labelMonth:'2026-10',kind:'normal',state:'open',sequence:1,...v});s.categories.push({id:categoryId,type:'expense',name:'食費',sortOrder:0,active:true,...v});s.transactions.push({id:uuid(),type:'expense',date:'2026-10-19',periodId,categoryId,amount:350,name:'パン',memo:'復元試験',...v});return [periodId,categoryId];}
test('IndexedDB foundation integration',async t=>{
 await t.test('creates 17 stores and all unique indexes',()=>setup(async db=>{assert.equal(db.db.objectStoreNames.length,17);const tx=db.db.transaction(STORE_NAMES);for(const [name,schema]of Object.entries(STORES)){const store=tx.objectStore(name);assert.deepEqual(store.keyPath,schema.key);for(const [n,raw]of Object.entries(schema.indexes||{}))assert.equal(store.index(n).unique,raw.unique===true);}}));
 await t.test('settings survive reopen and rejected validation leaves old state',()=>setup(async(db,open)=>{await db.savePreferences({warningPercent:75},0);const other=await open();assert.equal((await other.snapshot()).settings[0].value.warningPercent,75);const before=await db.backup();await assert.rejects(db.savePreferences({warningPercent:0},1));assert.deepEqual((await db.backup()).stores,before.stores);}));
 await t.test('operation retry is idempotent and different input with same ID rejected',()=>setup(async db=>{const id=uuid();await db.savePreferences({warningPercent:70},0,id);await db.savePreferences({warningPercent:70},0,id);assert.equal(stateOf(await db.snapshot()).datasetRevision,1);await assert.rejects(db.savePreferences({warningPercent:71},1,id),/同じ操作ID/);await db.savePreferences({warningPercent:70},1);assert.equal(stateOf(await db.snapshot()).datasetRevision,2);}));
 await t.test('two clients cannot overwrite stale revision',()=>setup(async(db,open)=>{const other=await open();const results=await Promise.allSettled([db.savePreferences({warningPercent:60},0),other.savePreferences({warningPercent:65},0)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);}));
 await t.test('nonempty backup restores every store and invalid file leaves data intact',()=>setup(async db=>{await db.command('fixture',{},addFixture);const backup=await db.backup();await db.savePreferences({warningPercent:50},1);await db.restore(backup,2);const restored=await db.snapshot();for(const n of STORE_NAMES.filter(n=>n!=='meta'))assert.deepEqual(restored[n],backup.stores[n]);assert.notEqual(stateOf(restored).datasetId,backup.sourceDatasetId);assert.equal(restored.transactions[0].name,'パン');const bad=structuredClone(backup);bad.stores.transactions[0].categoryId=uuid();await assert.rejects(db.restore(bad,stateOf(restored).datasetRevision),/項目/);assert.deepEqual(await db.snapshot(),restored);}));
 await t.test('restore rejects outdated confirmation and old client generation',()=>setup(async(db,open)=>{const other=await open(),backup=await db.backup();await db.savePreferences({warningPercent:55},0);await assert.rejects(db.restore(backup,0),/確認後/);await db.restore(backup,1);await assert.rejects(other.savePreferences({warningPercent:40},0),/復元され/);await other.refresh();await other.savePreferences({warningPercent:40},1);}));
 await t.test('injected failure during restore rolls back clears and earlier puts',()=>setup(async db=>{await db.command('fixture',{},addFixture);const backup=await db.backup();await db.savePreferences({warningPercent:61},1);const before=await db.snapshot(),put=IDBObjectStore.prototype.put;let count=0;IDBObjectStore.prototype.put=function(...args){if(++count===4)throw new Error('injected quota failure');return put.apply(this,args);};try{await assert.rejects(db.restore(backup,2),/injected/);}finally{IDBObjectStore.prototype.put=put;}assert.deepEqual(await db.snapshot(),before);}));
});

test('backup and restore populated records in all 17 stores',()=>setup(async db=>{
 const operationId=uuid();
 await db.command('complete-fixture',{},s=>{
   const [periodId,categoryId]=addFixture(s),at=now(),v={revision:1,createdAt:at,updatedAt:at};
   s.periods[0].state='closed';s.periodBudgets.push({periodId,baseBudget:1000,...v});s.categoryBudgets.push({periodId,categoryId,amount:1000,...v});
   s.budgetRevisions.push({id:uuid(),periodId,before:{baseBudget:0,categoryBudgets:[]},after:{baseBudget:1000,categoryBudgets:[{categoryId,amount:1000}]},reason:'fixture',operationId,createdAt:at});
   const ruleId=uuid();s.recurringRules.push({id:ruleId,type:'expense',name:'定期',amount:100,dayOfMonth:31,categoryId,activeFrom:'2026-10',activeUntil:null,enabled:true,...v});
   s.recurringOccurrences.push({ruleId,scheduleMonth:'2026-10',id:uuid(),scheduledDate:'2026-10-31',ruleRevision:1,snapshot:{type:'expense',name:'定期',amount:100,dayOfMonth:31,categoryId},status:'pending'});
   s.carryoverEntries[0].delta=3000;
   s.carryoverEntries.push({id:uuid(),periodId,kind:'allocate',delta:-100,operationId,sequence:2,createdAt:at},{id:uuid(),periodId,kind:'settle',delta:750,operationId,sequence:3,createdAt:at});stateOf(s).ledgerSequence=3;
   s.periodClosings.push({periodId,inputRevision:1,settlementTotal:750,closeRevision:1,lastOperationId:operationId});
   s.closingRevisions.push({id:uuid(),periodId,previousTotal:0,newTotal:750,delta:750,closeRevision:1,reason:'manual',operationId,createdAt:at});
   const goal=uuid();s.goalHistory.push({id:goal,effectivePeriodId:periodId,targetAmount:500,sequence:1,createdAt:at});s.goalNotifications.push({goalRevisionId:goal,periodId,firstReachedAt:at});
   return [];
 },{operationId});
 const data=await db.backup();assert(STORE_NAMES.every(n=>data.stores[n].length>0));
 const bad=structuredClone(data);bad.stores.closingRevisions[0].newTotal=751;
 await assert.rejects(db.restore(bad,1));
 await db.savePreferences({warningPercent:51},1);await db.restore(data,2);const restored=await db.snapshot();
 for(const name of STORE_NAMES.filter(n=>n!=='meta'))assert.deepEqual(restored[name],data.stores[name]);
}));

test('missing initialization metadata must not reset existing records',()=>setup(async db=>{
 const tx=db.db.transaction('meta','readwrite');tx.objectStore('meta').clear();await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 await assert.rejects(openDatabase(),/既存データは変更/);const stores=await db.snapshot();assert.equal(stores.meta.length,0);assert.equal(stores.settings[0].value.warningPercent,80);assert.equal(stores.carryoverEntries.length,1);
}));
