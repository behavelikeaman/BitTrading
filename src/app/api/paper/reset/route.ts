import { NextResponse } from 'next/server';
import { resetPaper } from '@/services/paper-store';

export const runtime = 'nodejs';

/**
 * 페이퍼 상태와 일지를 지운다.
 *
 * 되돌릴 수 없으므로 본문에 `{ "confirm": true }`를 요구한다.
 */
export async function POST(
  request: Request,
): Promise<NextResponse<{ ok: true } | { error: string }>> {
  let body: { confirm?: boolean };
  try {
    body = (await request.json()) as { confirm?: boolean };
  } catch {
    return NextResponse.json({ error: 'JSON 본문을 읽을 수 없다' }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: '되돌릴 수 없는 작업이다. { "confirm": true }가 필요하다.' },
      { status: 400 },
    );
  }

  try {
    await resetPaper();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '초기화 실패' },
      { status: 500 },
    );
  }
}
