# 재정관리 PWA

> 설치·동기화 단계별 안내는 **설치가이드.md** 참고

월급 배분 · 목적별 통장 · 투자 · 순자산을 관리하는 개인용 웹앱. 홈 화면에 추가하면 앱처럼 실행됩니다.
데이터는 기본적으로 **기기 안(IndexedDB)** 에만 저장되고, 동기화를 켜면 Supabase로 암호화해 전송합니다.

## 1. 배포 (택1, 최초 1회)
**GitHub Pages (권장 · 무료 · 영구)**
1. github.com → New repository (예: `finance`, Private도 가능하나 Pages는 Public 필요 — 데이터는 저장소에 올라가지 않음)
2. 이 폴더의 파일 전체를 업로드 (Add file → Upload files)
3. Settings → Pages → Branch `main` / root → Save → 1~2분 뒤 `https://아이디.github.io/finance/` 생성

**Netlify Drop**: app.netlify.com/drop 에 폴더를 끌어다 놓기 → 계정 연결 시 영구 URL

## 2. 아이폰·아이패드 설치
Safari로 URL 열기 → 공유 버튼 → **홈 화면에 추가**. 맥은 Safari → 파일 → Dock에 추가.
※ 기기마다 저장소가 따로이므로 여러 기기에서 같은 데이터를 보려면 3번 동기화를 켭니다.

## 3. 동기화 (선택)
1. supabase.com 무료 프로젝트 생성
2. SQL Editor에 앱의 *설정 → 동기화 → 데이터베이스 SQL*을 붙여넣고 실행 (테이블·RLS·충돌방지 트리거)
3. Authentication → Users → Add user(Auto Confirm)로 계정 생성 → Project URL·Publishable key를 앱에 입력 → 로그인 → 암호화 비밀번호 설정
4. 다른 기기도 같은 계정·같은 암호화 비밀번호로 로그인
- Authentication → Providers → Email에서 "Allow new users to sign up"을 본인 가입 후 끄면 타인 가입 차단

## 4. 매달 루틴 (5~10분)
1. 급여일: **+ → 수입 → 금액 → 월급** 저장
2. 통장 탭: **고정지출 n건** 일괄 입력(카드대금 금액만 채움) → 배분 권장액대로 이체 → **이체 완료**
3. 월말: **잔액 확인**(통장 실제 잔액) · 자산 탭 **월말 기록**(평가액·신규매수·배당)
4. 홈에서 확인 · '이번 달 할 일' 처리

## 5. 계산 원칙
- 카드: 사용분은 입력하지 않고 결제대금만 지출로 기록 (이중 집계 방지)
- 이체는 소비가 아님. 소비통장(생활비·여가·부식·경조사) 사용액 = 예상 잔액 − 확인 잔액
- 저축·투자금 = 급여/소비통장 → 저축·투자통장 유입
- 평가손익 = 투자자산 총평가액 변화 − 투자계좌 순유입 (예수금·Pool도 평가액으로 입력)
- 남은 현금(급여통장 순증)과 순자산 증감은 별개 지표

## 6. 개발
- 구조: `js/calc.js`(계산, 순수함수) · `js/store.js`(로컬 저장) · `js/sync.js`(Supabase) · `js/io.js`(CSV/XLSX) · `js/app.js`(화면)
- 빌드 불필요(순수 ES Module). 로컬 실행: `python3 -m http.server` → http://localhost:8000
- 테스트: `npm test` (계산 회귀·동기화·내보내기 18건)
- 앱 업데이트 시 `sw.js`의 VERSION을 올려 배포
