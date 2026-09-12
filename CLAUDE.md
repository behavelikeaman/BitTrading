# 프로젝트: BitTrading — BTC 5분봉 단타 의사결정 지원 시스템

디플로이 대상 사용자: 딥코인 BTC-USDT 무기한 선물 5분봉 스캘퍼 1인.
시스템의 역할은 **매매 판단 보조와 검증**이며, 주문을 대신 넣지 않는다.

## 기술 스택
- Next.js 15 (App Router)
- TypeScript (strict mode)
- Tailwind CSS
- 테스트: vitest
- 외부 API: Binance Futures (과거 캔들), Deepcoin (실시간 캔들·펀딩), Anthropic Claude API (레짐 해설)

## 아키텍처 규칙

- CRITICAL: 모든 외부 API 호출은 `src/app/api/` 라우트 핸들러에서만 처리한다. 클라이언트 컴포넌트에서 거래소 API나 API 키를 직접 다루지 말 것. 키는 `process.env`로만 접근한다.
- CRITICAL: **돈 계산은 전부 `src/lib/`의 순수 함수로 둔다.** 지표·시그널·포지션 사이징·청산가·백테스트는 `src/app/`이나 `src/services/`에서 인라인으로 계산하지 말 것. 이유: 검증 불가능한 계산에 실제 자본이 걸린다.
- CRITICAL: **백테스트와 실시간은 동일한 시그널 함수를 호출한다.** `src/lib/signal/`·`src/lib/risk/`를 양쪽에서 그대로 import 한다. 백테스트용으로 로직을 다시 구현하지 말 것. 이유: 재구현 드리프트는 "백테스트는 되는데 실전은 안 되는" 1순위 원인이다 (ADR-001).
- CRITICAL: **확정봉(closed candle)만 사용한다.** 진행 중인 캔들로 시그널을 판정하지 말 것. 이유: 미확정봉의 고가·저가·종가는 계속 변하므로 신호가 사라졌다 나타나는 리페인팅이 발생하고, 백테스트 성적이 실전과 괴리된다 (ADR-006).
- CRITICAL: **백테스트에서 미래 데이터를 참조하지 말 것.** i번 캔들의 시그널은 i번 캔들의 종가까지만 쓰고, 체결은 i+1번 캔들부터 일어난다. 이유: 룩어헤드 편향은 백테스트를 무의미하게 만든다.
- CRITICAL: **자동 주문 실행 금지.** v1은 알림 전용이다. 거래소 주문 API를 호출하는 코드를 작성하지 말고, 출금·거래 권한이 있는 API 키를 요구하지 말 것 (ADR-002).
- 컴포넌트는 `src/components/`, 타입은 `src/types/`, 순수 함수는 `src/lib/`, 외부 API 래퍼는 `src/services/`에 둔다.
- `src/services/`는 클래스/팩토리가 아닌 평범한 `async` 함수로 작성한다. 한 번만 쓰이는 추상화를 만들지 말 것.

## 개발 프로세스
- CRITICAL: `src/lib/` 순수 함수는 테스트를 먼저 작성하고 통과시킨다 (TDD). `src/services/`·`src/components/`·라우트는 유닛 테스트 대신 `npm run build` 통과 + 수동 검증으로 대체한다 (근거: docs/ADR.md ADR-005).
- 지표 구현은 알려진 값으로 검증한다. 손으로 계산한 기대값 또는 고정 픽스처를 테스트에 박아넣는다.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:, test:, chore:)

## 도메인 상수 (기본값 — 전부 설정으로 덮어쓸 수 있어야 한다)
- 자본금 5,000 USDT / 레버리지 50x
- 왕복 수수료 명목가의 0.08% (진입·청산 각 0.04%) = 50배에서 증거금 대비 4%. **추정 기본값이며 `GET /deepcoin/account/trade-fee`의 실측값으로 덮어쓴다 (ADR-012).**
- 유지증거금률 0.5% — 추정 기본값. `GET /deepcoin/market/step-margin`의 구간표로 덮어쓴다 (ADR-012).
- 심볼 BTC-USDT 무기한, 타임프레임 5분
- 기본 목표: 손절폭의 1.38배(`targetRMultiple`) — 50배 기준 가격 0.58% 변동 = 증거금 대비 순수익 25% (ADR-013)
- 손절: ATR(14) × 1.2, 청산가를 손절로 쓰지 않는다

## 명령어
npm run dev            # 개발 서버
npm run build          # 프로덕션 빌드
npm run lint           # ESLint
npm run test           # 테스트 (vitest)
npm run fetch-history  # 과거 캔들 다운로드 (로컬 실행 전용)
