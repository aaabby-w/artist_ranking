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
  demo = !cfg.supabaseUrl || !cfg.supabaseKey;
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
          `<div class="person"><b>${i + 1}</b><span class="avatar">${esc(p.name.slice(0, 1))}</span><div class="name">${esc(p.name)}<small>${p.count} 份委托已完成</small></div><strong>${p.total}<small>贡献分</small></strong></div>`,
      )
      .join("") || '<p class="muted">第一份完成的委托，将在这里留下名字。</p>'
  );
}
function render() {
  profile = data.profiles.find((p) => p.id === user?.id);
  $("#account").textContent = user
    ? "○　" + (profile?.name || "等待入馆")
    : "○　登录会馆";
  $("#notice").textContent = demo
    ? "演示会馆 · 当前使用示例任务，本机保存；可切换画师 / 负责人体验流程。"
    : user && !profile?.active
      ? "账号已登录，等待负责人开通成员权限。"
      : !user
        ? "请先登录会馆。委托和作品仅向已开通的成员展示。"
        : "欢迎来到会馆。按自己的时间认领，验收通过后自动记录贡献。";
  $("#new-task").hidden = profile?.role !== "admin";
  $("#stats").innerHTML = [
    [
      "等待认领",
      data.tasks.filter((t) => t.status === "open").length,
      "份委托",
    ],
    [
      "正在创作",
      data.tasks.filter((t) => ["active", "changes"].includes(t.status)).length,
      "份心意",
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
  $("#top").innerHTML = people(ranking(month()).slice(0, 3));
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#crumb").textContent = {
    board: "委托公告栏",
    mine: "我的画桌",
    rank: "贡献芳名录",
  }[view];
  $("#section-title").textContent = {
    board: "今天，想画点什么？",
    mine: "给每一份灵感，留一点时间。",
    rank: "每一笔，都算数。",
  }[view];
  $("#section-label").textContent =
    view === "rank" ? "THANK YOU FOR CREATING" : "TAKE A LITTLE QUEST";
  $("#toolbar").hidden = view === "rank";
  document
    .querySelectorAll("[data-filter]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.filter === filter),
    );
  if (view === "rank") {
    $("#list").innerHTML =
      '<div class="rank-list"><p class="muted">累计贡献 · 相同分数按昵称排列 · 仅记录已验收任务</p>' +
      people(ranking()) +
      "</div>";
    $("#count").textContent = "累计榜";
    return;
  }
  const tasks = data.tasks.filter(
    (t) =>
      (view !== "mine" || t.assignee === user?.id) &&
      (filter === "all" ||
        t.status === filter ||
        (filter === "active" && t.status === "changes")) &&
      [t.title, t.category, t.brief]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  $("#count").textContent = tasks.length + " 份委托";
  $("#list").innerHTML =
    tasks
      .map(
        (t) =>
          `<button class="card" data-task="${esc(t.id)}"><div class="card-top"><span class="tag">${esc(t.category)}</span><span class="tag ${esc(t.status)}">${labels[t.status]}</span></div><h3>${esc(t.title)}</h3><p>${esc(t.brief)}</p><div class="meta">${t.due_date ? "期望交稿 " + esc(t.due_date) : "时间可协商 · 不催稿"}</div><div class="card-bottom"><span>○ ${esc(name(t.assignee))}</span><span class="points">✧ ${t.points} 贡献分　↗</span></div></button>`,
      )
      .join("") ||
    '<div class="empty">这里暂时没有委托。<br>可以换个筛选，或去公告栏认领喜欢的任务。</div>';
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
    ++seq;
    data = { tasks: [], profiles: [], submissions: [], awards: [] };
    $("#connection").textContent = "请登录后查看会馆";
    render();
    return;
  }
  const n = ++seq;
  try {
    const tables = ["tasks", "profiles", "submissions", "awards"];
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
      if (action === "create") {
        if (profile.role !== "admin") throw Error("需要负责人权限");
        data.tasks.unshift({
          ...extra,
          id: uid(),
          status: "open",
          assignee: null,
          created_at: now(),
          updated_at: now(),
        });
      } else {
        if (!t) throw Error("委托不存在");
        if (action === "claim") {
          if (t.status !== "open") throw Error("这份委托已被认领");
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
      if (action === "create")
        r = await client.from("guild_tasks").insert(extra);
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
        release: "已归还委托，等你有空再来。",
        submit: "交稿成功，等待负责人验收。",
        approve: "已通过验收，贡献已记入芳名录。",
        changes: "修改意见已送达。",
        create: "新委托已贴上公告栏。",
      }[action],
    );
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
function detail(id) {
  const t = data.tasks.find((t) => t.id === id);
  if (!t) return;
  const own = t.assignee === user?.id,
    admin = profile?.role === "admin";
  const subs = data.submissions.filter((s) => s.task_id === id);
  modal(
    t.title,
    `<span class="tag">${esc(t.category)} · ${labels[t.status]}</span><p class="detail-copy">${esc(t.brief)}</p><p class="detail-meta">贡献 ${t.points} 分 · ${esc(name(t.assignee))}<br>${t.due_date ? "期望交稿 " + esc(t.due_date) : "交稿时间可与负责人协商"}</p>${subs.map((s) => `<div class="submission"><b>${esc(name(s.author_id))} · ${new Date(s.created_at).toLocaleString("zh-CN")}</b><p>${esc(s.note)}</p><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">打开作品 / 网盘链接 ↗</a>${s.feedback ? "<p>负责人反馈：" + esc(s.feedback) + "</p>" : ""}</div>`).join("")}${own && ["active", "changes"].includes(t.status) ? '<form id="submit-form"><label class="field">作品或网盘链接<input name="url" type="url" required placeholder="https://…"></label><label class="field">交稿说明 / 提取码<textarea name="note" required maxlength="2000"></textarea></label><button class="primary">提交验收</button></form>' : ""}${admin && t.status === "submitted" && !own ? '<label class="field">验收反馈<textarea id="feedback" maxlength="2000" placeholder="需要修改时，请写清具体位置和建议。"></textarea></label>' : ""}<div class="actions">${t.status === "open" ? '<button class="primary" id="claim">认领这份委托</button>' : ""}${own && ["active", "changes"].includes(t.status) ? '<button class="outline" id="release">归还委托</button>' : ""}${admin && t.status === "submitted" && !own ? '<button class="primary" id="approve">通过并记入贡献</button><button class="outline" id="changes">请画师修改</button>' : ""}</div>`,
  );
  $("#claim")?.addEventListener("click", () => act("claim", id));
  $("#release")?.addEventListener("click", () => act("release", id));
  $("#submit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const url = safeURL(f.get("url"));
      if (url === "#") throw Error("请输入有效的 https 或 http 链接");
      act("submit", id, { url, note: f.get("note").trim() });
    } catch (e) {
      error(e);
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
      "我的会馆",
      `<p class="detail-copy">${esc(profile?.name || user.email)}<br>${profile?.active ? "已入馆" : "等待负责人开通"}</p><button id="signout" class="outline">退出登录</button>`,
    );
    $("#signout").onclick = async () => {
      await client.auth.signOut();
      $("#dialog").close();
    };
    return;
  }
  modal(
    "登录 / 加入会馆",
    '<p class="muted">使用邮箱验证码登录。新成员需要负责人开通，才能查看和认领委托。</p><form id="login"><label class="field">邮箱<input name="email" type="email" required></label><button class="primary">发送验证码</button></form>',
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
        `<p class="muted">已向 ${esc(email)} 发送登录邮件。可以打开邮件链接，或输入邮件里的验证码。</p><form id="verify"><label class="field">验证码<input name="token" inputmode="numeric" required></label><button class="primary">登录</button></form>`,
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
function newTask() {
  modal(
    "发布一份新委托",
    '<form id="create"><label class="field">委托名称<input name="title" required maxlength="80"></label><label class="field">分类<select name="category"><option>角色</option><option>场景</option><option>UI 图标</option><option>卡牌</option><option>像素</option><option>其他</option></select></label><label class="field">要求与交付格式<textarea name="brief" required maxlength="5000" placeholder="画什么、参考在哪里、交什么格式、尺寸多大…"></textarea></label><label class="field">贡献分（发布前约定）<input name="points" type="number" min="1" max="1000" value="30" required></label><label class="field">期望交稿日期（可不填）<input name="due_date" type="date"></label><button class="primary">贴上公告栏</button></form>',
  );
  $("#create").onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.points = Number(f.points);
    f.due_date ||= null;
    act("create", null, f);
  };
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view],[data-filter],[data-task]");
  if (!b) return;
  if (b.dataset.view) {
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
$("#new-task").onclick = newTask;
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
    `<p class="detail-copy">${demo ? "当前为本地演示。部署时在 config.js 填入 Supabase 项目 URL 和 publishable 公钥，执行数据库脚本后即可切换真实模式。" : "当前连接 Supabase。成员权限、验收与贡献记分由数据库验证。"}</p><p class="muted">作品暂以链接 / 网盘交付。贡献排行仅记录验收通过的委托。同一委托不会重复记分。</p>`,
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
      user = session?.user;
      setTimeout(() => {
        data = { tasks: [], profiles: [], submissions: [], awards: [] };
        render();
        load();
      }, 0);
    });
    channel = client.channel("guild-live");
    for (const table of ["tasks", "submissions", "awards", "profiles"])
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guild_" + table },
        () => load(),
      );
    channel.subscribe((status) => {
      $("#connection").textContent =
        status === "SUBSCRIBED" ? "● 实时已连接" : "○ 连接中断 · 将自动重连";
      if (status === "SUBSCRIBED") load();
    });
    addEventListener("focus", () => load());
    addEventListener("online", () => load());
  } catch (e) {
    $("#connection").textContent = "连接失败";
    error(e);
    render();
  }
}
init();
