/**
 * SQL 문항 재료: 시드로 작은 표(행 5~12개)를 만들고, 표·질의·실수로 문항을 조립한다.
 *  - 표는 주제(직원·상품·학생)마다 같은 모양: id, 이름, 분류(그룹 열), 숫자 열 두 개, NULL이 들어갈 수 있는 숫자 열
 *  - 숫자는 1,000 미만(표에 천 단위 쉼표가 붙지 않게), 이름·id는 겹치지 않는다
 *  - 정답이 모호한 표(정답 행 0개, 나누어떨어지지 않는 AVG, 값 하나를 묻는데 결과가 한 행이 아님)는 조립 단계에서 거르고 다시 뽑는다
 */
import type { Rng } from '../rng.js';
import type { Generated, Wrong } from '../types.js';
import type { MistakeTag } from '../mistakes.js';
import type { TableSpec } from '../../../shared/charts/types.js';
import { runQuery, SqlEvalError } from './eval.js';
import { renderQuery } from './render.js';
import type { Query, Table, Value } from './model.js';

export interface Theme {
  table: string;
  /** 이름 열과 값(LIKE에 쓰므로 한글) */
  nameCol: string;
  names: string[];
  /** 분류 열(GROUP BY에 쓴다)과 값 */
  keyCol: string;
  keys: string[];
  /** 숫자 열 두 개와 범위(lo~hi, step 단위) */
  nums: { name: string; lo: number; hi: number; step: number }[];
  /** NULL이 들어갈 수 있는 숫자 열 */
  nullable: { name: string; lo: number; hi: number; step: number };
  /** LIKE 패턴 후보(이름의 접두·접미) */
  likes: string[];
}

const PEOPLE = ['김민준', '이서연', '박도윤', '최하은', '정지호', '강수아', '조현우', '윤지민', '장예준', '임서윤', '한유진', '오시우', '김하린', '이도현', '박서준', '최유나', '김지안', '이준호', '박지우', '정하준'];

export const THEMES: Theme[] = [
  {
    table: 'employee',
    nameCol: 'name',
    names: PEOPLE,
    keyCol: 'dept',
    keys: ['개발', '영업', '인사', '재무'],
    nums: [
      { name: 'salary', lo: 250, hi: 600, step: 10 },
      { name: 'age', lo: 24, hi: 58, step: 1 },
    ],
    nullable: { name: 'bonus', lo: 10, hi: 90, step: 10 },
    likes: ['김%', '이%', '박%', '%준', '%서%'],
  },
  {
    table: 'product',
    nameCol: 'name',
    names: ['청소기', '세탁기', '선풍기', '냉장고', '전자레인지', '사과즙', '감귤즙', '녹차', '홍차', '운동화', '구두', '샌들', '소설책', '만화책', '요리책', '공기청정기', '가습기', '제습기'],
    keyCol: 'category',
    keys: ['가전', '식품', '의류', '도서'],
    nums: [
      { name: 'price', lo: 100, hi: 900, step: 10 },
      { name: 'stock', lo: 1, hi: 60, step: 1 },
    ],
    nullable: { name: 'discount', lo: 5, hi: 50, step: 5 },
    likes: ['%기', '%책', '%즙', '%차', '공%'],
  },
  {
    table: 'student',
    nameCol: 'name',
    names: PEOPLE,
    keyCol: 'class',
    keys: ['1반', '2반', '3반'],
    nums: [
      { name: 'score', lo: 40, hi: 100, step: 1 },
      { name: 'absent', lo: 0, hi: 12, step: 1 },
    ],
    nullable: { name: 'retest', lo: 50, hi: 100, step: 5 },
    likes: ['김%', '이%', '박%', '%준', '%서%'],
  },
];

const pickStep = (rng: Rng, r: { lo: number; hi: number; step: number }) => r.lo + r.step * rng.int(0, Math.floor((r.hi - r.lo) / r.step));

export interface ThemedTable {
  theme: Theme;
  table: Table;
}

/** 주제 표 하나. withNullable이면 NULL이 섞인 숫자 열을 더한다(NULL은 1~3개, NULL 아닌 값도 2개 이상) */
export function makeTable(rng: Rng, o: { minRows?: number; maxRows?: number; withNullable?: boolean; theme?: Theme } = {}): ThemedTable {
  const theme = o.theme ?? rng.pick(THEMES);
  const n = rng.int(o.minRows ?? 6, o.maxRows ?? 10);
  const names = rng.sample(theme.names, n);
  const nullIdx = new Set(o.withNullable ? rng.sample(Array.from({ length: n }, (_, i) => i), rng.int(1, Math.min(3, n - 2))) : []);
  const rows: Value[][] = names.map((name, i) => [
    i + 1,
    name,
    rng.pick(theme.keys),
    ...theme.nums.map((c) => pickStep(rng, c)),
    ...(o.withNullable ? [nullIdx.has(i) ? null : pickStep(rng, theme.nullable)] : []),
  ]);
  const cols = [
    { name: 'id', type: 'INTEGER' as const },
    { name: theme.nameCol, type: 'TEXT' as const },
    { name: theme.keyCol, type: 'TEXT' as const },
    ...theme.nums.map((c) => ({ name: c.name, type: 'INTEGER' as const })),
    ...(o.withNullable ? [{ name: theme.nullable.name, type: 'INTEGER' as const }] : []),
  ];
  return { theme, table: { name: theme.table, cols, rows } };
}

/** 표 → 화면용 표(NULL은 "NULL"로 보인다) */
export function tableSpec(t: Table): TableSpec {
  return { caption: t.name, head: t.cols.map((c) => c.name), rows: t.rows.map((r) => r.map((v) => (v === null ? 'NULL' : v))) };
}

/** 열 값 목록 */
export const column = (t: Table, name: string) => t.rows.map((r) => r[t.cols.findIndex((c) => c.name === name)]);

/* ---------- 문항 조립 ---------- */

/** 'rows': 결과 행 수를 묻는다("n개"). 'value': 결과 한 행의 마지막 열 값을 묻는다 */
export type AskKind = 'rows' | 'value';

export interface SqlMistake {
  tag: MistakeTag;
  /** 실수한 질의(같은 방식으로 답을 꺼낸다) 또는 실수로 나오는 값 */
  query?: Query | null;
  value?: number | null;
}

export interface SqlVariant {
  tables: Table[];
  query: Query;
  ask: AskKind;
  /** value일 때 묻는 열 이름(문장에 쓴다. 예: "SUM(salary)") */
  askLabel?: string;
  mistakes: SqlMistake[];
  steps: (answer: number) => string[];
}

/** 질의 결과에서 답 꺼내기. 정답으로 쓸 수 없으면(행 0개, 값 하나가 아님, NULL, 정수가 아님) null */
function extract(q: Query, tables: Table[], ask: AskKind, strict: boolean): number | null {
  try {
    const r = runQuery(q, tables);
    if (ask === 'rows') return r.rows.length;
    if (r.rows.length !== 1) return null;
    const v = r.rows[0][r.rows[0].length - 1];
    if (typeof v !== 'number') return null;
    // 정답은 정수만(AVG를 자르는 DB와 실수로 내는 DB의 차이를 피한다). 오답은 소수 둘째 자리까지 허용
    if (strict ? !Number.isInteger(v) : Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) return null;
    return v;
  } catch (e) {
    if (e instanceof SqlEvalError) return null;
    throw e;
  }
}

const valid = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function sqlWrongs(v: SqlVariant, answer: number): Wrong<number>[] {
  const out: Wrong<number>[] = [];
  for (const m of v.mistakes) {
    const x = m.query !== undefined ? (m.query ? extract(m.query, v.tables, v.ask, false) : null) : m.value;
    if (valid(x) && x !== answer) out.push({ value: x, mistakeTag: m.tag });
  }
  return out;
}

/** 정답이 분명하고 서로 다른 오답이 4개 이상 나오는 변형이 나올 때까지 다시 뽑는다 */
export function pickSqlVariant(make: () => SqlVariant, tries = 60): { v: SqlVariant; answer: number } {
  let last: { v: SqlVariant; answer: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const v = make();
    const answer = extract(v.query, v.tables, v.ask, true);
    if (!valid(answer)) continue;
    last = { v, answer };
    if (new Set(sqlWrongs(v, answer).map((w) => w.value)).size >= 4) return last;
  }
  if (!last) throw new Error('SQL 변형을 만들지 못함');
  return last;
}

const PHRASES: Record<AskKind, ((label: string) => string)[]> = {
  rows: [() => '다음 표에 아래 SQL 문을 실행했을 때 결과 행은 몇 개인가?', () => '아래 SQL 문을 실행하면 조회되는 행의 수는?', () => '표에서 다음 질의를 실행한 결과는 모두 몇 행인가?'],
  value: [
    (l) => `다음 표에 아래 SQL 문을 실행했을 때 ${l}의 결과 값은?`,
    (l) => `아래 SQL 문의 실행 결과로 나오는 ${l} 값은?`,
    (l) => `표에서 다음 질의를 실행하면 얻는 ${l} 값은?`,
  ],
};

export function sqlProblem(rng: Rng, picked: { v: SqlVariant; answer: number }): Generated<number> {
  const { v, answer } = picked;
  const fmt = (x: number) => (v.ask === 'rows' ? `${x}개` : String(x));
  const step = v.ask === 'value' && answer >= 100 && answer % 10 === 0 ? 10 : 1;
  return {
    text: rng.pick(PHRASES[v.ask])(v.askLabel ?? ''),
    answer,
    wrongs: sqlWrongs(v, answer),
    steps: [...v.steps(answer), v.ask === 'rows' ? `따라서 결과는 ${answer}개 행입니다.` : `따라서 결과 값은 ${answer}입니다.`],
    format: fmt,
    figure: { kind: 'code', lang: 'SQL', code: renderQuery(v.query), tables: v.tables.map(tableSpec) },
    near: (k) => (answer + k * step > 0 ? answer + k * step : null),
  };
}
