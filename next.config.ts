import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 빌드 출력 위치.
   *
   * 개발 서버가 도는 중에 `next build`를 같은 디렉토리에 쓰면 dev 서버의
   * 모듈 레지스트리가 깨져 Internal Server Error가 난다
   * (`__webpack_modules__[moduleId] is not a function`).
   *
   * 검증용 빌드는 NEXT_DIST_DIR로 다른 곳을 지정해 dev 서버를 건드리지 않는다.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
