/**
 * 미니 SQL 평가기: 표(Table)와 질의 모델(Query)을 직접 계산한다. 외부 DB·라이브러리를 쓰지 않는다.
 *
 * 표준 SQL 의미를 따른다.
 *  - NULL과의 비교는 UNKNOWN(3값 논리). WHERE·HAVING·ON은 TRUE인 행만 남긴다.
 *  - NOT UNKNOWN = UNKNOWN, FALSE AND UNKNOWN = FALSE, TRUE OR UNKNOWN = TRUE
 *  - x IN (…): 같은 값이 있으면 TRUE, x가 NULL이거나 목록에 NULL이 있고 같은 값이 없으면 UNKNOWN
 *  - COUNT(*)는 행 수, COUNT(열)·SUM·AVG·MAX·MIN은 NULL을 뺀 값으로 계산(값이 없으면 COUNT는 0, 나머지는 NULL)
 *  - GROUP BY는 NULL끼리 한 그룹. GROUP BY 없이 집계만 있으면 전체가 한 그룹(행이 없어도 결과 한 행)
 *  - LEFT JOIN은 짝이 없는 왼쪽 행을 오른쪽 열 NULL로 남긴다. 조인 키가 NULL이면 어느 행과도 짝이 되지 않는다.
 * 문자열은 같음(=, <>, IN)과 LIKE만 비교한다(크기 비교는 DB마다 정렬 규칙이 달라 쓰지 않는다).
 */
import type { Query, SExpr, Table, Value } from './model.js';
import { renderSExpr } from './render.js';

export class SqlEvalError extends Error {}

type Row = Record<string, Value>;
type Tri = true | false | null;

export interface SqlResult {
  rows: Value[][];
}

function rowsOf(t: Table): Row[] {
  return t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [`${t.name}.${c.name}`, r[i]])));
}

function lookup(row: Row, e: Extract<SExpr, { k: 'col' }>): Value {
  if (e.table) {
    const key = `${e.table}.${e.name}`;
    if (!(key in row)) throw new SqlEvalError(`없는 열 ${key}`);
    return row[key];
  }
  const keys = Object.keys(row).filter((k) => k.endsWith(`.${e.name}`));
  if (keys.length !== 1) throw new SqlEvalError(keys.length ? `열 이름이 모호함 ${e.name}` : `없는 열 ${e.name}`);
  return row[keys[0]];
}

/** 패턴: '김%'(접두), '%수'(접미), '%기%'(포함), 그 밖에는 같은 문자열 */
function likeMatch(s: string, p: string): boolean {
  if (p.startsWith('%') && p.endsWith('%') && p.length > 1) return s.includes(p.slice(1, -1));
  if (p.endsWith('%')) return s.startsWith(p.slice(0, -1));
  if (p.startsWith('%')) return s.endsWith(p.slice(1));
  return s === p;
}

/** 그룹 하나(행 목록)를 받아 값을 계산한다. 집계가 아닌 열은 그룹의 첫 행 값(GROUP BY 열만 쓴다) */
function value(e: SExpr, rows: Row[], groupMode: boolean): Value {
  switch (e.k) {
    case 'lit':
      return e.v;
    case 'col':
      if (!rows.length) return null;
      return lookup(rows[0], e);
    case 'agg': {
      if (!groupMode) throw new SqlEvalError('집계 함수는 그룹에서만');
      if (e.arg === null) {
        if (e.fn !== 'COUNT') throw new SqlEvalError('*는 COUNT에만');
        return rows.length;
      }
      const vals = rows.map((r) => value(e.arg!, [r], false)).filter((v): v is number | string => v !== null);
      if (e.fn === 'COUNT') return vals.length;
      if (!vals.length) return null;
      if (vals.some((v) => typeof v !== 'number')) throw new SqlEvalError(`${e.fn}는 숫자 열에만`);
      const nums = vals as number[];
      if (e.fn === 'SUM') return nums.reduce((a, b) => a + b, 0);
      if (e.fn === 'AVG') return nums.reduce((a, b) => a + b, 0) / nums.length;
      return e.fn === 'MAX' ? Math.max(...nums) : Math.min(...nums);
    }
    default: {
      const t = truth(e, rows, groupMode);
      return t === null ? null : t ? 1 : 0;
    }
  }
}

function compare(op: string, a: Value, b: Value): Tri {
  if (a === null || b === null) return null;
  if (typeof a !== typeof b) throw new SqlEvalError('서로 다른 종류의 값 비교');
  if (typeof a === 'string' && op !== '=' && op !== '<>') throw new SqlEvalError('문자열 크기 비교는 쓰지 않음');
  switch (op) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
  throw new SqlEvalError(`모르는 비교 ${op}`);
}

function truth(e: SExpr, rows: Row[], groupMode: boolean): Tri {
  const v = (x: SExpr) => value(x, rows, groupMode);
  switch (e.k) {
    case 'cmp':
      return compare(e.op, v(e.a), v(e.b));
    case 'and': {
      const a = truth(e.a, rows, groupMode);
      const b = truth(e.b, rows, groupMode);
      if (a === false || b === false) return false;
      return a === null || b === null ? null : true;
    }
    case 'or': {
      const a = truth(e.a, rows, groupMode);
      const b = truth(e.b, rows, groupMode);
      if (a === true || b === true) return true;
      return a === null || b === null ? null : false;
    }
    case 'not': {
      const a = truth(e.e, rows, groupMode);
      return a === null ? null : !a;
    }
    case 'between': {
      const lo = compare('>=', v(e.e), v(e.lo));
      const hi = compare('<=', v(e.e), v(e.hi));
      if (lo === false || hi === false) return false;
      return lo === null || hi === null ? null : true;
    }
    case 'in': {
      const x = v(e.e);
      if (x === null) return null;
      const list = e.list.map(v);
      if (list.some((y) => y !== null && compare('=', x, y))) return true;
      return list.some((y) => y === null) ? null : false;
    }
    case 'like': {
      const x = v(e.e);
      if (x === null) return null;
      if (typeof x !== 'string') throw new SqlEvalError('LIKE는 문자열에만');
      return likeMatch(x, e.pattern);
    }
    case 'isnull': {
      const isN = v(e.e) === null;
      return e.neg ? !isN : isN;
    }
    default: {
      throw new SqlEvalError(`조건식이 아님: ${e.k}`);
    }
  }
}

const hasAgg = (e: SExpr): boolean => {
  switch (e.k) {
    case 'agg':
      return true;
    case 'cmp':
    case 'and':
    case 'or':
      return hasAgg(e.a) || hasAgg(e.b);
    case 'not':
      return hasAgg(e.e);
    case 'between':
      return hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi);
    case 'in':
      return hasAgg(e.e) || e.list.some(hasAgg);
    case 'like':
    case 'isnull':
      return hasAgg(e.e);
    default:
      return false;
  }
};

/** 처리 단계 하나의 중간 결과(해설용) */
export interface SqlStage {
  /** 예: "FROM employee", "WHERE salary >= 300", "GROUP BY dept", "SELECT dept, SUM(salary)" */
  title: string;
  head: string[];
  rows: Value[][];
  /** 이 단계 뒤의 행 수(GROUP BY·HAVING은 그룹 수) */
  count: number;
  /** NULL 때문에 행이 빠지거나 집계가 달라졌을 때 한 문장 */
  note?: string;
}

export interface RunQueryOptions {
  /** 처리 순서(FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT)마다 중간 결과를 남긴다. 남겨도 결과는 같다. */
  stages?: boolean;
}

/** 열 머리: 표 이름 없이 열 이름만, 같은 이름이 둘 이상이면 "표.열" */
function heads(keys: string[]): string[] {
  const short = keys.map((k) => k.slice(k.indexOf('.') + 1));
  return keys.map((k, i) => (short.filter((x) => x === short[i]).length > 1 ? k : short[i]));
}

/** 식 안의 집계 함수들(중복 없이, 나온 순서대로) */
function aggsIn(e: SExpr, out: SExpr[] = []): SExpr[] {
  if (e.k === 'agg') {
    if (!out.some((x) => JSON.stringify(x) === JSON.stringify(e))) out.push(e);
    return out;
  }
  if (e.k === 'cmp' || e.k === 'and' || e.k === 'or') {
    aggsIn(e.a, out);
    aggsIn(e.b, out);
  } else if (e.k === 'not') aggsIn(e.e, out);
  return out;
}

export function runQuery(q: Query, tables: Table[], opts: RunQueryOptions = {}): SqlResult & { stages?: SqlStage[] } {
  const stages: SqlStage[] | undefined = opts.stages ? [] : undefined;
  const byName = new Map(tables.map((t) => [t.name, t]));
  const from = byName.get(q.from);
  if (!from) throw new SqlEvalError(`없는 표 ${q.from}`);
  let rows = rowsOf(from);
  const rowStage = (title: string, rs: Row[], note?: string) => {
    if (!stages) return;
    const keys = rs.length ? Object.keys(rs[0]) : [];
    stages.push({ title, head: heads(keys), rows: rs.map((r) => keys.map((k) => r[k])), count: rs.length, ...(note ? { note } : {}) });
  };
  rowStage(`FROM ${q.from}`, rows);

  if (q.join) {
    const right = byName.get(q.join.table);
    if (!right) throw new SqlEvalError(`없는 표 ${q.join.table}`);
    const rrows = rowsOf(right);
    const nullRight = Object.fromEntries(right.cols.map((c) => [`${right.name}.${c.name}`, null as Value]));
    const joined: Row[] = [];
    let nullKey = 0;
    for (const l of rows) {
      const results = rrows.map((r) => truth(q.join!.on, [{ ...l, ...r }], false));
      const matches = rrows.filter((_, i) => results[i] === true);
      if (results.length && results.every((t) => t === null)) nullKey++;
      if (matches.length) matches.forEach((r) => joined.push({ ...l, ...r }));
      else if (q.join.kind === 'LEFT') joined.push({ ...l, ...nullRight });
    }
    rows = joined;
    const note = nullKey
      ? `조인 키가 NULL인 ${nullKey}개 행은 어떤 행과도 짝이 되지 않습니다(NULL = 값은 UNKNOWN)${q.join.kind === 'LEFT' ? '. LEFT JOIN이라 그 행은 오른쪽 열을 NULL로 채워 남깁니다.' : '. INNER JOIN에서는 빠집니다.'}`
      : undefined;
    rowStage(`${q.join.kind} JOIN ${q.join.table} ON ${renderSExpr(q.join.on)}`, rows, note);
  }

  if (q.where) {
    if (hasAgg(q.where)) throw new SqlEvalError('WHERE에는 집계 함수를 쓰지 않음');
    const results = rows.map((r) => truth(q.where!, [r], false));
    const unknown = results.filter((t) => t === null).length;
    rows = rows.filter((_, i) => results[i] === true);
    rowStage(`WHERE ${renderSExpr(q.where)}`, rows, unknown ? `NULL이 있는 ${unknown}개 행은 조건 결과가 UNKNOWN(참도 거짓도 아님)이라 WHERE에서 빠집니다.` : undefined);
  }

  const grouped = !!q.groupBy?.length || !!q.having || (q.select ?? []).some(hasAgg);
  if (!grouped) {
    const out = q.select ? rows.map((r) => q.select!.map((e) => value(e, [r], false))) : rows.map((r) => Object.values(r));
    if (stages) {
      if (q.select) stages.push({ title: `SELECT ${q.select.map(renderSExpr).join(', ')}`, head: q.select.map(renderSExpr), rows: out, count: out.length });
      else rowStage('SELECT *', rows);
    }
    return stages ? { rows: out, stages } : { rows: out };
  }
  if (!q.select) throw new SqlEvalError('그룹 질의에는 SELECT *를 쓰지 않음');
  // 표준 SQL: 집계가 아닌 SELECT 열은 GROUP BY에 있어야 한다
  const keyCols = new Set((q.groupBy ?? []).map((g) => JSON.stringify(g)));
  for (const e of q.select) if (!hasAgg(e) && e.k !== 'lit' && !keyCols.has(JSON.stringify(e))) throw new SqlEvalError('GROUP BY에 없는 열을 SELECT함');

  // 그룹 나누기(NULL끼리 한 그룹). GROUP BY가 없으면 전체가 한 그룹
  const groups = new Map<string, Row[]>();
  if (q.groupBy?.length) {
    for (const r of rows) {
      const key = JSON.stringify(q.groupBy.map((g) => value(g, [r], false)));
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  } else groups.set('*', rows);

  // 그룹 단계 표: 그룹 열 + 행 수 + SELECT·HAVING에 나오는 집계 값
  const shownAggs = [...(q.having ? aggsIn(q.having) : []), ...q.select.flatMap((e) => aggsIn(e))].filter((x, i, a) => a.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i && !(x.k === 'agg' && x.fn === 'COUNT' && x.arg === null));
  const groupHead = [...(q.groupBy ?? []).map(renderSExpr), '행 수', ...shownAggs.map(renderSExpr)];
  const groupRow = (g: Row[]) => [...(q.groupBy ?? []).map((k) => value(k, g, false)), g.length, ...shownAggs.map((a) => value(a, g, true))];
  if (stages && q.groupBy?.length) {
    const gs = [...groups.values()];
    stages.push({ title: `GROUP BY ${q.groupBy.map(renderSExpr).join(', ')}`, head: groupHead, rows: gs.map(groupRow), count: gs.length });
  }

  const kept: Row[][] = [];
  for (const g of groups.values()) if (!q.having || truth(q.having, g, true) === true) kept.push(g);
  if (stages && q.having) stages.push({ title: `HAVING ${renderSExpr(q.having)}`, head: groupHead, rows: kept.map(groupRow), count: kept.length });

  const out: Value[][] = kept.map((g) => q.select!.map((e) => value(e, g, true)));
  if (stages) {
    // 집계가 NULL을 빼고 계산한 경우 한 문장으로 짚는다
    const nullNotes = q.select
      .flatMap((e) => aggsIn(e))
      .filter((a): a is Extract<SExpr, { k: 'agg' }> => a.k === 'agg' && a.arg !== null)
      .map((a) => {
        const n = kept.flat().filter((r) => value(a.arg!, [r], false) === null).length;
        return n ? `${renderSExpr(a)}는 NULL인 ${n}개 값을 빼고 계산합니다(COUNT(*)만 NULL이 있는 행도 셉니다).` : '';
      })
      .filter(Boolean);
    stages.push({ title: `SELECT ${q.select.map(renderSExpr).join(', ')}`, head: q.select.map(renderSExpr), rows: out, count: out.length, ...(nullNotes.length ? { note: nullNotes.join(' ') } : {}) });
  }
  return stages ? { rows: out, stages } : { rows: out };
}
