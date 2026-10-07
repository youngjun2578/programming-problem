/**
 * S2 집계 함수 결과 값 (COUNT·SUM·AVG·MAX·MIN).
 *  난이도 1: COUNT(*)·SUM·MAX·MIN에 WHERE 조건 하나
 *  난이도 2: NULL이 섞인 열의 COUNT(열), 또는 AVG(나누어떨어지는 표만)
 *  난이도 3: NULL이 섞인 열의 AVG·SUM에 WHERE 조건(NULL 무시 + 조건)
 * 오답: WHERE 무시, COUNT(*)↔COUNT(열), NULL을 0으로 보고 AVG 계산, MAX↔MIN, SUM↔AVG, >=↔>
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { agg, cmp, col, flipCmp, inList, lit, type AggFn, type CmpOp, type Query, type SExpr } from '../../engine/sql/model.js';
import { renderSExpr } from '../../engine/sql/render.js';
import { runQuery } from '../../engine/sql/eval.js';
import { column, makeTable, pickSqlVariant, sqlProblem, type SqlMistake, type SqlVariant } from '../../engine/sql/tables.js';

function make(rng: Rng, difficulty: number): SqlVariant {
  const withNullable = difficulty >= 2;
  const tt = makeTable(rng, { minRows: 6, maxRows: 10, withNullable });
  const { theme, table } = tt;
  const numCol = rng.pick(theme.nums);
  const nul = theme.nullable.name;

  // WHERE 조건 하나: 숫자 비교(표에 있는 값 기준) 또는 분류 IN
  const keys = [...new Set(column(table, theme.keyCol) as string[])];
  const otherNum = theme.nums.find((c) => c.name !== numCol.name)!;
  const whereE: SExpr =
    rng.chance(0.5) || keys.length < 3
      ? cmp(rng.pick<CmpOp>(['>=', '>', '<=', '<']), col(otherNum.name), lit(rng.pick(column(table, otherNum.name) as number[])))
      : inList(col(theme.keyCol), rng.sample(keys, 2));

  let fn: AggFn;
  let arg: SExpr | null;
  if (difficulty === 1) {
    fn = rng.pick<AggFn>(['COUNT', 'SUM', 'MAX', 'MIN']);
    arg = fn === 'COUNT' ? null : col(numCol.name);
  } else if (difficulty === 2) {
    fn = rng.pick<AggFn>(['COUNT', 'AVG']);
    arg = fn === 'COUNT' ? col(nul) : col(numCol.name);
  } else {
    fn = rng.pick<AggFn>(['AVG', 'SUM']);
    arg = col(nul);
  }
  const useWhere = difficulty !== 2 || rng.chance(0.5);
  const sel = agg(fn, arg);
  /** w: 생략하면 이 문항의 WHERE, null이면 WHERE 없이 */
  const q = (s: SExpr, w: SExpr | null = useWhere ? whereE : null): Query => ({ select: [s], from: table.name, ...(w ? { where: w } : {}) });
  const query = q(sel);

  // NULL을 0으로 보고 평균: SUM(열) / COUNT(*)
  const nullAsZeroAvg = (() => {
    if (fn !== 'AVG' || !arg) return null;
    const r = runQuery(q(agg('SUM', arg)), [table]).rows[0][0];
    const c = runQuery(q(agg('COUNT')), [table]).rows[0][0];
    return typeof r === 'number' && typeof c === 'number' && c > 0 ? r / c : null;
  })();
  const swapFn: Partial<Record<AggFn, AggFn>> = { MAX: 'MIN', MIN: 'MAX', SUM: 'AVG', AVG: 'SUM', COUNT: 'SUM' };
  const mistakes: SqlMistake[] = [
    { tag: '조건 누락', query: useWhere ? q(sel, null) : null },
    { tag: '비교 연산자 혼동', query: useWhere && whereE.k === 'cmp' ? q(sel, flipCmp(whereE)) : null },
    // IN 목록의 값 하나만 보고 계산
    { tag: '범위 조건 혼동', query: useWhere && whereE.k === 'in' ? q(sel, { ...whereE, list: whereE.list.slice(0, 1) }) : null },
    { tag: '집계 함수 혼동', query: q(agg(swapFn[fn]!, arg ?? col(numCol.name))) },
    { tag: '집계 함수 혼동', query: fn !== 'COUNT' ? q(agg('COUNT', arg)) : q(agg('MAX', col(numCol.name))) },
    // COUNT(열)을 COUNT(*)처럼 NULL까지 센다고 봄
    { tag: 'NULL 처리 혼동', query: fn === 'COUNT' && arg ? q(agg('COUNT')) : null },
    { tag: 'NULL 처리 혼동', value: nullAsZeroAvg },
    { tag: '집계 함수 혼동', query: fn === 'AVG' || fn === 'COUNT' ? null : q(agg('AVG', arg)) },
  ];

  const label = renderSExpr(sel);
  const steps = (answer: number) => {
    const rows = runQuery({ select: arg ? [arg] : [col('id')], from: table.name, ...(useWhere ? { where: whereE } : {}) }, [table]).rows.map((r) => (r[0] === null ? 'NULL' : String(r[0])));
    return [
      useWhere ? `WHERE 조건(${renderSExpr(whereE)})에 맞는 행만 남깁니다(${rows.length}개).` : `WHERE가 없으므로 모든 행(${rows.length}개)을 씁니다.`,
      arg
        ? `${arg.k === 'col' ? arg.name : ''} 값: ${rows.join(', ')}. ${fn === 'COUNT' ? 'COUNT(열)은 NULL을 세지 않습니다.' : `${fn} 함수는 NULL을 빼고 계산합니다.`}`
        : `COUNT(*)는 NULL과 관계없이 남은 행 수를 셉니다.`,
      `${label} = ${answer}`,
    ];
  };
  return { tables: [table], query, ask: 'value', askLabel: label, mistakes, steps };
}

export const aggregate: Template<number> = {
  id: 'sql.aggregate',
  area: 'sql',
  subtype: '집계 함수',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    return sqlProblem(rng, pickSqlVariant(() => make(rng, ctx.difficulty)));
  },
};
