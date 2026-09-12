# Deepcoin API 스펙 (검증본)

출처: CCXT `ts/src/deepcoin.ts` 구현체 (공식 문서 https://www.deepcoin.com/docs 와 대응).
**추측이 아니라 동작하는 구현에서 추출한 값이다.** 구현 시 이 문서를 기준으로 하라.

## Base URL

```
https://api.deepcoin.com
```

공개·비공개 모두 같은 호스트를 쓴다.

## 인증 (비공개 엔드포인트)

헤더 5개:

| 헤더 | 값 |
|---|---|
| `DC-ACCESS-KEY` | API key |
| `DC-ACCESS-TIMESTAMP` | ISO8601 (예: `2026-09-12T06:53:41.773Z`) |
| `DC-ACCESS-PASSPHRASE` | API passphrase |
| `DC-ACCESS-SIGN` | 아래 서명 |
| `appid` | `200103` (고정) |

서명:

```
payload   = DC-ACCESS-TIMESTAMP + METHOD + '/' + requestPath [+ body]
signature = base64( HMAC-SHA256( secret, payload ) )
```

- `requestPath`는 **쿼리스트링을 포함**한다 (예: `deepcoin/market/candles?instId=BTC-USDT-SWAP&bar=5m`).
- payload에서 requestPath 앞에 `/`를 붙인다.
- `METHOD`는 대문자 (`GET`, `POST`).
- GET이 아니면 JSON 직렬화한 body를 payload 뒤에 붙이고 `Content-Type: application/json`을 넣는다.

## 공개 엔드포인트 (이 프로젝트가 쓰는 것)

### 캔들 — `GET /deepcoin/market/candles`

| 파라미터 | 값 |
|---|---|
| `instId` | `BTC-USDT-SWAP` |
| `bar` | `5m`, `15m`, `30m`, `1H`, `4H`, `1D` (**1시간 이상은 대문자 H/D**) |
| `limit` | 최대 **300** |
| `after` | 가져올 구간의 **최신** 캔들 타임스탬프(ms) |

**함정 1 — `since` 파라미터가 없다.** 과거로 거슬러 올라가려면 `after`를 줄여가며 역방향 페이지네이션해야 한다. 시작 시각을 주고 앞으로 훑는 방식은 지원되지 않는다.

**함정 2 — 응답이 내림차순(최신 우선)이다.** 아래 예시에서 첫 원소가 두 번째보다 60초 나중이다. `src/lib/`의 모든 함수는 오름차순을 가정하므로 **`services/`에서 반드시 뒤집어야 한다.**

```json
{
  "code": "0",
  "msg": "",
  "data": [
    ["1760221800000","3739.08","3741.95","3737.75","3740.1","2849","1065583.744"],
    ["1760221740000","3742.36","3743.01","3736.83","3739.08","2723","1018290.723"]
  ]
}
```

원소 순서: `[타임스탬프(ms), 시가, 고가, 저가, 종가, 거래량(base), 거래량(quote)]`.
**모든 값이 문자열이다.** 숫자로 파싱해야 한다.

레이트리밋: 초당 5회.

### 그 외

| 용도 | 경로 |
|---|---|
| 종목 정보 (tickSize, lotSize, 계약크기) | `GET /deepcoin/market/instruments` |
| 현재 펀딩비 | `GET /deepcoin/trade/fund-rate/current-funding-rate` |
| 펀딩비 이력 | `GET /deepcoin/trade/fund-rate/history` |
| **유지증거금 구간표** | `GET /deepcoin/market/step-margin` |
| 마크가격 | `GET /deepcoin/market/mark-price` |
| 미결제약정 | `GET /deepcoin/market/open-interest-volume` |
| 롱숏비율 | `GET /deepcoin/market/long-short-ratio` |

## 비공개 엔드포인트 (읽기 전용으로만 사용)

| 용도 | 경로 |
|---|---|
| **실제 수수료율** | `GET /deepcoin/account/trade-fee` |
| 레버리지 정보 | `GET /deepcoin/account/leverage-info` |
| 잔고 | `GET /deepcoin/account/balances` |
| 포지션 | `GET /deepcoin/account/positions` |

**주문 관련 엔드포인트(`/deepcoin/trade/order` 등)는 v1에서 호출하지 않는다 (ADR-002).**

## 이 프로젝트에 중요한 두 엔드포인트

`GET /deepcoin/account/trade-fee`와 `GET /deepcoin/market/step-margin`은
수수료율과 유지증거금률을 **추정하지 않고 거래소에서 직접 읽게** 해준다 (ADR-012).
이 두 값은 목표 가격폭·청산가·손익분기 승률을 직접 결정하므로 추정치를 쓰면 안 된다.

## WebSocket (v1 범위 밖, 참고)

```
wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api
```

v1은 REST 폴링으로 충분하다. 5분봉 전략에서 WS 복잡도는 이득이 없다.
