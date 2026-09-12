# Step 2: signal-scoring

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` (핵심 기능 1 — 컨플루언스 스코어 표와 무효 필터)
- `/docs/ARCHITECTURE.md` (`src/lib/` 경계 규칙)
- `/docs/ADR.md` (ADR-001 백테스트·실시간 함수 공유, ADR-006 확정봉, ADR-010 Claude는 판단 주체가 아님)
- `/CLAUDE.md`
- Step 1의 `src/types/index.ts`와 `src/lib/indicators/` 전체

Step 1이 만든 지표 함수의 시그니처와 `null` 워밍업 규약을 꼼꼼히 읽고 그대로 사용하라. 지표를 다시 구현하지 마라.

## 작업

사용자의 주관적 "확신도"를 **결정론적 점수**로 바꾸는 순수 함수를 TDD로 작성한다.

### 1. 타입 추가 (`src/types/index.ts`에 append)

```ts
export type Conviction = 'high' | 'medium' | 'none';

export interface ScoreItem {
  key: 'bbPosition' | 'emaCross' | 'bandExpansion' | 'volume'
     | 'higherTimeframe' | 'trendStrength' | 'funding' | 'session';
  label: string;      // 화면 표시용 한국어 라벨
  passed: boolean;
  detail: string;     // 왜 통과/실패했는지 한 줄 (예: "ADX 24.1 >= 20")
}

export interface SignalContext {
  candles5m: Candle[];        // 오름차순, 마지막이 확정봉
  candles15m: Candle[];       // 상위 프레임 정렬 판정용
  fundingRate: number;        // 현재 펀딩비 (0.0001 = 0.01%)
  nowMs: number;              // 세션 판정 기준 시각. Date.now()를 쓰지 말고 주입받는다
  blackout?: boolean;         // 지표 발표 등 사용자가 켜는 수동 무효 스위치
}

export interface Signal {
  direction: Direction | null;
  conviction: Conviction;
  score: number;              // 통과한 항목 수 (0~8)
  items: ScoreItem[];         // 8개 전부. 실패 항목도 이유와 함께 남긴다
  blockers: string[];         // 무효 필터에 걸린 사유. 비어 있어야 진입 가능
  indicators: IndicatorSnapshot | null;
}
```

### 2. `src/lib/signal/score.ts`

```ts
export interface ScoreConfig {
  volumeMultiple: number;   // 기본 1.5
  adxMin: number;           // 기본 20
  fundingLimit: number;     // 기본 0.0003 (0.03%)
  sessionStartUtcHour: number; // 기본 7
  sessionEndUtcHour: number;   // 기본 21
  bbWidthLookback: number;  // 기본 20
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig;

export function scoreSignal(ctx: SignalContext, config?: Partial<ScoreConfig>):
  { direction: Direction | null; items: ScoreItem[]; indicators: IndicatorSnapshot | null };
```

판정 규칙 — PRD의 표를 그대로 구현한다:

1. **emaCross (필수 트리거)** — 직전 확정봉과 마지막 확정봉 사이에 EMA12가 SMA20을 교차했는가. 위로 교차 → `direction = 'long'`, 아래로 교차 → `'short'`. **교차가 없으면 `direction`은 `null`이고, 이 경우 나머지 항목은 채점하되 진입은 불가하다.**
2. **bbPosition** — 롱이면 종가 > bbUpper, 숏이면 종가 < bbLower
3. **bandExpansion** — 현재 `bbWidth` > 최근 `bbWidthLookback`개 `bbWidth`의 중앙값
4. **volume** — 마지막 확정봉 거래량 >= `volumeSma20 * volumeMultiple`
5. **higherTimeframe** — 15분봉 EMA50의 기울기(마지막 값 - 직전 값) 부호가 방향과 일치
6. **trendStrength** — `adx14 >= adxMin`
7. **funding** — 롱이면 `fundingRate < fundingLimit`, 숏이면 `fundingRate > -fundingLimit`
8. **session** — `nowMs`의 UTC 시(hour)가 `[sessionStartUtcHour, sessionEndUtcHour)` 범위 안

`direction`이 `null`이면 방향 의존 항목(1, 5, 7)은 `passed: false`, `detail`에 "방향 미정"으로 기록한다.

### 3. `src/lib/signal/entry.ts`

```ts
export interface EntryConfig extends ScoreConfig {
  highConvictionScore: number;   // 기본 6
  mediumConvictionScore: number; // 기본 4
  atrSpikeMultiple: number;      // 기본 2.0
  consecutiveLossLimit: number;  // 기본 3
  dailyLossLimitPct: number;     // 기본 0.06
}

export interface GuardState {
  consecutiveLosses: number;
  dailyPnlPct: number;   // 당일 누적 손익률 (-0.03 = -3%)
}

export const DEFAULT_ENTRY_CONFIG: EntryConfig;

export function evaluateEntry(
  ctx: SignalContext,
  guard: GuardState,
  config?: Partial<EntryConfig>
): Signal;
```

`blockers`에 담아야 할 무효 사유 (해당하면 문자열로 추가하고, 하나라도 있으면 `conviction`은 `'none'`):

- `blackout === true` → "지표 발표 블랙아웃"
- `atr14 > (최근 20봉 atr14 평균) * atrSpikeMultiple` → "이상 변동성"
- `guard.consecutiveLosses >= consecutiveLossLimit` → "연속 손실 한도"
- `guard.dailyPnlPct <= -dailyLossLimitPct` → "일일 손실 한도"
- `direction === null` → "진입 트리거 없음"
- 지표 워밍업 미완료(`indicators === null`) → "데이터 부족"

`conviction` 결정: blockers가 비어 있을 때만 점수로 판정한다. `score >= highConvictionScore` → `'high'`, `>= mediumConvictionScore` → `'medium'`, 그 외 `'none'`.

### 4. 테스트

`src/lib/signal/score.test.ts`, `entry.test.ts`를 작성한다. 캔들 픽스처는 테스트 파일 안에서 프로그래밍으로 생성해도 되지만, **각 항목이 켜지는 케이스와 꺼지는 케이스를 항목마다 따로** 검증하라. 최소한:

- EMA12가 SMA20을 위로 교차하는 캔들 배열 → `direction === 'long'`
- 교차가 없는 횡보 배열 → `direction === null`이고 blockers에 "진입 트리거 없음"
- 8항목이 전부 통과하는 배열 → `score === 8`, `conviction === 'high'`
- 점수가 8이어도 `blackout: true`면 `conviction === 'none'`이고 blockers가 비어 있지 않음
- `guard.consecutiveLosses = 3` → blockers에 연속 손실 한도
- `guard.dailyPnlPct = -0.06` → blockers에 일일 손실 한도
- `items.length === 8`이 항상 성립 (실패 항목도 detail과 함께 남는지)
- 워밍업이 안 된 짧은 캔들 배열 → 예외 없이 `conviction === 'none'`, blockers에 "데이터 부족"

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # Step 1 테스트 + 이번 시그널 테스트 전부 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 파일이 `src/lib/signal/` 아래에 있는가?
   - `Date.now()`·`fetch`·`process.env`를 쓰지 않고 `ctx.nowMs`를 사용하는가?
   - Step 1의 지표 함수를 그대로 import 하고 재구현하지 않았는가?
   - 마지막 **확정봉** 기준으로 판정하는가? `candles[candles.length-1].closed === false`인 입력을 안전하게 처리하는가?
   - 모든 임계값이 config로 덮어쓸 수 있는가? (백테스트에서 스윕해야 한다)
3. 결과에 따라 `phases/0-core/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "scoreSignal·evaluateEntry 시그니처, 8항목 키 목록, blocker 사유 목록, 기본 임계값"`
   - 실패(3회) → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"`

## 금지사항

- 임계값을 코드에 하드코딩하지 마라. 전부 `ScoreConfig`/`EntryConfig`로 빼라. 이유: Step 4 백테스트가 이 값들을 바꿔가며 최적값을 찾는다. 하드코딩하면 검증 자체가 불가능해진다.
- 실패한 항목을 `items`에서 빼지 마라. 이유: 화면에서 "왜 진입 못 하는지"를 보여주는 것이 이 기능의 핵심이다.
- `Date.now()`를 호출하지 마라. `ctx.nowMs`를 써라. 이유: 세션 필터가 시각에 의존하므로 테스트와 백테스트가 재현되지 않는다.
- 미확정봉으로 판정하지 마라. 이유: 리페인팅 (ADR-006).
- Claude API나 외부 호출을 넣지 마라. 이유: 시그널은 결정론적이어야 백테스트가 가능하다 (ADR-010).
- 포지션 크기·손절가·청산가를 계산하지 마라. 이유: Step 3의 범위다.
