# Step 6: api-routes

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (데이터 흐름 — 라우트는 조립만 한다)
- `/docs/ADR.md` (ADR-004 외부 API는 라우트에서만, ADR-001 함수 공유)
- `/CLAUDE.md`
- Step 1~4의 `src/lib/` 전체, Step 5의 `src/services/` 전체
- Step 1~4에서 추가된 `src/types/index.ts`

## 작업

`src/lib/`와 `src/services/`를 **조립만** 하는 라우트 핸들러를 만든다. 새 계산 로직을 라우트에 쓰지 마라.

### 1. `src/app/api/signal/route.ts` — GET

ARCHITECTURE.md의 실시간 흐름을 그대로 조립한다:

```
services/deepcoin  : 5분봉 200개 + 15분봉 100개 + 펀딩비
lib/signal/entry   : evaluateEntry(ctx, guard, config) -> Signal
lib/risk/sizing    : 진입 가능하면 planPosition(...) -> PositionPlan
```

- 응답: `{ signal: Signal; plan: PositionPlan | null; lastPrice: number; updatedAt: number }`
- `GuardState`는 쿼리 파라미터로 받는다 (`?consecutiveLosses=0&dailyPnlPct=0`). v1은 DB가 없으므로 클라이언트가 보유한 값을 넘긴다.
- `conviction === 'none'`이면 `plan`은 `null`이다.
- `nowMs`는 서버의 현재 시각을 넣어 `SignalContext`에 주입한다. `src/lib/` 안에서 시각을 읽지 않는다.
- `runtime = 'nodejs'`로 고정한다. Edge 금지.

### 2. `src/app/api/candles/route.ts` — GET

`?bar=5m&limit=200` 으로 실시간 캔들을 그대로 전달한다. 차트용.

### 3. `src/app/api/backtest/route.ts` — POST

- body: `{ from: string; to: string; params: Partial<BacktestParams> }`
- `data/` 아래 저장된 과거 캔들 JSON을 읽어 `runBacktest`에 넘긴다. 파일이 없으면 **404와 함께 `npm run fetch-history` 안내 메시지**를 반환한다.
- 백테스트는 수 초 이상 걸릴 수 있다. `maxDuration`을 넉넉히 설정한다.
- `runtime = 'nodejs'` 고정 (파일 시스템 접근 필요).

### 4. `src/app/api/commentary/route.ts` — POST

- `@anthropic-ai/sdk`를 그대로 사용한다 (ADR-011). devDependency가 아닌 dependency로 설치.
- 모델은 `claude-sonnet-4-6`, `max_tokens`는 600 정도.
- 입력: 현재 `IndicatorSnapshot` + `ScoreItem[]` + 최근 캔들 요약.
- 출력: 현재 레짐(추세/횡보/변동성 확대)을 한 문단으로 설명하는 한국어 텍스트.
- 프롬프트에 **"진입·청산·수량을 지시하지 말고 시장 상태만 설명하라"**고 명시한다 (ADR-010).
- 키는 `process.env.ANTHROPIC_API_KEY`로만 읽고, 없으면 500과 명확한 메시지.
- 호출은 요청당 1회. 재시도 루프를 만들지 마라.

### 에러 매핑 (전 라우트 공통)

- 키 미설정 → 500, 어떤 환경 변수가 필요한지 메시지에 명시
- 과거 데이터 파일 없음 → 404 + 다운로드 안내
- 외부 API 호출 실패 → 502 + 원인 메시지
- 잘못된 body/쿼리 → 400

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 테스트 전부 유지
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 라우트가 `src/app/api/` 아래에 있고 계산 로직 없이 조립만 하는가?
   - `src/lib/` 함수를 재구현한 부분이 없는가? (ADR-001)
   - 모든 라우트가 `runtime = 'nodejs'`인가?
   - 키를 `process.env`로만 읽는가?
   - Claude 호출이 요청당 1회이고 판단이 아닌 해설만 하는가? (ADR-010)
3. `phases/0-core/index.json`의 step 6을 업데이트한다.

## 금지사항

- 라우트 안에서 지표·점수·사이징을 직접 계산하지 마라. 필요하면 `src/lib/`에 함수를 추가하고 테스트를 먼저 써라. 이유: 검증되지 않은 계산에 자본이 걸린다.
- 주문 실행 엔드포인트를 만들지 마라. 이유: v1은 알림 전용 (ADR-002).
- Claude에게 진입/청산/수량을 결정하게 하지 마라. 이유: LLM 출력은 백테스트할 수 없다 (ADR-010).
- Edge 런타임을 쓰지 마라. 이유: 백테스트 라우트가 파일 시스템을 읽는다.
- UI 컴포넌트를 만들지 마라. 이유: Step 7~8의 범위다.
