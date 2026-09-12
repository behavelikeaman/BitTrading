import { appendFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseState, type PaperState } from '@/lib/paper/state';
import { parseJsonl, type JournalEntry } from '@/lib/paper/journal';

const DEFAULT_DIR = 'data';
const STATE_FILE = 'paper-state.json';
const JOURNAL_FILE = 'paper-journal.jsonl';

function resolveDir(dir?: string): string {
  return path.resolve(process.cwd(), dir ?? DEFAULT_DIR);
}

/** 저장된 상태를 읽는다. 없거나 깨졌으면 null — 호출부가 새로 시작한다. */
export async function loadState(dir?: string): Promise<PaperState | null> {
  const file = path.join(resolveDir(dir), STATE_FILE);
  try {
    return parseState(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * 상태를 원자적으로 저장한다 (ADR-017).
 *
 * 임시 파일에 쓰고 fsync 한 뒤 rename 한다. 대상 파일에 직접 쓰면 티커가
 * 5분마다 덮어쓰는 도중 프로세스가 죽었을 때 파일이 깨지고, 열린 포지션을
 * 통째로 잃는다. rename은 원자적이라 이를 막는다.
 */
export async function saveState(state: PaperState, dir?: string): Promise<void> {
  const base = resolveDir(dir);
  await mkdir(base, { recursive: true });

  const target = path.join(base, STATE_FILE);
  const tmp = `${target}.tmp`;
  const payload = JSON.stringify(state);

  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, target);
}

/** 일지에 한 줄 덧붙인다. 전체를 다시 쓰지 않는다. */
export async function appendJournal(
  entry: JournalEntry,
  dir?: string,
): Promise<void> {
  const base = resolveDir(dir);
  await mkdir(base, { recursive: true });
  await appendFile(
    path.join(base, JOURNAL_FILE),
    `${JSON.stringify(entry)}\n`,
    'utf8',
  );
}

export async function loadJournal(dir?: string): Promise<JournalEntry[]> {
  const file = path.join(resolveDir(dir), JOURNAL_FILE);
  try {
    return parseJsonl(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

/** 상태와 일지를 지운다. 되돌릴 수 없다. */
export async function resetPaper(dir?: string): Promise<void> {
  const base = resolveDir(dir);
  for (const name of [STATE_FILE, `${STATE_FILE}.tmp`, JOURNAL_FILE]) {
    await rm(path.join(base, name), { force: true });
  }
}

/** 상태 파일 경로. CLI가 사용자에게 안내할 때 쓴다. */
export function statePath(dir?: string): string {
  return path.join(resolveDir(dir), STATE_FILE);
}
