/**
 * P3 조건 분기 (if / else if / else, switch의 break 유무). 네 언어 공통(Python은 if/elif만).
 *  난이도 1: x 값에 따라 if / else if / else 가운데 하나만 실행(경계값과 같은 x가 자주 나온다)
 *  난이도 2: 반복 안에서 if / else if로 수를 나눠 센다(두 줄 출력)
 *  난이도 3: C·C++·Java는 반복 안 switch(일부 case에 break 없음) 또는 &&·||가 섞인 조건, Python은 &&·|| 조건
 * 오답: >=↔> 경계, else if를 독립 if로, 조건 순서 바꾸기, 모든 분기 실행, switch break 무시, &&↔||
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { bin, decl, for_, ifChain, inc, num, print, ref, set, type Expr, type Program, type Stmt } from '../../engine/program/model.js';
import { accumulateAsAssign, elseIfToIfs, flipLoopBound, mapStmts, pickVariant, programProblem, relaxCompare, swapAndOr, switchAllBreak, type ProgramMistake } from '../../engine/program/mutate.js';

const mod0 = (v: string, k: number): Expr => bin('==', bin('%', ref(v), num(k)), num(0));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** if 사슬의 분기 순서를 뒤집는다(else는 그대로) */
function reverseBranches(p: Program): Program {
  return mapStmts(p, (s) => (s.k === 'if' && s.branches.length > 1 ? [{ ...s, branches: [...s.branches].reverse() }] : undefined));
}

/** 조건을 무시하고 모든 분기 본문을 차례로 실행한다 */
function runAllBranches(p: Program): Program {
  return mapStmts(p, (s) => (s.k === 'if' && s.branches.length > 1 ? [...s.branches.flatMap((b) => b.body), ...(s.else ?? [])] : undefined));
}

/** 난이도 1 */
function level1(rng: Rng) {
  const t2 = rng.int(4, 8) * 10;
  const t1 = t2 + rng.int(1, 3) * 10;
  const op = rng.pick(['>=', '>'] as const);
  // 경계값과 같은 x를 절반쯤 고른다
  const x = rng.pick([t1, t2, t1 + rng.int(1, 9), t2 + rng.int(1, 9), t2 - rng.int(1, 9)]);
  const v = rng.int(1, 5);
  const [a, b, c] = rng.sample([2, 3, 5, 7, 11, 13], 3);
  const base: Program = {
    funcs: [],
    main: [decl('x', x), decl('y', v), ifChain([{ cond: bin(op, ref('x'), num(t1)), body: [set('y', '+=', a)] }, { cond: bin(op, ref('x'), num(t2)), body: [set('y', '+=', b)] }], [set('y', '+=', c)]), print('y')],
  };
  const mistakes: ProgramMistake[] = [
    { tag: '경계값 비교 혼동', prog: relaxCompare(base) },
    { tag: '분기 구조 혼동', prog: elseIfToIfs(base) },
    { tag: '분기 구조 혼동', prog: reverseBranches(base) },
    { tag: '조건 누락', prog: runAllBranches(base) },
    { tag: '구하는 대상 혼동', prog: { funcs: [], main: [...base.main.slice(0, -1), print('x')] } },
    { tag: '누적 오류', prog: accumulateAsAssign(base) },
    // else를 if 사슬과 상관없이 늘 실행한다고 봄 / else를 아예 빠뜨림
    { tag: '분기 구조 혼동', prog: mapStmts(base, (s) => (s.k === 'if' && s.else ? [{ ...s, else: undefined }, ...s.else] : undefined)) },
    { tag: '조건 누락', prog: mapStmts(base, (s) => (s.k === 'if' && s.else ? [{ ...s, else: undefined }] : undefined)) },
  ];
  const hit = x === t1 || x === t2;
  const which = (op === '>=' ? x >= t1 : x > t1) ? `첫 번째 조건(x ${op} ${t1})` : (op === '>=' ? x >= t2 : x > t2) ? `두 번째 조건(x ${op} ${t2})` : 'else';
  const steps = () => [
    `x는 ${x}입니다.${hit ? ` 경계값과 같으므로 ${op}가 같은 값을 포함하는지${op === '>=' ? '(포함)' : '(포함하지 않음)'} 확인해야 합니다.` : ''}`,
    `if / else if / else는 위에서부터 처음 참인 분기 하나만 실행합니다. 여기서는 ${which} 분기가 실행됩니다.`,
  ];
  return { base, mistakes, steps };
}

/** 난이도 2: 반복 안에서 k1의 배수와 (아니면) k2의 배수를 나눠 센다 */
function level2(rng: Rng) {
  const [k1, k2] = rng.shuffle(rng.pick([[2, 3], [2, 4], [3, 4], [2, 5], [3, 5]]));
  // 두 수의 공배수가 범위 안에 있어야 else if를 독립 if로 읽는 실수가 드러난다. 끝값은 k1·k2의 배수로 둔다(끝값 포함 여부가 드러나게)
  const l = (k1 * k2) / gcd(k1, k2);
  const from = rng.int(1, 4);
  const to = rng.pick(Array.from({ length: 6 }, (_, i) => from + 6 + i).filter((t) => (t % k1 === 0 || t % k2 === 0) && Math.floor(t / l) * l >= from)) ?? from + 6;
  const build = (o: { order?: 'swap' } = {}): Program => ({
    funcs: [],
    main: [
      decl('a', 0),
      decl('b', 0),
      for_('i', from, '<=', to, [ifChain([{ cond: mod0('i', k1), body: [inc('a')] }, { cond: mod0('i', k2), body: [inc('b')] }])]),
      ...(o.order === 'swap' ? [print('b'), print('a')] : [print('a'), print('b')]),
    ],
  });
  const base = build();
  const dropSecond = mapStmts(base, (s) => (s.k === 'if' && s.branches.length === 2 ? [{ k: 'if', branches: [s.branches[0]], else: s.branches[1].body } as Stmt] : undefined));
  const mistakes: ProgramMistake[] = [
    { tag: '분기 구조 혼동', prog: elseIfToIfs(base) },
    { tag: '분기 구조 혼동', prog: reverseBranches(base) },
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '구하는 대상 혼동', prog: build({ order: 'swap' }) },
    { tag: '조건 누락', prog: dropSecond },
  ];
  const is = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const inA = is.filter((i) => i % k1 === 0);
  const inB = is.filter((i) => i % k1 !== 0 && i % k2 === 0);
  const steps = () => [
    `i는 ${from}부터 ${to}까지입니다. ${k1}의 배수(${inA.join(', ') || '없음'})이면 a를 1 늘립니다.`,
    `else if는 앞 조건이 거짓일 때만 검사하므로, ${k1}의 배수가 아니면서 ${k2}의 배수인 수(${inB.join(', ') || '없음'})만 b를 늘립니다.`,
  ];
  return { base, mistakes, steps };
}

/** 난이도 3-a(C·C++·Java): 반복 안 switch. 일부 case는 break가 없어 다음 case로 이어진다 */
function level3Switch(rng: Rng) {
  const vals = rng.sample([1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
  const brks = [rng.chance(0.5), rng.chance(0.5), rng.chance(0.5)];
  if (brks.every(Boolean)) brks[rng.int(0, 2)] = false;
  const last = rng.int(3, 4);
  const base: Program = {
    funcs: [],
    main: [
      decl('s', 0),
      for_('k', 1, '<=', last, [
        {
          k: 'switch',
          e: ref('k'),
          cases: [1, 2, 3].map((c, i) => ({ v: c, body: [set('s', '+=', vals[i])], brk: brks[i] })),
          def: [set('s', '+=', vals[3])],
        },
      ]),
      print('s'),
    ],
  };
  const noBreak = mapStmts(base, (s) => (s.k === 'switch' ? [{ ...s, cases: s.cases.map((c) => ({ ...c, brk: false })) }] : undefined));
  const noDefault = mapStmts(base, (s) => (s.k === 'switch' ? [{ ...s, def: undefined }] : undefined));
  const mistakes: ProgramMistake[] = [
    { tag: 'switch break 누락', prog: switchAllBreak(base) },
    { tag: 'switch break 누락', prog: noBreak },
    { tag: '조건 누락', prog: noDefault },
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '반복 범위 오류', prog: mapStmts(base, (s) => (s.k === 'for' ? [{ ...s, from: num(0) }] : undefined)) },
  ];
  const steps = () => {
    const desc = [1, 2, 3].map((c, i) => `case ${c}(${brks[i] ? 'break 있음' : 'break 없음 → 다음 case로 이어짐'})`).join(', ');
    return [`k는 1부터 ${last}까지 바뀝니다. ${desc}. 맞는 case가 없거나 위에서 이어져 내려오면 default를 실행합니다.`, `각 k에서 실행되는 case를 모두 더해 s를 구합니다.`];
  };
  return { base, mistakes, steps };
}

/** 난이도 3-b(네 언어): && 와 || 가 섞인 조건으로 나눠 누적 */
function level3Logic(rng: Rng) {
  const from = rng.int(1, 3);
  const to = from + rng.int(7, 9);
  const t = rng.int(from + 2, to - 2);
  const k = rng.pick([3, 5]);
  const op = rng.pick(['>=', '>'] as const);
  const base: Program = {
    funcs: [],
    main: [
      decl('s', 0),
      decl('c', 0),
      for_('i', from, '<=', to, [
        ifChain([
          { cond: bin('&&', mod0('i', 2), bin(op, ref('i'), num(t))), body: [set('s', '+=', ref('i'))] },
          { cond: bin('||', mod0('i', k), bin('==', ref('i'), num(from))), body: [inc('c')] },
        ]),
      ]),
      print('s'),
      print('c'),
    ],
  };
  const mistakes: ProgramMistake[] = [
    { tag: '논리 연산자 혼동', prog: swapAndOr(base) },
    { tag: '경계값 비교 혼동', prog: relaxCompare(base) },
    { tag: '분기 구조 혼동', prog: elseIfToIfs(base) },
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '누적 오류', prog: accumulateAsAssign(base) },
    { tag: '구하는 대상 혼동', prog: { funcs: [], main: [...base.main.slice(0, -2), print('c'), print('s')] } },
  ];
  const steps = () => [
    `첫 번째 조건은 i가 짝수이고(그리고) i ${op} ${t}일 때만 참이며, 그때 s에 i를 더합니다.`,
    `첫 번째 조건이 거짓일 때만 else if를 검사합니다. i가 ${k}의 배수이거나(또는) i가 ${from}이면 c를 1 늘립니다.`,
  ];
  return { base, mistakes, steps };
}

export const branch: Template<string> = {
  id: 'programming.branch',
  area: 'programming',
  subtype: '조건 분기',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    const v = pickVariant(() =>
      ctx.difficulty === 1 ? level1(rng) : ctx.difficulty === 2 ? level2(rng) : ctx.lang !== 'python' && rng.chance(0.6) ? level3Switch(rng) : level3Logic(rng),
    );
    return programProblem(rng, ctx, v.base, v.mistakes, v.steps);
  },
};
