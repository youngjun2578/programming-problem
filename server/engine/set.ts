import { Rng } from './rng.js';
import { buildChoices } from './choices.js';
import { availableFor, type AreaId, type Difficulty, type GenContext, type Problem, type Template } from './types.js';

export function makeProblem(tpl: Template, rng: Rng, ctx: GenContext): Problem {
  const g = tpl.generate(rng, ctx);
  const { choices, answerIndex, fillers } = buildChoices(rng, g);
  return {
    templateId: tpl.id,
    area: tpl.area,
    subtype: tpl.subtype,
    difficulty: ctx.difficulty,
    text: g.text,
    figure: g.figure,
    choices,
    answerIndex,
    steps: g.steps,
    fillers,
  };
}

/** 영역 안에서 서로 다른 유형 n개를 고른다 */
function pickTemplates(rng: Rng, pool: Template[], n: number): Template[] {
  const chosen: Template[] = [];
  const used = new Set<string>();
  for (const t of rng.shuffle(pool)) {
    if (chosen.length >= n) break;
    if (!used.has(t.subtype)) {
      chosen.push(t);
      used.add(t.subtype);
    }
  }
  return chosen;
}

/** 템플릿이 만들 수 있는 난이도 가운데 원하는 값에 가장 가까운 것(같으면 낮은 쪽) */
function nearestDifficulty(tpl: Template, want: Difficulty): Difficulty {
  return [...tpl.difficulties].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
}

export interface SetOptions {
  areas: AreaId[];
  perArea: number;
  /** 사용자가 고른 언어. 이 언어로 출제할 수 있는 템플릿만 후보로 쓴다. */
  lang: GenContext['lang'];
  /** 영역 안 문항 자리마다의 난이도(길이 perArea, 오름차순). 수준(기본·심화)에 따라 정한다. */
  difficulties: readonly Difficulty[];
}

/** 같은 문항인지 가르는 열쇠: 문장과 도표(코드·표)가 모두 같으면 같은 문항 */
const problemKey = (p: Problem) => JSON.stringify([p.text, p.figure ?? null]);

/** 영역 순서대로 영역당 perArea 문항. 영역 안에서는 난이도 오름차순, 같은 세트 안에서 같은 문항이 겹치지 않게 한다. */
export function generateSet(templates: Template[], seed: number, opts: SetOptions): Problem[] {
  const rng = new Rng(seed);
  const seen = new Set<string>();
  const out: Problem[] = [];
  for (const area of opts.areas) {
    const pool = templates.filter((t) => t.area === area && availableFor(t, opts.lang));
    pickTemplates(rng, pool, opts.perArea).forEach((tpl, slot) => {
      const ctx: GenContext = { lang: opts.lang, difficulty: nearestDifficulty(tpl, opts.difficulties[slot] ?? opts.difficulties[opts.difficulties.length - 1]) };
      let p: Problem | null = null;
      for (let tries = 0; tries < 30 && !p; tries++) {
        try {
          const cand = makeProblem(tpl, rng, ctx);
          if (!seen.has(problemKey(cand))) p = cand;
        } catch {
          // 정의된 동작 범위를 벗어난 모델, 보기 구성이 안 되는 조합은 다시 뽑는다. validate가 빈도를 감시한다.
        }
      }
      if (!p) throw new Error(`문항 생성 실패: ${tpl.id}`);
      seen.add(problemKey(p));
      out.push(p);
    });
  }
  return out;
}
