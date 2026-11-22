// 재정 계산 엔진 (순수 함수 · UI/저장소와 분리 · node 테스트 대상)
// 원칙
//  1) 소비 = 고정·변동지출(카드는 결제대금만) + 소비통장 미기록 사용액(잔액 차이)
//  2) 통장 간 이체는 소비가 아님. 저축·투자금 = 급여/소비통장 → 저축/투자통장 유입
//  3) 신규 투자금(매수)과 평가손익은 분리: 평가손익 = 평가액 변화 − 신규 매수
//  4) 남은 현금(급여통장 순증) ≠ 순자산 증감

export const ymOf = (d) => d.slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const monthDiff = (a, b) => { // b - a
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
export const lastDay = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
export const floorTo = (x, u) => (u > 0 ? Math.floor(x / u) * u : Math.floor(x));
const round3 = (x) => Math.round(x / 1000) * 1000;
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export function todayStr(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// ------------------------------------------------------------------
// context
// ------------------------------------------------------------------
export function buildContext(state, today = todayStr()) {
  const s = state.settings;
  const accounts = [...state.accounts].sort(byOrder);
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const cat = Object.fromEntries(state.categories.map((c) => [c.id, c]));
  const assets = [...state.assets].sort(byOrder);
  const txs = [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  const txByMonth = {};
  for (const t of txs) (txByMonth[ymOf(t.date)] ||= []).push(t);
  const startYm = ymOf(s.startDate);
  const curYm = ymOf(today);
  let firstYm = startYm, lastYm = curYm;
  for (const t of txs) { const m = ymOf(t.date); if (m < firstYm) firstYm = m; if (m > lastYm) lastYm = m; }
  for (const x of state.snapshots) { if (x.month > lastYm) lastYm = x.month; if (x.month < firstYm) firstYm = x.month; }
  for (const x of state.invest) { if (x.month > lastYm) lastYm = x.month; }
  const ctx = { state, s, accounts, acc, cat, assets, txs, txByMonth, startYm, firstYm, lastYm, curYm, today, _series: {}, _sum: {} };
  return ctx;
}

const accType = (ctx, id) => ctx.acc[id]?.type;

// 월별 통장 잔액 흐름. 스냅숏(월말/현재 잔액 확인)이 있으면 그 시점 이전 흐름과의 차이를 '미기록 변동'으로 계산.
export function accountSeries(ctx, accountId) {
  if (ctx._series[accountId]) return ctx._series[accountId];
  const a = ctx.acc[accountId];
  const snaps = {};
  for (const x of ctx.state.snapshots) {
    if (x.accountId !== accountId) continue;
    if (!snaps[x.month] || (x.at || 0) >= (snaps[x.month].at || 0)) snaps[x.month] = x;
  }
  const out = {};
  let bal = Number(a?.opening) || 0;
  let known = a?.opening != null && a?.opening !== "";   // 시작 잔액 미설정이면 첫 잔액 확인이 기준점
  for (let m = ctx.firstYm; m <= ctx.lastYm; m = addMonths(m, 1)) {
    const start = bal;
    const snap = snaps[m];
    let inflow = 0, outflow = 0, before = 0, after = 0;
    for (const t of ctx.txByMonth[m] || []) {
      let d = 0;
      if (t.to === accountId && (t.type === "income" || t.type === "transfer")) d += t.amount;
      if (t.from === accountId && (t.type === "expense" || t.type === "transfer")) d -= t.amount;
      if (!d) continue;
      if (d > 0) inflow += d; else outflow -= d;
      if (snap && (t.createdAt || 0) > (snap.at || 0)) after += d; else before += d;
    }
    let end, diff = 0, use = 0, estimated = !snap;
    if (snap) {
      diff = known ? start + before - snap.amount : 0;   // 기대 잔액 − 실제 잔액
      end = snap.amount + after;
      if (a?.type === "spend") use = diff;
      known = true;
    } else {
      end = start + inflow - outflow;
      if (a?.type === "spend" && ctx.s.fallback) {
        use = Math.max(0, inflow - outflow);
        if (m < ctx.curYm) end -= use;                 // 지난달은 사용한 것으로 확정
      }
    }
    out[m] = { start, inflow, outflow, net: inflow - outflow, snap: snap?.amount ?? null, diff, use, end, estimated };
    bal = end;
  }
  ctx._series[accountId] = out;
  return out;
}

export function balanceEnd(ctx, accountId, ym) {
  const ser = accountSeries(ctx, accountId);
  if (ser[ym]) return ser[ym].end;
  if (ym < ctx.firstYm) return Number(ctx.acc[accountId]?.opening) || 0;
  return ser[ctx.lastYm]?.end ?? 0;
}

// ------------------------------------------------------------------
// 투자 계획
// ------------------------------------------------------------------
export function assetBaseAmount(a) {
  if (a.baseAmount != null && a.baseAmount !== "") return Number(a.baseAmount);
  const annual = Number(a.annual) || 0, r = Number(a.rate) || 0;
  if (!annual) return 0;
  return round3(r === 0 ? annual / 12 : (annual * r) / ((1 + r) ** 12 - 1));
}

export function irpCountBefore(ctx, ym) {
  const id = ctx.s.irpAccountId, y = ym.slice(0, 4);
  const months = new Set();
  for (const t of ctx.txs) if (t.type === "transfer" && t.to === id && t.date.slice(0, 4) === y && ymOf(t.date) < ym) months.add(ymOf(t.date));
  return months.size;    // 같은 달 분할 이체는 1회로 계산
}

export function assetPlan(ctx, a, ym) {
  if (a.planMode === "annual") {
    const base = assetBaseAmount(a), r = Number(a.rate) || 0;
    const n = a.baseMonth ? Math.max(0, monthDiff(a.baseMonth, ym)) : 0;
    return round3(base * (1 + r) ** n);
  }
  if (a.planMode === "account") {
    const ac = ctx.acc[a.accountId];
    if (!ac) return 0;
    if (ac.id === ctx.s.irpAccountId && irpCountBefore(ctx, ym) >= ctx.s.irpLimit) return 0;
    return ac.method === "fixed" ? Number(ac.value) || 0 : 0;
  }
  return 0;
}

// ------------------------------------------------------------------
// 투자 기록 (월말 평가 · 신규 매수 · 배당)
// ------------------------------------------------------------------
function fxOf(ctx, ym) { return Number(ctx.state.months.find((x) => x.id === ym)?.fx) || 0; }
export function recordValue(ctx, r) {
  if (r.value != null && r.value !== "") return Number(r.value);
  if (r.valueUsd != null && r.valueUsd !== "") { const fx = fxOf(ctx, r.month); return fx ? Math.round(r.valueUsd * fx) : null; }
  return null;
}
function investIndex(ctx) {
  if (ctx._inv) return ctx._inv;
  const idx = {};
  for (const r of ctx.state.invest) (idx[r.assetId] ||= {})[r.month] = r;
  return (ctx._inv = idx);
}
// 해당 월 평가액(없으면 직전 값 이월). {value, actual}
export function assetValue(ctx, assetId, ym) {
  const recs = investIndex(ctx)[assetId] || {};
  if (recs[ym]) { const v = recordValue(ctx, recs[ym]); if (v != null) return { value: v, actual: true }; }
  let best = null;
  for (const m of Object.keys(recs)) if (m < ym && (!best || m > best)) { const v = recordValue(ctx, recs[m]); if (v != null) best = m; }
  return best ? { value: recordValue(ctx, recs[best]), actual: false } : { value: null, actual: false };
}

// ------------------------------------------------------------------
// 월 요약
// ------------------------------------------------------------------
export function monthSummary(ctx, ym) {
  if (ctx._sum[ym]) return ctx._sum[ym];
  const txs = ctx.txByMonth[ym] || [];
  const r = { ym, income: 0, salary: 0, finIncome: 0, fixed: 0, variable: 0, subs: 0, payExp: 0,
    trSpend: 0, trSave: 0, trInv: 0, rebalSave: 0, rebalInv: 0 };
  for (const t of txs) {
    const c = ctx.cat[t.categoryId];
    if (t.type === "income") {
      r.income += t.amount;
      if (c?.salary) r.salary += t.amount;
      if (c?.group === "금융수입") r.finIncome += t.amount;
    } else if (t.type === "expense") {
      if (c?.kind === "fixed") r.fixed += t.amount; else r.variable += t.amount;
      if (c?.group === "구독") r.subs += t.amount;
      if (accType(ctx, t.from) === "pay") r.payExp += t.amount;
    } else if (t.type === "transfer") {
      const ft = accType(ctx, t.from), tt = accType(ctx, t.to);
      if (ft === "pay") {
        if (tt === "spend") r.trSpend += t.amount;
        if (tt === "save") r.trSave += t.amount;
        if (tt === "invest") r.trInv += t.amount;
      } else if (ft === "spend") {
        if (tt === "save") r.rebalSave += t.amount;
        if (tt === "invest") r.rebalInv += t.amount;
      }
    }
  }
  r.transfers = r.trSpend + r.trSave + r.trInv;
  r.extra = r.income - r.salary;
  r.savingsInvest = r.trSave + r.trInv + r.rebalSave + r.rebalInv;
  r.cashLeft = 0;                    // 남은 현금 = 급여통장 순증
  r.envelope = {}; r.envelopeTotal = 0; r.missingSnaps = [];
  for (const a of ctx.accounts) {
    const ser = accountSeries(ctx, a.id)[ym];
    if (!ser) continue;
    if (a.type === "pay") r.cashLeft += ser.net;
    if (a.type === "spend") { r.envelope[a.id] = ser.use; r.envelopeTotal += ser.use; }
    if (a.type !== "invest" && ser.snap == null) r.missingSnaps.push(a.id);
  }
  r.consumption = r.fixed + r.variable + r.envelopeTotal;
  r.rate = r.income > 0 ? r.savingsInvest / r.income : null;

  // 투자
  const recs = ctx.state.invest.filter((x) => x.month === ym);
  r.newBuy = sum(recs, (x) => x.newAmount);
  r.dividend = sum(recs, (x) => x.dividend);
  r.assets = [];
  let valTotal = 0, valued = 0;
  for (const a of ctx.assets) {
    const v = assetValue(ctx, a.id, ym);
    const pv = assetValue(ctx, a.id, addMonths(ym, -1));
    const rec = recs.find((x) => x.assetId === a.id);
    const nb = Number(rec?.newAmount) || 0;
    const plan = assetPlan(ctx, a, ym);
    let g = null;
    if (v.actual && pv.value != null) g = v.value - pv.value - nb;   // 자산별 참고값
    if (v.value != null) valTotal += v.value;
    if (v.actual) valued++;
    r.assets.push({ id: a.id, name: a.name, group: a.group, plan, newAmount: nb, value: v.value, actual: v.actual,
      prevValue: pv.value, change: v.value != null && pv.value != null ? v.value - pv.value : null, gain: g, dividend: Number(rec?.dividend) || 0 });
  }
  // 투자계좌로 들어온 순 신규자금 (투자계좌 내부 매수·매도는 무관)
  r.investInflow = 0;
  for (const t of txs) {
    if (t.type !== "transfer") continue;
    const ft = accType(ctx, t.from), tt = accType(ctx, t.to);
    if (tt === "invest" && ft !== "invest") r.investInflow += t.amount;
    if (ft === "invest" && tt !== "invest") r.investInflow -= t.amount;
  }
  for (const t of txs) if (t.type === "income" && accType(ctx, t.to) === "invest") r.investInflow += t.amount;
  r.investValue = valTotal; r.valuedCount = valued;
  // 평가손익 = 투자자산 총평가액 변화 − 순 신규자금 (예수금·Pool 포함 평가 시 정확)
  const prevTotal = sum(r.assets, (x) => x.prevValue);
  const anyPrev = r.assets.some((x) => x.prevValue != null);
  r.gain = valued > 0 && anyPrev ? valTotal - prevTotal - r.investInflow : null;
  for (const x of r.assets) x.weight = valTotal > 0 && x.value != null ? x.value / valTotal : null;
  const vr = r.assets.filter((x) => x.group === "vr");
  r.vrValue = sum(vr, (x) => x.value); r.vrNew = sum(vr, (x) => x.newAmount);
  r.vrWeight = valTotal > 0 ? r.vrValue / valTotal : null;
  r.planTotal = sum(r.assets, (x) => x.plan);

  // 순자산
  r.cash = 0;
  for (const a of ctx.accounts) if (a.type !== "invest") r.cash += balanceEnd(ctx, a.id, ym);
  r.debt = Number(ctx.state.months.find((x) => x.id === ym)?.debt) || 0;
  r.netWorth = r.cash + r.investValue - r.debt;
  const pm = addMonths(ym, -1);
  r.netWorthChange = pm >= ctx.firstYm ? r.netWorth - monthSummary(ctx, pm).netWorth : null;
  ctx._sum[ym] = r;
  return r;
}

export function yearToDate(ctx, ym, key) {
  let t = 0;
  for (let m = `${ym.slice(0, 4)}-01`; m <= ym; m = addMonths(m, 1)) t += monthSummary(ctx, m)[key] || 0;
  return t;
}

// ------------------------------------------------------------------
// 월급 배분 (기존 규칙: 비율/정액/투자계획 · 우선순위 순 · 가용액 초과 금지)
// ------------------------------------------------------------------
export function pendingTemplates(ctx, ym) {
  const done = new Set((ctx.txByMonth[ym] || []).filter((t) => t.templateId).map((t) => t.templateId));
  return [...ctx.state.templates].sort(byOrder).filter((t) => t.active && t.pay !== "card" && !done.has(t.id));
}

export function allocation(ctx, ym) {
  const s = ctx.s, u = Number(s.unit) || 1;
  const sm = monthSummary(ctx, ym);
  const basisAmt = s.basis === "income" ? sm.income : sm.salary;
  const pending = pendingTemplates(ctx, ym).filter((t) => !t.from || accType(ctx, t.from) === "pay");
  const pendingFixed = s.deductPendingFixed ? sum(pending, (t) => t.amount) : 0;
  const deduct = sm.payExp + pendingFixed;
  const avail = Math.max(0, sm.income - deduct);
  const irpCount = irpCountBefore(ctx, ym);
  const irpOver = irpCount >= s.irpLimit;
  const irpAcc = ctx.acc[s.irpAccountId];
  const rows = [];
  for (const a of ctx.accounts) {
    if (a.type === "pay" || a.method === "none") continue;
    let base = 0;
    if (a.method === "ratio") base = floorTo(basisAmt * (Number(a.value) || 0), u);
    else if (a.method === "fixed") base = Number(a.value) || 0;
    else if (a.method === "plan") base = floorTo(sum(ctx.assets.filter((x) => x.accountId === a.id && x.planMode === "annual"), (x) => assetPlan(ctx, x, ym)), u);
    let note = "";
    if (irpOver && a.id === s.irpAccountId) { base = 0; note = `IRP 연 ${s.irpLimit}회 도달`; }
    if (irpOver && a.id === s.irpToId && a.id !== s.irpAccountId && irpAcc?.method === "fixed") { base += Number(irpAcc.value) || 0; note = "IRP 한도 전환분 포함"; }
    rows.push({ id: a.id, name: a.name, type: a.type, method: a.method, value: a.value, priority: Number(a.priority) || 0, order: a.order ?? 0, base, note });
  }
  const sorted = [...rows].sort((x, y) => x.priority - y.priority || x.order - y.order);
  let cum = 0;
  for (const r of sorted) { r.recommended = Math.min(r.base, floorTo(Math.max(0, avail - cum), u)); cum += r.base; }
  for (const r of rows) {
    r.actual = sum((ctx.txByMonth[ym] || []).filter((t) => t.type === "transfer" && t.to === r.id && accType(ctx, t.from) === "pay"), (t) => t.amount);
    r.done = r.actual > 0;
    r.diff = r.actual - r.recommended;
  }
  const totalBase = sum(rows, (r) => r.base), totalRec = sum(rows, (r) => r.recommended), totalAct = sum(rows, (r) => r.actual);
  return { ym, salary: sm.salary, income: sm.income, extra: sm.extra, basisAmt, payExp: sm.payExp, pendingFixed, pending, deduct, avail,
    irpCount, irpOver, rows, totalBase, totalRec, totalAct, shortfall: totalBase - totalRec, unallocated: avail - totalRec };
}

// ------------------------------------------------------------------
// 목표 초과 재배분 (비상금 목표 전 80:20, 이후 설정 비율)
// ------------------------------------------------------------------
export function rebalance(ctx, ym) {
  const s = ctx.s, u = Number(s.unit) || 1;
  const em = ctx.acc[s.emergencyId];
  const emBal = em ? balanceEnd(ctx, em.id, ym) : 0;
  const emTarget = Number(em?.target) || 0;
  const ratio = emTarget && emBal >= emTarget ? Number(s.postRatio) : Number(s.preRatio);
  const rows = [];
  for (const a of ctx.accounts) {
    if (a.type === "invest" || a.type === "pay") continue;
    const ser = accountSeries(ctx, a.id)[ym];
    const bal = balanceEnd(ctx, a.id, ym);
    const target = a.target != null && a.target !== "" ? Number(a.target) : null;
    const excess = a.rebalance && target != null ? Math.max(0, bal - target) : 0;
    const toSave = excess > 0 ? floorTo(excess * ratio, u) : 0;
    rows.push({ id: a.id, name: a.name, type: a.type, balance: bal, estimated: ser ? ser.estimated : true, target,
      progress: target ? Math.min(1, Math.max(0, bal / target)) : null, excess, toSave, toInv: excess - toSave, rebalance: !!a.rebalance });
  }
  return { ym, ratio, emBal, emTarget, emReached: emTarget > 0 && emBal >= emTarget, rows,
    totalExcess: sum(rows, (r) => r.excess), saveTo: s.saveTargetId, invTo: s.invTargetId };
}

// ------------------------------------------------------------------
// 연간
// ------------------------------------------------------------------
export function annual(ctx, year, refYm) {
  const months = [];
  for (let i = 1; i <= 12; i++) {
    const m = `${year}-${String(i).padStart(2, "0")}`;
    const inRange = m >= ctx.firstYm && m <= ctx.lastYm;
    months.push(inRange ? monthSummary(ctx, m) : { ym: m, empty: true, income: 0, consumption: 0, savingsInvest: 0, trSave: 0, trInv: 0, cashLeft: 0, newBuy: 0, dividend: 0, netWorth: null, netWorthChange: null, rate: null });
  }
  const tot = (k) => sum(months, (x) => x[k]);
  const totals = { income: tot("income"), consumption: tot("consumption"), savingsInvest: tot("savingsInvest"), trSave: tot("trSave"), trInv: tot("trInv"),
    cashLeft: tot("cashLeft"), newBuy: tot("newBuy"), dividend: tot("dividend") };
  totals.rate = totals.income > 0 ? totals.savingsInvest / totals.income : null;
  const live = months.filter((x) => !x.empty);
  totals.netWorthEnd = live.length ? live[live.length - 1].netWorth : null;
  const ref = refYm && refYm.startsWith(String(year)) ? refYm : `${year}-12`;
  const planSum = {};
  const assets = ctx.assets.map((a) => {
    let plan = 0, actual = 0;
    for (let i = 1; i <= 12; i++) {
      const m = `${year}-${String(i).padStart(2, "0")}`;
      plan += assetPlan(ctx, a, m);
      actual += Number(ctx.state.invest.find((x) => x.month === m && x.assetId === a.id)?.newAmount) || 0;
    }
    if (a.accountId === ctx.s.irpAccountId && a.planMode === "account") plan = Math.min(plan, ctx.s.irpLimit * (Number(ctx.acc[a.accountId]?.value) || 0));
    const v = assetValue(ctx, a.id, ref).value;
    if (a.planMode === "annual") planSum[a.id] = Number(a.annual) || 0;
    return { id: a.id, name: a.name, group: a.group, plan, actual, achieve: plan > 0 ? actual / plan : null, value: v };
  });
  const vt = sum(assets, (x) => x.value);
  const pt = sum(Object.values(planSum));
  for (const x of assets) { x.weight = vt > 0 && x.value != null ? x.value / vt : null; x.planWeight = pt > 0 && planSum[x.id] ? planSum[x.id] / pt : null; }
  return { year, months, totals, assets };
}

// ------------------------------------------------------------------
// 점검 알림
// ------------------------------------------------------------------
export function checks(ctx, ym) {
  const sm = monthSummary(ctx, ym), al = allocation(ctx, ym), rb = rebalance(ctx, ym);
  const list = [];
  if (sm.income === 0) list.push({ level: "warn", key: "income", text: "이번 달 수입이 아직 없습니다" });
  const pend = al.pending.length;
  if (pend) list.push({ level: "todo", key: "fixed", text: `고정지출 ${pend}건 미입력` });
  if (sm.income > 0) {
    const notDone = al.rows.filter((r) => r.recommended > 0 && !r.done).length;
    if (notDone) list.push({ level: "todo", key: "alloc", text: `통장 배분 ${notDone}곳 이체 대기` });
    if (al.shortfall > 0) list.push({ level: "warn", key: "short", text: `가용액 부족으로 ${al.shortfall.toLocaleString("ko-KR")}원 감액 배분` });
  }
  if (rb.totalExcess > 0) list.push({ level: "todo", key: "rebal", text: `목표 초과 ${rb.totalExcess.toLocaleString("ko-KR")}원 재배분 권장` });
  const monthEndish = ym < ctx.curYm || Number(ctx.today.slice(8, 10)) >= 25;
  if (monthEndish && sm.missingSnaps.length) list.push({ level: "todo", key: "snap", text: `월말 잔액 확인 ${sm.missingSnaps.length}곳 남음` });
  if (monthEndish && sm.valuedCount === 0) list.push({ level: "todo", key: "inv", text: "투자 평가액 미입력" });
  return list;
}

// 빠른 입력용 최근·자주 쓰는 항목
export function recentCategories(state, kinds, n = 8) {
  const score = {};
  const tx = [...state.transactions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 300);
  tx.forEach((t, i) => { if (!t.categoryId) return; const s = score[t.categoryId] ||= { n: 0, last: Infinity, amount: t.amount }; s.n++; s.last = Math.min(s.last, i); });
  return state.categories.filter((c) => kinds.includes(c.kind))
    .map((c) => ({ ...c, _s: score[c.id] }))
    .sort((a, b) => (b._s ? 1 : 0) - (a._s ? 1 : 0) || (a._s && b._s ? (a._s.last - b._s.last) : 0) || (a.order - b.order))
    .slice(0, n)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, lastAmount: c._s?.amount ?? null }));
}
