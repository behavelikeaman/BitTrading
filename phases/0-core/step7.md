# Step 7: dashboard-ui

## 읽어야 할 파일

- `/docs/PRD.md` (핵심 기능 4 — 실시간 대시보드, 디자인 섹션)
- `/docs/ARCHITECTURE.md` (컴포넌트 목록, 클라이언트는 `src/app/api/*`만 호출)
- `/CLAUDE.md`
- Step 1~4에서 추가된 `src/types/index.ts` (`Signal`, `ScoreItem`, `PositionPlan`)
- Step 6의 `src/app/api/signal/route.ts`, `src/app/api/commentary/route.ts` (응답 형태)

## 작업

`src/app/page.tsx`를 Client Component(`"use client"`)로 완성하고 `src/components/`에 화면 조각을 만든다.

### 레이아웃 (위에서 아래로)

1. **`OrderTicket`** — 화면 최상단 고정. 주문 넣기 전 봐야 할 숫자만 크게:
   - 방향(롱/숏), 확신도 등급
   - 1차 진입가·수량, 물타기 진입가·수량 (레그별로)
   - **손절가**, 익절가, 본전가(물타기 탈출 목표)
   - 총증거금, 총명목가, **청산가**
   - 손절 시 손실(USDT, 자본 대비 %), 목표 도달 시 이익, 손익분기 승률
   - 진입 불가 상태면 이 패널 대신 **왜 불가한지**(`blockers`)를 크게 표시한다.

2. **체결 비용 실측 표시 (ADR-012, ADR-014)** — `/api/account-params`를 페이지 진입 시 1회 호출한다.
   - 수수료: `feeSource === 'measured'`면 실제 수수료율을, `'default'`면 "추정치 0.04%/side" 배지.
   - **슬리피지**: `slippageSource`와 `slippageSampleCount`를 함께 표시한다 (예: "실측 0.018% / 표본 47건" 또는 "추정 0.02%").
   - 둘 중 하나라도 추정치면 `OrderTicket`의 손익분기 승률 옆에 **"체결비용 추정 기준"** 경고를 단다. 사용자는 시장가로 매매하므로 슬리피지가 손익분기 승률을 몇 %p씩 움직인다.
   - **왕복 총마찰**(수수료 + 슬리피지)을 명목가 대비 %와 증거금 대비 %로 나란히 보여준다.

3. **`RiskWarning`** — `plan.warnings`가 비어 있지 않으면 노란 배너로 전부 표시. 청산가가 손절가보다 가깝다는 경고는 빨간색으로 격상.

4. **`ScoreBreakdown`** — 8개 항목을 **전부** 표 형태로. 통과 ✓ / 실패 ✗ 와 `detail` 문자열을 그대로 보여준다. 점수 `n/8`을 헤더에 표시. 실패 항목을 숨기지 마라.

5. **`SignalPanel`** — 현재 지표값(EMA12, SMA20, BB 상·하단, BB 폭, ATR14, ADX14, 거래량/평균)과 마지막 확정봉 시각·종가·펀딩비.

6. **`CandleChart`** — 최근 100개 5분봉과 BB 상·중·하단, EMA12 오버레이. 진입가·손절가·익절가·청산가를 수평선으로 표시.

7. Claude 레짐 해설 — 버튼을 눌러야 `/api/commentary`를 호출한다. **자동 폴링하지 마라** (비용).

### 동작

- `/api/signal`을 5초 간격으로 폴링한다. 탭이 백그라운드면(`document.hidden`) 폴링을 멈춘다.
- `GuardState`(연속 손실, 당일 손익률)는 `useState` + `localStorage`로 클라이언트가 보유하고 쿼리로 넘긴다. 사용자가 직접 수정·초기화할 수 있는 입력 필드를 둔다. v1은 DB가 없다.
- 계좌 설정(자본금, 레버리지, 수수료율, **목표 R배수 `targetRMultiple`**, 리스크 %, ATR 배수)을 조정하는 패널을 두고 `localStorage`에 저장한다. 기본값은 `CLAUDE.md`의 도메인 상수. `targetRMultiple` 입력 옆에는 현재 레버리지 기준 "증거금 대비 순수익 N%" 환산값을 실시간으로 함께 보여준다 (ADR-013).
- 진입 조건이 새로 충족되면(`conviction`이 `none` → `high`/`medium`으로 전이) **브라우저 알림**(Notification API)과 소리로 알린다. 권한은 사용자가 버튼을 눌러 요청하게 한다.

### 디자인

- 어두운 배경, 등폭 폰트. 롱=초록 / 숏=빨강 / 관망=회색, 경고=노랑.
- 숫자 가독성 최우선. 가격은 소수점 1자리, 수량은 4자리, 비율은 2자리로 일관되게 포맷한다. 포맷 함수는 `src/lib/format.ts`에 순수 함수로 두고 테스트를 쓴다.

### 차트 라이브러리

`lightweight-charts` 같은 가벼운 라이브러리 하나만 추가한다. 무거운 차트 프레임워크를 넣지 마라.

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 테스트 + format 테스트 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 클라이언트가 `src/services/`를 import 하지 않고 `/api/*`만 호출하는가? (키 노출 금지, CLAUDE.md CRITICAL)
   - 8개 스코어 항목이 실패 항목 포함 전부 표시되는가?
   - 손절가·청산가·손실 금액이 화면 최상단에 있는가?
   - 진입 불가 시 `blockers`가 표시되는가?
   - 백그라운드 탭에서 폴링이 멈추는가?
   - Claude 해설이 자동 호출되지 않고 버튼으로만 호출되는가?
3. `phases/0-core/index.json`의 step 7을 업데이트한다.

## 금지사항

- 클라이언트에서 거래소 API나 Claude를 직접 호출하지 마라. 이유: 키 노출 (CLAUDE.md CRITICAL).
- 클라이언트에서 지표·사이징을 다시 계산하지 마라. 서버 응답을 그대로 표시하라. 이유: 두 곳의 계산이 갈라지면 화면의 숫자와 검증된 숫자가 달라진다 (ADR-001).
- 실패한 스코어 항목을 숨기지 마라. 이유: "왜 진입 못 하는지"가 이 화면의 핵심 가치다.
- 주문 전송 버튼을 만들지 마라. 이유: v1은 알림 전용 (ADR-002).
- Claude 해설을 폴링에 포함하지 마라. 이유: 5초마다 호출하면 비용이 폭발한다.
- 미확정봉 기준 값을 "현재 시그널"로 표시하지 마라. 마지막 확정봉 시각을 함께 보여줘 언제 기준인지 명확히 하라. 이유: 리페인팅 (ADR-006).
