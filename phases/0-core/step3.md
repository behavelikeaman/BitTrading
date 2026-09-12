# Step 3: risk-engine

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` (핵심 기능 2 — 포지션 계산기, 기준 수치 표)
- `/docs/ADR.md` (**ADR-008 손절은 ATR 기반**, **ADR-009 포지션은 리스크 예산에서 역산**, **ADR-012 수수료·유지증거금은 거래소 실측값**, **ADR-013 목표는 R배수로 정의**)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md` (도메인 상수)
- Step 1의 `src/types/index.ts`, Step 2의 `src/lib/signal/entry.ts` (`Conviction` 타입)

이 step이 이 프로젝트의 핵심이다. ADR-008과 ADR-009를 반드시 읽고 시작하라.

## 배경 (설계 의도 — 벗어나지 마라)

사용자의 기존 방식은 "자본금의 50%를 증거금으로 넣는다"였다. 증거금 비율은 리스크가 아니다. 실제 리스크는 `명목가 × 손절폭`이다. 명목가가 같으면 레버리지 50배든 10배든 손익과 수수료가 동일하고 **청산 거리만 달라진다**. 따라서 이 엔진은 항상 **리스크 예산 → 명목가 → 수량 → 증거금** 순서로 역산한다. 반대 방향으로 계산하지 마라.

## 작업

### 1. 타입 추가 (`src/types/index.ts`에 append)

```ts
export interface AccountConfig {
  equity: number;            // 총자본 (USDT)
  leverage: number;          // 기본 50
  feeRatePerSide: number;    // 명목가 대비. 기본 0.0004 (0.04%)
  maintenanceMarginRate: number; // 기본 0.005 (0.5%)
  riskPctHigh: number;       // 확신 시 리스크 예산. 기본 0.02
  riskPctMedium: number;     // 약간의 확신. 기본 0.01
  atrStopMultiple: number;   // 기본 1.2
  targetRMultiple: number;   // 목표 = 손절폭 x 이 배수. 기본 1.38 (ADR-013)
  feeSource: 'measured' | 'default';  // ADR-012. 화면에 실측/추정 표시용
}

export interface LadderLeg {
  index: number;         // 0 = 1차 진입
  price: number;
  qty: number;           // BTC 수량
  notional: number;
  margin: number;
}

export interface PositionPlan {
  direction: Direction;
  conviction: Conviction;
  legs: LadderLeg[];         // 물타기 포함 전량. 진입 전에 확정된다
  stopPrice: number;         // 래더 전체 공통 손절가
  takeProfitPrice: number;   // 평단 기준 목표가
  breakEvenPrice: number;    // 평단 + 수수료 회수 가격 (물타기 탈출 목표)
  averageEntryPrice: number; // 전량 체결 가정 평단
  totalNotional: number;
  totalMargin: number;
  liquidationPrice: number;  // 전량 체결 가정
  riskBudget: number;        // 손절 도달 시 예상 손실 (USDT, 수수료 포함)
  rewardAtTarget: number;    // 목표 도달 시 예상 순이익 (USDT)
  breakEvenWinRate: number;  // 이 손익비의 손익분기 승률
  warnings: string[];
}
```

### 2. `src/lib/risk/liquidation.ts`

```ts
export function averagePrice(legs: LadderLeg[]): number;

// 격리 증거금. equity가 아니라 포지션 증거금 기준으로 계산한다.
export function liquidationPrice(input: {
  direction: Direction;
  averageEntryPrice: number;
  leverage: number;
  maintenanceMarginRate: number;   // ADR-012: step-margin 구간표에서 읽은 실측값을 우선 사용
}): number;

// Deepcoin step-margin 구간표에서 명목가에 해당하는 유지증거금률을 고른다.
// 구간표가 없으면(키 미설정) 기본값을 그대로 반환한다.
export function resolveMmr(
  notional: number,
  tiers: { maxNotional: number; mmr: number }[] | null,
  fallback: number
): number;

// 평단에서 수수료까지 회수하는 가격 (사용자 방침: 물타기는 본전 탈출)
export function breakEvenPrice(input: {
  direction: Direction;
  averageEntryPrice: number;
  feeRatePerSide: number;
}): number;
```

청산가 공식 — 롱 기준: `avg * (1 - (1/leverage - maintenanceMarginRate))`. 숏은 부호를 뒤집는다.
검증 기준: 50배·MMR 0.5%에서 청산 거리는 **1.5%**여야 한다.

### 3. `src/lib/risk/sizing.ts`

```ts
export function planPosition(input: {
  direction: Direction;
  conviction: Conviction;
  entryPrice: number;
  atr: number;
  account: AccountConfig;
  ladder?: LadderPlanInput;   // 없으면 단일 진입
}): PositionPlan;
```

계산 순서 (**반드시 이 순서**):

1. 리스크 예산 `R` = `equity * (conviction === 'high' ? riskPctHigh : riskPctMedium)`
2. 손절폭 `S` = `atr * atrStopMultiple` (가격 단위)
3. 목표 가격폭 `T` = `S * targetRMultiple` (**손절폭의 배수. 레버리지와 무관하다 — ADR-013**)
   - 검증: 손절 0.42%·배수 1.38 → `T / entryPrice ≈ 0.0058` (0.58%)
   - 화면 표시용으로 증거금 대비 순수익 환산값도 함께 반환한다:
     `targetNetReturnOnMargin = T/entryPrice * leverage - feeRatePerSide*2*leverage`
     검증: 50배·수수료 0.04%/side → `≈ 0.25` (25%)
4. 총명목가 `N` = `R / (S/entryPrice + feeRatePerSide*2)`
5. 수량 = `N / entryPrice`, 증거금 = `N / leverage`
6. `breakEvenWinRate` = `(S/entryPrice + feeRatePerSide*2) / (T/entryPrice + S/entryPrice)`

`warnings`에 담아야 할 경고:

- 청산가가 손절가보다 진입가에 **가까우면** → "청산가가 손절가보다 가깝다. 레버리지를 낮추거나 손절폭을 좁혀라." (ADR-008 위반 상태)
- `feeSource === 'default'` → "수수료율이 추정치다. 실측값을 불러오면 계산이 정확해진다." (ADR-012)
- 총증거금 > `equity` → "증거금이 자본금을 초과한다"
- `breakEvenWinRate > 0.6` → "손익분기 승률 X%. 이 설정으로는 수익을 내기 어렵다."
- `rewardAtTarget < riskBudget` → "손익비가 1 미만이다"

### 4. `src/lib/risk/ladder.ts`

```ts
export interface LadderPlanInput {
  addCount: number;        // 물타기 횟수. 확신 1회, 약간의 확신 2회
  addSpacingAtr: number;   // 물타기 간격 (ATR 배수). 기본 0.6
  weights: number[];       // 각 레그 비중. 합이 1. 예: [0.5, 0.5] 또는 [0.25, 0.25, 0.5]
}

export function buildLadder(input: {
  direction: Direction;
  entryPrice: number;
  atr: number;
  totalNotional: number;
  leverage: number;
  plan: LadderPlanInput;
}): LadderLeg[];
```

**CRITICAL — 래더 전체의 손실이 리스크 예산을 넘지 않아야 한다.** 각 레그는 서로 다른 가격에 진입하므로 손절가까지의 거리가 다르다. `planPosition`은 래더가 있을 때 각 레그의 손절 거리를 가중합한 값으로 총명목가를 역산해야 한다:

```
R = Σ( leg.notional * |leg.price - stopPrice| / leg.price ) + Σ( leg.notional * feeRatePerSide * 2 )
```

단일 진입 공식을 그대로 쓰고 레그만 쪼개면 실제 손실이 예산을 초과한다. 이것이 이 step에서 가장 틀리기 쉬운 지점이다.

손절가는 **1차 진입가 기준이 아니라 마지막 레그보다 더 먼 곳**에 둔다: `stopPrice = 마지막 레그 가격 ∓ atr * atrStopMultiple`.

### 5. `src/lib/risk/guard.ts`

```ts
export function updateGuard(prev: GuardState, tradePnlPct: number): GuardState;
export function isHalted(guard: GuardState, config: { consecutiveLossLimit: number; dailyLossLimitPct: number }): { halted: boolean; reason: string | null };
export function resetDaily(guard: GuardState): GuardState;
```

### 6. 테스트

`liquidation.test.ts`, `sizing.test.ts`, `ladder.test.ts`, `guard.test.ts`. **손계산 기대값을 박아넣어라.** 최소한:

- 청산가: 진입 100,000 / 50배 / MMR 0.5% / 롱 → 98,500 (1.5% 아래). 숏 → 101,500
- 목표 가격폭: 진입 100,000 / 손절 0.42% / `targetRMultiple` 1.38 → `takeProfitPrice ≈ 100,580`
- 증거금 환산: 위 조건 + 50배 + 수수료 0.04%/side → `targetNetReturnOnMargin ≈ 0.25`
- 손익분기 승률: 손절 0.42% / 목표 0.58% / 수수료 0.08% → `≈ 0.50`
- **레버리지 독립성 (ADR-013)**: `leverage`만 50 → 25로 바꿔도 `takeProfitPrice`·`stopPrice`·`totalNotional`이 **변하지 않고** `totalMargin`과 `liquidationPrice`만 변하는지
- `targetRMultiple`을 낮춰 목표를 0.28%로 만들면 손익분기 승률이 `≈ 0.714`로 **올라가는지** (PRD 기준 수치 표와 일치)
- 수수료율을 0.04% → 0.06%로 올리면 손익분기 승률이 `≈ 0.519`로 오르는지 (ADR-012)
- 사이징: equity 5,000 / 리스크 2% / 손절 0.42% / 수수료 0.08% → `riskBudget ≈ 100`, `totalNotional ≈ 20,000`
- **래더 손실 검증 (가장 중요)**: 물타기 2회 래더를 만들고 각 레그가 손절가에 도달했을 때의 총손실을 직접 합산해 `riskBudget`과 `toBeCloseTo`로 일치하는지 확인한다. 오차 허용은 1 USDT 이내.
- 래더 가중치 합이 1이 아니면 예외를 던지는지
- 청산가가 손절가보다 가까운 입력(예: 레버리지 100배, 넓은 손절)에서 `warnings`에 해당 경고가 들어가는지
- `guard`: 3연속 손실 후 `isHalted().halted === true`, 이익 1회 후 `consecutiveLosses === 0`

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # Step 1~2 테스트 + 이번 리스크 테스트 전부 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 파일이 `src/lib/risk/` 아래에 있는가?
   - 계산이 **리스크 예산 → 명목가 → 수량 → 증거금** 순서인가? 증거금 비율에서 출발하지 않았는가? (ADR-009)
   - 청산가를 손절로 쓰지 않는가? 손절이 ATR 기반인가? (ADR-008)
   - 래더 전체 손실이 리스크 예산 이내임을 테스트가 실제 합산으로 검증하는가?
   - `src/lib/` 안에서 외부 I/O·`Date.now()`를 쓰지 않았는가?
3. 결과에 따라 `phases/0-core/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "planPosition·buildLadder·liquidationPrice 시그니처, 계산 순서, 경고 목록, 검증된 기준 수치"`
   - 실패(3회) → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"`

## 금지사항

- 증거금 비율(자본의 몇 %)에서 출발해 수량을 구하지 마라. 이유: 그것이 사용자의 기존 실패 방식이고 ADR-009가 금지한다. 리스크 예산에서 역산해야 한다.
- 청산가를 손절가로 사용하지 마라. 이유: 한 트레이드 손실이 증거금 100%가 되고 손익분기 승률이 88.8%로 올라간다 (ADR-008).
- 래더 각 레그에 단일 진입 손실 공식을 그대로 적용하지 마라. 이유: 레그마다 손절 거리가 달라 총손실이 예산을 초과한다.
- 수량을 거래소 최소 단위로 반올림한 뒤 리스크 검증을 생략하지 마라. 반올림 후 값으로 손실을 다시 계산해 경고를 갱신하라. 이유: 반올림이 리스크 예산을 넘길 수 있다.
- 목표를 "증거금 대비 %"로 정의하지 마라. `targetRMultiple`(손절폭 배수)로 정의하고 % 는 환산해서 보여줘라. 이유: 증거금 대비 %는 레버리지에 종속돼, 레버리지를 바꾸는 순간 같은 이름의 목표가 완전히 다른 전략이 된다 (ADR-013).
- 주문 실행 코드나 거래소 주문 API 호출을 넣지 마라. 이유: v1은 알림 전용 (ADR-002).
- 백테스트 루프를 여기에 넣지 마라. 이유: Step 4의 범위다.
