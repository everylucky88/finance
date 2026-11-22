// 기본 데이터: 기존 월급관리 스프레드시트(2026.7)와 재정관리 xlsx의 통장·규칙을 그대로 옮김.
// 거래·잔액·투자 기록은 모두 비어 있는 '제로셋팅' 상태로 시작한다.

export const SCHEMA_VERSION = 1;

export const ACCOUNT_TYPES = { pay: "급여", spend: "소비", save: "저축", invest: "투자" };
export const METHODS = { ratio: "비율", fixed: "정액", plan: "투자계획", none: "없음" };
export const CAT_KINDS = { income: "수입", fixed: "고정지출", variable: "변동지출" };
export const ASSET_GROUPS = { vr: "VR", growth: "우량주", dividend: "배당주", gold: "금", pension: "연금", crypto: "가상화폐", cash: "현금성", other: "기타" };
export const PLAN_MODES = { annual: "연간계획", account: "통장 정액 연동", none: "계획 없음" };

const acc = (id, name, inst, purpose, type, method, value, target, priority, rebalance, order) =>
  ({ id, name, inst, purpose, type, method, value, target, priority, rebalance, opening: null, order });

export function defaultAccounts() {
  return [
    acc("acc_pay", "급여통장", "국민·농협", "수입 입금, 고정비·카드대금 출금", "pay", "none", null, null, 0, false, 0),
    acc("acc_living", "생활비", "교보증권", "생활용품·주유·식료품·외식·미용", "spend", "ratio", 0.10, 1000000, 1, true, 1),
    acc("acc_leisure", "여가", "카카오뱅크", "놀이·여행·취미·의류·화장품", "spend", "ratio", 0.07, null, 4, false, 2),
    acc("acc_food", "부식", "카카오페이", "출장 중 식사·정산·배달", "spend", "ratio", 0.03, 300000, 2, true, 3),
    acc("acc_inv", "투자", "키움증권", "해외주식(VR·우량주·배당주)", "invest", "plan", null, null, 9, false, 4),
    acc("acc_sav", "적금", "국민키위", "적금", "save", "fixed", 300000, null, 7, false, 5),
    acc("acc_event", "경조사", "농협", "경조사", "spend", "fixed", 50000, 300000, 3, true, 6),
    acc("acc_em", "비상금", "세이프티박스", "목돈·병원비", "save", "fixed", 150000, 3000000, 8, false, 7),
    acc("acc_coin", "가상화폐", "바이낸스", "비트코인", "invest", "fixed", 250000, null, 6, false, 8),
    acc("acc_irp", "IRP", "한국투자증권", "세액공제", "invest", "fixed", 250000, null, 5, false, 9),
  ];
}

export function defaultCategories() {
  const list = [
    ["월급(실수령)", "income", "월급", true], ["초과근무수당", "income", "수당"], ["정근수당", "income", "수당"],
    ["명절휴가비", "income", "수당"], ["성과상여금", "income", "수당"], ["연가보상비", "income", "수당"],
    ["이자·금융수입", "income", "금융수입"], ["기타수입", "income", "기타"],
    ["월세 및 기타", "fixed", "주거"], ["관리비", "fixed", "주거"], ["보험1(암보험)", "fixed", "보험"],
    ["운전자보험", "fixed", "보험"], ["통신요금", "fixed", "통신"], ["인터넷요금", "fixed", "통신"],
    ["본가 인터넷요금", "fixed", "통신"], ["가족모임", "fixed", "가족"], ["아이클라우드", "fixed", "구독"],
    ["OpenAI", "fixed", "구독"], ["컬리페이", "fixed", "구독"], ["유튜브프리미엄", "fixed", "구독"],
    ["신용카드1(국민)", "variable", "카드대금"], ["신용카드2(현대)", "variable", "카드대금"],
    ["의료비", "variable", "의료"], ["경조사비", "variable", "경조사"], ["생활·외식", "variable", "생활"], ["기타지출", "variable", "기타"],
  ];
  const order = { income: 0, fixed: 0, variable: 0 };
  return list.map(([name, kind, group, salary], i) => ({
    id: "cat_" + (i + 1), name, kind, group, salary: !!salary, order: order[kind]++,
  }));
}

export function defaultAssets() {
  const a = (id, name, group, accountId, planMode, annual, rate, baseMonth, order) =>
    ({ id, name, group, accountId, planMode, annual, rate, baseMonth, baseAmount: null, order });
  return [
    a("ast_vr", "VR (TQQQ)", "vr", "acc_inv", "annual", 6000000, 0, "2026-01", 0),
    a("ast_pool", "VR 현금 Pool", "vr", "acc_inv", "none", null, null, null, 1),
    a("ast_blue", "우량주", "growth", "acc_inv", "annual", 9200000, 0.01, "2026-01", 2),
    a("ast_div", "배당주", "dividend", "acc_inv", "annual", 6130000, 0.01, "2026-01", 3),
    a("ast_gold", "금 ETF", "gold", "acc_inv", "none", null, null, null, 4),
    a("ast_irp", "IRP", "pension", "acc_irp", "account", null, null, null, 5),
    a("ast_coin", "가상화폐", "crypto", "acc_coin", "account", null, null, null, 6),
    a("ast_cash", "키움 예수금", "cash", "acc_inv", "none", null, null, null, 7),
    a("ast_etc", "기타 금융자산", "other", "acc_inv", "none", null, null, null, 8),
  ];
}

// 2026.7 시트의 고정 출금 목록. 금액은 당시 값(관리비·카드대금은 매월 변동).
export function defaultTemplates(cats) {
  const id = (n) => cats.find((c) => c.name === n)?.id;
  const rows = [
    ["월세 및 기타", 3, 700000, ""], ["보험1(암보험)", 5, 50504, "국민"], ["아이클라우드", 6, 3300, "카카오페이"],
    ["운전자보험", 11, 19388, "농협"], ["인터넷요금", 15, 15340, "농협"], ["본가 인터넷요금", 23, 16335, "농협"],
    ["통신요금", 23, 66620, "국민"], ["관리비", 25, 134840, "네이버페이 · 매월 변동"], ["가족모임", 26, 50000, "국민"],
    ["OpenAI", null, 33000, "국민 · 결제수단 확인"], ["컬리페이", null, 1900, "농협 · 결제수단 확인"],
    ["유튜브프리미엄", null, null, "카카오페이 · 금액 확인"],
    ["신용카드1(국민)", null, null, "결제대금 매월 입력"], ["신용카드2(현대)", null, null, "결제대금 매월 입력"],
  ];
  return rows.map(([n, day, amount, memo], i) => ({
    id: "tpl_" + (i + 1), categoryId: id(n), day, amount, pay: "account", from: null, memo, active: true, order: i,
  }));
}

export function defaultSettings(startDate) {
  return {
    id: "main", schema: SCHEMA_VERSION, startDate,
    payday: 20, basis: "salary",          // salary | income
    emergencyId: "acc_em", saveTargetId: "acc_em", invTargetId: "acc_inv",
    preRatio: 0.8, postRatio: 0.5,        // 초과분 중 저축 비율 (비상금 목표 전/후)
    irpAccountId: "acc_irp", irpLimit: 6, irpToId: "acc_coin",
    fallback: false,                      // 월말 잔액 미입력 시 소비통장 이체액을 소비로 간주
    unit: 1000,
    deductPendingFixed: true,             // 배분 가용액 계산 시 아직 입력 안 된 고정지출 차감
  };
}

export function createDefaultState(startDate) {
  const categories = defaultCategories();
  return {
    settings: defaultSettings(startDate),
    accounts: defaultAccounts(),
    categories,
    assets: defaultAssets(),
    templates: defaultTemplates(categories),
    transactions: [], snapshots: [], invest: [], months: [],
  };
}

export const COLLECTIONS = ["settings", "accounts", "categories", "assets", "templates", "transactions", "snapshots", "invest", "months"];
