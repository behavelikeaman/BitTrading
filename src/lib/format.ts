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

/** 부호를 항상 붙인 퍼센트. 손익률 표시용 */
export function formatSignedPct(
  value: number | null | undefined,
  digits = 2,
): string {
  if (!guard(value)) return EMPTY;
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatPct(value, digits)}`;
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

/**
 * 화면의 모든 시각은 한국 표준시(UTC+9) 기준이다.
 *
 * 브라우저 로컬 시간대로 그리면 서버(UTC)에서 찍힌 로그·일지와 화면이
 * 어긋나고, 어느 쪽이 맞는지 확인하는 데 시간이 든다. 매매 시각은 봉이
 * 닫힌 순간을 가리켜야 하므로 한 시간대로 고정한다. 한국은 서머타임이
 * 없으므로(1988년 이후) 고정 오프셋으로 계산해도 안전하고, Intl과 달리
 * 실행 환경에 좌우되지 않는다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 화면에 붙이는 시간대 표기 */
export const TIME_ZONE_LABEL = 'KST';

/** UTC 게터로 KST 각 자리를 읽기 위해 오프셋만큼 민 Date */
function kstDate(ms: number): Date {
  return new Date(ms + KST_OFFSET_MS);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ms epoch -> KST HH:MM:SS */
export function formatTime(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  const d = kstDate(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** ms epoch -> KST YYYY-MM-DD HH:MM */
export function formatDateTime(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  const d = kstDate(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** ms epoch -> KST MM-DD (차트 축의 날짜 눈금용) */
export function formatDateShort(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  const d = kstDate(ms);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** ms epoch -> KST HH:MM (차트 축의 시각 눈금용) */
export function formatHourMinute(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  const d = kstDate(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** ms epoch -> KST YYYY (차트 축의 연 눈금용) */
export function formatYear(ms: number | null | undefined): string {
  if (!guard(ms)) return EMPTY;
  return String(kstDate(ms).getUTCFullYear());
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
