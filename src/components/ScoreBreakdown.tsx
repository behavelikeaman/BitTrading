'use client';

import { useState } from 'react';
import type { GateKey, ScoreKey, Signal } from '@/types';
import { SCORE_ITEM_COUNT } from '@/lib/signal/score';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import { DEFAULT_ACCOUNT } from '@/lib/risk/sizing';

interface Props {
  signal: Signal;
}

/**
 * 각 항목이 무엇을 보는지와 통과 조건.
 *
 * 화면에 숫자만 뜨면 "왜 이 항목이 꺼졌는가"를 매번 코드에서 확인해야 한다.
 * 설명은 `score.ts`의 실제 판정과 반드시 일치해야 한다 — 어긋나면 화면이
 * 거짓말을 하게 되므로, 판정 조건을 고칠 때 이 표도 같이 고친다.
 */
const CFG = DEFAULT_ENTRY_CONFIG;

const MIN_BB_WIDTH = CFG.roundTripCostRate * CFG.minBbWidthCostMultiple;

const SCORE_GUIDE: Record<ScoreKey, { why: string; pass: string }> = {
  stackAlignment: {
    why: '추세 판정의 대표 항목. 셋 중 가장 직접적이고 지연이 적다. SMMA 20·55·95·135가 줄을 서 있어야 눌림목·되돌림이라는 말이 성립한다.',
    pass: '정배열(20>55>95>135) 또는 역배열(20<55<95<135). 혼조는 실패이며 밴드 돌파 셋업으로 분류된다. 스택은 135봉이 쌓여야 판정된다.',
  },
  stackSpread: {
    why: '세 항목 중 유일한 연속형 척도. 같은 교차를 눌림목과 과이격으로 가른다. 다만 "셋업마다 요구가 반대"인 구조라 반증이 어렵다 — 셋 중 가장 의심스러운 항목이고, 100건이 쌓이면 이 항목만 껐다 켜며 차이를 재봐야 한다.',
    pass: `과이격 되돌림은 벌어져 있어야 통과, 눌림목·밴드 돌파는 벌어져 있지 않아야 통과. 이격은 ATR이 아니라 가격 대비로 재고, 최근 ${CFG.spreadLookback}봉 중앙값의 ${CFG.extendedMedianMultiple}배 + ${(CFG.extendedMinPct * 100).toFixed(2)}% 이상을 과이격으로 본다 (추정 기본값).`,
  },
  volume: {
    why: '세 항목 중 **가격에서 파생되지 않은 유일한 정보**다. 이걸 빼면 점수가 100% 가격의 함수가 된다.',
    pass: `신호봉 거래량 ≥ 최근 20봉 평균 × ${CFG.volumeMultiple}.`,
  },
};

const GATE_GUIDE: Record<GateKey, { why: string; pass: string }> = {
  bandWidth: {
    why: '확신의 문제가 아니라 산수의 문제다. 관이 좁으면 목표가 왕복 마찰을 못 넘으므로 아무리 좋은 자리여도 들어갈 수 없다.',
    pass: `BB 폭 ≥ 왕복 마찰 ${(CFG.roundTripCostRate * 100).toFixed(3)}% × ${CFG.minBbWidthCostMultiple} = ${(MIN_BB_WIDTH * 100).toFixed(3)}%. 추정 기본값이며 백테스트로 보정해야 한다.`,
  },
  session: {
    why: '스케줄이지 신호가 아니다. 유동성이 얇은 시간대는 슬리피지가 커지고 가짜 돌파가 많다.',
    pass: `UTC ${CFG.sessionStartUtcHour}~${CFG.sessionEndUtcHour}시 (KST ${(CFG.sessionStartUtcHour + 9) % 24}시~다음날 ${(CFG.sessionEndUtcHour + 9) % 24}시).`,
  },
  funding: {
    why: 'BTC 평상시 펀딩은 0.005~0.015%라 한계의 절반도 안 된다 — 90% 이상 그냥 통과하는 조건에 점수를 주면 모든 점수가 1씩 부풀어 확신 문턱이 왜곡된다. 극단값만 막는다.',
    pass: `롱은 펀딩비 < +${(CFG.fundingLimit * 100).toFixed(2)}%, 숏은 > −${(CFG.fundingLimit * 100).toFixed(2)}%. 방향이 정해지기 전에는 절대값으로 잰다.`,
  },
};

function Mark({ passed }: { passed: boolean }) {
  return (
    <span className={passed ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}>
      {passed ? '✓' : '✗'}
    </span>
  );
}

function Row({
  passed,
  label,
  weight,
  detail,
  guide,
  showGuide,
}: {
  passed: boolean;
  label: string;
  weight: string;
  detail: string;
  guide?: { why: string; pass: string };
  showGuide: boolean;
}) {
  return (
    <tr className="border-t border-neutral-900">
      <td className="w-6 py-1.5 align-top">
        <Mark passed={passed} />
      </td>
      <td className="w-36 py-1.5 align-top font-medium text-neutral-100">
        {label}
        <div className="t-hint">{weight}</div>
      </td>
      <td className="py-1.5 align-top text-xs text-neutral-400">
        {detail}
        {showGuide && guide !== undefined && (
          <div className="mt-1 space-y-0.5 border-l border-neutral-800 pl-2 text-xs leading-relaxed">
            <p className="text-neutral-500">
              <span className="text-neutral-400">왜 보는가 </span>
              {guide.why}
            </p>
            <p className="text-neutral-500">
              <span className="text-neutral-400">통과 조건 </span>
              {guide.pass}
            </p>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * 판정을 0단계 차단 · 1단계 트리거 · 2단계 점수로 나눠 보여준다 (ADR-025).
 *
 * 예전 화면은 성격이 다른 열 가지를 한 줄에 세워 "7/10"처럼 보여줬다. 그
 * 숫자는 좋은 자리인지와 거래해도 되는 시간인지를 섞은 값이라, 세션 통과가
 * 확신을 올리는 일이 실제로 벌어졌다. 단계를 화면에서도 갈라 놓는다.
 */
export function ScoreBreakdown({ signal }: Props) {
  const [showGuide, setShowGuide] = useState(true);
  const { items, gates, trigger, score, blockers } = signal;
  // 게이트 밖에서 들어오는 차단 사유(가드·블랙아웃·데이터·트리거)도 함께 보여준다.
  const gateBlockers = new Set(gates.filter((g) => !g.passed).map((g) => g.blocker));
  const otherBlockers = blockers.filter((b) => !gateBlockers.has(b));

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="t-section">진입 판정</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-900"
          >
            {showGuide ? '설명 접기' : '설명 보기'}
          </button>
          <span className="text-lg font-bold tabular-nums">
            {score}/{SCORE_ITEM_COUNT}
          </span>
        </div>
      </div>

      <div className="mb-3 rounded border border-neutral-800 bg-neutral-900/40 p-2 text-xs leading-relaxed text-neutral-400">
        <p>
          판정은 <span className="font-semibold text-neutral-200">세 단계</span>다 —
          0단계 차단 조건(하나라도 걸리면 끝) · 1단계 트리거(없으면 끝) · 2단계 점수
          {SCORE_ITEM_COUNT}점. 앞의 둘은 점수가 아니라 통과/불통과다. 세션이 좋다고
          나쁜 자리가 좋은 자리가 되지는 않기 때문이다.
        </p>
        <p className="mt-1">
          <span className="font-semibold text-[var(--color-warn)]">
            점수는 지금 기록만 한다.
          </span>{' '}
          점수가 결과를 예측한다는 증거가 아직 없어 포지션 크기는 전 거래 동일하다
          (리스크 예산 자본의{' '}
          {(DEFAULT_ACCOUNT.riskPctMedium * 100).toFixed(0)}%). 백테스트 리포트의{' '}
          <span className="text-neutral-200">점수별 성적표</span>에서 0→1→2→3점의 평균
          R이 단조 증가하면 그때 사이징에 연결하고, 들쭉날쭉하면 점수 체계를 폐기한다.
        </p>
      </div>

      {/* 0단계 */}
      <h3 className="mb-1 text-xs font-semibold text-neutral-300">
        0단계 · 차단 조건
      </h3>
      <table className="w-full text-sm [&_td]:px-2">
        <tbody>
          {gates.map((g) => (
            <Row
              key={g.key}
              passed={g.passed}
              label={g.label}
              weight="통과/불통과"
              detail={g.detail}
              guide={GATE_GUIDE[g.key]}
              showGuide={showGuide}
            />
          ))}
        </tbody>
      </table>
      <p className="mt-1 px-2 t-hint">
        여기에 더해 데이터 부족 · 이상 변동성(ATR 급등) · 연속 손실 한도 · 일일 손실
        한도 · 지표 발표 블랙아웃도 같은 0단계에서 막는다.
      </p>
      {otherBlockers.length > 0 && (
        <p className="mt-1 px-2 text-xs text-[var(--color-warn)]">
          현재 걸린 사유: {otherBlockers.join(' · ')}
        </p>
      )}

      {/* 1단계 */}
      <h3 className="mb-1 mt-4 text-xs font-semibold text-neutral-300">
        1단계 · 트리거
      </h3>
      <table className="w-full text-sm [&_td]:px-2">
        <tbody>
          <Row
            passed={trigger.passed}
            label="EMA12 × BB중앙선 + 가격 위치"
            weight="통과/불통과"
            detail={trigger.detail}
            guide={{
              why: '필수 조건이지 점수가 아니다. 없으면 나머지가 전부 통과해도 진입 신호는 나지 않는다.',
              pass: '교차했고, 셋업 조건대로 종가가 실제로 그 자리를 만들었는가 — 밴드 돌파는 종가가 밴드 밖, 눌림목 재진입은 종가가 SMMA20(빨강)을 되찾음, 과이격 되돌림은 종가가 BB중앙선을 반대쪽으로 이탈. 가격 위치를 따로 세면 트리거를 두 번 세는 셈이다.',
            }}
            showGuide={showGuide}
          />
        </tbody>
      </table>

      {/* 2단계 */}
      <h3 className="mb-1 mt-4 text-xs font-semibold text-neutral-300">
        2단계 · 점수 ({score}/{SCORE_ITEM_COUNT})
      </h3>
      <table className="w-full text-sm [&_td]:px-2">
        <tbody>
          {items.map((item) => (
            <Row
              key={item.key}
              passed={item.passed}
              label={item.label}
              weight="1점"
              detail={item.detail}
              guide={SCORE_GUIDE[item.key]}
              showGuide={showGuide}
            />
          ))}
        </tbody>
      </table>
      <p className="mt-2 px-2 t-hint">
        가중치는 전부 같다 — 어느 조건이 얼마나 중요한지 아직 데이터로 모르기 때문이다.
        같은 항목이라도 셋업(눌림목 재진입 · 과이격 되돌림 · 밴드 돌파)에 따라 통과
        조건이 달라진다 (ADR-022). 이 채점 구성 자체는 아직 검증되지 않았다.
      </p>
    </section>
  );
}
