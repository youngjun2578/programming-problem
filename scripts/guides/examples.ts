/**
 * 가이드 글의 예제: 엔진이 고정 시드로 만든 문제를 쓰고, 풀이는 여기서 새로 쓴 계산 코드로 다시 계산한다.
 *  - 문제·보기·정답 위치는 엔진(makeProblem)이 만든 그대로
 *  - 풀이 문장과 중간 숫자는 아래 풀이 함수가 문제 문장·도표에서 값을 읽어 직접 계산한 값
 *  - 직접 계산한 답이 엔진의 정답 보기와 다르면 빌드를 멈춘다(코드 검산)
 *  - 엔진의 해설 문장을 그대로 쓰지 않았는지도 검사한다
 *
 * 지금은 가이드 글이 없어 풀이 함수도 없다. 예제를 쓸 템플릿마다 SOLVERS에 풀이 함수를 추가한다.
 */
import { TEMPLATES } from '../../server/registry.js';
import { Rng } from '../../server/engine/rng.js';
import { makeProblem } from '../../server/engine/set.js';
import type { Problem } from '../../server/engine/types.js';
import type { LanguageId } from '../../shared/languages.js';

export interface Solved {
  /** 풀이 단계(새로 쓴 문장) */
  steps: string[];
  /** 직접 계산한 정답 표시(엔진의 정답 보기 표시와 같아야 한다) */
  answer: string;
}

type Solver = (p: Problem) => Solved;

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`예제 풀이: ${msg}`);
}

/** 템플릿 id → 문제 형태(문장 정규식)별 풀이 함수 */
const SOLVERS: Record<string, { match: RegExp; solve: Solver }[]> = {};

export interface Example {
  templateId: string;
  seed: number;
  lang: LanguageId;
  problem: Problem;
  solved: Solved;
}

/** 템플릿 id·시드·언어로 예제를 만들고 검산한다. 문제 문장이 풀이 함수의 match와 맞아야 한다. */
export function buildExample(templateId: string, seed: number, lang: LanguageId = 'python'): Example {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  need(tpl, `없는 템플릿 ${templateId}`);
  const problem = makeProblem(tpl, new Rng(seed), { lang });
  const solver = SOLVERS[templateId]?.find((s) => s.match.test(problem.text));
  need(solver, `${templateId} 시드 ${seed}: 이 문제 형태의 풀이 함수가 없음 — ${problem.text.slice(0, 40)}`);
  const solved = solver.solve(problem);
  // 코드 검산: 직접 계산한 답 = 엔진의 정답 보기
  const engineAnswer = problem.choices[problem.answerIndex].label;
  need(engineAnswer === solved.answer, `${templateId} 시드 ${seed}: 검산 불일치 (엔진 ${engineAnswer}, 계산 ${solved.answer})`);
  // 엔진 해설 문장을 그대로 쓰지 않았는지
  for (const s of solved.steps) need(!problem.steps.includes(s), `${templateId} 시드 ${seed}: 엔진 해설 문장과 같은 풀이 문장`);
  return { templateId, seed, lang, problem, solved };
}

/** 개발용: 원하는 형태의 문제가 나오는 시드 찾기 */
export function findSeeds(templateId: string, match: RegExp, count = 5, from = 1, lang: LanguageId = 'python'): number[] {
  const tpl = TEMPLATES.find((t) => t.id === templateId)!;
  const out: number[] = [];
  for (let s = from; out.length < count && s < from + 20000; s++) {
    try {
      const p = makeProblem(tpl, new Rng(s), { lang });
      if (match.test(p.text)) {
        buildExample(templateId, s, lang);
        out.push(s);
      }
    } catch {
      // 맞지 않는 시드
    }
  }
  return out;
}
