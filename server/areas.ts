import type { AreaId } from './engine/types.js';

export interface AreaMeta {
  id: AreaId;
  name: string;
  /** 이 영역이 무엇을 보는지 */
  description: string;
  /** 유형 학습 순서 (기초 → 응용) */
  studyOrder: string[];
  /** 한 문항당 권장 풀이 시간(초). 넘으면 "시간 관리" 안내 */
  targetSec: number;
}

/** 프로그래밍 영역의 언어. 사용자가 진단을 시작할 때 하나를 고르고, 프로그래밍 문항은 그 언어로만 낸다. */
export { LANGUAGES, type LanguageId } from '../shared/languages.js';

/*
 * 영역 구성만 정해 둔 뼈대다. 지금 유형은 임시 샘플 하나씩뿐이므로(server/registry.ts),
 * 유형을 추가할 때 studyOrder에도 같은 이름을 넣는다(scripts/validate.ts가 확인한다).
 */
export const AREAS: AreaMeta[] = [
  {
    id: 'programming',
    name: '프로그래밍',
    description: 'C·C++·Python·Java 코드를 읽고 실행 결과를 정확히 예측하는지 봅니다. 반복 범위와 조건이 어디서 끝나는지가 핵심이에요.',
    studyOrder: ['반복문 출력·누적', '조건 분기', '배열 순회', '함수와 재귀'],
    targetSec: 90,
  },
  {
    id: 'sql',
    name: 'SQL',
    description: '표와 SQL 문을 함께 읽고 조회 결과를 정확히 예측하는지 봅니다. WHERE 조건의 비교 연산자와 AND·OR가 핵심이에요.',
    studyOrder: ['SELECT 조건 조회', '집계 함수', 'GROUP BY와 HAVING', 'JOIN 결과'],
    targetSec: 90,
  },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a])) as Record<AreaId, AreaMeta>;
