/**
 * P1 반복문 출력·누적 (for/while, continue/break). 네 언어 공통.
 *  난이도 1: for 하나로 누적해 한 번 출력
 *  난이도 2: for + if continue로 일부만 누적하거나, while로 조건이 깨질 때까지 반복(출력 두 줄)
 *  난이도 3: for + continue + break(누적값이 기준을 넘으면 멈춤), 횟수와 합 두 줄 출력
 * 오답: 끝값 포함 여부 뒤집기, 시작값 한 칸 밀기, continue↔break, 조건 빼기, += 대신 =, 출력을 반복 안에서
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { bin, brk, cont, decl, for_, if_, inc, num, print, ref, set, while_, type Program, type Stmt } from '../../engine/program/model.js';
import { run } from '../../engine/program/eval.js';
import { accumulateAsAssign, flipLoopBound, pickVariant, programProblem, relaxCompare, swapBreakContinue, type ProgramMistake } from '../../engine/program/mutate.js';

const range = (a: number, b: number, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

/** 난이도 1: sum += i * m (m = 1이면 sum += i) */
function level1(rng: Rng) {
  const step = rng.pick([1, 1, 2]);
  const from = rng.int(1, 5);
  const n = rng.int(3, 6); // 반복 횟수(출력 위치 실수 보기가 6줄을 넘지 않게)
  const incl = rng.chance(0.5);
  const lastI = from + step * (n - 1);
  // 끝값을 포함하지 않을 때는 다음 항(lastI + step)을 끝값으로 둔다. 그래야 <=로 잘못 읽으면 한 항이 더 들어간다
  const to = incl ? lastI : lastI + step;
  const m = rng.pick([1, 1, 2, 3]);
  const body = (op: '+=' | '='): Stmt[] => [set('sum', op, m === 1 ? ref('i') : bin('*', ref('i'), num(m)))];
  const build = (o: { from?: number; inside?: boolean } = {}): Program => ({
    funcs: [],
    main: [
      decl('sum', 0),
      for_('i', o.from ?? from, incl ? '<=' : '<', to, o.inside ? [...body('+='), print('sum')] : body('+='), step),
      ...(o.inside ? [] : [print('sum')]),
    ],
  });
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '반복 범위 오류', prog: build({ from: from + 1 }) },
    { tag: '누적 오류', prog: accumulateAsAssign(base) },
    { tag: '출력 위치 혼동', prog: build({ inside: true }) },
    { tag: '누적 오류', prog: { funcs: [], main: base.main.map((s) => (s.k === 'decl' ? decl('sum', 1) : s)) } },
  ];
  const is = range(from, lastI, step);
  const steps = () => [
    `i는 ${from}부터 ${step === 1 ? '1씩' : `${step}씩`} 커지며 ${is.join(', ')}일 때 반복합니다(끝값 ${to}${incl ? '까지 포함' : '는 포함하지 않음'}).`,
    `sum에 ${m === 1 ? 'i' : `i * ${m}`}를 차례로 더합니다: ${is.map((i) => i * m).join(' + ')}.`,
  ];
  return { base, mistakes, steps };
}

/** 난이도 2-a: k의 배수는 continue로 건너뛰고 나머지를 누적 */
function level2Continue(rng: Rng) {
  const k = rng.pick([2, 3]);
  const from = rng.int(1, 4);
  const to = from + rng.int(5, 7);
  const incl = rng.chance(0.5);
  const build = (o: { inside?: boolean; noSkip?: boolean } = {}): Program => ({
    funcs: [],
    main: [
      decl('sum', 0),
      for_('i', from, incl ? '<=' : '<', to, [
        ...(o.noSkip ? [] : [if_(bin('==', bin('%', ref('i'), num(k)), num(0)), [cont])]),
        set('sum', '+=', ref('i')),
        ...(o.inside ? [print('sum')] : []),
      ]),
      ...(o.inside ? [] : [print('sum')]),
    ],
  });
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: 'continue·break 혼동', prog: swapBreakContinue(base) },
    { tag: '조건 누락', prog: build({ noSkip: true }) },
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '누적 오류', prog: accumulateAsAssign(base) },
    { tag: '출력 위치 혼동', prog: build({ inside: true }) },
  ];
  const last = incl ? to : to - 1;
  const kept = range(from, last).filter((i) => i % k !== 0);
  const steps = () => [
    `i는 ${from}부터 ${last}까지 1씩 커집니다(끝값 ${to}${incl ? '까지 포함' : '는 포함하지 않음'}).`,
    `i가 ${k}의 배수이면 continue로 아래 문장을 건너뛰고 다음 i로 넘어가므로, 더하는 수는 ${kept.join(', ')}입니다.`,
  ];
  return { base, mistakes, steps };
}

/** 난이도 2-b: while로 x가 기준에 닿을 때까지 늘리며 횟수를 센다(두 줄 출력: 횟수, x) */
function level2While(rng: Rng) {
  const start = rng.int(1, 4);
  const mul = rng.chance(0.5);
  const d = mul ? 2 : rng.int(3, 6);
  const times = rng.int(3, 5);
  let x = start;
  for (let t = 0; t < times; t++) x = mul ? x * d : x + d;
  // limit을 마지막 값과 같게 두어 < 와 <= 의 차이가 드러나게 한다
  const limit = x;
  const cmp = rng.pick(['<', '<='] as const);
  const update = mul ? set('x', '*=', d) : set('x', '+=', d);
  const build = (o: { printOrder?: 'xc' } = {}): Program => ({
    funcs: [],
    main: [
      decl('x', start),
      decl('cnt', 0),
      while_(bin(cmp, ref('x'), num(limit)), [update, inc('cnt')]),
      ...(o.printOrder === 'xc' ? [print('x'), print('cnt')] : [print('cnt'), print('x')]),
    ],
  });
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '경계값 비교 혼동', prog: relaxCompare(base, 'while') },
    { tag: '구하는 대상 혼동', prog: build({ printOrder: 'xc' }) },
    { tag: '누적 오류', prog: { funcs: [], main: base.main.map((s) => (s.k === 'decl' && s.name === 'cnt' ? decl('cnt', 1) : s)) } },
    { tag: '반복 범위 오류', prog: { funcs: [], main: base.main.map((s) => (s.k === 'decl' && s.name === 'x' ? decl('x', mul ? start * d : start + d) : s)) } },
  ];
  const steps = (out: number[]) => {
    const { log } = run(base, { watch: ['x'] });
    const xs = log.map((l) => l.value);
    return [
      `x의 값 변화: ${xs.join(' → ')}. 조건(x ${cmp} ${limit})이 거짓이 되는 순간 반복을 멈춥니다.`,
      `반복 본문을 ${out[0]}번 실행하므로 cnt = ${out[0]}, 마지막 x = ${out[1]}입니다.`,
    ];
  };
  return { base, mistakes, steps };
}

/** 난이도 3: k의 배수는 건너뛰고(continue) 누적하다가, 합이 기준을 넘으면 멈춤(break). 횟수와 합 출력 */
function level3(rng: Rng) {
  const k = rng.pick([3, 4]);
  const from = rng.int(1, 3);
  const to = from + rng.int(8, 10);
  const kept = range(from, to).filter((i) => i % k !== 0);
  // 기준값을 중간 누적합과 같게 두어 > 와 >= 의 차이가 드러나게 한다
  const at = rng.int(2, Math.min(4, kept.length - 2));
  const limit = kept.slice(0, at).reduce((a, b) => a + b, 0);
  const op = rng.pick(['>', '>='] as const);
  const build = (o: { noBreak?: boolean } = {}): Program => ({
    funcs: [],
    main: [
      decl('sum', 0),
      decl('cnt', 0),
      for_('i', from, '<=', to, [
        if_(bin('==', bin('%', ref('i'), num(k)), num(0)), [cont]),
        set('sum', '+=', ref('i')),
        inc('cnt'),
        ...(o.noBreak ? [] : [if_(bin(op, ref('sum'), num(limit)), [brk])]),
      ]),
      print('cnt'),
      print('sum'),
    ],
  });
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: 'continue·break 혼동', prog: swapBreakContinue(base) },
    { tag: '경계값 비교 혼동', prog: relaxCompare(base, 'if') },
    { tag: '조건 누락', prog: build({ noBreak: true }) },
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '누적 오류', prog: accumulateAsAssign(base) },
    { tag: '구하는 대상 혼동', prog: { funcs: [], main: [...base.main.slice(0, -2), print('sum'), print('cnt')] } },
  ];
  const steps = (out: number[]) => [
    `i가 ${k}의 배수이면 continue로 건너뛰므로 더하는 수는 ${kept.slice(0, out[0]).join(', ')} 순서입니다.`,
    `합이 ${limit}${op === '>' ? '보다 커지면' : ' 이상이 되면'} break로 반복을 끝냅니다. 그때까지 ${out[0]}번 더해 sum은 ${out[1]}입니다.`,
  ];
  return { base, mistakes, steps };
}

export const loop: Template<string> = {
  id: 'programming.loop',
  area: 'programming',
  subtype: '반복문 출력·누적',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    const v = pickVariant(() => (ctx.difficulty === 1 ? level1(rng) : ctx.difficulty === 2 ? (rng.chance(0.5) ? level2Continue(rng) : level2While(rng)) : level3(rng)));
    return programProblem(rng, ctx, v.base, v.mistakes, v.steps);
  },
};
