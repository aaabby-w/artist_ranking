import { createClient } from "npm:@supabase/supabase-js@2";
import { repoPath, toBase64 } from "./paths.mjs";

// Copies uploaded artworks from the private Storage bucket into the GitHub repo,
// one folder per artist, one commit per run. Triggered by pg_cron (guild-artwork-backup).
// Deploy:  supabase functions deploy artwork-backup --no-verify-jwt
// Secrets: SYNC_TRIGGER_SECRET (shared with kdocs-sync), GITHUB_ARTWORK_TOKEN
//          (fine-grained token: this repo only, Contents read/write).
// Optional: GITHUB_ARTWORK_REPO (default aaabby-w/artist_ranking), GITHUB_ARTWORK_BRANCH (main),
//           GITHUB_ARTWORK_DIR (artworks).

const BUCKET = "guild-submissions";
const MAX_BYTES = 25 * 1024 * 1024;

function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

type Pending = { submission_id: string; storage_path: string; artist: string; task_title: string; created_at: string };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const trigger = Deno.env.get("SYNC_TRIGGER_SECRET");
  if (!trigger || trigger.length < 32 || !sameSecret(req.headers.get("x-sync-secret"), trigger))
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ghToken = Deno.env.get("GITHUB_ARTWORK_TOKEN");
  const repo = Deno.env.get("GITHUB_ARTWORK_REPO") || "aaabby-w/artist_ranking";
  const branch = Deno.env.get("GITHUB_ARTWORK_BRANCH") || "main";
  const dir = (Deno.env.get("GITHUB_ARTWORK_DIR") || "artworks").replace(/^\/+|\/+$/g, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
  const url = Deno.env.get("SUPABASE_URL");
  if (!ghToken || !key || !url || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return Response.json({ ok: false, error: "CONFIG" }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const gh = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "zhongsheng-artwork-backup", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error("GITHUB_HTTP_" + r.status);
    return r.json();
  };
  const mark = (id: string, status: string, path: string | null, commit: string | null, error: string | null) =>
    db.rpc("guild_artwork_mark", { p_submission: id, p_status: status, p_path: path, p_commit: commit, p_error: error });
  const code = (e: unknown, fallback: string) => {
    const m = e instanceof Error ? e.message : "";
    return /^[A-Z][A-Z0-9_]{0,60}$/.test(m) ? m : fallback;
  };

  const { data: pending, error: pendingError } = await db.rpc("guild_artwork_pending", { p_limit: 20 });
  if (pendingError) return Response.json({ ok: false, error: "DATABASE_PENDING" }, { status: 500 });
  const rows = (pending || []) as Pending[];
  if (!rows.length) return Response.json({ ok: true, copied: 0 });

  let head: string, baseTree: string;
  try {
    head = (await gh(`/git/ref/heads/${branch}`)).object.sha;
    baseTree = (await gh(`/git/commits/${head}`)).tree.sha;
  } catch (e) {
    console.error("ARTWORK_BACKUP_FAILED", code(e, "GITHUB_REF"));
    return Response.json({ ok: false, error: code(e, "GITHUB_REF") }, { status: 500 });
  }

  const entries: { id: string; path: string; sha: string }[] = [];
  let failed = 0;
  for (const row of rows) {
    const path = repoPath(dir, row);
    try {
      if (!row.storage_path) throw new Error("STORAGE_PATH");
      const { data: file, error } = await db.storage.from(BUCKET).download(row.storage_path);
      if (error || !file) throw new Error("STORAGE_DOWNLOAD");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("FILE_SIZE");
      const blob = await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: toBase64(bytes), encoding: "base64" }) });
      entries.push({ id: row.submission_id, path, sha: blob.sha });
    } catch (e) {
      failed++;
      await mark(row.submission_id, "failed", path, null, code(e, "COPY_FAILED"));
    }
  }
  if (!entries.length) return Response.json({ ok: failed === 0, copied: 0, failed });

  try {
    const tree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree,
      tree: entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.sha })) }) });
    const first = entries[0].path.split("/").slice(1, 3).join(" / ");
    const commit = await gh("/git/commits", { method: "POST", body: JSON.stringify({
      message: `作品备份：${first}${entries.length > 1 ? ` 等 ${entries.length} 张` : ""}`, tree: tree.sha, parents: [head] }) });
    await gh(`/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    for (const e of entries) await mark(e.id, "done", e.path, commit.sha, null);
    return Response.json({ ok: true, copied: entries.length, failed, commit: commit.sha });
  } catch (e) {
    // Nothing reached the branch; every file is retried on the next run.
    for (const x of entries) await mark(x.id, "failed", x.path, null, code(e, "GITHUB_COMMIT"));
    console.error("ARTWORK_BACKUP_FAILED", code(e, "GITHUB_COMMIT"));
    return Response.json({ ok: false, error: code(e, "GITHUB_COMMIT") }, { status: 500 });
  }
});
