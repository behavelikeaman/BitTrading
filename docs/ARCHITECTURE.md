# ARCHITECTURE: BitTrading

## 원칙
돈이 걸린 계산은 전부 `src/lib/`의 순수 함수에 있고 테스트로 고정된다.
`src/app/`과 `src/services/`는 그 함수들을 **호출·조립할 뿐 계산하지 않는다.**
백테스트와 실시간은 같은 `src/lib/` 함수를 쓴다.

## 디렉토리 구조

```
src/
  app/
    page.tsx                    # 실시간 대시보드 (Client Component)
    backtest/page.tsx           # 백테스트 결과 화면 (Client Component)
    layout.tsx
    globals.css
    api/
      candles/route.ts          # GET  실시간 캔들 + 펀딩 (Deepcoin)
      signal/route.ts           # GET  현재 시그널 + 포지션 계산
      backtest/route.ts         # POST 백테스트 실행
      commentary/route.ts       # POST Claude 레짐 해설

  lib/                          # 순수 함수 — 전부 TDD. 외부 I/O 금지.
    indicators/
      sma.ts  ema.ts  bollinger.ts  atr.ts  adx.ts  volume.ts
    signal/
      score.ts                  # 차단 게이트 3 + 트리거 + 점수 3항목 (ADR-025)
      entry.ts                  # 스코어 + 무효필터 -> 진입 판정
    risk/
      sizing.ts                 # 리스크 예산 -> 수량·증거금
      ladder.ts                 # 물타기 래더 (진입 전 전량 확정)
      liquidation.ts            # 청산가·평단·본전가
      guard.ts                  # 서킷브레이커 (연속손실·일손실·변동성)
    backtest/
      engine.ts                 # 캔들 루프 (룩어헤드 금지)
      metrics.ts                # 승률·손익비·기대값·MDD·수수료

  services/                     # 외부 I/O. 평범한 async 함수.
    binance.ts                  # 과거 5분봉 (공개 엔드포인트, 키 불필요)
    deepcoin.ts                 # 실시간 캔들·펀딩 (읽기 전용 키)
    commentary.ts               # Anthropic SDK

  components/
    SignalPanel.tsx  ScoreBreakdown.tsx  OrderTicket.tsx
    RiskWarning.tsx  BacktestReport.tsx  CandleChart.tsx

  types/
    index.ts                    # Candle, Indicators, ScoreItem, Signal,
                                # PositionPlan, LadderLeg, Trade, BacktestResult

scripts/
  fetch-history.ts              # 과거 캔들 -> data/*.json (로컬 실행 전용)
  execute.py                    # Harness step 실행기

data/                           # 다운로드된 과거 캔들 (gitignore)
docs/                           # PRD / ARCHITECTURE / ADR / DEEPCOIN-API
phases/                         # Harness step 정의
```

## 데이터 흐름

### 실시간
```
브라우저 (5초 폴링)
  -> GET /api/signal
       services/deepcoin.ts   : 5분봉 200개 + 15분봉 100개 + 펀딩
       lib/indicators/*       : EMA12 / SMA20 / BB / ATR / ADX / 거래량평균
       lib/signal/score.ts    : 게이트·트리거·점수 3항목 판정
       lib/signal/entry.ts    : 차단 조건 통과 여부 + 방향 + 등급(기본 전 거래 동일)
       lib/risk/sizing.ts     : 등급 -> 리스크 예산 -> 명목가·수량·증거금
       lib/risk/ladder.ts     : 1차·2차 진입가와 수량, 공통 손절가
       lib/risk/liquidation.ts: 청산가, 평단, 본전가
  -> { signal, score[], plan, warnings }
  -> components/SignalPanel + ScoreBreakdown + OrderTicket
```

### 백테스트
```
npm run fetch-history          # 로컬에서 Binance 과거 5분봉 -> data/
  -> POST /api/backtest { from, to, params }
       lib/backtest/engine.ts
         for each closed candle i:
           지표는 [0..i] 만 사용                (룩어헤드 금지)
           lib/signal/*  <- 실시간과 동일 함수   (ADR-001)
           lib/risk/*    <- 실시간과 동일 함수
           체결은 i+1 캔들 시가부터, 수수료·슬리피지 차감
           캔들 저·고가로 손절·익절·청산 도달 판정
       lib/backtest/metrics.ts
  -> BacktestResult { trades[], winRate, profitFactor, expectancy, mdd, feeTotal }
  -> components/BacktestReport
```

## 경계 규칙

- `src/lib/`는 `fetch`·`process.env`·`Date.now()`를 쓰지 않는다. 시각이 필요하면 인자로 받는다. 이유: 테스트 재현성.
- `src/services/`는 지표나 시그널을 계산하지 않는다. 원시 데이터만 반환한다.
- `src/app/api/`는 조립만 한다. 새 계산 로직이 필요하면 `src/lib/`에 함수를 추가하고 테스트를 먼저 쓴다.
- 클라이언트 컴포넌트는 `src/app/api/*`만 호출한다. `src/services/`를 import 하지 않는다. 이유: 키 노출.
- 캔들 배열은 항상 **오름차순(과거 -> 최근)**, 마지막 원소는 **확정봉**. `services/`가 미확정봉을 잘라내고 반환한다.
- **Deepcoin 캔들 응답은 내림차순이다.** `services/deepcoin.ts`가 반드시 뒤집어서 반환한다. 검증된 스펙은 `docs/DEEPCOIN-API.md` 참조.
