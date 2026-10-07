import type { Rng } from './rng.js';
import type { MistakeTag } from './mistakes.js';
import type { ChartSpec, Figure } from '../../shared/charts/types.js';
import type { LanguageId } from '../../shared/languages.js';

export type AreaId = 'programming' | 'sql';
export type Difficulty = 1 | 2 | 3;

export interface Wrong<V> {
  value: V;
  mistakeTag: MistakeTag;
}

/** 템플릿 하나가 한 번 생성하는 문제의 원재료 */
export interface Generated<V = number> {
  text: string;
  answer: V;
  /** 흔한 실수에서 나온 오답. 유효하지 않거나 중복이면 엔진이 거른다. */
  wrongs: Wrong<V>[];
  steps: string[];
  /** 보기 표시 문자열. 중복 판정 기준이기도 하다. */
  format: (v: V) => string;
  /** 문제와 함께 보여줄 표·그래프 */
  figure?: Figure;
  /** 보기를 그래프로 보여줄 때 */
  chart?: (v: V) => ChartSpec;
  /** 오답이 부족할 때 쓸 근접값(k = 1, -1, 2, -2, …). 숫자형 문제만. */
  near?: (k: number) => V | null;
}

/** 문항 하나를 만들 때 템플릿에 주는 조건 */
export interface GenContext {
  /** 사용자가 고른 프로그래밍 언어. 프로그래밍 템플릿은 이 언어로만 코드를 만든다(SQL 템플릿은 쓰지 않음). */
  lang: LanguageId;
  /** 이 문항의 난이도(코드 길이·변수 수·개념 수, docs/engine-design.md 3절). 세트가 자리마다 정한다. */
  difficulty: Difficulty;
}

export interface Template<V = any> {
  id: string;
  area: AreaId;
  subtype: string;
  /** 만들 수 있는 난이도 */
  difficulties: readonly Difficulty[];
  /** 언어 전용 템플릿이면 출제할 수 있는 언어. 없으면 모든 언어 */
  langs?: readonly LanguageId[];
  generate(rng: Rng, ctx: GenContext): Generated<V>;
}

/** 이 언어로 출제할 수 있는 템플릿인가 */
export const availableFor = (tpl: Template, lang: LanguageId) => !tpl.langs || tpl.langs.includes(lang);

export interface Choice {
  label: string;
  /** 정답이면 null */
  mistakeTag: MistakeTag | null;
  chart?: ChartSpec;
}

/** 세트에 들어가는 완성된 문항 */
export interface Problem {
  templateId: string;
  area: AreaId;
  subtype: string;
  difficulty: Difficulty;
  text: string;
  figure?: Figure;
  choices: Choice[];
  answerIndex: number;
  steps: string[];
  /** 근접값으로 채운 보기 수 (validate 통계용) */
  fillers: number;
}
