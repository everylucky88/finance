// 내보내기(CSV·XLSX)와 가져오기(CSV: 앱 형식 / 기존 스프레드시트 원장 형식)
import { buildContext, monthSummary, addMonths, ymOf } from "./calc.js";

const TYPE_KO = { income: "수입", expense: "지출", transfer: "이체" };

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCSV = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// ------------------------------------------------------------------ tables
export function transactionRows(state) {
  const acc = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
  const cat = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));
  const rows = [["날짜", "구분", "항목", "금액", "출금통장", "입금통장", "메모"]];
  for (const t of [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)))
    rows.push([t.date, TYPE_KO[t.type] || t.type, t.type === "transfer" ? "이체" : cat[t.categoryId] || "", t.amount, acc[t.from] || "", acc[t.to] || "", t.memo || ""]);
  return rows;
}
export function monthlyRows(state, today) {
  const ctx = buildContext(state, today);
  const rows = [["연월", "총수입", "월급", "고정지출", "변동지출", "소비통장 사용", "실제 소비", "통장 이체", "저축·투자금", "저축·투자율", "남은 현금", "신규 매수", "배당", "투자 평가액", "평가손익", "현금성 자산", "순자산", "순자산 증감"]];
  for (let m = ctx.firstYm; m <= ctx.lastYm; m = addMonths(m, 1)) {
    const s = monthSummary(ctx, m);
    rows.push([m, s.income, s.salary, s.fixed, s.variable, s.envelopeTotal, s.consumption, s.transfers, s.savingsInvest, s.rate == null ? "" : Math.round(s.rate * 1000) / 1000,
      s.cashLeft, s.newBuy, s.dividend, s.investValue, s.gain ?? "", s.cash, s.netWorth, s.netWorthChange ?? ""]);
  }
  return rows;
}
export function investRows(state) {
  const an = Object.fromEntries(state.assets.map((a) => [a.id, a.name]));
  const rows = [["연월", "자산", "신규 투자", "평가금(원)", "평가금(USD)", "배당", "메모"]];
  for (const r of [...state.invest].sort((a, b) => (a.month < b.month ? -1 : 1))) rows.push([r.month, an[r.assetId] || r.assetId, r.newAmount ?? "", r.value ?? "", r.valueUsd ?? "", r.dividend ?? "", r.memo || ""]);
  return rows;
}
export function snapshotRows(state) {
  const an = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
  const rows = [["연월", "통장", "확인 잔액"]];
  for (const r of [...state.snapshots].sort((a, b) => (a.month < b.month ? -1 : 1))) rows.push([r.month, an[r.accountId] || r.accountId, r.amount]);
  return rows;
}
export function accountRows(state) {
  const rows = [["통장", "기관", "용도", "유형", "배분방식", "기준값", "목표잔액", "우선순위", "재배분"]];
  const T = { pay: "급여", spend: "소비", save: "저축", invest: "투자" }, M = { ratio: "비율", fixed: "정액", plan: "투자계획", none: "없음" };
  for (const a of state.accounts) rows.push([a.name, a.inst, a.purpose, T[a.type], M[a.method], a.value ?? "", a.target ?? "", a.priority, a.rebalance ? "Y" : ""]);
  return rows;
}

// ------------------------------------------------------------------ minimal XLSX (zip store, inline strings)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) { // [{name, data:Uint8Array}]
  const te = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const nm = te.encode(f.name), c = crc32(f.data), sz = f.data.length;
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)]);
    parts.push(head, nm, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += head.length + nm.length + sz;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end], total = all.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total);
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(rows) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'];
  const n = Math.max(...rows.map((r) => r.length));
  for (let i = 0; i < n; i++) out.push(`<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 12 : 14}" customWidth="1"/>`);
  out.push("</cols><sheetData>");
  rows.forEach((r, ri) => {
    out.push(`<row r="${ri + 1}">`);
    r.forEach((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof v === "number" && Number.isFinite(v)) out.push(`<c r="${ref}"${ri === 0 ? ' s="1"' : Math.abs(v) < 1 && v !== 0 ? ' s="3"' : ' s="2"'}><v>${v}</v></c>`);
      else if (v !== "" && v != null) out.push(`<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`);
    });
    out.push("</row>");
  });
  out.push("</sheetData></worksheet>");
  return out.join("");
}
export function buildXLSX(sheets) { // [{name, rows}]
  const te = new TextEncoder();
  const files = [
    { name: "[Content_Types].xml", s: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", s: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", s: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", s: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", s: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, s: sheetXml(s.rows) })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: te.encode(f.s) })));
}
export function exportWorkbook(state, today) {
  return buildXLSX([
    { name: "월별요약", rows: monthlyRows(state, today) },
    { name: "거래내역", rows: transactionRows(state) },
    { name: "투자기록", rows: investRows(state) },
    { name: "잔액확인", rows: snapshotRows(state) },
    { name: "통장설정", rows: accountRows(state) },
  ]);
}

// ------------------------------------------------------------------ import
function normDate(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  return null;
}
const num = (s) => Number(String(s).replace(/[₩,\s원]/g, "")) || 0;

// 앱 CSV(날짜,구분,항목,금액,출금통장,입금통장,메모) 또는 기존 원장 CSV(날짜,항목,금액,출금통장,메모)를 거래로 변환
export function importTransactionsCSV(text, state, { newId }) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("빈 파일입니다");
  const h = rows[0].map((x) => x.trim());
  const ix = (re) => h.findIndex((x) => re.test(x));
  const iDate = ix(/날짜/), iType = ix(/^구분/), iItem = ix(/항목/), iAmt = ix(/금액/), iFrom = ix(/출금/), iTo = ix(/입금/), iMemo = ix(/메모/);
  if (iDate < 0 || iAmt < 0) throw new Error("날짜·금액 열을 찾을 수 없습니다");
  const findAcc = (name) => {
    if (!name) return null;
    const n = name.trim();
    return state.accounts.find((a) => a.name === n || `${a.name}(${a.inst})` === n || n.startsWith(a.name + "(") || n.startsWith(a.name + " "))?.id
      || (/^급여/.test(n) ? state.accounts.find((a) => a.type === "pay")?.id : null);
  };
  const pay = state.accounts.find((a) => a.type === "pay")?.id;
  const cats = [...state.categories];
  const newCats = [], txs = [], errors = [];
  let createdAt = Date.now();
  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const date = normDate(r[iDate] || ""), amount = num(r[iAmt] ?? "");
    const item = (iItem >= 0 ? r[iItem] : "").trim();
    if (!date || !amount) { if (r.some((x) => x.trim())) errors.push(`${line}행: 날짜/금액 확인`); return; }
    let type = iType >= 0 ? { 수입: "income", 지출: "expense", 이체: "transfer" }[(r[iType] || "").trim()] : null;
    let to = iTo >= 0 ? findAcc(r[iTo]) : null;
    const from = iFrom >= 0 ? findAcc(r[iFrom]) : null;
    if (item.startsWith("이체→")) { type = "transfer"; to = findAcc(item.slice(3)); }
    const memo = iMemo >= 0 ? (r[iMemo] || "").trim() : "";
    if (type === "transfer") {
      if (!to) { errors.push(`${line}행: 입금통장 '${item || r[iTo]}' 없음`); return; }
      txs.push({ id: newId("tr_"), date, type, amount, from: from || pay, to, memo, createdAt: createdAt++ });
      return;
    }
    let c = cats.find((x) => x.name === item);
    if (!c) {
      const kind = type === "income" ? "income" : "variable";
      c = { id: newId("cat_"), name: item || (type === "income" ? "기타수입" : "기타지출"), kind, group: "가져옴", salary: false, order: 999 };
      cats.push(c); newCats.push(c);
    }
    if (!type) type = c.kind === "income" ? "income" : "expense";
    txs.push(type === "income" ? { id: newId("tr_"), date, type, categoryId: c.id, amount, to: to || pay, memo, createdAt: createdAt++ }
      : { id: newId("tr_"), date, type, categoryId: c.id, amount, from: from || pay, memo, createdAt: createdAt++ });
  });
  return { transactions: txs, newCategories: newCats, errors };
}
