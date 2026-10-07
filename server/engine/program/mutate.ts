/**
 * 실수 변형과 문항 조립.
 *  - 변형: 모델의 일부를 흔한 실수 쪽으로 바꾼 사본을 만든다(경계 뒤집기, continue↔break, else if를 독립 if로 등).
 *    변형한 모델을 참조 평가기로 실행한 출력이 오답 보기다. 적용할 곳이 없으면 null.
 *  - 조립(programProblem): 모델 → 정답(평가기) + 코드(렌더러) + 오답(변형) + 문장.
 */
import type { Rng } from '../rng.js';
import type { GenContext, Generated, Wrong } from '../types.js';
import type { MistakeTag } from '../mistakes.js';
import { languageName } from '../../../shared/languages.js';
import { clone, type CmpOp, type Expr, type Program, type Stmt } from './model.js';
import { outputLabel, run } from './eval.js';
import { renderProgram } from './render.js';

/* ---------- 모델 훑기 ---------- */

/** 모든 문장(중첩 포함)에 fn을 적용한 사본. fn이 undefined를 돌려주면 그대로 두고 안쪽으로 들어간다. */
export function mapStmts(p: Program, fn: (s: Stmt) => Stmt[] | undefined): Program {
  const walk = (body: Stmt[]): Stmt[] =>
    body.flatMap((s) => {
      const r = fn(s);
      if (r) return r;
      switch (s.k) {
        case 'if':
          return [{ ...s, branches: s.branches.map((b) => ({ ...b, body: walk(b.body) })), ...(s.else ? { else: walk(s.else) } : {}) }];
        case 'for':
        case 'while':
          return [{ ...s, body: walk(s.body) }];
        case 'switch':
          return [{ ...s, cases: s.cases.map((c) => ({ ...c, body: walk(c.body) })), ...(s.def ? { def: walk(s.def) } : {}) }];
        default:
          return [s];
      }
    });
  const c = clone(p);
  return { funcs: c.funcs.map((f) => ({ ...f, body: walk(f.body) })), main: walk(c.main) };
}

/** 모든 식(중첩 포함)에 fn을 적용한 사본 */
export function mapExprs(p: Program, fn: (e: Expr) => Expr | undefined): Program {
  const ex = (e: Expr): Expr => {
    const r = fn(e);
    if (r) return r;
    switch (e.k) {
      case 'bin':
        return { ...e, a: ex(e.a), b: ex(e.b) };
      case 'not':
        return { ...e, e: ex(e.e) };
      case 'idx':
        return { ...e, i: ex(e.i) };
      case 'call':
        return { ...e, args: e.args.map(ex) };
      default:
        return e;
    }
  };
  return mapStmts(p, (s) => {
    switch (s.k) {
      case 'decl':
        return [{ ...s, init: ex(s.init) }];
      case 'set':
        return [{ ...s, e: ex(s.e) }];
      case 'setIdx':
        return [{ ...s, i: ex(s.i), e: ex(s.e) }];
      case 'print':
      case 'return':
        return [{ ...s, e: ex(s.e) }];
      default:
        return undefined;
    }
  });
}

/** 바뀐 것이 없으면 null */
const changed = (a: Program, b: Program): Program | null => (JSON.stringify(a) === JSON.stringify(b) ? null : b);

/* ---------- 흔한 실수 ---------- */

/** 반복의 끝값 포함 여부를 뒤집는다(< ↔ <=, > ↔ >=) */
export function flipLoopBound(p: Program): Program | null {
  const flip = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' } as const;
  return changed(p, mapStmts(p, (s) => (s.k === 'for' ? [{ ...s, cmp: flip[s.cmp], body: flipLoopBound({ funcs: [], main: s.body })?.main ?? s.body }] : undefined)));
}

/** continue와 break를 서로 바꾼다 */
export function swapBreakContinue(p: Program): Program | null {
  return changed(p, mapStmts(p, (s) => (s.k === 'break' ? [{ k: 'continue' }] : s.k === 'continue' ? [{ k: 'break' }] : undefined)));
}

/** 조건문 안의 비교에서 같은 값을 포함하는지 뒤집는다(>= ↔ >, <= ↔ <) */
export function relaxCompare(p: Program, where: 'if' | 'while' | 'all' = 'all'): Program | null {
  const flip: Partial<Record<CmpOp, CmpOp>> = { '>=': '>', '>': '>=', '<=': '<', '<': '<=' };
  const fx = (e: Expr): Expr =>
    e.k === 'bin' && flip[e.op as CmpOp] ? { ...e, op: flip[e.op as CmpOp]! } : e.k === 'bin' ? { ...e, a: fx(e.a), b: fx(e.b) } : e.k === 'not' ? { ...e, e: fx(e.e) } : e;
  return changed(
    p,
    mapStmts(p, (s) => {
      if (s.k === 'if' && where !== 'while')
        return [{ ...s, branches: s.branches.map((b) => ({ cond: fx(b.cond), body: relaxCompare({ funcs: [], main: b.body }, where)?.main ?? b.body })), ...(s.else ? { else: relaxCompare({ funcs: [], main: s.else }, where)?.main ?? s.else } : {}) }];
      if (s.k === 'while' && where !== 'if') return [{ ...s, cond: fx(s.cond), body: relaxCompare({ funcs: [], main: s.body }, where)?.main ?? s.body }];
      return undefined;
    }),
  );
}

/** else if 사슬을 독립된 if 여러 개로 읽는다(else는 마지막 if에 붙음) */
export function elseIfToIfs(p: Program): Program | null {
  return changed(
    p,
    mapStmts(p, (s) => {
      if (s.k !== 'if' || s.branches.length < 2) return undefined;
      const out: Stmt[] = s.branches.map((b, i) => ({ k: 'if', branches: [{ cond: b.cond, body: elseIfToIfs({ funcs: [], main: b.body })?.main ?? b.body }], ...(i === s.branches.length - 1 && s.else ? { else: s.else } : {}) }));
      return out;
    }),
  );
}

/** if의 조건을 무시하고 첫 분기 본문을 늘 실행한다(else 없는 단일 if만) */
export function dropIfCondition(p: Program): Program | null {
  return changed(p, mapStmts(p, (s) => (s.k === 'if' && s.branches.length === 1 && !s.else ? s.branches[0].body : undefined)));
}

/** 누적 대입(+=)을 그냥 대입(=)으로 읽는다 */
export function accumulateAsAssign(p: Program): Program | null {
  return changed(p, mapStmts(p, (s) => (s.k === 'set' && s.op === '+=' ? [{ ...s, op: '=' }] : undefined)));
}

/** switch의 모든 case에 break가 있다고 본다 */
export function switchAllBreak(p: Program): Program | null {
  return changed(p, mapStmts(p, (s) => (s.k === 'switch' ? [{ ...s, cases: s.cases.map((c) => ({ ...c, brk: true })) }] : undefined)));
}

/** &&와 ||를 바꿔 읽는다 */
export function swapAndOr(p: Program): Program | null {
  const fx = (e: Expr): Expr | undefined => (e.k === 'bin' && (e.op === '&&' || e.op === '||') ? { ...e, op: e.op === '&&' ? '||' : '&&', a: fx(e.a) ?? e.a, b: fx(e.b) ?? e.b } : undefined);
  return changed(
    p,
    mapStmts(p, (s) =>
      s.k === 'if' ? [{ ...s, branches: s.branches.map((b) => ({ cond: fx(b.cond) ?? b.cond, body: swapAndOr({ funcs: [], main: b.body })?.main ?? b.body })), ...(s.else ? { else: s.else } : {}) }] : undefined,
    ),
  );
}

/* ---------- 문항 조립 ---------- */

export interface ProgramMistake {
  tag: MistakeTag;
  prog: Program | null;
}

/** 변형 모델을 실행한 출력 → 오답. 실행할 수 없는 변형(무한 반복, 범위 밖 등)은 버린다. */
export function wrongsFrom(base: Program, ms: ProgramMistake[]): Wrong<string>[] {
  const want = outputLabel(run(base).out);
  const out: Wrong<string>[] = [];
  for (const m of ms) {
    if (!m.prog) continue;
    try {
      const v = outputLabel(run(m.prog).out);
      if (v !== want) out.push({ value: v, mistakeTag: m.tag });
    } catch {
      // 변형이 정의된 동작 범위를 벗어나면 오답으로 쓰지 않는다
    }
  }
  return out;
}

/** 문장 틀(세 가지). 언어 이름만 바뀐다. */
const PHRASES = [
  (l: string) => `다음 ${l} 코드를 실행했을 때 출력 결과로 옳은 것은?`,
  (l: string) => `아래 ${l} 프로그램을 실행하면 출력되는 내용은?`,
  (l: string) => `다음 ${l} 코드의 실행 결과는?`,
];

/** 출력 줄 해설: "따라서 출력은 7입니다." / "따라서 출력은 차례로 3, 5입니다." */
export function outputStep(out: number[]): string {
  return out.length === 1 ? `따라서 출력은 ${out[0]}입니다.` : `따라서 출력은 차례로 ${out.join(', ')}입니다(한 줄에 하나씩).`;
}

export interface ProgramVariant {
  base: Program;
  mistakes: ProgramMistake[];
  steps: (out: number[]) => string[];
}

/** 서로 다른 오답 출력 수 */
export const distinctWrongs = (v: ProgramVariant) => new Set(wrongsFrom(v.base, v.mistakes).map((w) => w.value)).size;

/** 실수에서 나온 서로 다른 오답이 MIN_WRONGS개 이상인 변형이 나올 때까지 다시 뽑는다(정의된 동작 범위를 벗어난 모델도 다시 뽑는다) */
const MIN_WRONGS = 4;
export function pickVariant(make: () => ProgramVariant, tries = 40): ProgramVariant {
  let last: ProgramVariant | null = null;
  for (let t = 0; t < tries; t++) {
    try {
      const v = make();
      run(v.base);
      last = v;
      if (distinctWrongs(v) >= MIN_WRONGS) return v;
    } catch {
      // 다시 뽑는다
    }
  }
  if (!last) throw new Error('변형을 만들지 못함');
  return last;
}

/**
 * 모델 하나로 문항을 만든다.
 * steps: 템플릿이 쓴 해설(마지막 출력 문장은 여기서 붙인다)
 */
export function programProblem(rng: Rng, ctx: GenContext, base: Program, mistakes: ProgramMistake[], steps: (out: number[]) => string[]): Generated<string> {
  const { out } = run(base);
  const answer = outputLabel(out);
  const code = renderProgram(base, ctx.lang);
  const lastLineNear = (k: number) => {
    const v = out[out.length - 1] + k;
    return v >= 0 ? outputLabel([...out.slice(0, -1), v]) : null;
  };
  return {
    text: rng.pick(PHRASES)(languageName(ctx.lang)),
    answer,
    wrongs: wrongsFrom(base, mistakes),
    steps: [...steps(out), outputStep(out)],
    format: (v) => v,
    figure: { kind: 'code', lang: languageName(ctx.lang), code },
    near: lastLineNear,
  };
}
