/**
 * 보기별 이유 문구: "이 보기는 ○○하면 나오는 값입니다."
 * 실수 유형(mistakes.ts의 태그)마다 한 번만 정의하고 모든 문항이 함께 쓴다.
 * 문법이 언어마다 다른 실수(논리 연산자, 출력 위치, else if 등)는 언어 묶음별로 따로 적는다.
 *  - c: C·C++·Java(중괄호, &&·||, else if, switch)
 *  - python: Python(들여쓰기, and·or, elif, range, switch 없음)
 *  - sql: SQL 문항
 * 그 언어에 없는 문법을 쓰는 실수는 문구를 두지 않는다(예: Python의 switch). validate가 언어마다 맞는 문구인지 확인한다.
 */
import type { LanguageId } from '../../shared/languages.js';
import type { MistakeTag } from './mistakes.js';

export type ReasonContext = LanguageId | 'sql';
type Group = 'c' | 'python' | 'sql';
type ReasonDef = string | Partial<Record<Group, string>>;

/** 문장 가운데 부분: "이 보기는 {여기} 나오는 값입니다." */
const REASONS: Record<MistakeTag, ReasonDef> = {
  '계산 실수': '정답 근처의 값으로, 마지막 계산에서 조금 어긋나면',
  '구하는 대상 혼동': '출력하거나 묻는 값이 아닌 다른 값(중간값, 다른 변수, 다른 열)을 고르면',
  '조건 누락': '조건 하나를 빼고 계산하면',
  '경계값 비교 혼동': { c: '>=와 >(또는 <=와 <)처럼 기준값과 같은 값을 포함하는지를 반대로 읽으면', python: '>=와 >(또는 <=와 <)처럼 기준값과 같은 값을 포함하는지를 반대로 읽으면' },
  '논리 연산자 혼동': { c: '&&와 ||의 뜻을 서로 바꿔 읽으면', python: 'and와 or의 뜻을 서로 바꿔 읽으면', sql: 'AND와 OR의 뜻을 서로 바꿔 읽거나 괄호를 무시하면' },
  '반복 범위 오류': {
    c: '반복 조건의 끝값 포함 여부(<와 <=)나 시작값을 한 칸 다르게 읽으면',
    python: 'range가 끝값을 포함하지 않는다는 점이나 시작값을 한 칸 다르게 읽으면',
  },
  '누적 오류': { c: '+= 대신 =로 읽거나 누적 변수의 초깃값을 다르게 보면', python: '+= 대신 =로 읽거나 누적 변수의 초깃값을 다르게 보면' },
  'continue·break 혼동': { c: 'continue(이번 회차만 건너뜀)와 break(반복을 끝냄)를 바꿔 읽으면', python: 'continue(이번 회차만 건너뜀)와 break(반복을 끝냄)를 바꿔 읽으면' },
  '출력 위치 혼동': { c: '출력문이 반복의 중괄호 안에 있는지 밖에 있는지를 바꿔 읽으면', python: '출력문이 반복 안(들여쓰기)에 있는지 밖에 있는지를 바꿔 읽으면' },
  '분기 구조 혼동': { c: 'else if를 독립된 if로 읽거나, 조건 검사 순서나 else의 범위를 다르게 읽으면', python: 'elif를 독립된 if로 읽거나, 조건 검사 순서나 else의 범위를 다르게 읽으면' },
  'switch break 누락': { c: 'switch에서 break가 없으면 다음 case로 이어진다는 점(fall-through)을 반대로 읽으면' },
  '인덱스 시작 혼동': { c: '배열 인덱스를 0이 아니라 1부터(또는 한 칸 밀어서) 세면', python: '리스트 인덱스를 0이 아니라 1부터(또는 한 칸 밀어서) 세면' },
  '값 교환 오류': { c: '임시 변수 없이 두 칸을 차례로 덮어쓴다고 보면', python: '임시 변수 없이 두 칸을 차례로 덮어쓴다고 보면' },
  '재귀 기저 조건 오류': { c: '재귀가 멈추는 기저 조건의 경계나 그때 돌려주는 값을 다르게 읽으면', python: '재귀가 멈추는 기저 조건의 경계나 그때 돌려주는 값을 다르게 읽으면' },
  '함수 인자 혼동': { c: '함수에 넘기는 인자나 호출하는 함수를 다르게 읽으면', python: '함수에 넘기는 인자나 호출하는 함수를 다르게 읽으면' },
  '연산 우선순위 혼동': { c: '곱셈이 덧셈보다 먼저라는 규칙이나 함수 반환값이 들어가는 자리를 놓치면', python: '곱셈이 덧셈보다 먼저라는 규칙이나 함수 반환값이 들어가는 자리를 놓치면' },
  '비교 연산자 혼동': { sql: '>=와 >처럼 기준값을 포함하는지, 또는 비교 방향을 다르게 읽으면' },
  '전체 행 혼동': { sql: '조건으로 거르기 전(또는 한쪽 표 전체)의 행 수를 세면' },
  '범위 조건 혼동': { sql: 'BETWEEN이 끝값을 포함한다는 점이나 IN 목록의 값을 일부만 보면' },
  'LIKE 패턴 혼동': { sql: 'LIKE에서 %가 붙은 자리(시작, 끝, 포함)를 다르게 읽으면' },
  'NULL 처리 혼동': { sql: 'NULL을 값이 있는 것처럼 세거나 0으로 보면' },
  '집계 함수 혼동': { sql: '질의에 쓴 것이 아닌 다른 집계 함수(COUNT, SUM, AVG, MAX, MIN)로 계산하면' },
  '그룹 조건 혼동': { sql: 'HAVING(그룹 조건)과 WHERE(행 조건)의 순서·대상을 헷갈리거나 GROUP BY를 무시하면' },
  '조인 종류 혼동': { sql: 'INNER JOIN과 LEFT JOIN을 바꾸거나 왼쪽·오른쪽 표를 바꿔 읽으면' },
};

const groupOf = (ctx: ReasonContext): Group => (ctx === 'sql' ? 'sql' : ctx === 'python' ? 'python' : 'c');

export class ReasonError extends Error {}

/** 보기 하나의 이유 문장. 그 언어에 맞는 문구가 없으면 ReasonError(문항을 만들 때 쓰면 안 되는 실수) */
export function reasonFor(tag: MistakeTag, ctx: ReasonContext): string {
  const def = REASONS[tag];
  const core = typeof def === 'string' ? def : def[groupOf(ctx)];
  if (!core) throw new ReasonError(`실수 유형 "${tag}"에 ${ctx} 문구가 없음`);
  return `이 보기는 ${core} 나오는 값입니다.`;
}

/** 모든 이유 문구(번들 검사용: 서버 전용 문구가 브라우저 번들에 들어가지 않았는지) */
export const ALL_REASON_TEXTS: string[] = Object.values(REASONS).flatMap((d) => (typeof d === 'string' ? [d] : Object.values(d)));
