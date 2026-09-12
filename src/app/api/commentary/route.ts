import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { IndicatorSnapshot, ScoreItem } from '@/types';

export const runtime = 'nodejs';

/** 레퍼런스 기본값. 사고가 기본 활성이며 budget_tokens는 400 에러다. */
const MODEL = 'claude-opus-5';
/** 한 문단짜리 해설이므로 의도적으로 짧게 잡는다. */
const MAX_TOKENS = 800;

interface CommentaryRequestBody {
  indicators?: IndicatorSnapshot;
  items?: ScoreItem[];
  lastPrice?: number;
  fundingRate?: number;
}

const SYSTEM_PROMPT = [
  '너는 BTC 무기한 선물 5분봉 시장 상태를 설명하는 해설자다.',
  '',
  '반드시 지킬 것:',
  '- 진입·청산·수량·방향을 지시하지 마라. 시장 상태만 설명한다.',
  '- "사라", "팔아라", "롱을 잡아라" 같은 표현을 쓰지 마라.',
  '- 현재 레짐(추세 / 횡보 / 변동성 확대·축소)을 판단 근거와 함께 한 문단으로 쓴다.',
  '- 지표 수치를 인용해 근거를 제시한다.',
  '- 한국어로, 300자 이내 한 문단으로 쓴다.',
].join('\n');

/**
 * 현재 레짐 해설 (ADR-010).
 *
 * Claude는 해설자이지 판단 주체가 아니다. 진입·청산·사이징은 전부
 * src/lib/의 결정론적 함수가 내린다. LLM 출력은 재현되지 않아
 * 백테스트할 수 없고, 백테스트할 수 없는 규칙에 자본을 걸 수 없다.
 *
 * 요청당 1회만 호출한다. 재시도 루프를 만들지 않는다.
 */
export async function POST(
  request: Request,
): Promise<NextResponse<{ commentary: string } | { error: string }>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY가 설정되지 않았다' },
      { status: 500 },
    );
  }

  let body: CommentaryRequestBody;
  try {
    body = (await request.json()) as CommentaryRequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON 본문을 읽을 수 없다' }, { status: 400 });
  }

  const { indicators, items, lastPrice, fundingRate } = body;
  if (!indicators || !items) {
    return NextResponse.json(
      { error: 'indicators와 items가 필요하다' },
      { status: 400 },
    );
  }

  const userContent = [
    `현재가: ${lastPrice ?? '알 수 없음'}`,
    `펀딩비: ${fundingRate !== undefined ? `${(fundingRate * 100).toFixed(4)}%` : '알 수 없음'}`,
    '',
    '지표:',
    `- EMA12 ${indicators.ema12.toFixed(2)} / SMA20 ${indicators.sma20.toFixed(2)}`,
    `- 볼린저 상단 ${indicators.bbUpper.toFixed(2)} / 하단 ${indicators.bbLower.toFixed(2)} / 폭 ${(indicators.bbWidth * 100).toFixed(3)}%`,
    `- ATR14 ${indicators.atr14.toFixed(2)} / ADX14 ${indicators.adx14.toFixed(1)}`,
    `- 20봉 평균 거래량 ${indicators.volumeSma20.toFixed(0)}`,
    '',
    '컨플루언스 항목:',
    ...items.map((i) => `- ${i.label}: ${i.passed ? '통과' : '실패'} (${i.detail})`),
  ].join('\n');

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // 단순 요약 작업이므로 낮은 effort로 비용을 낮춘다.
      output_config: { effort: 'low' },
      // 정책 거절 시 같은 호출 안에서 대체 모델로 재실행한다.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json(
        { error: '해설 생성이 거부되었다' },
        { status: 502 },
      );
    }

    const commentary = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (commentary.length === 0) {
      return NextResponse.json({ error: '해설이 비어 있다' }, { status: 502 });
    }

    return NextResponse.json({ commentary });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 유효하지 않다' }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: '레이트리밋. 잠시 후 다시 시도하라' }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Claude API 오류 (${error.status}): ${error.message}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '해설 생성 실패' },
      { status: 502 },
    );
  }
}
