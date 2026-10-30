// Private inbox and first-visit walkthrough. All writes use self-scoped RPCs.
let inboxRows = [], inboxOwner = null, inboxBusy = false, tourOpen = false;
function renderInbox() {
  let b=document.querySelector('#inbox');
  if(!b){b=document.createElement('button');b.id='inbox';b.className='inbox-button';document.querySelector('header > div').prepend(b);b.onclick=()=>{if(!demo&&!user){account();document.querySelector('#dialog-title').textContent='登录后查看信箱';return;}openInbox();};}
  b.hidden=false;const unread=inboxOwner===user?.id?inboxRows.filter(n=>!n.read_at).length:0;
  b.classList.toggle('has-unread',unread>0);b.setAttribute('aria-label',`通知，${unread}条未读`);
  b.innerHTML=`<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg></span>${unread?`<i aria-hidden="true">${unread>9?'9+':unread}</i>`:''}`;
}
async function refreshInbox(){
 if(demo||!user){inboxRows=[];inboxOwner=null;renderInbox();return;}
 const owner=user.id;const r=await client.from('guild_notifications').select('*').order('created_at',{ascending:false}).limit(100);
 if(owner!==user?.id||r.error)return;
 inboxRows=r.data||[];inboxOwner=owner;renderInbox();
 if(profile?.role==='artist'&&!profile.onboarding_done&&!tourOpen&&!document.querySelector('#dialog').open){tourOpen=true;showTour(0);}
}
// 信箱：邮件客户端式列表（置顶的本期奖励信 + 通知），点开进入阅读页，打开即标为已读。
let inboxTab = "all";
const REWARD_MAIL = {
  id: "reward", pinned: true, from: "美术组", avatar: "绘", tone: "gold",
  title: "本期最高贡献奖励 ¥100",
  preview: "元旦之前，本期贡献榜第一名可以获得 100 元奖励，如果有并列第一就由大家平分。",
  html: `<p class="mail-hello">一点小心意 ( •̀ ω •́ )✧</p><div class="mail-reward"><span>第一期创作奖励</span><strong>¥100</strong><small>DDL（截止日期）：2027年1月1日</small></div>
<p>元旦之前，本期贡献榜第一名可以获得 100 元奖励，如果有并列第一就由大家平分。奖池来自某位好心人的自愿赞助，主要是想给这段时间投入比较多的小画师一点小奖励。（辛苦啦！）</p>
<p>在 DDL（截止日期）前提交，并且最终通过的作品，都会计入本期贡献。</p>
<p>我们想尽量赶上罗小黑 TV 更新的这波热度，在这段时间里多做一些能玩的项目，也让更多喜欢罗小黑的人发现我们。<span class="whisper">（万一被HMCH注意到了呢(ﾉ>ω<)ﾉ ）</span></p>
<details class="mail-why">
<summary>为什么要设 DDL（截止日期），还有这 100 元？</summary>
<p>因为很多素材不是独立的。一份玩法可能要等好几位画师的素材才能继续做。如果没有一个大致的时间安排，开发这边也不好确定进度，任务就容易一直搁着,还会消耗大家的热情…… 所以每期会设一个 DDL（截止日期），方便大家安排时间，也方便开发组往下推进。</p>
<p>100 元是好心人自愿赞助的，作为本期贡献榜第一名的奖励。另外，我们也会根据贡献记录整理最后的鸣谢名单。</p>
<p>认领任务之前可以先看看自己的时间。如果最近有考试、工作，或者发现任务确实画不完，提前和负责人说一声就好。任务可以调整，也可以归还任务，不用有心理负担～</p>
</details>`,
};
function mailSender(n) {
  const t = String(n.title || "");
  if (t.includes("欢迎")) return { from: "众生绘卷", avatar: "众", tone: "green" };
  if (t.includes("新任务")) return { from: "任务公告栏", avatar: "任", tone: "blue" };
  if (t.includes("验收") || t.includes("修改")) return { from: "验收台", avatar: "验", tone: t.includes("修改") ? "rose" : "green" };
  return { from: "美术组", avatar: "美", tone: "gold" };
}
function mailTime(iso) {
  const d = new Date(iso), now = new Date();
  if (isNaN(d)) return "";
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨天";
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function inboxMails() {
  return [REWARD_MAIL, ...inboxRows.map((n) => ({ ...mailSender(n), id: n.id, unread: !n.read_at, title: n.title, preview: n.body, time: mailTime(n.created_at), full: new Date(n.created_at).toLocaleString("zh-CN"), task: n.task_id, html: `<p>${esc(n.body)}</p>` }))];
}
function openInbox(mailId) {
  const mails = inboxMails(), unread = mails.filter((m) => m.unread).length;
  const open = mailId && mails.find((m) => m.id === mailId);
  if (open) {
    modal("你的信箱 ✉", `<article class="mail-read"><button class="mail-back" id="mail-back">‹ 收件箱</button>
<h3>${esc(open.title)}</h3>
<div class="mail-meta"><span class="mail-avatar tone-${open.tone}">${esc(open.avatar)}</span><div><b>${esc(open.from)}</b><small>发给 我${open.full ? " · " + esc(open.full) : " · 置顶"}</small></div></div>
<div class="mail-body">${open.html}</div>
${open.task ? `<div class="actions"><button class="primary" data-inbox-task="${esc(open.task)}">查看任务 →</button></div>` : ""}</article>`);
    $("#mail-back").onclick = () => openInbox();
    document.querySelectorAll("[data-inbox-task]").forEach((b) => (b.onclick = () => detail(b.dataset.inboxTask)));
    if (open.unread && !inboxBusy) {
      inboxBusy = true;
      client.rpc("guild_read_notification", { p_id: open.id }).then(({ error: e }) => { if (!e) { const n = inboxRows.find((r) => r.id === open.id); if (n) n.read_at = new Date().toISOString(); renderInbox(); } }).finally(() => (inboxBusy = false));
    }
    return;
  }
  const shown = inboxTab === "unread" ? mails.filter((m) => m.unread) : mails;
  modal("你的信箱 ✉", `<div class="mail">
<div class="mail-bar"><div class="mail-tabs" role="tablist"><button role="tab" data-mail-tab="all" aria-selected="${inboxTab === "all"}">全部</button><button role="tab" data-mail-tab="unread" aria-selected="${inboxTab === "unread"}">未读${unread ? `<em>${unread}</em>` : ""}</button></div>${unread ? '<button class="mail-readall" id="mail-readall">全部标为已读</button>' : ""}</div>
<ul class="mail-list">${shown.map((m) => `<li><button class="mail-row${m.unread ? " unread" : ""}${m.pinned ? " pinned" : ""}" data-mail="${esc(m.id)}"><span class="mail-avatar tone-${m.tone}">${esc(m.avatar)}</span><span class="mail-main"><span class="mail-top"><b>${esc(m.from)}</b>${m.pinned ? '<span class="mail-pin">置顶</span>' : ""}<time>${esc(m.time || "")}</time></span><span class="mail-subject">${esc(m.title)}</span><span class="mail-preview">${esc(m.preview)}</span></span></button></li>`).join("") || '<li class="mail-empty">没有未读消息 ✓</li>'}</ul>
<p class="inbox-end"><span>到底啦，安心画画吧 (｡･ω･｡)</span></p></div>`);
  document.querySelectorAll("[data-mail-tab]").forEach((b) => (b.onclick = () => { inboxTab = b.dataset.mailTab; openInbox(); }));
  document.querySelectorAll("[data-mail]").forEach((b) => (b.onclick = () => openInbox(b.dataset.mail)));
  const all = $("#mail-readall");
  if (all) all.onclick = async () => {
    if (inboxBusy) return;
    inboxBusy = true;
    try {
      for (const n of inboxRows.filter((r) => !r.read_at)) { const r = await client.rpc("guild_read_notification", { p_id: n.id }); if (r.error) throw r.error; }
      await refreshInbox(); openInbox();
    } catch (e) { error(e); } finally { inboxBusy = false; }
  };
}
let tourCleanup = null;
function showTour(step) {
  const steps = [
    ["board", "#account", "先认识一下", "这里是你的账号。昵称尽量与群里或原表一致，方便负责人核对；以后也能从这里重新打开引导。"],
    ["board", 'nav [data-view="board"]', "找到想画的任务", "从任务公告栏查看要求、分值和截止日期，再认领适合自己的任务。点开卡牌就能看详情。"],
    ["mine", 'nav [data-view="mine"]', "交稿来这里", "认领或分配给你的任务会出现在我的画桌。打开任务上传图片、提交验收；需要修改时，也在这里查看意见。"],
    ["gallery", 'nav [data-view="gallery"]', "看看大家的作品", "稿件展示里可以查看已上传的图片。历史稿件由负责人补传，原表署名核对后会连接到你的账号。"],
    ["rank", 'nav [data-view="rank"]', "贡献与本期奖励", "验收通过后才记录贡献。本期美术组第一名奖励 100 元，并列第一均分，具体统计时间看榜单说明。"],
    ["rank", "#inbox", "新消息在这里", "信封出现红点并轻晃，就有未读通知：新任务、验收通过或修改意见。点开信封即可查看。"],
  ];
  tourCleanup?.(false);
  document.querySelector('#dialog').close();
  tourOpen = true;
  const [page, selector, title, body] = steps[step];
  view = page;
  render();
  const target = document.querySelector(selector);
  if (!target || target.hidden) return;
  target.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  const panel = document.createElement('section');
  panel.className = 'tour-tip';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'tour-title');
  panel.tabIndex = -1;
  panel.innerHTML = `<span class="tour-arrow" aria-hidden="true"></span><div class="tour-top"><span>会馆小指引 · ${step + 1} / ${steps.length}</span><button id="tour-skip" aria-label="关闭引导">×</button></div><h3 id="tour-title">${esc(title)}</h3><p>${esc(body)}</p><div class="tour-actions">${step ? '<button id="tour-prev">上一步</button>' : '<span>慢慢来，不着急 (｡･ω･｡)</span>'}<button id="tour-next" class="primary">${step === steps.length - 1 ? '我知道啦' : '下一步 →'}</button></div><p class="tour-error" role="status"></p>`;
  const ring = document.createElement('div');
  ring.className = 'tour-ring';
  ring.setAttribute('aria-hidden', 'true');
  document.body.append(ring, panel);
  let frame;
  const position = () => {
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const gap = 16, pad = 12, w = panel.offsetWidth, h = panel.offsetHeight;
    const options = [
      ['right', r.right + gap, r.top + r.height / 2 - h / 2],
      ['bottom', r.left + r.width / 2 - w / 2, r.bottom + gap],
      ['top', r.left + r.width / 2 - w / 2, r.top - gap - h],
      ['left', r.left - gap - w, r.top + r.height / 2 - h / 2],
    ];
    const fits = ([side, x, y]) => side === 'right' || side === 'left'
      ? x >= pad && x + w <= vw - pad : y >= pad && y + h <= vh - pad;
    const [side, x, y] = options.find(fits) || options[1];
    const left = Math.max(pad, Math.min(x, vw - w - pad));
    const top = Math.max(pad, Math.min(y, vh - h - pad));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    panel.dataset.side = side;
    panel.style.setProperty('--arrow-x', `${Math.max(20, Math.min(w - 20, r.left + r.width / 2 - left))}px`);
    panel.style.setProperty('--arrow-y', `${Math.max(20, Math.min(h - 20, r.top + r.height / 2 - top))}px`);
    Object.assign(ring.style, {left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`});
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
  const observer = new ResizeObserver(schedule);
  observer.observe(target); observer.observe(panel);
  const keydown = (e) => { if(e.key === 'Escape') { e.preventDefault(); tourCleanup?.(); } };
  tourCleanup = (restore = true) => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    document.removeEventListener('keydown', keydown);
    panel.remove(); ring.remove(); tourCleanup = null;
    if (restore && target.isConnected) target.focus({preventScroll: true});
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  document.addEventListener('keydown', keydown);
  position(); panel.focus({preventScroll: true});
  panel.querySelector('#tour-skip').onclick = () => tourCleanup?.();
  if (step) panel.querySelector('#tour-prev').onclick = () => showTour(step - 1);
  panel.querySelector('#tour-next').onclick = async (e) => {
    if (step < steps.length - 1) return showTour(step + 1);
    e.currentTarget.disabled = true;
    try {
      if (!demo) { const r = await client.rpc('guild_finish_onboarding'); if (r.error) throw r.error; }
      if (profile) profile.onboarding_done = true;
      tourCleanup?.();
    } catch (_) {
      if (!panel.isConnected) return;
      panel.querySelector('.tour-error').textContent = '暂时没能保存进度，请重试，或点 × 关闭。';
      panel.querySelector('#tour-next').disabled = false;
    }
  };
}

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
// 每条记录只进一个列表。原表卡按登记进度并入平台列表（仅显示，认领与记分仍需负责人定分）：
// 尚未分配 → 待认领，已登记画师 → 创作中，已递交终稿 → 待验收；已从原表移除的不进任何列表。
function taskList(t) {
  if (t.status !== "imported") return t.status;
  return { unassigned: "open", assigned: "active", final: "submitted", unknown: "open" }[sourceState(t)] || null;
}
function matchesTaskFilter(t, selected) {
  if (selected === "source-attention")
    return t.status !== "imported" && (!!t.source_removed_at || !!t.source_pending);
  const list = taskList(t);
  return selected === "all" ? list !== null : list === selected;
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
    (t) => (view !== "mine" || belongsToMe(t)) && matchesTaskSearch(t),
  );
  const definitions = [
    ["all", "全部记录"],
    ...(view === "board" ? [["open", "待认领"]] : []),
    ["active", "创作中"],
    ["submitted", "待验收"],
    ["changes", "待修改"],
    ["done", "已完成"],
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
  renderInbox();
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
        ? "您当前是游客身份；登录后可以认领和交稿。"
        : "欢迎来到会馆。按自己的时间认领，验收通过后自动记录贡献。";
  $("#new-task").hidden = profile?.role !== "admin";
  $("#stats").innerHTML = [
    [
      "等待认领",
      data.tasks.filter((t) => taskList(t) === "open").length,
      "份任务",
    ],
    [
      "正在创作",
      data.tasks.filter((t) => ["active", "changes"].includes(taskList(t))).length,
      "份任务",
    ],
    [
      "等待验收",
      data.tasks.filter((t) => taskList(t) === "submitted").length,
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
    gallery: "稿件展示",
    rank: "贡献芳名录",
  }[view];
  $("#section-title").textContent = {
    admin: "发任务、分画师、看交稿。",
    board: "今天，想画点什么？",
    mine: "给每一份灵感，留一点时间。",
    gallery: "交上来的每一张，都在这里。",
    rank: "每一笔，都算数。",
  }[view];
  $("#section-label").textContent =
    view === "rank" ? "THANK YOU FOR CREATING" : view === "gallery" ? "THE WALL OF WORKS" : "TAKE A LITTLE QUEST";
  $("#toolbar").hidden = view === "rank" || view === "admin" || view === "gallery";
  updateTaskFilters();
  renderImportSummary();
  if (view === "admin") {
    renderAdmin();
    return;
  }
  if (view === "gallery") {
    renderGallery();
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
      '<h3>累计贡献</h3><p class="muted">同分并列 · 只算验收通过的稿件</p>' +
      people(ranking()) +
      historySummary() +
      "</div>";
    $("#count").textContent = "累计榜";
    return;
  }
  const tasks = data.tasks.filter(
    (t) =>
      (view !== "mine" || belongsToMe(t)) &&
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
  const cards = tasks.map(
    (t) =>
      `<button class="card" data-task="${esc(t.id)}"><div class="card-top"><span class="tag">${esc(t.category)}</span><span class="tag ${esc(t.status)}">${esc(taskLabel(t))}</span>${syncBadge(t)}</div><h3>${esc(t.title)}</h3><p>${briefFields(t.brief)}</p><div class="meta">${t.due_date ? "期望交稿 " + esc(t.due_date) : "DDL（截止日期） 未设 · 可与负责人协商"}</div><div class="card-bottom"><span>○ ${esc(taskArtist(t))}</span><span class="points">✧ ${pointLabel(t)}　↗</span></div></button>`,
  );
  $("#list").innerHTML =
    (MOBILE.matches ? waterfall(cards, tasks) : cards.join("")) ||
    '<div class="empty">这里暂时没有任务。<br>可以换个筛选，或去公告栏认领喜欢的任务。</div>';
}
// 卡片介绍：金山同步的介绍按字段分行（原文已用换行分隔；没有换行时按字段标签断开）。
// 每个字段一个 span，电脑端仍连成一段，手机端每个字段另起一行。只影响卡片显示。
const BRIEF_LABELS = /\s+(?=(?:画面效果|角色|技能介绍|卡牌类型|机制简述|机制简介|效果 ?\/ ?数值|卡牌消耗（非贡献分）)：)/;
function briefFields(brief) {
  return String(brief || "")
    .split(/\s*\n\s*/)
    .flatMap((line) => line.split(BRIEF_LABELS))
    .filter((f) => f.trim())
    .map((f) => `<span class="brief-field">${esc(f)}</span>`)
    .join(" ");
}
// 手机端两列瀑布流（小红书式）：按顺序把每张卡放进当前较矮的一列，阅读顺序仍是从上到下。
const MOBILE = globalThis.matchMedia?.("(max-width: 760px)") || { matches: false };
MOBILE.addEventListener?.("change", () => render());
function waterfall(cards, tasks) {
  if (!cards.length) return "";
  const cols = [[], []],
    h = [0, 0];
  cards.forEach((html, i) => {
    const t = tasks[i],
      c = h[0] <= h[1] ? 0 : 1;
    cols[c].push(html);
    h[c] += 9 + Math.ceil(String(t.title || "").length / 9) + String(t.brief || "").split(/\s*\n\s*|\s+(?=(?:画面效果|角色|技能介绍|卡牌类型|机制简述|机制简介|效果 ?\/ ?数值|卡牌消耗（非贡献分）)：)/).reduce((n, f) => n + Math.max(1, Math.ceil(f.trim().length / 13)), 0);
  });
  return `<div class="waterfall">${cols.map((c) => `<div class="wf-col">${c.join("")}</div>`).join("")}</div>`;
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
      $("#connection").textContent = "登录后可认领";
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
    const aliases = await client.from("guild_artist_aliases").select("artist_name,artist_id");
    if(n !== seq) return;
    data.aliases = aliases.data || [];
    void refreshInbox();
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
        approve: "已通过，放进稿件展示了～",
        changes: "已打回，理由已送达。",
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
  };
  const ext = extensions[file.type];
  if (!ext) throw Error("只支持 PNG 图片");
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
  const admin = profile?.role === "admin",
    sheetCard = t.status === "imported" && !t.source_removed_at && sourceState(t) === "assigned" && t.source_record?.system !== "旧版参考",
    own = t.assignee === user?.id || (sheetCard && belongsToMe(t));
  const subs = data.submissions.filter((s) => s.task_id === id);
  const historical = admin && (["submitted", "done"].includes(t.status) || (t.status === "imported" && sourceState(t) === "final" && !t.source_removed_at));
  modal(
    t.title,
    `<span class="tag">${esc(t.category)} · ${esc(taskLabel(t))}</span><p class="detail-copy">${esc(t.brief)}</p><p class="detail-meta">${pointLabel(t)} · ${esc(taskArtist(t))}<br>${t.due_date ? "期望交稿 " + esc(t.due_date) : "交稿时间可与负责人协商"}</p>${admin && t.status === "open" ? '<button class="outline" id="edit-task">编辑 / 分配任务</button>' : ""}${admin && canDeleteTask(t) ? ' <button class="outline danger" id="delete-task">删除任务</button>' : ""}${canUnpublish(t) ? ' <button class="outline" id="unpublish-task">撤回发布</button>' : ""}${importDetail(t, admin)}${subs.map((s) => {
      const path = uploadedImagePath(s.url);
      const link = path
        ? `<a data-upload-path="${esc(path)}" rel="noopener noreferrer" target="_blank">正在加载上传的图片…</a>`
        : `<a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">打开作品 / 网盘链接 ↗</a>`;
      return `<div class="submission"><b>${esc(name(s.author_id))} · ${new Date(s.created_at).toLocaleString("zh-CN")}</b><p>${esc(s.note)}</p>${link}${s.feedback ? "<p>负责人反馈：" + esc(s.feedback) + "</p>" : ""}</div>`;
    }).join("")}${t.status === "changes" && t.review_note ? `<div class="submission review-note"><b>打回理由</b><p>${esc(t.review_note)}</p></div>` : ""}${artistBindHTML(t, admin)}${historical || (own || admin) && (sheetCard || ["active", "changes"].includes(t.status)) ? `<form id="submit-form">${historical ? "<h3>补传历史稿件</h3><p>补上作品与来源说明，验收状态和已有贡献分保持原记录。</p>" : own ? "" : `<h3>帮画师交稿</h3><p class="muted">替${esc(taskArtist(t))}上传作品，交上去就进入待验收。</p>`}<label class="field">上传作品图片（仅支持 PNG，最多 10 MB）<input name="image" type="file" accept="image/png,.png"></label><label class="field">或填写作品 / 网盘链接<input name="url" type="url" placeholder="https://…"></label><label class="field">交稿说明 / 提取码<textarea name="note" required maxlength="1980"></textarea></label><button class="primary" type="submit">${historical ? "保存历史稿件" : own ? "提交验收" : "代交，进入待验收"}</button></form>` : ""}${admin && t.status === "submitted" && !own ? '<label class="field">打回理由（点「不通过」时必填）<textarea id="feedback" maxlength="2000" placeholder="写清楚哪里要改、怎么改"></textarea></label>' : ""}<div class="actions">${t.status === "open" || (!user && !t.source_removed_at && taskList(t) === "open") ? '<button class="primary" id="claim">认领这份任务</button>' : ""}${own && ["active", "changes"].includes(t.status) ? '<button class="outline" id="release">归还任务</button>' : ""}${admin && t.status === "submitted" && !own ? '<button class="primary" id="approve">通过 · 放进稿件展示</button><button class="outline danger" id="changes">不通过</button>' : ""}</div>`,
  );
  bindImportForm(t);
  bindArtistActions(t);
  document.querySelectorAll("#review-card [data-review]").forEach(
    (b) =>
      (b.onclick = async () => {
        const action = b.dataset.review;
        const reason = $("#review-card").elements.reason.value.trim();
        if (action === "reject" && !reason) return toast("请先写明打回理由");
        try {
          await adminRPC("guild_review_card", { p_task: t.id, p_action: action, p_reason: reason || null }, () =>
            Object.assign(t, { status: action === "approve" ? "done" : "changes", artist_name: t.source_record?.artist, review_note: action === "approve" ? null : reason }),
          );
          $("#dialog").close();
          toast(action === "approve" ? "已通过，放进稿件展示了～" : "已打回，理由已送达。");
        } catch (e) {
          error(e);
        }
      }),
  );
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
  $("#delete-task")?.addEventListener("click", () => deleteTask(t.id));
  $("#unpublish-task")?.addEventListener("click", () => unpublishTask(t.id));
  $("#claim")?.addEventListener("click", () => {
    if (!demo && !user) {
      $("#dialog").close();
      account();
      $("#dialog-title").textContent = "登录后认领任务";
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
      // 表格已写画师的卡：交稿前先转成正式的创作中任务（作者按表格，分值和截止日期用默认）。
      if (sheetCard && !demo) {
        const r = await client.rpc("guild_start_sheet_card", { p_task: id });
        if (r.error) throw r.error;
        t.status = "active";
      }
      if (file) {
        if (demo) throw Error("演示模式不支持真实图片上传，请用链接演示");
        toast("正在上传图片，请不要关闭页面…");
        url = await uploadSubmissionImage(t, file);
      } else {
        url = safeURL(url);
        if (url === "#") throw Error("请上传图片，或填写有效的作品链接");
      }
      const note = String(f.get("note") || "").trim();
      if (historical) {
        await adminRPC("guild_attach_artwork", {p_task:id,p_url:url,p_note:note},()=>{});
        $("#dialog").close(); toast("历史稿件已补传，验收状态保持原记录。");
      } else if (own) await act("submit", id, { url, note });
      else {
        await adminRPC("guild_admin_submit", { p_task: id, p_url: url, p_note: note }, () => {
          data.submissions.push({ id: uid(), task_id: id, author_id: user.id, url, note: "负责人代交：" + note, feedback: "", created_at: now() });
          t.status = "submitted";
        });
        $("#dialog").close();
        toast("已代交，进入待验收～");
      }
    } catch (e) {
      error(e);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  for (const a of ["approve", "changes"])
    $("#" + a)?.addEventListener("click", () => {
      const feedback = $("#feedback").value.trim();
      if (a === "changes" && !feedback) return toast("请先写明打回理由");
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
      `<p class="detail-copy">${esc(profile?.name || user.email)}<br>${profile?.active ? "已入馆" : "等待负责人开通"}</p><form id="nickname-form"><label class="field">画师昵称<input name="name" required maxlength="40" value="${esc(profile?.name || "")}"></label><button class="primary">保存昵称</button></form><p class="muted">账号尾号：${esc(user.id.slice(-6))}，供负责人核对。</p><button id="replay-tour" class="outline">再看一次功能引导</button><div class="toggle-row"><span id="announcement-switch-label">首页公告栏<small>显示美术组阶段公告</small></span><button type="button" role="switch" id="announcement-switch" class="switch" aria-labelledby="announcement-switch-label" aria-checked="${announcementShown()}"><span class="switch-knob"></span></button></div><button id="signout" class="outline">退出登录</button>`,
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
    $("#announcement-switch").onclick = () => setAnnouncementShown(!announcementShown());
    $("#replay-tour").onclick = () => showTour(0);
    $("#signout").onclick = async () => {
      await client.auth.signOut();
      $("#dialog").close();
    };
    return;
  }
  modal(
    "登录会馆",
    '<p class="muted">输入邮箱收验证码就能登录。注册过的邮箱会直接进原来的账号，不会新建。</p><form id="login"><label class="field">邮箱<input name="email" type="email" required autocomplete="email"></label><label class="field">画师昵称<small class="muted">（第一次来才需要填，尽量和金山表署名一致）</small><input name="artist_name" maxlength="40" autocomplete="nickname" placeholder="已注册过可以不填"></label><button class="primary">发送验证码</button></form>',
  );
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get("email").trim(),
      b = e.target.querySelector("button");
    b.disabled = true;
    try {
      const r = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname, data: {artist_name: String(new FormData(e.target).get("artist_name") || "").trim()} },
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
// 公告栏开关：沿用 guild-announcement-display（open / collapsed / closed）。
// 开 = 不是 closed（展开 / 收起照旧由公告右上角控制）；关 = closed。
function announcementShown() {
  let state; try { state = localStorage.getItem('guild-announcement-display'); } catch {}
  return state !== 'closed';
}
function setAnnouncementShown(on) {
  try { localStorage.setItem('guild-announcement-display', on ? 'open' : 'closed'); } catch {}
  initAnnouncement();
}
function syncAnnouncementSwitch() {
  const sw = document.querySelector('#announcement-switch');
  if (sw) sw.setAttribute('aria-checked', String(announcementShown()));
}
function initAnnouncement() {
  const box = document.querySelector('.campaign-announcement');
  const body = document.querySelector('#announcement-body');
  const toggle = document.querySelector('#announcement-toggle');
  const save = (state) => { try { localStorage.setItem('guild-announcement-display', state); } catch {} };
  let state; try { state = localStorage.getItem('guild-announcement-display'); } catch {}
  box.hidden = state === 'closed';
  body.hidden = state === 'collapsed';
  toggle.textContent = body.hidden ? '⌄' : '⌃'; toggle.setAttribute('aria-label', body.hidden ? '展开公告' : '收起公告'); toggle.title = body.hidden ? '展开公告' : '收起公告';
  toggle.setAttribute('aria-expanded', String(!body.hidden));
  syncAnnouncementSwitch();
  toggle.onclick = () => { body.hidden = !body.hidden; toggle.textContent = body.hidden ? '⌄' : '⌃'; toggle.setAttribute('aria-label', body.hidden ? '展开公告' : '收起公告'); toggle.title = body.hidden ? '展开公告' : '收起公告'; toggle.setAttribute('aria-expanded', String(!body.hidden)); save(body.hidden ? 'collapsed' : 'open'); };
  document.querySelector('#announcement-close').onclick = () => {
    box.hidden = true; save('closed'); syncAnnouncementSwitch();
    modal('公告已收好', '<p>以后可以从右上角信箱查看本期奖励说明。想放回页面顶部，登录后点自己的昵称，打开「首页公告栏」开关就行。</p><button id="announcement-dismiss" class="primary">知道啦</button>');
    document.querySelector('#announcement-dismiss').onclick = () => document.querySelector('#dialog').close();
  };
}
function openAnnouncement() {
  try { localStorage.setItem('guild-announcement-display', 'open'); } catch {}
  initAnnouncement();
  document.querySelector('.campaign-announcement').scrollIntoView({block:'start', behavior:'smooth'});
}
async function init() {
  initAnnouncement();
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
      "notifications",
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
  return labels[taskList(t)] || "待认领";
}
// 正式任务与金山表不一致时的提醒；只提示，不改动委托本身。
function syncBadge(t) {
  if (t.status === "imported") return "";
  if (t.source_removed_at) return '<span class="tag warn">待核实</span>';
  if (t.source_pending) return '<span class="tag warn">资料有更新</span>';
  return "";
}
function taskArtist(t) {
  if (!demo && !user) {
    const list = taskList(t);
    if (list === "open") return "等待认领";
    if (list === "done") return "已完成";
    if (list === "submitted") return "已交稿";
    return "已有画师负责";
  }
  return t.assignee
    ? name(t.assignee)
    : t.artist_name
      ? `${t.artist_name}（未注册）`
      : t.status === "imported"
        ? t.source_record?.artist || "未分配画师"
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
  const html = syncStatusHTML();
  box.hidden = !html;
  box.innerHTML = html;
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
  let html = `<small>金山表同步：${last ? last.toLocaleString("zh-CN") : "尚未成功"}</small>`;
  if (profile?.role !== "admin" || !s.run || s.run.status !== "failed") return html;
  const code = String(s.run.error_code || ""),
    bulk = code.match(/^MASS_(REMOVAL|INSERT)_BLOCKED_(\d+)$/);
  if (bulk) {
    const kind = bulk[1] === "REMOVAL" ? "removal" : "insert",
      n = Number(bulk[2]),
      approved = kind === "removal" ? s.state.approved_removals : s.state.approved_inserts;
    return html + `<br><b>同步已暂停：</b>金山表这次会${kind === "removal" ? "移除" : "新增"} ${n} 张卡。若是有意修改，请确认；若被误删或读取异常，请先在金山修复。${approved === n ? "（已确认，等待下次同步）" : ` <button class="outline" id="approve-sync" data-kind="${kind}" data-count="${n}">确认${kind === "removal" ? "移除" : "新增"} ${n} 张</button>`}`;
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
    '<h3>金山表交稿登记</h3><p class="muted">只是登记，不算贡献分～</p>' +
    [...artists.values()]
      .sort(
        (a, b) => b.finals - a.finals || a.name.localeCompare(b.name, "zh-CN"),
      )
      .map(
        (a) =>
          `<div class="person"><span class="avatar">${esc(a.name.slice(0, 1))}</span><div class="name">${esc(a.name)}<small>登记 ${a.count} 张</small></div><strong>${a.finals}<small>已递交终稿</small></strong></div>`,
      )
      .join("")
  );
}
function importDetail(t, admin) {
  const s = t.source_record;
  if (!s) return "";
  let html = `<div class="submission"><b>金山表记录 · ${esc(s.system)}</b><p>负责画师：${esc(s.artist || "未登记")}<br>完成情况：${esc(s.status || "未填写")}<br>来源：${esc(s.sheet)}${s.row ? `，第 ${Number(s.row)} 行` : ""}<br>卡牌 ID：${esc(s.card_id)}</p><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">查看原始表格 ↗</a><p class="muted">${t.kdocs_card_id ? "跟金山表自动同步（约 5 分钟）。" : ""}</p></div>`;
  if (t.source_removed_at)
    html += `<div class="submission"><b>这张卡已从金山原表移除</b><p>${new Date(t.source_removed_at).toLocaleString("zh-CN")} 起不在原表中。${t.status === "imported" ? "记录保留但不再公开；如属误删，在原表恢复同一行（保留同步ID）即可重新显示。" : "平台上的任务、作品和贡献分都保留，请负责人与画师核实是否继续。"}</p></div>`;
  if (t.source_pending && t.status !== "imported")
    html += `<div class="submission"><b>原表资料有更新，待负责人核对</b><p>新名称：${esc(t.source_pending.title)}</p><p class="detail-copy">${esc(t.source_pending.brief)}</p><p class="muted">${t.status === "open" ? "采用后会更新任务名称和要求，贡献分不变。" : "画师已接手，平台不会自动改动已约定的要求；请先与画师沟通。"}</p>${admin ? `<div class="actions">${t.status === "open" ? '<button class="primary" data-resolve="accept">采用原表新资料</button>' : ""}<button class="outline" data-resolve="dismiss">保持原要求</button></div>` : ""}</div>`;
  if (t.status !== "imported") return html;
  if (t.source_removed_at) return html;
  if (sourceState(t) === "final")
    return html + (admin
      ? `<form id="review-card"><h3>验收这张终稿</h3><p class="muted">画师：${esc(s.artist || "表格里没写")}。通过后放进稿件展示并记 ${Number(t.points || 20)} 分${t.assignee ? "" : "（ta 还没注册的话，分数先挂着，绑定账号后补记）"}。</p><label class="field">打回理由（点「不通过」时必填）<textarea name="reason" maxlength="2000" placeholder="写清楚哪里要改、怎么改"></textarea></label><div class="actions"><button class="primary" type="button" data-review="approve">通过 · 放进稿件展示</button><button class="outline danger" type="button" data-review="reject">不通过</button></div></form>`
      : '<p class="muted">这张已交终稿，等负责人验收～</p>');
  // 表格里已写画师的卡就在「创作中」：作者以表格为准，不用发布、也不能改作者，直接交稿。
  if (sourceState(t) === "assigned") return html;
  const sameName = data.profiles.find((p) => p.active && s.artist && p.name.trim() === String(s.artist).trim());
  if (!admin)
    return (
      html +
      (sourceState(t) === "final" ? '<p class="muted">这张已交终稿，作品等待补传～</p>' : '<p class="muted">负责人发布后就能认领～</p>')
    );
  const members = data.profiles.filter((p) => p.active);
  return (
    html +
    `${publishIntro(t)}<form id="activate-import"><label class="field">贡献分<input name="points" type="number" min="1" max="1000" required placeholder="填写分数" value="${t.points ? Number(t.points) : ""}"></label><label class="field">负责画师<select name="assignee"><option value="">${s.artist ? `${esc(s.artist)}（按表格名字，还没注册也行）` : "开放给大家认领"}</option>${members.map((p) => `<option value="${esc(p.id)}" ${sameName?.id === p.id ? "selected" : ""}>${esc(p.name)} · ${esc(p.id.slice(-6))}${p.role === "admin" ? "（负责人）" : ""}</option>`).join("")}</select></label><p class="muted">${s.artist ? "选了账号就挂在账号下；用表格名字的话，等 ta 注册后在任务里点「绑定账号」。" : "选了账号就直接进入「创作中」。"}</p>${s.system === "旧版参考" ? '<label class="field"><span><input name="legacy" type="checkbox" required> 已确认这张旧版卡牌需要单独绘制</span></label>' : ""}<button class="primary">${s.artist ? "发布到「创作中」" : "发布到「待认领」"}</button></form>`
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
        t.artist_name = assignee ? null : t.source_record?.artist || null;
        t.status = assignee || t.artist_name ? "active" : "open";
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
        assignee ? "已发布，进入创作中。" : t.source_record?.artist ? `已挂在「${t.source_record.artist}」名下，进入创作中。` : "已发布，等大家认领～",
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
    name: "卡牌",
    points: 20,
    unit: "一张卡面（金山表里的卡默认都是这个分）",
    brief:
      "卡牌名称与角色：\n画面效果：\n参考链接：\n尺寸 / 格式：\n交付：一张完整卡面。",
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
        const at = Date.parse(s ? s.created_at : a.created_at); // 金山表终稿没有网站交稿记录，按通过时间算
        return a.artist_id === p.id && at >= Date.parse(c.starts_at) && at <= Date.parse(c.ends_at);
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
  return `<p class="eyebrow">一点小心意 ( •̀ ω •́ )✧</p>
<h3 class="reward-title">本期最高贡献奖励 <strong>¥100</strong></h3>
<p>${c.ends_at ? `${esc(c.name)}<br>DDL（截止日期）：${esc(new Date(c.ends_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }))}` : "DDL（截止日期）还没定～"}</p>
<p>本期贡献榜第一名可以获得 100 元奖励，如果有并列第一就由大家平分。钱来自大家的自愿赞助，主要是想给这段时间投入比较多的小画师一点小奖励。</p>
<p>在 DDL（截止日期）前提交，并且最终通过的作品，都会计入本期贡献。</p>
<p>我们想尽量赶上罗小黑 TV 更新的这波热度，在这段时间里多做一些能玩的项目，也让更多喜欢罗小黑的人发现我们。（万一被HMCH注意到了呢(ﾉ>ω<)ﾉ ）</p>
<details class="reward-why">
<summary>为什么要设 DDL（截止日期），还有这 100 元？</summary>
<p>因为很多素材不是独立的。一份玩法可能要等好几位画师的素材才能继续做。如果没有一个大致的时间安排，开发这边也不好确定进度，任务就容易一直搁着,还会消耗大家的热情…… 所以每期会设一个 DDL（截止日期），方便大家安排时间，也方便开发组往下推进。</p>
<p>100 元是好心人自愿赞助的，作为本期贡献榜第一名的奖励。另外，我们也会根据贡献记录整理最后的鸣谢名单。</p>
<p>认领任务之前可以先看看自己的时间。如果最近有考试、工作，或者发现任务确实画不完，提前和负责人说一声就好。任务可以调整，也可以归还，不用有心理负担～</p>
</details>`;
}
function phaseHTML() {
  const c = campaign(),
    rows = phaseRanking();
  const state = !c.starts_at
    ? "时间待定"
    : Date.now() < Date.parse(c.starts_at)
      ? "尚未开始"
      : Date.now() <= Date.parse(c.ends_at)
        ? "本期暂列"
        : "已截止，核对中";
  return `<section class="phase-board"><h3>本期贡献 · ${state}</h3><p class="muted">排名还会变，最后以负责人核对为准～</p>${!c.starts_at ? '<p class="muted">时间定下来就开始统计～</p>' : rows.length ? people(rows) : '<p class="muted">还没有验收通过的稿件，第一名虚位以待～</p>'}</section>`;
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
  return `<p class="muted">看工作量估个大概就好，不评画技～ 简单的 ×0.75、复杂的 ×1.25，凑到最近的 5 分。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>类型</th><th>分值</th><th>一份包含什么</th></tr></thead><tbody>${SCORE_GUIDE.map((s) => `<tr><td>${s.name}</td><td>${s.points ?? "另议"}</td><td>${s.unit}</td></tr>`).join("")}</tbody></table></div><p class="muted">草稿到上色算一份，改稿不另算；多人合作就把总分拆开分；有新需求就另发一个任务。</p>`;
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
    `<form id="task-editor"><label class="field">任务名称<input name="title" required maxlength="80" value="${esc(task?.title || "")}" placeholder="例如：罗小黑 · Q版卡牌 · 遁空"></label><div class="form-grid"><label class="field">稿件分类<select name="category">${choices.map((c) => `<option ${c === category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label><label class="field">复杂度<select name="complexity"><option value="0.75">简单 ×0.75</option><option value="1" selected>标准 ×1</option><option value="1.25">复杂 ×1.25</option></select></label></div><p id="score-hint" class="muted"></p><label class="field">任务要求与验收清单<textarea name="brief" required maxlength="5000">${esc(task?.brief || guide?.brief || "")}</textarea></label><button type="button" id="insert-template" class="text-link">使用当前分类的需求模板（替换上方内容）</button><div class="form-grid"><label class="field">最终贡献分<input name="points" type="number" min="1" max="1000" required value="${task?.points ?? guide?.points ?? ""}"></label><label class="field">任务 DDL（截止日期）（可不填）<input name="due_date" type="date" value="${esc(task?.due_date || "")}"></label></div><label class="field">负责画师<select name="assignee">${memberOptions(task?.assignee)}</select></label><p class="muted">选画师后直接进入创作中；不选则开放认领。接稿前请确认要求和分值，创作开始后分值锁定。任务 DDL（截止日期） 与奖金统计截止时间分别设置。</p><button class="primary">${task ? "保存任务" : "发布任务"}</button></form>`,
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
// 稿件展示：已交稿（待验收）和已完成的作品，加上金山表里登记了终稿的卡。
// 作品图片在私有存储桶里，只给登录成员签发临时链接；游客只看到标题。
let galleryFilter = "all";
const signedWorks = new Map();
function galleryItems() {
  const items = [];
  for (const t of data.tasks) {
    if (t.status === "done" || t.status === "submitted") {
      const subs = data.submissions
        .filter((s) => s.task_id === t.id)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const award = data.awards.find((a) => a.task_id === t.id);
      const sub = (award && subs.find((s) => s.id === award.submission_id)) || subs[0] || null;
      items.push({ t, sub, kind: t.status, at: sub?.created_at || t.updated_at || t.created_at });
    } else if (t.status === "imported" && sourceState(t) === "final") {
      const sub = data.submissions.filter(s => s.task_id === t.id).sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at))[0] || null;
      items.push({ t, sub, kind: "sheet", at: sub?.created_at || t.updated_at || t.created_at });
    }
  }
  const order = { done: 0, submitted: 1, sheet: 2 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || Date.parse(b.at) - Date.parse(a.at));
}
function workTile({ t, sub, kind }) {
  const guest = !demo && !user;
  const path = sub && uploadedImagePath(sub.url);
  const badge = { done: "已完成", submitted: "待验收", sheet: "已交终稿" }[kind];
  // 每张作品都署名：成员看账号昵称 / 表格名字，游客看预览里的署名。
  const artist = (guest ? t.artist_credit : t.assignee ? name(t.assignee) : t.artist_name || t.source_record?.artist) || "";
  const scene = (String(t.brief || "").match(/画面效果：([^\n]+)/) || [])[1] || "";
  const art = path
    ? `<img data-work-path="${esc(path)}" alt="${esc(t.title)}" loading="lazy" onload="this.parentNode.classList.add('loaded')" onerror="this.parentNode.classList.add('broken')">`
    : sub
      ? `<div class="work-ph"><span class="work-ph-mark">↗</span><em>外链作品 · 点开查看</em></div>`
      : `<div class="work-ph"><span class="work-seal">${esc(String(t.title).slice(0, 1))}</span>${scene ? `<p class="work-scene">「${esc(scene)}」</p>` : ""}<em>${kind === "sheet" || t.source_record?.status === "已递交终稿" ? "终稿等待补传" : guest ? "登录后可看作品" : "作品整理中"}</em></div>`;
  const when = sub ? new Date(sub.created_at).toLocaleDateString("zh-CN") : "";
  return `<button class="work ${kind}" data-task="${esc(t.id)}"><div class="work-art${path ? " has-img" : ""}">${art}<span class="work-badge">${badge}</span></div><div class="work-info"><h3>${esc(t.title)}</h3><p class="work-credit">${artist ? `✎ ${esc(artist)} 老师` : "署名待补"}</p>${when ? `<p>${esc(when)} 交稿</p>` : ""}</div></button>`;
}
function renderGallery() {
  const all = galleryItems();
  const groups = [["all", "全部"], ["done", "已完成"], ["submitted", "待验收"], ["sheet", "已交终稿"]];
  if (galleryFilter !== "all" && !all.some((i) => i.kind === galleryFilter)) galleryFilter = "all";
  const shown = all.filter((i) => galleryFilter === "all" || i.kind === galleryFilter);
  $("#count").textContent = `${all.length} 份稿件`;
  $("#list").innerHTML = `<div class="gallery"><div class="gallery-filters">${groups
    .map(([k, label]) => {
      const n = k === "all" ? all.length : all.filter((i) => i.kind === k).length;
      return k === "all" || n ? `<button data-gallery-filter="${k}" class="${galleryFilter === k ? "selected" : ""}">${label}<span>${n}</span></button>` : "";
    })
    .join("")}</div>${shown.length ? `<div class="work-grid">${shown.map(workTile).join("")}</div>` : '<div class="empty">还没有交上来的稿件～<br>第一张会挂在这里。</div>'}${!demo && !user ? '<p class="muted gallery-note">登录后可以看作品原图 ✧</p>' : ""}</div>`;
  document.querySelectorAll("[data-gallery-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        galleryFilter = b.dataset.galleryFilter;
        renderGallery();
      }),
  );
  layoutWorkGrid();
  void loadWorkImages();
}
// 稿件展示瀑布流：网格按 4px 小行排列，每张卡按自己的实际高度占行数，
// 所以图片原比例显示、阅读顺序仍是从左到右；图片加载或窗口变化时自动重排。
let workObserver = null;
function layoutWorkGrid() {
  workObserver?.disconnect();
  const grid = document.querySelector(".work-grid");
  if (!grid || typeof ResizeObserver === "undefined") return;
  const fit = (el) => {
    const gap = parseFloat(getComputedStyle(el).marginBottom) || 0, unit = 4;
    el.style.gridRowEnd = `span ${Math.max(1, Math.ceil((el.getBoundingClientRect().height + gap) / unit))}`;
  };
  workObserver = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
  grid.querySelectorAll(".work").forEach((el) => { fit(el); workObserver.observe(el); });
  grid.classList.add("masonry");
}
async function loadWorkImages() {
  const imgs = [...document.querySelectorAll("img[data-work-path]")];
  if (demo || !user || !imgs.length) return;
  const now = Date.now();
  const need = [...new Set(imgs.map((i) => i.dataset.workPath))].filter((p) => !(signedWorks.get(p)?.exp > now));
  if (need.length) {
    const { data: signed, error: signError } = await client.storage.from(UPLOAD_BUCKET).createSignedUrls(need, 3600);
    if (!signError)
      for (const s of signed || []) if (s.signedUrl) signedWorks.set(s.path, { url: s.signedUrl, exp: now + 50 * 60 * 1000 });
  }
  for (const img of imgs) {
    const c = signedWorks.get(img.dataset.workPath);
    if (!img.isConnected) continue;
    if (c) img.src = c.url;
    else img.parentNode.classList.add("broken");
  }
}
function renderAdmin() {
  const pending = data.profiles.filter((p) => !p.active && p.role === "artist");
  const inAdminFilter = (t, f) =>
    matchesTaskFilter(t, f === "attention" ? "source-attention" : f);
  // 与公告栏同样的列表；“待核实”只在有正式任务需要核对时出现。
  const filters = [
    ["submitted", "待验收"],
    ["open", "待认领"],
    ["active", "创作中"],
    ["changes", "待修改"],
    ["done", "已完成"],
    ["attention", "待核实"],
  ].filter(([value]) => value !== "attention" || adminFilter === value || data.tasks.some((t) => inAdminFilter(t, value)));
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
    `<div class="admin-workspace"><div class="admin-actions"><button id="admin-create" class="primary">＋ 发布任务</button><button id="show-score-guide" class="outline">分值参考</button><button id="campaign-settings" class="outline">设置本期时间</button><button id="manage-members" class="outline">画师管理${pending.length ? " · " + pending.length + " 待开通" : ""}</button></div><section class="panel admin-intro"><h3>任务从这里安排。</h3><p class="muted">发布 → 分配 / 认领 → 交稿 → 验收。金山表里的卡先定分、核对画师账号再转为正式任务；已开始创作的任务不能临时改分。</p></section><div class="filters admin-filters">${filters.map(([value, label]) => `<button data-admin-filter="${value}" class="${adminFilter === value ? "selected" : ""}">${label} ${data.tasks.filter((t) => inAdminFilter(t, value)).length}</button>`).join("")}</div><label class="search">⌕ <input id="admin-search" aria-label="搜索管理任务" placeholder="搜索任务、分类或画师" value="${esc(query)}"></label><div class="table-wrap"><table class="admin-table"><thead><tr><th>任务 / 分类</th><th>负责画师</th><th>状态</th><th>贡献分 / DDL（截止日期）</th><th>操作</th></tr></thead><tbody>${rows.map((t) => `<tr><td><b>${esc(t.title)}</b><small>${esc(t.category)}</small></td><td>${esc(taskArtist(t))}</td><td>${esc(taskLabel(t))}</td><td>${pointLabel(t)}<small>${esc(t.due_date || "未设 DDL（截止日期）")}</small></td><td><button class="outline" data-task="${esc(t.id)}">${t.status === "submitted" ? "验收" : t.status === "imported" ? (sourceState(t) === "final" ? "验收" : "发布") : "查看 / 处理"}</button>${canDeleteTask(t) ? `<button class="outline danger" data-delete-task="${esc(t.id)}">删除</button>` : ""}${canUnpublish(t) ? `<button class="outline" data-unpublish-task="${esc(t.id)}">撤回发布</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5">这里暂时没有任务 (｡･ω･｡)</td></tr>'}</tbody></table></div><section class="panel guide">${rewardHTML()}</section></div>`;
  $("#admin-create").onclick = () => newTask();
  document.querySelectorAll("[data-delete-task]").forEach(
    (b) => (b.onclick = () => deleteTask(b.dataset.deleteTask)),
  );
  document.querySelectorAll("[data-unpublish-task]").forEach(
    (b) => (b.onclick = () => unpublishTask(b.dataset.unpublishTask)),
  );
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
// 发布 = 把金山表里的卡变成网站上的正式任务（可以认领、交稿、验收、记分）。
function publishIntro(t) {
  const s = t.source_record || {};
  const state = sourceState(t);
  return `<div class="publish-note"><b>发布这张卡</b><p>${s.artist ? `发布后进入「创作中」，由 ${esc(s.artist)} 负责；之后可以 ta 自己交稿，也可以负责人代交。` : "发布后进入「待认领」，画师登录后就能认领。"}点错了可以「撤回发布」。</p></div>`;
}
function canUnpublish(t) {
  return profile?.role === "admin" && !!t.kdocs_card_id && ["open", "active", "changes"].includes(t.status) &&
    !data.submissions.some((x) => x.task_id === t.id) && !data.awards.some((a) => a.task_id === t.id);
}
async function unpublishTask(id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t || !canUnpublish(t)) return toast("这份任务不能撤回，请刷新后再试");
  if (!confirm(`撤回「${t.title}」的发布吗？它会回到原来的列表，分值和 DDL（截止日期） 不变。`)) return;
  try {
    await adminRPC("guild_unpublish_task", { p_task: id }, () => Object.assign(t, { status: "imported", assignee: null, artist_name: null }));
    if ($("#dialog").open) $("#dialog").close();
    toast("已撤回发布。");
  } catch (e) {
    error(e);
  }
}
// 还没注册的画师：任务先挂在表格名字下，注册后由负责人一键绑定账号（该名字下的任务全部跟过去）。
function artistBindHTML(t, admin) {
  const sheetArtist = t.artist_name || (t.status === "imported" && !t.source_removed_at ? t.source_record?.artist : null);
  if (!sheetArtist) return "";
  const members = data.profiles.filter((p) => p.active);
  const bound = (data.aliases || []).find((a) => a.artist_name === sheetArtist.trim());
  if (bound && (!t.assignee || t.assignee === bound.artist_id)) {
    const acct = data.profiles.find((p) => p.id === bound.artist_id);
    return `<div class="submission bound-note"><b>✓ ${esc(sheetArtist)} 已绑定账号</b><p class="muted">${acct ? `${esc(acct.name)} · ${esc(acct.id.slice(-6))}。` : ""}表格里写着 ta 的卡和贡献，都会记到这个账号上。</p></div>`;
  }
  const sameName = members.find((p) => p.name.trim() === sheetArtist.trim());
  return `<div class="submission"><b>${esc(sheetArtist)}  · 账号关联</b><p class="muted">${t.status === "submitted" ? "核对本人后连接账号，名下任务和暂存贡献将归入该账号。" : "核对一次署名，之后新任务可沿用关联；尚未发布的卡牌仍需负责人确认要求。"}</p>${admin ? `<div class="bind-row"><select id="bind-user"><option value="">选择 ta 注册后的账号</option>${members.map((p) => `<option value="${esc(p.id)}" ${sameName?.id === p.id ? "selected" : ""}>${esc(p.name)} · ${esc(p.id.slice(-6))}</option>`).join("")}</select><button class="primary" id="bind-artist">绑定账号</button>${["active", "changes"].includes(t.status) ? '<button class="outline" id="release-name">改回待认领</button>' : ""}</div>` : ""}</div>`;
}
function bindArtistActions(t) {
  $("#bind-artist")?.addEventListener("click", async () => {
    const userId = $("#bind-user").value;
    if (!userId) return toast("先选一个账号～");
    try {
      const nameOnSheet = t.artist_name || t.source_record?.artist;
      await adminRPC("guild_bind_artist", { p_name: nameOnSheet, p_user: userId }, () => {
        for (const x of data.tasks) if (x.artist_name === nameOnSheet && !x.assignee) Object.assign(x, { assignee: userId, artist_name: null });
      });
      $("#dialog").close();
      toast(`已绑定，「${nameOnSheet}」名下的任务都转到这个账号了。`);
    } catch (e) {
      error(e);
    }
  });
  $("#release-name")?.addEventListener("click", async () => {
    if (!confirm(`把「${t.title}」改回待认领吗？`)) return;
    try {
      await adminRPC("guild_release_artist_name", { p_task: t.id }, () => Object.assign(t, { artist_name: null, status: "open" }));
      $("#dialog").close();
      toast("已改回待认领。");
    } catch (e) {
      error(e);
    }
  });
}
// 负责人可删除自己发布、还没人认领、没有贡献分记录的任务（连同其交稿，例如测试稿）。
// 金山表里的卡请在金山表里删。
function canDeleteTask(t) {
  return profile?.role === "admin" && t.status === "open" && !t.assignee && !t.import_key && !t.kdocs_card_id &&
    !data.awards.some((a) => a.task_id === t.id);
}
async function deleteTask(id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t || !canDeleteTask(t)) return toast("这份任务不能删除，请刷新后再试");
  const subs = data.submissions.filter((s) => s.task_id === id);
  const images = subs.map((s) => uploadedImagePath(s.url)).filter(Boolean);
  if (!confirm(`确定删除「${t.title}」吗？${subs.length ? `\n它的 ${subs.length} 条交稿记录${images.length ? `和 ${images.length} 张上传图片` : ""}也会一起删除。` : ""}\n删除后无法恢复。`)) return;
  try {
    await adminRPC("guild_delete_task", { p_task: id }, () => {
      data.tasks = data.tasks.filter((x) => x.id !== id);
      data.submissions = data.submissions.filter((s) => s.task_id !== id);
    });
    if ($("#dialog").open) $("#dialog").close();
    let note = "";
    if (!demo && images.length) {
      const { error: removeError } = await client.storage.from(UPLOAD_BUCKET).remove(images);
      if (removeError) note = "（上传的图片未能删除，请联系维护者清理）";
    }
    toast("已删除任务。" + note);
  } catch (e) {
    error(e);
  }
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
// 画师管理：已绑定金山表署名的账号名字后打勾，没绑定的标出来，未绑定的排在前面。
function boundNames(id) {
  return (data.aliases || []).filter((a) => a.artist_id === id).map((a) => a.artist_name);
}
function manageMembers() {
  modal(
    "画师管理",
    `<p class="muted">画师可使用邮箱验证码登录并填写昵称。管理员可管理已注册的画师账号；原表署名不会自动建立账号。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>昵称 / 账号尾号 · ✓ 已绑定署名</th><th>状态</th><th>操作</th></tr></thead><tbody>${[
      ...data.profiles,
    ]
      .sort(
        (a, b) =>
          Number(a.active) - Number(b.active) ||
          Number(boundNames(a.id).length > 0) - Number(boundNames(b.id).length > 0) ||
          a.name.localeCompare(b.name, "zh-CN"),
      )
      .map(
        (p) =>
          `<tr><td>${esc(p.name)}${p.role === "artist" ? (boundNames(p.id).length ? ` <span class="bound-mark" title="已绑定金山表署名">✓</span>` : ' <span class="unbound-mark">未绑定</span>') : ""}<small>${esc(p.id.slice(-6))}${boundNames(p.id).length ? " · 表格署名：" + boundNames(p.id).map(esc).join("、") : ""}</small></td><td>${p.role === "admin" ? "负责人" : p.active ? "已开通" : "待开通"}</td><td>${p.role === "artist" ? `<button class="outline" data-member="${esc(p.id)}">管理</button>` : "—"}</td></tr>`,
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


function belongsToMe(t) { return !!user && (t.assignee === user.id || (t.status === "imported" && !t.source_removed_at && (data.aliases || []).some(a=>a.artist_id===user.id && a.artist_name===String(t.source_record?.artist || "").trim()))); }

init();
