/**
 * 읽기 전용 키가 왜 동작하지 않는지 한 줄로 설명한다.
 *
 * 비공개 호출은 실패해도 앱을 멈추지 않는다(기본값으로 폴백). 문제는 그
 * 조용함이다 — 화면의 "(추정)" 배지가 영원히 안 바뀌는데 이유를 알 수 없다.
 * 수수료·슬리피지 실측값은 손익분기 승률을 수십 %p 움직이므로, 왜 실측이
 * 안 되는지는 반드시 보여야 한다 (ADR-012, ADR-014).
 */

export type CredentialReason =
  | 'ok'
  | 'no-keys'
  | 'missing-passphrase'
  | 'incomplete'
  | 'network'
  | 'rejected'
  | 'exchange-error';

export interface CredentialFacts {
  hasApiKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
  /** 비공개 호출의 HTTP 상태. 호출조차 하지 않았으면 null */
  httpStatus: number | null;
  /** 거래소 응답 봉투의 code. '0'이 성공 */
  exchangeCode: string | null;
  exchangeMessage: string | null;
  /** fetch 자체가 실패했는가 (DNS·차단·타임아웃) */
  networkError: boolean;
}

export interface CredentialStatus {
  ok: boolean;
  reason: CredentialReason;
  message: string;
}

export function describeCredentials(facts: CredentialFacts): CredentialStatus {
  const { hasApiKey, hasSecret, hasPassphrase } = facts;

  if (!hasApiKey && !hasSecret && !hasPassphrase) {
    return {
      ok: false,
      reason: 'no-keys',
      message:
        '읽기 전용 키가 없다. .env.local에 DEEPCOIN_API_KEY·SECRET·PASSPHRASE를 넣으면 수수료와 슬리피지가 실측으로 바뀐다.',
    };
  }

  if (hasApiKey && hasSecret && !hasPassphrase) {
    // 발급 화면에는 APIKey와 SecretKey만 표시된다. 패스프레이즈는 거래소가
    // 발급하는 값이 아니라 키를 만들 때 사용자가 입력한 비밀번호다.
    return {
      ok: false,
      reason: 'missing-passphrase',
      message:
        '패스프레이즈가 비어 있다. 발급되는 값이 아니라 키를 만들 때 직접 정한 비밀번호다. 기억나지 않으면 키를 새로 만들어라 — 복구되지 않는다.',
    };
  }

  if (!hasApiKey || !hasSecret || !hasPassphrase) {
    return {
      ok: false,
      reason: 'incomplete',
      message: '키 세 값 중 일부가 비어 있다. .env.local을 확인하라.',
    };
  }

  if (facts.networkError) {
    return {
      ok: false,
      reason: 'network',
      message: '거래소에 연결하지 못했다. 네트워크나 방화벽을 확인하라.',
    };
  }

  if (facts.httpStatus === 401 || facts.httpStatus === 403) {
    return {
      ok: false,
      reason: 'rejected',
      message: `거래소가 인증을 거부했다 (HTTP ${facts.httpStatus}). 패스프레이즈·시크릿이 맞는지, IP 화이트리스트에 지금 IP가 있는지 확인하라.`,
    };
  }

  if (facts.httpStatus !== null && facts.httpStatus >= 500) {
    return {
      ok: false,
      reason: 'exchange-error',
      message: `거래소 응답 오류 (HTTP ${facts.httpStatus}). 잠시 뒤 다시 시도하라.`,
    };
  }

  if (facts.exchangeCode !== null && facts.exchangeCode !== '0') {
    const detail = facts.exchangeMessage ?? '메시지 없음';
    return {
      ok: false,
      reason: 'rejected',
      message: `거래소가 요청을 거부했다 (code ${facts.exchangeCode}): ${detail}. 패스프레이즈·시크릿·IP 화이트리스트를 확인하라.`,
    };
  }

  if (facts.httpStatus !== null && facts.httpStatus >= 400) {
    return {
      ok: false,
      reason: 'exchange-error',
      message: `요청이 거부됐다 (HTTP ${facts.httpStatus}).`,
    };
  }

  return { ok: true, reason: 'ok', message: '읽기 전용 키 정상 — 실측값을 쓰는 중이다.' };
}
