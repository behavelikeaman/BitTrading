# Step 3: paper-api

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (라우트는 조립만 한다)
- `/docs/ADR.md` (ADR-004 외부 API는 라우트에서만, ADR-018 티커는 CLI, ADR-021 주문 경로 없음)
- `/CLAUDE.md`
- Step 1의 `src/services/paper-store.ts`, `src/lib/paper/`
- `src/lib/backtest/metrics.ts` (지표 재사용)
- 기존 라우트 `src/app/api/signal/route.ts` (에러 매핑 패턴)

## 작업

### 1. `src/app/api/paper/route.ts` — GET

현재 페이퍼 상태와 일지, 누적 지표를 반환한다.

```ts
export interface PaperResponse {
  running: boolean;        // 상태 파일이 있고 최근에 갱신됐는가
  state: PaperState | null;
  trades: Trade[];
  metrics: TradeMetrics | null;   // computeMetrics 재사용
  signalCount: number;
  fillRate: number;
  /** 마지막 상태 갱신 이후 경과 ms. 티커가 멈췄는지 판단용 */
  staleMs: number | null;
}
```

- 지표는 **`src/lib/backtest/metrics.ts`의 `computeMetrics`를 그대로 쓴다.** 페이퍼용으로 다시 구현하지 마라. 백테스트와 같은 잣대로 재야 비교가 성립한다.
- 상태 파일이 없으면 `running: false`, `state: null`로 200을 반환한다. 404가 아니다 — 아직 시작하지 않은 것은 오류가 아니다.
- `staleMs`는 `Date.now() - state.lastCandleTime`이다. 화면이 "티커가 멈춘 것 같다"를 판단한다.
- `runtime = 'nodejs'` 고정 (파일 시스템 접근).

### 2. `src/app/api/paper/reset/route.ts` — POST

일지와 상태를 지운다. **되돌릴 수 없으므로 본문에 `{ "confirm": true }`를 요구한다.** 없으면 400.

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 지표를 `computeMetrics`로 계산하는가? 페이퍼용 재구현이 없는가?
   - 상태 파일이 없을 때 200 + `running: false`인가? (404가 아니다)
   - `runtime = 'nodejs'`인가?
   - reset이 확인 없이는 동작하지 않는가?
   - 라우트가 상태를 **진행시키지 않는가?** 읽기만 해야 한다 (ADR-018)
3. `phases/1-paper/index.json`의 step 3을 업데이트한다.

## 금지사항

- 라우트에서 페이퍼 상태를 진행시키지 마라. 읽기 전용이다. 이유: 시간을 진행시키는 주체는 CLI 티커 하나뿐이어야 한다. 라우트가 요청마다 진행시키면 화면을 여러 개 열었을 때 같은 캔들이 중복 처리된다 (ADR-018).
- 페이퍼용 지표 계산을 새로 만들지 마라. 이유: 백테스트와 다른 잣대로 재면 비교가 무의미하다.
- 상태 파일이 없을 때 500이나 404를 내지 마라. 이유: 아직 시작하지 않은 정상 상태다.
- 주문 API를 호출하지 마라 (ADR-021).
