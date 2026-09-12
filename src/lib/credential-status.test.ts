import { describe, expect, it } from 'vitest';
import { describeCredentials, type CredentialFacts } from '@/lib/credential-status';

function facts(over: Partial<CredentialFacts> = {}): CredentialFacts {
  return {
    hasApiKey: true,
    hasSecret: true,
    hasPassphrase: true,
    httpStatus: 200,
    exchangeCode: '0',
    exchangeMessage: null,
    networkError: false,
    ...over,
  };
}

describe('describeCredentials — 왜 실측이 안 되는지 알려준다', () => {
  it('전부 갖춰지고 거래소가 0을 주면 정상이다', () => {
    const s = describeCredentials(facts());
    expect(s.ok).toBe(true);
    expect(s.reason).toBe('ok');
  });

  it('키가 하나도 없으면 설정 자체가 안 된 것이다', () => {
    const s = describeCredentials(
      facts({ hasApiKey: false, hasSecret: false, hasPassphrase: false, httpStatus: null }),
    );
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('no-keys');
    expect(s.message).toContain('.env.local');
  });

  it('패스프레이즈가 없어도 거래소가 받아주면 정상이다', () => {
    // 발급 화면에 입력란이 없는 계정이 있다. 필요 여부는 우리가 아니라
    // 거래소가 정한다 — 호출해봤으면 그 답을 써야 한다.
    const s = describeCredentials(facts({ hasPassphrase: false }));
    expect(s.ok).toBe(true);
    expect(s.reason).toBe('ok');
  });

  it('패스프레이즈가 없고 거래소가 거부하면 그것을 원인으로 지목한다', () => {
    const s = describeCredentials(
      facts({ hasPassphrase: false, httpStatus: 401, exchangeCode: null }),
    );
    expect(s.reason).toBe('missing-passphrase');
    expect(s.message).toContain('401');
  });

  it('거래소가 패스프레이즈를 요구하면 키를 새로 만들라고 안내한다', () => {
    // 딥코인은 키 생성 시점에만 패스프레이즈를 받는다. 기존 키에 나중에
    // 추가할 수 없으므로 "넣어라"가 아니라 "다시 만들어라"가 맞다.
    const s = describeCredentials(
      facts({
        hasPassphrase: false,
        httpStatus: 400,
        exchangeCode: '50104',
        exchangeMessage: "Request header 'DC-ACCESS-PASSPHRASE' can't be empty.",
      }),
    );
    expect(s.reason).toBe('missing-passphrase');
    expect(s.message).toContain('새로 만들');
    expect(s.message).toContain('50104');
  });

  it('패스프레이즈가 있는데 거부당하면 다른 원인을 가리킨다', () => {
    const s = describeCredentials(facts({ httpStatus: 401, exchangeCode: null }));
    expect(s.reason).toBe('rejected');
  });

  it('호출조차 못 한 상태에서 패스프레이즈만 비어 있으면 그것만 콕 집어 말한다', () => {
    // 발급 화면에 apikey·secretkey만 보여서 패스프레이즈를 못 찾는 경우가 흔하다.
    // 패스프레이즈는 발급값이 아니라 키를 만들 때 직접 정하는 비밀번호다.
    const s = describeCredentials(facts({ hasPassphrase: false, httpStatus: null }));
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('missing-passphrase');
    expect(s.message).toContain('비밀번호');
  });

  it('시크릿만 비면 불완전으로 본다', () => {
    const s = describeCredentials(facts({ hasSecret: false, httpStatus: null }));
    expect(s.reason).toBe('incomplete');
  });

  it('네트워크가 막히면 자격증명 문제로 몰지 않는다', () => {
    const s = describeCredentials(facts({ networkError: true, httpStatus: null }));
    expect(s.reason).toBe('network');
    expect(s.message).toContain('연결');
  });

  it('401·403은 서명 거부로 본다', () => {
    for (const status of [401, 403]) {
      const s = describeCredentials(facts({ httpStatus: status, exchangeCode: null }));
      expect(s.reason).toBe('rejected');
      expect(s.message).toContain('IP');
    }
  });

  it('거래소가 0이 아닌 코드를 주면 메시지를 그대로 전달한다', () => {
    const s = describeCredentials(
      facts({ exchangeCode: '50113', exchangeMessage: 'Invalid Sign' }),
    );
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('rejected');
    expect(s.message).toContain('Invalid Sign');
    expect(s.message).toContain('50113');
  });

  it('5xx는 거래소 쪽 오류로 구분한다', () => {
    const s = describeCredentials(facts({ httpStatus: 502, exchangeCode: null }));
    expect(s.reason).toBe('exchange-error');
  });

  it('메시지는 항상 비어 있지 않다', () => {
    const cases: Partial<CredentialFacts>[] = [
      {},
      { hasApiKey: false, hasSecret: false, hasPassphrase: false },
      { hasPassphrase: false },
      { networkError: true },
      { httpStatus: 401 },
      { httpStatus: 502, exchangeCode: null },
      { exchangeCode: '1', exchangeMessage: null },
    ];
    for (const c of cases) {
      expect(describeCredentials(facts(c)).message.length).toBeGreaterThan(0);
    }
  });
});
