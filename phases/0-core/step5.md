# Step 5: market-data

## 읽어야 할 파일

- **`/docs/DEEPCOIN-API.md`** — 검증된 Deepcoin 스펙. 엔드포인트·인증·응답 형태가 전부 여기 있다. **추측하지 말고 이 문서를 따르라.**
- `/docs/ARCHITECTURE.md` (`src/services/` 경계 규칙 — 지표 계산 금지, 원시 데이터만 반환)
- `/docs/ADR.md` (ADR-003 Binance 과거·Deepcoin 실시간, ADR-006 확정봉, ADR-011 자체 래퍼 금지, **ADR-012 수수료·유지증거금은 거래소에서 읽는다**)
- `/CLAUDE.md`, `/.env.example`
- Step 1의 `src/types/index.ts` (`Candle` 타입)

## 작업

외부 시세를 가져오는 얇은 `async` 함수와 과거 데이터 다운로드 CLI를 만든다. **지표·시그널을 계산하지 마라. 원시 데이터만 반환한다.**

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
- 반환 배열은 **오름차순, 중복 제거, 미확정봉 제외** (ADR-006).

### 2. `src/services/deepcoin.ts` — 실시간 캔들·펀딩·계좌 파라미터

`docs/DEEPCOIN-API.md`의 스펙을 그대로 구현한다. Base URL은 `https://api.deepcoin.com`.

```ts
export async function fetchRecentCandles(input: {
  instId?: string;            // 기본 'BTC-USDT-SWAP'
  bar: '5m' | '15m';
  limit?: number;             // 최대 300
  after?: number;             // 이 시각(ms) 이전 구간
}): Promise<Candle[]>;

export async function fetchFundingRate(instId?: string): Promise<number>;

// ADR-012 — 추정치 대신 실측값을 읽는다. 키가 없으면 null을 반환하고 throw 하지 않는다.
export async function fetchTradeFee(instId?: string): Promise<{ maker: number; taker: number } | null>;
export async function fetchStepMargin(instId?: string): Promise<{ tiers: { maxNotional: number; mmr: number }[] } | null>;
```

**반드시 지킬 것 — 이 세 가지가 조용히 틀리는 지점이다:**

1. **응답이 내림차순(최신 우선)이다.** `src/lib/`의 모든 함수는 오름차순을 가정하므로 **반드시 `reverse()` 해서 반환하라.** 뒤집지 않으면 EMA·ATR·교차 판정이 전부 거꾸로 계산되는데 예외는 나지 않는다.
2. **모든 값이 문자열이다.** `[ts, o, h, l, c, volBase, volQuote]` 전부 `Number()`로 파싱하라. 문자열 그대로 두면 지표 계산이 문자열 연결로 조용히 망가진다.
3. **`since` 파라미터가 없다.** 과거로 가려면 `after`(구간의 최신 타임스탬프 ms)를 줄여가며 역방향 페이지네이션한다. `limit` 최대 300, 레이트리밋 초당 5회.

그 외:

- 마지막 미확정봉을 잘라내고 반환한다 (ADR-006). 마지막 캔들의 `openTime + intervalMs > now`면 미확정이다.
- `bar` 값은 5분·15분은 소문자(`5m`, `15m`), 1시간 이상은 대문자(`1H`, `4H`, `1D`)다.
- 펀딩비는 소수 비율로 정규화해 반환한다 (0.01% → `0.0001`).
- 인증은 `docs/DEEPCOIN-API.md`의 서명 규칙을 그대로 구현한다: 헤더 `DC-ACCESS-KEY`·`DC-ACCESS-TIMESTAMP`(ISO8601)·`DC-ACCESS-PASSPHRASE`·`DC-ACCESS-SIGN`·`appid: 200103`, 서명은 `base64(HMAC-SHA256(secret, ISO8601 + METHOD + '/' + requestPath [+ body]))`. `requestPath`에 쿼리스트링을 포함한다.
- 키는 `process.env.DEEPCOIN_API_KEY` / `_SECRET` / `_PASSPHRASE`로만 읽는다.
- 공개 엔드포인트(캔들·펀딩)는 **키 없이 동작해야 한다.** 키가 없다고 캔들 조회가 실패하면 안 된다.
- 응답의 `code`가 `"0"`이 아니면 `msg`를 담아 throw 한다.

### 3. `scripts/fetch-history.ts` — 로컬 실행 CLI

```bash
npm run fetch-history -- --from 2025-01-01 --to 2025-06-30
```

- `fetchHistoricalCandles`로 5분봉·15분봉을 받아 `data/btcusdt-5m-{from}-{to}.json`, `data/btcusdt-15m-...json`으로 저장한다.
- `data/` 디렉토리가 없으면 만든다. `data/*.json`은 이미 gitignore 되어 있다.
- 진행률을 stderr에 출력한다.
- `package.json`에 `"fetch-history": "tsx scripts/fetch-history.ts"`를 추가하고 `tsx`를 devDependency로 설치한다.

### 4. 테스트

`src/services/`는 원칙적으로 빌드 검증으로 대체하지만(ADR-005), **응답 파싱만은 순수 함수로 분리해 테스트하라.** 이것이 위 3가지 함정이 실제로 막혔는지 확인하는 유일한 방법이다.

`src/lib/parse-deepcoin.ts`에 파싱 함수를 두고 테스트를 쓴다:

```ts
export function parseDeepcoinCandles(rows: string[][], intervalMs: number, nowMs: number): Candle[];
```

검증 항목:
- 내림차순 입력 → **오름차순 출력** (`openTime`이 증가하는지)
- 모든 필드가 `number` 타입이고 문자열이 남아 있지 않은지
- 마지막 캔들이 미확정이면(`openTime + intervalMs > nowMs`) 제외되는지
- 빈 배열 입력 → 빈 배열 반환, 예외 없음
- `docs/DEEPCOIN-API.md`의 실제 응답 예시를 픽스처로 그대로 넣어 검증

## Acceptance Criteria

```bash
npm run build   # 타입 에러 없음
npm run lint
npm test        # 기존 테스트 + parse-deepcoin 테스트 통과
```

> 실제 네트워크 호출은 AC에 포함하지 않는다. 이 프로젝트의 CI/클라우드 환경에서는 거래소 도메인이 차단된다 (ADR-005).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `parseDeepcoinCandles`가 **오름차순으로 뒤집어** 반환하는가? 테스트가 이를 검증하는가?
   - 모든 문자열 필드를 숫자로 파싱하는가?
   - 미확정봉을 잘라내는가? (ADR-006)
   - 공개 엔드포인트가 키 없이 동작하는가?
   - 키를 `process.env`로만 읽는가? 하드코딩된 키가 없는가?
   - 주문·출금 엔드포인트를 호출하는 코드가 없는가? (ADR-002)
3. `phases/0-core/index.json`의 step 5를 업데이트한다 (completed / error / blocked).

## 금지사항

- 캔들을 내림차순 그대로 반환하지 마라. 이유: 모든 `src/lib/` 함수가 오름차순을 가정하며, 뒤집지 않아도 예외가 나지 않아 지표가 조용히 거꾸로 계산된다. 이 프로젝트에서 가장 위험한 종류의 버그다.
- 문자열을 숫자로 파싱하지 않고 넘기지 마라. 이유: JS에서 `"100" + 1 === "1001"`이라 지표가 조용히 망가진다.
- 주문·출금 엔드포인트(`/deepcoin/trade/order`, `/deepcoin/asset/withdraw` 등)를 호출하는 코드를 작성하지 마라. 이유: v1은 알림 전용 (ADR-002).
- 공개 캔들 조회에 인증을 요구하지 마라. 이유: 키 없이도 시세는 봐야 한다.
- 자체 HTTP 클라이언트 래퍼 계층을 만들지 마라. `fetch`를 직접 써라 (ADR-011).
- 미확정봉을 포함해 반환하지 마라. 이유: 리페인팅 (ADR-006).
