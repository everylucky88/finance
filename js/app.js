import { Store, IDBAdapter, newId } from "./store.js";
import { Sync, SUPABASE_SQL } from "./sync.js";
import { buildContext, monthSummary, allocation, rebalance, annual, checks, recentCategories, addMonths, ymOf, todayStr, lastDay, yearToDate, accountSeries, pendingTemplates, assetBaseAmount } from "./calc.js";
import { ACCOUNT_TYPES, METHODS, CAT_KINDS, ASSET_GROUPS, PLAN_MODES } from "./defaults.js";
import { toCSV, transactionRows, monthlyRows, exportWorkbook, importTransactionsCSV } from "./io.js";

const START_DATE = "2026-11-20";            // 제로셋팅 시작일(이번 달 급여일)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("ko-KR"));
const won = (n) => (n == null ? "–" : fmt(n) + "원");
const man = (n) => { if (n == null) return "–"; const a = Math.abs(n); if (a >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, "") + "억"; if (a >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만"; return fmt(n); };
const pct = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "%");
const signed = (n, f = fmt) => (n == null ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n)));
const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
const parseNum = (s) => { if (s == null) return null; const t = String(s).replace(/[^0-9.\-]/g, ""); return t === "" || t === "-" ? null : Number(t); };

const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16m0-4a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/></svg>',
};

const app = { store: null, sync: null, state: null, ctx: null, ym: ymOf(todayStr()), route: "home", homeMode: "month", txFilter: "all", catKind: "income", sheet: null };

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    app.store = new Store(new IDBAdapter());
    await app.store.load(START_DATE);
  } catch (e) {
    document.body.innerHTML = `<div class="fatal"><h2>저장소를 열 수 없습니다</h2><p>Safari 개인정보 보호 모드에서는 데이터가 저장되지 않습니다. 일반 모드에서 열어 주세요.</p><pre>${esc(e.message)}</pre></div>`;
    return;
  }
  app.sync = await new Sync(app.store).init();
  app.store.onChange(() => { refresh(); scheduleSync(); });
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener("hashchange", () => { app.route = location.hash.slice(1) || "home"; refresh(); window.scrollTo(0, 0); });
  app.route = location.hash.slice(1) || "home";
  document.addEventListener("click", onClick);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (ymOf(todayStr()) !== app.lastToday) app.ym = ymOf(todayStr()); refresh(); trySync(); } });
  window.addEventListener("online", () => trySync());
  app.lastToday = ymOf(todayStr());
  refresh();
  trySync();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function refresh() {
  app.state = app.store.state;
  app.ctx = buildContext(app.state, todayStr());
  render();
}

let syncTimer = null;
function scheduleSync() { if (!app.sync?.configured || !app.sync.signedIn) return; clearTimeout(syncTimer); syncTimer = setTimeout(trySync, 2500); }
async function trySync(manual = false) {
  if (!app.sync?.configured || !app.sync.signedIn || !navigator.onLine) { if (manual) toast("동기화 설정·로그인이 필요합니다"); return; }
  setSyncDot("busy");
  try { const r = await app.sync.sync(); setSyncDot("ok"); if (manual) toast(`동기화 완료 · 받음 ${r.pulled ?? 0} · 보냄 ${r.pushed ?? 0}`); }
  catch (e) { setSyncDot("err"); if (manual) toast(e.message); app.syncError = e.message; }
}
function setSyncDot(s) { app.syncState = s; const d = $(".sync-dot"); if (d) d.dataset.s = s; }

// ------------------------------------------------------------------ render shell
const TABS = [["home", "홈", I.home], ["tx", "내역", I.list], ["add", "", I.plus], ["accounts", "통장", I.wallet], ["assets", "자산", I.chart]];
function render() {
  const base = app.route.split("/")[0];
  const view = { home: viewHome, tx: viewTx, accounts: viewAccounts, assets: viewAssets, settings: viewSettings }[base] || viewHome;
  $("#view").innerHTML = view();
  $("#tabbar").innerHTML = TABS.map(([k, label, icon]) => k === "add"
    ? `<button class="tab add" data-act="quickAdd" aria-label="거래 입력">${icon}</button>`
    : `<button class="tab ${base === k ? "on" : ""}" data-act="go" data-to="${k}">${icon}<span>${label}</span></button>`).join("")
    + `<button class="tab side-only ${base === "settings" ? "on" : ""}" data-act="go" data-to="settings">${I.gear}<span>설정</span></button>`;
  setSyncDot(app.syncState || (app.sync?.signedIn ? "ok" : "off"));
}

function header(title, { month = true, back = null, right = "" } = {}) {
  return `<header class="top">
    ${back ? `<button class="icon-btn back" data-act="go" data-to="${back}">${I.left}</button>` : ""}
    ${month ? `<div class="month-nav"><button class="icon-btn" data-act="month" data-d="-1" aria-label="이전 달">${I.left}</button>
      <h1 data-act="monthToday">${ymLabel(app.ym)}</h1><button class="icon-btn" data-act="month" data-d="1" aria-label="다음 달">${I.right}</button></div>`
      : `<h1 class="title">${esc(title)}</h1>`}
    <div class="top-actions">${right}<span class="sync-dot" title="동기화 상태"></span>
      <button class="icon-btn hide-side" data-act="go" data-to="settings" aria-label="설정">${I.gear}</button></div>
  </header>`;
}

const accName = (id) => app.ctx.acc[id]?.name ?? "(삭제된 통장)";
const catName = (id) => app.ctx.cat[id]?.name ?? "(삭제된 항목)";

// ------------------------------------------------------------------ 홈
function viewHome() {
  const ctx = app.ctx, ym = app.ym, s = monthSummary(ctx, ym), p = monthSummary(ctx, addMonths(ym, -1));
  const al = allocation(ctx, ym), ck = checks(ctx, ym);
  const consDiff = p.consumption ? s.consumption - p.consumption : null;
  const rate = s.rate ?? 0;
  const R = 34, C = 2 * Math.PI * R;
  const seg = `<div class="seg home-seg" role="tablist"><button class="${app.homeMode === "month" ? "on" : ""}" data-act="homeMode" data-m="month">월간</button><button class="${app.homeMode === "year" ? "on" : ""}" data-act="homeMode" data-m="year">연간</button></div>`;
  if (app.homeMode === "year") return header("") + seg + viewYear();
  return header("") + seg + `<main class="grid">
    <section class="card hero span2">
      <svg class="ring" viewBox="0 0 80 80"><circle cx="40" cy="40" r="${R}" class="ring-bg"/><circle cx="40" cy="40" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, Math.max(0, rate)))}"/><text x="40" y="45">${s.rate == null ? "–" : Math.round(rate * 100) + "%"}</text></svg>
      <div><div class="label">저축·투자금</div><div class="big invest">${won(s.savingsInvest)}</div>
      <div class="sub">저축 ${man(s.trSave + s.rebalSave)} · 투자 ${man(s.trInv + s.rebalInv)} · 저축·투자율 ${pct(s.rate)}</div></div>
    </section>
    ${stat("총수입", won(s.income), `월급 ${man(s.salary)} · 추가 ${man(s.extra)}`, "income")}
    ${stat("실제 소비", won(s.consumption), consDiff == null ? `고정 ${man(s.fixed)} · 변동 ${man(s.variable)}` : `전월 대비 ${signed(consDiff, man)}`, "expense")}
    ${stat("남은 현금", won(s.cashLeft), "급여통장 이번 달 순증", s.cashLeft < 0 ? "expense" : "")}
    ${stat("순자산", man(s.netWorth), s.netWorthChange == null ? "현금성+투자−부채" : `전월 대비 ${signed(s.netWorthChange, man)}`, "")}
    ${ck.length ? `<section class="card span2"><div class="card-h"><h2>이번 달 할 일</h2></div><ul class="checks">${ck.map((c) => `<li class="${c.level}" data-act="check" data-k="${c.key}"><span>${esc(c.text)}</span>${I.right}</li>`).join("")}</ul></section>` : ""}
    <section class="card span2"><div class="card-h"><h2>통장 배분</h2><button class="link" data-act="go" data-to="accounts">배분하기</button></div>
      ${al.income === 0 ? `<p class="muted">월급을 입력하면 통장별 배분금액이 계산됩니다.</p>` : ""}
      <ul class="alloc-mini">${al.rows.map((r) => {
        const ratio = r.recommended ? Math.min(1, r.actual / r.recommended) : r.actual ? 1 : 0;
        return `<li><span class="nm">${esc(r.name)}</span><span class="bar"><i style="width:${ratio * 100}%"></i></span><span class="amt">${r.done ? `<b class="ok">${man(r.actual)}</b>` : man(r.recommended)}</span></li>`; }).join("")}</ul>
      <div class="foot">가용 ${man(al.avail)} · 권장 ${man(al.totalRec)} · 이체 ${man(al.totalAct)}${al.shortfall > 0 ? ` · <span class="neg">부족 ${man(al.shortfall)}</span>` : ""}</div>
    </section>
    <section class="card span2"><div class="card-h"><h2>월별 요약</h2><span class="legend"><i class="lg-in"></i>수입<i class="lg-ex"></i>소비<i class="lg-iv"></i>저축·투자</span></div>
      ${barChart(6)}
    </section>
  </main>`;
}
const stat = (label, value, sub, cls = "") => `<section class="card stat"><div class="label">${label}</div><div class="val ${cls}">${value}</div><div class="sub">${sub}</div></section>`;

function barChart(n) {
  const months = []; for (let i = n - 1; i >= 0; i--) months.push(addMonths(app.ym, -i));
  const data = months.map((m) => (m < app.ctx.firstYm ? { ym: m, income: 0, consumption: 0, savingsInvest: 0 } : monthSummary(app.ctx, m)));
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.consumption, d.savingsInvest]));
  const W = 320, H = 130, gw = W / n, bw = Math.min(12, gw / 4.2);
  const bars = data.map((d, i) => {
    const x0 = i * gw + gw / 2 - bw * 1.6;
    return [["in", d.income], ["ex", d.consumption], ["iv", d.savingsInvest]].map(([k, v], j) => {
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * (H - 22));
      return `<rect class="b-${k}" x="${x0 + j * bw * 1.1}" y="${H - 18 - h}" width="${bw}" height="${h}" rx="2"/>`;
    }).join("") + `<text x="${i * gw + gw / 2}" y="${H - 4}" class="${d.ym === app.ym ? "cur" : ""}">${Number(d.ym.slice(5))}월</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>`;
}

function viewYear() {
  const y = app.ym.slice(0, 4), A = annual(app.ctx, y, app.ym);
  const nws = A.months.map((m) => m.netWorth ?? 0), max = Math.max(1, ...nws);
  return `<main class="grid">
    ${stat(`${y} 총수입`, man(A.totals.income), `월평균 ${man(A.totals.income / Math.max(1, A.months.filter((m) => m.income > 0).length))}`, "income")}
    ${stat("실제 소비", man(A.totals.consumption), "연간 합계", "expense")}
    ${stat("저축·투자금", man(A.totals.savingsInvest), `저축·투자율 ${pct(A.totals.rate)}`, "invest")}
    ${stat("배당 수입", man(A.totals.dividend), `신규 매수 ${man(A.totals.newBuy)}`, "")}
    <section class="card span2"><div class="card-h"><h2>월별 흐름</h2></div>
      <table class="tbl"><thead><tr><th>월</th><th>수입</th><th>소비</th><th>저축·투자</th><th>율</th></tr></thead><tbody>
      ${A.months.map((m) => `<tr class="${m.ym === app.ym ? "cur" : ""}" data-act="pickMonth" data-ym="${m.ym}"><td>${Number(m.ym.slice(5))}월</td><td>${m.income ? man(m.income) : "–"}</td><td>${m.consumption ? man(m.consumption) : "–"}</td><td>${m.savingsInvest ? man(m.savingsInvest) : "–"}</td><td>${pct(m.rate, 0)}</td></tr>`).join("")}
      </tbody><tfoot><tr><td>합계</td><td>${man(A.totals.income)}</td><td>${man(A.totals.consumption)}</td><td>${man(A.totals.savingsInvest)}</td><td>${pct(A.totals.rate, 0)}</td></tr></tfoot></table>
    </section>
    <section class="card span2"><div class="card-h"><h2>월말 순자산</h2><span class="muted">${man(A.totals.netWorthEnd)}</span></div>
      <svg class="chart" viewBox="0 0 320 120" preserveAspectRatio="none">${A.months.map((m, i) => { const h = m.empty ? 0 : (Math.max(0, m.netWorth) / max) * 96; return `<rect class="b-nw" x="${i * 26.6 + 6}" y="${104 - h}" width="15" height="${h}" rx="2"/><text x="${i * 26.6 + 13.5}" y="117">${i + 1}</text>`; }).join("")}</svg>
    </section>
    <section class="card span2"><div class="card-h"><h2>투자 계획 대비 (${y})</h2></div>
      <table class="tbl"><thead><tr><th>자산</th><th>계획</th><th>실제</th><th>달성</th><th>비중</th></tr></thead><tbody>
      ${A.assets.filter((a) => a.plan || a.actual || a.value).map((a) => `<tr><td>${esc(a.name)}</td><td>${man(a.plan)}</td><td>${man(a.actual)}</td><td>${pct(a.achieve, 0)}</td><td>${pct(a.weight, 0)}${a.planWeight ? `<small> / ${pct(a.planWeight, 0)}</small>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">기록 없음</td></tr>`}
      </tbody></table><p class="hint">비중: 현재 평가 / 2026 계획(참고값)</p>
    </section>
  </main>`;
}

// ------------------------------------------------------------------ 내역
function viewTx() {
  const ym = app.ym, s = monthSummary(app.ctx, ym);
  let list = (app.ctx.txByMonth[ym] || []).slice().reverse();
  const f = app.txFilter;
  if (f !== "all") list = list.filter((t) => t.type === f);
  const groups = {};
  for (const t of list) (groups[t.date] ||= []).push(t);
  const chips = [["all", "전체"], ["income", "수입"], ["expense", "지출"], ["transfer", "이체"]];
  return header("") + `<main class="stack">
    <section class="card summary3"><div><span class="label">수입</span><b class="income">${man(s.income)}</b></div><div><span class="label">지출</span><b class="expense">${man(s.fixed + s.variable)}</b></div><div><span class="label">이체</span><b>${man(s.transfers + s.rebalSave + s.rebalInv)}</b></div></section>
    <div class="chips">${chips.map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-act="txFilter" data-f="${k}">${l}</button>`).join("")}</div>
    ${Object.keys(groups).length ? Object.entries(groups).map(([d, ts]) => `<section class="card list"><div class="list-h">${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 ${"일월화수목금토"[new Date(d + "T00:00").getDay()]}요일</div>
      ${ts.map(txRow).join("")}</section>`).join("") : `<section class="card empty"><p>이번 달 거래가 없습니다</p><button class="btn" data-act="quickAdd">거래 입력</button></section>`}
  </main>`;
}
function txRow(t) {
  const c = app.ctx.cat[t.categoryId];
  let title, sub, amt, cls;
  if (t.type === "transfer") { title = `${accName(t.from)} → ${accName(t.to)}`; sub = t.tag === "alloc" ? "월급 배분" : t.tag === "rebal" ? "목표 초과 재배분" : "이체"; amt = fmt(t.amount); cls = "transfer"; }
  else if (t.type === "income") { title = c?.name ?? "(삭제된 항목)"; sub = accName(t.to); amt = "+" + fmt(t.amount); cls = "income"; }
  else { title = c?.name ?? "(삭제된 항목)"; sub = `${accName(t.from)} · ${c ? CAT_KINDS[c.kind] : ""}`; amt = "−" + fmt(t.amount); cls = "expense"; }
  return `<button class="row" data-act="editTx" data-id="${t.id}"><span class="dot ${cls}">${esc((title || "?").slice(0, 1))}</span>
    <span class="row-main"><b>${esc(title)}</b><small>${esc(sub)}${t.memo ? " · " + esc(t.memo) : ""}</small></span><span class="row-amt ${cls}">${amt}</span></button>`;
}

// ------------------------------------------------------------------ 통장
function viewAccounts() {
  const ctx = app.ctx, ym = app.ym, al = allocation(ctx, ym), rb = rebalance(ctx, ym);
  const rbMap = Object.fromEntries(rb.rows.map((r) => [r.id, r]));
  const pend = al.pending;
  const cards = ctx.accounts.map((a) => {
    const r = al.rows.find((x) => x.id === a.id), b = rbMap[a.id];
    const bal = accountSeries(ctx, a.id)[ym];
    const balance = bal ? bal.end : null;
    const target = a.target != null && a.target !== "" ? Number(a.target) : null;
    const prog = target ? Math.min(1, Math.max(0, (balance || 0) / target)) : null;
    const excess = b?.excess || 0;
    return `<section class="card acc">
      <div class="acc-h"><div><b>${esc(a.name)}</b><small>${esc(a.inst || "")} · ${ACCOUNT_TYPES[a.type]}</small></div>
        <div class="acc-bal">${a.type === "invest" ? `<small>평가는 자산 탭</small>` : `<b>${won(balance)}</b><small>${bal?.estimated ? "추정 잔액" : "확인 잔액"}</small>`}</div></div>
      ${target ? `<div class="progress"><i style="width:${prog * 100}%" class="${excess > 0 ? "over" : ""}"></i></div><div class="acc-meta"><span>목표 ${man(target)} · ${pct(prog, 0)}</span>${excess > 0 ? `<span class="neg">초과 ${man(excess)}</span>` : ""}</div>` : ""}
      ${r ? `<div class="acc-alloc"><div><small>배분 예정</small><b>${won(r.recommended)}</b>${r.base !== r.recommended ? `<small class="neg">기준 ${man(r.base)}</small>` : `<small>${METHODS[r.method]}${r.method === "ratio" ? " " + pct(r.value, 0) : ""}${r.note ? " · " + esc(r.note) : ""}</small>`}</div>
        <div><small>실제 이체</small><b class="${r.done ? "ok" : ""}">${won(r.actual)}</b></div>
        ${r.done ? `<button class="btn ghost sm" data-act="allocView" data-id="${a.id}">${I.check} 완료</button>`
          : `<button class="btn sm" data-act="allocDo" data-id="${a.id}" ${al.income ? "" : "disabled"}>이체 완료</button>`}</div>` : ""}
    </section>`;
  }).join("");
  const rbRows = rb.rows.filter((r) => r.excess > 0);
  return header("") + `<main class="grid">
    <section class="card span2 alloc-sum">
      <div class="kv"><span>월급(실수령)</span><b>${won(al.salary)}</b></div>
      <div class="kv"><span>추가수입</span><b>${won(al.extra)}</b></div>
      <div class="kv"><span>카드값·고정비 ${al.pendingFixed ? `<small>(미입력 ${man(al.pendingFixed)} 포함)</small>` : ""}</span><b class="expense">−${fmt(al.deduct)}</b></div>
      <div class="kv total"><span>배분 가용액</span><b>${won(al.avail)}</b></div>
      ${al.shortfall > 0 ? `<p class="warn-box">가용액이 부족해 우선순위가 낮은 통장부터 ${won(al.shortfall)}을 줄였습니다.</p>` : al.income ? `<p class="hint">배분 후 잔여 ${won(al.unallocated)} · 규칙 1-1: 잔액 0 통장 보충에 활용</p>` : ""}
      <div class="btn-row">
        <button class="btn" data-act="allocAll" ${al.income && al.rows.some((r) => r.recommended > 0 && !r.done) ? "" : "disabled"}>남은 배분 모두 완료</button>
        <button class="btn ghost" data-act="snapSheet">잔액 확인</button>
        ${pend.length ? `<button class="btn ghost" data-act="fixedSheet">고정지출 ${pend.length}건</button>` : ""}
      </div>
    </section>
    ${rbRows.length ? `<section class="card span2"><div class="card-h"><h2>목표 초과 재배분</h2><span class="muted">저축 ${pct(rb.ratio, 0)} · 투자 ${pct(1 - rb.ratio, 0)}${rb.emReached ? " (비상금 목표 달성 후)" : " (비상금 목표 전)"}</span></div>
      ${rbRows.map((r) => `<div class="rb-row"><div><b>${esc(r.name)}</b><small>초과 ${won(r.excess)}</small></div><div class="rb-split"><span>→ ${esc(accName(rb.saveTo))} ${man(r.toSave)}</span><span>→ ${esc(accName(rb.invTo))} ${man(r.toInv)}</span></div><button class="btn sm" data-act="rebalDo" data-id="${r.id}">재배분 완료</button></div>`).join("")}
    </section>` : ""}
    ${cards}
  </main>`;
}

// ------------------------------------------------------------------ 자산
function viewAssets() {
  const ctx = app.ctx, ym = app.ym, s = monthSummary(ctx, ym);
  const groups = {};
  for (const a of s.assets) if (a.value) groups[a.group] = (groups[a.group] || 0) + a.value;
  const total = s.investValue || 0;
  const palette = { vr: "var(--c-vr)", growth: "var(--c-growth)", dividend: "var(--c-div)", gold: "var(--c-gold)", pension: "var(--c-pen)", crypto: "var(--c-crypto)", cash: "var(--c-cash)", other: "var(--c-other)" };
  return header("") + `<main class="grid">
    <section class="card hero span2 nw"><div><div class="label">순자산</div><div class="big">${won(s.netWorth)}</div>
      <div class="sub">현금성 ${man(s.cash)} · 투자 ${man(s.investValue)}${s.debt ? ` · 부채 ${man(s.debt)}` : ""} · 전월 대비 ${signed(s.netWorthChange, man)}</div></div></section>
    ${stat("이번 달 신규 투자금", won(s.investInflow), "투자계좌로 새로 들어온 돈", "invest")}
    ${stat("평가손익", s.gain == null ? "–" : signed(s.gain) + "원", "평가액 변화 − 신규 투자금", s.gain < 0 ? "expense" : s.gain > 0 ? "income" : "")}
    ${stat("배당 수입", won(s.dividend), `올해 ${man(yearToDate(ctx, ym, "dividend"))}`, "")}
    ${stat("연간 신규 투자", man(yearToDate(ctx, ym, "investInflow")), `신규 매수 ${man(yearToDate(ctx, ym, "newBuy"))}`, "")}
    <section class="card span2"><div class="card-h"><h2>VR (TQQQ)</h2><span class="muted">비중 ${pct(s.vrWeight)}</span></div>
      <div class="kv"><span>평가액 (Pool 포함)</span><b>${won(s.vrValue)}</b></div>
      <div class="kv"><span>현금 Pool</span><b>${won(s.assets.find((a) => a.group === "vr" && /pool/i.test(a.name))?.value)}</b></div>
      <div class="kv"><span>이번 달 투입</span><b>${won(s.vrNew)}</b></div>
    </section>
    <section class="card span2"><div class="card-h"><h2>투자자산</h2><button class="link" data-act="investSheet">월말 기록</button></div>
      ${total ? `<div class="stackbar">${Object.entries(groups).map(([g, v]) => `<i style="width:${(v / total) * 100}%;background:${palette[g]}" title="${ASSET_GROUPS[g]}"></i>`).join("")}</div>
      <div class="legend wrap">${Object.entries(groups).map(([g, v]) => `<span><i style="background:${palette[g]}"></i>${ASSET_GROUPS[g]} ${pct(v / total, 0)}</span>`).join("")}</div>` : `<p class="muted">월말 평가액을 기록하면 비중과 손익이 계산됩니다.</p>`}
      <ul class="asset-list">${s.assets.map((a) => `<li><div><b>${esc(a.name)}</b><small>${a.plan ? `계획 ${man(a.plan)} · 매수 ${man(a.newAmount)}${a.newAmount >= a.plan ? " ✓" : ""}` : a.newAmount ? `매수 ${man(a.newAmount)}` : "&nbsp;"}</small></div>
        <div class="r"><b>${a.value == null ? "–" : won(a.value)}</b><small class="${a.change > 0 ? "income" : a.change < 0 ? "expense" : ""}">${a.value == null ? "" : a.actual ? `전월 대비 ${signed(a.change, man)}` : "이월값"}</small></div></li>`).join("")}</ul>
    </section>
  </main>`;
}

// ------------------------------------------------------------------ 설정
function viewSettings() {
  const sub = app.route.split("/")[1];
  if (sub === "rules") return pageRules();
  if (sub === "accounts") return pageList("accounts");
  if (sub === "categories") return pageList("categories");
  if (sub === "assets") return pageList("assets");
  if (sub === "templates") return pageList("templates");
  if (sub === "data") return pageData();
  if (sub === "sync") return pageSync();
  const last = app.lastBackup ? new Date(app.lastBackup).toLocaleDateString("ko-KR") : "없음";
  const item = (to, t, d) => `<button class="row" data-act="go" data-to="settings/${to}"><span class="row-main"><b>${t}</b><small>${d}</small></span>${I.right}</button>`;
  return header("설정", { month: false }) + `<main class="stack">
    <section class="card list">${item("rules", "배분 규칙", "급여일 · 재배분 비율 · IRP 한도 · 시작일")}${item("accounts", "통장", `${app.state.accounts.length}개 · 추가·삭제·순서`)}${item("categories", "수입·지출 항목", "카테고리별 추가·삭제·순서")}${item("assets", "투자자산", "VR · 우량주 · 배당주 · 계획")}${item("templates", "고정지출 템플릿", "매월 반복 지출")}</section>
    <section class="card list">${item("data", "데이터", `백업 · Excel/CSV · 가져오기 · 초기화`)}${item("sync", "동기화", app.sync.signedIn ? `${esc(app.sync.session.user.email)} · ${app.syncState === "err" ? "오류" : "연결됨"}` : "꺼짐 (이 기기에만 저장)")}</section>
    <p class="hint center">데이터는 이 기기에 자동 저장됩니다 · 시작일 ${esc(app.state.settings.startDate)}</p>
  </main>`;
}

function pageRules() {
  const s = app.state.settings, accs = app.state.accounts;
  const opt = (list, v) => list.map((a) => `<option value="${a.id}" ${a.id === v ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  return header("배분 규칙", { month: false, back: "settings" }) + `<main class="stack"><form class="card form" id="rulesForm">
    ${fRow("급여일", `<input name="payday" inputmode="numeric" value="${s.payday}">`)}
    ${fRow("비율 배분 기준", `<select name="basis"><option value="salary" ${s.basis === "salary" ? "selected" : ""}>월급(실수령)</option><option value="income" ${s.basis === "income" ? "selected" : ""}>총수입</option></select>`)}
    ${fRow("미입력 고정지출 차감", toggle("deductPendingFixed", s.deductPendingFixed), "배분 가용액 계산 시 아직 입력 안 된 고정비를 미리 뺌")}
    <h3>목표 초과 재배분</h3>
    ${fRow("비상금 통장", `<select name="emergencyId">${opt(accs, s.emergencyId)}</select>`, "목표금액은 통장 설정에서")}
    ${fRow("목표 전 저축 비율", `<input name="preRatio" inputmode="decimal" value="${s.preRatio * 100}"><em>%</em>`, "기존 규칙 80 (나머지 투자)")}
    ${fRow("목표 후 저축 비율", `<input name="postRatio" inputmode="decimal" value="${s.postRatio * 100}"><em>%</em>`, "기존 규칙 50 또는 30")}
    ${fRow("저축 몫 입금", `<select name="saveTargetId">${opt(accs, s.saveTargetId)}</select>`)}
    ${fRow("투자 몫 입금", `<select name="invTargetId">${opt(accs, s.invTargetId)}</select>`)}
    <h3>IRP</h3>
    ${fRow("IRP 통장", `<select name="irpAccountId">${opt(accs, s.irpAccountId)}</select>`)}
    ${fRow("연간 납입 한도(회)", `<input name="irpLimit" inputmode="numeric" value="${s.irpLimit}">`)}
    ${fRow("한도 후 합산 통장", `<select name="irpToId">${opt(accs, s.irpToId)}</select>`)}
    <h3>기타</h3>
    ${fRow("이체 절사 단위", `<input name="unit" inputmode="numeric" value="${s.unit}"><em>원</em>`)}
    ${fRow("잔액 미확인 시 이체=소비", toggle("fallback", s.fallback), "끄면 월말 잔액 확인 때 소비통장 사용액을 계산")}
    ${fRow("시작일", `<input type="date" name="startDate" value="${s.startDate}">`)}
    <button class="btn block" data-act="saveRules" type="button">저장</button>
  </form></main>`;
}
const fRow = (label, input, hint = "") => `<label class="frow"><span class="fl">${label}${hint ? `<small>${hint}</small>` : ""}</span><span class="fi">${input}</span></label>`;
const toggle = (name, on) => `<input type="checkbox" class="switch" name="${name}" ${on ? "checked" : ""}>`;

const LIST_META = {
  accounts: { title: "통장", sub: (a) => `${ACCOUNT_TYPES[a.type]} · ${METHODS[a.method]}${a.method === "ratio" ? " " + pct(a.value, 0) : a.method === "fixed" ? " " + man(a.value) : ""}${a.target ? ` · 목표 ${man(a.target)}` : ""} · 순위 ${a.priority}` },
  categories: { title: "수입·지출 항목", sub: (c) => `${c.group || ""}${c.salary ? " · 월급" : ""}` },
  assets: { title: "투자자산", sub: (a) => `${ASSET_GROUPS[a.group]} · ${PLAN_MODES[a.planMode]}${a.planMode === "annual" ? ` · 연 ${man(a.annual)} · 월 ${man(assetBaseAmount(a))}${a.rate ? ` (+${pct(a.rate, 0)}/월)` : ""}` : ""}` },
  templates: { title: "고정지출 템플릿", sub: (t) => `${t.day ? t.day + "일" : "말일"} · ${t.amount ? won(t.amount) : "금액 매월 입력"} · ${t.pay === "card" ? "카드(카드대금에 포함)" : "계좌"}${t.active ? "" : " · 꺼짐"}` },
};
function pageList(col) {
  const meta = LIST_META[col];
  let items = app.state[col];
  let seg = "";
  if (col === "categories") {
    items = items.filter((c) => c.kind === app.catKind);
    seg = `<div class="seg">${Object.entries(CAT_KINDS).map(([k, l]) => `<button class="${app.catKind === k ? "on" : ""}" data-act="catKind" data-k="${k}">${l}</button>`).join("")}</div>`;
  }
  const name = (x) => col === "templates" ? catName(x.categoryId) : x.name;
  return header(meta.title, { month: false, back: "settings" }) + `<main class="stack">${seg}
    <section class="card list">${items.map((x, i) => `<div class="row edit"><button class="row-main" data-act="editItem" data-col="${col}" data-id="${x.id}"><b>${esc(name(x))}</b><small>${esc(meta.sub(x))}</small></button>
      <span class="ord"><button class="icon-btn" data-act="move" data-col="${col}" data-id="${x.id}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="위로">${I.up}</button><button class="icon-btn" data-act="move" data-col="${col}" data-id="${x.id}" data-d="1" ${i === items.length - 1 ? "disabled" : ""} aria-label="아래로">${I.down}</button></span></div>`).join("") || `<p class="muted pad">항목이 없습니다</p>`}</section>
    <button class="btn block" data-act="editItem" data-col="${col}">+ 추가</button>
    ${col === "accounts" ? `<p class="hint">우선순위 숫자가 작을수록 먼저 배분됩니다. 수입이 부족하면 숫자가 큰 통장부터 줄어듭니다. 화살표는 화면 표시 순서입니다.</p>` : ""}
  </main>`;
}

function pageData() {
  return header("데이터", { month: false, back: "settings" }) + `<main class="stack">
    <section class="card list">
      <button class="row" data-act="backup"><span class="row-main"><b>전체 백업 (JSON)</b><small>모든 데이터·설정을 파일로 저장 · 복원 가능</small></span></button>
      <label class="row file"><span class="row-main"><b>백업에서 복원</b><small>현재 데이터를 백업 파일 내용으로 교체</small></span><input type="file" accept=".json,application/json" data-file="restore"></label>
    </section>
    <section class="card list">
      <button class="row" data-act="exportXlsx"><span class="row-main"><b>Excel 내보내기</b><small>월별요약 · 거래내역 · 투자기록 · 잔액 · 통장설정</small></span></button>
      <button class="row" data-act="exportCsv"><span class="row-main"><b>거래내역 CSV</b><small>Google Sheets·Numbers용</small></span></button>
      <label class="row file"><span class="row-main"><b>CSV 가져오기</b><small>앱 CSV 또는 기존 스프레드시트 원장(날짜·항목·금액·출금통장·메모)</small></span><input type="file" accept=".csv,text/csv" data-file="importCsv"></label>
    </section>
    <section class="card list">
      <button class="row danger" data-act="resetData"><span class="row-main"><b>제로셋팅</b><small>거래·잔액·투자 기록 삭제 · 통장/항목/규칙은 유지</small></span></button>
      <button class="row danger" data-act="resetAll"><span class="row-main"><b>전체 초기화</b><small>규칙까지 기본값으로</small></span></button>
    </section>
    <p class="hint">동기화를 쓰지 않는다면 한 달에 한 번 백업 파일을 iCloud Drive에 저장해 두세요.</p>
  </main>`;
}

function pageSync() {
  const c = app.sync.cfg || {}, si = app.sync.signedIn;
  return header("동기화", { month: false, back: "settings" }) + `<main class="stack">
    <section class="card form"><h3>1. Supabase 연결</h3>
      ${fRow("Project URL", `<input name="url" placeholder="https://xxxx.supabase.co" value="${esc(c.url || "")}" autocapitalize="off" autocorrect="off" spellcheck="false">`)}
      ${fRow("Publishable key", `<input name="anon" placeholder="sb_publishable_..." value="${esc(c.anonKey || "")}" autocapitalize="off" autocorrect="off" spellcheck="false">`)}
      ${fRow("종단간 암호화", toggle("e2e", c.useEncryption !== false), "서버에는 암호문만 저장 (권장)")}
      <button class="btn block ghost" data-act="syncSave">연결 정보 저장</button>
      <details><summary>최초 1회: 데이터베이스 SQL</summary><textarea readonly rows="8" class="code">${esc(SUPABASE_SQL)}</textarea><button class="btn sm ghost" data-act="copySql">SQL 복사</button></details>
    </section>
    <section class="card form"><h3>2. 로그인</h3>
      ${si ? `<p>${esc(app.sync.session.user.email)} 로그인됨</p><button class="btn ghost block" data-act="signOut">로그아웃</button>` : `
      ${fRow("이메일", `<input name="email" type="email" autocomplete="username">`)}
      ${fRow("비밀번호", `<input name="pw" type="password" autocomplete="current-password">`)}
      <div class="btn-row"><button class="btn" data-act="signIn">로그인</button><button class="btn ghost" data-act="signUp">회원가입</button></div>`}
    </section>
    ${si && c.useEncryption !== false ? `<section class="card form"><h3>3. 암호화 비밀번호</h3><p class="hint">모든 기기에 같은 비밀번호를 입력합니다. 분실 시 서버 데이터는 복구할 수 없습니다(기기 데이터는 유지).</p>
      ${fRow("비밀번호", `<input name="pass" type="password" autocomplete="new-password">`)}<button class="btn block ghost" data-act="setPass">${app.sync.key ? "다시 설정" : "설정"}</button></section>` : ""}
    <section class="card form"><button class="btn block" data-act="syncNow" ${si ? "" : "disabled"}>${I.sync} 지금 동기화</button>
      <p class="hint center">${app.syncError ? "최근 오류: " + esc(app.syncError) : ""}</p></section>
  </main>`;
}

// ------------------------------------------------------------------ sheets
function openSheet(title, body, { onMount, wide = false } = {}) {
  closeSheet();
  const el = document.createElement("div");
  el.className = "sheet-wrap";
  el.innerHTML = `<div class="backdrop" data-act="closeSheet"></div><div class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true"><div class="grab"></div>
    <div class="sheet-h"><h2>${title}</h2><button class="icon-btn" data-act="closeSheet" aria-label="닫기">${I.x}</button></div><div class="sheet-b">${body}</div></div>`;
  document.body.appendChild(el);
  document.body.classList.add("noscroll");
  requestAnimationFrame(() => el.classList.add("open"));
  app.sheet = el;
  onMount?.(el);
  return el;
}
function closeSheet() { if (app.sheet) { app.sheet.remove(); app.sheet = null; document.body.classList.remove("noscroll"); } }

function amountInput(name, value, big = false) {
  return `<input class="amount ${big ? "big" : ""}" name="${name}" inputmode="numeric" autocomplete="off" placeholder="0" value="${value ? fmt(value) : ""}">`;
}
function bindAmounts(root) {
  $$("input.amount", root).forEach((inp) => inp.addEventListener("input", () => {
    const n = parseNum(inp.value); const pos = inp.value.length - inp.selectionStart;
    inp.value = n == null ? "" : Math.floor(n).toLocaleString("ko-KR");
    const p = Math.max(0, inp.value.length - pos); inp.setSelectionRange(p, p);
  }));
}

// 빠른 입력
const QTYPES = [["expense", "지출"], ["income", "수입"], ["transfer", "이체"], ["invest", "투자"], ["other", "기타"]];
function quickAdd(type = "expense", tx = null) {
  const st = app.state, pay = st.accounts.find((a) => a.type === "pay")?.id;
  const today = todayStr();
  const editing = !!tx;
  if (tx) type = tx.type === "transfer" ? (app.ctx.acc[tx.to]?.type === "invest" ? "invest" : "transfer") : tx.type;
  const d = tx || { date: app.ym === ymOf(today) ? today : `${app.ym}-${String(Math.min(st.settings.payday, lastDay(app.ym))).padStart(2, "0")}`, from: pay, to: pay };
  const body = `<form class="qa" id="qa" data-type="${type}">
    ${editing ? "" : `<div class="seg qa-seg">${QTYPES.map(([k, l]) => `<button type="button" class="${k === type ? "on" : ""}" data-qt="${k}">${l}</button>`).join("")}</div>`}
    <div class="qa-body"></div></form>`;
  const el = openSheet(editing ? "거래 수정" : "거래 입력", body, { onMount: (root) => {
    const draw = (t) => {
      $("#qa", root).dataset.type = t;
      $$(".qa-seg button", root).forEach((b) => b.classList.toggle("on", b.dataset.qt === t));
      $(".qa-body", root).innerHTML = qaBody(t, d, editing);
      bindAmounts(root);
      wireQa(root, t, d, editing);
      if (!editing && t !== "other") setTimeout(() => $("input.amount", root)?.focus(), 60);
    };
    $$(".qa-seg button", root).forEach((b) => b.addEventListener("click", () => draw(b.dataset.qt)));
    draw(type);
  } });
  return el;
}
function accOptions(filter, sel) { return app.state.accounts.filter(filter).map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.name)}</option>`).join(""); }
function qaBody(t, d, editing) {
  const st = app.state;
  if (t === "other") return `<div class="choice">
      <button type="button" class="row" data-other="snap"><span class="row-main"><b>잔액 확인</b><small>통장 실제 잔액 입력 → 소비통장 사용액 자동 계산</small></span>${I.right}</button>
      <button type="button" class="row" data-other="fixed"><span class="row-main"><b>고정지출 일괄 입력</b><small>이번 달 미입력 ${pendingTemplates(app.ctx, app.ym).length}건</small></span>${I.right}</button>
      <button type="button" class="row" data-other="invest"><span class="row-main"><b>투자 월말 기록</b><small>신규 매수 · 평가액 · 배당</small></span>${I.right}</button>
      <button type="button" class="row" data-other="fin"><span class="row-main"><b>이자·환급 등 기타 수입</b><small>금융수입 항목으로 수입 입력</small></span>${I.right}</button></div>`;
  const kinds = t === "income" ? ["income"] : ["variable", "fixed"];
  const isTr = t === "transfer" || t === "invest";
  const recent = isTr ? [] : recentCategories(st, kinds, 8);
  const all = st.categories.filter((c) => kinds.includes(c.kind));
  const toList = t === "invest" ? st.accounts.filter((a) => a.type === "invest") : st.accounts;
  const cid = d.categoryId || recent[0]?.id || all[0]?.id;
  return `<div class="amount-wrap">${amountInput("amount", d.amount, true)}<span>원</span></div>
    <div class="hint-amt" data-hint></div>
    ${isTr ? `<div class="label-s">${t === "invest" ? "투자 계좌" : "받는 통장"}</div><div class="chips wrap" data-pick="to">${toList.filter((a) => t === "invest" || a.id !== d.from || editing).map((a) => `<button type="button" class="chip ${a.id === (d.to !== d.from ? d.to : null) ? "on" : ""}" data-v="${a.id}">${esc(a.name)}</button>`).join("")}</div>`
    : `<div class="label-s">${recent.some((r) => r.lastAmount) ? "최근·자주 쓰는 항목" : "항목"}</div><div class="chips wrap" data-pick="cat">${recent.map((c) => `<button type="button" class="chip ${c.id === cid ? "on" : ""}" data-v="${c.id}" data-last="${c.lastAmount ?? ""}">${esc(c.name)}</button>`).join("")}
      <button type="button" class="chip more" data-more>전체 ▾</button></div>
      <div class="chips wrap hidden" data-all>${all.filter((c) => !recent.some((r) => r.id === c.id)).map((c) => `<button type="button" class="chip ${c.id === cid ? "on" : ""}" data-v="${c.id}">${esc(c.name)}</button>`).join("")}</div>`}
    <div class="qa-fields">
      ${fRow("날짜", `<input type="date" name="date" value="${d.date}">`)}
      ${t === "income" ? fRow("입금 통장", `<select name="to">${accOptions(() => true, d.to)}</select>`)
        : fRow(isTr ? "보내는 통장" : "출금 통장", `<select name="from">${accOptions(() => true, d.from)}</select>`)}
      ${fRow("메모", `<input name="memo" value="${esc(d.memo || "")}" placeholder="선택">`)}
    </div>
    ${t === "expense" ? `<p class="hint">카드 사용분은 입력하지 않고 결제일에 카드대금만 입력합니다.</p>` : ""}
    <div class="sheet-actions">${editing ? `<button type="button" class="btn ghost danger" data-qa="del">삭제</button>` : ""}<button type="button" class="btn primary" data-qa="save">저장</button></div>`;
}
function wireQa(root, t, d, editing) {
  const pick = { cat: d.categoryId || $('[data-pick="cat"] .chip.on', root)?.dataset.v, to: d.to !== d.from ? d.to : null };
  const hint = () => { const c = $('[data-pick="cat"] .chip.on', root); const h = $("[data-hint]", root); if (h) h.innerHTML = c?.dataset.last ? `<button type="button" class="chip ghost" data-fill="${c.dataset.last}">지난번 ${fmt(Number(c.dataset.last))}원</button>` : ""; };
  root.querySelectorAll("[data-pick] .chip[data-v], [data-all] .chip").forEach((b) => b.addEventListener("click", () => {
    const grp = b.closest("[data-pick]")?.dataset.pick || "cat";
    $$(grp === "cat" ? '[data-pick="cat"] .chip, [data-all] .chip' : `[data-pick="${grp}"] .chip`, root).forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); pick[grp] = b.dataset.v; hint();
  }));
  $("[data-more]", root)?.addEventListener("click", (e) => { $("[data-all]", root).classList.toggle("hidden"); e.target.textContent = $("[data-all]", root).classList.contains("hidden") ? "전체 ▾" : "접기 ▴"; });
  root.addEventListener("click", (e) => { const f = e.target.closest("[data-fill]"); if (f) { const i = $("input.amount", root); i.value = fmt(Number(f.dataset.fill)); } });
  hint();
  $$("[data-other]", root).forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.other;
    if (k === "snap") snapSheet(); else if (k === "fixed") fixedSheet(); else if (k === "invest") investSheet();
    else quickAdd("income", null) && setTimeout(() => { const fin = app.state.categories.find((c) => c.group === "금융수입"); if (fin) $(`[data-v="${fin.id}"]`, app.sheet)?.click(); }, 30);
  }));
  $('[data-qa="save"]', root)?.addEventListener("click", async () => {
    const amount = parseNum($("input.amount", root).value);
    if (!amount || amount <= 0) return toast("금액을 입력하세요");
    const date = $('[name="date"]', root).value || todayStr();
    const memo = $('[name="memo"]', root).value.trim();
    let rec;
    const base = editing ? { ...d } : {};
    if (t === "transfer" || t === "invest") {
      const from = $('[name="from"]', root).value, to = pick.to;
      if (!to) return toast("받는 통장을 선택하세요");
      if (to === from) return toast("같은 통장으로는 이체할 수 없습니다");
      rec = { ...base, type: "transfer", date, amount, from, to, memo, categoryId: undefined };
    } else {
      const cid = pick.cat || $('[data-pick="cat"] .chip.on, [data-all] .chip.on', root)?.dataset.v;
      if (!cid) return toast("항목을 선택하세요");
      rec = t === "income" ? { ...base, type: "income", date, amount, to: $('[name="to"]', root).value, categoryId: cid, memo, from: undefined }
        : { ...base, type: "expense", date, amount, from: $('[name="from"]', root).value, categoryId: cid, memo, to: undefined };
    }
    const saved = await app.store.put("transactions", rec);
    closeSheet();
    if (ymOf(date) !== app.ym) app.ym = ymOf(date), refresh();
    toast(editing ? "수정했습니다" : `${won(amount)} 저장`, editing ? null : async () => { await app.store.remove("transactions", saved.id); toast("취소했습니다"); });
  });
  $('[data-qa="del"]', root)?.addEventListener("click", async () => {
    await app.store.remove("transactions", d.id); closeSheet();
    toast("삭제했습니다", async () => { await app.store.put("transactions", d); });
  });
}

// 잔액 확인(스냅숏)
function snapSheet() {
  const ctx = app.ctx, ym = app.ym;
  const accs = ctx.accounts.filter((a) => a.type !== "invest");
  const body = `<p class="hint">통장 앱에서 보이는 실제 잔액을 입력하세요. 빈칸은 저장하지 않습니다. 소비통장(${accs.filter((a) => a.type === "spend").map((a) => esc(a.name)).join("·")})은 예상 잔액과의 차이가 이번 달 사용액이 됩니다.</p>
    <form class="form" id="snapForm">${accs.map((a) => {
      const ser = accountSeries(ctx, a.id)[ym];
      return fRow(`${esc(a.name)}<small>${ser ? (ser.snap != null ? "확인 " + fmt(ser.snap) : "예상 " + fmt(ser.end)) : ""}</small>`, amountInput(a.id, ser?.snap));
    }).join("")}</form>
    <div class="sheet-actions"><button class="btn primary" data-act="saveSnaps">${ymLabel(ym)} 잔액 저장</button></div>`;
  openSheet("잔액 확인", body, { onMount: bindAmounts });
}
async function saveSnaps() {
  const items = [], at = Date.now();
  for (const inp of $$("#snapForm input.amount", app.sheet)) {
    const v = parseNum(inp.value);
    if (v == null) continue;
    items.push(["snapshots", { id: `${inp.name}_${app.ym}`, accountId: inp.name, month: app.ym, amount: v, at }]);
  }
  if (!items.length) return toast("입력된 잔액이 없습니다");
  await app.store.putMany(items); closeSheet(); toast(`${items.length}개 통장 잔액 저장`);
}

// 고정지출 일괄 입력
function fixedSheet() {
  const ym = app.ym, pend = pendingTemplates(app.ctx, ym);
  const cardOnes = app.state.templates.filter((t) => t.active && t.pay === "card");
  const body = pend.length ? `<form class="form" id="fixedForm">${pend.map((t) => `<div class="frow fixed-row"><label class="fl"><input type="checkbox" name="on_${t.id}" ${t.amount ? "checked" : ""}> ${esc(catName(t.categoryId))}<small>${t.day ? t.day + "일" : "말일"}${t.memo ? " · " + esc(t.memo) : ""}</small></label><span class="fi">${amountInput("amt_" + t.id, t.amount)}</span></div>`).join("")}</form>
    ${cardOnes.length ? `<p class="hint">카드 결제(카드대금에 포함되어 제외): ${cardOnes.map((t) => esc(catName(t.categoryId))).join(", ")}</p>` : ""}
    <div class="sheet-actions"><button class="btn primary" data-act="saveFixed">선택 항목 저장</button></div>` : `<p class="muted pad">${ymLabel(ym)} 고정지출을 모두 입력했습니다.</p>`;
  openSheet(`${ymLabel(ym)} 고정지출`, body, { onMount: (r) => { bindAmounts(r); $$('input.amount', r).forEach((i) => i.addEventListener("input", () => { const cb = $(`[name="on_${i.name.slice(4)}"]`, r); if (cb && parseNum(i.value)) cb.checked = true; })); } });
}
async function saveFixed() {
  const ym = app.ym, pay = app.state.accounts.find((a) => a.type === "pay")?.id, items = [];
  for (const t of pendingTemplates(app.ctx, ym)) {
    if (!$(`[name="on_${t.id}"]`, app.sheet)?.checked) continue;
    const amt = parseNum($(`[name="amt_${t.id}"]`, app.sheet)?.value);
    if (!amt) continue;
    const day = Math.min(t.day || lastDay(ym), lastDay(ym));
    items.push(["transactions", { id: newId("tr_"), type: "expense", date: `${ym}-${String(day).padStart(2, "0")}`, amount: amt, categoryId: t.categoryId, from: t.from || pay, memo: t.memo || "", templateId: t.id }]);
  }
  if (!items.length) return toast("저장할 항목이 없습니다");
  await app.store.putMany(items); closeSheet(); toast(`고정지출 ${items.length}건 저장`);
}

// 투자 월말 기록
function investSheet() {
  const ctx = app.ctx, ym = app.ym, mon = app.state.months.find((x) => x.id === ym) || {};
  const rec = (id) => app.state.invest.find((x) => x.month === ym && x.assetId === id) || {};
  const s = monthSummary(ctx, ym);
  const body = `<p class="hint">신규 매수 = 이번 달 새로 넣은 원금 · 평가액 = 월말 평가(원 또는 USD) · 배당 = 세후 입금. 예수금·Pool도 평가액으로 입력하면 손익이 정확합니다.</p>
    <form class="form" id="invForm">
    ${fRow("USD 환율", `<input name="fx" inputmode="decimal" value="${mon.fx ?? ""}" placeholder="예: 1400">`)}
    ${fRow("부채(대출 등)", amountInput("debt", mon.debt))}
    ${ctx.assets.map((a) => { const r = rec(a.id), sa = s.assets.find((x) => x.id === a.id); return `<div class="inv-block"><div class="inv-h"><b>${esc(a.name)}</b><small>${sa?.plan ? "계획 " + man(sa.plan) : ""}${sa?.prevValue != null ? ` · 전월 ${man(sa.prevValue)}` : ""}</small></div>
      <div class="inv-grid"><label><small>신규 매수</small>${amountInput(`n_${a.id}`, r.newAmount)}</label><label><small>평가액(원)</small>${amountInput(`v_${a.id}`, r.value)}</label>
      <label><small>평가액(USD)</small><input name="u_${a.id}" inputmode="decimal" value="${r.valueUsd ?? ""}"></label><label><small>배당</small>${amountInput(`d_${a.id}`, r.dividend)}</label></div></div>`; }).join("")}
    </form><div class="sheet-actions"><button class="btn primary" data-act="saveInvest">${ymLabel(ym)} 저장</button></div>`;
  openSheet("투자 월말 기록", body, { onMount: bindAmounts, wide: true });
}
async function saveInvest() {
  const ym = app.ym, f = app.sheet, items = [];
  const fx = parseNum($('[name="fx"]', f).value), debt = parseNum($('[name="debt"]', f).value);
  items.push(["months", { id: ym, fx, debt }]);
  for (const a of app.ctx.assets) {
    const g = (p) => parseNum($(`[name="${p}_${a.id}"]`, f)?.value);
    const r = { id: `${a.id}_${ym}`, month: ym, assetId: a.id, newAmount: g("n"), value: g("v"), valueUsd: g("u"), dividend: g("d") };
    const exists = app.state.invest.some((x) => x.id === r.id);
    if (r.newAmount == null && r.value == null && r.valueUsd == null && r.dividend == null) { if (exists) items.push(["invest", { ...r }]); continue; }
    items.push(["invest", r]);
  }
  await app.store.putMany(items); closeSheet(); toast("투자 기록 저장");
}

// 배분 이체 완료
function allocDo(id) {
  const al = allocation(app.ctx, app.ym), r = al.rows.find((x) => x.id === id);
  const pay = app.state.accounts.find((a) => a.type === "pay")?.id;
  const date = defaultDate();
  openSheet(`${esc(r.name)} 이체 완료`, `<p class="hint">실제로 이체한 뒤에 저장하세요. 금액이 다르면 수정합니다.</p>
    <div class="amount-wrap">${amountInput("amount", r.recommended - r.actual > 0 ? r.recommended - r.actual : r.recommended, true)}<span>원</span></div>
    <form class="form">${fRow("날짜", `<input type="date" name="date" value="${date}">`)}${fRow("보내는 통장", `<select name="from">${accOptions((a) => a.type === "pay", pay)}</select>`)}</form>
    <div class="sheet-actions"><button class="btn primary" data-act="allocSave" data-id="${id}">이체 완료로 기록</button></div>`, { onMount: bindAmounts });
}
function defaultDate() { const t = todayStr(); return ymOf(t) === app.ym ? t : `${app.ym}-${String(Math.min(app.state.settings.payday, lastDay(app.ym))).padStart(2, "0")}`; }
async function allocSave(id) {
  const f = app.sheet, amount = parseNum($("input.amount", f).value);
  if (!amount) return toast("금액을 입력하세요");
  await app.store.put("transactions", { type: "transfer", date: $('[name="date"]', f).value, amount, from: $('[name="from"]', f).value, to: id, tag: "alloc", memo: "배분" });
  closeSheet(); toast(`${accName(id)} ${won(amount)} 이체 기록`);
}
function allocAll() {
  const al = allocation(app.ctx, app.ym), rows = al.rows.filter((r) => r.recommended > 0 && !r.done);
  openSheet("남은 배분 모두 완료", `<p class="hint">아래 금액을 모두 이체했을 때만 저장하세요. 날짜 ${defaultDate()}</p>
    <ul class="plain">${rows.map((r) => `<li><span>${esc(r.name)}</span><b>${won(r.recommended)}</b></li>`).join("")}</ul>
    <div class="kv total"><span>합계</span><b>${won(rows.reduce((s, r) => s + r.recommended, 0))}</b></div>
    <div class="sheet-actions"><button class="btn primary" data-act="allocAllSave">모두 이체 완료로 기록</button></div>`);
}
async function allocAllSave() {
  const al = allocation(app.ctx, app.ym), pay = app.state.accounts.find((a) => a.type === "pay")?.id, date = defaultDate();
  const items = al.rows.filter((r) => r.recommended > 0 && !r.done).map((r) => ["transactions", { id: newId("tr_"), type: "transfer", date, amount: r.recommended, from: pay, to: r.id, tag: "alloc", memo: "배분" }]);
  await app.store.putMany(items); closeSheet(); toast(`${items.length}건 이체 기록`);
}
function allocView(id) {
  const ts = (app.ctx.txByMonth[app.ym] || []).filter((t) => t.type === "transfer" && t.to === id && app.ctx.acc[t.from]?.type === "pay");
  openSheet(`${esc(accName(id))} 이체 내역`, `<section class="list">${ts.map(txRow).join("")}</section><div class="sheet-actions"><button class="btn ghost" data-act="allocDo" data-id="${id}">추가 이체</button></div>`);
}
async function rebalDo(id) {
  const rb = rebalance(app.ctx, app.ym), r = rb.rows.find((x) => x.id === id);
  openSheet(`${esc(r.name)} 재배분`, `<p class="hint">초과 ${won(r.excess)} · 저축 ${pct(rb.ratio, 0)} / 투자 ${pct(1 - rb.ratio, 0)}</p>
    <form class="form">${fRow(`→ ${esc(accName(rb.saveTo))}`, amountInput("save", r.toSave))}${fRow(`→ ${esc(accName(rb.invTo))}`, amountInput("inv", r.toInv))}${fRow("날짜", `<input type="date" name="date" value="${defaultDate()}">`)}</form>
    <div class="sheet-actions"><button class="btn primary" data-act="rebalSave" data-id="${id}">재배분 완료로 기록</button></div>`, { onMount: bindAmounts });
}
async function rebalSave(id) {
  const f = app.sheet, rb = rebalance(app.ctx, app.ym), date = $('[name="date"]', f).value;
  const items = [];
  const sv = parseNum($('[name="save"]', f).value), iv = parseNum($('[name="inv"]', f).value);
  if (sv) items.push(["transactions", { id: newId("tr_"), type: "transfer", date, amount: sv, from: id, to: rb.saveTo, tag: "rebal", memo: "재배분" }]);
  if (iv) items.push(["transactions", { id: newId("tr_"), type: "transfer", date, amount: iv, from: id, to: rb.invTo, tag: "rebal", memo: "재배분" }]);
  if (!items.length) return toast("금액이 없습니다");
  await app.store.putMany(items); closeSheet(); toast("재배분 기록");
}

// ------------------------------------------------------------------ 목록 편집
const FIELDS = {
  accounts: () => [
    ["name", "이름", "text"], ["inst", "기관", "text"], ["purpose", "용도", "text"],
    ["type", "유형", "select", ACCOUNT_TYPES], ["method", "배분 방식", "select", METHODS],
    ["value", "기준값", "value"], ["target", "목표잔액", "won", "비우면 목표 없음"], ["priority", "우선순위", "int", "작을수록 먼저 배분"],
    ["rebalance", "목표 초과 시 재배분", "bool"], ["opening", "시작 잔액", "won", `${app.state.settings.startDate} 기준 · 모르면 비움(첫 잔액 확인이 기준)`],
  ],
  categories: () => [["name", "이름", "text"], ["kind", "구분", "select", CAT_KINDS], ["group", "대분류", "text", "구독 · 카드대금 · 금융수입은 별도 집계"], ["salary", "월급 항목", "bool", "비율 배분 기준"]],
  assets: () => [["name", "이름", "text"], ["group", "분류", "select", ASSET_GROUPS],
    ["accountId", "연결 통장", "select", Object.fromEntries(app.state.accounts.map((a) => [a.id, a.name]))],
    ["planMode", "계획 방식", "select", PLAN_MODES], ["annual", "연간 계획", "won"], ["rate", "월 증액률", "pct", "1% → 1"],
    ["baseMonth", "기준월", "month"], ["baseAmount", "기준월 투자금", "won", "비우면 연간계획에서 자동 계산"]],
  templates: () => [["categoryId", "항목", "select", Object.fromEntries(app.state.categories.filter((c) => c.kind !== "income").map((c) => [c.id, c.name]))],
    ["day", "출금일", "int", "비우면 말일"], ["amount", "금액", "won", "비우면 매월 입력"], ["pay", "결제수단", "select", { account: "계좌 출금", card: "신용카드(카드대금에 포함)" }],
    ["from", "출금 통장", "select", { "": "급여통장(기본)", ...Object.fromEntries(app.state.accounts.map((a) => [a.id, a.name])) }], ["memo", "메모", "text"], ["active", "사용", "bool"]],
};
function editItem(col, id) {
  const cur = id ? app.state[col].find((x) => x.id === id) : null;
  const def = { accounts: { type: "save", method: "fixed", priority: 10, rebalance: false, opening: null },
    categories: { kind: app.catKind, group: "", salary: false }, assets: { group: "other", accountId: "acc_inv", planMode: "none" },
    templates: { pay: "account", active: true, categoryId: app.state.categories.find((c) => c.kind === "fixed")?.id } }[col];
  const x = cur || def;
  const body = `<form class="form" id="itemForm">${FIELDS[col]().map(([k, label, type, opt, hint]) => {
    if (typeof opt === "string") { hint = opt; opt = null; }
    let v = x[k], inp;
    if (type === "select") inp = `<select name="${k}">${Object.entries(opt).map(([ov, ol]) => `<option value="${ov}" ${String(v ?? "") === ov ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select>`;
    else if (type === "bool") inp = toggle(k, v);
    else if (type === "won") inp = amountInput(k, v);
    else if (type === "value") { const isR = x.method === "ratio"; inp = `<input name="${k}" inputmode="decimal" value="${v == null ? "" : isR ? +(v * 100).toFixed(4) : fmt(v)}"><em data-unit>${isR ? "%" : "원"}</em>`; hint = "비율이면 %, 정액이면 원"; }
    else if (type === "pct") inp = `<input name="${k}" inputmode="decimal" value="${v == null ? "" : +(v * 100).toFixed(4)}"><em>%</em>`;
    else if (type === "int") inp = `<input name="${k}" inputmode="numeric" value="${v ?? ""}">`;
    else if (type === "month") inp = `<input type="month" name="${k}" value="${v || ""}">`;
    else inp = `<input name="${k}" value="${esc(v ?? "")}">`;
    return fRow(label, inp, hint);
  }).join("")}</form>
  <div class="sheet-actions">${cur ? `<button class="btn ghost danger" data-act="delItem" data-col="${col}" data-id="${cur.id}">삭제</button>` : ""}<button class="btn primary" data-act="saveItem" data-col="${col}" data-id="${cur?.id || ""}">저장</button></div>`;
  openSheet(cur ? "편집" : "추가", body, { onMount: (r) => {
    bindAmounts(r);
    $('[name="method"]', r)?.addEventListener("change", (e) => { const u = $("[data-unit]", r); if (u) u.textContent = e.target.value === "ratio" ? "%" : "원"; });
  } });
}
async function saveItem(col, id) {
  const f = $("#itemForm", app.sheet), cur = id ? app.state[col].find((x) => x.id === id) : null;
  const out = cur ? { ...cur } : { order: app.state[col].length ? Math.max(...app.state[col].map((x) => x.order ?? 0)) + 1 : 0 };
  for (const [k, , type] of FIELDS[col]()) {
    const el = f.elements[k]; if (!el) continue;
    if (type === "bool") out[k] = el.checked;
    else if (type === "won" || type === "int") out[k] = parseNum(el.value);
    else if (type === "pct") { const n = parseNum(el.value); out[k] = n == null ? null : n / 100; }
    else if (type === "value") { const n = parseNum(el.value); out[k] = n == null ? null : f.elements.method.value === "ratio" ? n / 100 : n; }
    else out[k] = el.value === "" && k === "from" ? null : el.value;
  }
  if (col !== "templates" && !String(out.name || "").trim()) return toast("이름을 입력하세요");
  if (col === "templates" && !out.categoryId) return toast("항목을 선택하세요");
  if (col === "accounts" && out.method === "ratio" && out.value > 1) return toast("비율은 100% 이하로 입력하세요");
  if (col === "categories" && out.kind !== "income") out.salary = false;
  if (out.priority == null && col === "accounts") out.priority = 99;
  await app.store.put(col, out); closeSheet(); toast("저장했습니다");
}
function usage(col, id) {
  const st = app.state, s = st.settings;
  if (col === "accounts") {
    const n = st.transactions.filter((t) => t.from === id || t.to === id).length + st.snapshots.filter((x) => x.accountId === id).length;
    if (n) return `거래·잔액 기록 ${n}건에서 사용 중입니다. 이름을 바꾸거나 배분 방식을 '없음'으로 두세요.`;
    if ([s.emergencyId, s.saveTargetId, s.invTargetId, s.irpAccountId, s.irpToId].includes(id)) return "배분 규칙에서 사용 중인 통장입니다. 규칙을 먼저 바꾸세요.";
    if (st.accounts.find((a) => a.id === id)?.type === "pay" && st.accounts.filter((a) => a.type === "pay").length === 1) return "급여통장은 최소 1개 필요합니다.";
    if (st.assets.some((a) => a.accountId === id)) return "투자자산이 연결된 통장입니다.";
  }
  if (col === "categories") { const n = st.transactions.filter((t) => t.categoryId === id).length + st.templates.filter((t) => t.categoryId === id).length; if (n) return `거래·템플릿 ${n}건에서 사용 중입니다. 이름을 바꿔 쓰세요.`; }
  if (col === "assets") { const n = st.invest.filter((x) => x.assetId === id).length; if (n) return `투자 기록 ${n}건이 있습니다.`; }
  return null;
}
async function delItem(col, id) {
  const u = usage(col, id);
  if (u) return toast(u, null, 4000);
  const cur = app.state[col].find((x) => x.id === id);
  await app.store.remove(col, id); closeSheet();
  toast("삭제했습니다", async () => app.store.put(col, cur));
}
async function move(col, id, d) {
  let list = app.state[col];
  if (col === "categories") list = list.filter((c) => c.kind === app.catKind);
  const ids = list.map((x) => x.id), i = ids.indexOf(id), j = i + d;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  if (col === "categories") {           // 다른 구분 항목의 순서는 유지
    const others = app.state.categories.filter((c) => c.kind !== app.catKind).map((c) => c.id);
    await app.store.reorder(col, [...others, ...ids]);
  } else await app.store.reorder(col, ids);
}

// ------------------------------------------------------------------ 데이터
async function shareOrDownload(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Macintosh/.test(navigator.userAgent) && "ontouchend" in document) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const stamp = () => todayStr().replace(/-/g, "");
async function onFile(input) {
  const f = input.files?.[0]; if (!f) return;
  const text = await f.text(); input.value = "";
  try {
    if (input.dataset.file === "restore") {
      const obj = JSON.parse(text);
      if (!confirm("현재 데이터를 백업 파일 내용으로 교체합니다. 계속할까요?")) return;
      await app.store.importJSON(obj); toast("복원했습니다");
    } else {
      const r = importTransactionsCSV(text, app.state, { newId });
      if (!confirm(`거래 ${r.transactions.length}건${r.newCategories.length ? `, 새 항목 ${r.newCategories.length}개` : ""}를 가져옵니다.${r.errors.length ? `\n건너뜀 ${r.errors.length}건: ${r.errors.slice(0, 3).join(", ")}` : ""}`)) return;
      await app.store.putMany([...r.newCategories.map((c) => ["categories", c]), ...r.transactions.map((t) => ["transactions", t])]);
      toast(`${r.transactions.length}건 가져옴`);
    }
  } catch (e) { toast("실패: " + e.message, null, 4000); }
}

// ------------------------------------------------------------------ toast
let toastTimer;
function toast(msg, undo = null, ms = 2600) {
  let el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>실행취소</button>` : ""}`;
  el.classList.add("show");
  if (undo) el.querySelector("button").onclick = () => { el.classList.remove("show"); undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), undo ? 4500 : ms);
}

// ------------------------------------------------------------------ actions
const ACT = {
  go: (el) => { closeSheet(); location.hash = el.dataset.to; },
  month: (el) => { app.ym = addMonths(app.ym, Number(el.dataset.d)); refresh(); },
  monthToday: () => { app.ym = ymOf(todayStr()); refresh(); },
  pickMonth: (el) => { app.ym = el.dataset.ym; app.homeMode = "month"; refresh(); },
  homeMode: (el) => { app.homeMode = el.dataset.m; refresh(); },
  txFilter: (el) => { app.txFilter = el.dataset.f; refresh(); },
  catKind: (el) => { app.catKind = el.dataset.k; refresh(); },
  quickAdd: () => quickAdd(),
  editTx: (el) => { const t = app.state.transactions.find((x) => x.id === el.dataset.id); if (t) quickAdd(null, t); },
  closeSheet: () => closeSheet(),
  check: (el) => ({ income: () => quickAdd("income"), fixed: fixedSheet, alloc: () => (location.hash = "accounts"), short: () => (location.hash = "accounts"),
    rebal: () => (location.hash = "accounts"), snap: snapSheet, inv: investSheet }[el.dataset.k] || (() => {}))(),
  snapSheet: () => snapSheet(), saveSnaps: () => saveSnaps(), fixedSheet: () => fixedSheet(), saveFixed: () => saveFixed(),
  investSheet: () => investSheet(), saveInvest: () => saveInvest(),
  allocDo: (el) => allocDo(el.dataset.id), allocSave: (el) => allocSave(el.dataset.id), allocAll: () => allocAll(), allocAllSave: () => allocAllSave(), allocView: (el) => allocView(el.dataset.id),
  rebalDo: (el) => rebalDo(el.dataset.id), rebalSave: (el) => rebalSave(el.dataset.id),
  editItem: (el) => editItem(el.dataset.col, el.dataset.id), saveItem: (el) => saveItem(el.dataset.col, el.dataset.id), delItem: (el) => delItem(el.dataset.col, el.dataset.id),
  move: (el) => move(el.dataset.col, el.dataset.id, Number(el.dataset.d)),
  saveRules: async () => {
    const f = $("#rulesForm"), e = f.elements, s = { ...app.state.settings };
    s.payday = Math.min(31, Math.max(1, parseNum(e.payday.value) || 20)); s.basis = e.basis.value; s.deductPendingFixed = e.deductPendingFixed.checked;
    s.emergencyId = e.emergencyId.value; s.preRatio = (parseNum(e.preRatio.value) ?? 80) / 100; s.postRatio = (parseNum(e.postRatio.value) ?? 50) / 100;
    s.saveTargetId = e.saveTargetId.value; s.invTargetId = e.invTargetId.value; s.irpAccountId = e.irpAccountId.value; s.irpLimit = parseNum(e.irpLimit.value) ?? 6;
    s.irpToId = e.irpToId.value; s.unit = parseNum(e.unit.value) || 1; s.fallback = e.fallback.checked; s.startDate = e.startDate.value || s.startDate;
    if (s.preRatio < 0 || s.preRatio > 1 || s.postRatio < 0 || s.postRatio > 1) return toast("비율은 0~100% 사이");
    await app.store.put("settings", s); toast("규칙을 저장했습니다");
  },
  backup: async () => { await shareOrDownload(`재정관리_백업_${stamp()}.json`, JSON.stringify(app.store.exportJSON(), null, 1), "application/json"); app.lastBackup = Date.now(); await app.store.ad.setMeta("lastBackup", app.lastBackup); },
  exportXlsx: () => shareOrDownload(`재정관리_${stamp()}.xlsx`, exportWorkbook(app.state, todayStr()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  exportCsv: () => shareOrDownload(`거래내역_${stamp()}.csv`, toCSV(transactionRows(app.state)), "text/csv"),
  resetData: async () => {
    if (!confirm(`거래·잔액·투자 기록을 모두 지우고 ${START_DATE}부터 새로 시작합니다.\n통장·항목·규칙은 유지됩니다. 먼저 백업을 권장합니다.`)) return;
    await app.store.resetAll(START_DATE, { keepRules: true }); app.ym = ymOf(todayStr()); toast("제로셋팅 완료");
  },
  resetAll: async () => {
    if (!confirm("모든 데이터와 규칙을 기본값으로 되돌립니다. 계속할까요?")) return;
    await app.store.resetAll(START_DATE, { keepRules: false }); toast("전체 초기화 완료");
  },
  syncSave: async () => {
    const m = $("main"); const url = $('[name="url"]', m).value.trim(), key = $('[name="anon"]', m).value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) return toast("URL과 키를 확인하세요");
    await app.sync.configure(url, key, $('[name="e2e"]', m).checked); toast("저장했습니다"); refresh();
  },
  copySql: async () => { try { await navigator.clipboard.writeText(SUPABASE_SQL); toast("복사했습니다"); } catch { toast("복사 실패 — 직접 선택해 복사하세요"); } },
  signIn: async () => { try { await app.sync.signIn($('[name="email"]').value.trim(), $('[name="pw"]').value); toast("로그인했습니다"); refresh(); } catch (e) { toast(e.message, null, 4000); } },
  signUp: async () => { try { const j = await app.sync.signUp($('[name="email"]').value.trim(), $('[name="pw"]').value); toast(j.access_token ? "가입·로그인 완료" : "확인 메일을 열고 로그인하세요", null, 4000); refresh(); } catch (e) { toast(e.message, null, 4000); } },
  signOut: async () => { await app.sync.signOut(); app.syncState = "off"; toast("로그아웃 (기기 데이터는 유지)"); refresh(); },
  setPass: async () => { const p = $('[name="pass"]').value; if (p.length < 6) return toast("6자 이상 입력하세요"); await app.sync.setPassphrase(p); toast("암호화 비밀번호 설정"); refresh(); },
  syncNow: () => trySync(true),
};
function onClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
}
document.addEventListener("change", (e) => { if (e.target.matches("input[type=file][data-file]")) onFile(e.target); });

(async () => { await boot(); app.lastBackup = await app.store?.ad.getMeta("lastBackup"); })();
window.__app = app;   // 테스트용
