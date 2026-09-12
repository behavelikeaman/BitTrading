import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // .next* 는 전부 빌드 산출물이다. 검증 빌드(.next-verify)도 포함된다.
    ignores: ['.next*/**', 'node_modules/**', 'data/**', 'scripts/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
