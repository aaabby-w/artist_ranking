// Exercises supabase/functions/artwork-backup/index.ts under Node (types stripped),
// with Deno, supabase-js, Storage and the GitHub API replaced by in-memory fakes.
// Usage: node --experimental-strip-types tests/artwork-backup.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const dir = mkdtempSync(tmpdir() + "/artwork-edge-");
const root = new URL("../supabase/functions/artwork-backup/", import.meta.url).pathname;
copyFileSync(root + "paths.mjs", dir + "/paths.mjs");
writeFileSync(dir + "/fake-supabase.mjs", "export const createClient = (...a) => globalThis.__fakeClient(...a);");
writeFileSync(dir + "/index.mts", readFileSync(root + "index.ts", "utf8").replace('"npm:@supabase/supabase-js@2"', '"./fake-supabase.mjs"'));
const { safeName, repoPath, stamp, toBase64 } = await import(dir + "/paths.mjs");

const SECRET = "s".repeat(40);
const env = { SYNC_TRIGGER_SECRET: SECRET, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", GITHUB_ARTWORK_TOKEN: "ghtok" };
let handler, pending, marks, files, gh, ghLog;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
globalThis.__fakeClient = () => ({
  rpc: async (name, args) => {
    if (name === "guild_artwork_pending") return { data: pending, error: null };
    if (name === "guild_artwork_mark") { marks.push(args); return { error: null }; }
    throw new Error("unexpected rpc " + name);
  },
  storage: { from: (b) => { assert.equal(b, "guild-submissions"); return { download: async (p) => files[p] ? { data: new Blob([files[p]]), error: null } : { data: null, error: { message: "nope" } } }; } },
});
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const path = u.pathname.replace("/repos/aaabby-w/artist_ranking", "");
  ghLog.push((init.method || "GET") + " " + path);
  assert.equal(init.headers.Authorization, "Bearer ghtok");
  return gh(path, init);
};
console.error = () => {};
await import(dir + "/index.mts");
const call = async (headers = { "x-sync-secret": SECRET }, method = "POST") => {
  const r = await handler(new Request("https://fn/artwork-backup", { method, headers }));
  return { status: r.status, body: await r.json() };
};
const row = (id, artist, title, path) => ({ submission_id: id, storage_path: path, artist, task_title: title, created_at: "2026-10-30T00:41:00Z" });
let committedTree;
const reset = () => {
  marks = []; ghLog = []; committedTree = null;
  files = { "u1/t1/a.png": new Uint8Array([137, 80, 78, 71]), "u1/t2/b.png": new Uint8Array([1, 2, 3]) };
  pending = [row("11111111-aaaa", "玻璃猫", "凝灵", "u1/t1/a.png"), row("22222222-bbbb", "晚安安hen不安", "利爪", "u1/t2/b.png")];
  gh = async (path, init) => {
    if (path === "/git/ref/heads/main") return Response.json({ object: { sha: "HEAD0" } });
    if (path === "/git/commits/HEAD0") return Response.json({ tree: { sha: "TREE0" } });
    if (path === "/git/blobs") return Response.json({ sha: "blob-" + JSON.parse(init.body).content });
    if (path === "/git/trees") { committedTree = JSON.parse(init.body); return Response.json({ sha: "TREE1" }); }
    if (path === "/git/commits") { const b = JSON.parse(init.body); assert.deepEqual(b.parents, ["HEAD0"]); return Response.json({ sha: "C1" }); }
    if (path === "/git/refs/heads/main") { assert.equal(JSON.parse(init.body).force, false); return Response.json({}); }
    return new Response("?", { status: 404 });
  };
};

// naming
assert.equal(safeName('a/b\\c:*?"<>|'), "a_b_c_______");
assert.equal(safeName("  ..隐藏  "), "隐藏");
assert.equal(safeName(""), "未命名");
assert.equal(stamp("2026-10-30T00:41:00Z"), "20261030-0841");
assert.equal(repoPath("artworks", row("11111111-aaaa", "玻璃猫", "凝灵", "u/t/x.PNG")), "artworks/玻璃猫/凝灵_20261030-0841_11111111.png");
assert.equal(toBase64(new Uint8Array([137, 80, 78, 71])), "iVBORw==");
console.log("  ✓ 路径：artworks/画师名/任务名_北京时间_交稿id.png，非法字符替换");

reset();
assert.equal((await call({}, "GET")).status, 405);
assert.equal((await call({})).status, 401);
assert.deepEqual(ghLog, []); assert.deepEqual(marks, []);
console.log("  ✓ 没有密钥 / 非 POST：直接拒绝，不碰 GitHub 和数据库");

reset();
let r = await call();
assert.equal(r.status, 200); assert.equal(r.body.copied, 2); assert.equal(r.body.commit, "C1");
assert.deepEqual(committedTree.tree.map((t) => t.path), ["artworks/玻璃猫/凝灵_20261030-0841_11111111.png", "artworks/晚安安hen不安/利爪_20261030-0841_22222222.png"]);
assert.equal(committedTree.base_tree, "TREE0");
assert.deepEqual(ghLog.filter((l) => l.startsWith("POST /git/commits") || l.startsWith("PATCH")), ["POST /git/commits", "PATCH /git/refs/heads/main"]);
assert.deepEqual(marks.map((m) => [m.p_status, m.p_commit]), [["done", "C1"], ["done", "C1"]]);
console.log("  ✓ 两张作品一次提交，分别放进各自画师文件夹，并记录为已备份");

reset(); pending = [];
r = await call(); assert.deepEqual(r.body, { ok: true, copied: 0 }); assert.deepEqual(ghLog, []);
console.log("  ✓ 没有新作品：不访问 GitHub、不产生提交");

reset(); delete files["u1/t2/b.png"];
r = await call(); assert.equal(r.body.copied, 1); assert.equal(r.body.failed, 1);
assert.deepEqual(marks.map((m) => [m.p_submission, m.p_status, m.p_error]), [["22222222-bbbb", "failed", "STORAGE_DOWNLOAD"], ["11111111-aaaa", "done", null]]);
console.log("  ✓ 某张图读不到：只标记那一张失败（下次重试），其他照常备份");

reset(); const ok = gh; gh = async (p, i) => p === "/git/refs/heads/main" && i.method === "PATCH" ? new Response("conflict", { status: 422 }) : ok(p, i);
r = await call(); assert.equal(r.status, 500); assert.equal(r.body.error, "GITHUB_HTTP_422");
assert.deepEqual(marks.map((m) => m.p_status), ["failed", "failed"]);
console.log("  ✓ 推送分支失败（并发提交等）：全部标记失败，下次重试，不会丢");

reset(); env.GITHUB_ARTWORK_TOKEN = "";
r = await call(); assert.equal(r.status, 500); assert.equal(r.body.error, "CONFIG"); assert.deepEqual(marks, []);
env.GITHUB_ARTWORK_TOKEN = "ghtok";
console.log("  ✓ 没配 GitHub 令牌：报 CONFIG，不标记任何作品");
console.log("PASS: artwork backup");
