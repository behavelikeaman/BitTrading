# Step 4: backtest-engine

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` (핵심 기능 3 — 백테스트, 기준 수치 표)
- `/docs/ADR.md` (**ADR-001 시그널 함수 공유**, **ADR-007 수수료·슬리피지·펀딩·청산 반영**, ADR-006 확정봉)
- `/docs/ARCHITECTURE.md` (백테스트 데이터 흐름)
- `/CLAUDE.md` (룩어헤드 금지 CRITICAL 규칙)
- Step 1 `src/lib/indicators/`, Step 2 `src/lib/signal/`, Step 3 `src/lib/risk/` **전체**

이전 step의 함수를 **그대로 호출**하라. 백테스트용으로 시그널이나 사이징을 다시 구현하면 ADR-001 위반이다.

## 작업

### 1. 타입 추가 (`src/types/index.ts`에 append)

```ts
export interface Trade {
  entryTime: number;
  exitTime: number;
  direction: Direction;
  conviction: Conviction;
  score: number;
  legs: LadderLeg[];          // 실제 체결된 레그만
  averageEntryPrice: number;
  exitPrice: number;
  exitReason: 'take-profit' | 'stop-loss' | 'liquidation' | 'timeout' | 'end-of-data';
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  netPnlPct: number;          // 자본 대비
}

export interface BacktestParams {
  account: AccountConfig;
  entry: EntryConfig;
  ladderHigh: LadderPlanInput;
  ladderMedium: LadderPlanInput;
  slippageRate: number;        // 명목가 대비 편도. 기본 0.0002
  fundingRatePerInterval: number; // 8시간당. 기본 0.0001
  maxHoldBars: number;         // 타임아웃 청산. 기본 36 (3시간)
}

export interface BacktestResult {
  trades: Trade[];
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;          // 트레이드당 평균 순손익 (USDT)
  maxDrawdown: number;         // 자본 대비 비율
  maxConsecutiveLosses: number;
  totalFees: number;
  totalFunding: number;
  finalEquity: number;
  liquidationCount: number;
  equityCurve: { time: number; equity: number }[];
}
```

### 2. `src/lib/backtest/engine.ts`

```ts
export function runBacktest(input: {
  candles5m: Candle[];
  candles15m: Candle[];
  fundingSeries?: { time: number; rate: number }[];
  params: BacktestParams;
}): BacktestResult;
```

루프 규칙 — **이 순서를 지켜라. 룩어헤드의 원천이다.**

1. 확정봉 `i`에 대해 지표와 시그널을 계산할 때 **`candles.slice(0, i+1)`만** 넘긴다. `i+1` 이후 캔들을 절대 참조하지 마라.
2. 15분봉은 `candles5m[i].openTime` **이하로 이미 종료된** 15분봉만 넘긴다. 아직 진행 중인 15분봉을 넘기면 미래 정보가 샌다.
3. `evaluateEntry`에는 `nowMs = candles5m[i].openTime`을 넘긴다 (세션 필터가 백테스트에서도 동일하게 동작해야 한다).
4. 진입 신호가 나면 **체결은 캔들 `i+1`의 시가**부터다. 슬리피지를 불리한 방향으로 적용한다 (롱은 시가 + slippage, 숏은 시가 − slippage).
5. 포지션 보유 중 각 캔들에서 도달 판정을 하되, 한 캔들 안에서 손절과 익절이 모두 닿을 수 있다. 이때는 **항상 손절이 먼저 체결된 것으로 처리한다.** 이유: 5분봉 안의 순서를 알 수 없으므로 낙관적 가정은 백테스트를 부풀린다.
6. 도달 판정 우선순위: **청산 > 손절 > 물타기 체결 > 익절**. 청산가에 캔들 저가(롱)·고가(숏)가 닿으면 즉시 청산 처리하고 해당 포지션 증거금 전액을 손실로 기록한다.
7. 물타기 레그는 가격이 레그 가격에 닿아야만 체결된다. 닿지 않고 익절·손절되면 미체결 레그는 `Trade.legs`에 넣지 않는다.
8. 펀딩은 8시간 경계(UTC 00/08/16시)를 넘어 보유 중인 포지션에만 부과한다. 롱은 펀딩이 양수일 때 지불, 숏은 수령.
9. `maxHoldBars`를 넘기면 종가로 타임아웃 청산한다.
10. 동시에 하나의 포지션만 보유한다. 보유 중에는 새 신호를 무시한다.
11. 매 트레이드 종료 후 `updateGuard`로 `GuardState`를 갱신하고, 다음 신호 평가에 그대로 넘긴다. 서킷브레이커가 백테스트에도 반영되어야 한다.
12. `AccountConfig.equity`는 실현 손익에 따라 갱신한다(복리). 다음 트레이드 사이징이 갱신된 자본을 쓴다.

### 3. `src/lib/backtest/metrics.ts`

```ts
export function computeMetrics(trades: Trade[], startingEquity: number): Omit<BacktestResult, 'trades'>;
```

- `profitFactor` = 총이익 / |총손실|. 손실이 0이면 `Infinity` 대신 `null`이 아니라 유한한 큰 값 대신 **`Number.POSITIVE_INFINITY`를 반환하고 UI에서 처리**한다.
- `maxDrawdown`은 equity curve의 고점 대비 최대 낙폭 비율.
- 트레이드가 0개면 모든 지표가 0이고 예외를 던지지 않아야 한다.

### 4. 테스트

`engine.test.ts`, `metrics.test.ts`. 합성 캔들로 **결과가 손계산으로 검증 가능한** 시나리오를 만들어라. 최소한:

- **룩어헤드 검증 (필수)**: 캔들 배열의 뒷부분을 바꿔도 앞부분 트레이드 결과가 동일한지. 즉 `runBacktest(candles)`의 처음 N개 트레이드와 `runBacktest(candles.slice(0, k))`의 트레이드가 일치하는지 검증한다. 이 테스트가 통과하지 않으면 엔진은 쓸모가 없다.
- 목표가에 정확히 닿는 캔들 → `exitReason === 'take-profit'`, `netPnl`이 손계산 기대값과 일치 (수수료·슬리피지 차감 후)
- 손절가와 익절가가 **같은 캔들 안에** 모두 닿는 경우 → `exitReason === 'stop-loss'`
- 청산가에 닿는 캔들 → `exitReason === 'liquidation'`, 손실이 해당 포지션 증거금 전액
- 물타기 가격에 닿지 않은 트레이드 → `legs.length === 1`
- 8시간 경계를 넘겨 보유한 트레이드 → `funding !== 0`
- `maxHoldBars` 초과 → `exitReason === 'timeout'`
- 3연속 손실 후 서킷브레이커가 걸려 다음 신호가 무시되는지
- 신호가 전혀 없는 횡보 캔들 → `totalTrades === 0`, 예외 없음
- `computeMetrics([], 5000)` → 전 지표 0, 예외 없음

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # Step 1~3 테스트 + 이번 백테스트 테스트 전부 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 파일이 `src/lib/backtest/` 아래에 있는가?
   - Step 2~3의 `evaluateEntry`·`planPosition`·`buildLadder`를 **그대로 호출**하는가? 재구현한 부분이 없는가? (ADR-001)
   - 지표·시그널 계산에 `slice(0, i+1)`만 넘기는가? 룩어헤드 테스트가 통과하는가?
   - 수수료·슬리피지·펀딩·청산이 전부 반영되는가? (ADR-007)
   - 같은 캔들에서 손절·익절 동시 도달 시 손절을 택하는가?
3. 결과에 따라 `phases/0-core/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "runBacktest·computeMetrics 시그니처, 체결 규칙(우선순위·슬리피지·펀딩), 룩어헤드 테스트 통과 여부"`
   - 실패(3회) → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"`

## 금지사항

- 시그널·사이징 로직을 백테스트용으로 다시 구현하지 마라. 이유: 재구현 드리프트가 "백테스트는 되는데 실전은 안 되는" 1순위 원인이다 (ADR-001).
- 캔들 `i`의 신호를 캔들 `i`의 종가로 체결하지 마라. 이유: 종가는 캔들이 끝나야 확정되므로 그 가격에 진입할 수 없다. `i+1` 시가를 써라.
- 한 캔들에서 손절·익절이 모두 닿을 때 익절을 택하지 마라. 이유: 낙관적 가정이 백테스트를 부풀린다.
- 수수료·슬리피지·펀딩을 생략하거나 "나중에 추가"로 미루지 마라. 이유: 왕복 수수료 0.08%는 목표 0.58%의 14%다. 빼고 돌린 결과는 의사결정에 쓸 수 없다 (ADR-007).
- 청산 판정을 생략하지 마라. 이유: 50배에서 이미 사라졌을 계좌가 백테스트에서 살아남아 전략이 좋아 보인다.
- 외부 API를 호출하거나 파일을 읽지 마라. 캔들은 인자로 받는다. 이유: `src/lib/`는 순수 함수다.
