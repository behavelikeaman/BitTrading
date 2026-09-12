# Step 5: divergence-check

## 읽어야 할 파일

- `/docs/PRD.md` (Phase 1 — **이 단계가 답하는 질문**, 페이퍼만 잡을 수 있는 것 5가지, 완료 기준)
- `/docs/ADR.md` (**ADR-020 역할은 배선 검증**, ADR-016 상태 기계 공유, ADR-001)
- `/CLAUDE.md`
- Step 0의 `src/lib/execution/`, Step 1~4 전체
- `src/lib/backtest/engine.ts`, `src/services/binance.ts`

## 배경 (이 step이 Phase의 존재 이유다)

페이퍼 트레이딩으로는 엣지를 측정할 수 없다. 승률 50%와 55%를 구분하려면 400트레이드가 필요한데 하루 5건이어도 80거래일이 걸린다. 한 달 관측(약 100건)의 승률 표준오차는 ±5%p라 손익분기를 넘었는지조차 알 수 없다.

**대신 배선 오류는 표본 몇 건으로도 드러난다.** 실시간 피드의 캔들 경계, 미확정봉 처리, 지표 워밍업 창, 상태 복원 — 이것들은 백테스트가 구조적으로 볼 수 없고 페이퍼만 볼 수 있다.

그래서 이 step의 산출물은 수익률이 아니라 **불일치 목록**이다. 0건이어야 실거래를 논할 수 있다.

## 작업

### 1. `src/lib/paper/divergence.ts` — 순수 함수 (TDD)

```ts
export interface Divergence {
  kind:
    | 'missing-in-backtest'   // 페이퍼에만 있는 트레이드
    | 'missing-in-paper'      // 백테스트에만 있는 트레이드
    | 'entry-time'
    | 'direction'
    | 'conviction'
    | 'entry-price'
    | 'exit-reason'
    | 'exit-price';
  at: number;
  paper: string;      // 사람이 읽을 값
  backtest: string;
  /** 가격 차이는 허용오차 안이면 기록하지 않는다 */
  deltaPct?: number;
}

export interface DivergenceReport {
  comparedTrades: number;
  divergences: Divergence[];
  /** 진입 시각이 일치한 트레이드 비율 */
  matchRate: number;
}

export function compareTrades(
  paper: Trade[],
  backtest: Trade[],
  tolerance?: { pricePct?: number },
): DivergenceReport;
```

대조 규칙:

- **진입 시각(`entryTime`)으로 짝을 맞춘다.** 순서가 아니라 시각이다. 한쪽에만 있는 트레이드는 `missing-*`로 기록한다.
- 가격은 기본 허용오차 0.05% 안이면 일치로 본다. 실시간 피드와 과거 데이터가 거래소가 달라 미세하게 다를 수 있다 (ADR-003: 페이퍼는 Deepcoin, 백테스트는 Binance).
- 방향·확신도·청산 사유는 정확히 일치해야 한다. **여기서 어긋나면 가격 차이가 아니라 로직 차이다.**

### 2. `scripts/divergence.ts` + `npm run divergence`

```bash
npm run divergence
```

1. `loadJournal()`로 페이퍼 트레이드를 읽는다
2. 페이퍼가 커버한 구간(첫 트레이드 ~ 마지막 트레이드)의 과거 캔들이 `data/`에 있는지 확인한다. 없으면 **받아야 할 `fetch-history` 명령을 안내하고 종료**한다
3. 같은 구간·같은 파라미터로 `runBacktest`를 돌린다
4. `compareTrades`로 대조하고 결과를 출력한다
5. 불일치가 있으면 **종료 코드 1**로 끝낸다. 스크립트로 게이트를 걸 수 있어야 한다

출력은 불일치 종류별로 묶어 보여준다. 마지막 줄에 판정을 명시한다:

```
불일치 0건 — 페이퍼와 백테스트가 같은 판단을 내렸다.
```
또는
```
불일치 3건 — 실거래를 논하기 전에 원인을 찾아야 한다.
```

### 3. `src/app/api/paper/divergence/route.ts` — POST

같은 대조를 화면에서 실행한다. 과거 데이터가 없으면 404 + `hint`(fetch-history 명령)를 준다. 기존 `/api/backtest`의 404 패턴을 그대로 따른다.

### 4. 페이퍼 화면에 괴리 검사 섹션 추가

`src/app/paper/page.tsx`에 "괴리 검사" 버튼과 결과를 붙인다.

- 불일치 0건이면 초록, 1건 이상이면 빨강으로 크게 표시한다
- 불일치 목록은 종류·시각·페이퍼 값·백테스트 값을 표로 보여준다
- **수익률보다 위에 배치한다.** 이 화면에서 가장 중요한 숫자는 불일치 건수다

### 5. 테스트

`src/lib/paper/divergence.test.ts`:

- 완전히 같은 트레이드 목록 → 불일치 0, `matchRate` 1
- 페이퍼에만 있는 트레이드 → `missing-in-backtest`
- 백테스트에만 있는 트레이드 → `missing-in-paper`
- 방향이 다르면 `direction` 불일치
- 확신도가 다르면 `conviction` 불일치
- 청산 사유가 다르면 `exit-reason` 불일치
- 가격이 허용오차 안이면 불일치 없음 / 밖이면 `entry-price`와 `deltaPct`
- 양쪽 모두 빈 배열 → 불일치 0, 예외 없음
- 진입 시각이 같은 트레이드가 순서만 다를 때도 짝이 맞는다

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 테스트 + divergence 테스트
npm run divergence   # 일지가 없으면 안내 후 정상 종료
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 짝을 **진입 시각**으로 맞추는가? 배열 순서에 의존하지 않는가?
   - 방향·확신도·청산 사유는 허용오차 없이 정확히 비교하는가?
   - 불일치가 있으면 `npm run divergence`가 종료 코드 1을 내는가?
   - 과거 데이터가 없을 때 CLI와 라우트 모두 `fetch-history` 명령을 안내하는가?
   - 화면에서 불일치 건수가 수익률보다 위에 있는가? (ADR-020)
3. `phases/1-paper/index.json`의 step 5를 업데이트한다.
4. 이 step이 성공하면 `phases/index.json`의 `1-paper`도 `"completed"`로 갱신한다.

## 금지사항

- 배열 순서로 트레이드를 짝지으면 안 된다. 진입 시각으로 맞춰라. 이유: 한쪽에 트레이드가 하나 더 있으면 그 뒤가 전부 밀려 실제와 무관한 불일치가 쏟아진다.
- 방향·확신도·청산 사유에 허용오차를 두지 마라. 이유: 이 값들이 다르면 가격 차이가 아니라 로직이 갈라진 것이고, 그게 바로 이 검사가 찾는 대상이다.
- 불일치를 "사소하다"고 판단해 걸러내지 마라. 전부 보고하라. 이유: 걸러내는 순간 이 검사는 통과만 하는 장식이 된다.
- 페이퍼가 이기도록 허용오차를 키우지 마라. 이유: 검증 도구를 검증 대상에 맞추면 아무것도 검증하지 못한다.
- 괴리 검사를 통과했다고 실거래를 권하는 문구를 넣지 마라. 이유: 괴리 0은 "배선이 맞다"는 뜻이지 "엣지가 있다"는 뜻이 아니다 (ADR-020).
