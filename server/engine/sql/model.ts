/**
 * 작은 SQL 모델. SQL 템플릿은 시드로 표(tables.ts)와 질의 모델을 만들고,
 *  - render.ts가 표준 SQL 문으로 바꿔 보여 주고
 *  - eval.ts(미니 평가기)가 표와 질의를 직접 계산해 정답을 구한다(외부 DB를 쓰지 않는다).
 * 표준 SQL의 공통 부분만 둔다: SELECT, FROM, INNER/LEFT JOIN … ON, WHERE, GROUP BY, HAVING,
 * 비교·AND·OR·NOT·BETWEEN·IN·LIKE(% 접두·접미)·IS NULL, COUNT·SUM·AVG·MAX·MIN.
 */

export type Value = number | string | null;

export interface Column {
  name: string;
  type: 'INTEGER' | 'TEXT';
}

export interface Table {
  name: string;
  cols: Column[];
  rows: Value[][];
}

export type CmpOp = '=' | '<>' | '<' | '<=' | '>' | '>=';
export type AggFn = 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';

export type SExpr =
  | { k: 'col'; table?: string; name: string }
  | { k: 'lit'; v: number | string }
  | { k: 'cmp'; op: CmpOp; a: SExpr; b: SExpr }
  | { k: 'and'; a: SExpr; b: SExpr }
  | { k: 'or'; a: SExpr; b: SExpr }
  | { k: 'not'; e: SExpr }
  | { k: 'between'; e: SExpr; lo: SExpr; hi: SExpr }
  | { k: 'in'; e: SExpr; list: SExpr[] }
  /** pattern은 '김%'(접두), '%수'(접미), '%기%'(포함)만 쓴다 */
  | { k: 'like'; e: SExpr; pattern: string }
  | { k: 'isnull'; e: SExpr; neg: boolean }
  /** arg가 null이면 COUNT(*) */
  | { k: 'agg'; fn: AggFn; arg: SExpr | null };

export interface Query {
  /** null이면 SELECT * */
  select: SExpr[] | null;
  from: string;
  join?: { kind: 'INNER' | 'LEFT'; table: string; on: SExpr };
  where?: SExpr;
  groupBy?: SExpr[];
  having?: SExpr;
}

/* ---------- 만들기 도우미 ---------- */

export const col = (name: string, table?: string): SExpr => ({ k: 'col', name, ...(table ? { table } : {}) });
export const lit = (v: number | string): SExpr => ({ k: 'lit', v });
export const cmp = (op: CmpOp, a: SExpr, b: SExpr): SExpr => ({ k: 'cmp', op, a, b });
export const and = (a: SExpr, b: SExpr): SExpr => ({ k: 'and', a, b });
export const or = (a: SExpr, b: SExpr): SExpr => ({ k: 'or', a, b });
export const not = (e: SExpr): SExpr => ({ k: 'not', e });
export const between = (e: SExpr, lo: number, hi: number): SExpr => ({ k: 'between', e, lo: lit(lo), hi: lit(hi) });
export const inList = (e: SExpr, list: (number | string)[]): SExpr => ({ k: 'in', e, list: list.map(lit) });
export const like = (e: SExpr, pattern: string): SExpr => ({ k: 'like', e, pattern });
export const isNull = (e: SExpr, neg = false): SExpr => ({ k: 'isnull', e, neg });
export const agg = (fn: AggFn, arg: SExpr | null = null): SExpr => ({ k: 'agg', fn, arg });

export const sclone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/* ---------- 실수 변형용 도우미 ---------- */

/** 식을 위에서부터 훑으며 fn이 돌려준 식으로 바꾼 사본(undefined면 안쪽으로 들어간다) */
export function mapSExpr(e: SExpr, fn: (x: SExpr) => SExpr | undefined): SExpr {
  const r = fn(e);
  if (r) return r;
  switch (e.k) {
    case 'cmp':
    case 'and':
    case 'or':
      return { ...e, a: mapSExpr(e.a, fn), b: mapSExpr(e.b, fn) };
    case 'not':
      return { ...e, e: mapSExpr(e.e, fn) };
    case 'between':
      return { ...e, e: mapSExpr(e.e, fn), lo: mapSExpr(e.lo, fn), hi: mapSExpr(e.hi, fn) };
    case 'in':
      return { ...e, e: mapSExpr(e.e, fn), list: e.list.map((x) => mapSExpr(x, fn)) };
    case 'like':
    case 'isnull':
      return { ...e, e: mapSExpr(e.e, fn) };
    default:
      return e;
  }
}

/** 같은 값을 포함하는지 뒤집기: >= ↔ >, <= ↔ < */
export function flipCmp(e: SExpr): SExpr {
  const flip: Partial<Record<CmpOp, CmpOp>> = { '>=': '>', '>': '>=', '<=': '<', '<': '<=' };
  return mapSExpr(e, (x) => (x.k === 'cmp' && flip[x.op] ? { ...x, op: flip[x.op]! } : undefined));
}

/** AND와 OR를 서로 바꿔 읽기 */
export function swapAndOr(e: SExpr): SExpr {
  return mapSExpr(e, (x) => (x.k === 'and' ? { k: 'or', a: swapAndOr(x.a), b: swapAndOr(x.b) } : x.k === 'or' ? { k: 'and', a: swapAndOr(x.a), b: swapAndOr(x.b) } : undefined));
}

/** AND·OR·NOT 아래의 단일 조건(잎) 목록 */
export function leaves(e: SExpr): SExpr[] {
  if (e.k === 'and' || e.k === 'or') return [...leaves(e.a), ...leaves(e.b)];
  if (e.k === 'not') return leaves(e.e);
  return [e];
}

/** i번째 잎 조건을 빼고 읽기(남는 조건이 없으면 null) */
export function dropLeaf(e: SExpr, i: number): SExpr | null {
  let n = 0;
  const go = (x: SExpr): SExpr | null => {
    if (x.k === 'and' || x.k === 'or') {
      const a = go(x.a);
      const b = go(x.b);
      return a && b ? { ...x, a, b } : (a ?? b);
    }
    if (x.k === 'not') {
      const inner = go(x.e);
      return inner ? { ...x, e: inner } : null;
    }
    return n++ === i ? null : x;
  };
  return go(e);
}

/** NOT을 빼고 읽기 */
export const dropNot = (e: SExpr): SExpr => mapSExpr(e, (x) => (x.k === 'not' ? dropNot(x.e) : undefined));
