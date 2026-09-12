'use client';

interface Props {
  warnings: string[];
}

/** 청산 관련 경고는 빨간색으로 격상한다. 나머지는 노란 배너. */
export function RiskWarning({ warnings }: Props) {
  if (warnings.length === 0) return null;

  return (
    <section className="space-y-2">
      {warnings.map((warning) => {
        const critical = warning.includes('청산가');
        return (
          <p
            key={warning}
            className={`rounded border px-3 py-2 text-sm ${
              critical
                ? 'border-[var(--color-short)]/50 bg-[var(--color-short)]/10 text-[var(--color-short)]'
                : 'border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10 text-[var(--color-warn)]'
            }`}
          >
            {warning}
          </p>
        );
      })}
    </section>
  );
}
