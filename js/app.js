import { openDatabase } from './db.js';
import { APP_VERSION, stateOf, STORE_NAMES } from './schema.js';
import { validateBackup } from './validation.js';
const $=id=>document.getElementById(id);
let db, current, dirty=false, pending=null, waitingWorker=null, applyingUpdate=false, busy=false;
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function controls(enabled){for(const id of ['save','backup','restore-file'])$(id).disabled=!enabled;}
function network(){$('network').textContent=navigator.onLine?'オンライン':'オフライン';}
function stale(){controls(false);$('reload').hidden=false;message('別の画面で変更されました。編集中の内容を確認してから最新データを読み込んでください。',true);}
async function render(){current=await db.snapshot();const state=stateOf(current);if(state.datasetId!==db.generation){stale();return;}const prefs=current.settings.find(r=>r.key==='preferences').value;if(!dirty)$('warning-percent').value=prefs.warningPercent;$('record-count').textContent=STORE_NAMES.reduce((n,k)=>n+current[k].length,0)+'件';$('db-status').textContent='この端末に保存できます';}
async function action(fn){if(busy)return;busy=true;controls(false);try{await fn();}catch(e){message(e.message||'保存に失敗しました。再試行してください。',true);}finally{busy=false;if(db&&!$('reload').hidden)controls(false);else if(db)controls(true);}}
$('warning-percent').addEventListener('input',()=>{dirty=true;});
$('preferences').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const warningPercent=Number($('warning-percent').value);await db.savePreferences({warningPercent},stateOf(current).datasetRevision);dirty=false;await render();message('設定を保存しました。');});});
function download(data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kakeibo-backup-'+data.createdAt.replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('last-backup').textContent=new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});}
$('backup').addEventListener('click',()=>action(async()=>{download(await db.backup());message('バックアップの保存を開始しました。端末の保存先を確認してください。');}));
$('restore-file').addEventListener('change',()=>action(async()=>{const file=$('restore-file').files[0];$('restore-file').value='';if(!file)return;const data=validateBackup(JSON.parse(await file.text()));const snap=await db.snapshot();if(stateOf(snap).datasetId!==db.generation)throw Error('別の画面で復元されています。最新データを読み込んでください');pending={data,revision:stateOf(snap).datasetRevision};const total=Object.values(data.recordCounts).reduce((a,b)=>a+b,0);$('restore-summary').textContent=new Date(data.createdAt).toLocaleString('ja-JP')+' 作成・'+total+'件のデータです。';$('restore-dialog').showModal();}));
$('cancel-restore').addEventListener('click',()=>{pending=null;$('restore-dialog').close();});
$('restore-dialog').addEventListener('cancel',()=>{pending=null;});
$('confirm-restore').addEventListener('click',()=>action(async()=>{if(!pending)return;await db.restore(pending.data,pending.revision);pending=null;dirty=false;$('restore-dialog').close();await render();message('すべてのデータを復元しました。');}));
$('reload').addEventListener('click',()=>action(async()=>{if(dirty&&!confirm('保存していない変更を破棄して読み込みますか？'))return;await db.refresh();dirty=false;pending=null;$('restore-dialog').close();$('reload').hidden=true;await render();message('最新のデータを読み込みました。');}));
window.addEventListener('beforeunload',event=>{if(dirty&&!applyingUpdate){event.preventDefault();event.returnValue='';}});
window.addEventListener('online',network);window.addEventListener('offline',network);network();
$('update').addEventListener('click',()=>{if(busy)return;if(confirm('保存していない変更を破棄して新しいバージョンへ更新しますか？')){applyingUpdate=true;waitingWorker?.postMessage({type:'APPLY_UPDATE'});}});
async function pwa(){if(!('serviceWorker'in navigator)){$('offline-status').textContent='この環境はオフライン起動に対応していません。';return;}try{const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});navigator.serviceWorker.ready.then(()=>{$('offline-status').textContent='オフライン起動の準備ができました。';});const show=()=>{if(reg.waiting&&navigator.serviceWorker.controller){waitingWorker=reg.waiting;$('update-panel').hidden=false;}};show();reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{show();if(worker.state==='redundant'){$('offline-status').textContent='オフライン準備に失敗しました。';message('オフライン用データの準備に失敗しました。通信を確認して再起動してください。',true);}});});navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applyingUpdate)location.reload();else if(dirty)message('更新を検知しました。編集中の内容を保存してから再起動してください。');});}catch{$('offline-status').textContent='オフライン準備に失敗しました。';message('オフライン準備に失敗しました。通信を確認して再起動してください。',true);}}
try{db=await openDatabase({onBlocked:()=>message('ほかのタブを閉じてから再読み込みしてください。',true),onVersionChange:()=>{controls(false);$('reload').hidden=true;message('新しいバージョンを使用するため、編集中の内容を控えてアプリを再起動してください。',true);},onChange:()=>{if(!current||busy)return;stale();}});await render();controls(true);await pwa();}catch(e){$('db-status').textContent='保存を開始できませんでした';message(e.message,true);}
// No production debug API or user data is exposed on window.
console.info('Kakeibo',APP_VERSION);
