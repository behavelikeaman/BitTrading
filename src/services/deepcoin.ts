import crypto from 'node:crypto';
import {
  describeCredentials,
  type CredentialStatus,
} from '@/lib/credential-status';
import type { Candle } from '@/types';
import {
  describeShape,
  parseDeepcoinCandles,
  parseTradeFee,
  toRows,
} from '@/lib/parse-deepcoin';
import type { Fill } from '@/lib/measure-slippage';

const BASE_URL = 'https://api.deepcoin.com';
const DEFAULT_INST_ID = 'BTC-USDT-SWAP';
/** 1회 최대 개수 (docs/DEEPCOIN-API.md) */
const MAX_LIMIT = 300;

/** Deepcoin은 1시간 이상을 대문자로 쓴다 (docs/DEEPCOIN-API.md) */
const BAR_PARAM: Record<DeepcoinBar, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
};

const INTERVAL_MS: Record<DeepcoinBar, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

export type DeepcoinBar = '5m' | '15m' | '1h';

interface DeepcoinEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

function buildPath(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

/**
 * 비공개 엔드포인트용 서명 헤더 (docs/DEEPCOIN-API.md).
 *
 * payload = ISO8601 + METHOD + '/' + requestPath(쿼리 포함) [+ body]
 * sign    = base64(HMAC-SHA256(secret, payload))
 *
 * 키가 없으면 null을 반환한다. 호출부는 기본값으로 폴백해야 하며,
 * 공개 엔드포인트는 키 없이도 동작해야 한다.
 */
function signedHeaders(
  method: 'GET' | 'POST',
  requestPath: string,
  body?: string,
): Record<string, string> | null {
  const apiKey = process.env.DEEPCOIN_API_KEY;
  const secret = process.env.DEEPCOIN_API_SECRET;
  // 패스프레이즈가 없어도 호출은 시도한다. 발급 화면에 따라 패스프레이즈
  // 입력란이 보이지 않는 경우가 있는데, 여기서 미리 포기하면 "왜 실측이
  // 안 되는가"에 답할 수 없다. 거래소가 거부하면 그 응답으로 판정한다.
  const passphrase = process.env.DEEPCOIN_API_PASSPHRASE ?? '';
  if (!apiKey || !secret) return null;

  const timestamp = new Date().toISOString();
  const payload = `${timestamp}${method}/${requestPath}${body ?? ''}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64');

  return {
    'DC-ACCESS-KEY': apiKey,
    'DC-ACCESS-TIMESTAMP': timestamp,
    'DC-ACCESS-PASSPHRASE': passphrase,
    'DC-ACCESS-SIGN': signature,
    appid: '200103',
  };
}

async function getPublic<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const requestPath = buildPath(path, params);
  const response = await fetch(`${BASE_URL}/${requestPath}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      `Deepcoin ${path} 조회 실패 (${response.status}): ${await response.text()}`,
    );
  }
  const envelope = (await response.json()) as DeepcoinEnvelope<T>;
  if (envelope.code !== '0') {
    throw new Error(`Deepcoin ${path} 오류 (code ${envelope.code}): ${envelope.msg}`);
  }
  return envelope.data;
}

/** 키가 없거나 호출이 실패하면 null. 앱 전체는 기본값으로 계속 동작해야 한다. */
async function getPrivate<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const requestPath = buildPath(path, params);
  const headers = signedHeaders('GET', requestPath);
  if (headers === null) return null;

  try {
    const response = await fetch(`${BASE_URL}/${requestPath}`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as DeepcoinEnvelope<T>;
    if (envelope.code !== '0') return null;
    return envelope.data;
  } catch {
    return null;
  }
}

/**
 * 실시간 캔들. 공개 엔드포인트이므로 키 없이 동작한다.
 *
 * 응답은 내림차순·문자열이고 마지막 캔들이 미확정일 수 있다. 세 가지 모두
 * parseDeepcoinCandles가 처리한다 (오름차순 변환·숫자 파싱·미확정봉 제외).
 */
export async function fetchRecentCandles(input: {
  instId?: string;
  bar: DeepcoinBar;
  limit?: number;
  /** 이 시각(ms) 이전 구간. Deepcoin에는 since가 없어 역방향으로 페이지한다. */
  after?: number;
  nowMs?: number;
}): Promise<Candle[]> {
  const params: Record<string, string> = {
    instId: input.instId ?? DEFAULT_INST_ID,
    bar: BAR_PARAM[input.bar],
    limit: String(Math.min(input.limit ?? MAX_LIMIT, MAX_LIMIT)),
  };
  if (input.after !== undefined) params.after = String(input.after);

  const rows = await getPublic<string[][]>('deepcoin/market/candles', params);
  return parseDeepcoinCandles(rows, INTERVAL_MS[input.bar], input.nowMs ?? Date.now());
}

/** 현재 펀딩비. 소수 비율로 정규화한다 (0.01% -> 0.0001). */
export async function fetchFundingRate(instId = DEFAULT_INST_ID): Promise<number> {
  const data = await getPublic<{ fundingRate?: string } | { fundingRate?: string }[]>(
    'deepcoin/trade/fund-rate/current-funding-rate',
    { instId },
  );
  const entry = Array.isArray(data) ? data[0] : data;
  const rate = Number(entry?.fundingRate);
  return Number.isFinite(rate) ? rate : 0;
}

/** 유지증거금 구간표 (ADR-012). 청산가를 추정치가 아닌 실제 값으로 계산한다. */
export async function fetchStepMargin(
  instId = DEFAULT_INST_ID,
): Promise<{ tiers: { maxNotional: number; mmr: number }[] } | null> {
  try {
    const data = await getPublic<
      { maxSz?: string; maxNotional?: string; mmr?: string }[]
    >('deepcoin/market/step-margin', { instId });
    const tiers = (data ?? [])
      .map((row) => ({
        maxNotional: Number(row.maxNotional ?? row.maxSz),
        mmr: Number(row.mmr),
      }))
      .filter((t) => Number.isFinite(t.maxNotional) && Number.isFinite(t.mmr));
    return tiers.length > 0 ? { tiers } : null;
  } catch {
    return null;
  }
}

/**
 * 비공개 엔드포인트가 요구하는 상품 구분. BTC-USDT 무기한은 SWAP이다.
 *
 * 빠뜨리면 거래소가 `code 51: The instType field is required.`로 거부한다.
 * 허용값은 SPOT·SWAP 두 가지다 (거래소 오류 메시지로 확인).
 */
const INST_TYPE = 'SWAP';

/** 실제 수수료율 (ADR-012). 키가 없으면 null이고 호출부는 기본값을 쓴다. */
export async function fetchTradeFee(
  instId = DEFAULT_INST_ID,
): Promise<{ maker: number; taker: number } | null> {
  return (await fetchTradeFeeDetailed(instId)).fee;
}

/**
 * 수수료율과 **응답 모양**을 함께 돌려준다.
 *
 * 파싱이 실패했을 때 무엇이 왔는지 모르면 추측만 반복하게 된다. 실제로
 * 응답이 배열로 감싸여 오는 바람에 인증은 통과했는데 화면은 "(추정)"에
 * 머무는 일이 있었다. 값은 담지 않고 키 이름만 남긴다.
 */
export async function fetchTradeFeeDetailed(
  instId = DEFAULT_INST_ID,
): Promise<{ fee: { maker: number; taker: number } | null; shape: string }> {
  const data = await getPrivate<unknown>('deepcoin/account/trade-fee', {
    instType: INST_TYPE,
    instId,
  });
  return { fee: parseTradeFee(data), shape: describeShape(data) };
}

/** 실제 체결 내역 (ADR-014). 슬리피지 실측용. */
export async function fetchFills(input: {
  instId?: string;
  limit?: number;
} = {}): Promise<Fill[] | null> {
  const data = await getPrivate<unknown>('deepcoin/trade/fills', {
    instType: INST_TYPE,
    instId: input.instId ?? DEFAULT_INST_ID,
    limit: String(input.limit ?? 100),
  });
  if (data === null) return null;

  // 목록도 배열로 올 수도, 배열을 품은 객체로 올 수도 있다.
  return toRows(data)
    .map((raw) => {
      const row = raw as { ts?: string; side?: string; fillPx?: string; fillSz?: string };
      return {
        ts: Number(row.ts),
        side: row.side === 'sell' ? ('sell' as const) : ('buy' as const),
        fillPrice: Number(row.fillPx),
        qty: Number(row.fillSz),
      };
    })
    .filter((f) => Number.isFinite(f.ts) && Number.isFinite(f.fillPrice));
}

/**
 * 읽기 전용 키가 실제로 동작하는지 한 번 호출해 확인한다.
 *
 * 판정 규칙은 src/lib/credential-status.ts의 순수 함수가 갖고, 여기서는
 * 사실(환경변수 유무, HTTP 상태, 거래소 코드)만 모아 넘긴다.
 */
export async function checkCredentials(
  instId = DEFAULT_INST_ID,
): Promise<CredentialStatus> {
  const hasApiKey = Boolean(process.env.DEEPCOIN_API_KEY);
  const hasSecret = Boolean(process.env.DEEPCOIN_API_SECRET);
  const passphrase = process.env.DEEPCOIN_API_PASSPHRASE ?? '';
  const hasPassphrase = passphrase.length > 0;

  const base = {
    hasApiKey,
    hasSecret,
    hasPassphrase,
    // 길이만 넘긴다. 값은 어떤 경로로도 화면·로그에 나가면 안 된다.
    passphraseLength: passphrase.length,
    httpStatus: null as number | null,
    exchangeCode: null as string | null,
    exchangeMessage: null as string | null,
    networkError: false,
  };

  if (!hasApiKey || !hasSecret) return describeCredentials(base);

  const requestPath = buildPath('deepcoin/account/trade-fee', {
    instType: INST_TYPE,
    instId,
  });
  const headers = signedHeaders('GET', requestPath);
  if (headers === null) return describeCredentials(base);

  try {
    const response = await fetch(`${BASE_URL}/${requestPath}`, {
      headers,
      cache: 'no-store',
    });
    let code: string | null = null;
    let msg: string | null = null;
    try {
      const envelope = (await response.json()) as DeepcoinEnvelope<unknown>;
      code = envelope.code ?? null;
      msg = envelope.msg ?? null;
    } catch {
      // 본문이 JSON이 아니면 상태 코드만으로 판정한다.
    }
    return describeCredentials({
      ...base,
      httpStatus: response.status,
      exchangeCode: code,
      exchangeMessage: msg,
    });
  } catch {
    return describeCredentials({ ...base, networkError: true });
  }
}
