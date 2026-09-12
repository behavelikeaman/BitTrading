'use client';

import { useEffect, useState } from 'react';

/**
 * localStorage에 저장되는 상태.
 *
 * 서버 렌더링 시점에는 localStorage가 없으므로 첫 렌더는 항상 기본값으로
 * 하고, 마운트 후에 저장값을 불러온다. 그러지 않으면 하이드레이션이 어긋난다.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue({ ...initial, ...(JSON.parse(raw) as T) });
    } catch {
      // 저장값이 깨졌으면 기본값을 그대로 쓴다
    }
    // key만 의존한다. initial은 매 렌더 새 객체라 넣으면 루프가 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 저장 실패는 무시한다. 화면 동작에는 영향이 없다.
    }
  };

  return [value, update];
}
