import type { Template } from './engine/types.js';
import { loop } from './templates/programming/loop.js';
import { branch } from './templates/programming/branch.js';
import { array } from './templates/programming/array.js';
import { func } from './templates/programming/func.js';
import { where } from './templates/sql/where.js';
import { aggregate } from './templates/sql/aggregate.js';
import { groupBy } from './templates/sql/groupBy.js';
import { join } from './templates/sql/join.js';

/** 유형 등록부. 유형표와 번호는 docs/engine-design.md 7절. */
export const TEMPLATES: Template[] = [
  // 프로그래밍: P1 반복, P3 조건 분기, P4 배열, P7 함수·재귀
  loop,
  branch,
  array,
  func,
  // SQL: S1 WHERE, S2 집계, S4 GROUP BY·HAVING, S5 JOIN
  where,
  aggregate,
  groupBy,
  join,
];
