// Exercises supabase/functions/kdocs-sync/index.ts under Node (types stripped),
// with Deno, supabase-js and the KDocs webhook replaced by in-memory fakes.
// Usage: node --experimental-strip-types tests/edge-function.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const dir = mkdtempSync(tmpdir() + "/kdocs-edge-");
const root = new URL("../supabase/functions/kdocs-sync/", import.meta.url).pathname;
copyFileSync(root + "normalize.mjs", dir + "/normalize.mjs");
writeFileSync(dir + "/fake-supabase.mjs", "export const createClient = (...a) => globalThis.__fakeClient(...a);");
writeFileSync(dir + "/index.mts", readFileSync(root + "index.ts", "utf8").replace('"npm:@supabase/supabase-js@2"', '"./fake-supabase.mjs"'));

const SECRET = "s".repeat(40);
const env = { SYNC_TRIGGER_SECRET: SECRET, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service",
  KDOCS_WEBHOOK_URL: "https://www.kdocs.cn/api/v3/ide/file/F/script/S/sync_task", KDOCS_AIRSCRIPT_TOKEN: "tok" };
let handler, log = [], rpc = {}, updates = [], webhook;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
globalThis.__fakeClient = () => ({
  rpc: async (name, args) => { log.push(name); return rpc[name](args); },
  from: () => ({ update: (row) => ({ eq: () => ({ eq: async () => { updates.push(row); return { error: null }; } }) }) }),
});
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { log.push("webhook"); assert.equal(init.headers["AirScript-Token"], "tok"); return webhook(); };
const origError = console.error; console.error = () => {};
await import(dir + "/index.mts");
const call = async (headers = { "x-sync-secret": SECRET }, method = "POST") => {
  const r = await handler(new Request("https://fn/kdocs-sync", { method, headers }));
  return { status: r.status, body: await r.json() };
};
const HEADERS = ["", "完成情况", "费用", "负责画师", "卡牌名称", "谁的卡", "技能介绍", "卡牌类型", "机制简述", "效果/数值", "同步ID"];
const snapshot = { version: 2, complete: true, sheets: [{ sheet_name: "全部卡牌", complete: true, rows: [[], HEADERS, ["画", "", 1, "", "凝灵", "通用", "格挡", "技能", "", "", "guard"]] }] };
const reset = () => { log = []; updates = []; rpc = { guild_kdocs_begin: async () => ({ data: "run-1", error: null }),
  guild_kdocs_apply: async ({ p_sheets }) => ({ data: { cards: p_sheets[0].cards.length, changed: 0 }, error: null }) };
  webhook = async () => new Response(JSON.stringify({ status: "finished", error: "", data: { result: snapshot } })); };

reset();
assert.equal((await call({}, "GET")).status, 405);
assert.equal((await call({})).status, 401);
assert.equal((await call({ "x-sync-secret": SECRET.slice(1) + "t" })).status, 401);
assert.deepEqual(log, []); console.log("  ✓ 无密钥/错误密钥/非 POST：直接拒绝，不碰数据库和金山");

reset();
let r = await call();
assert.equal(r.status, 200); assert.equal(r.body.cards, 1); assert.deepEqual(log, ["guild_kdocs_begin", "webhook", "guild_kdocs_apply"]);
assert.equal(r.body.run_id, "run-1"); console.log("  ✓ 正常流程：加锁开始 → 读金山 → 写库");

reset(); rpc.guild_kdocs_begin = async () => ({ data: null, error: { message: "SYNC_ALREADY_RUNNING" } });
r = await call(); assert.equal(r.status, 409); assert.deepEqual(log, ["guild_kdocs_begin"]); console.log("  ✓ 已有同步在跑：返回 409，不调用金山");

reset(); rpc.guild_kdocs_apply = async () => ({ data: null, error: { message: "MASS_REMOVAL_BLOCKED_70", code: "P0001" } });
r = await call(); assert.equal(r.body.error, "MASS_REMOVAL_BLOCKED_70"); assert.equal(updates[0].error_code, "MASS_REMOVAL_BLOCKED_70");
console.log("  ✓ 大批移除拦截：原因原样写入同步日志");

reset(); rpc.guild_kdocs_apply = async () => ({ data: null, error: { message: 'relation "x" secret detail', code: "42P01" } });
r = await call(); assert.equal(r.body.error, "DATABASE_42P01"); console.log("  ✓ 其它数据库错误只记录错误码，不泄露细节");

reset(); webhook = async () => new Response("expired", { status: 401 });
r = await call(); assert.equal(r.body.error, "SOURCE_HTTP_401"); assert.deepEqual(log, ["guild_kdocs_begin", "webhook"]);
console.log("  ✓ 金山令牌失效：记录 SOURCE_HTTP_401，不写库");

reset(); webhook = async () => new Response(JSON.stringify({ status: "finished", error: "", data: { result: { ...snapshot, complete: false } } }));
r = await call(); assert.equal(r.body.error, "INVALID_SNAPSHOT"); assert.ok(!log.includes("guild_kdocs_apply")); console.log("  ✓ 不完整快照：校验失败，不写库");

reset(); env.SYNC_TRIGGER_SECRET = "short";
assert.equal((await call({ "x-sync-secret": "short" })).status, 401); console.log("  ✓ 服务端密钥过短（<32）时拒绝所有请求");
console.error = origError; globalThis.fetch = realFetch;
console.log("PASS: edge function");
