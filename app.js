const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const labels = {
  open: "待认领",
  active: "创作中",
  submitted: "待验收",
  changes: "待修改",
  done: "已完成",
  imported: "原表登记",
};
let cfg = window.GUILD_CONFIG,
  client,
  user,
  profile,
  view = "board",
  filter = "all",
  query = "",
  data = { tasks: [], profiles: [], submissions: [], awards: [] },
  busy = false,
  seq = 0,
  channel;
const DEMO = "art-guild-demo-v1",
  demo = !cfg.supabaseUrl || !cfg.supabaseKey,
  UPLOAD_BUCKET = "guild-submissions",
  MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const uid = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  month = () =>
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
function seed() {
  const names = ["小满", "青禾", "鹿鸣", "阿棠"];
  const profiles = names.map((name, i) => ({
    id: "demo-" + i,
    name,
    role: i === 3 ? "admin" : "artist",
    active: true,
  }));
  const titles = [
    "御灵五行 · 图标补绘",
    "林间会馆 · 午后外景",
    "奇遇人物 · 表情差分",
    "卡牌牌面 · 灵力屏障",
    "海边小径 · 场景气氛图",
    "会馆住客 · 像素行走",
  ];
  const cats = ["UI 图标", "场景", "角色", "卡牌", "场景", "像素"];
  const statuses = ["open", "open", "active", "submitted", "changes", "done"];
  const tasks = titles.map((title, i) => ({
    id: "task-" + i,
    title,
    category: cats[i],
    brief: [
      "参考灵力图谱已有轮廓，补齐浅底与深底两套。交付 SVG 与透明 PNG，保持小尺寸可辨识。",
      "暖色平涂，保留树木与会馆入口的层次。先交构图草稿，再推进色稿。",
      "在现有人设基础上绘制开心、疑惑、担心三种表情，保留角色轮廓。",
    ][i % 3],
    points: [30, 80, 45, 50, 65, 40][i],
    status: statuses[i],
    assignee: i < 2 ? null : profiles[i % 3].id,
    due_date: null,
    created_at: now(),
    updated_at: now(),
  }));
  return {
    profiles,
    tasks,
    submissions: [
      {
        id: uid(),
        task_id: "task-3",
        author_id: "demo-0",
        url: "https://example.com/artwork",
        note: "演示交稿：线稿和上色已完成，等待负责人反馈。",
        feedback: "",
        created_at: now(),
      },
      {
        id: uid(),
        task_id: "task-4",
        author_id: "demo-1",
        url: "https://example.com/sketch",
        note: "第一版场景草稿。",
        feedback: "请把远景饱和度再降低一些，让道路更清晰。",
        created_at: now(),
      },
    ],
    awards: [
      {
        id: uid(),
        task_id: "task-5",
        artist_id: "demo-2",
        points: 40,
        created_at: now(),
      },
    ],
  };
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function store() {
  localStorage.setItem(DEMO, JSON.stringify(data));
}
function name(id) {
  return data.profiles.find((p) => p.id === id)?.name || "未认领";
}
function ranking(since) {
  return data.profiles
    .map((p) => ({
      ...p,
      total: data.awards
        .filter(
          (a) => a.artist_id === p.id && (!since || a.created_at >= since),
        )
        .reduce((n, a) => n + a.points, 0),
      count: data.awards.filter(
        (a) => a.artist_id === p.id && (!since || a.created_at >= since),
      ).length,
    }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
function people(rows) {
  return (
    rows
      .map(
        (p, i) =>
          `<div class="person"><b>${rows.findIndex((row) => row.total === p.total) + 1}</b><span class="avatar">${esc(p.name.slice(0, 1))}</span><div class="name">${esc(p.name)}<small>${p.count} 份任务已完成</small></div><strong>${p.total}<small>贡献分</small></strong></div>`,
      )
      .join("") || '<p class="muted">第一份完成的任务，将在这里留下名字。</p>'
  );
}
// 原表只是卡牌登记，不是平台正式工单；筛选时区分两套进度。
// 原表进度：unassigned / assigned / final / removed（仅 imported 记录）。
// 游客视图只给出 source_state（不含画师名），成员从 source_record 推算。
function sourceState(t) {
  if (t.status !== "imported") return null;
  if (t.source_removed_at) return "removed";
  if (t.source_state) return t.source_state;
  if (!t.source_record) return "unknown"; // 游客视图升级前：不猜测原表进度
  if (t.source_record.status === "已递交终稿") return "final";
  return String(t.source_record?.artist || "").trim() ? "assigned" : "unassigned";
}
function matchesTaskFilter(t, selected) {
  const source = sourceState(t);
  // 已从原表移除的未启用卡默认隐藏，只在“已从原表移除”里查看。
  if (selected === "all") return source !== "removed";
  if (selected === "imported") return t.status === "imported" && source !== "removed";
  if (selected === "import-final") return source === "final";
  if (selected === "import-assigned") return source === "assigned";
  if (selected === "import-unassigned") return source === "unassigned";
  if (selected === "source-removed") return source === "removed";
  if (selected === "source-attention")
    return t.status !== "imported" && (!!t.source_removed_at || !!t.source_pending);
  return t.status === selected;
}
function matchesTaskSearch(t) {
  return [t.title, t.category, t.brief, t.source_record?.artist, t.source_record?.card_id]
    .join(" ")
    .toLowerCase()
    .includes(query.toLowerCase());
}
function updateTaskFilters() {
  if (view !== "board" && view !== "mine") return;
  const candidates = data.tasks.filter(
    (t) => (view !== "mine" || t.assignee === user?.id) && matchesTaskSearch(t),
  );
  const signedIn = demo || !!user;
  // 前一组是平台正式委托（可认领、记分），后一组只是金山原表的登记进度。
  const definitions = [
    ["all", "全部记录"],
    ...(view === "board" ? [["open", "待认领"]] : []),
    ["active", "创作中"],
    ["submitted", "待验收"],
    ["changes", "待修改"],
    ["done", "已完成"],
    ...(view === "board"
      ? [
          ["import-unassigned", "原表·尚未分配"],
          ["import-assigned", "原表·已登记画师"],
          ["import-final", "原表·已递交终稿"],
          ...(signedIn
            ? [
                ["source-removed", "已从原表移除"],
                ["source-attention", "原表变动待核实"],
              ]
            : []),
        ]
      : []),
  ];
  const options = definitions
    .map(([id, label]) => ({
      id,
      label,
      count: candidates.filter((t) => matchesTaskFilter(t, id)).length,
    }))
    .filter((o) => o.id === "all" || o.id === filter || o.id === "open" || o.count > 0);
  document.querySelector(".filters").innerHTML = options
    .map((o) => `<button data-filter="${o.id}" class="${filter === o.id ? "selected" : ""}">${o.label} ${o.count}</button>`)
    .join("");
}

function render() {
  profile = data.profiles.find((p) => p.id === user?.id);
  if (!demo && !user && view === "mine") view = "board";
  prepareAdmin();
  $("#account").textContent = user
    ? "○　" + (profile?.name || "等待入馆")
    : "○　登录会馆";
  $("#notice").textContent = demo
    ? "演示会馆 · 当前使用示例任务，本机保存；可切换画师 / 负责人体验流程。"
    : user && !profile?.active
      ? "账号已登录，等待负责人开通成员权限。"
      : !user
        ? "游客可以浏览公开任务；登录后可以认领和交稿。"
        : "欢迎来到会馆。按自己的时间认领，验收通过后自动记录贡献。";
  $("#new-task").hidden = profile?.role !== "admin";
  $("#stats").innerHTML = [
    [
      "等待认领",
      data.tasks.filter((t) => t.status === "open").length,
      "份任务",
    ],
    [
      "正在创作",
      data.tasks.filter((t) => ["active", "changes"].includes(t.status)).length,
      "份任务",
    ],
    [
      "等待验收",
      data.tasks.filter((t) => t.status === "submitted").length,
      "份作品",
    ],
    [
      "累计完成",
      data.tasks.filter((t) => t.status === "done").length,
      "份贡献",
    ],
  ]
    .map(
      ([a, b, c]) =>
        `<div class="stat"><small>${a}</small><strong>${b}<span>${c}</span></strong></div>`,
    )
    .join("");
  $("#top").innerHTML = !demo && !user
    ? '<p class="muted">登录后可查看本月贡献。</p>'
    : people(ranking(month()).slice(0, 3));
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#crumb").textContent = {
    admin: "负责人工作台",
    board: "任务公告栏",
    mine: "我的画桌",
    rank: "贡献芳名录",
  }[view];
  $("#section-title").textContent = {
    admin: "发任务、分画师、看交稿。",
    board: "今天，想画点什么？",
    mine: "给每一份灵感，留一点时间。",
    rank: "每一笔，都算数。",
  }[view];
  $("#section-label").textContent =
    view === "rank" ? "THANK YOU FOR CREATING" : "TAKE A LITTLE QUEST";
  $("#toolbar").hidden = view === "rank" || view === "admin";
  updateTaskFilters();
  renderImportSummary();
  if (view === "admin") {
    renderAdmin();
    return;
  }
  if (view === "rank") {
    if (!demo && !user) {
      $("#list").innerHTML = '<div class="empty">登录后可以查看贡献芳名录。</div>';
      $("#count").textContent = "";
      return;
    }
    $("#list").innerHTML =
      '<div class="rank-list">' +
      phaseHTML() +
      '<h3>累计贡献</h3><p class="muted">同分并列，昵称仅用于展示排序 · 仅记录已验收任务</p>' +
      people(ranking()) +
      historySummary() +
      "</div>";
    $("#count").textContent = "累计榜";
    return;
  }
  const tasks = data.tasks.filter(
    (t) =>
      (view !== "mine" || t.assignee === user?.id) &&
      matchesTaskFilter(t, filter) &&
      matchesTaskSearch(t),
  );
  tasks.sort((a, b) => {
    if (a.source_record && b.source_record)
      return (
        Number(a.source_record.system === "旧版参考") -
          Number(b.source_record.system === "旧版参考") ||
        a.source_record.row - b.source_record.row
      );
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  $("#count").textContent = tasks.length + " 条记录";
  $("#list").innerHTML =
    tasks
      .map(
        (t) =>
          `<button class="card" data-task="${esc(t.id)}"><div class="card-top"><span class="tag">${esc(t.category)}</span><span class="tag ${esc(t.status)}">${esc(taskLabel(t))}</span>${syncBadge(t)}</div><h3>${esc(t.title)}</h3><p>${esc(t.brief)}</p><div class="meta">${t.due_date ? "期望交稿 " + esc(t.due_date) : "DDL 未设 · 可与负责人协商"}</div><div class="card-bottom"><span>○ ${esc(taskArtist(t))}</span><span class="points">✧ ${pointLabel(t)}　↗</span></div></button>`,
      )
      .join("") ||
    '<div class="empty">这里暂时没有任务。<br>可以换个筛选，或去公告栏认领喜欢的任务。</div>';
}
function modal(title, body) {
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  if (!$("#dialog").open) $("#dialog").showModal();
}
function error(e) {
  toast(e.message || "暂时无法完成，请重试。");
}
async function load() {
  if (demo) {
    render();
    return;
  }
  if (!user) {
    const n = ++seq;
    try {
      const { data: tasks, error: readError } = await client
        .from("guild_task_preview")
        .select("*")
        .order("created_at", { ascending: false });
      if (readError) throw readError;
      if (n !== seq) return;
      data = {
        tasks: tasks || [],
        profiles: [],
        submissions: [],
        awards: [],
        campaign: [],
      };
      $("#connection").textContent = "游客浏览 · 登录后可认领";
      render();
    } catch (e) {
      if (n !== seq) return;
      data = { tasks: [], profiles: [], submissions: [], awards: [], campaign: [] };
      $("#connection").textContent = "公开任务读取失败";
      render();
      error(e);
    }
    return;
  }
  const n = ++seq;
  try {
    const tables = ["tasks", "profiles", "submissions", "awards", "campaign"];
    const r = await Promise.all(
      tables.map((t) =>
        client
          .from("guild_" + t)
          .select("*")
          .order("created_at", { ascending: false }),
      ),
    );
    for (const x of r) if (x.error) throw x.error;
    if (n !== seq) return;
    tables.forEach((t, i) => (data[t] = r[i].data));
    // 原表同步状态只用于提示；读取失败不影响任务数据。
    const [state, run] = await Promise.all([
      client.from("guild_kdocs_state").select("last_success_at,approved_removals,approved_inserts").maybeSingle(),
      client.from("guild_kdocs_runs").select("status,error_code,started_at,summary").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (n !== seq) return;
    data.sync = { state: state.data || null, run: run.data || null };
    $("#connection").textContent = "● 已连接";
    render();
  } catch (e) {
    $("#connection").textContent = "读取失败 · 点击刷新重试";
    error(e);
  }
}
async function act(action, id, extra = {}) {
  if (busy) return;
  busy = true;
  const buttons = [...$("#dialog").querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (!profile?.active) throw Error("请先登录并等待负责人开通成员权限。");
    if (demo) {
      const t = data.tasks.find((t) => t.id === id);
      if (action === "create" || action === "edit") {
        if (profile.role !== "admin") throw Error("需要负责人权限");
        if (action === "edit") {
          if (!t || t.status !== "open") throw Error("只有未认领任务可以修改");
          Object.assign(t, extra, {
            status: extra.assignee ? "active" : "open",
            updated_at: now(),
          });
        } else
          data.tasks.unshift({
            ...extra,
            id: uid(),
            status: extra.assignee ? "active" : "open",
            created_at: now(),
            updated_at: now(),
          });
      } else {
        if (!t) throw Error("任务不存在");
        if (action === "claim") {
          if (t.status !== "open") throw Error("这份任务已被认领");
          t.assignee = user.id;
          t.status = "active";
        } else if (action === "release") {
          if (
            t.assignee !== user.id ||
            !["active", "changes"].includes(t.status)
          )
            throw Error("当前不能归还");
          t.assignee = null;
          t.status = "open";
        } else if (action === "submit") {
          if (
            t.assignee !== user.id ||
            !["active", "changes"].includes(t.status)
          )
            throw Error("当前不能交稿");
          data.submissions.unshift({
            id: uid(),
            task_id: id,
            author_id: user.id,
            ...extra,
            feedback: "",
            created_at: now(),
          });
          t.status = "submitted";
        } else {
          if (
            profile.role !== "admin" ||
            t.assignee === user.id ||
            t.status !== "submitted"
          )
            throw Error("需要其他负责人验收待审作品");
          data.submissions.find((s) => s.task_id === id).feedback =
            extra.feedback;
          t.status = action === "approve" ? "done" : "changes";
          if (action === "approve")
            data.awards.push({
              id: uid(),
              task_id: id,
              artist_id: t.assignee,
              submission_id: data.submissions.find((s) => s.task_id === id)?.id,
              points: t.points,
              created_at: now(),
            });
        }
        t.updated_at = now();
      }
      store();
      render();
    } else {
      let r;
      if (action === "create" || action === "edit")
        r = await client.rpc("guild_save_task", {
          p_task: id,
          p_title: extra.title,
          p_category: extra.category,
          p_brief: extra.brief,
          p_points: extra.points,
          p_due: extra.due_date,
          p_assignee: extra.assignee,
        });
      else
        r = await client.rpc("guild_action", {
          p_task: id,
          p_action: action,
          p_url: extra.url || null,
          p_note: extra.note || null,
          p_feedback: extra.feedback || null,
        });
      if (r.error) throw r.error;
      await load();
    }
    $("#dialog").close();
    toast(
      {
        claim: "认领成功，期待你的作品。",
        release: "已归还任务，等你有空再来。",
        submit: "交稿成功，等待负责人验收。",
        approve: "已通过验收，贡献已记入芳名录。",
        changes: "修改意见已送达。",
        create: "任务已发布。",
        edit: "任务已更新。",
      }[action],
    );
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
function uploadedImagePath(url) {
  if (demo || !cfg.supabaseUrl || typeof url !== "string") return null;
  const prefix =
    cfg.supabaseUrl.replace(/\/+$/, "") +
    `/storage/v1/object/authenticated/${UPLOAD_BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length);
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)
    ? path
    : null;
}

async function showUploadedImages() {
  const links = [...$("#dialog").querySelectorAll("a[data-upload-path]")];
  for (const link of links) {
    const path = link.dataset.uploadPath;
    try {
      const { data: signed, error: signError } = await client.storage
        .from(UPLOAD_BUCKET)
        .createSignedUrl(path, 3600);
      if (signError) throw signError;
      if (!link.isConnected) continue;
      link.href = signed.signedUrl;
      link.textContent = "打开上传的图片 ↗";
      const img = document.createElement("img");
      img.src = signed.signedUrl;
      img.alt = "画师上传的作品";
      img.loading = "lazy";
      img.style.cssText =
        "display:block;width:auto;max-width:100%;max-height:420px;object-fit:contain;margin-top:12px;border-radius:12px;";
      link.insertAdjacentElement("afterend", img);
    } catch (e) {
      if (link.isConnected) {
        link.removeAttribute("href");
        link.textContent = "图片暂时无法加载，请联系负责人";
      }
      console.error("Unable to load image", e);
    }
  }
}

async function uploadSubmissionImage(task, file) {
  if (!user || !profile?.active) throw Error("请先登录会馆再上传图片");
  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const ext = extensions[file.type];
  if (!ext) throw Error("只支持 PNG、JPG、WebP 图片");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES)
    throw Error("图片必须小于或等于 10 MB");
  const path = `${user.id}/${task.id}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await client.storage
    .from(UPLOAD_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  return `${cfg.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/authenticated/${UPLOAD_BUCKET}/${path}`;
}

function detail(id) {
  const t = data.tasks.find((t) => t.id === id);
  if (!t) return;
  const own = t.assignee === user?.id,
    admin = profile?.role === "admin";
  const subs = data.submissions.filter((s) => s.task_id === id);
  modal(
    t.title,
    `<span class="tag">${esc(t.category)} · ${esc(taskLabel(t))}</span><p class="detail-copy">${esc(t.brief)}</p><p class="detail-meta">${pointLabel(t)} · ${esc(taskArtist(t))}<br>${t.due_date ? "期望交稿 " + esc(t.due_date) : "交稿时间可与负责人协商"}</p>${admin && t.status === "open" ? '<button class="outline" id="edit-task">编辑 / 分配任务</button>' : ""}${importDetail(t, admin)}${subs.map((s) => {
      const path = uploadedImagePath(s.url);
      const link = path
        ? `<a data-upload-path="${esc(path)}" rel="noopener noreferrer" target="_blank">正在加载上传的图片…</a>`
        : `<a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">打开作品 / 网盘链接 ↗</a>`;
      return `<div class="submission"><b>${esc(name(s.author_id))} · ${new Date(s.created_at).toLocaleString("zh-CN")}</b><p>${esc(s.note)}</p>${link}${s.feedback ? "<p>负责人反馈：" + esc(s.feedback) + "</p>" : ""}</div>`;
    }).join("")}${own && ["active", "changes"].includes(t.status) ? '<form id="submit-form"><label class="field">上传作品图片（PNG / JPG / WebP，最多 10 MB）<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label><label class="field">或填写作品 / 网盘链接<input name="url" type="url" placeholder="https://…"></label><label class="field">交稿说明 / 提取码<textarea name="note" required maxlength="2000"></textarea></label><button class="primary" type="submit">提交验收</button></form>' : ""}${admin && t.status === "submitted" && !own ? '<label class="field">验收反馈<textarea id="feedback" maxlength="2000" placeholder="需要修改时，请写清具体位置和建议。"></textarea></label>' : ""}<div class="actions">${t.status === "open" ? '<button class="primary" id="claim">认领这份任务</button>' : ""}${own && ["active", "changes"].includes(t.status) ? '<button class="outline" id="release">归还任务</button>' : ""}${admin && t.status === "submitted" && !own ? '<button class="primary" id="approve">通过并记入贡献</button><button class="outline" id="changes">请画师修改</button>' : ""}</div>`,
  );
  bindImportForm(t);
  document.querySelectorAll("#dialog [data-resolve]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await adminRPC(
            "guild_kdocs_resolve",
            { p_task: t.id, p_action: b.dataset.resolve },
            () => {
              if (b.dataset.resolve === "accept")
                Object.assign(t, { title: t.source_pending.title, brief: t.source_pending.brief });
              t.source_pending = null;
            },
          );
          $("#dialog").close();
          toast(b.dataset.resolve === "accept" ? "已采用原表新资料。" : "已保持原要求。");
        } catch (e) {
          error(e);
        }
      }),
  );
  if (!demo && user) void showUploadedImages();
  $("#edit-task")?.addEventListener("click", () => newTask(t));
  $("#claim")?.addEventListener("click", () => {
    if (!demo && !user) {
      $("#dialog").close();
      account();
      return;
    }
    act("claim", id);
  });
  $("#release")?.addEventListener("click", () => act("release", id));
  $("#submit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const f = new FormData(form);
    const file = form.elements.image.files[0];
    let url = String(f.get("url") || "").trim();
    button.disabled = true;
    try {
      if (file) {
        if (demo) throw Error("演示模式不支持真实图片上传，请用链接演示");
        toast("正在上传图片，请不要关闭页面…");
        url = await uploadSubmissionImage(t, file);
      } else {
        url = safeURL(url);
        if (url === "#") throw Error("请上传图片，或填写有效的作品链接");
      }
      await act("submit", id, {
        url,
        note: String(f.get("note") || "").trim(),
      });
    } catch (e) {
      error(e);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  for (const a of ["approve", "changes"])
    $("#" + a)?.addEventListener("click", () => {
      const feedback = $("#feedback").value.trim();
      if (a === "changes" && !feedback) return toast("请先填写具体修改意见");
      act(a, id, { feedback });
    });
}
function safeURL(s) {
  try {
    const u = new URL(s);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
}
function account() {
  if (demo) {
    modal(
      "演示身份",
      `<p class="muted">切换身份仅用于本地体验。真实会馆的负责人权限由数据库设置。</p><div class="switch-row">${data.profiles.map((p) => `<button class="outline" data-user="${p.id}">${esc(p.name)} · ${p.role === "admin" ? "负责人" : "画师"}</button>`).join("")}</div>`,
    );
    document.querySelectorAll("[data-user]").forEach(
      (b) =>
        (b.onclick = () => {
          user = { id: b.dataset.user };
          render();
          $("#dialog").close();
          toast("已切换演示身份");
        }),
    );
    return;
  }
  if (user) {
    modal(
      "我的账号",
      `<p class="detail-copy">${esc(profile?.name || user.email)}<br>${profile?.active ? "已入馆" : "等待负责人开通"}</p><form id="nickname-form"><label class="field">画师昵称<input name="name" required maxlength="40" value="${esc(profile?.name || "")}"></label><button class="primary">保存昵称</button></form><p class="muted">账号尾号：${esc(user.id.slice(-6))}，供负责人核对。</p><button id="signout" class="outline">退出登录</button>`,
    );
    $("#nickname-form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        const r = await client.rpc("guild_set_name", {
          p_name: new FormData(e.target).get("name").trim(),
        });
        if (r.error) throw r.error;
        await load();
        $("#dialog").close();
        toast("昵称已保存。");
      } catch (e) {
        error(e);
        b.disabled = false;
      }
    };
    $("#signout").onclick = async () => {
      await client.auth.signOut();
      $("#dialog").close();
    };
    return;
  }
  modal(
    "登录 / 加入会馆",
    '<p class="muted">可以直接浏览公开任务；用邮箱验证码登录后即可参与认领和交稿。</p><form id="login"><label class="field">邮箱<input name="email" type="email" required></label><button class="primary">发送验证码</button></form>',
  );
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get("email").trim(),
      b = e.target.querySelector("button");
    b.disabled = true;
    try {
      const r = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (r.error) throw r.error;
      modal(
        "检查邮箱",
        `<p class="muted">已向 ${esc(email)} 发送登录邮件。请输入邮件里的六位验证码。</p><form id="verify"><label class="field">验证码<input name="token" inputmode="numeric" required></label><button class="primary">登录</button></form>`,
      );
      $("#verify").onsubmit = async (ev) => {
        ev.preventDefault();
        const btn = ev.target.querySelector("button");
        btn.disabled = true;
        try {
          const r = await client.auth.verifyOtp({
            email,
            token: new FormData(ev.target).get("token").trim(),
            type: "email",
          });
          if (r.error) throw r.error;
          $("#dialog").close();
        } catch (e) {
          error(e);
          btn.disabled = false;
        }
      };
    } catch (e) {
      error(e);
      b.disabled = false;
    }
  };
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view],[data-filter],[data-task]");
  if (!b) return;
  if (b.dataset.view) {
    if (!demo && !user && b.dataset.view === "mine") {
      account();
      return;
    }
    view = b.dataset.view;
    filter = "all";
    render();
    $(".content").scrollIntoView({ behavior: "smooth" });
  } else if (b.dataset.filter) {
    filter = b.dataset.filter;
    render();
  } else detail(b.dataset.task);
});
$("#search").oninput = (e) => {
  query = e.target.value;
  render();
};
$("#close").onclick = () => $("#dialog").close();
$("#account").onclick = account;
$("#new-task").onclick = () => newTask();
$("#browse").onclick = () => {
  view = "board";
  filter = "open";
  render();
  $(".content").scrollIntoView({ behavior: "smooth" });
};
$("#refresh").onclick = () => load().then(() => toast("已重新读取"));
$("#settings").onclick = () =>
  modal(
    "会馆连接",
    `<p class="detail-copy">${demo ? "当前为本地演示。部署时在 config.js 填入 Supabase 项目 URL 和 publishable 公钥，执行数据库脚本后即可切换真实模式。" : "当前连接 Supabase。成员权限、验收与贡献记分由数据库验证。"}</p><p class="muted">作品暂以链接 / 网盘交付。贡献排行仅记录验收通过的任务。同一任务不会重复记分。</p>`,
  );
async function init() {
  if (demo) {
    try {
      data = JSON.parse(localStorage.getItem(DEMO)) || seed();
    } catch {
      data = seed();
    }
    user = { id: "demo-0" };
    render();
    addEventListener("storage", (e) => {
      if (e.key === DEMO) {
        try {
          data = JSON.parse(e.newValue) || seed();
          render();
        } catch {}
      }
    });
    return;
  }
  $("#connection").textContent = "正在连接…";
  try {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.57.4"
    );
    client = createClient(cfg.supabaseUrl, cfg.supabaseKey);
    user = (await client.auth.getSession()).data.session?.user;
    await load();
    client.auth.onAuthStateChange((_event, session) => {
      const previousUser = user?.id;
      user = session?.user;
      setTimeout(() => {
        if (previousUser !== user?.id) {
          data = { tasks: [], profiles: [], submissions: [], awards: [] };
          render();
        }
        load();
      }, 0);
    });
    channel = client.channel("guild-live");
    for (const table of [
      "tasks",
      "submissions",
      "awards",
      "profiles",
      "campaign",
    ])
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guild_" + table },
        () => scheduleLoad(),
      );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "guild_task_preview" },
      () => { if (!user) scheduleLoad(); },
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        load();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        $("#connection").textContent = "○ 连接中断 · 点击刷新";
      }
    });
    addEventListener("focus", () => load());
    // 游客视图没有实时推送：页面可见时每 3 分钟补读一次，跟上原表同步。
    setInterval(() => {
      if (!user && document.visibilityState === "visible") load();
    }, 180000);
    addEventListener("online", () => load());
  } catch (e) {
    $("#connection").textContent = "连接失败";
    error(e);
    render();
  }
}

function taskLabel(t) {
  if (t.status !== "imported") return labels[t.status] || t.status;
  return {
    final: "原表已交终稿",
    assigned: "原表已登记画师",
    unassigned: "原表尚未分配",
    removed: "已从原表移除",
  }[sourceState(t)] || "原表登记";
}
// 正式任务与原表不一致时的提醒；只提示，不改动委托本身。
function syncBadge(t) {
  if (t.status === "imported") return "";
  if (t.source_removed_at) return '<span class="tag warn">原表已移除</span>';
  if (t.source_pending) return '<span class="tag warn">原表有更新</span>';
  return "";
}
function taskArtist(t) {
  if (!demo && !user) {
    if (t.status === "open") return "等待认领";
    if (t.status === "done") return "已完成";
    if (t.status === "imported") return "原表登记";
    return "已有画师负责";
  }
  return t.assignee
    ? name(t.assignee)
    : t.status === "imported"
      ? t.source_record?.artist || "未登记画师"
      : "未认领";
}
function pointLabel(t) {
  return t.points == null ? "贡献分待约定" : `${Number(t.points)} 贡献分`;
}
function renderImportSummary() {
  let box = $("#import-summary");
  if (!box) {
    box = document.createElement("div");
    box.id = "import-summary";
    box.className = "notice";
    $("#stats").after(box);
  }
  const rows = data.tasks.filter((t) => t.import_key && !t.source_removed_at),
    removed = data.tasks.filter((t) => t.import_key && t.source_removed_at).length,
    pending = rows.filter((t) => t.status === "imported").length;
  box.hidden = !rows.length;
  box.innerHTML = `${esc(`原表现有 ${rows.length} 张卡 · ${rows.filter((t) => t.source_record?.artist).length} 张登记了画师 · ${rows.filter((t) => t.source_record?.status === "已递交终稿").length} 张已递交终稿 · ${pending} 张未转为正式任务${removed ? ` · ${removed} 张已从原表移除（记录保留）` : ""}。原表交稿不等于平台验收。`)}${syncStatusHTML()}`;
  $("#approve-sync")?.addEventListener("click", async (e) => {
    const n = Number(e.currentTarget.dataset.count),
      kind = e.currentTarget.dataset.kind;
    try {
      await adminRPC(
        "guild_kdocs_approve",
        kind === "removal" ? { p_removals: n } : { p_removals: null, p_inserts: n },
        () => {},
      );
      toast("已确认，下一次自动同步（5 分钟内）会执行。");
    } catch (err) {
      error(err);
    }
  });
}
// 同步状态：成员看到最近同步时间；负责人额外看到失败原因和大批变更确认。
function syncStatusHTML() {
  const s = data.sync;
  if (!s?.state) return "";
  const last = s.state.last_success_at ? new Date(s.state.last_success_at) : null;
  let html = `<br><small>原表同步：${last ? last.toLocaleString("zh-CN") : "尚未成功"}</small>`;
  if (profile?.role !== "admin" || !s.run || s.run.status !== "failed") return html;
  const code = String(s.run.error_code || ""),
    bulk = code.match(/^MASS_(REMOVAL|INSERT)_BLOCKED_(\d+)$/);
  if (bulk) {
    const kind = bulk[1] === "REMOVAL" ? "removal" : "insert",
      n = Number(bulk[2]),
      approved = kind === "removal" ? s.state.approved_removals : s.state.approved_inserts;
    return html + `<br><b>同步已暂停：</b>原表这次会${kind === "removal" ? "移除" : "新增"} ${n} 张卡。若是有意修改，请确认；若原表被误删或读取异常，请先在金山修复。${approved === n ? "（已确认，等待下次同步）" : ` <button class="outline" id="approve-sync" data-kind="${kind}" data-count="${n}">确认${kind === "removal" ? "移除" : "新增"} ${n} 张</button>`}`;
  }
  const stale = !last || Date.now() - last > 30 * 60 * 1000;
  return stale
    ? html + `<br><b>同步失败：</b>${esc(code || "未知原因")}${/^SOURCE_HTTP_40[13]$/.test(code) ? "（金山脚本令牌可能已过期，需要重新生成）" : ""}`
    : html;
}
function historySummary() {
  const artists = new Map();
  for (const t of data.tasks) {
    const s = t.source_record;
    if (!s?.artist) continue;
    const a = artists.get(s.artist) || { name: s.artist, count: 0, finals: 0 };
    a.count++;
    if (s.status === "已递交终稿") a.finals++;
    artists.set(s.artist, a);
  }
  if (!artists.size) return "";
  return (
    '<h3>原表交稿记录</h3><p class="muted">这是导入时的登记快照，不是验收排名，不计入贡献分。新交稿请看平台记录。</p>' +
    [...artists.values()]
      .sort(
        (a, b) => b.finals - a.finals || a.name.localeCompare(b.name, "zh-CN"),
      )
      .map(
        (a) =>
          `<div class="person"><span class="avatar">${esc(a.name.slice(0, 1))}</span><div class="name">${esc(a.name)}<small>原表登记 ${a.count} 条</small></div><strong>${a.finals}<small>已递交终稿</small></strong></div>`,
      )
      .join("")
  );
}
function importDetail(t, admin) {
  const s = t.source_record;
  if (!s) return "";
  let html = `<div class="submission"><b>原表记录 · ${esc(s.system)}</b><p>负责画师：${esc(s.artist || "未登记")}<br>完成情况：${esc(s.status || "未填写")}<br>来源：${esc(s.sheet)}${s.row ? `，第 ${Number(s.row)} 行` : ""}<br>卡牌 ID：${esc(s.card_id)}</p><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">查看原始表格 ↗</a><p class="muted">${t.kdocs_card_id ? "随金山原表自动同步（约 5 分钟）。" : ""}原表登记不会自动绑定账号、验收或记分。</p></div>`;
  if (t.source_removed_at)
    html += `<div class="submission"><b>这张卡已从金山原表移除</b><p>${new Date(t.source_removed_at).toLocaleString("zh-CN")} 起不在原表中。${t.status === "imported" ? "记录保留但不再公开；如属误删，在原表恢复同一行（保留同步ID）即可重新显示。" : "平台上的任务、作品和贡献分都保留，请负责人与画师核实是否继续。"}</p></div>`;
  if (t.source_pending && t.status !== "imported")
    html += `<div class="submission"><b>原表资料有更新，待负责人核对</b><p>新名称：${esc(t.source_pending.title)}</p><p class="detail-copy">${esc(t.source_pending.brief)}</p><p class="muted">${t.status === "open" ? "采用后会更新任务名称和要求，贡献分不变。" : "画师已接手，平台不会自动改动已约定的要求；请先与画师沟通。"}</p>${admin ? `<div class="actions">${t.status === "open" ? '<button class="primary" data-resolve="accept">采用原表新资料</button>' : ""}<button class="outline" data-resolve="dismiss">保持原要求</button></div>` : ""}</div>`;
  if (t.status !== "imported") return html;
  if (t.source_removed_at) return html;
  if (!admin)
    return (
      html +
      '<p class="muted">负责人确认贡献分和负责画师后，这份记录会转成可操作的任务。</p>'
    );
  const members = data.profiles.filter((p) => p.active);
  return (
    html +
    `<form id="activate-import"><h3>确认这份任务</h3><p class="muted">请核对画师本人账号。已交终稿的记录也需要补交作品链接，再走验收。确认旧版卡牌前，请先排除共用美术的情况。</p><label class="field">已约定的贡献分<input name="points" type="number" min="1" max="1000" required placeholder="填写与画师约定的分数"></label><label class="field">负责画师的已开通账号<select name="assignee" ${s.artist ? "required" : ""}><option value="">${s.artist ? "请选择原画师账号" : "开放给成员认领"}</option>${members.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.id.slice(-6))}${p.role === "admin" ? "（负责人）" : ""}</option>`).join("")}</select></label><p class="muted">找不到画师时，先请对方登录并由负责人开通账号，不要选同名或他人的账号代替。</p>${s.system === "旧版参考" ? '<label class="field"><span><input name="legacy" type="checkbox" required> 已确认这张旧版卡牌需要单独绘制</span></label>' : ""}<button class="primary">确认并转为任务</button></form>`
  );
}
function bindImportForm(t) {
  const form = $("#activate-import");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const f = new FormData(form);
      const points = Number(f.get("points"));
      if (!Number.isInteger(points) || points < 1 || points > 1000)
        throw Error("请填写 1–1000 的整数贡献分");
      const assignee = f.get("assignee") || null;
      if (demo) {
        t.points = points;
        t.assignee = assignee;
        t.status = assignee ? "active" : "open";
        store();
        render();
      } else {
        const r = await client.rpc("guild_activate_import", {
          p_task: t.id,
          p_points: points,
          p_assignee: assignee,
          p_legacy_confirm: f.get("legacy") === "on",
        });
        if (r.error) throw r.error;
        await load();
      }
      $("#dialog").close();
      toast(
        assignee ? "已绑定画师，请补充作品链接后提交验收。" : "已开放认领。",
      );
    } catch (e) {
      error(e);
    } finally {
      busy = false;
      button.disabled = false;
    }
  };
}

// Points describe an agreed deliverable, not drawing skill or a cash exchange rate.
const SCORE_GUIDE = [
  {
    name: "大场景",
    points: 320,
    unit: "完整大幅场景：构图、前中后景与细节",
    brief:
      "画面用途：\n构图与主要元素：\n参考链接：\n尺寸 / 格式：\n交付：完整色稿及约定源文件。草稿、线稿、上色合计为本任务分值。",
  },
  {
    name: "常规场景",
    points: 160,
    unit: "一张完整常规场景",
    brief:
      "场景地点与用途：\n需要出现的元素：\n参考链接：\n尺寸 / 格式：\n交付：完整场景稿。",
  },
  {
    name: "小场景 / 物件",
    points: 60,
    unit: "一个小场景或独立物件",
    brief:
      "场景 / 物件内容：\n参考链接：\n尺寸 / 格式：\n交付：透明底素材及约定源文件。",
  },
  {
    name: "Q版卡牌",
    points: 40,
    unit: "一张 Q 版卡面，简单背景或透明底",
    brief:
      "卡牌名称与角色：\n动作 / 表情：\n参考链接：\n尺寸 / 格式：\n交付：一张完整 Q 版卡面。复杂背景需另行约定工作量。",
  },
  {
    name: "角色立绘",
    points: 120,
    unit: "一张完整角色立绘，不含额外差分",
    brief:
      "角色与用途：\n服饰 / 动作：\n参考链接：\n尺寸 / 格式：\n交付：完整立绘及约定源文件。",
  },
  {
    name: "表情 / 动作差分",
    points: 20,
    unit: "基于已有立绘的一项差分",
    brief:
      "原立绘链接：\n新增差分：\n尺寸 / 格式：\n交付：约定的一项差分，不重复计算原立绘分值。",
  },
  {
    name: "UI 页面设计",
    points: 160,
    unit: "一个完整页面及约定交互状态",
    brief:
      "页面用途：\n必要信息与操作：\n需要的状态（默认 / 悬停 / 禁用等）：\n参考与尺寸：\n交付：可编辑界面稿及切图。",
  },
  {
    name: "UI 图标",
    points: 20,
    unit: "一个图标及约定状态 / 导出尺寸",
    brief:
      "图标含义：\n需要的状态与尺寸：\n风格参考：\n交付：可编辑文件及透明 PNG。同一图标多尺寸不重复计分。",
  },
  {
    name: "任务拆分 / 整理",
    points: 20,
    unit: "一批不超过 10 项的清晰需求清单",
    brief:
      "待整理的原需求：\n本批范围（不超过 10 项）：\n交付：逐项写清产出、参考、负责人需求与验收条件。按一批计分，不按拆出的条数计分。",
  },
  {
    name: "其他",
    points: null,
    unit: "负责人先估工作量，再与参与者确认",
    brief: "要做什么：\n参考资料：\n交付清单：\n验收条件：",
  },
];
let adminFilter = "submitted",
  refreshTimer;
function scheduleLoad() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(), 180);
}
function campaign() {
  return data.campaign?.[0] || { name: "第一期创作奖励", reward_amount: 100 };
}
function beijing(value) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
function phaseRanking() {
  const c = campaign();
  if (!c.starts_at || !c.ends_at) return [];
  return data.profiles
    .map((p) => {
      const awards = data.awards.filter((a) => {
        const s = data.submissions.find((s) => s.id === a.submission_id);
        return (
          a.artist_id === p.id &&
          s &&
          Date.parse(s.created_at) >= Date.parse(c.starts_at) &&
          Date.parse(s.created_at) <= Date.parse(c.ends_at)
        );
      });
      return {
        ...p,
        total: awards.reduce((n, a) => n + a.points, 0),
        count: awards.length,
      };
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-CN"));
}
function rewardHTML() {
  const c = campaign();
  return `<p class="eyebrow">一份小小的感谢 ( •̀ ω •́ )✧</p><h3>本期最高贡献奖励 ¥100</h3><p>${c.starts_at && c.ends_at ? `${esc(c.name)}<br>${esc(beijing(c.starts_at))} 至<br>${esc(beijing(c.ends_at))}（北京时间）` : "预计 11 月中下旬截止<br>具体起止时间待公布"}</p><p>本期最高贡献的小画师获得 100 元；并列第一均分这 100 元。额外感谢，不是稿酬或计件单价。</p><p>以统计期内提交、最终验收通过的版本计分。晚验收可补记；修改后按最终通过版本的提交时间判断。名单由负责人核对后公布。</p>`;
}
function phaseHTML() {
  const c = campaign(),
    rows = phaseRanking();
  const state = !c.starts_at
    ? "统计周期待公布"
    : Date.now() < Date.parse(c.starts_at)
      ? "尚未开始"
      : Date.now() <= Date.parse(c.ends_at)
        ? "本期暂列"
        : "已截止，待负责人核对";
  return `<section class="phase-board"><h3>本期贡献 · ${state}</h3><p class="muted">并列第一均分 100 元。暂列成绩不代表最终获奖结果；待验收稿件可能改变排序。</p>${!c.starts_at ? '<p class="muted">时间确定后开始按本期规则统计，累计贡献仍保留。</p>' : rows.length ? people(rows) : '<p class="muted">本期还没有验收通过的贡献。</p>'}</section>`;
}
function prepareAdmin() {
  let button = $("#admin-nav");
  if (!button) {
    button = document.createElement("button");
    button.id = "admin-nav";
    button.dataset.view = "admin";
    button.textContent = "▤　负责人工作台";
    document.querySelector("nav").append(button);
  }
  const allowed = profile?.active && profile?.role === "admin";
  button.hidden = !allowed;
  if (view === "admin" && !allowed) view = "board";
  document.body.classList.toggle("admin-mode", view === "admin");
  let reward = $("#reward-panel");
  if (!reward) {
    reward = document.createElement("section");
    reward.id = "reward-panel";
    reward.className = "panel guide reward-panel";
    $(".right-rail").prepend(reward);
  }
  reward.innerHTML = rewardHTML();
  reward.hidden = !profile?.active;
}
function scoreGuideHTML() {
  return `<p class="muted">暂行基准，按完整交付物估工作量，不给画技打分，也不与人民币换算。简单 / 标准 / 复杂分别 ×0.75 / ×1 / ×1.25，取最接近的 5 分；特殊工作量由负责人在发布前另行约定。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>类型</th><th>基准分</th><th>一份任务包含什么</th></tr></thead><tbody>${SCORE_GUIDE.map((s) => `<tr><td>${s.name}</td><td>${s.points ?? "另议"}</td><td>${s.unit}</td></tr>`).join("")}</tbody></table></div><p class="muted">草稿、线稿、上色和合理修改属于同一任务，不重复计分。多人协作拆项时，由负责人将原定总分分给各子项，总和不额外增加。差分和导出尺寸不按完整新稿重复记分。新增需求要先谈清楚，再单独发布；返工次数、抢交速度和画风偏好不加分。</p>`;
}
function memberOptions(selected) {
  return (
    '<option value="">开放认领</option>' +
    data.profiles
      .filter((p) => p.active)
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)} · ${esc(p.id.slice(-6))}${p.role === "admin" ? "（负责人）" : ""}</option>`,
      )
      .join("")
  );
}
function newTask(task = null) {
  const choices = SCORE_GUIDE.map((s) => s.name);
  if (task && !choices.includes(task.category)) choices.push(task.category);
  const category = task?.category || "Q版卡牌",
    guide = SCORE_GUIDE.find((s) => s.name === category);
  modal(
    task ? "编辑 / 分配任务" : "发布任务",
    `<form id="task-editor"><label class="field">任务名称<input name="title" required maxlength="80" value="${esc(task?.title || "")}" placeholder="例如：罗小黑 · Q版卡牌 · 遁空"></label><div class="form-grid"><label class="field">稿件分类<select name="category">${choices.map((c) => `<option ${c === category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label><label class="field">复杂度<select name="complexity"><option value="0.75">简单 ×0.75</option><option value="1" selected>标准 ×1</option><option value="1.25">复杂 ×1.25</option></select></label></div><p id="score-hint" class="muted"></p><label class="field">任务要求与验收清单<textarea name="brief" required maxlength="5000">${esc(task?.brief || guide?.brief || "")}</textarea></label><button type="button" id="insert-template" class="text-link">使用当前分类的需求模板（替换上方内容）</button><div class="form-grid"><label class="field">最终贡献分<input name="points" type="number" min="1" max="1000" required value="${task?.points ?? guide?.points ?? ""}"></label><label class="field">任务 DDL（可不填）<input name="due_date" type="date" value="${esc(task?.due_date || "")}"></label></div><label class="field">负责画师<select name="assignee">${memberOptions(task?.assignee)}</select></label><p class="muted">选画师后直接进入创作中；不选则开放认领。接稿前请确认要求和分值，创作开始后分值锁定。任务 DDL 与奖金统计截止时间分别设置。</p><button class="primary">${task ? "保存任务" : "发布任务"}</button></form>`,
  );
  const form = $("#task-editor"),
    cat = form.elements.category,
    complexity = form.elements.complexity;
  const suggest = (write = false) => {
    const s = SCORE_GUIDE.find((s) => s.name === cat.value);
    const points = s?.points
      ? Math.round((s.points * Number(complexity.value)) / 5) * 5
      : null;
    $("#score-hint").textContent = points
      ? `建议 ${points} 分 · ${s.unit}。负责人可在发布前调整。`
      : "请与参与者确认工作范围和分值。";
    if (write) form.elements.points.value = points ?? "";
  };
  suggest();
  cat.onchange = () => suggest(true);
  complexity.onchange = () => suggest(true);
  $("#insert-template").onclick = () => {
    form.elements.brief.value =
      SCORE_GUIDE.find((s) => s.name === cat.value)?.brief || "";
    toast("需求模板已填入，请补齐具体信息。");
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    delete f.complexity;
    f.points = Number(f.points);
    f.due_date ||= null;
    f.assignee ||= null;
    if (!Number.isInteger(f.points)) return toast("贡献分请填写整数");
    act(task ? "edit" : "create", task?.id || null, f);
  };
}
function renderAdmin() {
  const pending = data.profiles.filter((p) => !p.active && p.role === "artist");
  const filters = [
    ["submitted", "待验收"],
    ["imported", "原表待确认"],
    ["open", "待分配"],
    ["active", "创作中"],
    ["changes", "待修改"],
    ["done", "已完成"],
    ["attention", "原表变动"],
  ];
  const inAdminFilter = (t, f) =>
    f === "attention"
      ? matchesTaskFilter(t, "source-attention")
      : t.status === f && !(t.status === "imported" && t.source_removed_at);
  const rows = data.tasks
    .filter(
      (t) =>
        inAdminFilter(t, adminFilter) &&
        [t.title, t.category, t.brief, taskArtist(t)]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.source_record?.system === "旧版参考") -
          (b.source_record?.system === "旧版参考") ||
        (a.source_record?.row || 0) - (b.source_record?.row || 0),
    );
  $("#count").textContent = `${pending.length} 位画师待开通`;
  $("#list").innerHTML =
    `<div class="admin-workspace"><div class="admin-actions"><button id="admin-create" class="primary">＋ 发布任务</button><button id="show-score-guide" class="outline">分值参考</button><button id="campaign-settings" class="outline">设置本期时间</button><button id="manage-members" class="outline">画师管理${pending.length ? " · " + pending.length + " 待开通" : ""}</button></div><section class="panel admin-intro"><h3>任务从这里安排。</h3><p class="muted">发布 → 分配 / 认领 → 交稿 → 验收。原表记录先核对画师与分值；旧版参考先确认是否需要单独绘制。已开始创作的任务不能临时改分。</p></section><div class="filters admin-filters">${filters.map(([value, label]) => `<button data-admin-filter="${value}" class="${adminFilter === value ? "selected" : ""}">${label} ${data.tasks.filter((t) => inAdminFilter(t, value)).length}</button>`).join("")}</div><label class="search">⌕ <input id="admin-search" aria-label="搜索管理任务" placeholder="搜索任务、分类或画师" value="${esc(query)}"></label><div class="table-wrap"><table class="admin-table"><thead><tr><th>任务 / 分类</th><th>负责画师</th><th>状态</th><th>贡献分 / DDL</th><th>操作</th></tr></thead><tbody>${rows.map((t) => `<tr><td><b>${esc(t.title)}</b><small>${esc(t.category)}</small></td><td>${esc(taskArtist(t))}</td><td>${esc(taskLabel(t))}</td><td>${pointLabel(t)}<small>${esc(t.due_date || "未设 DDL")}</small></td><td><button class="outline" data-task="${esc(t.id)}">${t.status === "submitted" ? "验收" : t.status === "imported" ? "确认记录" : "查看 / 处理"}</button></td></tr>`).join("") || '<tr><td colspan="5">这里暂时没有任务 (｡･ω･｡)</td></tr>'}</tbody></table></div><section class="panel guide">${rewardHTML()}</section></div>`;
  $("#admin-create").onclick = () => newTask();
  $("#show-score-guide").onclick = () =>
    modal("暂行任务分值", scoreGuideHTML());
  $("#manage-members").onclick = manageMembers;
  $("#campaign-settings").onclick = editCampaign;
  document.querySelectorAll("[data-admin-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        adminFilter = b.dataset.adminFilter;
        renderAdmin();
      }),
  );
  $("#admin-search").oninput = (e) => {
    query = e.target.value;
    const pos = e.target.selectionStart;
    renderAdmin();
    $("#admin-search").focus();
    $("#admin-search").setSelectionRange(pos, pos);
  };
}
async function adminRPC(name, args, demoAction) {
  if (!profile?.active || profile.role !== "admin")
    throw Error("需要负责人权限");
  if (demo) {
    demoAction();
    store();
    render();
  } else {
    const r = await client.rpc(name, args);
    if (r.error) throw r.error;
    await load();
  }
}
function manageMembers() {
  modal(
    "画师管理",
    `<p class="muted">画师可使用邮箱验证码登录并填写昵称。管理员可管理已注册的画师账号；原表署名不会自动建立账号。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>昵称 / 账号尾号</th><th>状态</th><th>操作</th></tr></thead><tbody>${[
      ...data.profiles,
    ]
      .sort(
        (a, b) =>
          Number(a.active) - Number(b.active) ||
          a.name.localeCompare(b.name, "zh-CN"),
      )
      .map(
        (p) =>
          `<tr><td>${esc(p.name)}<small>${esc(p.id.slice(-6))}</small></td><td>${p.role === "admin" ? "负责人" : p.active ? "已开通" : "待开通"}</td><td>${p.role === "artist" ? `<button class="outline" data-member="${esc(p.id)}">管理</button>` : "—"}</td></tr>`,
      )
      .join("")}</tbody></table></div>`,
  );
  document
    .querySelectorAll("[data-member]")
    .forEach((b) => (b.onclick = () => editMember(b.dataset.member)));
}
function editMember(id) {
  const p = data.profiles.find((p) => p.id === id);
  if (!p) return;
  modal(
    "管理画师",
    `<form id="member-form"><p class="muted">账号尾号 ${esc(p.id.slice(-6))} · 请核对本人</p><label class="field">画师昵称<input name="name" maxlength="40" required value="${esc(p.name)}"></label><label class="field">成员状态<select name="active"><option value="true" ${p.active ? "selected" : ""}>开通成员功能</option><option value="false" ${!p.active ? "selected" : ""}>待开通 / 停用</option></select></label><p class="muted">开通后可查看团队任务及作品链接。有未完成任务时不能停用。</p><button class="primary">保存</button></form>`,
  );
  $("#member-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    const f = new FormData(e.target);
    try {
      await adminRPC(
        "guild_set_member",
        {
          p_user: id,
          p_name: f.get("name").trim(),
          p_active: f.get("active") === "true",
        },
        () => {
          p.name = f.get("name").trim();
          p.active = f.get("active") === "true";
        },
      );
      manageMembers();
      toast("画师资料已更新。");
    } catch (e) {
      error(e);
      b.disabled = false;
    }
  };
}
function editCampaign() {
  const c = campaign(),
    local = (s) =>
      s ? new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0, 16) : "";
  modal(
    "本期奖励时间",
    `<form id="campaign-form"><label class="field">阶段名称<input name="name" maxlength="60" required value="${esc(c.name)}"></label><label class="field">统计开始（北京时间）<input name="start" type="datetime-local" required value="${local(c.starts_at)}"></label><label class="field">统计截止（北京时间）<input name="end" type="datetime-local" required value="${local(c.ends_at)}"></label><p class="muted">奖金总额 100 元，并列第一均分。预计 11 月中下旬截止，时间确定后再保存。已公示时间如需调整，请先与参与者沟通；最终通过版本须在统计期内提交。</p><button class="primary">保存并公布时间</button></form>`,
  );
  $("#campaign-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      const f = new FormData(e.target),
        start = new Date(f.get("start") + ":00+08:00").toISOString(),
        end = new Date(f.get("end") + ":00+08:00").toISOString();
      if (end <= start) throw Error("截止时间必须晚于开始时间");
      await adminRPC(
        "guild_set_campaign",
        { p_name: f.get("name").trim(), p_start: start, p_end: end },
        () =>
          (data.campaign = [
            {
              ...c,
              name: f.get("name").trim(),
              starts_at: start,
              ends_at: end,
            },
          ]),
      );
      $("#dialog").close();
      toast("本期时间已公布。");
    } catch (e) {
      error(e);
      b.disabled = false;
    }
  };
}

init();
