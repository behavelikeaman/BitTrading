# Step 5: market-data

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (`src/services/` 경계 규칙 — 지표 계산 금지, 원시 데이터만 반환)
- `/docs/ADR.md` (ADR-003 Binance 과거·Deepcoin 실시간, ADR-006 확정봉, ADR-011 자체 래퍼 금지)
- `/CLAUDE.md`, `/.env.example`
- Step 1의 `src/types/index.ts` (`Candle` 타입)

## 작업

외부 시세를 가져오는 얇은 `async` 함수와 과거 데이터 다운로드 CLI를 만든다. **지표·시그널을 계산하지 마라. 원시 캔들만 반환한다.**

### 1. `src/services/binance.ts` — 과거 캔들 (키 불필요)

```ts
export async function fetchHistoricalCandles(input: {
  symbol?: string;      // 기본 'BTCUSDT'
  interval: '5m' | '15m';
  startTime: number;    // ms epoch
  endTime: number;
}): Promise<Candle[]>;
```

- 엔드포인트: `https://fapi.binance.com/fapi/v1/klines`
- 1회 최대 1500개 제한이 있으므로 `startTime`을 밀며 **페이지네이션**한다. 요청 사이에 짧은 지연을 두어 레이트리밋을 피한다.
- 반환 배열은 **오름차순, 중복 제거, 마지막 미확정봉 제외**. Binance klines의 마지막 원소는 진행 중인 캔들일 수 있다 (ADR-006).
- `Candle.closed`는 `openTime + intervalMs <= endTime` 기준으로 판정해 `true`인 것만 남긴다.

### 2. `src/services/deepcoin.ts` — 실시간 캔들·펀딩

```ts
export async function fetchRecentCandles(input: {
  instId?: string;      // 기본 'BTC-USDT-SWAP'
  bar: '5m' | '15m';
  limit?: number;
}): Promise<Candle[]>;

export async function fetchFundingRate(instId?: string): Promise<number>;
```

- **엔드포인트와 응답 스키마를 추측하지 마라.** Deepcoin 공개 API 문서를 확인하고 실제 경로·파라미터·응답 필드에 맞춰 구현하라.
- 문서 확인이 불가능하거나 인증 방식이 불명확하면, `phases/0-core/index.json`의 이 step을 `"status": "blocked"`로 두고 `blocked_reason`에 **무엇을 확인해야 하는지** 구체적으로 적은 뒤 즉시 중단하라. 추측한 엔드포인트로 구현하는 것보다 낫다.
- 키가 필요하면 `process.env.DEEPCOIN_API_KEY` 등으로만 읽고, 없으면 명확한 메시지로 throw 한다.
- 여기서도 **마지막 미확정봉을 잘라내고** 오름차순으로 반환한다 (ADR-006).
- 펀딩비는 소수 비율로 정규화해 반환한다 (0.01% → `0.0001`).

### 3. `scripts/fetch-history.ts` — 로컬 실행 CLI

```bash
npm run fetch-history -- --from 2025-01-01 --to 2025-06-30
```

- `fetchHistoricalCandles`로 5분봉·15분봉을 받아 `data/btcusdt-5m-{from}-{to}.json`, `data/btcusdt-15m-...json`으로 저장한다.
- `data/` 디렉토리가 없으면 만든다. `data/*.json`은 이미 gitignore 되어 있다.
- 진행률을 stderr에 출력한다.
- `package.json`에 `"fetch-history": "tsx scripts/fetch-history.ts"` 스크립트를 추가하고 `tsx`를 devDependency로 설치한다.

## Acceptance Criteria

```bash
npm run build   # 타입 에러 없음
npm run lint
npm test        # 기존 테스트 유지
```

> 실제 네트워크 호출은 AC에 포함하지 않는다. 이 프로젝트의 CI 환경에서는 거래소 도메인이 차단될 수 있다 (ADR-005: services는 빌드 검증으로 대체).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 파일이 `src/services/`와 `scripts/`에 있는가?
   - 지표·시그널 계산이 services에 들어가지 않았는가?
   - 미확정봉을 잘라내고 오름차순으로 반환하는가?
   - 키를 `process.env`로만 읽는가? 하드코딩된 키가 없는가?
   - 주문·출금 관련 엔드포인트를 호출하는 코드가 없는가? (ADR-002)
3. `phases/0-core/index.json`의 step 5를 업데이트한다 (completed / error / blocked).

## 금지사항

- Deepcoin 엔드포인트를 추측해서 구현하지 마라. 확인이 안 되면 `blocked` 처리하라. 이유: 잘못된 스키마는 조용히 틀린 가격을 보여주고, 그 가격으로 실제 주문이 나간다.
- 주문·출금 엔드포인트를 호출하는 코드를 작성하지 마라. 이유: v1은 알림 전용 (ADR-002).
- 자체 HTTP 클라이언트 래퍼 계층을 만들지 마라. `fetch`를 직접 써라 (ADR-011).
- 캔들을 내림차순으로 반환하지 마라. 이유: 모든 `src/lib/` 함수가 오름차순을 가정한다.
- 미확정봉을 포함해 반환하지 마라. 이유: 리페인팅 (ADR-006).
