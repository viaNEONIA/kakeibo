import { STORES, STORE_NAMES, DB_VERSION, stateOf } from './schema.js';
export function assert(condition, message) { if (!condition) throw new Error(message); }
export const integer = n => Number.isSafeInteger(n);
export function safeAdd(a, b) { const sum = a + b; assert(integer(a) && integer(b) && integer(sum), '金額の計算範囲を超えています'); return sum; }
export function civilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0,4) === '0000') return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
}
const month = v => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) && civilDate(v + '-01');
const text = v => typeof v === 'string' && v.length > 0;
const id = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const instant = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const enumOf = (v, list) => list.includes(v);
const money = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => integer(v) && v >= min && v <= max;
const getKey = (row, key) => Array.isArray(key) ? key.map(k => row[k]) : row[key];
function unique(rows, key, label, optional = false) {
  const seen = new Set();
  for (const row of rows) {
    const v = getKey(row, key);
    if (v === undefined && optional) continue;
    assert(v !== undefined && v !== null && (!Array.isArray(v) || v.every(x => x !== undefined && x !== null)), `${label}: キーがありません`);
    const serial = JSON.stringify(v); assert(!seen.has(serial), `${label}: IDまたは一意キーが重複しています`); seen.add(serial);
  }
}
function rowsMap(rows, key = 'id') { return new Map(rows.map(r => [r[key], r])); }
export function validateStores(stores) {
  assert(stores && typeof stores === 'object' && !Array.isArray(stores), '保存データの形式が不正です');
  assert(Object.keys(stores).length === STORE_NAMES.length && STORE_NAMES.every(n => Array.isArray(stores[n])), '全17ストアが必要です');
  for (const [name, schema] of Object.entries(STORES)) {
    const rows = stores[name];
    for (const row of rows) {
      assert(row && typeof row === 'object' && !Array.isArray(row), `${name}: レコードが不正です`);
      if (schema.key === 'id') assert(id(row.id), `${name}: IDが不正です`);
      if (row.createdAt !== undefined) assert(instant(row.createdAt), `${name}: 作成日時が不正です`);
      if (row.updatedAt !== undefined) assert(instant(row.updatedAt), `${name}: 更新日時が不正です`);
    }
    unique(rows, schema.key, name);
    for (const [indexName, raw] of Object.entries(schema.indexes || {})) {
      if (raw.unique) unique(rows, raw.key, `${name}.${indexName}`, true);
    }
  }
  assert(stores.meta.length === 2 && stores.meta.find(r => r.key === 'schemaInfo')?.value?.dbSchemaVersion === DB_VERSION, 'DB形式版が不正です');
  const state = stateOf(stores);
  assert(state && id(state.datasetId) && money(state.datasetRevision) && money(state.ledgerSequence), 'データ世代情報が不正です');
  const periods = rowsMap(stores.periods), policies = rowsMap(stores.periodPolicies), categories = rowsMap(stores.categories);
  const rules = rowsMap(stores.recurringRules), occurrences = rowsMap(stores.recurringOccurrences), transactions = rowsMap(stores.transactions);
  const entries = rowsMap(stores.carryoverEntries), goals = rowsMap(stores.goalHistory), receipts = rowsMap(stores.operationReceipts);
  const revision = row => assert(money(row.revision, 1) && instant(row.createdAt) && instant(row.updatedAt), '更新版・日時が不正です');
  const refPeriod = row => assert(periods.has(row.periodId), '集計期間の参照先がありません');
  const refOperation = row => assert(receipts.has(row.operationId), '操作履歴の参照先がありません');
  for (const row of stores.operationReceipts) assert(text(row.command) && typeof row.payloadFingerprint === 'string' && Array.isArray(row.resultIds) && row.resultIds.every(id) && instant(row.committedAt), '操作履歴が不正です');
  for (const row of stores.categories) { revision(row); assert(enumOf(row.type, ['income','expense']) && text(row.name) && money(row.sortOrder) && typeof row.active === 'boolean', '項目が不正です'); }
  for (const row of stores.periodPolicies) { revision(row); assert(money(row.startDay,1,28) && civilDate(row.effectiveFrom), '期間設定が不正です'); }
  const sorted = [...stores.periods].sort((a,b) => a.startDate.localeCompare(b.startDate));
  for (let i=0; i<sorted.length; i++) {
    const row=sorted[i]; revision(row);
    assert(civilDate(row.startDate) && civilDate(row.endDate) && row.startDate <= row.endDate && row.labelMonth === row.endDate.slice(0,7) && money(row.sequence,1) && enumOf(row.kind,['normal','transition']) && enumOf(row.state,['open','closed']) && policies.has(row.policyId), '集計期間が不正です');
    if (i) assert(Date.parse(row.startDate)-Date.parse(sorted[i-1].endDate) === 86400000 && row.sequence > sorted[i-1].sequence, '集計期間に重複・空白・順序不正があります');
    if (row.kind === 'normal') {
      const start=new Date(row.startDate+'T00:00:00Z'), endExclusive=new Date(row.endDate+'T00:00:00Z'); endExclusive.setUTCDate(endExclusive.getUTCDate()+1);
      assert(start.getUTCDate() === policies.get(row.policyId).startDay && endExclusive.getUTCDate() === start.getUTCDate() && endExclusive.getUTCFullYear()*12+endExclusive.getUTCMonth() === start.getUTCFullYear()*12+start.getUTCMonth()+1, '通常期間の境界が不正です');
    }
  }
  for (const row of stores.transactions) {
    revision(row); refPeriod(row);
    assert(enumOf(row.type,['income','expense','refund']) && civilDate(row.date) && money(row.amount,1,999999999) && typeof row.name === 'string' && typeof row.memo === 'string', '収支取引が不正です');
    const p=periods.get(row.periodId), c=categories.get(row.categoryId);
    assert(row.date >= p.startDate && row.date <= p.endDate && c && c.type === (row.type === 'income'?'income':'expense'), '収支の日付・項目参照が不正です');
    if (row.occurrenceId !== undefined) assert(occurrences.get(row.occurrenceId)?.transactionId === row.id, '定期取引の相互参照が不正です');
  }
  for (const row of stores.periodBudgets) { revision(row); refPeriod(row); assert(money(row.baseBudget), '基本予算が不正です'); }
  for (const row of stores.categoryBudgets) { revision(row); refPeriod(row); assert(categories.get(row.categoryId)?.type === 'expense' && money(row.amount), '項目別予算が不正です'); }
  for (const row of stores.budgetRevisions) {
    refPeriod(row); refOperation(row); assert(text(row.reason) && instant(row.createdAt), '予算変更履歴が不正です');
    for (const snapshot of [row.before,row.after]) {
      assert(snapshot && money(snapshot.baseBudget) && Array.isArray(snapshot.categoryBudgets), '予算履歴の保存値が不正です');
      unique(snapshot.categoryBudgets,'categoryId','予算履歴');
      for (const b of snapshot.categoryBudgets) assert(categories.get(b.categoryId)?.type === 'expense' && money(b.amount), '予算履歴の項目が不正です');
      snapshot.categoryBudgets.reduce((sum,b)=>safeAdd(sum,b.amount),0);
    }
  }
  for (const row of stores.recurringRules) {
    revision(row); assert(enumOf(row.type,['income','expense']) && text(row.name) && money(row.amount,1,999999999) && money(row.dayOfMonth,1,31) && month(row.activeFrom) && (row.activeUntil === null || month(row.activeUntil) && row.activeUntil >= row.activeFrom) && typeof row.enabled === 'boolean' && categories.get(row.categoryId)?.type === row.type, '定期ルールが不正です');
  }
  for (const row of stores.recurringOccurrences) {
    const rule=rules.get(row.ruleId); assert(id(row.id) && rule && month(row.scheduleMonth) && civilDate(row.scheduledDate) && row.scheduledDate.slice(0,7) === row.scheduleMonth && money(row.ruleRevision,1) && row.snapshot && enumOf(row.status,['pending','confirmed','voided']), '定期予定が不正です');
    const snap=row.snapshot; assert(enumOf(snap.type,['income','expense']) && text(snap.name) && money(snap.amount,1,999999999) && money(snap.dayOfMonth,1,31) && categories.get(snap.categoryId)?.type === snap.type, '定期予定の保存値が不正です');
    const date=new Date(row.scheduleMonth+'-01T00:00:00Z'); const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    assert(Number(row.scheduledDate.slice(8)) === Math.min(last,snap.dayOfMonth), '定期予定日が不正です');
    if (row.status === 'confirmed') { const t=transactions.get(row.transactionId); assert(t && t.occurrenceId === row.id && t.date === row.scheduledDate, '確定済み定期予定の参照が不正です'); }
    else assert(row.transactionId === undefined, '未確定予定に取引参照があります');
  }
  let balance=0, maxSequence=0;
  const opening=stores.carryoverEntries.filter(r=>r.kind==='opening'); assert(opening.length === 1 && money(opening[0].delta), '初期プール記録が不正です');
  for (const row of [...stores.carryoverEntries].sort((a,b)=>a.sequence-b.sequence)) {
    refOperation(row); assert(enumOf(row.kind,['opening','allocate','adjust','settle','reverse']) && integer(row.delta) && money(row.sequence,1) && instant(row.createdAt), 'プール台帳が不正です');
    if (row.kind !== 'opening') refPeriod(row); else assert(row.periodId === undefined && row.sequence === 1, '初期プール所属が不正です');
    if (row.kind === 'allocate') assert(row.delta < 0, '配分は負の増減です');
    if (row.kind === 'reverse') { const target=entries.get(row.reversalOf); assert(target && target.kind === 'allocate' && target.sequence < row.sequence && target.periodId === row.periodId && target.delta === -row.delta, '配分取消参照が不正です'); }
    else assert(row.reversalOf === undefined, '取消以外に取消参照があります');
    balance=safeAdd(balance,row.delta); maxSequence=Math.max(maxSequence,row.sequence);
  }
  assert(state.ledgerSequence === maxSequence, '台帳連番が不正です');
  const closings=rowsMap(stores.periodClosings,'periodId');
  for (const row of stores.periodClosings) {
    refPeriod(row); assert(integer(row.settlementTotal) && money(row.closeRevision,1) && money(row.inputRevision) && receipts.has(row.lastOperationId) && periods.get(row.periodId).state === 'closed', '締め記録が不正です');
    const sum=stores.carryoverEntries.filter(e=>e.periodId===row.periodId && e.kind==='settle').reduce((s,e)=>safeAdd(s,e.delta),0);
    assert(sum === row.settlementTotal, '台帳と締め精算額が一致しません');
  }
  for (const p of stores.periods) if (p.state === 'closed') assert(closings.has(p.id), '締め済み期間の精算がありません');
  for (const entry of stores.carryoverEntries) if (entry.kind==='settle') assert(closings.has(entry.periodId), '精算の締め記録がありません');
  for (const row of stores.closingRevisions) { refPeriod(row); refOperation(row); assert(integer(row.previousTotal) && integer(row.newTotal) && row.delta === safeAdd(row.newTotal,-row.previousTotal) && text(row.reason) && instant(row.createdAt), '精算変更履歴が不正です'); }
  for (const closing of stores.periodClosings) {
    const changes=stores.closingRevisions.filter(r=>r.periodId===closing.periodId).sort((a,b)=>a.closeRevision-b.closeRevision);
    unique(changes,'closeRevision','精算履歴版');
    assert(changes.length === closing.closeRevision, '精算履歴の件数が一致しません');
    let expected=0;
    for (const [index,change] of changes.entries()) { assert(change.closeRevision===index+1, '精算履歴の版が連続していません'); assert(change.previousTotal===expected, '精算履歴が連続していません'); expected=change.newTotal; }
    assert(expected===closing.settlementTotal, '最新精算履歴が締め記録と一致しません');
  }
  for (const change of stores.closingRevisions) assert(closings.has(change.periodId), '精算履歴の締め記録がありません');
  for (const p of stores.periods) {
    let income=0,expense=0,allocation=0;
    for (const t of stores.transactions.filter(t=>t.periodId===p.id)) { if(t.type==='income') income=safeAdd(income,t.amount); else expense=safeAdd(expense,t.type==='refund'?-t.amount:t.amount); }
    for (const e of stores.carryoverEntries.filter(e=>e.periodId===p.id && ['allocate','reverse'].includes(e.kind))) allocation=safeAdd(allocation,-e.delta);
    assert(allocation>=0,'有効配分が負です');
    const budget=stores.periodBudgets.find(b=>b.periodId===p.id)?.baseBudget??0;
    const settlement=safeAdd(safeAdd(budget,allocation),-expense);
    if(p.state==='closed') assert(closings.get(p.id).settlementTotal===settlement, '現在の入力と締め精算が一致しません');
    stores.categoryBudgets.filter(b=>b.periodId===p.id).reduce((s,b)=>safeAdd(s,b.amount),0);
  }
  for (const row of stores.goalHistory) assert(periods.has(row.effectivePeriodId) && (row.targetAmount === null || money(row.targetAmount,1)) && money(row.sequence,1) && instant(row.createdAt), '目標履歴が不正です');
  for (const row of stores.goalNotifications) assert(goals.has(row.goalRevisionId) && periods.has(row.periodId) && instant(row.firstReachedAt), '目標通知が不正です');
  for (const row of stores.settings) { assert(text(row.key) && Object.hasOwn(row,'value'), '設定が不正です'); revision(row); }
  const prefs=stores.settings.find(r=>r.key==='preferences');
  assert(prefs && money(prefs.value?.startDay,1,28) && money(prefs.value?.warningPercent,1,99), '基本設定が不正です');
  return stores;
}
export function validateBackup(data) {
  assert(data?.format === 'kakeibo-pwa' && data.backupFormatVersion === 1 && data.dbSchemaVersion === DB_VERSION, '未対応または不正なバックアップ形式です');
  assert(instant(data.createdAt) && id(data.sourceDatasetId), 'バックアップ情報が不正です');
  validateStores(data.stores);
  assert(stateOf(data.stores).datasetId === data.sourceDatasetId, 'バックアップ世代が一致しません');
  assert(data.recordCounts && Object.keys(data.recordCounts).length===STORE_NAMES.length && STORE_NAMES.every(n => data.recordCounts[n] === data.stores[n].length), 'バックアップ件数が一致しません');
  return data;
}
