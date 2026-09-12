# Step 1: types-and-indicators

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` (`src/lib/` 경계 규칙 — 외부 I/O·시각 접근 금지)
- `/docs/ADR.md` (ADR-005 TDD 범위, ADR-006 확정봉만 사용)
- `/CLAUDE.md` (CRITICAL 규칙)
- Step 0에서 만든 `/package.json`, `/tsconfig.json`, `/vitest.config.ts`

## 작업

공유 타입과 지표 순수 함수를 **TDD로** 작성한다. 테스트를 먼저 쓰고 통과시켜라.

### 1. `src/types/index.ts`

최소한 아래 타입을 export 한다. 필드는 필요에 따라 더해도 되지만 이름과 의미는 유지하라.

```ts
export interface Candle {
  openTime: number;   // ms epoch, 캔들 시작 시각
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;    // 확정봉 여부 (ADR-006)
}

export type Direction = 'long' | 'short';

export interface IndicatorSnapshot {
  ema12: number;
  sma20: number;          // 볼린저 중심선과 동일한 값
  bbUpper: number;
  bbLower: number;
  bbWidth: number;        // (upper - lower) / sma20
  atr14: number;
  adx14: number;
  volumeSma20: number;
}
```

### 2. `src/lib/indicators/` 순수 함수

각 파일은 배열을 받아 **입력과 같은 길이의 배열**을 반환한다. 값이 아직 정의되지 않는 앞부분(워밍업 구간)은 `null`을 채운다. 이유: 인덱스가 캔들 인덱스와 1:1로 맞아야 백테스트에서 룩어헤드 없이 `[0..i]`를 슬라이스할 수 있다.

```ts
// sma.ts
export function sma(values: number[], period: number): (number | null)[];

// ema.ts  — 첫 유효값은 SMA(period)로 시드하고 이후 k = 2/(period+1)로 갱신한다
export function ema(values: number[], period: number): (number | null)[];

// bollinger.ts — 표준편차는 모집단 기준(n으로 나눔)
export function bollinger(
  closes: number[], period = 20, mult = 2
): { middle: (number|null)[]; upper: (number|null)[]; lower: (number|null)[]; width: (number|null)[] };

// atr.ts — Wilder 평활(RMA). trueRange는 테스트를 위해 함께 export 한다
export function trueRange(candles: Candle[]): (number | null)[];
export function atr(candles: Candle[], period = 14): (number | null)[];

// adx.ts — Wilder 방식 +DI/-DI/ADX
export function adx(
  candles: Candle[], period = 14
): { plusDi: (number|null)[]; minusDi: (number|null)[]; adx: (number|null)[] };

// volume.ts
export function volumeSma(candles: Candle[], period = 20): (number | null)[];
```

그리고 위를 한 번에 묶어주는 헬퍼를 `src/lib/indicators/index.ts`에 둔다:

```ts
export function computeIndicators(candles: Candle[]): (IndicatorSnapshot | null)[];
```

`bbWidth`는 `(upper - lower) / middle`로 정의한다 (가격 수준에 무관하게 비교하기 위한 정규화).

### 3. 테스트 (`*.test.ts`, 각 지표 파일 옆)

**손으로 계산한 기대값이나 고정 픽스처를 박아넣어라.** 구현을 그대로 다시 쓴 "자기 자신과 비교하는 테스트"는 금지한다. 최소한 아래를 검증하라:

- `sma([1,2,3,4,5], 3)` → `[null, null, 2, 3, 4]`
- `ema` 시드가 SMA와 같고, 이후 값이 수식대로 갱신되는지
- `bollinger`: 모든 값이 같은 상수 배열이면 표준편차 0이므로 upper == lower == middle, width == 0
- `trueRange`: 갭 상승·갭 하락 캔들에서 전봉 종가를 반영하는지
- `atr`: 고정 캔들 배열에 대해 손계산 기대값
- `adx`: 단조 상승 추세 배열에서 `plusDi > minusDi`이고 ADX가 상승하는지
- 모든 지표: 입력 길이 == 출력 길이, 워밍업 구간이 정확히 `period - 1`개(또는 Wilder 지표의 해당 개수)만큼 `null`
- 입력이 period보다 짧으면 전부 `null`이고 예외를 던지지 않는지

부동소수점 비교는 `toBeCloseTo`를 쓴다.

## Acceptance Criteria

```bash
npm run build   # 타입 에러 없음
npm run lint
npm test        # 모든 지표 테스트 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 파일이 `src/types/index.ts`와 `src/lib/indicators/` 아래에 있는가?
   - `src/lib/` 안에서 `fetch`, `process.env`, `Date.now()`를 쓰지 않았는가? (ARCHITECTURE.md 경계 규칙)
   - 모든 지표가 입력과 같은 길이의 배열을 반환하고 워밍업 구간이 `null`인가?
   - 테스트가 구현을 재실행하지 않고 독립적인 기대값을 검증하는가?
3. 결과에 따라 `phases/0-core/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "생성된 타입과 지표 함수 시그니처, 워밍업 null 규약, 테스트 개수"`
   - 실패(3회) → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"`

## 금지사항

- `technicalindicators` 등 외부 지표 라이브러리를 설치하지 마라. 이유: 각 지표의 평활 방식(Wilder vs 단순)이 백테스트 결과를 바꾸는데 라이브러리는 그 선택을 숨긴다. 직접 구현해야 검증과 튜닝이 가능하다.
- 값이 없는 구간에 `0`이나 첫 유효값을 채우지 마라. 반드시 `null`이어야 한다. 이유: `0`은 유효한 지표값처럼 보여서 백테스트 초반에 가짜 신호를 만든다.
- 배열을 앞에서 잘라 짧게 반환하지 마라. 이유: 캔들 인덱스와 어긋나 백테스트에서 룩어헤드 버그가 생긴다.
- 시그널 판정·점수 계산·포지션 사이징을 넣지 마라. 이유: Step 2~3의 범위다.
- `src/lib/` 안에서 외부 API를 호출하지 마라. 이유: 순수 함수여야 테스트가 재현된다.
