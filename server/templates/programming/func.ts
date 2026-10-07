/**
 * P7 함수 호출과 반환값, 재귀(팩토리얼·누적합·거듭제곱·피보나치). 네 언어 공통.
 *  난이도 1: 함수 g를 부르는 함수 f, f(c)의 반환값 출력
 *  난이도 2: 재귀 한 갈래(팩토리얼, 1부터 n까지 합, k의 거듭제곱)
 *  난이도 3: 재귀 두 갈래(피보나치)
 * 재귀 깊이는 작게(평가기 상한 40), 값은 정수 범위 안. 함수는 매개변수와 지역 변수만 쓴다.
 * 오답: 기저 조건의 값·경계 바꾸기, 인자 n↔n−1, 반환값 대신 다른 값, 연산 우선순위 무시, 덧셈↔곱셈
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { bin, call, if_, num, print, ref, ret, type Expr, type Func, type Program } from '../../engine/program/model.js';
import { pickVariant, programProblem, type ProgramMistake } from '../../engine/program/mutate.js';

const n_ = ref('n');
const x_ = ref('x');

/** 난이도 1: f(x) = g(x) * b, g(x) = x + a */
function level1(rng: Rng) {
  const a = rng.int(2, 9);
  const b = rng.int(2, 5);
  const c = rng.int(2, 9);
  const g: Func = { name: 'g', params: ['x'], body: [ret(bin('+', x_, num(a)))] };
  const build = (fBody: Expr): Program => ({ funcs: [g, { name: 'f', params: ['x'], body: [ret(fBody)] }], main: [print(call('f', num(c)))] });
  const base = build(bin('*', call('g', x_), num(b)));
  const mistakes: ProgramMistake[] = [
    { tag: '함수 인자 혼동', prog: build(bin('*', x_, num(b))) },
    { tag: '함수 인자 혼동', prog: build(bin('*', call('g', num(b)), x_)) },
    { tag: '연산 우선순위 혼동', prog: build(bin('+', x_, bin('*', num(a), num(b)))) },
    { tag: '구하는 대상 혼동', prog: build(call('g', x_)) },
    { tag: '연산 우선순위 혼동', prog: build(bin('+', bin('*', x_, num(b)), num(a))) },
  ];
  const steps = () => [`f(${c})는 g(${c}) * ${b}를 돌려줍니다. g(${c}) = ${c} + ${a} = ${c + a}입니다.`, `따라서 f(${c}) = ${c + a} * ${b} = ${(c + a) * b}입니다.`];
  return { base, mistakes, steps };
}

type Kind = 'fact' | 'sum' | 'pow';

/** 난이도 2: 재귀 한 갈래 */
function level2(rng: Rng) {
  const kind = rng.pick<Kind>(['fact', 'sum', 'pow']);
  const k = rng.int(2, 3);
  const b = rng.int(1, 3);
  const arg = kind === 'fact' ? rng.int(4, 7) : kind === 'sum' ? rng.int(5, 12) : rng.int(3, 6);
  /** 기저 조건 경계(n <= edge)와 기저 값, 재귀 단계 */
  const def = {
    fact: { edge: 1, baseVal: 1, step: (r: Expr) => bin('*', n_, r) },
    sum: { edge: 0, baseVal: 0, step: (r: Expr) => bin('+', n_, r) },
    pow: { edge: 0, baseVal: b, step: (r: Expr) => bin('*', num(k), r) },
  }[kind];
  const build = (o: { edge?: number; baseVal?: number; dec?: number; swapOp?: boolean; arg?: number } = {}): Program => {
    const rec = call('f', bin('-', n_, num(o.dec ?? 1)));
    let step = def.step(rec);
    if (o.swapOp && step.k === 'bin') step = { ...step, op: step.op === '*' ? '+' : '*' };
    return {
      funcs: [{ name: 'f', params: ['n'], body: [if_(bin('<=', n_, num(o.edge ?? def.edge)), [ret(num(o.baseVal ?? def.baseVal))]), ret(step)] }],
      main: [print(call('f', num(o.arg ?? arg)))],
    };
  };
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '재귀 기저 조건 오류', prog: build({ baseVal: def.baseVal === 0 ? 1 : def.baseVal === 1 ? 0 : def.baseVal + 1 }) },
    { tag: '재귀 기저 조건 오류', prog: build({ edge: def.edge + 1 }) },
    { tag: '함수 인자 혼동', prog: build({ arg: arg - 1 }) },
    { tag: '함수 인자 혼동', prog: build({ dec: 2 }) },
    { tag: '계산 실수', prog: build({ swapOp: true }) },
  ];
  const chain = Array.from({ length: arg - def.edge }, (_, i) => arg - i);
  const steps = () => {
    const how =
      kind === 'fact'
        ? `f(n)은 n이 1 이하이면 1을, 아니면 n * f(n - 1)을 돌려줍니다. f(${arg}) = ${chain.join(' * ')} * f(1)이고 f(1) = 1입니다.`
        : kind === 'sum'
          ? `f(n)은 n이 0 이하이면 0을, 아니면 n + f(n - 1)을 돌려줍니다. f(${arg}) = ${chain.join(' + ')} + f(0)이고 f(0) = 0입니다.`
          : `f(n)은 n이 0 이하일 때 기저 값(${b})을, 아니면 ${k} * f(n - 1)을 돌려줍니다. f(${arg}) = ${Array(arg).fill(k).join(' * ')} * ${b}입니다.`;
    return [how, '재귀는 기저 조건에 닿은 뒤 돌아오면서 값을 계산합니다.'];
  };
  return { base, mistakes, steps };
}

/** 난이도 3: 피보나치. 기저는 n <= 1이면 n(f(0) = 0, f(1) = 1) 또는 n <= 2이면 1(f(1) = f(2) = 1) */
function level3(rng: Rng) {
  const variant = rng.pick(['n', 'one'] as const);
  const arg = rng.int(6, 11);
  const build = (o: { baseRet?: 'n' | 'one'; edge?: number; arg?: number; twice?: boolean; baseTwo?: boolean } = {}): Program => {
    const edge = o.edge ?? (variant === 'n' ? 1 : 2);
    const baseRet = o.baseTwo ? bin('*', (o.baseRet ?? variant) === 'n' ? n_ : num(1), num(2)) : (o.baseRet ?? variant) === 'n' ? n_ : num(1);
    // twice: 두 호출을 모두 f(n - 1)로 읽는 실수
    const rec = bin('+', call('f', bin('-', n_, num(1))), call('f', bin('-', n_, num(o.twice ? 1 : 2))));
    return {
      funcs: [{ name: 'f', params: ['n'], body: [if_(bin('<=', n_, num(edge)), [ret(baseRet)]), ret(rec)] }],
      main: [print(call('f', num(o.arg ?? arg)))],
    };
  };
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '재귀 기저 조건 오류', prog: build({ baseRet: variant === 'n' ? 'one' : 'n' }) },
    { tag: '재귀 기저 조건 오류', prog: build({ edge: variant === 'n' ? 2 : 1 }) },
    { tag: '함수 인자 혼동', prog: build({ arg: arg - 1 }) },
    { tag: '함수 인자 혼동', prog: build({ arg: arg + 1 }) },
    { tag: '함수 인자 혼동', prog: build({ arg: arg - 2 }) },
    { tag: '함수 인자 혼동', prog: build({ twice: true }) },
    { tag: '재귀 기저 조건 오류', prog: build({ baseTwo: true }) },
  ];
  const fib: number[] = variant === 'n' ? [0, 1] : [0, 1, 1];
  while (fib.length <= arg) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);
  const steps = () => [
    variant === 'n' ? 'f(0) = 0, f(1) = 1이고, 그 뒤로는 f(n) = f(n - 1) + f(n - 2)입니다.' : 'f(1) = f(2) = 1이고, 그 뒤로는 f(n) = f(n - 1) + f(n - 2)입니다.',
    `작은 값부터 차례로 구하면 ${fib.slice(variant === 'n' ? 0 : 1, arg + 1).join(', ')}입니다.`,
  ];
  return { base, mistakes, steps };
}

export const func: Template<string> = {
  id: 'programming.func',
  area: 'programming',
  subtype: '함수와 재귀',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    const v = pickVariant(() => (ctx.difficulty === 1 ? level1(rng) : ctx.difficulty === 2 ? level2(rng) : level3(rng)));
    return programProblem(rng, ctx, v.base, v.mistakes, v.steps);
  },
};
