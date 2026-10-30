// File naming for artwork copies in GitHub:
//   <dir>/<画师名>/<任务名>_<YYYYMMDD-HHMM 北京时间>_<交稿id前8位>.<ext>
export function safeName(s) {
  const v = String(s ?? "")
    .replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 60)
    .trim();
  return v || "未命名";
}

export function stamp(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600e3);
  if (isNaN(d)) return "00000000-0000";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export function repoPath(dir, row) {
  const ext = (String(row.storage_path).match(/\.([a-z0-9]{1,5})$/i)?.[1] || "png").toLowerCase();
  return `${dir}/${safeName(row.artist)}/${safeName(row.task_title)}_${stamp(row.created_at)}_${String(row.submission_id).slice(0, 8)}.${ext}`;
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
