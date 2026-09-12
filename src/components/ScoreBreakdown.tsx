'use client';

import { useState } from 'react';
import type { ScoreItem, ScoreKey } from '@/types';
import { SCORE_ITEM_COUNT } from '@/lib/signal/score';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import { DEFAULT_ACCOUNT } from '@/lib/risk/sizing';

interface Props {
  items: ScoreItem[];
  score: number;
}

/**
 * 각 항목이 무엇을 보는지와 통과 조건.
 *
 * 화면에 숫자만 뜨면 "왜 이 항목이 꺼졌는가"를 매번 코드에서 확인해야 한다.
 * 설명은 `score.ts`의 실제 판정과 반드시 일치해야 한다 — 어긋나면 화면이
 * 거짓말을 하게 되므로, 판정 조건을 고칠 때 이 표도 같이 고친다.
 */
const CFG = DEFAULT_ENTRY_CONFIG;

const GUIDE: Record<ScoreKey, { why: string; pass: string }> = {
  emaCross: {
    why: '유일한 트리거. 이 교차가 없으면 나머지 9개가 전부 통과해도 진입 신호는 나지 않는다.',
    pass: 'EMA12가 BB중앙선(SMA20)을 이번 봉에서 넘어섰는가. 방향은 교차가 아니라 셋업이 정한다.',
  },
  stackAlignment: {
    why: '지금이 추세 구간인지 아닌지를 가른다. SMMA 20·55·95·135가 줄을 서 있어야 눌림목·되돌림이라는 말이 성립한다.',
    pass: '정배열(20>55>95>135) 또는 역배열(20<55<95<135). 혼조는 실패이며 밴드 돌파 셋업으로 분류된다. 스택은 135봉이 쌓여야 판정된다.',
  },
  stackSpread: {
    why: '같은 교차를 눌림목과 과이격으로 가르는 기준. 이 항목 때문에 "과이격 추격"이 진입 금지로 빠진다.',
    pass: `셋업마다 요구가 반대다 — 과이격 되돌림은 벌어져 있어야 통과, 눌림목·밴드 돌파는 벌어져 있지 않아야 통과. 이격은 ATR이 아니라 가격 대비로 재고, 최근 ${CFG.spreadLookback}봉 중앙값의 ${CFG.extendedMedianMultiple}배 + ${(CFG.extendedMinPct * 100).toFixed(2)}% 이상을 과이격으로 본다 (추정 기본값).`,
  },
  bbPosition: {
    why: '교차가 실제 움직임으로 이어졌는지 확인한다. 교차만으로는 관 안에서 스치는 경우와 구분되지 않는다.',
    pass: '밴드 돌파는 종가가 밴드 밖, 눌림목 재진입은 종가가 SMMA20(빨강)을 되찾음, 과이격 되돌림은 종가가 BB중앙선을 반대쪽으로 이탈.',
  },
  bandExpansion: {
    why: '변동성이 죽은 구간의 교차를 걸러내려는 항목. 좁은 관 안에서는 골든·데드가 반복되고 그 교차는 대부분 노이즈다.',
    pass: `현재 BB 폭 > 최근 ${CFG.bbWidthLookback}봉 중앙값. ⚠ 지금 조건은 "좁은 관 다음의 첫 확장"과 "계속 넓은 상태"를 구분하지 못한다. 백테스트 리포트의 밴드 폭 상태별 성적표로 검증 중이다.`,
  },
  volume: {
    why: '거래량 없는 교차는 되돌려지기 쉽다. 참여가 실렸는지 본다.',
    pass: `신호봉 거래량 ≥ 최근 20봉 평균 × ${CFG.volumeMultiple}.`,
  },
  higherTimeframe: {
    why: '상위 프레임을 거스르는 진입을 막는다. 5분봉 신호는 15분봉 흐름 안에서만 의미가 있다.',
    pass: '15분 EMA50의 기울기가 진입 방향과 같은가. 되돌림 셋업에서는 기준이 뒤집힌다 — 상위 추세가 살아 있어야 스택 하단에서 멈출 근거가 생기기 때문이다 (ADR-022).',
  },
  trendStrength: {
    why: '횡보장에서 추세 전략을 돌리면 손절만 쌓인다.',
    pass: `ADX(14) ≥ ${CFG.adxMin}.`,
  },
  funding: {
    why: '펀딩이 과열된 방향은 이미 한쪽으로 몰린 자리다. 그쪽으로 따라 들어가는 것을 막는다.',
    pass: `롱은 펀딩비 < +${(CFG.fundingLimit * 100).toFixed(2)}%, 숏은 > −${(CFG.fundingLimit * 100).toFixed(2)}%.`,
  },
  session: {
    why: '유동성이 얇은 시간대는 슬리피지가 커지고 가짜 돌파가 많다.',
    pass: `UTC ${CFG.sessionStartUtcHour}~${CFG.sessionEndUtcHour}시 (KST ${(CFG.sessionStartUtcHour + 9) % 24}시~다음날 ${(CFG.sessionEndUtcHour + 9) % 24}시).`,
  },
};

/**
 * 10개 항목을 전부 보여준다. 실패 항목을 숨기지 않는다.
 *
 * 어느 조건이 왜 켜지고 꺼졌는지 보는 것이 이 화면의 핵심 가치다.
 */
export function ScoreBreakdown({ items, score }: Props) {
  const [showGuide, setShowGuide] = useState(true);
  const high = CFG.highConvictionScore;
  const medium = CFG.mediumConvictionScore;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">컨플루언스 점수</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-900"
          >
            {showGuide ? '설명 접기' : '설명 보기'}
          </button>
          <span className="text-lg font-bold tabular-nums">
            {score}/{SCORE_ITEM_COUNT}
          </span>
        </div>
      </div>

      {/* 가중치 — 점수가 무엇을 결정하는지 */}
      <div className="mb-3 rounded border border-neutral-800 bg-neutral-900/40 p-2 text-[11px] leading-relaxed text-neutral-400">
        <p>
          <span className="font-semibold text-neutral-200">가중치는 전부 같다.</span>{' '}
          {SCORE_ITEM_COUNT}개 항목이 각 1점이고, 점수는 통과 개수다. 항목별 배점을
          다르게 두지 않는 이유는 어느 조건이 얼마나 중요한지 아직 데이터로
          모르기 때문이다 — 근거 없는 가중치는 근거 없는 확신을 만든다.
        </p>
        <p className="mt-1">
          <span className="text-[var(--color-long)]">{high}점 이상 = 확신</span> → 리스크
          예산 자본의 {(DEFAULT_ACCOUNT.riskPctHigh * 100).toFixed(0)}% ·{' '}
          <span className="text-[var(--color-warn)]">{medium}점 이상 = 약간의 확신</span> →{' '}
          {(DEFAULT_ACCOUNT.riskPctMedium * 100).toFixed(0)}% · {medium}점 미만은 진입 없음.
          점수는 <span className="text-neutral-200">포지션 크기</span>를 정할 뿐
          목표가·손절가는 바꾸지 않는다.
        </p>
        <p className="mt-1">
          점수보다 먼저 걸리는 <span className="text-neutral-200">차단 조건</span>이
          있다 — 데이터 부족 · 이상 변동성(ATR 급등) · 연속 손실 한도 · 일일 손실 한도 ·
          지표 발표 블랙아웃 · 진입 셋업 없음. 하나라도 걸리면 점수와 무관하게 진입하지
          않는다.
        </p>
        <p className="mt-1 text-neutral-500">
          같은 항목이라도 셋업(눌림목 재진입 · 과이격 되돌림 · 밴드 돌파)에 따라 통과
          조건이 달라진다 (ADR-022). 이 채점 구성 자체는 아직 검증되지 않았다 — 6개월
          백테스트에서 마찰 차감 전 기대값이 0에 가까웠다.
        </p>
      </div>

      <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-t border-neutral-900">
              <td className="w-6 py-1.5 align-top">
                <span
                  className={
                    item.passed
                      ? 'text-[var(--color-long)]'
                      : 'text-neutral-500'
                  }
                >
                  {item.passed ? '✓' : '✗'}
                </span>
              </td>
              <td className="w-36 py-1.5 align-top font-medium text-neutral-100">
                {item.label}
                <div className="text-[10px] font-normal text-neutral-600">1점</div>
              </td>
              <td className="py-1.5 align-top text-xs text-neutral-400">
                {item.detail}
                {showGuide && (
                  <div className="mt-1 space-y-0.5 border-l border-neutral-800 pl-2 text-[11px] leading-relaxed">
                    <p className="text-neutral-500">
                      <span className="text-neutral-400">왜 보는가 </span>
                      {GUIDE[item.key].why}
                    </p>
                    <p className="text-neutral-500">
                      <span className="text-neutral-400">통과 조건 </span>
                      {GUIDE[item.key].pass}
                    </p>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
