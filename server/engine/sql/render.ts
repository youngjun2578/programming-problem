/**
 * SQL 모델 → 표준 SQL 문. 절마다 한 줄로 쓰고, WHERE·HAVING의 맨 위 AND는 줄을 나눠 들여 쓴다.
 * 문자열은 작은따옴표, NULL 비교는 IS NULL / IS NOT NULL. 방언 문법(LIMIT, TOP 등)은 만들지 않는다.
 */
import type { Query, SExpr } from './model.js';

/** 우선순위: NOT > AND > OR (값 식은 그보다 높다) */
const prec = (e: SExpr) => (e.k === 'or' ? 1 : e.k === 'and' ? 2 : e.k === 'not' ? 3 : 4);

export function renderSExpr(e: SExpr): string {
  const sub = (x: SExpr, min: number) => (prec(x) < min ? `(${renderSExpr(x)})` : renderSExpr(x));
  switch (e.k) {
    case 'col':
      return e.table ? `${e.table}.${e.name}` : e.name;
    case 'lit':
      return typeof e.v === 'number' ? String(e.v) : `'${e.v.replace(/'/g, "''")}'`;
    case 'cmp':
      return `${renderSExpr(e.a)} ${e.op} ${renderSExpr(e.b)}`;
    case 'and':
      return `${sub(e.a, 2)} AND ${sub(e.b, 2)}`;
    case 'or':
      return `${sub(e.a, 1)} OR ${sub(e.b, 1)}`;
    case 'not':
      return `NOT (${renderSExpr(e.e)})`;
    case 'between':
      return `${renderSExpr(e.e)} BETWEEN ${renderSExpr(e.lo)} AND ${renderSExpr(e.hi)}`;
    case 'in':
      return `${renderSExpr(e.e)} IN (${e.list.map(renderSExpr).join(', ')})`;
    case 'like':
      return `${renderSExpr(e.e)} LIKE '${e.pattern}'`;
    case 'isnull':
      return `${renderSExpr(e.e)} IS ${e.neg ? 'NOT ' : ''}NULL`;
    case 'agg':
      return `${e.fn}(${e.arg ? renderSExpr(e.arg) : '*'})`;
  }
}

/** 맨 위 AND 사슬을 줄 단위로 */
function conditionLines(head: string, e: SExpr): string[] {
  const parts: SExpr[] = [];
  const flat = (x: SExpr): void => {
    if (x.k === 'and') {
      flat(x.a);
      flat(x.b);
    } else parts.push(x);
  };
  flat(e);
  // AND로 이어진 조건이 둘 이상일 때만 OR 조건을 괄호로 묶는다
  return parts.map((p, i) => `${i === 0 ? head : '  AND'} ${p.k === 'or' && parts.length > 1 ? `(${renderSExpr(p)})` : renderSExpr(p)}`);
}

export function renderQuery(q: Query): string {
  const lines = [`SELECT ${q.select ? q.select.map(renderSExpr).join(', ') : '*'}`, `FROM ${q.from}`];
  // ON 조건은 다음 줄에 들여 쓴다(좁은 화면에서 한 줄이 너무 길어지지 않게)
  if (q.join) lines.push(`${q.join.kind} JOIN ${q.join.table}`, `  ON ${renderSExpr(q.join.on)}`);
  if (q.where) lines.push(...conditionLines('WHERE', q.where));
  if (q.groupBy?.length) lines.push(`GROUP BY ${q.groupBy.map(renderSExpr).join(', ')}`);
  if (q.having) lines.push(...conditionLines('HAVING', q.having));
  lines[lines.length - 1] += ';';
  return lines.join('\n');
}
