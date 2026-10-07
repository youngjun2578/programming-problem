/**
 * S1 SELECT + WHERE 결과 행 수 (AND·OR·NOT, IN, BETWEEN, LIKE).
 *  난이도 1: 조건 하나
 *  난이도 2: 조건 둘을 AND 또는 OR로
 *  난이도 3: 조건 셋(괄호로 묶은 OR, NOT이 섞임)
 * 기준값은 표에 있는 값으로 골라 >=와 >, BETWEEN 끝값의 차이가 드러나게 한다. NULL은 넣지 않는다(S7에서 다룬다).
 * 오답: AND↔OR, 조건 하나 빼기, >=↔>, BETWEEN 끝값 제외, IN 목록 하나 빼기, LIKE 접두↔포함, NOT 빼기, 괄호 무시, 전체 행 수
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { and, between, cmp, col, dropLeaf, dropNot, flipCmp, inList, leaves, like, lit, mapSExpr, not, or, swapAndOr, type CmpOp, type Query, type SExpr } from '../../engine/sql/model.js';
import { runQuery } from '../../engine/sql/eval.js';
import { renderSExpr } from '../../engine/sql/render.js';
import { column, makeTable, pickSqlVariant, sqlProblem, type SqlMistake, type SqlVariant, type ThemedTable } from '../../engine/sql/tables.js';

type AtomKind = 'cmp' | 'eq' | 'in' | 'between' | 'like';

/** 단일 조건 하나. used: 이미 쓴 열(같은 열에 조건이 겹치지 않게) */
function atom(rng: Rng, tt: ThemedTable, kind: AtomKind, used: Set<string>): SExpr | null {
  const { theme, table } = tt;
  const numCol = rng.pick(theme.nums.filter((c) => !used.has(c.name)));
  switch (kind) {
    case 'cmp': {
      if (!numCol) return null;
      used.add(numCol.name);
      const vals = column(table, numCol.name) as number[];
      return cmp(rng.pick<CmpOp>(['>=', '>', '<=', '<']), col(numCol.name), lit(rng.pick(vals)));
    }
    case 'between': {
      if (!numCol) return null;
      const vals = [...new Set(column(table, numCol.name) as number[])].sort((a, b) => a - b);
      if (vals.length < 4) return null;
      used.add(numCol.name);
      const i = rng.int(0, vals.length - 3);
      const j = rng.int(i + 2, vals.length - 1);
      return between(col(numCol.name), vals[i], vals[j]);
    }
    case 'eq': {
      if (used.has(theme.keyCol)) return null;
      used.add(theme.keyCol);
      return cmp('=', col(theme.keyCol), lit(rng.pick(column(table, theme.keyCol) as string[])));
    }
    case 'in': {
      const present = [...new Set(column(table, theme.keyCol) as string[])];
      if (used.has(theme.keyCol) || present.length < 3) return null;
      used.add(theme.keyCol);
      return inList(col(theme.keyCol), rng.sample(present, 2));
    }
    case 'like': {
      if (used.has(theme.nameCol)) return null;
      const names = column(table, theme.nameCol) as string[];
      const ok = theme.likes.filter((p) => {
        const n = names.filter((s) => (p.startsWith('%') && p.endsWith('%') ? s.includes(p.slice(1, -1)) : p.endsWith('%') ? s.startsWith(p.slice(0, -1)) : s.endsWith(p.slice(1)))).length;
        return n >= 1 && n < names.length;
      });
      if (!ok.length) return null;
      used.add(theme.nameCol);
      return like(col(theme.nameCol), rng.pick(ok));
    }
  }
}

function atoms(rng: Rng, tt: ThemedTable, n: number): SExpr[] | null {
  const used = new Set<string>();
  const out: SExpr[] = [];
  // 조건 하나짜리(난이도 1)에는 '='만 쓰지 않는다(그럴듯한 실수가 거의 없다)
  for (const kind of rng.shuffle<AtomKind>(n === 1 ? ['cmp', 'between', 'in', 'like'] : ['cmp', 'between', 'eq', 'in', 'like', 'cmp'])) {
    if (out.length >= n) break;
    const a = atom(rng, tt, kind, used);
    if (a) out.push(a);
  }
  return out.length === n ? out : null;
}

/** BETWEEN을 끝값을 빼고(> lo AND < hi) 읽기 */
const betweenExclusive = (e: SExpr) => mapSExpr(e, (x) => (x.k === 'between' ? and(cmp('>', x.e, x.lo), cmp('<', x.e, x.hi)) : undefined));
/** IN 목록의 마지막 값을 빠뜨리기 */
const inDropLast = (e: SExpr) => mapSExpr(e, (x) => (x.k === 'in' && x.list.length > 1 ? { ...x, list: x.list.slice(0, -1) } : undefined));
/** 비교 방향을 반대로 읽기: >= ↔ <=, > ↔ < */
const reverseCmp = (e: SExpr) =>
  mapSExpr(e, (x) => (x.k === 'cmp' && x.op !== '=' && x.op !== '<>' ? { ...x, op: ({ '>=': '<=', '<=': '>=', '>': '<', '<': '>' } as const)[x.op] } : undefined));
/** BETWEEN의 한쪽 끝만 보기 */
const betweenOneSide = (e: SExpr, side: 'lo' | 'hi') => mapSExpr(e, (x) => (x.k === 'between' ? cmp(side === 'lo' ? '>=' : '<=', x.e, side === 'lo' ? x.lo : x.hi) : undefined));
/** IN 목록의 첫 값만 보기 */
const inFirstOnly = (e: SExpr) => mapSExpr(e, (x) => (x.k === 'in' && x.list.length > 1 ? cmp('=', x.e, x.list[0]) : undefined));
/** LIKE의 접두와 접미를 바꿔 읽기: '김%' ↔ '%김' */
const likeSwapSide = (e: SExpr) =>
  mapSExpr(e, (x) => (x.k === 'like' && !(x.pattern.startsWith('%') && x.pattern.endsWith('%')) ? { ...x, pattern: x.pattern.endsWith('%') ? `%${x.pattern.slice(0, -1)}` : `${x.pattern.slice(1)}%` } : undefined));
/** LIKE 접두·접미 패턴을 '포함'으로 읽기 */
const likeAsContains = (e: SExpr) => mapSExpr(e, (x) => (x.k === 'like' && !(x.pattern.startsWith('%') && x.pattern.endsWith('%')) ? { ...x, pattern: `%${x.pattern.replace(/%/g, '')}%` } : undefined));

function make(rng: Rng, difficulty: number): SqlVariant {
  const tt = makeTable(rng, { minRows: 7, maxRows: 11 });
  const n = difficulty === 1 ? 1 : difficulty === 2 ? 2 : 3;
  const as = atoms(rng, tt, n);
  if (!as) return make(rng, difficulty);
  let where: SExpr;
  let shape = '';
  if (n === 1) where = as[0];
  else if (n === 2) where = rng.chance(0.5) ? and(as[0], as[1]) : or(as[0], as[1]);
  else {
    shape = rng.pick(['a(o)', 'na', 'o(a)']);
    where = shape === 'a(o)' ? and(as[0], or(as[1], as[2])) : shape === 'na' ? and(not(as[0]), and(as[1], as[2])) : or(and(as[0], as[1]), as[2]);
  }
  const q = (w: SExpr | null): Query | null => (w ? { select: null, from: tt.table.name, where: w } : null);
  const query = q(where)!;
  const mistakes: SqlMistake[] = [
    { tag: '논리 연산자 혼동', query: q(swapAndOr(where)) },
    ...leaves(where).map((_, i) => ({ tag: '조건 누락' as const, query: q(dropLeaf(where, i)) })),
    { tag: '비교 연산자 혼동', query: q(flipCmp(where)) },
    { tag: '범위 조건 혼동', query: q(betweenExclusive(where)) },
    { tag: '범위 조건 혼동', query: q(inDropLast(where)) },
    { tag: 'LIKE 패턴 혼동', query: q(likeAsContains(where)) },
    { tag: '조건 누락', query: q(dropNot(where)) },
    // 괄호를 무시하고 AND를 먼저 묶어 읽기: A AND (B OR C) → (A AND B) OR C
    { tag: '논리 연산자 혼동', query: shape === 'a(o)' && where.k === 'and' && where.b.k === 'or' ? q(or(and(where.a, where.b.a), where.b.b)) : null },
    { tag: '전체 행 혼동', value: tt.table.rows.length },
    { tag: '비교 연산자 혼동', query: n === 1 ? q(reverseCmp(where)) : null },
    { tag: '비교 연산자 혼동', query: n === 1 ? q(flipCmp(reverseCmp(where))) : null },
    // 기준값과 같은 행만 보거나, 조건을 반대로(만족하지 않는 행) 센 경우
    { tag: '비교 연산자 혼동', query: n === 1 && where.k === 'cmp' ? q({ ...where, op: '=' }) : null },
    { tag: where.k === 'like' ? 'LIKE 패턴 혼동' : where.k === 'cmp' ? '비교 연산자 혼동' : '범위 조건 혼동', query: n === 1 ? q(not(where)) : null },
    { tag: '범위 조건 혼동', query: where.k === 'in' && where.list.length > 1 ? q(cmp('=', where.e, where.list[where.list.length - 1])) : null },
    { tag: '범위 조건 혼동', query: q(betweenOneSide(where, 'lo')) },
    { tag: '범위 조건 혼동', query: q(betweenOneSide(where, 'hi')) },
    { tag: '범위 조건 혼동', query: q(inFirstOnly(where)) },
    { tag: 'LIKE 패턴 혼동', query: q(likeSwapSide(where)) },
  ];
  const nameOf = (r: unknown[]) => String(r[1]);
  const matched = (w: SExpr) => runQuery({ select: null, from: tt.table.name, where: w }, [tt.table]).rows.map(nameOf);
  const steps = () => [
    ...leaves(where).map((l) => `조건 ${renderSExpr(l)} → ${matched(l).join(', ') || '없음'}`),
    `WHERE 전체를 만족하는 행: ${matched(where).join(', ')}`,
  ];
  return { tables: [tt.table], query, ask: 'rows', mistakes, steps };
}

export const where: Template<number> = {
  id: 'sql.where',
  area: 'sql',
  subtype: 'SELECT 조건 조회',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    return sqlProblem(rng, pickSqlVariant(() => make(rng, ctx.difficulty)));
  },
};
