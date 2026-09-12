'use client';

import type { ScoreItem } from '@/types';

interface Props {
  items: ScoreItem[];
  score: number;
}

/**
 * 8개 항목을 전부 보여준다. 실패 항목을 숨기지 않는다.
 *
 * 어느 조건이 왜 켜지고 꺼졌는지 보는 것이 이 화면의 핵심 가치다.
 */
export function ScoreBreakdown({ items, score }: Props) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">컨플루언스 점수</h2>
        <span className="text-lg font-bold">{score}/8</span>
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
              </td>
              <td className="py-1.5 align-top text-xs text-neutral-400">
                {item.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
