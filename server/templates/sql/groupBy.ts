/**
 * S4 GROUP BY + HAVING 결과 행 수·값.
 *  난이도 1: 분류별 COUNT(*)에 HAVING COUNT(*) 조건 → 결과 행 수
 *  난이도 2: HAVING COUNT(*)를 통과하는 그룹이 하나뿐인 표 → 그 그룹의 SUM 값
 *  난이도 3: WHERE로 행을 거른 뒤 GROUP BY, HAVING SUM을 통과하는 그룹이 하나뿐인 표 → 그 그룹의 SUM 값
 * SELECT에는 GROUP BY 열과 집계만 쓴다(표준 SQL). 기준값은 실제 그룹 값과 같게 두어 >=와 >의 차이가 드러나게 한다.
 * 오답: HAVING >=↔>, HAVING 무시(그룹 수), 그룹 수 대신 행 수, WHERE 무시, HAVING을 WHERE보다 먼저 적용, SUM↔COUNT·MAX
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { agg, cmp, col, flipCmp, lit, type CmpOp, type Query, type SExpr } from '../../engine/sql/model.js';
import { runQuery } from '../../engine/sql/eval.js';
import { renderSExpr } from '../../engine/sql/render.js';
import { column, makeTable, pickSqlVariant, sqlProblem, type SqlMistake, type SqlVariant } from '../../engine/sql/tables.js';

/** 분류 값마다 행 수·합 */
function groupStats(rows: { key: string; v: number }[]) {
  const m = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const g = m.get(r.key) ?? { n: 0, sum: 0 };
    g.n++;
    g.sum += r.v;
    m.set(r.key, g);
  }
  return m;
}

function make(rng: Rng, difficulty: number): SqlVariant {
  const tt = makeTable(rng, { minRows: 8, maxRows: 12 });
  const { theme, table } = tt;
  const key = col(theme.keyCol);
  const numCol = rng.pick(theme.nums);
  const num = col(numCol.name);
  const keys = column(table, theme.keyCol) as string[];
  const vals = column(table, numCol.name) as number[];
  const all = groupStats(keys.map((k, i) => ({ key: k, v: vals[i] })));
  const rowsDesc = (q: Query) => runQuery(q, [table]).rows.map((r) => `${r[0]}(${r[1]})`).join(', ') || '없음';

  if (difficulty === 1) {
    const counts = [...all.values()].map((g) => g.n);
    const k = rng.pick(counts);
    const op = rng.pick<CmpOp>(['>=', '>']);
    const having = cmp(op, agg('COUNT'), lit(k));
    const base = { select: [key, agg('COUNT')], from: table.name, groupBy: [key] };
    const query: Query = { ...base, having };
    const passRows = [...all.values()].filter((g) => (op === '>=' ? g.n >= k : g.n > k)).reduce((a, g) => a + g.n, 0);
    const mistakes: SqlMistake[] = [
      { tag: '비교 연산자 혼동', query: { ...base, having: flipCmp(having) } },
      { tag: '그룹 조건 혼동', query: base },
      { tag: '그룹 조건 혼동', query: { ...base, having: cmp(op === '>=' ? '<' : '<=', agg('COUNT'), lit(k)) } },
      { tag: '전체 행 혼동', value: passRows },
      { tag: '전체 행 혼동', value: table.rows.length },
    ];
    const steps = () => [`${theme.keyCol}별로 묶으면 그룹(행 수)은 ${rowsDesc(base)}입니다.`, `HAVING 조건(${renderSExpr(having)})에 맞는 그룹만 남습니다: ${rowsDesc(query)}.`];
    return { tables: [table], query, ask: 'rows', mistakes, steps };
  }

  if (difficulty === 2) {
    // 행 수가 가장 많은 그룹이 하나뿐일 때, 그 그룹만 HAVING을 통과한다
    const sorted = [...all.entries()].sort((a, b) => b[1].n - a[1].n);
    const top = sorted[0];
    const k = top[1].n;
    const fn = rng.pick(['SUM', 'MAX'] as const);
    const sel = agg(fn, num);
    const having = cmp('>=', agg('COUNT'), lit(k));
    const base = { select: [key, sel], from: table.name, groupBy: [key] };
    const query: Query = { ...base, having };
    const second = sorted[1]?.[1].n;
    const mistakes: SqlMistake[] = [
      { tag: '그룹 조건 혼동', query: { select: [sel], from: table.name } },
      { tag: '집계 함수 혼동', query: { ...query, select: [key, agg('COUNT')] } },
      { tag: '집계 함수 혼동', query: { ...query, select: [key, agg(fn === 'SUM' ? 'MAX' : 'SUM', num)] } },
      { tag: '집계 함수 혼동', query: { ...query, select: [key, agg('MIN', num)] } },
      // 기준을 한 칸 낮게 읽어 다음 그룹을 고른 경우(그 그룹이 하나일 때만 값이 정해진다)
      { tag: '비교 연산자 혼동', query: second !== undefined && second < k ? { ...base, having: cmp('=', agg('COUNT'), lit(second)) } : null },
    ];
    const label = renderSExpr(sel);
    const steps = (answer: number) => [
      `${theme.keyCol}별 행 수는 ${[...all.entries()].map(([g, s]) => `${g}(${s.n})`).join(', ')}입니다.`,
      `HAVING 조건(COUNT(*) >= ${k})에 맞는 그룹은 ${top[0]} 하나이고, 그 그룹의 ${label} = ${answer}입니다.`,
    ];
    return { tables: [table], query, ask: 'value', askLabel: label, mistakes, steps };
  }

  // 난이도 3: WHERE로 거른 뒤 GROUP BY, HAVING SUM을 통과하는 그룹이 하나뿐인 표 → 그 그룹의 SUM 값
  const other = theme.nums.find((c) => c.name !== numCol.name)!;
  const otherVals = column(table, other.name) as number[];
  const whereE: SExpr = cmp(rng.pick<CmpOp>(['>=', '<=']), col(other.name), lit(rng.pick(otherVals)));
  const kept = runQuery({ select: [key, num], from: table.name, where: whereE }, [table]).rows.map((r) => ({ key: r[0] as string, v: r[1] as number }));
  const filtered = [...groupStats(kept).entries()].sort((a, b) => b[1].sum - a[1].sum);
  // 합이 가장 큰 그룹 하나만 통과하도록: >= 가장 큰 합, 또는 > 두 번째 합
  const op = rng.pick<CmpOp>(['>=', '>']);
  const v = op === '>=' ? (filtered[0]?.[1].sum ?? 0) : (filtered[1]?.[1].sum ?? 0);
  const having = cmp(op, agg('SUM', num), lit(v));
  const sel = agg('SUM', num);
  const base = { select: [key, sel], from: table.name, groupBy: [key] };
  const query: Query = { ...base, where: whereE, having };
  const top = filtered[0]?.[0];
  // HAVING을 WHERE보다 먼저(거르기 전 합으로) 적용해 고른 그룹의, 거른 뒤 합
  const unfilteredTop = [...all.entries()].sort((a, b) => b[1].sum - a[1].sum)[0]?.[0];
  const mistakes: SqlMistake[] = [
    { tag: '조건 누락', query: { ...base, having } },
    { tag: '그룹 조건 혼동', query: { select: [sel], from: table.name, where: whereE } },
    { tag: '그룹 조건 혼동', value: unfilteredTop && unfilteredTop !== top ? (filtered.find(([g]) => g === unfilteredTop)?.[1].sum ?? null) : null },
    { tag: '집계 함수 혼동', query: { ...query, select: [key, agg('COUNT')] } },
    { tag: '집계 함수 혼동', query: { ...query, select: [key, agg('MAX', num)] } },
    { tag: '비교 연산자 혼동', value: filtered[1]?.[1].sum ?? null },
  ];
  const label = renderSExpr(sel);
  const steps = (answer: number) => [
    `WHERE 조건(${renderSExpr(whereE)})으로 먼저 행을 거르면 ${kept.length}개 행이 남습니다.`,
    `남은 행을 ${theme.keyCol}별로 묶은 합: ${rowsDesc({ ...base, where: whereE })}.`,
    `HAVING 조건(${renderSExpr(having)})에 맞는 그룹은 ${top} 하나이고, ${label} = ${answer}입니다.`,
  ];
  return { tables: [table], query, ask: 'value', askLabel: label, mistakes, steps };
}

export const groupBy: Template<number> = {
  id: 'sql.groupBy',
  area: 'sql',
  subtype: 'GROUP BY와 HAVING',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    return sqlProblem(rng, pickSqlVariant(() => make(rng, ctx.difficulty)));
  },
};
