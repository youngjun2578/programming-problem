/**
 * S5 INNER JOIN / LEFT JOIN 결과 행 수.
 * 표 두 개: employee(emp_id, name, dept_id)와 department(dept_id, dept_name).
 * employee.dept_id에는 NULL(부서 없음)과 department에 없는 값이 섞이고, 직원이 없는 부서도 하나 이상 있다.
 * department.dept_id는 겹치지 않는다. 조인 키가 NULL이면 어느 행과도 짝이 되지 않는다.
 *  난이도 1: employee INNER JOIN department
 *  난이도 2: department LEFT JOIN employee(직원이 여럿인 부서는 여러 행, 없는 부서는 한 행)
 *  난이도 3: LEFT JOIN 뒤 WHERE … IS NULL로 짝 없는 행만, 또는 INNER JOIN 뒤 WHERE 조건
 * 오답: INNER↔LEFT, 왼쪽·오른쪽 표를 바꿔 읽기, 한쪽 표의 행 수, 모든 조합(곱), NULL 키를 짝이 있다고 봄, WHERE 무시
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { cmp, col, inList, isNull, type Query, type SExpr, type Table, type Value } from '../../engine/sql/model.js';
import { runQuery } from '../../engine/sql/eval.js';
import { renderSExpr } from '../../engine/sql/render.js';
import { pickSqlVariant, sqlProblem, type SqlMistake, type SqlVariant } from '../../engine/sql/tables.js';

const NAMES = ['김민준', '이서연', '박도윤', '최하은', '정지호', '강수아', '조현우', '윤지민', '장예준', '임서윤', '한유진', '오시우'];
const DEPTS = ['개발', '영업', '인사', '재무', '기획'];

function makeTables(rng: Rng): { emp: Table; dept: Table; nNull: number; nOrphan: number } {
  const m = rng.int(3, 4);
  const ids = [10, 20, 30, 40].slice(0, m);
  const dnames = rng.sample(DEPTS, m);
  const empty = rng.pick(ids);
  const used = ids.filter((d) => d !== empty);
  const n = rng.int(5, 9);
  const nNull = rng.int(0, 2);
  const nOrphan = rng.int(0, 1);
  const deptIds: Value[] = [
    ...Array.from({ length: n - nNull - nOrphan }, () => rng.pick(used)),
    ...Array.from({ length: nNull }, () => null),
    ...Array.from({ length: nOrphan }, () => 50),
  ];
  const names = rng.sample(NAMES, n);
  const emp: Table = {
    name: 'employee',
    cols: [
      { name: 'emp_id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'dept_id', type: 'INTEGER' },
    ],
    rows: rng.shuffle(deptIds).map((d, i) => [i + 1, names[i], d]),
  };
  const dept: Table = {
    name: 'department',
    cols: [
      { name: 'dept_id', type: 'INTEGER' },
      { name: 'dept_name', type: 'TEXT' },
    ],
    rows: ids.map((d, i) => [d, dnames[i]]),
  };
  return { emp, dept, nNull, nOrphan };
}

const ON: SExpr = cmp('=', col('dept_id', 'employee'), col('dept_id', 'department'));

function make(rng: Rng, difficulty: number): SqlVariant {
  const { emp, dept, nNull } = makeTables(rng);
  const tables = [emp, dept];
  const count = (q: Query) => runQuery(q, tables).rows.length;
  const j = (from: string, kind: 'INNER' | 'LEFT', where?: SExpr): Query => ({ select: null, from, join: { kind, table: from === 'employee' ? 'department' : 'employee', on: ON }, ...(where ? { where } : {}) });
  const nE = emp.rows.length;
  const nD = dept.rows.length;
  const inner = count(j('employee', 'INNER'));
  let query: Query;
  let shape: string;
  if (difficulty === 1) {
    query = j('employee', 'INNER');
    shape = 'inner';
  } else if (difficulty === 2) {
    query = j('department', 'LEFT');
    shape = 'leftDept';
  } else {
    shape = rng.pick(['empNoDept', 'deptNoEmp', 'innerWhere']);
    if (shape === 'empNoDept') query = j('employee', 'LEFT', isNull(col('dept_id', 'department')));
    else if (shape === 'deptNoEmp') query = j('department', 'LEFT', isNull(col('emp_id', 'employee')));
    else query = j('employee', 'INNER', inList(col('dept_name', 'department'), rng.sample(dept.rows.map((r) => r[1] as string), 2)));
  }
  const from = query.from;
  const kind = query.join!.kind;
  const other = from === 'employee' ? 'department' : 'employee';
  const mistakes: SqlMistake[] = [
    { tag: '조인 종류 혼동', query: { ...query, join: { ...query.join!, kind: kind === 'INNER' ? 'LEFT' : 'INNER' } } },
    { tag: '조인 종류 혼동', query: { ...query, from: other, join: { ...query.join!, table: from } } },
    { tag: '조인 종류 혼동', value: nE * nD },
    { tag: '전체 행 혼동', value: nE },
    { tag: '전체 행 혼동', value: nD },
    // NULL 키끼리도 짝이 된다고 보거나, 짝 없는 행 가운데 NULL만 센 경우
    { tag: 'NULL 처리 혼동', value: shape === 'empNoDept' ? nNull : inner + nNull },
    { tag: '조건 누락', query: query.where ? { ...query, where: undefined } : null },
  ];
  const steps = () => {
    const matched = emp.rows.filter((r) => dept.rows.some((d) => d[0] === r[2])).map((r) => r[1]);
    const lines = [
      `ON 조건으로 짝이 맞는 직원은 ${matched.join(', ') || '없음'}(${inner}명)입니다. dept_id가 NULL이거나 department에 없는 값이면 짝이 없습니다.`,
    ];
    if (kind === 'LEFT') lines.push(`LEFT JOIN은 왼쪽 표(${from})의 행을 짝이 없어도 모두 남기고, 짝이 여럿이면 그 수만큼 행이 생깁니다.`);
    if (query.where) lines.push(`그다음 WHERE 조건(${renderSExpr(query.where)})에 맞는 행만 남깁니다.`);
    return lines;
  };
  return { tables, query, ask: 'rows', mistakes, steps };
}

export const join: Template<number> = {
  id: 'sql.join',
  area: 'sql',
  subtype: 'JOIN 결과',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    return sqlProblem(rng, pickSqlVariant(() => make(rng, ctx.difficulty)));
  },
};
