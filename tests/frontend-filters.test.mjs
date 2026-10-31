// Runs app.js's real render path against a stub DOM to check the two status
// families (platform commission vs. KDocs registration) for guests, artists and admins.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, "\n");
const els = new Map();
const el = (key) => {
  if (!els.has(key)) els.set(key, { key, innerHTML: "", textContent: "", hidden: false, value: "", dataset: {},
    classList: { toggle() {}, add() {}, remove() {} }, style: {}, setAttribute() {}, addEventListener() {}, after(x) { els.set("#import-summary", x); },
    querySelector: () => null, querySelectorAll: () => [], focus() {}, setSelectionRange() {}, showModal() {}, close() {}, open: false });
  return els.get(key);
};
const document = { body: el("body"), addEventListener() {}, querySelector: (s) => el(s), querySelectorAll: () => [], createElement: () => el("#import-summary"), visibilityState: "visible" };
const ctx = vm.createContext({ renderInbox() {}, document, window: { GUILD_CONFIG: { supabaseUrl: "https://x.supabase.co", supabaseKey: "pk" } },
  localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, setInterval() {}, setTimeout, clearTimeout,
  crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" }, console, Date, Intl, URL });
vm.runInContext(source + `
globalThis.__t = {
  set(v) { ({ user, profile, view, filter, data } = v); adminFilter = v.adminFilter || "submitted"; },
  render, matchesTaskFilter, taskLabel, syncBadge, sourceState, canDeleteTask, canUnpublish, importDetail, artistBindHTML,
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
  { id: "10", status: "open", points: 40 }, // published manually by an admin
].map((t) => ({ title: "卡" + t.id, category: "卡牌 · 灵卡", brief: "说明", created_at: "2026-10-29T04:00:00Z", due_date: null, ...t }));
const base = { profiles: [{ id: "u1", name: "画师丙", role: "artist", active: true }, { id: "a1", name: "负责人", role: "admin", active: true }], submissions: [], awards: [], campaign: [] };
const counts = () => Object.fromEntries([...el(".filters").innerHTML.matchAll(/data-filter="([^"]+)"[^>]*>([^<]*?) (\d+)</g)].map((m) => [m[2], +m[3]]));

const noSheetWord = (html) => assert.doesNotMatch(html, /原表/);

// Artist (member) view: sheet cards merged into the platform lists
T.set({ user: { id: "u1" }, profile: null, view: "board", filter: "all", data: { ...base, tasks, sync: { state: { last_success_at: new Date().toISOString() }, run: { status: "success" } } } });
T.render();
assert.deepEqual(counts(), { 全部记录: 9, 待认领: 3, 创作中: 2, 待验收: 2, 待修改: 1, 已完成: 1 });
noSheetWord(el(".filters").innerHTML);
console.log("  ✓ 画师：未分配→待认领、已登记画师→创作中、已递交终稿→待验收；分类名不含“原表”");
assert.equal(T.taskLabel(tasks[0]), "待认领"); assert.equal(T.taskLabel(tasks[1]), "创作中"); assert.equal(T.taskLabel(tasks[2]), "待验收");
assert.doesNotMatch(el("#list").innerHTML, /data-task="4"/); noSheetWord(el("#list").innerHTML);
assert.match(T.syncBadge(tasks[8]), /待核实/); assert.match(T.syncBadge(tasks[4]), /资料有更新/);
console.log("  ✓ 已从金山表移除的卡不出现在任何列表；正式任务只显示“待核实/资料有更新”提醒");
T.set({ user: { id: "u1" }, profile: null, view: "board", filter: "open", data: { ...base, tasks } }); T.render();
assert.equal(el("#count").textContent, "3 条记录");
assert.match(el("#list").innerHTML, /贡献分待约定/);
console.log("  ✓ 待认领列表含金山表未分配的卡，仍标“贡献分待约定”（需负责人定分后才能认领）");
assert.doesNotMatch(el("#import-summary").innerHTML, /approve-sync|已从|移除/);
assert.equal(el("#stats").innerHTML.match(/等待认领<\/small><strong>(\d+)/)[1], "3");
console.log("  ✓ 顶部统计与合并后的列表一致；摘要条不再列移除数量");

// Guest view: preview rows carry source_state only (no names, no source_record)
const guestRows = tasks.filter((t) => !(t.status === "imported" && t.source_removed_at))
  .map(({ id, title, category, brief, points, status, due_date, created_at }) => ({ id, title, category, brief, points, status, due_date, created_at,
    source_state: status !== "imported" ? null : ({ 1: "unassigned", 2: "assigned", 3: "final" })[id],
    artist_credit: { 3: "画师乙", 8: "画师丙", 9: "画师丙" }[id] || null }));
T.set({ user: undefined, profile: null, view: "board", filter: "all", data: { ...base, profiles: [], tasks: guestRows } });
T.render();
assert.deepEqual(counts(), { 全部记录: 9, 待认领: 3, 创作中: 2, 待验收: 2, 待修改: 1, 已完成: 1 });
assert.doesNotMatch(el("#list").innerHTML, /画师甲|画师乙|原表/);
console.log("  ✓ 游客：同样的合并列表，不显示任何画师名");

// Admin workbench
T.set({ user: { id: "a1" }, profile: null, view: "admin", filter: "all", adminFilter: "open", data: { ...base, tasks } });
T.render();
const admin = el("#list").innerHTML;
assert.match(admin, /待验收 2.*待认领 3.*创作中 2.*待修改 1.*已完成 1.*待核实 2/s);
assert.doesNotMatch(admin, /已从原表|移除/); noSheetWord(admin);
console.log("  ✓ 工作台：与公告栏同样的列表，没有“已从原表删除”，分类名不含“原表”");
assert.equal([...admin.matchAll(/data-delete-task="([^"]+)"/g)].map((m) => m[1]).join(","), "10");
console.log("  ✓ 删除按钮只出现在手动发布、尚未认领的任务上（金山表的卡没有）");
T.set({ user: { id: "a1" }, profile: null, view: "admin", filter: "all", adminFilter: "open", data: { ...base, tasks: tasks.filter((t) => !t.source_removed_at && !t.source_pending) } });
T.render();
assert.doesNotMatch(el("#list").innerHTML, /待核实/);
console.log("  ✓ 没有需要核实的正式任务时，“待核实”不显示");
T.set({ user: { id: "a1" }, profile: null, view: "admin", filter: "all", adminFilter: "open",
  data: { ...base, tasks, submissions: [{ id: "s1", task_id: "10", author_id: "u1", url: "https://x", note: "", feedback: "", created_at: "2026-10-29T00:00:00Z" }] } });
T.render();
assert.match(el("#list").innerHTML, /data-delete-task="10"/);
console.log("  ✓ 带测试交稿、没有贡献分的待认领任务也显示删除按钮");
T.set({ user: { id: "a1" }, profile: null, view: "admin", filter: "all", adminFilter: "open",
  data: { ...base, tasks, awards: [{ id: "w1", task_id: "10", artist_id: "u1", points: 40, created_at: "2026-10-29T00:00:00Z" }] } });
T.render();
assert.doesNotMatch(el("#list").innerHTML, /data-delete-task/);
console.log("  ✓ 有贡献分记录的任务不显示删除按钮");
T.set({ user: { id: "u1" }, profile: null, view: "admin", filter: "all", adminFilter: "open", data: { ...base, tasks } });
assert.equal(T.canDeleteTask(tasks[9]), false); console.log("  ✓ 画师账号不能删除");

// Gallery (稿件展示)
const upload = "https://x.supabase.co/storage/v1/object/authenticated/guild-submissions/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000008/00000000-0000-4000-8000-000000000009.png";
const gallerySubs = [{ id: "s8", task_id: "8", author_id: "u1", url: upload, note: "", feedback: "", created_at: "2026-10-29T10:00:00Z" }];
T.set({ user: { id: "u1" }, profile: null, view: "gallery", filter: "all", data: { ...base, tasks, submissions: gallerySubs } });
T.render();
const wall = el("#list").innerHTML;
assert.equal(el("#count").textContent, "3 份稿件");
assert.deepEqual([...wall.matchAll(/class="work (\w+)" data-task="(\d+)"/g)].map((m) => m[1] + ":" + m[2]), ["done:9", "submitted:8", "sheet:3"]);
assert.match(wall, /data-work-path="00000000-0000-4000-8000-000000000001\/00000000-0000-4000-8000-000000000008\/00000000-0000-4000-8000-000000000009\.png"/);
assert.match(wall, /终稿等待补传/); assert.match(wall, /✎ 画师丙</); assert.match(wall, /✎ 画师乙</); noSheetWord(wall);
assert.equal((wall.match(/class="work-credit">✎ /g) || []).length, 3);
console.log("  ✓ 稿件展示：已完成、待验收、金山表已交终稿各成一组，每张都署名；上传图片走私有签名链接");
T.set({ user: undefined, profile: null, view: "gallery", filter: "all", data: { ...base, profiles: [], submissions: [], tasks: guestRows } });
T.render();
const guestWall = el("#list").innerHTML;
assert.equal(el("#count").textContent, "3 份稿件");
assert.equal((guestWall.match(/class="work-credit">✎ /g) || []).length, 3); assert.match(guestWall, /✎ 画师乙</);
assert.doesNotMatch(guestWall, /画师甲|data-work-path/); assert.match(guestWall, /登录后可以看作品原图/);
console.log("  ✓ 游客的稿件展示也逐张署名；作品原图仍需登录");
T.set({ user: { id: "u1" }, profile: null, view: "gallery", filter: "all", data: { ...base, tasks: tasks.filter((t) => !["3", "8", "9"].includes(t.id)) } });
T.render();
assert.match(el("#list").innerHTML, /还没有交上来的稿件/);
console.log("  ✓ 没有稿件时显示空状态");
const reward = vm.runInContext(`rewardHTML()`, ctx);
assert.doesNotMatch(reward, /稿酬|计件|额外感谢|统计期内提交/); assert.match(reward, /DDL/);
console.log("  ✓ 奖励文案精简，不再出现“额外感谢，不是稿酬或计件单价”");

// A historical attachment must appear even while the source card is still imported.
T.set({user:{id:"a1"},profile:null,view:"gallery",filter:"all",data:{...base,tasks,submissions:[{...gallerySubs[0],task_id:"3"}]}});T.render();
assert.match(el("#list").innerHTML,/data-work-path=/);

// Publish form wording
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all", data: { ...base, tasks } }); T.render();
const finalForm = T.importDetail(tasks[2], true), namedForm = T.importDetail(tasks[1], true), openForm = T.importDetail(tasks[0], true);
assert.match(finalForm, /<form id="review-card">/); assert.match(finalForm, /data-review="approve">通过 · 放进稿件展示/); assert.match(finalForm, /data-review="reject">不通过/);
assert.doesNotMatch(finalForm, /activate-import|发布/);
assert.doesNotMatch(namedForm, /activate-import|发布|<select/); // 表格已写画师 = 创作中：不用发布，也不能改作者
assert.match(openForm, /任务已在公告栏展示/); assert.match(openForm, /保存安排，开放认领/);
for (const f of [finalForm, namedForm, openForm]) assert.doesNotMatch(f, /确认并转为任务/);
console.log("  ✓ 未分配的卡写明发布去向；表格已写画师的卡没有发布/改作者；已交终稿的卡只有「通过」和「不通过」");
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all", data: { ...base, tasks, aliases: [] } }); T.render();
assert.match(T.artistBindHTML(tasks[1], true), /id="bind-artist"/);
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all", data: { ...base, tasks, aliases: [{ artist_name: "画师甲", artist_id: "a1" }] } }); T.render();
assert.match(T.artistBindHTML(tasks[1], true), /已绑定账号/); assert.doesNotMatch(T.artistBindHTML(tasks[1], true), /bind-artist|<select/);
console.log("  ✓ 绑定之后不再显示绑定表单，改为「已绑定账号」");
assert.equal(T.canUnpublish(tasks[4]), true);   // published sheet card, open
assert.equal(T.canUnpublish(tasks[9]), false);  // manual task → use delete
assert.equal(T.canUnpublish(tasks[8]), false);  // done
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all", data: { ...base, tasks, submissions: [{ id: "s", task_id: "5", author_id: "a1", url: "https://x", note: "", feedback: "", created_at: "2026-10-29T00:00:00Z" }] } });
assert.equal(T.canUnpublish(tasks[4]), false);
console.log("  ✓ 撤回发布只对已发布、还没交稿的金山表卡开放");

// Admin with a blocked bulk removal
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all",
  data: { ...base, tasks, sync: { state: { last_success_at: new Date(Date.now() - 3600e3).toISOString(), approved_removals: null }, run: { status: "failed", error_code: "MASS_REMOVAL_BLOCKED_70" } } } });
T.render();
assert.match(el("#import-summary").innerHTML, /同步已暂停.*移除 70 张.*id="approve-sync" data-kind="removal" data-count="70"/s);
console.log("  ✓ 负责人：大批移除被拦截时仍显示原因和确认按钮");
T.set({ user: { id: "a1" }, profile: null, view: "board", filter: "all",
  data: { ...base, tasks, sync: { state: { last_success_at: new Date(Date.now() - 7200e3).toISOString() }, run: { status: "failed", error_code: "SOURCE_HTTP_401" } } } });
T.render();
assert.match(el("#import-summary").innerHTML, /同步失败.*SOURCE_HTTP_401.*令牌可能已过期/s);
console.log("  ✓ 负责人：同步长时间失败时提示原因（令牌过期）");
console.log("PASS: frontend filters");

T.set({user:{id:"admin"},profile:{id:"admin",role:"admin",active:true},view:"admin",filter:"all",adminFilter:"active",data:{tasks,profiles:[{id:"admin",role:"admin",active:true}],submissions:[],awards:[]}});
T.render();
assert.doesNotMatch(el('#list').innerHTML, /data-task="[^"]+">发布<\/button>/);
assert.match(el('#list').innerHTML, /查看 \/ 处理/);
console.log('PASS: in-progress source tasks never ask to publish again');
