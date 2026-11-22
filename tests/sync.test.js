import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, MemoryAdapter, newId } from "../js/store.js";
import { Sync } from "../js/sync.js";
import { transactionRows, toCSV, importTransactionsCSV, exportWorkbook } from "../js/io.js";
import { writeFileSync } from "node:fs";

// --- Supabase 최소 모의 서버 (Auth + PostgREST + RLS + LWW 트리거) ---
function mockSupabase() {
  const users = {}, tokens = {}, rows = new Map(); let clock = 0, n = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString();
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const issue = (u) => { const t = "tok" + ++n; tokens[t] = u.id; return { access_token: t, refresh_token: "r" + t, expires_in: 3600, user: { id: u.id, email: u.email } }; };
  const fetchFn = async (url, opt) => {
    const u = new URL(url), body = opt.body ? JSON.parse(opt.body) : null;
    if (opt.headers.apikey !== "anon") return json(401, { message: "no apikey" });
    if (u.pathname === "/auth/v1/signup") { const user = users[body.email] = { id: "uid-" + body.email, email: body.email, pw: body.password }; return json(200, issue(user)); }
    if (u.pathname === "/auth/v1/token") {
      if (u.searchParams.get("grant_type") === "password") { const user = users[body.email]; return user && user.pw === body.password ? json(200, issue(user)) : json(400, { error_description: "Invalid login" }); }
      const uidv = tokens[body.refresh_token.slice(1)]; return uidv ? json(200, issue(Object.values(users).find((x) => x.id === uidv))) : json(400, {});
    }
    if (opt.headers.Authorization && !opt.headers.Authorization.startsWith("Bearer tok")) return json(401, { message: "Invalid JWT" });
    const uidv = tokens[(opt.headers.Authorization || "").replace("Bearer ", "")];
    if (!uidv) return json(401, { message: "JWT required" });   // RLS: anon 접근 불가
    if (opt.method === "GET") {
      let list = [...rows.values()].filter((r) => r.user_id === uidv);   // RLS
      for (const [k, v] of u.searchParams) {
        if (["select", "order", "limit"].includes(k)) continue;
        const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
        list = list.filter((r) => op === "eq" ? String(r[k]) === val : op === "neq" ? String(r[k]) !== val : op === "gt" ? r[k] > val : true);
      }
      list.sort((a, b) => (a.server_ts < b.server_ts ? -1 : 1));
      return json(200, structuredClone(list.slice(0, Number(u.searchParams.get("limit") || 1000))));
    }
    if (opt.method === "POST") {
      for (const r of body) {
        if (r.user_id !== uidv) return json(403, { message: "RLS violation" });
        const k = `${r.user_id}|${r.col}|${r.id}`, old = rows.get(k);
        if (old && r.updated_at < old.updated_at) continue;       // LWW trigger
        rows.set(k, { ...structuredClone(r), server_ts: ts() });
      }
      return json(201, null);
    }
    return json(405, {});
  };
  return { fetchFn, rows, users };
}

async function device(server, t0) {
  let t = t0;
  const store = new Store(new MemoryAdapter(), { now: () => ++t });
  await store.load("2026-11-20");
  const sync = await new Sync(store, { fetchFn: server.fetchFn }).init();
  await sync.configure("https://x.supabase.co", "anon", true);
  return { store, sync, tick: (d) => (t += d) };
}

test("두 기기 동기화: 생성·수정·삭제 전파, 기본값이 실제 데이터를 덮어쓰지 않음, 암호화", async () => {
  const srv = mockSupabase();
  const A = await device(srv, 1000);
  await A.sync.signUp("me@x.com", "pw123456");
  await A.sync.setPassphrase("금고비번");
  await A.store.put("accounts", { ...A.store.get("accounts", "acc_living"), value: 0.12 });
  const tx = await A.store.put("transactions", { date: "2026-11-20", type: "income", categoryId: "cat_1", amount: 4000000, to: "acc_pay" });
  await A.sync.sync();
  // 서버에는 암호문만
  for (const r of srv.rows.values()) assert.ok(r.data.enc && !JSON.stringify(r.data).includes("4000000"));

  const B = await device(srv, 5000);        // B는 나중에 설치(기본값 시각이 더 늦어도 1로 고정)
  await B.sync.signIn("me@x.com", "pw123456");
  await B.sync.setPassphrase("틀린비번");
  await assert.rejects(() => B.sync.sync(), /비밀번호가 다른 기기/);
  await B.sync.setPassphrase("금고비번");
  await B.sync.sync();
  assert.equal(B.store.get("accounts", "acc_living").value, 0.12);
  assert.equal(B.store.state.transactions.length, 1);

  // B에서 수정·삭제 → A에 반영
  B.tick(10000);
  await B.store.put("transactions", { ...B.store.get("transactions", tx.id), amount: 4100000 });
  const t2 = await B.store.put("transactions", { date: "2026-11-21", type: "expense", categoryId: "cat_9", amount: 700000, from: "acc_pay" });
  await B.store.remove("transactions", t2.id);
  await B.sync.sync();
  await A.sync.sync();
  assert.equal(A.store.get("transactions", tx.id).amount, 4100000);
  assert.equal(A.store.state.transactions.length, 1);
  assert.equal(A.store.dirty().length, 0);
});

test("동시 수정 충돌: 최신 수정이 이김(서버 트리거 포함)", async () => {
  const srv = mockSupabase();
  const A = await device(srv, 1000), B = await device(srv, 1000);
  await A.sync.signUp("c@x.com", "pw123456"); await A.sync.setPassphrase("k");
  await B.sync.signIn("c@x.com", "pw123456"); await B.sync.setPassphrase("k");
  const tx = await A.store.put("transactions", { id: "same", date: "2026-11-20", type: "expense", categoryId: "cat_9", amount: 1, from: "acc_pay" });
  await A.sync.sync(); await B.sync.sync();
  A.tick(100); B.tick(200);
  await A.store.put("transactions", { ...tx, amount: 111 });
  await B.store.put("transactions", { ...tx, amount: 222 });          // 더 늦은 수정
  await B.sync.sync(); await A.sync.sync(); await B.sync.sync();
  assert.equal(A.store.get("transactions", "same").amount, 222);
  assert.equal(B.store.get("transactions", "same").amount, 222);
});

test("다른 계정 데이터 접근 불가(RLS) · 미로그인 거부", async () => {
  const srv = mockSupabase();
  const A = await device(srv, 1000); await A.sync.signUp("a@x.com", "pw123456"); await A.sync.setPassphrase("k");
  await A.store.put("transactions", { date: "2026-11-20", type: "income", categoryId: "cat_1", amount: 9, to: "acc_pay" });
  await A.sync.sync();
  const E = await device(srv, 1000); await E.sync.signUp("evil@x.com", "pw123456"); await E.sync.setPassphrase("k");
  await E.sync.sync();
  assert.equal(E.store.state.transactions.length, 0);
  const res = await srv.fetchFn("https://x.supabase.co/rest/v1/finance_records?select=*", { method: "GET", headers: { apikey: "anon" } });
  assert.equal(res.status, 401);
});

test("CSV 왕복 · 기존 원장 형식 가져오기 · 제로셋팅 · JSON 백업", async () => {
  const st = new Store(new MemoryAdapter()); await st.load("2026-11-20");
  await st.put("transactions", { date: "2026-11-20", type: "income", categoryId: "cat_1", amount: 4100000, to: "acc_pay", memo: '메모,"따옴표"' });
  await st.put("transactions", { date: "2026-11-20", type: "transfer", amount: 410000, from: "acc_pay", to: "acc_living" });
  const csv = toCSV(transactionRows(st.state));
  const fresh = new Store(new MemoryAdapter()); await fresh.load("2026-11-20");
  const r = importTransactionsCSV(csv, fresh.state, { newId });
  assert.equal(r.errors.length, 0); assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].memo, '메모,"따옴표"');
  const legacy = "날짜,항목,금액(원),출금통장(선택),메모\n2026-11-20,월급(실수령),\"4,100,000\",,\n2026-11-20,이체→생활비(교보),410000,,\n2026-11-21,이체→비상금(세이프티박스),124000,생활비(교보),재배분\n2026-11-22,새항목,5000,,";
  const r2 = importTransactionsCSV(legacy, fresh.state, { newId });
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.transactions[2].from, "acc_living"); assert.equal(r2.transactions[2].to, "acc_em");
  assert.equal(r2.transactions[0].amount, 4100000);
  assert.equal(r2.newCategories.length, 1);
  // JSON 백업 → 복원
  const backup = JSON.parse(JSON.stringify(st.exportJSON()));
  await fresh.importJSON(backup);
  assert.equal(fresh.state.transactions.length, 2);
  // 제로셋팅: 거래 삭제, 규칙 유지
  await st.put("accounts", { ...st.get("accounts", "acc_living"), value: 0.15 });
  await st.resetAll("2026-11-20");
  assert.equal(st.state.transactions.length, 0);
  assert.equal(st.get("accounts", "acc_living").value, 0.15);
  writeFileSync("/tmp/test_export.xlsx", exportWorkbook(backup.state, "2026-11-22"));
});

test("목록 순서 변경·추가·삭제", async () => {
  const st = new Store(new MemoryAdapter()); await st.load("2026-11-20");
  const ids = st.state.accounts.map((a) => a.id);
  await st.reorder("accounts", [ids[2], ids[0], ids[1], ...ids.slice(3)]);
  assert.deepEqual(st.state.accounts.slice(0, 3).map((a) => a.id), [ids[2], ids[0], ids[1]]);
  const c = await st.put("categories", { name: "주차비", kind: "variable", group: "교통", order: 99 });
  assert.ok(st.state.categories.some((x) => x.id === c.id));
  await st.remove("categories", c.id);
  assert.ok(!st.state.categories.some((x) => x.id === c.id));
});
