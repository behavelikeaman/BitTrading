# Step 2: paper-runner

## 읽어야 할 파일

- `/docs/ADR.md` (**ADR-018 티커는 별도 CLI**, ADR-019 슬리피지는 가정값, ADR-021 주문 경로 없음)
- `/docs/PRD.md` (Phase 1 — 페이퍼만 잡을 수 있는 것 5가지)
- `/docs/DEEPCOIN-API.md` (캔들 응답 특성)
- `/CLAUDE.md`
- Step 0의 `src/lib/execution/`, Step 1의 `src/lib/paper/`·`src/services/paper-store.ts`
- `src/lib/signal/entry.ts`, `src/lib/risk/sizing.ts`, `src/services/deepcoin.ts`
- `scripts/fetch-history.ts` (CLI 작성 패턴)

## 작업

### `scripts/paper.ts` + `npm run paper`

새 확정봉이 나올 때마다 상태 기계를 한 스텝 진행시키는 장기 실행 프로세스.

```bash
npm run paper                    # 기본 설정으로 시작 (기존 상태가 있으면 이어서)
npm run paper -- --reset         # 상태를 지우고 새로 시작
npm run paper -- --equity 5000 --interval 20
```

루프:

1. `loadState()` — 없거나 `parseState`가 null이면 `createInitialState`로 시작하고 그 사실을 stdout에 알린다
2. `fetchRecentCandles({ bar: '5m', limit: 300 })`와 15분봉·펀딩비를 받는다
3. 마지막 확정봉에 대해 `shouldProcess`가 false면 아무것도 하지 않고 다음 폴링을 기다린다
4. **캔들이 여러 개 밀렸으면 밀린 만큼 순서대로 전부 처리한다.** 네트워크 장애나 프로세스 중단으로 두세 봉이 빠질 수 있다. 마지막 봉만 처리하면 그 사이의 손절을 통째로 건너뛴다
5. 각 캔들마다:
   - UTC 일자가 바뀌었으면 `resetDaily`로 guard의 일손익만 초기화
   - `stepExecution`으로 상태 전이 → 트레이드가 나오면 `appendJournal` + `updateGuard` + 자본 갱신
   - 포지션도 대기 주문도 없으면 `evaluateEntry`로 시그널 평가 → 진입 가능하면 `planPosition` → `createPendingOrder`, 그리고 신호를 일지에 기록(체결 여부와 무관하게)
6. `saveState()` — **매 캔들마다** 저장한다. 종료 시점에만 저장하면 프로세스가 죽었을 때 잃는다
7. `--interval`초(기본 20) 대기 후 반복

출력:

- 매 폴링마다 한 줄로 현재 상태를 stderr에 갱신 (자본, 포지션 유무, 마지막 봉 시각)
- 진입·청산·신호는 stdout에 한 줄씩 남긴다. 터미널을 나중에 봐도 무슨 일이 있었는지 알 수 있어야 한다
- **시작 시 경고를 한 번 출력한다**: 슬리피지는 가정값이며 실거래는 이보다 나쁘다 (ADR-019)

`SIGINT`(Ctrl+C)에서 현재 상태를 저장하고 정상 종료한다.

### 오류 처리

- 거래소 호출 실패는 **프로세스를 죽이지 마라.** 로그를 남기고 다음 폴링에서 재시도한다. 5분봉 전략에서 한두 번의 조회 실패는 치명적이지 않지만, 프로세스가 죽어 있는 것은 치명적이다
- 연속 실패가 일정 횟수(예: 10회)를 넘으면 그 사실을 눈에 띄게 출력한다. 조용히 멈춰 있는 것이 최악이다
- 지수 백오프를 걸되 상한을 둔다 (예: 최대 5분)

### `package.json`

`"paper": "tsx scripts/paper.ts"` 추가.

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 테스트 유지
npm run paper -- --help   # 인자 파싱이 동작하고 즉시 종료한다
```

> 실제 폴링은 거래소 도메인 접근이 필요하므로 AC에 포함하지 않는다. 제한된 환경에서는 차단된다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 밀린 캔들을 순서대로 전부 처리하는가? 마지막 봉만 처리하지 않는가?
   - 매 캔들마다 상태를 저장하는가?
   - 거래소 호출 실패가 프로세스를 죽이지 않는가?
   - 시작 시 슬리피지 가정 경고를 출력하는가? (ADR-019)
   - 체결되지 않은 신호도 일지에 남기는가? (체결률 계산에 필요하다)
   - 주문 API를 호출하는 코드가 없는가? (ADR-021)
   - 상태 전이를 `stepExecution`에 위임하고 자체 판정을 하지 않는가? (ADR-016)
3. `phases/1-paper/index.json`의 step 2를 업데이트한다.

## 금지사항

- 마지막 캔들만 처리하지 마라. 밀린 캔들을 순서대로 전부 소화하라. 이유: 중간 봉에서 손절이 닿았을 수 있고, 건너뛰면 페이퍼가 실제보다 좋은 성적을 낸다.
- 거래소 조회 실패에 `process.exit`를 부르지 마라. 이유: 24시간 돌아야 하는 프로세스다. 일시적 오류로 죽으면 포지션이 방치된다.
- 상태 저장을 종료 시점으로 미루지 마라. 이유: 프로세스가 강제 종료되면 그동안의 기록을 전부 잃는다.
- 체결 판정을 러너에 직접 구현하지 마라. `stepExecution`을 호출하라. 이유: 백테스트와 갈라지면 페이퍼가 검증 도구로서 무의미해진다 (ADR-016).
- 거래소 주문 API를 호출하지 마라. 이유: 페이퍼는 시뮬레이션이다 (ADR-002, ADR-021).
- 미확정봉을 처리하지 마라. `shouldProcess`가 걸러낸다 (ADR-006).
