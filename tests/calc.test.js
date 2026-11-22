import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultState } from "../js/defaults.js";
import { buildContext, monthSummary, allocation, rebalance, annual, accountSeries, assetPlan, checks, recentCategories } from "../js/calc.js";

// 스프레드시트 예시(2026-08~11)를 그대로 재현 → 같은 결과가 나와야 함 (회귀 테스트)
function sheetExample() {
  const st = createDefaultState("2026-08-01");
  st.settings.deductPendingFixed = false;      // 스프레드시트는 미입력 고정지출을 차감하지 않았음
  const cat = (n) => st.categories.find((c) => c.name === n).id;
  let seq = 1;
  const T = (date, type, extra) => st.transactions.push({ id: "t" + seq, createdAt: seq++, date, type, ...extra });
  const fixed = [[3, "월세 및 기타", 700000], [5, "보험1(암보험)", 50504], [6, "아이클라우드", 3300], [11, "운전자보험", 19388],
    [15, "인터넷요금", 15340], [23, "본가 인터넷요금", 16335], [23, "통신요금", 66620], [25, "관리비", 134840],
    [26, "가족모임", 50000], [28, "OpenAI", 33000], [28, "컬리페이", 1900]];
  const salary = { 9: 4200000, 10: 4450000, 11: 4100000 };
  const cards = { 9: [310000, 480000], 10: [290000, 520000], 11: [250000, 450000] };
  const order = ["acc_living", "acc_leisure", "acc_food", "acc_inv", "acc_sav", "acc_event", "acc_em", "acc_coin", "acc_irp"];
  const tr = { 9: [420000, 294000, 126000, 1000000, 300000, 50000, 150000, 250000, 250000],
    10: [445000, 311000, 133000, 800000, 300000, 50000, 150000, 250000, 250000],
    11: [410000, 287000, 123000, 500000, 300000, 50000, 150000, 250000, 250000] };
  for (const m of [9, 10, 11]) {
    const d = (x) => `2026-${String(m).padStart(2, "0")}-${String(x).padStart(2, "0")}`;
    for (const [day, n, a] of fixed) T(d(day), "expense", { categoryId: cat(n), amount: a, from: "acc_pay" });
    T(d(20), "income", { categoryId: cat("월급(실수령)"), amount: salary[m], to: "acc_pay" });
    if (m === 9) T(d(20), "income", { categoryId: cat("명절휴가비"), amount: 900000, to: "acc_pay" });
    T(d(14), "expense", { categoryId: cat("신용카드1(국민)"), amount: cards[m][0], from: "acc_pay" });
    T(d(14), "expense", { categoryId: cat("신용카드2(현대)"), amount: cards[m][1], from: "acc_pay" });
    order.forEach((id, i) => T(d(20), "transfer", { amount: tr[m][i], from: "acc_pay", to: id }));
  }
  T("2026-11-21", "transfer", { amount: 124000, from: "acc_living", to: "acc_em", tag: "rebal" });
  T("2026-11-21", "transfer", { amount: 31000, from: "acc_living", to: "acc_inv", tag: "rebal" });
  const bal = { "08": [300000, 820000, 350000, 180000, 250000, 2400000, 1500000],
    "09": [678773, 980000, 244000, 216000, 200000, 2700000, 1650000],
    "10": [538546, 1155000, 375000, 289000, 250000, 3000000, 1800000],
    "11": [527319, 1130000, 412000, 312000, 250000, 3300000, 2074000] };
  const bacc = ["acc_pay", "acc_living", "acc_leisure", "acc_food", "acc_event", "acc_sav", "acc_em"];
  for (const [m, vals] of Object.entries(bal)) vals.forEach((v, i) => st.snapshots.push({ id: `s${m}${i}`, accountId: bacc[i], month: `2026-${m}`, amount: v, at: 1e9 }));
  const inv = { // asset: [new, value, usd, dividend]
    "08": { ast_vr: [0, 4000000], ast_pool: [0, 1500000], ast_blue: [0, 8000000], ast_div: [0, 5000000], ast_irp: [0, 1500000], ast_coin: [0, 2000000], ast_cash: [0, 200000] },
    "09": { ast_vr: [500000, 4650000], ast_pool: [0, 1450000], ast_blue: [300000, 8450000], ast_div: [150000, 5200000, null, 18000], ast_irp: [250000, 1760000], ast_coin: [250000, 2180000], ast_cash: [0, 250000] },
    "10": { ast_vr: [400000, null, 3475], ast_pool: [0, 1500000], ast_blue: [250000, 8900000], ast_div: [130000, 5380000, null, 21000], ast_irp: [250000, 2020000], ast_coin: [250000, 2300000], ast_cash: [0, 270000] },
    "11": { ast_vr: [400000, 4700000], ast_pool: [0, 1600000], ast_blue: [230000, 9250000], ast_div: [130000, 5550000, null, 19000], ast_irp: [250000, 2280000], ast_coin: [250000, 2100000], ast_cash: [0, 41000] },
  };
  for (const [m, o] of Object.entries(inv)) for (const [assetId, [n, v, usd, dv]] of Object.entries(o))
    st.invest.push({ id: `i${m}${assetId}`, month: `2026-${m}`, assetId, newAmount: n, value: v, valueUsd: usd ?? null, dividend: dv ?? 0 });
  st.months.push({ id: "2026-10", fx: 1410 });
  return st;
}

test("회귀: 스프레드시트 11월 결과와 동일", () => {
  const ctx = buildContext(sheetExample(), "2026-11-22");
  const s = monthSummary(ctx, "2026-11");
  assert.equal(s.income, 4100000);
  assert.equal(s.fixed, 1091227);
  assert.equal(s.variable, 700000);
  assert.equal(s.payExp, 1791227);
  assert.equal(s.cashLeft, -11227);
  assert.deepEqual([s.envelope.acc_living, s.envelope.acc_leisure, s.envelope.acc_food, s.envelope.acc_event], [280000, 250000, 100000, 50000]);
  assert.equal(s.consumption, 2471227);
  assert.equal(s.savingsInvest, 1605000);
  assert.equal(s.gain, -779750);
  assert.equal(s.netWorth, 33526319);
  assert.equal(s.netWorthChange, 849023);
  assert.equal(s.dividend, 19000);
});

test("회귀: 9·10월 및 연간 집계", () => {
  const ctx = buildContext(sheetExample(), "2026-11-22");
  const s9 = monthSummary(ctx, "2026-09"), s10 = monthSummary(ctx, "2026-10");
  assert.equal(s9.cashLeft, 378773);
  assert.equal(s9.envelopeTotal, 260000 + 400000 + 90000 + 100000);
  assert.equal(s9.gain, 240000);
  assert.equal(s10.cashLeft, -140227);
  assert.equal(s10.envelopeTotal, 510000);
  const y = annual(ctx, 2026, "2026-11");
  assert.equal(y.totals.income, 13650000);
  assert.equal(y.totals.consumption, 7613681);
  assert.equal(y.totals.dividend, 58000);
  assert.equal(y.totals.netWorthEnd, monthSummary(ctx, "2026-12").netWorth); // 12월은 11월 잔액 이월
  assert.equal(y.assets.find((a) => a.id === "ast_irp").plan, 1500000); // IRP 연 6회 상한
});

test("회귀: 11월 배분 · 재배분 (스프레드시트와 동일)", () => {
  const ctx = buildContext(sheetExample(), "2026-11-22");
  const al = allocation(ctx, "2026-11");
  assert.equal(al.avail, 2308773);
  const r = Object.fromEntries(al.rows.map((x) => [x.id, x]));
  assert.equal(r.acc_inv.base, 1835000);
  assert.equal(r.acc_inv.recommended, 488000);
  assert.equal(al.shortfall, 1347000);
  assert.equal(al.unallocated, 773);
  assert.equal(r.acc_inv.actual, 500000);
  const rb = rebalance(ctx, "2026-11");
  const b = Object.fromEntries(rb.rows.map((x) => [x.id, x]));
  assert.equal(rb.ratio, 0.8);
  assert.deepEqual([b.acc_living.excess, b.acc_living.toSave, b.acc_living.toInv], [130000, 104000, 26000]);
  assert.deepEqual([b.acc_food.excess, b.acc_food.toSave, b.acc_food.toInv], [12000, 9000, 3000]);
});

test("설정 변경이 즉시 반영 (비율·목표·IRP 한도·목표 후 비율)", () => {
  const st = sheetExample();
  st.accounts.find((a) => a.id === "acc_living").value = 0.12;
  st.accounts.find((a) => a.id === "acc_living").target = 800000;
  st.accounts.find((a) => a.id === "acc_em").target = 2000000;
  st.settings.postRatio = 0.3;
  st.settings.irpLimit = 2;
  const ctx = buildContext(st, "2026-11-22");
  const r = Object.fromEntries(allocation(ctx, "2026-11").rows.map((x) => [x.id, x]));
  assert.equal(r.acc_living.base, 492000);
  assert.equal(r.acc_irp.base, 0);
  assert.equal(r.acc_coin.base, 500000);
  const rb = rebalance(ctx, "2026-11");
  assert.equal(rb.ratio, 0.3);
  const lv = rb.rows.find((x) => x.id === "acc_living");
  assert.deepEqual([lv.excess, lv.toSave, lv.toInv], [330000, 99000, 231000]);
});

test("제로셋팅 · 수입 없는 달: 오류 없이 0/null", () => {
  const ctx = buildContext(createDefaultState("2026-11-20"), "2026-11-22");
  const s = monthSummary(ctx, "2026-11");
  assert.equal(s.income, 0); assert.equal(s.consumption, 0); assert.equal(s.rate, null);
  assert.equal(s.netWorth, 0); assert.equal(s.gain, null);
  const al = allocation(ctx, "2026-11");
  assert.ok(al.rows.every((r) => r.recommended === 0));
  assert.ok(checks(ctx, "2026-11").some((c) => c.key === "income"));
  for (const v of Object.values(s)) if (typeof v === "number") assert.ok(Number.isFinite(v));
});

test("이체는 소비가 아니고, 카드대금은 결제 시 한 번만 집계", () => {
  const st = createDefaultState("2026-11-20");
  const card = st.categories.find((c) => c.name === "신용카드1(국민)").id;
  st.transactions.push({ id: "a", date: "2026-11-20", type: "income", categoryId: st.categories[0].id, amount: 3000000, to: "acc_pay", createdAt: 1 });
  st.transactions.push({ id: "b", date: "2026-11-20", type: "transfer", amount: 300000, from: "acc_pay", to: "acc_living", createdAt: 2 });
  st.transactions.push({ id: "c", date: "2026-11-25", type: "expense", categoryId: card, amount: 500000, from: "acc_pay", createdAt: 3 });
  const s = monthSummary(buildContext(st, "2026-11-26"), "2026-11");
  assert.equal(s.consumption, 500000);            // 이체 30만 원은 소비 아님(잔액 미확인)
  assert.equal(s.transfers, 300000);
  assert.equal(s.cashLeft, 3000000 - 300000 - 500000);
});

test("잔액 확인 후 이체는 잔액에서 차감 (재배분 완료 반영)", () => {
  const st = createDefaultState("2026-11-20");
  st.accounts.find((a) => a.id === "acc_living").opening = 1200000;
  st.snapshots.push({ id: "s", accountId: "acc_living", month: "2026-11", amount: 1150000, at: 100 });
  let ctx = buildContext(st, "2026-11-22");
  assert.equal(monthSummary(ctx, "2026-11").envelope.acc_living, 50000);
  assert.equal(rebalance(ctx, "2026-11").rows.find((r) => r.id === "acc_living").excess, 150000);
  st.transactions.push({ id: "r1", date: "2026-11-22", type: "transfer", amount: 120000, from: "acc_living", to: "acc_em", createdAt: 200 });
  st.transactions.push({ id: "r2", date: "2026-11-22", type: "transfer", amount: 30000, from: "acc_living", to: "acc_inv", createdAt: 201 });
  ctx = buildContext(st, "2026-11-22");
  assert.equal(rebalance(ctx, "2026-11").rows.find((r) => r.id === "acc_living").excess, 0);
  const s = monthSummary(ctx, "2026-11");
  assert.equal(s.envelope.acc_living, 50000);     // 재배분 이체는 소비로 잡히지 않음
  assert.equal(s.savingsInvest, 150000);
});

test("평가손익과 신규 투자금 분리", () => {
  const st = createDefaultState("2026-10-01");
  st.transactions.push({ id: "x", date: "2026-11-20", type: "transfer", amount: 500000, from: "acc_pay", to: "acc_inv", createdAt: 1 });
  st.invest.push({ id: "1", month: "2026-10", assetId: "ast_vr", value: 1000000 });
  st.invest.push({ id: "2", month: "2026-11", assetId: "ast_vr", value: 1600000, newAmount: 500000 });
  const s = monthSummary(buildContext(st, "2026-11-30"), "2026-11");
  assert.equal(s.investInflow, 500000);
  assert.equal(s.gain, 100000);
  assert.equal(s.newBuy, 500000);
});

test("월말 잔액 미입력 대체 규칙(fallback) 사용 시 이중계산 없음", () => {
  const st = createDefaultState("2026-10-01");
  st.settings.fallback = true;
  st.accounts.find((a) => a.id === "acc_living").opening = 0;
  st.transactions.push({ id: "a", date: "2026-10-20", type: "transfer", amount: 400000, from: "acc_pay", to: "acc_living", createdAt: 1 });
  st.transactions.push({ id: "b", date: "2026-11-20", type: "transfer", amount: 400000, from: "acc_pay", to: "acc_living", createdAt: 2 });
  st.snapshots.push({ id: "s", accountId: "acc_living", month: "2026-11", amount: 300000, at: 9 });
  const ctx = buildContext(st, "2026-11-30");
  assert.equal(monthSummary(ctx, "2026-10").envelope.acc_living, 400000);  // 10월: 이체액=소비 간주
  assert.equal(monthSummary(ctx, "2026-11").envelope.acc_living, 100000);  // 11월: 0+40만−30만
  assert.equal(accountSeries(ctx, "acc_living")["2026-10"].end, 0);
});

test("미입력 고정지출 차감 · 같은 달 IRP 분할 이체는 1회", () => {
  const st = createDefaultState("2026-11-01");
  const sal = st.categories.find((c) => c.salary).id;
  st.transactions.push({ id: "a", date: "2026-11-20", type: "income", categoryId: sal, amount: 4000000, to: "acc_pay", createdAt: 1 });
  let al = allocation(buildContext(st, "2026-11-22"), "2026-11");
  assert.equal(al.pendingFixed, 1091227);
  assert.equal(al.avail, 4000000 - 1091227);
  st.transactions.push({ id: "i1", date: "2026-01-05", type: "transfer", amount: 100000, from: "acc_pay", to: "acc_irp", createdAt: 2 });
  st.transactions.push({ id: "i2", date: "2026-01-25", type: "transfer", amount: 150000, from: "acc_pay", to: "acc_irp", createdAt: 3 });
  al = allocation(buildContext(st, "2026-11-22"), "2026-11");
  assert.equal(al.irpCount, 1);
});

test("투자계획: 1% 월 증액, 연간계획 역산", () => {
  const ctx = buildContext(createDefaultState("2026-11-20"), "2026-11-22");
  const blue = ctx.assets.find((a) => a.id === "ast_blue");
  assert.equal(assetPlan(ctx, blue, "2026-01"), 725000);
  assert.equal(assetPlan(ctx, blue, "2026-11"), 801000);
  assert.equal(assetPlan(ctx, ctx.assets.find((a) => a.id === "ast_vr"), "2027-05"), 500000);
});

test("시작 잔액 미설정: 첫 잔액 확인은 기준점(소비로 잡지 않음)", () => {
  const st = createDefaultState("2026-11-20");
  st.snapshots.push({ id: "s", accountId: "acc_living", month: "2026-11", amount: 800000, at: 9 });
  const s = monthSummary(buildContext(st, "2026-11-30"), "2026-11");
  assert.equal(s.envelope.acc_living, 0);
  assert.equal(s.cash, 800000);
});

test("최근 사용 항목이 먼저", () => {
  const st = createDefaultState("2026-11-20");
  const id = st.categories.find((c) => c.name === "의료비").id;
  st.transactions.push({ id: "a", date: "2026-11-21", type: "expense", categoryId: id, amount: 12000, from: "acc_pay", createdAt: 5 });
  const r = recentCategories(st, ["fixed", "variable"], 5);
  assert.equal(r[0].id, id); assert.equal(r[0].lastAmount, 12000);
});
