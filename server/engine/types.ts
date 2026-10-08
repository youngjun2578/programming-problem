import type { Rng } from './rng.js';
import type { MistakeTag } from './mistakes.js';
import type { ChartSpec, Figure } from '../../shared/charts/types.js';
import type { LanguageId } from '../../shared/languages.js';
import type { ExplainDetail } from '../../shared/api.js';

export type AreaId = 'programming' | 'sql';
export type Difficulty = 1 | 2 | 3;

export interface Wrong<V> {
  value: V;
  mistakeTag: MistakeTag;
  /**
   * 그 실수를 다시 적용해 값을 새로 계산한다(검증용, validate가 보기 값과 같은지 본다).
   * 실수한 모델·질의 없이 값을 바로 계산한 오답(예: 표의 전체 행 수)은 없다.
   */
  recheck?: () => V | null;
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
  /** 단계별 풀이(프로그래밍 추적표, SQL 단계별 중간 결과) */
  detail?: ExplainDetail;
  /** 검증용: 해설(추적·중간 결과)이 정답과 맞는지 스스로 확인하고 문제 목록을 돌려준다(validate가 부른다) */
  selfCheck?: () => string[];
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
  /** 단계별 풀이 */
  detail?: ExplainDetail;
  /** 근접값으로 채운 보기 수 (validate 통계용) */
  fillers: number;
}
