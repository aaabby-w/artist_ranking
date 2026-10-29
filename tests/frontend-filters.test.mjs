// Runs app.js's real render path against a stub DOM to check the two status
// families (platform commission vs. KDocs registration) for guests, artists and admins.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, "\n");
const els = new Map();
const el = (key) => {
  if (!els.has(key)) els.set(key, { key, innerHTML: "", textContent: "", hidden: false, value: "", dataset: {},
    classList: { toggle() {}, add() {}, remove() {} }, style: {}, addEventListener() {}, after(x) { els.set("#import-summary", x); },
    querySelector: () => null, querySelectorAll: () => [], focus() {}, setSelectionRange() {}, showModal() {}, close() {}, open: false });
  return els.get(key);
};
const document = { body: el("body"), addEventListener() {}, querySelector: (s) => el(s), querySelectorAll: () => [], createElement: () => el("#import-summary"), visibilityState: "visible" };
const ctx = vm.createContext({ document, window: { GUILD_CONFIG: { supabaseUrl: "https://x.supabase.co", supabaseKey: "pk" } },
  localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, setInterval() {}, setTimeout, clearTimeout,
  crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" }, console, Date, Intl, URL });
vm.runInContext(source + `
globalThis.__t = {
  set(v) { ({ user, profile, view, filter, data } = v); },
  render, matchesTaskFilter, taskLabel, syncBadge, sourceState,
};`, ctx);
const T = ctx.__t;

const src = (artist, status) => ({ system: "灵卡", sheet: "全部卡牌", row: 3, card_id: "x", artist, status, url: "https://www.kdocs.cn/l/x" });
const tasks = [
  { id: "1", status: "imported", import_key: "k1", kdocs_card_id: "a", source_record: src("", "") },
  { id: "2", status: "imported", import_key: "k2", kdocs_card_id: "b", source_record: src("画师甲", "") },
  { id: "3", status: "imported", import_key: "k3", kdocs_card_id: "c", source_record: src("画师乙", "已递交终稿") },
  { id: "4", status: "imported", import_key: "k4", kdocs_card_id: "d", source_record: src("", ""), source_removed_at: "2026-10-29T10:00:00Z" },
  { id: "5", status: "open", points: 20, import_key: "k5", kdocs_card_id: "e", source_record: src("", ""), source_pending: { title: "新", brief: "新" } },
  { id: "6", status: "active", points: 10, assignee: "u1", import_key: "k6", kdocs_card_id: "f", source_record: src("", "") },
  { id: "7", status: "changes", points: 10, assignee: "u1" },
  { id: "8", status: "submitted", points: 10, assignee: "u1" },
  { id: "9", status: "done", points: 30, assignee: "u1", import_key: "k9", kdocs_card_id: "g", source_record: src("", ""), source_removed_at: "2026-10-29T10:00:00Z" },
].map((t) => ({ title: "卡" + t.id, category: "卡牌 · 灵卡", brief: "说明", created_at: "2026-10-29T04:00:00Z", due_date: null, ...t }));
const base = { profiles: [{ id: "u1", name: "画师丙", role: "artist", active: true }, { id: "a1", name: "负责人", role: "admin", active: true }], submissions: [], awards: [], campaign: [] };
const counts = () => Object.fromEntries([...el(".filters").innerHTML.matchAll(/data-filter="([^"]+)"[^>]*>([^<]*?) (\d+)</g)].map((m) => [m[2], +m[3]]));

// Artist (member) view
T.set({ user: { id: "u1" }, profile: null, view: "board", filter: "all", data: { ...base, tasks, sync: { state: { last_success_at: new Date().toISOString() }, run: { status: "success" } } } });
T.render();
assert.deepEqual(counts(), { 全部记录: 8, 待认领: 1, 创作中: 1, 待验收: 1, 待修改: 1, 已完成: 1,
  "原表·尚未分配": 1, "原表·已登记画师": 1, "原表·已递交终稿": 1, 已从原表移除: 1, 原表变动待核实: 2 });
console.log("  ✓ 画师：平台委托与原表登记分开计数；已移除的未启用卡不在“全部”里");
assert.equal(T.taskLabel(tasks[3]), "已从原表移除"); assert.equal(T.taskLabel(tasks[0]), "原表尚未分配");
assert.match(T.syncBadge(tasks[8]), /原表已移除/); assert.match(T.syncBadge(tasks[4]), /原表有更新/); assert.equal(T.syncBadge(tasks[0]), "");
assert.match(el("#list").innerHTML, /原表已移除/); assert.doesNotMatch(el("#list").innerHTML, /data-task="4"/);
console.log("  ✓ 卡片标签：原表状态文字、正式任务的“原表已移除/原表有更新”提醒");
const summary = el("#import-summary").innerHTML;
assert.match(summary, /原表现有 5 张卡/); assert.match(summary, /2 张已从原表移除/); assert.match(summary, /原表同步：/);
assert.doesNotMatch(summary, /approve-sync/);
console.log("  ✓ 摘要只统计原表现有卡，显示最近同步时间；画师看不到确认按钮");

// Guest view: preview rows carry source_state only (no names, no source_record)
const guestRows = tasks.filter((t) => !(t.status === "imported" && t.source_removed_at))
  .map(({ id, title, category, brief, points, status, due_date, created_at }) => ({ id, title, category, brief, points, status, due_date, created_at,
    source_state: status !== "imported" ? null : ({ 1: "unassigned", 2: "assigned", 3: "final" })[id] }));
T.set({ user: undefined, profile: null, view: "board", filter: "all", data: { ...base, profiles: [], tasks: guestRows } });
T.render();
assert.deepEqual(counts(), { 全部记录: 8, 待认领: 1, 创作中: 1, 待验收: 1, 待修改: 1, 已完成: 1, "原表·尚未分配": 1, "原表·已登记画师": 1, "原表·已递交终稿": 1 });
assert.doesNotMatch(el("#list").innerHTML, /画师甲|画师乙/);
console.log("  ✓ 游客：同样的分组，但没有“已移除/待核实”，不显示任何画师名");

// Admin with a blocked bulk removal
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "import-unassigned",
  data: { ...base, tasks, sync: { state: { last_success_at: new Date(Date.now() - 3600e3).toISOString(), approved_removals: null }, run: { status: "failed", error_code: "MASS_REMOVAL_BLOCKED_70" } } } });
T.render();
assert.match(el("#import-summary").innerHTML, /同步已暂停.*移除 70 张.*id="approve-sync" data-kind="removal" data-count="70"/s);
assert.equal(el("#count").textContent, "1 条记录");
console.log("  ✓ 负责人：大批移除被拦截时显示原因和“确认移除 70 张”按钮");
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all",
  data: { ...base, tasks, sync: { state: { last_success_at: new Date(Date.now() - 7200e3).toISOString() }, run: { status: "failed", error_code: "SOURCE_HTTP_401" } } } });
T.render();
assert.match(el("#import-summary").innerHTML, /同步失败.*SOURCE_HTTP_401.*令牌可能已过期/s);
console.log("  ✓ 负责人：同步长时间失败时提示原因（令牌过期）");
T.set({ user: { id: "a1" }, profile: null, view: "admin", filter: "all", data: { ...base, tasks } });
T.render();
assert.match(el("#list").innerHTML, /原表待确认 3/); assert.match(el("#list").innerHTML, /原表变动 2/);
console.log("  ✓ 工作台：原表待确认不含已移除卡；新增“原表变动”筛选");
console.log("PASS: frontend filters");
// Website deployed before migration 007: guest rows have no source_state.
T.set({ user: undefined, profile: null, view: "board", filter: "all", data: { ...base, profiles: [], tasks: guestRows.map(({ source_state, ...r }) => r) } });
T.render();
assert.equal(counts()["原表·尚未分配"], undefined); assert.equal(counts()["全部记录"], 8);
assert.equal(T.taskLabel({ status: "imported" }), "原表登记");
console.log("  ✓ 兼容：数据库升级前发布网页，游客仍显示“原表登记”，不误分类");
