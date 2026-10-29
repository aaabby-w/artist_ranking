import { createClient } from "npm:@supabase/supabase-js@2";
import { normalize } from "./normalize.mjs";

// Deploy with JWT verification off: callers authenticate with x-sync-secret,
// and pg_cron/pg_net sends no user JWT.
//   supabase functions deploy kdocs-sync --no-verify-jwt

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,80}$/;

function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({error:"Method not allowed"},{status:405});
  const trigger=Deno.env.get("SYNC_TRIGGER_SECRET");
  if(!trigger || trigger.length<32 || !sameSecret(req.headers.get("x-sync-secret"),trigger)) return Response.json({error:"Unauthorized"},{status:401});
  let db: ReturnType<typeof createClient>|undefined;
  let runId: string|undefined;
  let phase="CONFIG";
  try {
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default;
    const url=Deno.env.get("SUPABASE_URL");
    if(!key||!url)throw new Error("SERVER_CONFIG");
    db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    // Takes a row lock, expires abandoned runs and refuses to overlap a live run.
    const {data:started,error:startError}=await db.rpc("guild_kdocs_begin");
    if(startError){
      if(startError.message==="SYNC_ALREADY_RUNNING")return Response.json({ok:false,error:"SYNC_ALREADY_RUNNING"},{status:409});
      throw new Error("RUN_LOG_UNAVAILABLE");
    }
    runId=started as string;
    const webhook=Deno.env.get("KDOCS_WEBHOOK_URL"),token=Deno.env.get("KDOCS_AIRSCRIPT_TOKEN");
    if(!webhook?.startsWith("https://www.kdocs.cn/api/v3/ide/file/")||!token)throw new Error("SOURCE_CONFIG");
    phase="SOURCE_FETCH";
    const response=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json","AirScript-Token":token},body:JSON.stringify({Context:{argv:{}}}),signal:AbortSignal.timeout(60000)});
    // 401/403 here usually means the AirScript token expired (180-day default) or was replaced.
    if(!response.ok)throw new Error("SOURCE_HTTP_"+response.status);
    const payload=await response.json();
    if(payload.status!=="finished"||payload.error)throw new Error("SOURCE_SCRIPT_FAILED");
    phase="VALIDATION";
    const sheets=normalize(payload.data?.result);
    phase="DATABASE_APPLY";
    const {data,error}=await db.rpc("guild_kdocs_apply",{p_run:runId,p_sheets:sheets});
    // Guard refusals (e.g. MASS_REMOVAL_BLOCKED_70) are safe codes; pass them through.
    if(error)throw new Error(SAFE_CODE.test(error.message||"")?error.message:"DATABASE_"+(error.code||"ERROR"));
    return Response.json({ok:true,run_id:runId,...(data as Record<string,unknown>)});
  } catch(error) {
    // Never return/log source payloads, credential URLs, request headers or raw exceptions.
    const message=error instanceof Error?error.message:"UNKNOWN";
    const safe=SAFE_CODE.test(message)?message:phase+"_FAILED";
    if(db&&runId) {
      const {error:logError}=await db.from("guild_kdocs_runs").update({status:"failed",finished_at:new Date().toISOString(),error_code:safe}).eq("id",runId).eq("status","running");
      if(logError)console.error("SYNC_FAILURE_LOG_UNAVAILABLE",runId);
    }
    console.error("KDOCS_SYNC_FAILED",runId||"not_started",safe);
    return Response.json({ok:false,run_id:runId,error:safe},{status:500});
  }
});
