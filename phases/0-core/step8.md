# Step 8: backtest-ui

## 읽어야 할 파일

- `/docs/PRD.md` (핵심 기능 3 — 백테스트, 기준 수치 표)
- `/docs/ARCHITECTURE.md` (백테스트 데이터 흐름)
- `/docs/ADR.md` (ADR-007 수수료·슬리피지·펀딩·청산 반영)
- `/CLAUDE.md`
- Step 4의 `src/lib/backtest/` (`BacktestResult`, `BacktestParams`, `Trade` 타입)
- Step 6의 `src/app/api/backtest/route.ts`
- Step 7의 `src/components/`, `src/lib/format.ts` (포맷 함수 재사용)

## 작업

`src/app/backtest/page.tsx`를 Client Component로 만들고 `src/components/BacktestReport.tsx`를 작성한다.

### 화면 구성

1. **파라미터 패널** — 기간(from/to), 그리고 결과를 크게 바꾸는 값들을 조정 가능하게:
   - 목표 순수익률 (`targetNetReturnOnMargin`) — 기본 0.25
   - ATR 손절 배수 (`atrStopMultiple`) — 기본 1.2
   - 확신/약간의 확신 점수 임계값 (`highConvictionScore`, `mediumConvictionScore`)
   - 리스크 예산 % (`riskPctHigh`, `riskPctMedium`)
   - 레버리지, 수수료율, 슬리피지
   - 물타기 설정 (횟수, 간격 ATR 배수, 비중)

2. **요약 카드** — 총 트레이드 수, 승률, 손익비(Profit Factor), 기대값(트레이드당 USDT), 최대낙폭(MDD), 최대 연속손실, **총 수수료**, 총 펀딩, **청산 횟수**, 최종 자본.
   - 청산 횟수가 1회 이상이면 빨간색으로 강조한다.
   - 총 수수료를 총이익 옆에 나란히 놓아 수수료 비중이 한눈에 보이게 한다.

3. **자본 곡선** — `equityCurve`를 선 그래프로. Step 7에서 쓴 차트 라이브러리를 재사용한다.

4. **트레이드 목록** — 진입/청산 시각, 방향, 점수, 확신도, 평단, 청산가, `exitReason`, 순손익. `exitReason`별 색상 구분. 청산(`liquidation`)은 빨강.

5. **손익분기 승률 비교** — 현재 설정의 실제 승률과 이론 손익분기 승률을 나란히 표시한다. 실제 승률이 손익분기 미만이면 경고. 이것이 "이 설정으로 돈을 벌 수 있는가"에 대한 직접적인 답이다.

### 동작

- 실행 버튼을 눌러야 `/api/backtest`를 호출한다. 자동 실행하지 마라.
- 과거 데이터 파일이 없어 404가 오면 `npm run fetch-history -- --from ... --to ...` 명령을 **복사 가능한 형태로** 화면에 안내한다.
- 백테스트는 오래 걸릴 수 있으므로 로딩 상태와 경과 시간을 표시한다.
- 파라미터는 `localStorage`에 저장해 새로고침해도 유지한다.

## Acceptance Criteria

```bash
npm run build
npm run lint
npm test        # 기존 테스트 전부 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 페이지가 `src/app/backtest/page.tsx`에 있는가?
   - 클라이언트가 `/api/backtest`만 호출하고 `src/lib/backtest/`를 직접 실행하지 않는가?
   - 총 수수료·청산 횟수가 요약에 노출되는가? (ADR-007의 존재 이유)
   - 실제 승률 대 손익분기 승률 비교가 표시되는가?
   - 데이터 파일이 없을 때 다운로드 명령을 안내하는가?
   - Step 7의 `src/lib/format.ts`를 재사용하는가? (포맷 로직 중복 금지)
3. `phases/0-core/index.json`의 step 8을 업데이트한다.
4. 이 step이 성공하면 `phases/index.json`의 `0-core` 항목도 `"status": "completed"`로 갱신한다.

## 금지사항

- 클라이언트에서 백테스트를 실행하지 마라. 이유: 수만 개 캔들 루프가 브라우저를 멈춘다. 서버 라우트에서 돌려라.
- 총 수수료와 청산 횟수를 요약에서 빼지 마라. 이유: 이 두 숫자를 숨기면 전략이 실제보다 좋아 보이고, 그것이 이 프로젝트가 막으려는 바로 그 문제다.
- 결과를 보기 좋게 만들려고 손실 트레이드를 필터링하거나 기간을 자동으로 잘라내지 마라. 이유: 커브 피팅이다.
- 포맷 함수를 새로 만들지 마라. `src/lib/format.ts`를 재사용하라.
- 주문 전송 기능을 넣지 마라 (ADR-002).
