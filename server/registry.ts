import type { Template } from './engine/types.js';
import { loopOutput } from './templates/programming/loopOutput.js';
import { selectCount } from './templates/sql/selectCount.js';

/** 임시 샘플: 영역마다 템플릿 하나씩. 실제 문제 템플릿을 만들면 여기에 등록한다. */
export const TEMPLATES: Template[] = [
  // 프로그래밍
  loopOutput,
  // SQL
  selectCount,
];
