const state = {
  actions: [],
  jobs: [],
  selectedJobId: null,
  refreshTimer: null,
  view: "overview",
  metricsReady: false,
  sessionsSig: "",
  jobsSig: "",
  lastLogId: null,
  lastLogText: null,
  jobStatus: {},
  notify: false,
  actionScope: "all",
  cmdkList: [],
  cmdkIdx: 0,
  aiBusy: false,
  logSearch: { term: "", hits: 0, idx: 0 },
  sheetUrl: "",
};

// 三条线各自的真实阶段：云图(建报告→采集)、星图(采集)、千川(采集→写入)
const DELIVERY_LINES = [
  {
    name: "云图线",
    cls: "lane-yt",
    stages: [
      { label: "已创建", todo: "未创建", actions: ["yuntu_create_reports", "yuntu_create_neifus"] },
      { label: "已采集", todo: "待采集", actions: ["yuntu_collect_all", "yuntu_collect_yuntu", "yuntu_collect_douyin"] },
    ],
  },
  {
    name: "星图线",
    cls: "lane-xt",
    stages: [{ label: "已采集", todo: "未采集", actions: ["xingtu_collect"] }],
  },
  {
    name: "千川线",
    cls: "lane-qc",
    stages: [
      { label: "已采集", todo: "未采集", actions: ["qianchuan_collect"] },
      { label: "已写入", todo: "待写入", actions: ["qianchuan_sync_write"] },
    ],
  },
];

const $ = (id) => document.getElementById(id);

const ICONS = {
  running:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>',
  queued:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  succeeded:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>',
  failed:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  canceled:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
};

const TOAST_ICONS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8h.01M11 12h1v4h1"/></svg>',
};

const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
};

const METRICS = [
  ["运行中", "running"],
  ["排队中", "queued"],
  ["已成功", "succeeded"],
  ["失败", "failed"],
  ["已取消", "canceled"],
];

const VIEW_META = {
  delivery: ["交付看板", "本期种草日报交付与采集进度"],
  overview: ["运行概况", "本机服务与任务总览"],
  actions: ["采集动作", "在后台排队运行采集脚本，按 Ctrl/⌘ + K 可快速运行"],
  jobs: ["任务中心", "任务队列、状态与运行日志"],
  sessions: ["登录状态", "各平台本地登录态文件检查"],
  guide: ["操作指南", "不懂代码也能照着跑的操作指南"],
};

const ACTION_CATEGORY_ORDER = ["同步", "千川", "星图", "云图", "Final - 同步"];
const ACTION_CATEGORY_LABELS = {
  同步: "First - 同步",
  千川: "千川",
  星图: "星图",
  云图: "云图",
  "Final - 同步": "Final - 同步",
};

const ACTION_SCOPE_LABELS = {
  all: "全部",
  daily: "日常",
  weekly: "周度",
  monthly: "月度",
};

const ACTION_SCOPE_IDS = {
  weekly: new Set(["weekly_report", "weekly_a3"]),
  monthly: new Set(["monthly_5a", "monthly_active_a3"]),
};

function statusLabel(status) {
  const map = {
    queued: ["排队", "wait"],
    running: ["运行", "run"],
    succeeded: ["成功", "ok"],
    failed: ["失败", "bad"],
    canceled: ["取消", "wait"],
  };
  return map[status] || [status, "wait"];
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function actionCategoryRank(category) {
  const idx = ACTION_CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? ACTION_CATEGORY_ORDER.length : idx;
}

function orderedActions(actions = state.actions) {
  return [...actions].sort((a, b) => {
    const group = actionCategoryRank(a.category) - actionCategoryRank(b.category);
    if (group) return group;
    return state.actions.indexOf(a) - state.actions.indexOf(b);
  });
}

function actionScope(action) {
  if (ACTION_SCOPE_IDS.weekly.has(action.id)) return "weekly";
  if (ACTION_SCOPE_IDS.monthly.has(action.id)) return "monthly";
  return "daily";
}

function scopedActions(actions = state.actions) {
  if (state.actionScope === "all") return actions;
  return actions.filter((action) => actionScope(action) === state.actionScope);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(n);
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function relTime(raw) {
  if (!raw) return "";
  const ts = Date.parse(raw.replace(" ", "T"));
  if (Number.isNaN(ts)) return raw;
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 172800) return "昨天";
  return raw.slice(5, 16);
}

function animateCount(el, to) {
  const target = Number(to) || 0;
  const from = Number(el._val) || 0;
  if (from === target) {
    el.textContent = target;
    el._val = target;
    return;
  }
  el._val = target;
  cancelAnimationFrame(el._raf);
  const start = performance.now();
  const dur = 520;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) el._raf = requestAnimationFrame(step);
    else el.textContent = target;
  };
  el._raf = requestAnimationFrame(step);
}

function toast(message, type = "info", timeout = 3400) {
  const wrap = $("toasts");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-ico">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span>${esc(message)}</span>`;
  wrap.appendChild(el);
  const remove = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 280);
  };
  setTimeout(remove, timeout);
}

/* ---------- 提示音 ---------- */
let _audio;
function unlockAudio() {
  try {
    _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
    if (_audio.state === "suspended") _audio.resume();
  } catch (e) {
    /* ignore */
  }
}
function beep(kind) {
  try {
    unlockAudio();
    if (!_audio) return;
    const t0 = _audio.currentTime;
    const tone = (freq, start, dur, vol) => {
      const o = _audio.createOscillator();
      const g = _audio.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(_audio.destination);
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.start(t0 + start);
      o.stop(t0 + start + dur + 0.02);
    };
    if (kind === "err") {
      tone(360, 0, 0.18, 0.16);
      tone(280, 0.16, 0.3, 0.16);
    } else {
      tone(740, 0, 0.16, 0.14);
      tone(988, 0.13, 0.16, 0.14);
      tone(1319, 0.26, 0.3, 0.12);
    }
  } catch (e) {
    /* ignore */
  }
}

/* ---------- 日志着色 / 搜索 ---------- */
function logClass(line) {
  if (/(错误|失败|异常|无法|超时|error|exception|traceback|failed|✗|✘|❌)/i.test(line)) return "ln-err";
  if (/(成功|完成|已写入|已保存|已导出|已上传|done|success|✓|✔|✅)/i.test(line)) return "ln-ok";
  if (/(警告|警示|注意|跳过|重试|skip|retry|warn|⚠)/i.test(line)) return "ln-warn";
  if (/^\s*\[?\d{4}[-/]\d{2}[-/]\d{2}/.test(line)) return "ln-dim";
  return "";
}

function renderLogInto(box, text, term) {
  const escTerm = term ? esc(term) : "";
  const re = escTerm ? new RegExp(escapeRegExp(escTerm), "gi") : null;
  let html;
  if (!text) {
    html = '<span class="ln-dim">暂无日志</span>';
  } else {
    html = text
      .split("\n")
      .map((line) => {
        let body = esc(line);
        if (re) body = body.replace(re, (m) => `<mark class="log-hit">${m}</mark>`);
        return `<span class="${logClass(line)}">${body}</span>`;
      })
      .join("\n");
  }
  box.innerHTML = html;

  const marks = [...box.querySelectorAll("mark.log-hit")];
  state.logSearch.hits = marks.length;
  if (marks.length) {
    if (state.logSearch.idx >= marks.length) state.logSearch.idx = 0;
    marks.forEach((m, i) => m.classList.toggle("current", i === state.logSearch.idx));
    const cur = marks[state.logSearch.idx];
    if (cur) cur.scrollIntoView({ block: "center" });
  } else {
    state.logSearch.idx = 0;
  }
  updateSearchCount();
}

function updateSearchCount() {
  const c = $("logSearchCount");
  if (!c) return;
  if (!state.logSearch.term) {
    c.textContent = "";
    return;
  }
  c.textContent = `${state.logSearch.hits ? state.logSearch.idx + 1 : 0}/${state.logSearch.hits}`;
}

/* ---------- 日志「回到底部」 ---------- */
function updateLogToBottom() {
  const box = $("logBox");
  const btn = $("logToBottom");
  if (!box || !btn) return;
  const away = box.scrollHeight - box.scrollTop - box.clientHeight > 56;
  btn.classList.toggle("hidden", !away);
}

function scrollLogToBottom() {
  const box = $("logBox");
  if (!box) return;
  box.scrollTop = box.scrollHeight;
  updateLogToBottom();
}

/* ---------- API ---------- */
function _apiBase() {
  return (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "";
}
function _authHeaders(extra) {
  const h = { "Content-Type": "application/json", ...(extra || {}) };
  const tok = localStorage.getItem("zc_token");
  if (tok) h["X-Auth-Token"] = tok;
  return h;
}
async function api(path, options = {}) {
  const { headers: optHeaders, ...rest } = options;
  const res = await fetch(_apiBase() + path, {
    ...rest,
    headers: _authHeaders(optHeaders),
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("需要登录");
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `请求失败: ${res.status}`);
  }
  hideLogin(); // 有成功响应 = 已认证，自动关闭登录框
  return data;
}

async function loadActions() {
  const data = await api("/api/actions");
  state.actions = (data.actions || [])
    .filter((action) => action.id !== "qianchuan_sync_preview")
    .map(normalizeAction);
  renderActions();
}

function normalizeAction(action) {
  if (action.id !== "qianchuan_collect") return action;
  return {
    ...action,
    description: "打开巨量营销，按脚本默认时间范围下载内容种草预定单并写入「巨量营销内服投放」数据表。",
    fields: (action.fields || []).filter((field) => !["start", "end"].includes(field.name)),
  };
}

function ensureMetrics() {
  if (state.metricsReady) return;
  $("metrics").innerHTML = METRICS.map(
    ([label, tone]) => `<div class="metric tone-${tone}">
      <div class="metric-icon">${ICONS[tone]}</div>
      <div class="metric-body"><strong data-metric="${tone}">0</strong><span>${label}</span></div>
    </div>`
  ).join("");
  state.metricsReady = true;
}

function sessionsHTML(sessions) {
  return sessions
    .map((s) => {
      const badge = s.exists
        ? `<span class="badge ok">存在</span>`
        : `<span class="badge bad">缺失</span>`;
      return `<article class="session">
        <strong>${esc(s.name)}${badge}</strong>
        <p>${esc(s.kind)} · ${bytes(s.size)}</p>
        <p>${esc(s.updated_at || "未生成")}</p>
      </article>`;
    })
    .join("");
}

async function loadHealth() {
  const data = await api("/api/health");
  const cfg = data.config;
  $("healthLine").textContent = `${data.time} · 脚本目录 ${cfg.workflow_exists ? "已找到" : "未找到"} · Python ${cfg.python_exists ? "已找到" : "未找到"}`;

  const ready = cfg.workflow_exists && cfg.python_exists;
  const pill = $("statusPill");
  if (pill) {
    pill.classList.toggle("is-bad", !ready);
    $("statusText").textContent = ready ? "服务在线" : "环境缺失";
  }

  ensureMetrics();
  const counts = data.counts;
  for (const [, tone] of METRICS) {
    const el = $("metrics").querySelector(`[data-metric="${tone}"]`);
    if (el) animateCount(el, counts[tone]);
  }

  const active = (counts.running || 0) + (counts.queued || 0);
  const badge = $("navRunning");
  if (badge) {
    badge.textContent = active;
    badge.classList.toggle("hidden", active === 0);
  }
  document.title = counts.running ? `(${counts.running}) 种草日报控制台` : "种草日报控制台";

  const sig = data.sessions
    .map((s) => `${s.name}|${s.exists}|${s.size}|${s.updated_at}`)
    .join(";");
  if (sig !== state.sessionsSig) {
    state.sessionsSig = sig;
    const html = sessionsHTML(data.sessions);
    $("sessions").innerHTML = html;
    if ($("sessionsMini")) $("sessionsMini").innerHTML = html;
  }

  state.sheetUrl = (cfg.default_sheet_url || "").trim();
  renderDelivery();
}

function detectCompletions(jobs) {
  for (const j of jobs) {
    const before = state.jobStatus[j.id];
    if (
      before &&
      before !== j.status &&
      ["queued", "running"].includes(before) &&
      ["succeeded", "failed", "canceled"].includes(j.status)
    ) {
      onJobDone(j);
    }
    state.jobStatus[j.id] = j.status;
  }
}

function fireDesktop(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: "zc-job", renotify: true });
      n.onclick = () => {
        window.focus();
        setView("jobs");
      };
    }
  } catch (e) {
    /* ignore */
  }
}

function onJobDone(job) {
  const ok = job.status === "succeeded";
  const word = ok ? "完成" : job.status === "failed" ? "失败" : "已取消";
  toast(`#${job.id} ${job.title} ${word}`, ok ? "ok" : job.status === "failed" ? "err" : "info");
  if (state.notify) {
    const head = ok ? "✅ 任务完成" : job.status === "failed" ? "❌ 任务失败" : "⏹ 任务取消";
    fireDesktop(head, `#${job.id} ${job.title}`);
    beep(ok ? "ok" : "err");
  }
}

async function loadJobs(selectLatest = false) {
  const data = await api("/api/jobs?limit=80");
  state.jobs = data.jobs;
  detectCompletions(data.jobs);
  if (selectLatest && data.jobs[0]) {
    state.selectedJobId = data.jobs[0].id;
  }
  renderJobs();
  renderDelivery();
  if (state.selectedJobId && (selectLatest || state.view === "jobs")) {
    // 周期刷新时，看不到的页面不拉日志；已结束的任务日志不会再变，也跳过重复拉取
    const sel = state.jobs.find((j) => j.id === state.selectedJobId);
    const settled = sel && ["succeeded", "failed", "canceled"].includes(sel.status);
    if (selectLatest || !(settled && state.lastLogId === state.selectedJobId)) {
      await loadJob(state.selectedJobId, false);
    }
  }
}

function renderActions() {
  const groups = new Map();
  const actionsToShow = scopedActions(orderedActions());
  for (const action of actionsToShow) {
    if (!groups.has(action.category)) groups.set(action.category, []);
    groups.get(action.category).push(action);
  }

  const tabs = document.querySelectorAll("[data-action-scope]");
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.actionScope === state.actionScope);
  });

  if (!actionsToShow.length) {
    $("actions").innerHTML = `<div class="job-meta" style="padding: 12px 2px;">${esc(ACTION_SCOPE_LABELS[state.actionScope] || "")}暂无动作</div>`;
    return;
  }

  $("actions").innerHTML = [...groups.entries()]
    .map(([category, actions]) => `<section class="action-group">
      <div class="action-group-head">
        <h3>${esc(ACTION_CATEGORY_LABELS[category] || category)}</h3>
        <span>${actions.length} 个动作</span>
      </div>
      <div class="action-group-grid">
        ${actions
          .map(
            (action) => `<article class="action-card${action.danger ? " is-danger" : ""}">
              <div class="category">${action.danger ? "⚠ " : ""}${esc(action.category)}</div>
              <h3>${esc(action.title)}</h3>
              <p>${esc(action.description)}</p>
              ${action.danger ? `<div class="warning">${esc(action.danger)}</div>` : ""}
              <button class="primary" data-run="${esc(action.id)}">运行</button>
            </article>`
          )
          .join("")}
      </div>
    </section>`)
    .join("");

  document.querySelectorAll("[data-run]").forEach((btn) => {
    btn.addEventListener("click", () => openRunDialog(btn.dataset.run));
  });
}

function badgeHTML(status) {
  const [label, cls] = statusLabel(status);
  const dot = cls === "run" ? '<span class="pulse-dot"></span>' : "";
  return `<span class="badge ${cls}">${dot}${label}</span>`;
}

function refreshRelTimes() {
  document.querySelectorAll(".job-time").forEach((el) => {
    el.textContent = relTime(el.dataset.ts);
  });
}

function markActiveJob() {
  document.querySelectorAll(".job").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.job) === state.selectedJobId);
  });
}

function renderJobs() {
  if (!state.jobs.length) {
    $("jobs").innerHTML = `<div class="job-meta" style="padding: 16px;">还没有任务，先从“采集动作”里选择一个动作。</div>`;
    state.jobsSig = "";
    return;
  }

  const sig = state.jobs.map((j) => `${j.id}:${j.status}`).join("|");
  if (sig !== state.jobsSig) {
    state.jobsSig = sig;
    $("jobs").innerHTML = state.jobs
      .map(
        (job) => `<button class="job" data-job="${job.id}">
          <div>
            <div class="job-title">#${job.id} ${esc(job.title)}</div>
            <div class="job-meta">${esc(job.category)} · <span class="job-time" data-ts="${esc(job.created_at)}" title="${esc(job.created_at)}">${relTime(job.created_at)}</span></div>
          </div>
          ${badgeHTML(job.status)}
        </button>`
      )
      .join("");
    document.querySelectorAll("[data-job]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedJobId = Number(btn.dataset.job);
        markActiveJob();
        setView("jobs"); // 由 setView 统一触发日志加载，避免重复请求
      });
    });
  }
  markActiveJob();
  refreshRelTimes();
}

/* ---------- 交付看板（客户向） ---------- */
// 预览/不写入的运行不算数：勾了「只预览不写入」(dry_run) 或千川「只下载不上传」(no_upload)
function isPreviewRun(job) {
  const p = job.params || {};
  return p.dry_run === true || p.no_upload === true;
}

// 某一阶段最近一次「非预览」的成功（用于判断该阶段是否完成及完成时间）
function lastSuccessByActions(actionIds) {
  let best = null;
  for (const j of state.jobs) {
    if (j.status !== "succeeded" || isPreviewRun(j)) continue;
    if (!actionIds.includes(j.action_id)) continue;
    const stamp = j.finished_at || j.created_at || "";
    if (!best || stamp > (best.finished_at || best.created_at || "")) best = j;
  }
  return best;
}

function renderDelivery() {
  // 「打开交付主表」按钮
  const open = $("deliveryOpen");
  if (open) {
    if (state.sheetUrl) {
      open.href = state.sheetUrl;
      open.classList.remove("is-disabled");
    } else {
      open.removeAttribute("href");
      open.classList.add("is-disabled");
    }
  }

  const total = DELIVERY_LINES.length;
  const busy = state.jobs.some((j) => j.status === "running" || j.status === "queued");

  // 每条线按它真实的阶段判定，取每个阶段最近一次「非预览」的成功
  const lineViews = DELIVERY_LINES.map((line) => {
    const stages = line.stages.map((st) => {
      const job = lastSuccessByActions(st.actions);
      return { label: st.label, todo: st.todo, job, done: !!job };
    });
    const doneStages = stages.filter((s) => s.done);
    return {
      line,
      stages,
      furthest: doneStages.length ? doneStages[doneStages.length - 1] : null,
      allDone: doneStages.length === stages.length,
      noneDone: doneStages.length === 0,
    };
  });
  const doneCount = lineViews.filter((v) => v.allDone).length;

  const lines = $("deliveryLines");
  if (lines) {
    lines.innerHTML = lineViews
      .map(({ line, stages, furthest, allDone }) => {
        let badge;
        if (allDone) {
          badge = `<span class="badge ok">${esc(furthest.label)}</span>`;
        } else if (furthest) {
          badge = `<span class="badge wait">${esc(furthest.label)}</span>`;
        } else {
          badge = `<span class="badge idle">${esc(stages[0].todo)}</span>`;
        }
        const chips = stages
          .map((s) =>
            s.done
              ? `<span class="dstage is-done">✓ ${esc(s.label)}<i>${esc(relTime(s.job.finished_at || s.job.created_at))}</i></span>`
              : `<span class="dstage is-todo">○ ${esc(s.todo)}</span>`
          )
          .join("");
        return `<article class="dline ${line.cls} ${allDone ? "is-done" : "is-wait"}">
          <div class="dline-top"><strong>${esc(line.name)}</strong>${badge}</div>
          <div class="dline-stages">${chips}</div>
        </article>`;
      })
      .join("");
  }

  const tag = $("deliveryStepTag");
  if (tag) tag.textContent = `${doneCount}/${total} 条线已完成`;

  const statusEl = $("deliveryStatus");
  if (statusEl) {
    let text;
    let tone;
    if (busy) {
      text = "采集进行中…";
      tone = "run";
    } else if (doneCount >= total) {
      text = "三条线已全部完成";
      tone = "ok";
    } else if (lineViews.some((v) => !v.noneDone)) {
      text = `进行中 · ${doneCount}/${total} 条线已完成`;
      tone = "wait";
    } else {
      text = "尚未开始采集";
      tone = "wait";
    }
    statusEl.textContent = text;
    statusEl.className = `delivery-status is-${tone}`;
  }

  const feed = $("deliveryFeed");
  if (feed) {
    const items = state.jobs
      .filter((j) => j.status === "succeeded" && !isPreviewRun(j))
      .slice(0, 6);
    feed.innerHTML = items.length
      ? items
          .map(
            (j) => `<div class="dfeed-item">
              <span class="dfeed-dot"></span>
              <span class="dfeed-text">${esc(j.category)}数据已更新</span>
              <span class="dfeed-time">${esc(relTime(j.finished_at || j.created_at))}</span>
            </div>`
          )
          .join("")
      : '<p class="job-meta">今天还没有完成的采集，跑完后这里会显示更新记录。</p>';
  }
}

async function loadJob(id, fromClick = true) {
  const data = await api(`/api/jobs/${id}`);
  const job = data.job;
  state.selectedJobId = job.id;
  $("logTitle").textContent = `#${job.id} ${job.title} · ${statusLabel(job.status)[0]}`;
  $("logLive").classList.toggle("hidden", job.status !== "running");

  const box = $("logBox");
  const txt = job.log_tail || "";
  const switched = state.lastLogId !== job.id;
  if (switched) {
    state.logSearch.term = "";
    state.logSearch.idx = 0;
    if ($("logSearchInput")) $("logSearchInput").value = "";
    if ($("logSearchBar")) $("logSearchBar").classList.add("hidden");
  }
  if (switched || state.lastLogText !== txt) {
    const nearBottom =
      switched || box.scrollHeight - box.scrollTop - box.clientHeight < 56;
    renderLogInto(box, txt, state.logSearch.term);
    if (nearBottom && !state.logSearch.term) box.scrollTop = box.scrollHeight;
    state.lastLogId = job.id;
    state.lastLogText = txt;
  }
  updateLogToBottom();

  $("retryBtn").classList.toggle("hidden", !["failed", "succeeded", "canceled"].includes(job.status));
  $("cancelBtn").classList.toggle("hidden", !["queued", "running"].includes(job.status));
  if (fromClick) markActiveJob();
}

/* ---------- 运行参数对话框 ---------- */
function openRunDialog(actionId, presetParams = {}) {
  const action = state.actions.find((item) => item.id === actionId);
  if (!action) return;
  $("runForm").dataset.actionId = action.id;
  $("dialogCategory").textContent = action.category;
  $("dialogTitle").textContent = action.title;
  $("dialogDesc").textContent = action.description;
  $("dialogDanger").textContent = action.danger || "";
  $("dialogDanger").classList.toggle("hidden", !action.danger);

  const fields = action.fields || [];
  $("fields").dataset.actionId = action.id;
  $("fields").innerHTML = fields.length
    ? fields
        .map((field) => {
          const fieldClass = `field field-${esc(field.name)} field-type-${esc(field.type || "text")}`;
          if (field.type === "checkbox") {
            return `<label class="check-field">
              <input type="checkbox" name="${esc(field.name)}" ${(Object.prototype.hasOwnProperty.call(presetParams, field.name) ? presetParams[field.name] : field.default) ? "checked" : ""} />
              <span class="check-field-body">
                <span>${esc(field.label)}</span>
                ${field.hint ? `<small>${esc(field.hint)}</small>` : ""}
              </span>
            </label>`;
          }
          if (field.type === "textarea") {
            return `<div class="${fieldClass}">
              <label>${esc(field.label)}</label>
              <textarea name="${esc(field.name)}" placeholder="${esc(field.placeholder || "")}">${esc(Object.prototype.hasOwnProperty.call(presetParams, field.name) ? presetParams[field.name] : field.default || "")}</textarea>
              ${field.hint ? `<p class="field-hint">${esc(field.hint)}</p>` : ""}
            </div>`;
          }
          return `<div class="${fieldClass}">
            <label>${esc(field.label)}</label>
            <input type="${field.type || "text"}" name="${esc(field.name)}" value="${esc(Object.prototype.hasOwnProperty.call(presetParams, field.name) ? presetParams[field.name] : field.default || "")}" placeholder="${esc(field.placeholder || "")}" />
            ${field.hint ? `<p class="field-hint">${esc(field.hint)}</p>` : ""}
          </div>`;
        })
        .join("") + (action.id === "weekly_report"
          ? `<div class="preview-tools">
              <button type="button" id="previewWeeklyCreators" class="ghost">预先读取达人</button>
              <span id="previewWeeklyStatus" class="preview-status">读取后可在「达人名单」里手动调整；草稿开关在上方勾选。</span>
            </div>`
          : "")
    : `<p class="job-meta">这个动作不需要额外参数。</p>`;
  $("runDialog").showModal();
  if (action.id === "weekly_report" && $("previewWeeklyCreators")) {
    $("previewWeeklyCreators").addEventListener("click", previewWeeklyCreators);
  }
}

function closeRunDialog() {
  $("runDialog").close();
}

function collectRunParams(action) {
  const form = new FormData($("runForm"));
  const params = {};
  for (const field of action.fields || []) {
    if (field.type === "checkbox") {
      params[field.name] = form.get(field.name) === "on";
    } else {
      params[field.name] = String(form.get(field.name) || "").trim();
    }
  }
  return params;
}

async function previewWeeklyCreators() {
  const action = state.actions.find((item) => item.id === "weekly_report");
  if (!action) return;
  const btn = $("previewWeeklyCreators");
  const status = $("previewWeeklyStatus");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "读取中…";
  }
  if (status) status.textContent = "正在读取两个达人源链接…";
  try {
    const data = await api("/api/weekly/preview-creators", {
      method: "POST",
      body: JSON.stringify({ params: collectRunParams(action) }),
    });
    const textarea = $("runForm").querySelector('textarea[name="creators"]');
    if (textarea) textarea.value = data.text || "";
    if (status) {
      status.textContent = `已读取 ${data.count || 0} 个达人；报告 ${data.report_name}；达人圈选不筛选时间`;
    }
    toast(`已读取 ${data.count || 0} 个达人`, "ok");
  } catch (err) {
    if (status) status.textContent = `读取失败：${err.message}`;
    toast(err.message, "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "预先读取达人";
    }
  }
}

async function submitRun(event) {
  event.preventDefault();
  if (event.submitter && event.submitter.id !== "submitRun") {
    closeRunDialog();
    return;
  }
  const actionId = $("runForm").dataset.actionId;
  const action = state.actions.find((item) => item.id === actionId);
  if (!action) return;
  const params = collectRunParams(action);
  try {
    await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ action_id: actionId, params }),
    });
  } catch (err) {
    toast(err.message, "err");
    return;
  }
  $("runDialog").close();
  toast(`已加入队列：${action.title}`, "ok");
  setView("jobs");
  await loadHealth();
  await loadJobs(true);
}

async function cancelSelected() {
  if (!state.selectedJobId) return;
  try {
    await api(`/api/jobs/${state.selectedJobId}/cancel`, { method: "POST", body: "{}" });
    toast("已请求取消任务", "info");
  } catch (err) {
    toast(err.message, "err");
    return;
  }
  await refreshAll();
}

async function retrySelected() {
  if (!state.selectedJobId) return;
  try {
    await api(`/api/jobs/${state.selectedJobId}/retry`, { method: "POST", body: "{}" });
    toast("已重新加入队列", "ok");
  } catch (err) {
    toast(err.message, "err");
    return;
  }
  await loadJobs(true);
}

async function clearHistory() {
  if (
    !confirm(
      "确定清空所有已结束（成功 / 失败 / 取消）的历史任务和它们的日志吗？\n运行中、排队中的任务会保留。此操作不可恢复。"
    )
  ) {
    return;
  }
  let removed = 0;
  try {
    const data = await api("/api/jobs/clear", { method: "POST", body: "{}" });
    removed = data.removed || 0;
  } catch (err) {
    toast(err.message, "err");
    return;
  }
  // 选中的任务可能已被清掉，重置日志区
  state.selectedJobId = null;
  state.lastLogId = null;
  state.lastLogText = null;
  $("logTitle").textContent = "选择一个任务查看日志";
  $("logLive").classList.add("hidden");
  $("retryBtn").classList.add("hidden");
  $("cancelBtn").classList.add("hidden");
  renderLogInto($("logBox"), "", "");
  updateLogToBottom();
  toast(`已清空 ${removed} 条历史任务`, "ok");
  await refreshAll();
}

/* ---------- 日志工具条 ---------- */
async function copyLog() {
  try {
    await navigator.clipboard.writeText(state.lastLogText || "");
    toast("日志已复制到剪贴板", "ok");
  } catch (e) {
    toast("复制失败，浏览器可能不允许", "err");
  }
}

async function downloadLog() {
  const id = state.selectedJobId;
  if (!id) return;
  try {
    const res = await fetch(_apiBase() + `/api/jobs/${id}/log`, { headers: _authHeaders() });
    const text = await res.text();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job_${id}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast("开始下载完整日志", "info");
  } catch (e) {
    toast("下载失败", "err");
  }
}

function toggleLogSearch() {
  const bar = $("logSearchBar");
  const hidden = bar.classList.toggle("hidden");
  if (!hidden) {
    $("logSearchInput").focus();
  } else {
    state.logSearch.term = "";
    $("logSearchInput").value = "";
    renderLogInto($("logBox"), state.lastLogText || "", "");
  }
}

function onLogSearchInput() {
  state.logSearch.term = $("logSearchInput").value;
  state.logSearch.idx = 0;
  renderLogInto($("logBox"), state.lastLogText || "", state.logSearch.term);
}

function onLogSearchKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!state.logSearch.hits) return;
    const dir = e.shiftKey ? -1 : 1;
    state.logSearch.idx =
      (state.logSearch.idx + dir + state.logSearch.hits) % state.logSearch.hits;
    renderLogInto($("logBox"), state.lastLogText || "", state.logSearch.term);
  } else if (e.key === "Escape") {
    e.preventDefault();
    toggleLogSearch();
  }
}

/* ---------- 视图路由 ---------- */
function setView(view) {
  if (!VIEW_META[view]) view = "overview";
  state.view = view;
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("hidden", v.dataset.view !== view);
  });
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.view === view);
  });
  const [t, s] = VIEW_META[view];
  $("viewTitle").textContent = t;
  $("viewSub").textContent = s;
  try {
    localStorage.setItem("zc_view", view);
  } catch (e) {
    /* ignore */
  }
  // 切到任务中心时立即把选中任务的日志拉一次（周期刷新只在本页生效）
  if (view === "jobs" && state.selectedJobId) {
    loadJob(state.selectedJobId, false).catch(() => {});
  }
}

/* ---------- ⌘K 命令面板 ---------- */
function cmdkFiltered(q) {
  const term = q.trim().toLowerCase();
  const actions = orderedActions();
  if (!term) return actions;
  return actions.filter((a) => `${a.title} ${a.category} ${a.description}`.toLowerCase().includes(term));
}

function renderCmdk(q) {
  const list = cmdkFiltered(q);
  state.cmdkList = list;
  if (state.cmdkIdx >= list.length) state.cmdkIdx = Math.max(0, list.length - 1);
  const el = $("cmdkList");
  if (!list.length) {
    el.innerHTML = '<div class="cmdk-empty">没有匹配的动作</div>';
    return;
  }
  el.innerHTML = list
    .map(
      (a, i) => `<div class="cmdk-item${i === state.cmdkIdx ? " active" : ""}" data-idx="${i}">
        <span class="cmdk-cat">${esc(a.category)}</span>
        <span class="cmdk-text">
          <span class="cmdk-item-title">${esc(a.title)}</span>
          <span class="cmdk-item-desc">${esc(a.description)}</span>
        </span>
        <kbd class="enter-hint">↵</kbd>
      </div>`
    )
    .join("");
  el.querySelectorAll(".cmdk-item").forEach((it) => {
    it.addEventListener("mousemove", () => {
      state.cmdkIdx = Number(it.dataset.idx);
      highlightCmdk();
    });
    it.addEventListener("click", () => runCmdk(Number(it.dataset.idx)));
  });
}

function highlightCmdk() {
  $("cmdkList")
    .querySelectorAll(".cmdk-item")
    .forEach((it, i) => it.classList.toggle("active", i === state.cmdkIdx));
}

function scrollCmdkActive() {
  const active = $("cmdkList").querySelector(".cmdk-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function runCmdk(idx) {
  const a = state.cmdkList[idx];
  if (!a) return;
  closeCmdk();
  openRunDialog(a.id);
}

function openCmdk() {
  if (!state.actions.length) return;
  state.cmdkIdx = 0;
  $("cmdkInput").value = "";
  renderCmdk("");
  $("cmdk").classList.remove("hidden");
  setTimeout(() => $("cmdkInput").focus(), 10);
}

function closeCmdk() {
  $("cmdk").classList.add("hidden");
}

/* ---------- 完成通知开关 ---------- */
/* ---------- AI 助手 ---------- */
function aiScrollBottom() {
  const box = $("aiMessages");
  if (box) box.scrollTop = box.scrollHeight;
}

function appendAiMessage(text, role = "assistant", payload = null) {
  const box = $("aiMessages");
  if (!box) return null;
  const el = document.createElement("div");
  el.className = `ai-msg ${role}${payload && payload.action ? " has-action" : ""}`;
  const rawText = text || "";
  el.innerHTML = `<div class="ai-msg-text">${esc(rawText)}</div>`;
  if (payload && payload.action) {
    const action = payload.action;
    const params = payload.params || {};
    const paramText = Object.keys(params).length
      ? Object.entries(params).map(([k, v]) => `${k}=${v}`).join("，")
      : "无额外参数";
    const wrap = document.createElement("div");
    wrap.className = "ai-action";
    wrap.innerHTML = `<strong>${esc(action.title)}</strong><small>${esc(paramText)}</small><button type="button" class="primary">打开确认</button>`;
    wrap.querySelector("button").addEventListener("click", () => {
      openRunDialog(action.id, params);
      closeAiPanel();
    });
    el.appendChild(wrap);
  }
  if (role === "assistant" && rawText.length > 80) {
    const tools = document.createElement("div");
    tools.className = "ai-msg-tools";
    tools.innerHTML = '<button type="button" class="ghost">复制</button>';
    tools.querySelector("button").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(rawText);
        toast("AI 回复已复制", "ok");
      } catch (e) {
        toast("复制失败，可以手动选中文本复制", "err");
      }
    });
    el.appendChild(tools);
  }
  box.appendChild(el);
  aiScrollBottom();
  return el;
}

function setAiBusy(busy) {
  state.aiBusy = busy;
  const btn = $("aiSend");
  const input = $("aiInput");
  if (btn) {
    btn.disabled = busy;
    btn.textContent = busy ? "思考中" : "发送";
  }
  if (input) input.disabled = busy;
}

function openAiPanel() {
  const panel = $("aiPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  if (!$("aiMessages").children.length) {
    appendAiMessage("我在。可以问我当前进度、诊断选中任务日志，也可以直接说“帮我跑星图 6/21”。");
  }
  setTimeout(() => $("aiInput").focus(), 20);
}

function closeAiPanel() {
  const panel = $("aiPanel");
  if (panel) panel.classList.add("hidden");
}

async function submitAi(event) {
  event.preventDefault();
  if (state.aiBusy) return;
  const input = $("aiInput");
  const message = (input.value || "").trim();
  if (!message) return;
  input.value = "";
  appendAiMessage(message, "user");
  const pending = appendAiMessage("正在问本地模型…", "assistant");
  setAiBusy(true);
  try {
    const data = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message, job_id: state.selectedJobId || null }),
    });
    if (pending) pending.remove();
    appendAiMessage(data.answer || "AI 没有返回内容。", "assistant", data.kind === "action" ? data : null);
  } catch (err) {
    if (pending) pending.remove();
    appendAiMessage(`出错了：${err.message}`, "assistant");
    toast(err.message, "err");
  } finally {
    setAiBusy(false);
    if (!$("aiPanel").classList.contains("hidden")) $("aiInput").focus();
  }
}

function initAi() {
  if ($("aiToggle")) $("aiToggle").addEventListener("click", openAiPanel);
  if ($("aiClose")) $("aiClose").addEventListener("click", closeAiPanel);
  if ($("aiForm")) $("aiForm").addEventListener("submit", submitAi);
}

function initNotify() {
  const btn = $("notifyBtn");
  const txt = $("notifyText");
  if (!("Notification" in window)) {
    btn.classList.add("hidden");
    return;
  }
  const sync = () => {
    if (Notification.permission === "denied") {
      txt.textContent = "通知被拒";
      btn.classList.remove("is-on");
    } else if (Notification.permission === "granted") {
      txt.textContent = state.notify ? "值守中" : "已静音";
      btn.classList.toggle("is-on", state.notify);
    } else {
      txt.textContent = "开启通知";
      btn.classList.remove("is-on");
    }
  };
  sync();
  btn.addEventListener("click", async () => {
    unlockAudio();
    if (Notification.permission === "granted") {
      state.notify = !state.notify;
      sync();
      toast(state.notify ? "值守模式开启：完成会响铃 + 通知" : "已静音", state.notify ? "ok" : "info");
      if (state.notify) beep("ok");
      return;
    }
    if (Notification.permission === "denied") {
      toast("通知已被浏览器拒绝，请在地址栏权限里开启", "err");
      return;
    }
    const p = await Notification.requestPermission();
    if (p === "granted") {
      state.notify = true;
      beep("ok");
      toast("值守模式开启：任务完成会响铃 + 桌面通知", "ok");
    }
    sync();
  });
}

/* ---------- 深色 / 浅色主题 ---------- */
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = $("themeIcon");
  if (icon) icon.innerHTML = theme === "dark" ? THEME_ICONS.sun : THEME_ICONS.moon;
  const btn = $("themeBtn");
  if (btn) btn.title = theme === "dark" ? "切换到浅色" : "切换到深色";
}

function initTheme() {
  // 首屏的内联脚本已设好 data-theme，这里只同步图标并绑定切换
  applyTheme(currentTheme());
  const btn = $("themeBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem("zc_theme", next);
      } catch (e) {
        /* ignore */
      }
    });
  }
  // 用户没手动选过时，跟随系统切换
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (localStorage.getItem("zc_theme")) return;
      applyTheme(e.matches ? "dark" : "light");
    });
  } catch (e) {
    /* ignore */
  }
}

async function refreshAll() {
  const btn = $("refreshBtn");
  if (btn) btn.classList.add("is-loading");
  try {
    await Promise.all([loadHealth(), loadActions(), loadJobs()]);
  } finally {
    if (btn) btn.classList.remove("is-loading");
  }
}

function bindEvents() {
  $("refreshBtn").addEventListener("click", refreshAll);
  $("clearHistoryBtn").addEventListener("click", clearHistory);
  $("runForm").addEventListener("submit", submitRun);
  $("closeRunDialog").addEventListener("click", closeRunDialog);
  $("cancelRunDialog").addEventListener("click", closeRunDialog);
  $("cancelBtn").addEventListener("click", cancelSelected);
  $("retryBtn").addEventListener("click", retrySelected);

  // 侧边导航
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.addEventListener("click", () => setView(n.dataset.view));
  });

  document.querySelectorAll("[data-action-scope]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.actionScope = tab.dataset.actionScope || "all";
      try {
        localStorage.setItem("zc_action_scope", state.actionScope);
      } catch (e) {
        /* ignore */
      }
      renderActions();
    });
  });

  // 日志工具
  $("logCopyBtn").addEventListener("click", copyLog);
  $("logDownloadBtn").addEventListener("click", downloadLog);
  $("logSearchBtn").addEventListener("click", toggleLogSearch);
  $("logSearchInput").addEventListener("input", onLogSearchInput);
  $("logSearchInput").addEventListener("keydown", onLogSearchKey);
  $("logBox").addEventListener("scroll", updateLogToBottom);
  $("logToBottom").addEventListener("click", scrollLogToBottom);

  // 命令面板
  $("cmdkBtn").addEventListener("click", openCmdk);
  $("cmdkInput").addEventListener("input", () => {
    state.cmdkIdx = 0;
    renderCmdk($("cmdkInput").value);
  });
  $("cmdk").addEventListener("mousedown", (e) => {
    if (e.target === $("cmdk")) closeCmdk();
  });

  // 全局快捷键
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      $("cmdk").classList.contains("hidden") ? openCmdk() : closeCmdk();
      return;
    }
    if (!$("cmdk").classList.contains("hidden")) {
      const len = state.cmdkList.length;
      if (e.key === "Escape") {
        e.preventDefault();
        closeCmdk();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        state.cmdkIdx = Math.min(len - 1, state.cmdkIdx + 1);
        highlightCmdk();
        scrollCmdkActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.cmdkIdx = Math.max(0, state.cmdkIdx - 1);
        highlightCmdk();
        scrollCmdkActive();
      } else if (e.key === "Enter") {
        e.preventDefault();
        runCmdk(state.cmdkIdx);
      }
    }
  });

  // 首次交互解锁提示音
  document.addEventListener("click", unlockAudio, { once: true });
}

async function boot() {
  bindEvents();
  initTheme();
  initNotify();
  initAi();
  try {
    const savedScope = localStorage.getItem("zc_action_scope");
    if (savedScope && ACTION_SCOPE_LABELS[savedScope]) state.actionScope = savedScope;
  } catch (e) {
    /* ignore */
  }
  let saved = "overview";
  try {
    saved = localStorage.getItem("zc_view") || "overview";
  } catch (e) {
    /* ignore */
  }
  setView(saved);
  await refreshAll();
  state.refreshTimer = setInterval(async () => {
    try {
      await loadHealth();
      await loadJobs();
    } catch (err) {
      $("healthLine").textContent = `刷新失败：${err.message}`;
    }
  }, 3000);
}

boot().catch((err) => {
  $("healthLine").textContent = `启动失败：${err.message}`;
  toast(`启动失败：${err.message}`, "err");
});

/* ---------- 公网登录 ---------- */
function showLogin() {
  const mask = document.getElementById("loginMask");
  if (!mask) return;
  mask.hidden = false;
  mask.style.display = "flex"; // 内联样式优先级最高，确保能显示
  const pwd = document.getElementById("loginPwd");
  if (pwd) setTimeout(() => pwd.focus(), 10);
}

function hideLogin() {
  const mask = document.getElementById("loginMask");
  if (!mask) return;
  mask.hidden = true;
  mask.style.display = "none"; // 内联样式优先级最高，确保能隐藏
}

let _loggingIn = false;

(function setupLogin() {
  const form = document.getElementById("loginForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (_loggingIn) return; // 防止重复提交导致循环
    _loggingIn = true;
    const pwd = document.getElementById("loginPwd").value;
    const errBox = document.getElementById("loginErr");
    errBox.textContent = "";
    try {
      const res = await fetch(_apiBase() + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();
      if (res.ok && data.token !== undefined) {
        localStorage.setItem("zc_token", data.token || "");
        hideLogin();
        // 不刷新页面，直接就地拉取数据，避免浏览器自动重填密码触发死循环
        try {
          await refreshAll();
        } catch (e2) {
          /* ignore */
        }
      } else {
        errBox.textContent = data.error || "登录失败";
      }
    } catch (err) {
      errBox.textContent = "无法连接后端，请检查网络或后端地址";
    } finally {
      _loggingIn = false;
    }
  });
})();
