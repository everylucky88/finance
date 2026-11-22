// Local-first 저장소: 모든 데이터를 레코드 단위로 IndexedDB에 즉시 저장(자동 저장 · 오프라인).
// 레코드 = {key, col, id, data, updatedAt, deleted, dirty}. 삭제는 동기화를 위해 소프트 삭제.
import { createDefaultState, COLLECTIONS, SCHEMA_VERSION } from "./defaults.js";

export class MemoryAdapter {
  constructor() { this.recs = new Map(); this.meta = new Map(); }
  async getAll() { return [...this.recs.values()].map((r) => structuredClone(r)); }
  async putMany(list) { for (const r of list) this.recs.set(r.key, structuredClone(r)); }
  async clear() { this.recs.clear(); }
  async getMeta(k) { return this.meta.get(k); }
  async setMeta(k, v) { this.meta.set(k, v); }
}

export class IDBAdapter {
  constructor(name = "finance-pwa") { this.name = name; this.db = null; }
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "key" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => { this.db = req.result; res(this.db); };
      req.onerror = () => rej(req.error);
    });
  }
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      let out;
      Promise.resolve(fn(st)).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("저장 실패"));
    });
  }
  getAll() { return this.tx("records", "readonly", (st) => new Promise((r) => { const q = st.getAll(); q.onsuccess = () => r(q.result); })); }
  putMany(list) { return this.tx("records", "readwrite", (st) => { for (const r of list) st.put(r); }); }
  clear() { return this.tx("records", "readwrite", (st) => st.clear()); }
  getMeta(k) { return this.tx("meta", "readonly", (st) => new Promise((r) => { const q = st.get(k); q.onsuccess = () => r(q.result); })); }
  setMeta(k, v) { return this.tx("meta", "readwrite", (st) => st.put(v, k)); }
}

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const newId = (p = "") => p + uid();

export class Store {
  constructor(adapter, { now = () => Date.now() } = {}) {
    this.ad = adapter; this.now = now; this.recs = new Map(); this.listeners = new Set(); this.state = null;
  }
  key(col, id) { return `${col}:${id}`; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.state = this.build(); for (const f of this.listeners) f(this.state); }

  async load(defaultStart) {
    const all = await this.ad.getAll();
    for (const r of all) this.recs.set(r.key, r);
    if (!this.get("settings", "main")) await this.seed(defaultStart);
    this.state = this.build();
    return this.state;
  }
  get(col, id) { const r = this.recs.get(this.key(col, id)); return r && !r.deleted ? r.data : null; }
  build() {
    const st = { settings: null };
    for (const c of COLLECTIONS) if (c !== "settings") st[c] = [];
    for (const r of this.recs.values()) {
      if (r.deleted) continue;
      if (r.col === "settings") { if (r.id === "main") st.settings = r.data; }
      else if (st[r.col]) st[r.col].push(r.data);
    }
    for (const c of ["accounts", "categories", "assets", "templates"]) st[c].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return st;
  }
  _rec(col, data, deleted = false) {
    const t = Math.max(this.now(), (this.recs.get(this.key(col, data.id))?.updatedAt || 0) + 1);
    return { key: this.key(col, data.id), col, id: data.id, data: structuredClone(data), updatedAt: t, deleted, dirty: true };
  }
  async putMany(items) {          // items: [col, data]
    const list = items.map(([col, data]) => this._rec(col, col === "transactions" && !data.createdAt ? { ...data, createdAt: this.now() } : data));
    await this.ad.putMany(list);   // 디스크 기록이 끝난 뒤에 화면 반영 → 데이터 손실 방지
    for (const r of list) this.recs.set(r.key, r);
    this.emit();
    return list.map((r) => r.data);
  }
  async put(col, data) {
    if (!data.id) data = { ...data, id: newId(col.slice(0, 2) + "_") };
    if (col === "transactions" && !data.createdAt) data = { ...data, createdAt: this.now() };
    return (await this.putMany([[col, data]]))[0];
  }
  async remove(col, id) {
    const cur = this.recs.get(this.key(col, id));
    if (!cur) return;
    const r = this._rec(col, cur.data, true);
    await this.ad.putMany([r]); this.recs.set(r.key, r); this.emit();
  }
  async removeMany(pairs) {
    const list = pairs.map(([col, id]) => this.recs.get(this.key(col, id))).filter(Boolean).map((c) => this._rec(c.col, c.data, true));
    await this.ad.putMany(list); for (const r of list) this.recs.set(r.key, r); this.emit();
  }
  async reorder(col, ids) {
    const items = ids.map((id, i) => { const d = this.get(col, id); return d && d.order !== i ? [col, { ...d, order: i }] : null; }).filter(Boolean);
    if (items.length) await this.putMany(items);
  }
  async seed(startDate) {
    const st = createDefaultState(startDate);
    const items = [["settings", st.settings]];
    for (const c of COLLECTIONS) if (c !== "settings") for (const d of st[c]) items.push([c, d]);
    // 기본값은 updatedAt=1 → 다른 기기에서 수정한 값이 항상 우선(동기화 시 기본값이 덮어쓰지 않음)
    const list = items.map(([c, d]) => ({ ...this._rec(c, d), updatedAt: 1 }));
    await this.ad.putMany(list); for (const r of list) this.recs.set(r.key, r);
  }
  // 제로셋팅: 기존 레코드를 모두 삭제 표시(다른 기기에도 전파) 후 기본값 재생성
  async resetAll(startDate, { keepRules = true } = {}) {
    const keep = keepRules ? structuredClone(this.build()) : null;
    const del = [...this.recs.values()].filter((r) => !r.deleted).map((r) => this._rec(r.col, r.data, true));
    await this.ad.putMany(del); for (const r of del) this.recs.set(r.key, r);
    const st = createDefaultState(startDate);
    if (keep) {
      for (const c of ["accounts", "categories", "assets", "templates"]) st[c] = keep[c];
      st.settings = { ...keep.settings, startDate };
      st.accounts = st.accounts.map((a) => ({ ...a, opening: null }));
    }
    const items = [["settings", st.settings]];
    for (const c of COLLECTIONS) if (c !== "settings") for (const d of st[c]) items.push([c, d]);
    await this.putMany(items);
  }
  exportJSON() {
    return { app: "finance-pwa", schema: SCHEMA_VERSION, exportedAt: new Date(this.now()).toISOString(), state: this.build() };
  }
  async importJSON(obj) {
    const st = obj?.state;
    if (!st || !st.settings || !Array.isArray(st.accounts)) throw new Error("백업 파일 형식이 아닙니다");
    const del = [...this.recs.values()].filter((r) => !r.deleted).map((r) => this._rec(r.col, r.data, true));
    await this.ad.putMany(del); for (const r of del) this.recs.set(r.key, r);
    const items = [["settings", { ...st.settings, id: "main" }]];
    for (const c of COLLECTIONS) if (c !== "settings") for (const d of st[c] || []) items.push([c, d]);
    await this.putMany(items);
  }
  // --- sync helpers ---
  dirty() { return [...this.recs.values()].filter((r) => r.dirty); }
  async applyRemote(list) {        // LWW: 더 최신 updatedAt이 이김
    const upd = [];
    for (const rm of list) {
      const key = this.key(rm.col, rm.id);
      const cur = this.recs.get(key);
      if (cur && cur.updatedAt >= rm.updatedAt) continue;
      upd.push({ key, col: rm.col, id: rm.id, data: rm.data, updatedAt: rm.updatedAt, deleted: !!rm.deleted, dirty: false });
    }
    if (upd.length) { await this.ad.putMany(upd); for (const r of upd) this.recs.set(r.key, r); this.emit(); }
    return upd.length;
  }
  async markClean(pushed) {
    const upd = [];
    for (const p of pushed) { const cur = this.recs.get(p.key); if (cur && cur.updatedAt === p.updatedAt && cur.dirty) upd.push({ ...cur, dirty: false }); }
    if (upd.length) { await this.ad.putMany(upd); for (const r of upd) this.recs.set(r.key, r); }
  }
}
