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

/**
 * 딥코인은 **키를 만드는 시점에만** 패스프레이즈를 받는다. 기존 키에 나중에
 * 추가할 수 없고 복구도 되지 않으므로, 없으면 키를 새로 만드는 것이 유일한
 * 해결책이다. (거래소 응답으로 확인: code 50104)
 */
const MISSING_PASSPHRASE_HINT =
  '패스프레이즈는 키를 만들 때 직접 정하는 비밀번호이며, 기존 키에는 나중에 추가할 수 없다. API Management에서 키를 새로 만들면서 패스프레이즈를 지정하고 .env.local에 넣어라.';

export interface CredentialStatusInput {
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
  /**
   * 전송한 패스프레이즈의 길이. **값은 절대 담지 않는다.**
   *
   * 길이만으로도 따옴표가 붙었는지, 공백이 섞였는지, 아예 빈 값인지를
   * 사용자가 바로 알아챌 수 있다.
   */
  passphraseLength?: number;
}

/** @deprecated 이름만 남긴 별칭 */
export type CredentialFacts = CredentialStatusInput;

export interface CredentialStatus {
  ok: boolean;
  reason: CredentialReason;
  message: string;
}

export function describeCredentials(facts: CredentialStatusInput): CredentialStatus {
  const { hasApiKey, hasSecret, hasPassphrase } = facts;

  if (!hasApiKey && !hasSecret && !hasPassphrase) {
    return {
      ok: false,
      reason: 'no-keys',
      message:
        '읽기 전용 키가 없다. .env.local에 DEEPCOIN_API_KEY·SECRET를 넣으면 수수료와 슬리피지가 실측으로 바뀐다.',
    };
  }

  if (!hasApiKey || !hasSecret) {
    return {
      ok: false,
      reason: 'incomplete',
      message: 'API 키나 시크릿이 비어 있다. .env.local을 확인하라.',
    };
  }

  // 호출을 실제로 해봤다면 판정은 거래소 응답이 한다. 여기서 미리
  // "패스프레이즈가 없어서 안 된다"고 단정하면, 패스프레이즈 없이도 되는
  // 계정에서 거짓 경고를 띄우게 된다.
  const attempted = facts.httpStatus !== null || facts.networkError;
  if (!attempted) {
    return hasPassphrase
      ? {
          ok: false,
          reason: 'incomplete',
          message: '키를 읽었지만 호출하지 못했다.',
        }
      : {
          ok: false,
          reason: 'missing-passphrase',
          message: MISSING_PASSPHRASE_HINT,
        };
  }

  if (facts.networkError) {
    return {
      ok: false,
      reason: 'network',
      message: '거래소에 연결하지 못했다. 네트워크나 방화벽을 확인하라.',
    };
  }

  const status = facts.httpStatus;
  const code = facts.exchangeCode;
  const rejected =
    status === 401 || status === 403 || (code !== null && code !== '0');

  if (rejected) {
    const length = facts.passphraseLength;
    // 거래소가 "패스프레이즈가 틀렸다"고 말하면 값 자체가 어긋난 것이다.
    // 서명 오류(50113)와 구분되므로 원인을 좁혀 안내할 수 있다.
    const wrongPassphrase =
      code === '50105' ||
      (facts.exchangeMessage ?? '').toUpperCase().includes('PASSPHRASE');
    if (wrongPassphrase && hasPassphrase) {
      const lengthText = length === undefined ? '' : ` 지금 ${length}자를 보냈다.`;
      return {
        ok: false,
        reason: 'rejected',
        message: `거래소가 패스프레이즈를 거부했다 (code ${code ?? facts.httpStatus}).${lengthText} .env.local에 따옴표나 앞뒤 공백이 섞이지 않았는지, 키를 만들 때 Password 칸에 넣은 값과 같은지 확인하라.`,
      };
    }
    const detail =
      code !== null && code !== '0'
        ? `code ${code}: ${facts.exchangeMessage ?? '메시지 없음'}`
        : `HTTP ${status}`;
    // 패스프레이즈가 비어 있는 채로 거부당했다면 그것이 가장 유력한 원인이다.
    return hasPassphrase
      ? {
          ok: false,
          reason: 'rejected',
          message: `거래소가 요청을 거부했다 (${detail}). 패스프레이즈·시크릿이 맞는지, IP 화이트리스트에 지금 IP가 있는지 확인하라.`,
        }
      : {
          ok: false,
          reason: 'missing-passphrase',
          message: `거래소가 요청을 거부했다 (${detail}). ${MISSING_PASSPHRASE_HINT}`,
        };
  }

  if (status !== null && status >= 500) {
    return {
      ok: false,
      reason: 'exchange-error',
      message: `거래소 응답 오류 (HTTP ${status}). 잠시 뒤 다시 시도하라.`,
    };
  }

  if (status !== null && status >= 400) {
    return {
      ok: false,
      reason: 'exchange-error',
      message: `요청이 거부됐다 (HTTP ${status}).`,
    };
  }

  return {
    ok: true,
    reason: 'ok',
    message: hasPassphrase
      ? '읽기 전용 키 정상 — 실측값을 쓰는 중이다.'
      : '읽기 전용 키 정상 — 이 계정은 패스프레이즈 없이 동작한다.',
  };
}
