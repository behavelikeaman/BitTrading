# Step 1: paper-store

## 읽어야 할 파일

- `/docs/ADR.md` (**ADR-017 원자적 JSON 저장**, ADR-016 상태 기계 공유)
- `/docs/PRD.md` (Phase 1)
- `/CLAUDE.md`
- Step 0의 `src/lib/execution/types.ts`, `machine.ts`
- `/.gitignore` (`data/*.json`이 이미 무시된다 — `data/*.jsonl`도 필요하다)

## 작업

페이퍼 상태를 디스크에 저장·복원한다. 상태 전이 자체는 Step 0의 상태 기계가 하고, 여기서는 **저장 형식과 무결성**만 다룬다.

### 1. `src/lib/paper/state.ts` — 순수 함수 (TDD)

```ts
export interface PaperState {
  /** 스키마 버전. 형식이 바뀌면 올린다. */
  version: number;
  startedAt: number;
  equity: number;
  startingEquity: number;
  guard: GuardState;
  pending: PendingOrder | null;
  position: OpenPosition | null;
  /** 마지막으로 소화한 확정봉 openTime. 중복 처리를 막는다. */
  lastCandleTime: number;
  signalCount: number;
  /** UTC 일자. 바뀌면 guard의 일손익을 초기화한다. */
  currentDay: number;
}

export function createInitialState(equity: number, nowMs: number): PaperState;

/** 저장된 JSON을 검증해 PaperState로 만든다. 형식이 깨졌으면 null. */
export function parseState(raw: unknown): PaperState | null;

/** 이 캔들을 이미 처리했는가. 중복·역행 캔들을 걸러낸다. */
export function shouldProcess(state: PaperState, candle: Candle): boolean;
```

`shouldProcess`는 `candle.closed === true`이고 `candle.openTime > state.lastCandleTime`일 때만 `true`다. 폴링이 같은 캔들을 여러 번 가져오거나, 거래소가 과거 캔들을 다시 주는 경우를 막는다.

`parseState`는 **버전이 다르거나 필수 필드가 없으면 null을 반환**한다. throw 하지 마라. 호출부가 "새로 시작"으로 폴백해야 한다.

### 2. `src/lib/paper/journal.ts` — 순수 함수 (TDD)

```ts
export interface JournalEntry {
  type: 'trade' | 'signal' | 'note';
  at: number;
  trade?: Trade;
  /** 진입하지 못한 신호도 기록한다. 체결률을 계산해야 한다. */
  signal?: { direction: Direction; conviction: Conviction; score: number; price: number };
  note?: string;
}

export function toJsonl(entries: JournalEntry[]): string;
export function parseJsonl(raw: string): JournalEntry[];
```

`parseJsonl`은 **깨진 줄을 건너뛰고 나머지를 살린다.** 프로세스가 쓰는 도중 죽으면 마지막 줄이 잘릴 수 있는데, 그것 때문에 전체 일지를 잃으면 안 된다.

### 3. `src/services/paper-store.ts` — 파일 I/O

```ts
export async function loadState(dir?: string): Promise<PaperState | null>;
export async function saveState(state: PaperState, dir?: string): Promise<void>;
export async function appendJournal(entry: JournalEntry, dir?: string): Promise<void>;
export async function loadJournal(dir?: string): Promise<JournalEntry[]>;
export async function resetPaper(dir?: string): Promise<void>;
```

**CRITICAL — `saveState`는 원자적으로 써라 (ADR-017).** 임시 파일에 쓴 뒤 `rename` 한다:

```
data/paper-state.json.tmp  ->  (fsync)  ->  rename  ->  data/paper-state.json
```

같은 파일에 직접 쓰면 티커가 5분마다 덮어쓰는 도중 프로세스가 죽었을 때 파일이 깨지고, **열린 포지션을 통째로 잃는다.** `rename`은 원자적이라 이를 막는다.

`appendJournal`은 `data/paper-journal.jsonl`에 한 줄씩 append 한다. 전체를 다시 쓰지 마라.

### 4. `.gitignore`에 `data/*.jsonl` 추가

### 5. 테스트

`src/lib/paper/state.test.ts`, `journal.test.ts`:

- `shouldProcess`: 미확정봉 false / 같은 시각 false / 과거 시각 false / 다음 시각 true
- `parseState`: 정상 왕복 / 버전 불일치 시 null / 필드 누락 시 null / `null`·문자열·배열 입력 시 null (throw 금지)
- `createInitialState` 후 `parseState(JSON.parse(JSON.stringify(s)))`가 같은 값을 낸다
- `parseJsonl`: 마지막 줄이 잘린 입력에서 앞줄들을 살린다
- `parseJsonl`: 빈 문자열 → 빈 배열, 예외 없음
- `toJsonl`/`parseJsonl` 왕복 보존

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 테스트 + paper state·journal 테스트
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 순수 함수가 `src/lib/paper/`에, 파일 I/O가 `src/services/paper-store.ts`에 분리돼 있는가?
   - `saveState`가 임시 파일 + rename 방식인가? 같은 파일에 직접 쓰지 않는가?
   - `parseState`가 깨진 입력에 throw 하지 않고 null을 반환하는가?
   - `parseJsonl`이 잘린 마지막 줄 때문에 전체를 버리지 않는가?
   - `.gitignore`에 `data/*.jsonl`이 들어갔는가?
3. `phases/1-paper/index.json`의 step 1을 업데이트한다.

## 금지사항

- `saveState`에서 대상 파일에 직접 쓰지 마라. 이유: 쓰는 도중 죽으면 열린 포지션을 잃는다 (ADR-017).
- `parseState`·`parseJsonl`에서 throw 하지 마라. 이유: 파일이 깨졌을 때 앱이 죽으면 복구 수단이 없어진다. null·부분 결과를 주고 호출부가 판단하게 하라.
- 일지를 매번 전체 다시 쓰지 마라. append 하라. 이유: 수천 줄이 쌓이면 매 캔들마다 전체 재작성은 낭비이고, 쓰는 중 죽으면 전부 잃는다.
- DB를 도입하지 마라. 이유: 단일 사용자 로컬 도구다 (ADR-017).
- 상태 전이 로직을 여기에 넣지 마라. 이유: Step 0의 상태 기계가 담당한다. 여기서 판정하면 백테스트와 갈라진다 (ADR-016).
