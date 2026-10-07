/**
 * 임시 샘플: 단순 SELECT 결과 행 수 맞히기. 화면·서버·채점이 끊기지 않게 하려고 둔 문항이며 실제 문제 템플릿으로 바꿀 예정이다.
 * employee 표와 "부서 = D AND 연봉 >= T" 조건의 SELECT 문을 보여 주고 조회되는 행 수를 묻는다.
 *
 * 표는 정답 x, 부서 조건만 맞는 행 y, 연봉 조건만 맞는 행 z, 둘 다 아닌 행 w로 만든다(y ≠ z, 모두 1 이상).
 * 그래서 오답 x-1(> 혼동) < x < x+y, x+z(조건 하나만) < x+y+z(OR) < 전체가 서로 겹치지 않는다.
 */
import type { Template, Wrong } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';

const DEPTS = ['개발', '영업', '인사', '재무'];
const NAMES = ['김민준', '이서연', '박도윤', '최하은', '정지호', '강수아', '조현우', '윤지민', '장예준', '임서윤', '한유진', '오시우', '서다은', '신준서'];
const STEP = 500;

export const selectCount: Template<number> = {
  id: 'sql.selectCount',
  area: 'sql',
  subtype: 'SELECT 조건 조회',
  difficulties: [1],
  generate(rng: Rng) {
    const dept = rng.pick(DEPTS);
    const others = DEPTS.filter((d) => d !== dept);
    const t = rng.pick([4000, 4500, 5000]);
    const x = rng.int(2, 3);
    const y = rng.int(1, 2);
    const z = rng.pick([1, 2, 3].filter((n) => n !== y));
    const w = rng.int(1, 3);

    const rows: { dept: string; salary: number }[] = [
      // 정답 행: 하나는 기준값과 같게 두어 >=와 >의 차이가 드러나게 한다
      { dept, salary: t },
      ...Array.from({ length: x - 1 }, () => ({ dept, salary: t + STEP * rng.int(1, 4) })),
      ...Array.from({ length: y }, () => ({ dept, salary: t - STEP * rng.int(1, 3) })),
      ...Array.from({ length: z }, () => ({ dept: rng.pick(others), salary: t + STEP * rng.int(0, 4) })),
      ...Array.from({ length: w }, () => ({ dept: rng.pick(others), salary: t - STEP * rng.int(1, 3) })),
    ];
    const names = rng.sample(NAMES, rows.length);
    const table = rng.shuffle(rows.map((r, i) => ({ name: names[i], ...r })));
    const hit = table.filter((r) => r.dept === dept && r.salary >= t);
    const answer = hit.length;

    const wrongs: Wrong<number>[] = [
      { value: answer - 1, mistakeTag: '비교 연산자 혼동' },
      { value: answer + y, mistakeTag: '조건 누락' },
      { value: answer + z, mistakeTag: '조건 누락' },
      { value: answer + y + z, mistakeTag: '논리 연산자 혼동' },
      { value: table.length, mistakeTag: '전체 행 혼동' },
    ];
    const text = rng.pick([
      'employee 표에 다음 SQL 문을 실행했을 때 조회되는 행은 몇 개인가?',
      '다음 SQL 문의 실행 결과로 나오는 행의 수는?',
      'employee 표에서 아래 질의를 실행하면 결과 행은 모두 몇 개인가?',
    ]);
    const query = ['SELECT *', 'FROM employee', `WHERE dept = '${dept}'`, `  AND salary >= ${t};`].join('\n');
    return {
      text,
      answer,
      wrongs,
      steps: [
        `dept = '${dept}'인 행은 ${x + y}개입니다.`,
        `그 가운데 salary가 ${t} 이상(같은 값 포함)인 행: ${hit.map((r) => r.name).join(', ')}.`,
        `AND는 두 조건을 모두 만족하는 행만 고르므로 조회되는 행은 ${answer}개입니다.`,
      ],
      format: (v) => `${v}개`,
      figure: {
        kind: 'code',
        lang: 'SQL',
        code: query,
        table: { caption: 'employee', head: ['name', 'dept', 'salary'], rows: table.map((r) => [r.name, r.dept, r.salary]) },
      },
      near: (k) => (answer + k > 0 ? answer + k : null),
    };
  },
};
