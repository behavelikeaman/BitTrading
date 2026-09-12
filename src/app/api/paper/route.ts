import { NextResponse } from 'next/server';
import { loadJournal, loadState } from '@/services/paper-store';
import {
  signalCountFromJournal,
  tradesFromJournal,
  type JournalEntry,
} from '@/lib/paper/journal';
import { computeMetrics, type TradeMetrics } from '@/lib/backtest/metrics';
import type { PaperState } from '@/lib/paper/state';
import type { Trade } from '@/types';

export const runtime = 'nodejs';

/** 이 시간 이상 갱신이 없으면 티커가 멈춘 것으로 본다 */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

export interface PaperResponse {
  running: boolean;
  state: PaperState | null;
  trades: Trade[];
  journal: JournalEntry[];
  metrics: TradeMetrics | null;
  signalCount: number;
  fillRate: number;
  /** 마지막 상태 갱신 이후 경과 ms. 화면이 티커 중단을 판단한다. */
  staleMs: number | null;
}

/**
 * 페이퍼 상태를 읽는다. **읽기 전용이다.**
 *
 * 상태를 진행시키지 않는다. 시간을 진행시키는 주체는 CLI 티커 하나뿐이어야
 * 한다. 라우트가 요청마다 진행시키면 화면을 여러 개 열었을 때 같은 캔들이
 * 중복 처리된다 (ADR-018).
 *
 * 지표는 백테스트와 같은 computeMetrics를 쓴다. 다른 잣대로 재면 비교가
 * 무의미해진다.
 */
export async function GET(): Promise<NextResponse<PaperResponse>> {
  const [state, journal] = await Promise.all([loadState(), loadJournal()]);

  if (state === null) {
    // 아직 시작하지 않은 것은 오류가 아니다. 404가 아니라 200이다.
    return NextResponse.json({
      running: false,
      state: null,
      trades: [],
      journal: [],
      metrics: null,
      signalCount: 0,
      fillRate: 0,
      staleMs: null,
    });
  }

  const trades = tradesFromJournal(journal);
  const signalCount = Math.max(signalCountFromJournal(journal), state.signalCount);
  const staleMs = Date.now() - state.updatedAt;

  return NextResponse.json({
    running: staleMs < STALE_THRESHOLD_MS,
    state,
    trades,
    journal,
    metrics: computeMetrics(trades, state.startingEquity),
    signalCount,
    fillRate: signalCount === 0 ? 0 : trades.length / signalCount,
    staleMs,
  });
}
