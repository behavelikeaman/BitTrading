# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/CLAUDE.md`
- `/.env.example` (필요한 환경 변수 확인)
- `/.gitignore` (이미 `.env*.local`, `/data/*.json` 무시 규칙이 들어 있음 — 절대 덮어쓰지 마라)

## 작업

이 저장소 루트에 **Next.js 15 (App Router) + TypeScript(strict) + Tailwind CSS** 프로젝트를 초기화하고 vitest를 붙인다.

요구사항:

1. `ARCHITECTURE.md`의 디렉토리 구조대로 `src/` 기반(`--src-dir`)으로 구성한다. import alias는 `@/*`.
2. 산출물:
   - `package.json` — scripts에 `dev`, `build`, `start`, `lint`, `test`를 전부 넣는다. `test`는 `vitest run`.
   - `tsconfig.json` (strict mode 활성화)
   - `vitest.config.ts` — `@/*` alias가 테스트에서도 동작하도록 설정한다. Step 1부터 테스트가 이 alias를 쓴다.
   - `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`
   - `src/app/layout.tsx`, `src/app/globals.css` (Tailwind 지시문 포함)
   - `src/app/page.tsx` — 지금은 "BitTrading" 제목만 띄우는 최소 플레이스홀더 (실제 대시보드는 Step 7)
3. vitest를 devDependency로 설치한다. 지표 테스트가 부동소수점을 다루므로 별도 라이브러리 없이 vitest 내장 `toBeCloseTo`로 검증할 것이다.
4. `src/` 하위에 빈 디렉토리를 미리 만들 필요는 없다.
5. 어두운 배경 기준 디자인이므로 `globals.css`에 다크 배경과 등폭 폰트 변수만 잡아둔다. 실제 UI는 Step 7~8.

**기존 파일 보존 (CRITICAL)**: 이 디렉토리에는 이미 `docs/`, `scripts/`, `.claude/`, `phases/`, `CLAUDE.md`, `README.md`, `.gitignore`, `.env.example`이 존재한다. `create-next-app`은 비어 있지 않은 디렉토리에서 충돌하거나 기존 파일을 덮어쓸 수 있다. 따라서:

- 비대화형으로 실행하라 (프롬프트가 뜨면 실행이 멈춘다). 예: `npx create-next-app@latest <임시경로> --typescript --tailwind --app --src-dir --eslint --use-npm --import-alias "@/*" --no-turbopack` 후 생성된 설정/소스 파일만 루트로 옮기는 방식, 또는 동등한 수동 구성.
- 위 기존 파일들을 **덮어쓰거나 삭제하지 마라.** 특히 `.gitignore`는 `.env*.local`과 `/data/*.json` 규칙을 반드시 보존해야 한다. 병합이 필요하면 기존 규칙을 유지한 채 합쳐라.

## Acceptance Criteria

```bash
npm install
npm run build   # 컴파일·빌드 에러 없음
npm run lint    # lint 통과
npm test        # 테스트가 0개여도 에러 없이 종료해야 한다
```

> `vitest run`은 테스트 파일이 하나도 없으면 기본적으로 실패한다. `--passWithNoTests` 플래그를 붙여 이 step에서 통과하게 하라.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/app/` 구조가 ARCHITECTURE.md와 일치하는가?
   - TypeScript strict mode가 켜져 있는가?
   - `vitest.config.ts`에서 `@/*` alias가 해석되는가?
   - 기존 `docs/`, `scripts/`, `.claude/`, `phases/`, `.env.example`, `.gitignore`가 그대로 보존되었는가?
   - `.gitignore`에 `.env*.local`과 `/data/*.json`이 여전히 들어 있는가?
3. 결과에 따라 `phases/0-core/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "생성된 설정·진입 파일 경로와 vitest 설정 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `.gitignore`의 `.env*.local` 규칙을 제거하지 마라. 이유: 거래소 API 키가 커밋되어 유출된다.
- `docs/`, `scripts/`, `.claude/`, `phases/`, `CLAUDE.md`, `.env.example`을 덮어쓰거나 삭제하지 마라. 이유: 프로젝트 기획·실행 인프라가 사라진다.
- 인터랙티브(대화형) 명령을 쓰지 마라. 이유: execute.py 자동 실행 환경에서 입력 프롬프트가 뜨면 멈춘다.
- 지표·시그널·리스크·백테스트 코드를 만들지 마라. 이유: 각각 Step 1~4의 범위다. 이 step은 부팅 가능한 빈 골격까지만.
- 차트 라이브러리를 설치하지 마라. 이유: Step 7에서 필요한 것만 고른다.
