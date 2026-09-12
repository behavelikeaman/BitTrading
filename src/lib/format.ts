/**
 * 화면 표시용 포맷 함수.
 *
 * 자릿수를 한 곳에 모아두는 이유는, 같은 숫자가 화면마다 다른 자릿수로
 * 보이면 주문을 넣기 전에 확인해야 할 값을 잘못 읽게 되기 때문이다.
 */

/** 값이 없을 때 표시할 문자열 */
const EMPTY = '—';

function guard(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 가격. 소수점 1자리 + 천단위 구분 */
export function formatPrice(value: number | null | undefined): string {
  if (!guard(value)) return EMPTY;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** BTC 수량. 소수점 4자리 */
export function formatQty(value: number | null | undefined): string {
  if (!guard(value)) return EMPTY;
  return value.toFixed(4);
}

/** USDT 금액. 소수점 2자리 + 천단위 구분 */
export function formatUsd(value: number | null | undefined): string {
  if (!guard(value)) return EMPTY;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 부호를 항상 붙인 USDT 금액. 손익 표시용 */
export function formatSignedUsd(value: number | null | undefined): string {
  if (!guard(value)) return EMPTY;
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatUsd(value)}`;
}

/** 비율 -> 퍼센트. 기본 소수점 2자리 */
export function formatPct(
  value: number | null | undefined,
  digits = 2,
): string {
  if (!guard(value)) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

/** 수수료·슬리피지처럼 작은 비율. 소수점 4자리 */
export function formatRate(value: number | null | undefined): string {
  return formatPct(value, 4);
}

/** ms epoch -> 로컬 HH:MM:SS */
export function formatTime(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** ms epoch -> YYYY-MM-DD HH:MM */
export function formatDateTime(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 일반 비율. 소수점 2자리 */
export function formatRatio(value: number | null | undefined): string {
  if (typeof value === 'number' && value === Number.POSITIVE_INFINITY) return '∞';
  if (!guard(value)) return EMPTY;
  return value.toFixed(2);
}

/**
 * 손익비 전용. null은 "손실이 없어 정의되지 않음"이므로 ∞로 그린다.
 *
 * 트레이드가 0건일 때도 null이지만, 그 경우 화면에 트레이드 목록 자체가
 * 비어 있으므로 혼동되지 않는다.
 */
export function formatProfitFactor(
  value: number | null | undefined,
  hasTrades: boolean,
): string {
  if (!hasTrades) return EMPTY;
  if (value === null || value === undefined) return '∞';
  if (!guard(value)) return EMPTY;
  return value.toFixed(2);
}
