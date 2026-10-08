/**
 * 교차 검증(개발용): 참조 평가기의 정답을 실제 언어 처리기로 확인한다.
 *   npm run check:exec                       유형마다 시드 200개
 *   npm run check:exec -- --n 50             시드 수 바꾸기
 *   npm run check:exec -- --only programming.loop,sql.where   일부 유형만
 *   npm run check:exec -- --langs c,python   일부 언어만
 *
 * build·test·서버 코드에 넣지 않는다(이 파일만 외부 프로세스를 실행한다).
 *  - 프로그래밍: 유형 × 언어 × 시드마다 렌더링한 코드를 python3 / gcc / g++ / javac+java로 실행해 출력이 정답 보기와 같은지 본다.
 *    C·C++은 -Wall -Wextra -Werror와 정의되지 않은 동작 검사기(-fsanitize=undefined)로, Java는 -Xlint:all -Werror로 컴파일한다.
 *    (switch fall-through 경고만 끈다: P3가 일부러 묻는 동작)
 *  - SQL: 표와 질의를 sqlite3로 실행해 결과(행 수 또는 값)가 정답 보기와 같은지 본다.
 *    sqlite3 명령이 없으면 python3에 들어 있는 sqlite3 모듈로 실행한다(같은 SQLite 엔진).
 *  - 실행마다 임시 폴더를 만들고 지우며, 컴파일·실행은 각각 5초 제한.
 *  - 설치되지 않은 도구는 건너뛰고 무엇을 건너뛰었는지 보고한다.
 *  - 해설도 확인한다: 프로그래밍은 추적표의 마지막 출력이 실제 출력의 마지막 줄과, SQL은 마지막 중간표(SELECT)의 행 수와 행들이
 *    실제 결과와 같은지(표를 줄이지 않은 경우 행을 순서와 관계없이 비교. ORDER BY가 없으면 행 순서는 정해지지 않는다).
 * 불일치가 있으면 유형·언어·시드·코드·두 결과를 보여 주고 exit 1.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { TEMPLATES } from '../server/registry.js';
import { Rng } from '../server/engine/rng.js';
import { makeProblem } from '../server/engine/set.js';
import { availableFor, type Problem } from '../server/engine/types.js';
import { LANGUAGE_IDS, type LanguageId } from '../shared/languages.js';
import type { TableSpec } from '../shared/charts/types.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg('--n') ?? 200);
const ONLY = arg('--only')?.split(',');
const LANGS = (arg('--langs')?.split(',') as LanguageId[] | undefined) ?? [...LANGUAGE_IDS];
const TIMEOUT_MS = 5000;
const JOBS = Math.max(1, cpus().length);

interface Exec {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function sh(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): Promise<Exec> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: opts.cwd, timeout: TIMEOUT_MS, maxBuffer: 1 << 20, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : -1) : 0, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

async function has(cmd: string, args: string[]): Promise<boolean> {
  const r = await sh(cmd, args);
  return r.code === 0;
}

/* ---------- 실행기 ---------- */

type Runner = (code: string, dir: string) => Promise<{ ok: true; out: string } | { ok: false; why: string }>;

const compileThenRun = async (compile: Promise<Exec>, runIt: () => Promise<Exec>) => {
  const c = await compile;
  if (c.code !== 0) return { ok: false as const, why: `컴파일 실패${c.timedOut ? '(시간 초과)' : ''}: ${c.stderr.trim().slice(0, 800)}` };
  const r = await runIt();
  if (r.code !== 0) return { ok: false as const, why: `실행 실패${r.timedOut ? '(5초 초과)' : ''} 코드 ${r.code}: ${r.stderr.trim().slice(0, 800)}` };
  return { ok: true as const, out: r.stdout };
};

/** switch fall-through는 P3가 일부러 묻는 동작이라 그 경고만 끈다 */
const CFLAGS = ['-O0', '-Wall', '-Wextra', '-Werror', '-Wno-implicit-fallthrough', '-fsanitize=undefined', '-fno-sanitize-recover=all'];

const RUNNERS: Record<LanguageId, { tools: [string, string[]][]; run: Runner }> = {
  python: {
    tools: [['python3', ['--version']]],
    run: async (code, dir) => {
      writeFileSync(join(dir, 'main.py'), code);
      const r = await sh('python3', ['main.py'], { cwd: dir });
      return r.code === 0 ? { ok: true, out: r.stdout } : { ok: false, why: `실행 실패${r.timedOut ? '(5초 초과)' : ''}: ${r.stderr.trim().slice(0, 800)}` };
    },
  },
  c: {
    tools: [['gcc', ['--version']]],
    run: (code, dir) => {
      writeFileSync(join(dir, 'main.c'), code);
      return compileThenRun(sh('gcc', ['-std=c11', ...CFLAGS, 'main.c', '-o', 'main'], { cwd: dir }), () => sh('./main', [], { cwd: dir }));
    },
  },
  cpp: {
    tools: [['g++', ['--version']]],
    run: (code, dir) => {
      writeFileSync(join(dir, 'main.cpp'), code);
      return compileThenRun(sh('g++', ['-std=c++17', ...CFLAGS, 'main.cpp', '-o', 'main'], { cwd: dir }), () => sh('./main', [], { cwd: dir }));
    },
  },
  java: {
    tools: [
      ['javac', ['-version']],
      ['java', ['-version']],
    ],
    run: (code, dir) => {
      writeFileSync(join(dir, 'Main.java'), code);
      return compileThenRun(sh('javac', ['-Xlint:all,-fallthrough', '-Werror', 'Main.java'], { cwd: dir }), () => sh('java', ['-cp', '.', 'Main'], { cwd: dir }));
    },
  },
};

/* ---------- SQL ---------- */

const sqlLit = (v: string | number) => (typeof v === 'number' ? String(v) : v === 'NULL' ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

/** 화면에 보이는 표(TableSpec)를 CREATE TABLE·INSERT로. 열 종류는 값에서 정한다(숫자만 있으면 INTEGER) */
function tableSql(t: TableSpec): string {
  const name = t.caption!;
  const cols = t.head.map((h, i) => {
    const vals = t.rows.map((r) => r[i]).filter((v) => v !== 'NULL');
    return `${h} ${vals.every((v) => typeof v === 'number') ? 'INTEGER' : 'TEXT'}`;
  });
  return [`CREATE TABLE ${name} (${cols.join(', ')});`, ...t.rows.map((r) => `INSERT INTO ${name} VALUES (${r.map(sqlLit).join(', ')});`)].join('\n');
}

const PY_SQLITE = `import sqlite3, sys, json
db = sqlite3.connect(':memory:')
setup, query = json.load(sys.stdin)
db.executescript(setup)
for row in db.execute(query):
    print('|'.join('NULL' if v is None else (str(int(v)) if isinstance(v, float) and v == int(v) else str(v)) for v in row))
`;

/** SQLite로 질의 실행. 결과는 한 행에 한 줄, 열은 | 로 잇는다 */
async function runSql(setup: string, query: string, cli: boolean, dir: string): Promise<{ ok: true; rows: string[] } | { ok: false; why: string }> {
  if (cli) {
    writeFileSync(join(dir, 'q.sql'), `${setup}\n${query}\n`);
    const r = await sh('sqlite3', ['-batch', '-noheader', '-nullvalue', 'NULL', ':memory:', '.read q.sql'], { cwd: dir });
    if (r.code !== 0 || r.stderr.trim()) return { ok: false, why: `sqlite3 실패: ${r.stderr.trim().slice(0, 800)}` };
    return { ok: true, rows: r.stdout.split('\n').filter((l) => l !== '').map((l) => l.replace(/\.0(?=\||$)/g, '')) };
  }
  writeFileSync(join(dir, 'run.py'), PY_SQLITE);
  const r = await sh('python3', ['run.py'], { cwd: dir, input: JSON.stringify([setup, query]) });
  if (r.code !== 0) return { ok: false, why: `python3 sqlite3 실패: ${r.stderr.trim().slice(0, 800)}` };
  return { ok: true, rows: r.stdout.split('\n').filter((l) => l !== '') };
}

/* ---------- 실행 ---------- */

interface Case {
  type: string;
  lang: LanguageId | 'sql';
  seed: number;
  difficulty: number;
  problem: Problem;
}

interface Bad {
  c: Case;
  want: string;
  got: string;
  code: string;
}

async function pool<T>(items: T[], fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: JOBS }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  // 도구 확인
  const avail: Partial<Record<LanguageId, boolean>> = {};
  const skipped: string[] = [];
  for (const l of LANGS) {
    const missing: string[] = [];
    for (const [cmd, a] of RUNNERS[l].tools) if (!(await has(cmd, a))) missing.push(cmd);
    avail[l] = missing.length === 0;
    if (missing.length) skipped.push(`${missing.join('+')} (${l} 건너뜀)`);
  }
  const sqliteCli = await has('sqlite3', ['-version']);
  const pySqlite = !sqliteCli && (await has('python3', ['-c', 'import sqlite3']));
  if (!sqliteCli) skipped.push(pySqlite ? 'sqlite3 명령 없음 → python3 내장 sqlite3 모듈로 대신 실행' : 'sqlite3 (SQL 건너뜀)');

  // 문항 만들기
  const cases: Case[] = [];
  for (const tpl of TEMPLATES) {
    if (ONLY && !ONLY.some((o) => tpl.id.startsWith(o))) continue;
    const langs: (LanguageId | 'sql')[] = tpl.area === 'sql' ? ['sql'] : LANGS.filter((l) => availableFor(tpl, l) && avail[l]);
    for (const lang of langs) {
      if (lang === 'sql' && !sqliteCli && !pySqlite) continue;
      for (let s = 1; s <= N; s++) {
        const seed = Math.imul(s, 2654435761) >>> 0;
        const difficulty = tpl.difficulties[s % tpl.difficulties.length];
        const problem = makeProblem(tpl, new Rng(seed), { lang: lang === 'sql' ? 'python' : lang, difficulty });
        cases.push({ type: tpl.id, lang, seed, difficulty, problem });
      }
    }
  }

  const bad: Bad[] = [];
  const errors: Bad[] = [];
  const stat = new Map<string, { n: number; bad: number; badDetail: number; err: number }>();
  let done = 0;
  const t0 = Date.now();
  await pool(cases, async (c) => {
    const key = `${c.type}|${c.lang}`;
    const st = stat.get(key) ?? { n: 0, bad: 0, badDetail: 0, err: 0 };
    stat.set(key, st);
    st.n++;
    const want = c.problem.choices[c.problem.answerIndex].label;
    const fig = c.problem.figure;
    if (fig?.kind !== 'code') throw new Error(`${c.type}: 코드 도표가 아님`);
    const dir = mkdtempSync(join(tmpdir(), 'crosscheck-'));
    try {
      if (c.lang === 'sql') {
        const setup = (fig.tables ?? []).map(tableSql).join('\n');
        const r = await runSql(setup, fig.code, sqliteCli, dir);
        if (!r.ok) {
          st.err++;
          errors.push({ c, want, got: r.why, code: `${setup}\n${fig.code}` });
          return;
        }
        // 정답이 "n개"면 결과 행 수, 아니면 결과 한 행의 마지막 열 값(SELECT 분류, SUM(…)처럼 그룹 열이 앞에 올 수 있다)
        const got = /개$/.test(want) ? `${r.rows.length}개` : r.rows.length === 1 ? r.rows[0].split('|').at(-1)! : `(${r.rows.length}행) ${r.rows.join(' / ')}`;
        if (got !== want) {
          st.bad++;
          bad.push({ c, want, got, code: `${setup}\n${fig.code}` });
        }
        // 해설: 마지막 중간표 = 실제 결과
        const last = c.problem.detail?.sqlStages?.at(-1);
        const shown = (last?.table.rows ?? []).map((row) => row.map(String).join('|')).sort();
        const real = [...r.rows].sort();
        if (!last || last.rowCount !== r.rows.length || (last.more === 0 && JSON.stringify(shown) !== JSON.stringify(real))) {
          st.badDetail++;
          bad.push({ c, want: `해설 마지막 중간표 ${last?.rowCount}행: ${shown.join(' / ')}`, got: `실제 ${r.rows.length}행: ${real.join(' / ')}`, code: `${setup}\n${fig.code}` });
        }
      } else {
        const r = await RUNNERS[c.lang].run(fig.code, dir);
        if (!r.ok) {
          st.err++;
          errors.push({ c, want, got: r.why, code: fig.code });
          return;
        }
        const got = r.out.replace(/\r/g, '').trimEnd();
        if (got !== want) {
          st.bad++;
          bad.push({ c, want, got, code: fig.code });
        }
        // 해설: 추적표의 마지막 출력 = 실제 출력의 마지막 줄
        const outs = (c.problem.detail?.trace?.rows ?? []).filter((x) => !('omitted' in x) && x.out !== '') as { out: string }[];
        if (outs.at(-1)?.out !== got.split('\n').at(-1)) {
          st.badDetail++;
          bad.push({ c, want: `해설 추적표 마지막 출력 ${outs.at(-1)?.out}`, got: `실제 마지막 줄 ${got.split('\n').at(-1)}`, code: fig.code });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (++done % 200 === 0) process.stderr.write(`  ${done}/${cases.length} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`);
    }
  });

  console.log(`\n교차 검증: 유형마다 시드 ${N}개, 실행 ${cases.length}건, 동시 ${JOBS}개, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  console.table(
    [...stat].map(([k, v]) => {
      const [type, lang] = k.split('|');
      return { 유형: type, 언어: lang, 시드: v.n, '정답 불일치': v.bad, '해설 불일치': v.badDetail, '실행 오류': v.err };
    }),
  );
  console.log(`건너뛴 도구: ${skipped.length ? skipped.join(', ') : '없음'}`);
  const show = (b: Bad, kind: string) =>
    console.log(`\n[${kind}] ${b.c.type} / ${b.c.lang} / 시드 ${b.c.seed} / 난이도 ${b.c.difficulty}\n--- 코드 ---\n${b.code}\n--- 참조 평가기(정답 보기) ---\n${b.want}\n--- 실제 실행 ---\n${b.got}`);
  bad.slice(0, 10).forEach((b) => show(b, '불일치'));
  errors.slice(0, 10).forEach((b) => show(b, '실행 오류'));
  if (bad.length || errors.length) {
    console.log(`\n불일치 ${bad.length}건, 실행 오류 ${errors.length}건${bad.length + errors.length > 20 ? ' (앞의 10건씩만 표시)' : ''}`);
    process.exit(1);
  }
  console.log('\n불일치 0건, 실행 오류 0건');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
