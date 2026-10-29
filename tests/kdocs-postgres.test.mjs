// End-to-end test of the KDocs sync against a real local PostgreSQL.
// Builds a production-shaped database (schema.sql -> 002 -> 003 -> Codex 004/005
// with a real 168-card Codex-era sync), applies 007, then exercises every
// acceptance scenario. Needs a disposable server: PGHOST/PGPORT/PGUSER env.
// Usage: node tests/kdocs-postgres.test.mjs [path-to-codex-normalize.mjs]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { normalize } from "../supabase/functions/kdocs-sync/normalize.mjs";

const DB = "kdocs_test_" + process.pid;
const root = new URL("..", import.meta.url).pathname;
const file = (p) => readFileSync(root + p, "utf8");
const codexNormalize = process.argv[2] ? (await import(process.argv[2])).normalize : null;

function psql(sql, { role, uid, db = DB, expectError } = {}) {
  let prefix = "";
  if (uid) prefix += `set "request.jwt.claim.sub" to '${uid}';\n`;
  if (role) prefix += `set role ${role};\n`;
  try {
    const out = execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db], {
      input: prefix + sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    if (expectError) assert.fail(`expected error ${expectError}, got success`);
    return out.trim();
  } catch (e) {
    if (!expectError || e.code === "ERR_ASSERTION") throw e;
    const msg = String(e.stderr || e.message);
    assert.match(msg, expectError instanceof RegExp ? expectError : new RegExp(expectError), msg);
    return msg;
  }
}
const one = (sql, opt) => psql(sql, opt).split("\n").pop();
const json = (sql, opt) => JSON.parse(one(sql, opt));
const lit = (v) => "$j$" + JSON.stringify(v) + "$j$";
let passed = 0;
const ok = (label) => { passed++; console.log("  ✓ " + label); };

// ---------------------------------------------------------------- fixtures
const seeds = JSON.parse(file("supabase/airscript/sync-cards.js").match(/const seeds = (\{.*\});/)[1]);
const all = Object.entries(seeds).map(([k, id]) => { const [name, owner] = JSON.parse(k); return { id, name, owner }; });
const rebirth = all.filter((c) => c.id.startsWith("rebirth:"));
const active = all.filter((c) => !c.id.startsWith("rebirth:"));
assert.equal(active.length, 98); assert.equal(rebirth.length, 70);
const HEADERS = ["", "完成情况", "费用", "负责画师", "卡牌名称", "谁的卡", "技能介绍", "卡牌类型", "机制简述", "效果/数值", "同步ID"];
const content = (c, i) => ({
  art: "画面" + c.name, status: i % 12 === 0 ? "已递交终稿" : "", cost: String(i % 3), artist: i % 5 === 0 ? "画师" + (i % 4) : "",
  desc: "技能 " + c.name + "。", type: ["攻击", "技能", "能力"][i % 3], mech: i % 2 ? "" : "机制" + i, effect: i % 4 ? "数值" + i : "",
});
const cards = new Map(all.map((c, i) => [c.id, { ...c, ...content(c, i) }]));
const row = (c) => [c.art, c.status, c.cost, c.artist, c.name, c.owner, c.desc, c.type, c.mech, c.effect, c.id];
const sheet = (list) => ({ version: 2, complete: true, sheets: [{ sheet_name: "全部卡牌", complete: true,
  rows: [["众生之门卡牌"], HEADERS, ...list.map(row)] }] });
const brief = (c) => [["画面效果", c.art], ["角色", c.owner], ["技能介绍", c.desc], ["卡牌类型", c.type],
  ["机制简述", c.mech], ["效果 / 数值", c.effect], ["卡牌消耗（非贡献分）", c.cost]]
  .filter(([, v]) => v).map(([k, v]) => k + "：" + v).join("\n");

// ---------------------------------------------------------------- sync emulation (same steps as index.ts)
function sync(snapshot, norm = normalize) {
  const run = one("select public.guild_kdocs_begin();", { role: "service_role" });
  try {
    const sheets = norm(snapshot);
    return { ok: true, run, ...json(`select public.guild_kdocs_apply('${run}', ${lit(sheets)})::text;`, { role: "service_role" }) };
  } catch (e) {
    const code = (String(e.stderr || e.message).match(/(MASS_\w+|INCOMPLETE_SHEET|DUPLICATE_CARD_IDS|INVALID_\w+|EMPTY_SNAPSHOT|STALE_SYNC_RUN)/) || [, "DATABASE_APPLY_FAILED"])[1];
    psql(`update public.guild_kdocs_runs set status='failed',finished_at=now(),error_code='${code}' where id='${run}' and status='running';`, { role: "service_role" });
    return { ok: false, error: code };
  }
}
const businessSnapshot = () => psql(`select md5(string_agg(x,'|' order by x)) from (
  select concat_ws('/',id,points,assignee,status,due_date) x from guild_tasks where import_key not like 'kdocs:%'
  union all select concat_ws('/',id,task_id,author_id,url,note,feedback) from guild_submissions
  union all select concat_ws('/',id,task_id,artist_id,points,submission_id) from guild_awards
  union all select concat_ws('/',id,name,role,active) from guild_profiles) t;`);
const rowVersions = () => psql(`select md5(string_agg(id::text||xmin::text,',' order by id)) from guild_tasks;
  select md5(string_agg(card_id||xmin::text,',' order by card_id)) from guild_kdocs_cards;`);

// ---------------------------------------------------------------- build production-shaped database
console.log("建立仿真生产库");
execFileSync("dropdb", ["--if-exists", DB]); execFileSync("createdb", [DB]);
psql(file("tests/sql/supabase-stub.sql"));
for (const f of ["supabase/schema.sql", "supabase/002_import.sql", "supabase/003_admin_tasks.sql"]) psql(file(f));
const [ADMIN_A, ADMIN_B, ARTIST] = ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000003"];
psql(`insert into auth.users(id) values('${ADMIN_A}'),('${ADMIN_B}'),('${ARTIST}');
  update guild_profiles set name='负责人甲',role='admin',active=true where id='${ADMIN_A}';
  update guild_profiles set name='负责人乙',role='admin',active=true where id='${ADMIN_B}';
  update guild_profiles set name='画师丙',active=true where id='${ARTIST}';`);
// Historical import: 98 灵卡 + 70 旧版参考 (as observed on the live guest view).
psql(`insert into guild_tasks(title,category,brief,status,import_key,source_record) select (v->>0),(v->>1),(v->>2),'imported',(v->>3),(v->4) from jsonb_array_elements(${lit(
    [...active.map((c) => [c, "灵卡", "灵卡", "卡牌 · 灵卡"]), ...rebirth.map((c) => [c, "旧版参考", "重生之门旧卡牌", "卡牌 · 旧版参考"])]
      .map(([c0, system, sh, cat], i) => { const c = cards.get(c0.id); return [c.name, cat, brief(c), "import:" + c.id,
        { system, sheet: sh, row: i + 2, card_id: c.id, artist: c.artist, status: c.status, url: "https://www.kdocs.cn/l/chYu5VON9OzX" }]; }))}) v;`);
// Guest view as deployed (columns observed live).
psql(`create view public.guild_task_preview as select id,title,category,brief,points,status,due_date,created_at,updated_at from public.guild_tasks;
  revoke all on public.guild_task_preview from anon,authenticated; grant select on public.guild_task_preview to anon,authenticated;`);
// Real platform activity before the sync goes live.
const tid = (card) => one(`select id from guild_tasks where source_record->>'card_id'='${card}';`);
const T = { guard: tid("guard"), claw: tid("claw"), metal: tid("metal"), legacy03: tid("legacy-03"), rebirthGold: tid("rebirth:金刃"), blink: tid("blink") };
const asA = { role: "authenticated", uid: ADMIN_A }, asB = { role: "authenticated", uid: ADMIN_B }, asArtist = { role: "authenticated", uid: ARTIST };
psql(`select guild_activate_import('${T.guard}',30,'${ARTIST}');`, asA);
psql(`select guild_action('${T.guard}','submit','https://example.com/guard.png','终稿');`, asArtist);
psql(`select guild_action('${T.guard}','approve',null,null,'很好');`, asB);           // done + award
psql(`select guild_activate_import('${T.claw}',20,null);`, asA);                         // open
psql(`select guild_activate_import('${T.legacy03}',25,'${ARTIST}');`, asA);              // active
psql(`select guild_action('${T.legacy03}','submit','https://example.com/l3.png','初稿');`, asArtist);
psql(`select guild_action('${T.legacy03}','changes',null,null,'改一下光效');`, asB);     // changes
psql(`select guild_activate_import('${T.rebirthGold}',15,null,true);`, asA);             // open legacy
psql(`select guild_activate_import('${T.metal}',10,'${ARTIST}');`, asA);                 // active
assert.equal(one(`select count(*) from guild_awards;`), "1");
// Mirror table as found in production, then Codex's grants and incremental schema.
psql(`create table public.guild_kdocs_mirror(source_key text primary key, sheet_name text, cells jsonb, updated_at timestamptz default now());
  alter table public.guild_kdocs_mirror enable row level security;
  revoke all on public.guild_kdocs_mirror from anon, authenticated, service_role;`);
psql(file("supabase/004_kdocs_mirror_permissions.sql"));
psql(file("supabase/005_kdocs_incremental.sql"));
// Codex's 168-card sync, exactly as it ran in production (Codex begin = plain insert).
{
  const run = one(`insert into guild_kdocs_runs default values returning id;`, { role: "service_role" });
  const res = json(`select guild_kdocs_apply('${run}', ${lit((codexNormalize || normalize)(sheet([...active, ...rebirth].map((c) => cards.get(c.id)))))})::text;`, { role: "service_role" });
  assert.deepEqual([res.cards, res.marked_missing], [168, 0]);
}
const inspect = () => psql(file("supabase/ops/00_inspect_readonly.sql"));
const vInspect = rowVersions(); const report = inspect();
assert.match(report, /mirror_cards \/ matched \(must be equal\)\|168 \/ 168/); assert.match(report, /preview_kind\|v/);
assert.match(report, /cron jobs mentioning kdocs\|\(none\)/); assert.match(report, /\(missing\)/); assert.equal(rowVersions(), vInspect);
const before = businessSnapshot();
const guestBefore = one(`select count(*) from guild_task_preview;`, { role: "anon" });
assert.equal(guestBefore, "168");
console.log("基线：168 条导入任务、1 条奖励、Codex 168 张镜像（与生产一致）");

// ---------------------------------------------------------------- 007
console.log("执行 007");
psql(file("supabase/007_kdocs_task_projection.sql"));
psql(file("supabase/007_kdocs_task_projection.sql")); // re-running must be harmless
assert.equal(one(`select count(*) from guild_tasks where kdocs_card_id is not null;`), "168"); ok("168 条导入任务全部按 同步ID/card_id 链接，无新建任务；重复执行 007 无副作用");
ok("只读核查 SQL 可在升级前运行：报告 168/168 匹配、视图类型 v，且不写入任何行");
assert.equal(businessSnapshot(), before); ok("007 未改变任何分值/画师/状态/交稿/奖励/成员");
assert.equal(one(`select count(*) from guild_task_preview;`, { role: "anon" }), "168"); ok("游客视图包装后数量不变（168）");

// ---------------------------------------------------------------- 168 -> 98 (the real situation)
console.log("场景：原表从 168 张减到 98 张");
const sheet98 = active.map((c) => cards.get(c.id));
const v0 = rowVersions();
let r = sync(sheet(sheet98));
assert.deepEqual(r, { ok: false, error: "MASS_REMOVAL_BLOCKED_70" });
assert.equal(rowVersions(), v0); ok("一次移除 70 张被拦截，数据库零写入（等待负责人确认）");
psql(`select guild_kdocs_approve(70);`, { ...asArtist, expectError: "只有负责人" }); ok("普通画师不能确认大批移除");
psql(`select guild_kdocs_approve(69);`, asA);
assert.equal(sync(sheet(sheet98)).error, "MASS_REMOVAL_BLOCKED_70"); ok("确认数量不符（69≠70）仍拦截");
psql(`select guild_kdocs_approve(70);`, asA);
r = sync(sheet(sheet98));
assert.ok(r.ok, JSON.stringify(r));
assert.deepEqual([r.cards, r.changed, r.marked_missing, r.tasks_inserted, r.tasks_updated, r.tasks_flagged, r.tasks_marked_removed], [98, 98, 70, 0, 98, 0, 70]);
ok(`确认后同步成功：${JSON.stringify(r)}`);
assert.equal(one(`select approved_removals is null from guild_kdocs_state;`), "t"); ok("确认为一次性，用后清除");
assert.equal(one(`select count(*) from guild_tasks where status='imported' and source_removed_at is null and (brief,title) is distinct from (source_record->'synced'->>'brief',source_record->'synced'->>'title');`), "0");
assert.equal(json(`select to_json(brief)::text from guild_tasks where kdocs_card_id='devour';`), brief(cards.get("devour")));
ok("同步生成的说明与原导入格式逐字一致：未改动的卡牌内容零变化");
assert.equal(businessSnapshot(), before); ok("分值、画师、状态、交稿、奖励全部未变");
assert.equal(one(`select count(*) from guild_tasks;`), "168"); ok("没有物理删除：任务仍是 168 条");
assert.equal(one(`select count(*) from guild_tasks where source_removed_at is not null;`), "70");
assert.equal(one(`select count(*) from guild_task_preview;`, { role: "anon" }), "99");
assert.equal(one(`select count(*) from guild_task_preview p join guild_tasks t using(id) where t.status='imported';`), "94");
ok("游客可见 99 = 原表 98 张（94 张未启用 + 4 张已转正式任务）+ 1 张已发布的旧版参考（原表已移除，正式任务保留）");
assert.equal(one(`select status||'/'||(source_removed_at is not null) from guild_tasks where id='${T.rebirthGold}';`), "open/true"); ok("已发布的旧版卡被移除：任务保留并标记待核实");
assert.equal(one(`select count(*) from guild_kdocs_cards where missing_since is not null;`), "70"); ok("镜像中 70 张软删除（missing_since），历史保留");

// ---------------------------------------------------------------- idempotency
console.log("场景：重复同步");
const v1 = rowVersions(), m1 = one(`select xmin from guild_kdocs_mirror;`);
for (let i = 0; i < 2; i++) {
  r = sync(sheet(sheet98));
  assert.deepEqual([r.ok, r.changed, r.marked_missing, r.tasks_inserted, r.tasks_updated, r.tasks_marked_removed], [true, 0, 0, 0, 0, 0]);
}
assert.equal(rowVersions(), v1); assert.equal(one(`select xmin from guild_kdocs_mirror;`), m1);
ok("相同数据连续两次同步：0 新增、0 更新、0 移除，任务与镜像行版本(xmin)完全不变");

console.log("场景：调整行顺序");
r = sync(sheet([...sheet98].reverse()));
assert.equal(r.tasks_inserted, 0); assert.equal(one(`select count(*) from guild_tasks;`), "168");
assert.equal(one(`select (source_record->>'row') from guild_tasks where kdocs_card_id='guard';`), String(98 + 2));
ok(`倒序后无重复记录，只更新来源行号（${r.tasks_updated} 条）`);
sync(sheet(sheet98)); assert.equal(sync(sheet(sheet98)).changed, 0);

// ---------------------------------------------------------------- edits
console.log("场景：修改名称/描述/画师/交稿状态");
const edited = sheet98.map((c) => ({ ...c }));
const byId = (id) => edited.find((c) => c.id === id);
Object.assign(byId("blink"), { name: "遁空·改", desc: "新描述。", type: "能力", artist: "新画师", status: "已递交终稿" });
Object.assign(byId("legacy-03"), { name: "御金击·新" });     // 'changes' task
Object.assign(byId("claw"), { desc: "利爪新描述。" });        // 'open' task
Object.assign(byId("metal"), { artist: "原表新画师" });       // 'active' task, registration only
r = sync(sheet(edited));
assert.equal(r.changed, 4); assert.equal(r.tasks_flagged, 2);
assert.deepEqual(json(`select json_build_array(title,brief,source_record->>'artist',source_record->>'status',category)::text from guild_tasks where id='${T.blink}';`),
  ["遁空·改", brief(byId("blink")), "新画师", "已递交终稿", "卡牌 · 灵卡"]);
ok("未启用卡：名称、描述、类型、原表画师、交稿状态自动更新");
assert.equal(one(`select title from guild_tasks where id='${T.legacy03}';`), cards.get("legacy-03").name);
assert.equal(one(`select source_pending->>'title' from guild_tasks where id='${T.legacy03}';`), "御金击·新");
ok("创作中/待修改任务：不改已接受的要求，变更挂起待负责人核对");
assert.equal(one(`select source_record->>'artist' from guild_tasks where id='${T.metal}';`), "原表新画师");
assert.equal(one(`select source_pending is null from guild_tasks where id='${T.metal}';`), "t");
ok("正式任务的原表登记信息（画师）照常更新，不产生挂起");
assert.equal(businessSnapshot(), before); ok("业务字段依旧未变");
psql(`select guild_kdocs_resolve('${T.legacy03}','accept');`, { ...asA, expectError: "画师已接手" }); ok("已接手任务不能一键改要求");
psql(`select guild_kdocs_resolve('${T.legacy03}','dismiss');`, asA);
psql(`select guild_kdocs_resolve('${T.claw}','accept');`, { ...asArtist, expectError: "只有负责人" });
psql(`select guild_kdocs_resolve('${T.claw}','accept');`, asA);
assert.equal(json(`select to_json(brief)::text from guild_tasks where id='${T.claw}';`), brief(byId("claw")));
assert.equal(one(`select points from guild_tasks where id='${T.claw}';`), "20"); ok("待认领任务经负责人确认后采用新描述，分值不变");
r = sync(sheet(edited)); assert.deepEqual([r.changed, r.tasks_updated, r.tasks_flagged], [0, 0, 0]); ok("处理后再同步：零写入，不会反复挂起");

// ---------------------------------------------------------------- add / delete / restore
console.log("场景：新增、删除、恢复");
const fresh = { id: "new-test-1", name: "测试新卡", owner: "通用", art: "光", status: "", cost: "1", artist: "", desc: "测试。", type: "攻击", mech: "", effect: "" };
r = sync(sheet([...edited, fresh]));
assert.equal(r.tasks_inserted, 1);
assert.equal(one(`select status||'|'||category||'|'||coalesce(points::text,'null')||'|'||coalesce(assignee::text,'null') from guild_tasks where kdocs_card_id='new-test-1';`), "imported|卡牌 · 灵卡|null|null");
assert.equal(one(`select count(*) from guild_task_preview p join guild_tasks t using(id) where t.kdocs_card_id='new-test-1';`, ), "1");
ok("新增卡牌 → 新建「原表登记」记录：无分值、无画师，游客可见");
assert.equal(sync(sheet([...edited, fresh])).tasks_inserted, 0); ok("再次同步不重复新建");
const withoutDance = [...edited, fresh].filter((c) => c.id !== "dance");
r = sync(sheet(withoutDance)); assert.equal(r.tasks_marked_removed, 1);
const dance = tid("dance");
assert.equal(one(`select count(*) from guild_task_preview where id='${dance}';`, { role: "anon" }), "0");
assert.equal(one(`select count(*) from guild_tasks where id='${dance}';`), "1"); ok("删除未启用卡：游客列表隐藏，记录保留");
psql(`select guild_activate_import('${dance}',10,null);`, { ...asA, expectError: "已从金山原表移除" }); ok("已移除的卡不能被确认成正式任务");
r = sync(sheet([...edited, fresh])); assert.equal(r.tasks_restored, 1);
assert.equal(one(`select count(*) from guild_task_preview where id='${dance}';`, { role: "anon" }), "1"); ok("恢复同一张卡（同一 同步ID）→ 重新显示，未产生重复");
r = sync(sheet([...edited, fresh].filter((c) => c.id !== "guard")));
assert.equal(one(`select status||'|'||points||'|'||(source_removed_at is not null) from guild_tasks where id='${T.guard}';`), "done|30|true");
assert.equal(one(`select count(*) from guild_awards where task_id='${T.guard}';`), "1");
assert.equal(one(`select count(*) from guild_submissions where task_id='${T.guard}';`), "1");
ok("删除已验收卡：任务、作品、30 分奖励全部保留，只标记待核实");
r = sync(sheet([...edited, fresh].filter((c) => c.id !== "legacy-03")));
assert.equal(one(`select status||'|'||assignee from guild_tasks where id='${T.legacy03}';`), "changes|" + ARTIST); ok("删除已认领卡：不取消认领，只标记");
sync(sheet([...edited, fresh]));
assert.equal(businessSnapshot(), before); ok("增删恢复全过程：分值/画师/状态/作品/奖励无一变化");

// ---------------------------------------------------------------- failure safety
console.log("场景：异常数据保护");
const v2 = rowVersions();
assert.equal(sync(sheet(edited.slice(0, 10))).error, "MASS_REMOVAL_BLOCKED_89"); ok("只读到 10 行（部分抓取）→ 拦截，不当作删除");
assert.equal(sync({ version: 2, complete: true, sheets: [{ sheet_name: "全部卡牌", complete: true, rows: [[], HEADERS] }] }).error, "INVALID_SHEET"); ok("空表 → 拒绝");
assert.equal(sync({ ...sheet(edited), complete: false }).error, "INVALID_SNAPSHOT"); ok("快照未标记完整 → 拒绝");
assert.equal(sync(sheet([...edited, { ...fresh }, { ...fresh }])).error, "INVALID_CARD_ID"); ok("重复 同步ID → 拒绝");
const moreHeaders = sheet(edited); moreHeaders.sheets[0].rows[1] = HEADERS.map((h) => h === "卡牌名称" ? "名称" : h);
assert.equal(sync(moreHeaders).error, "INVALID_HEADERS"); ok("表头被改 → 拒绝");
const many = Array.from({ length: 40 }, (_, i) => ({ ...fresh, id: "bulk-" + i, name: "批量" + i }));
assert.equal(sync(sheet([...edited, fresh, ...many])).error, "MASS_INSERT_BLOCKED_40"); ok("一次新增 40 张 → 拦截待确认");
assert.equal(rowVersions(), v2); ok("以上失败全部零写入，保留原有成功数据");
assert.ok(Number(one(`select count(*) from guild_kdocs_runs where status='failed';`)) >= 6);
assert.match(one(`select error_code from guild_kdocs_runs order by started_at desc limit 1;`), /MASS_INSERT_BLOCKED_40/); ok("失败原因写入同步日志");

console.log("场景：并发");
const live = one(`select guild_kdocs_begin();`, { role: "service_role" });
psql(`select guild_kdocs_begin();`, { role: "service_role", expectError: "SYNC_ALREADY_RUNNING" }); ok("运行中拒绝第二个同步");
psql(`update guild_kdocs_runs set started_at=now()-interval '11 minutes' where id='${live}';`);
const after = one(`select guild_kdocs_begin();`, { role: "service_role" });
assert.equal(one(`select error_code from guild_kdocs_runs where id='${live}';`), "RUN_TIMEOUT");
psql(`update guild_kdocs_runs set status='failed',error_code='TEST' where id='${after}';`); ok("卡死超过 10 分钟的运行自动判失败，不阻塞后续");
r = sync(sheet([...edited, fresh])); assert.equal(r.ok, true);
assert.ok(one(`select last_success_at > now()-interval '1 minute' from guild_kdocs_state;`) === "t"); ok("最近成功时间已记录");

// ---------------------------------------------------------------- permissions
console.log("场景：权限");
for (const t of ["guild_tasks", "guild_kdocs_cards", "guild_kdocs_runs", "guild_kdocs_state", "guild_kdocs_mirror", "guild_awards"])
  psql(`select 1 from ${t} limit 1;`, { role: "anon", expectError: "permission denied" });
ok("游客不能读任何业务表/同步表");
assert.equal(psql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='guild_task_preview';`),
  "id,title,category,brief,points,status,due_date,created_at,updated_at,source_state"); ok("游客视图只多一个不含姓名的 source_state 列");
for (const f of ["guild_kdocs_begin()", `guild_kdocs_project('全部卡牌')`, `guild_kdocs_apply(gen_random_uuid(),'[]')`, "guild_kdocs_approve(1)", `guild_kdocs_resolve(gen_random_uuid(),'dismiss')`])
  psql(`select ${f};`, { role: "anon", expectError: "permission denied" });
for (const f of ["guild_kdocs_begin()", `guild_kdocs_project('全部卡牌')`, `guild_kdocs_apply(gen_random_uuid(),'[]')`])
  psql(`select ${f};`, { ...asArtist, expectError: "permission denied" });
ok("游客/画师都不能调用同步写入函数");
psql(`update guild_tasks set points=999 where id='${T.claw}';`, { ...asArtist, expectError: "permission denied" });
psql(`update guild_kdocs_cards set data='{}';`, { ...asA, expectError: "permission denied" }); ok("登录用户（含负责人）不能直接改任务表或同步表");
assert.equal(one(`select count(*) from guild_kdocs_cards;`, asArtist), String(98 + 70 + 1)); ok("已开通成员可读同步表（用于显示同步状态）");

// ---------------------------------------------------------------- schedule
console.log("场景：定时任务");
psql(`insert into vault.secrets(name, secret) values('kdocs_sync_trigger', repeat('x',40));`);
const sched = file("supabase/006_kdocs_schedule.sql").replace(/create extension[^;]+;/g, "");
psql(sched); psql(sched);
assert.equal(one(`select count(*) from cron.job;`), "1"); ok("重复执行 006 只有一个定时任务");
psql(`select public.guild_kdocs_dispatch();`);
assert.equal(one(`select headers->>'x-sync-secret' = repeat('x',40) and headers ? 'Content-Type' from net.requests;`), "t"); ok("调度从 Vault 取密钥放入请求头");
psql(`select public.guild_kdocs_dispatch();`, { role: "authenticated", expectError: "permission denied" });
psql(`insert into cron.job(jobname,schedule,command) values('old-sync','* * * * *','select net.http_post(''https://x/functions/v1/kdocs-sync'')');`);
psql(sched, { expectError: "已存在其他同步定时任务" }); ok("发现另一个同步定时任务时停止，不重复创建");

assert.equal(businessSnapshot(), before);
execFileSync("dropdb", [DB]);
console.log(`PASS: ${passed} checks`);
