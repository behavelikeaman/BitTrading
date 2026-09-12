# Step 0: execution-machine

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/PRD.md` (Phase 1 섹션 — 페이퍼의 역할은 엣지 측정이 아니라 배선 검증이다)
- `/docs/ADR.md` (**ADR-016 상태 기계 공유**, ADR-001 백테스트·실시간 함수 공유, ADR-021 주문 경로 없음)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md`
- **`src/lib/backtest/engine.ts` 전체** — 이 step은 이 파일의 리팩터링이다
- `src/lib/backtest/engine.test.ts`, `src/lib/backtest/lookahead.test.ts` — 지켜야 할 동작이 전부 여기 있다
- `src/lib/risk/` 전체, `src/lib/signal/entry.ts`

## 배경 (설계 의도 — 벗어나지 마라)

현재 체결·청산 판정이 `runBacktest`의 for 루프 안에 박혀 있다. 페이퍼 트레이더는 같은 판정을 **캔들 하나씩, 프로세스 재시작을 견디며** 수행해야 한다. 로직을 복사하면 두 경로가 어긋나고, 그 순간 페이퍼는 아무것도 검증하지 못하게 된다 (ADR-016).

따라서 판정을 **순수 상태 기계**로 추출하고 백테스트가 그것을 쓰도록 바꾼다. 이 step은 **동작을 바꾸지 않는 리팩터링**이다.

## 작업

### 1. `src/lib/execution/types.ts`

백테스트 엔진 내부에 있던 `PendingOrder`·`OpenPosition`을 export 가능한 타입으로 옮긴다. **직렬화 가능해야 한다** — 페이퍼가 JSON 파일에 저장한다. 함수·클래스·Map·Set을 필드에 두지 마라.

```ts
export interface PendingOrder {
  direction: Direction;
  conviction: Conviction;
  score: number;
  /** 체결 시도를 시작할 캔들의 openTime (인덱스가 아니라 시각) */
  fromTime: number;
  limitPrice: number;
  /** 지정가 만료 캔들의 openTime (포함) */
  expiresAtTime: number;
  atrAtSignal: number;
}

export interface OpenPosition {
  direction: Direction;
  conviction: Conviction;
  score: number;
  entryTime: number;
  filled: LadderLeg[];
  pending: LadderLeg[];
  stopPrice: number;
  targetWidth: number;
  fees: number;
  funding: number;
  equityAtEntry: number;
  lastFundingBoundary: number;
}

export interface ExecutionConfig {
  account: AccountConfig;
  ladderHigh: LadderPlanInput;
  ladderMedium: LadderPlanInput;
  entryType: 'market' | 'limit';
  fundingRatePerInterval: number;
  maxHoldBars: number;
  qtyStep: number;
  mmrTiers: { maxNotional: number; mmr: number }[] | null;
}
```

**인덱스를 시각으로 바꾸는 것이 핵심이다.** 백테스트는 배열 인덱스를 쓸 수 있지만 페이퍼는 재시작 후 인덱스가 의미를 잃는다. `entryIndex`/`fromIndex`/`expiresAtIndex`를 전부 `openTime` 기반으로 바꿔라. `maxHoldBars` 판정은 `(candle.openTime - position.entryTime) / 300000 >= maxHoldBars`로 한다.

### 2. `src/lib/execution/machine.ts`

```ts
export interface StepInput {
  candle: Candle;
  pending: PendingOrder | null;
  position: OpenPosition | null;
  equity: number;
  config: ExecutionConfig;
}

export interface StepOutput {
  pending: PendingOrder | null;
  position: OpenPosition | null;
  /** 이 캔들에서 종료된 트레이드. 없으면 null. */
  trade: Trade | null;
}

/** 확정봉 하나를 소화해 상태를 전이시킨다. 순수 함수다. */
export function stepExecution(input: StepInput): StepOutput;

/** 신호에서 대기 주문을 만든다. */
export function createPendingOrder(input: {
  signal: Signal;
  candle: Candle;
  limitValidBars: number;
}): PendingOrder | null;

/** 데이터가 끝났거나 강제 종료할 때 현재가로 정리한다. */
export function forceClose(
  position: OpenPosition,
  candle: Candle,
  config: ExecutionConfig,
  reason: ExitReason,
): Trade;
```

`stepExecution`은 현재 `runBacktest` 루프 본문의 1~3번 구간(펀딩 → 대기 주문 체결 → 레벨 판정)을 그대로 옮긴 것이다. **판정 순서와 규칙을 바꾸지 마라:**

- 캔들 내 레벨은 물리적 순서로 처리한다 (롱은 높은 가격부터, 숏은 낮은 가격부터)
- 물타기 레그를 체결할 때마다 청산가를 다시 계산한다
- 손절과 익절이 같은 캔들에 모두 닿으면 손절을 택한다
- 시장가 슬리피지는 항상 불리한 방향
- 청산 손실은 투입 증거금을 넘지 않는다

### 3. `src/lib/backtest/engine.ts` 리팩터링

`runBacktest`가 `stepExecution`·`createPendingOrder`·`forceClose`를 호출하도록 바꾼다. 엔진에는 **루프·시그널 평가·가드 갱신·자본 복리·집계**만 남는다. 체결 판정 코드가 엔진에 남아 있으면 이 step은 실패다.

### 4. 등가성 검증 (이 step의 합격 기준)

**기존 테스트 196개가 단 하나도 바뀌지 않고 전부 통과해야 한다.** 테스트를 고쳐서 통과시키지 마라. 테스트가 깨지면 리팩터링이 동작을 바꾼 것이다.

추가로 `src/lib/execution/machine.test.ts`를 작성한다:

- 같은 입력에 대해 `stepExecution`을 두 번 호출하면 같은 출력이 나온다 (순수성)
- 입력 객체를 변경하지 않는다 (`position.filled`를 push 하지 말고 새 배열을 만들어라 — 페이퍼가 상태를 저장·복원하므로 변이는 버그가 된다)
- `JSON.parse(JSON.stringify(state))`로 왕복한 상태를 넣어도 같은 결과가 나온다 (직렬화 안전성)
- `maxHoldBars` 판정이 인덱스가 아니라 시각 기준으로 동작한다 (캔들이 중간에 빠져도 올바른 시점에 타임아웃)

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 196개 + 신규 machine 테스트 전부 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `src/lib/execution/`에 상태 기계가 있고 `src/lib/backtest/engine.ts`에는 체결 판정 코드가 남아 있지 않은가?
   - 기존 테스트 파일을 **수정하지 않았는가?** (`git diff --stat src/lib/backtest/*.test.ts`가 비어야 한다)
   - 상태 타입에 배열 인덱스가 아니라 시각(openTime)이 들어 있는가?
   - 상태가 JSON 직렬화 가능한가? (함수·Map·Set·Date 인스턴스 없음)
   - `stepExecution`이 입력을 변경하지 않는가?
   - `src/lib/execution/`이 거래소 주문 API를 import 하지 않는가? (ADR-021)
3. `phases/1-paper/index.json`의 step 0을 업데이트한다.

## 금지사항

- 기존 테스트를 수정해서 통과시키지 마라. 이유: 그 테스트들이 리팩터링의 등가성을 담보하는 유일한 장치다. 고치는 순간 검증 수단이 사라진다.
- 판정 순서·체결 규칙을 "개선"하지 마라. 이유: 이 step은 동작 보존 리팩터링이다. 개선은 별도 step에서 테스트와 함께 한다.
- 상태 객체를 변이(mutate)하지 마라. 새 객체를 반환하라. 이유: 페이퍼가 상태를 파일에 저장하고 복원하므로, 변이는 저장 시점과 실제 상태가 어긋나게 만든다.
- 배열 인덱스를 상태에 저장하지 마라. 이유: 프로세스 재시작 후 인덱스는 의미를 잃는다.
- `src/lib/execution/`에서 `src/services/`를 import 하지 마라. 이유: 순수 함수여야 테스트가 재현되고, 주문 경로가 생기지 않는다 (ADR-021).
