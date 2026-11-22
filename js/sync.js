// Supabase 동기화 (SDK 없이 REST 직접 호출)
// - 로그인: Supabase Auth(이메일+비밀번호) · 접근 제어: RLS(user_id = auth.uid())
// - 선택: 종단간 암호화(AES-GCM, PBKDF2) → 서버에는 암호문만 저장
// - 순서: pull(서버 최신 반영, LWW) → push(남은 변경분 upsert). 서버 트리거도 오래된 덮어쓰기를 거부.

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(passphrase, userId) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("finance-pwa:" + userId), iterations: 210000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { enc: b64(iv) + ":" + b64(ct) };
}
export async function decryptJSON(key, payload) {
  const [iv, ct] = payload.enc.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(dec.decode(pt));
}

const CHECK = { col: "_check", id: "enc" };

export class Sync {
  constructor(store, { fetchFn = (...a) => fetch(...a) } = {}) {
    this.store = store; this.fetch = fetchFn; this.cfg = null; this.session = null; this.key = null; this.busy = false;
  }
  async init() {
    this.cfg = (await this.store.ad.getMeta("syncCfg")) || null;
    this.session = (await this.store.ad.getMeta("session")) || null;
    this.key = (await this.store.ad.getMeta("encKey")) || null;
    return this;
  }
  get configured() { return !!(this.cfg?.url && this.cfg?.anonKey); }
  get signedIn() { return !!this.session?.access_token; }
  async configure(url, anonKey, useEncryption = true) {
    this.cfg = { url: url.replace(/\/+$/, ""), anonKey, useEncryption };
    await this.store.ad.setMeta("syncCfg", this.cfg);
  }
  headers(json = true) {
    // publishable 키(sb_publishable_…)는 Bearer로 보내면 안 됨 → 로그인 토큰이 있을 때만 Authorization 사용
    const h = { apikey: this.cfg.anonKey };
    if (this.session?.access_token) h.Authorization = `Bearer ${this.session.access_token}`;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }
  async _auth(path, body) {
    const res = await this.fetch(`${this.cfg.url}/auth/v1/${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || `인증 실패 (${res.status})`);
    return j;
  }
  async _setSession(j) {
    if (!j.access_token) throw new Error("이메일 확인 후 다시 로그인하세요");
    this.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user?.id, email: j.user?.email } };
    await this.store.ad.setMeta("session", this.session);
  }
  async signUp(email, password) { const j = await this._auth("signup", { email, password }); if (j.access_token) await this._setSession(j); return j; }
  async signIn(email, password) { await this._setSession(await this._auth("token?grant_type=password", { email, password })); }
  async signOut() {
    this.session = null; this.key = null;
    await this.store.ad.setMeta("session", null); await this.store.ad.setMeta("encKey", null); await this.store.ad.setMeta("lastPull", null);
  }
  async ensureToken() {
    if (!this.session) throw new Error("로그인이 필요합니다");
    if (Date.now() < this.session.expires_at - 60000) return;
    await this._setSession(await this._auth("token?grant_type=refresh_token", { refresh_token: this.session.refresh_token }));
  }
  async setPassphrase(passphrase) {
    if (!this.session) throw new Error("로그인이 필요합니다");
    this.key = await deriveKey(passphrase, this.session.user.id);
    await this.store.ad.setMeta("encKey", this.key);    // CryptoKey(추출 불가)로 이 기기에만 보관
  }
  async _rest(method, query, body, extra = {}) {
    await this.ensureToken();
    const res = await this.fetch(`${this.cfg.url}/rest/v1/finance_records${query}`, { method, headers: { ...this.headers(), ...extra }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const t = await res.text(); throw new Error(`동기화 오류 ${res.status}: ${t.slice(0, 160)}`); }
    return method === "GET" ? res.json() : null;
  }
  async _verifyKey() {
    if (!this.cfg.useEncryption) return;
    if (!this.key) throw new Error("암호화 비밀번호를 입력하세요");
    const rows = await this._rest("GET", `?select=data&col=eq.${CHECK.col}&id=eq.${CHECK.id}`);
    if (rows.length) {
      try { const v = await decryptJSON(this.key, rows[0].data); if (v !== "ok") throw 0; }
      catch { throw new Error("암호화 비밀번호가 다른 기기와 다릅니다"); }
    } else {
      await this._rest("POST", "?on_conflict=user_id,col,id", [{ user_id: this.session.user.id, ...CHECK, data: await encryptJSON(this.key, "ok"), updated_at: 1, deleted: false }],
        { Prefer: "resolution=merge-duplicates,return=minimal" });
    }
  }
  async sync() {
    if (this.busy) return { skipped: true };
    if (!this.configured || !this.signedIn) throw new Error("동기화 설정·로그인이 필요합니다");
    this.busy = true;
    try {
      await this._verifyKey();
      // 1) pull
      let since = (await this.store.ad.getMeta("lastPull")) || "1970-01-01T00:00:00Z", pulled = 0;
      for (;;) {
        const rows = await this._rest("GET", `?select=col,id,data,updated_at,deleted,server_ts&col=neq._check&server_ts=gt.${encodeURIComponent(since)}&order=server_ts.asc&limit=500`);
        if (!rows.length) break;
        const list = [];
        for (const r of rows) {
          let data = r.data;
          if (data && data.enc) { if (!this.key) throw new Error("암호화된 데이터입니다. 비밀번호를 입력하세요"); data = await decryptJSON(this.key, data); }
          list.push({ col: r.col, id: r.id, data, updatedAt: Number(r.updated_at), deleted: r.deleted });
        }
        pulled += await this.store.applyRemote(list);
        since = rows[rows.length - 1].server_ts;
        await this.store.ad.setMeta("lastPull", since);
        if (rows.length < 500) break;
      }
      // 2) push
      const dirty = this.store.dirty();
      for (let i = 0; i < dirty.length; i += 200) {
        const chunk = dirty.slice(i, i + 200);
        const body = [];
        for (const r of chunk) body.push({ user_id: this.session.user.id, col: r.col, id: r.id,
          data: this.cfg.useEncryption ? await encryptJSON(this.key, r.data) : r.data, updated_at: r.updatedAt, deleted: r.deleted });
        await this._rest("POST", "?on_conflict=user_id,col,id", body, { Prefer: "resolution=merge-duplicates,return=minimal" });
        await this.store.markClean(chunk);
      }
      const at = new Date().toISOString();
      await this.store.ad.setMeta("lastSync", at);
      return { pulled, pushed: dirty.length, at };
    } finally { this.busy = false; }
  }
}

export const SUPABASE_SQL = `-- Supabase SQL Editor에서 한 번 실행
create table if not exists public.finance_records (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  col text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_ts timestamptz not null default clock_timestamp(),
  primary key (user_id, col, id)
);
create index if not exists finance_records_pull on public.finance_records (user_id, server_ts);
alter table public.finance_records enable row level security;
drop policy if exists "own rows" on public.finance_records;
create policy "own rows" on public.finance_records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.finance_records from anon;
grant select, insert, update, delete on public.finance_records to authenticated;
create or replace function public.finance_lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then return old; end if;
  new.server_ts := clock_timestamp();
  return new;
end $$;
drop trigger if exists finance_lww on public.finance_records;
create trigger finance_lww before insert or update on public.finance_records for each row execute function public.finance_lww();
`;
