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

  it('패스프레이즈만 비어 있으면 그것만 콕 집어 말한다', () => {
    // 발급 화면에 apikey·secretkey만 보여서 패스프레이즈를 못 찾는 경우가 흔하다.
    // 패스프레이즈는 발급값이 아니라 키를 만들 때 직접 정하는 비밀번호다.
    const s = describeCredentials(facts({ hasPassphrase: false, httpStatus: null }));
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('missing-passphrase');
    expect(s.message).toContain('직접 정한');
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
