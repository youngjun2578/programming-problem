/**
 * P4 배열/리스트 순회 (합, 최댓값·최솟값과 그 인덱스, 뒤집기). 네 언어 공통.
 *  난이도 1: 배열을 처음부터 끝까지 돌며 합(조건이 붙기도 함)
 *  난이도 2: 최댓값(또는 최솟값)과 그 인덱스. 같은 값이 두 번 있어 > 와 >= 의 차이가 드러난다(두 줄 출력)
 *  난이도 3: 앞뒤를 바꿔 뒤집은 뒤 두 칸 출력(임시 변수로 교환)
 * 배열 길이: C·C++은 숫자, Java a.length, Python len(a). 범위 밖 접근은 쓰지 않는다(평가기가 막는다).
 * 오답: 인덱스 시작 0↔1, 끝 인덱스 한 칸 차이, += 대신 =, 합 대신 개수, 비교 > ↔ >=, 인덱스+1, 최대↔최소, 임시 변수 없이 교환
 */
import type { Template } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { arr, bin, decl, for_, idx, if_, len, num, print, ref, set, setIdx, type Expr, type Program, type Stmt } from '../../engine/program/model.js';
import { accumulateAsAssign, flipLoopBound, pickVariant, programProblem, relaxCompare, type ProgramMistake } from '../../engine/program/mutate.js';

/** 난이도 1: 합. 절반은 a[i] > t(또는 >=) 조건이 붙는다 */
function level1(rng: Rng) {
  const n = rng.int(5, 7);
  const a = Array.from({ length: n }, () => rng.int(1, 20));
  const withIf = rng.chance(0.5);
  // 기준값은 배열에 있는 값으로 두어 > 와 >= 의 차이가 드러나게 한다
  const t = rng.pick(a);
  const op = rng.pick(['>', '>='] as const);
  const build = (o: { from?: number; shortEnd?: boolean; count?: boolean } = {}): Program => {
    const add: Stmt = set('s', '+=', o.count ? num(1) : idx('a', ref('i')));
    const to: Expr = o.shortEnd ? bin('-', len('a'), num(1)) : len('a');
    return { funcs: [], main: [arr('a', a), decl('s', 0), for_('i', o.from ?? 0, '<', to, [withIf ? if_(bin(op, idx('a', ref('i')), num(t)), [add]) : add]), print('s')] };
  };
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '인덱스 시작 혼동', prog: build({ from: 1 }) },
    { tag: '반복 범위 오류', prog: build({ shortEnd: true }) },
    { tag: '누적 오류', prog: accumulateAsAssign(base) },
    { tag: '구하는 대상 혼동', prog: build({ count: true }) },
    { tag: '경계값 비교 혼동', prog: withIf ? relaxCompare(base) : null },
  ];
  const picked = a.filter((v) => !withIf || (op === '>' ? v > t : v >= t));
  const steps = () => [
    `i는 0부터 배열 길이(${n}) − 1까지이므로 a[0]부터 a[${n - 1}]까지 모든 원소를 봅니다.`,
    withIf ? `그 가운데 ${op === '>' ? `${t}보다 큰` : `${t} 이상인`} 값만 더합니다: ${picked.join(' + ') || '없음'}.` : `모든 원소를 더합니다: ${a.join(' + ')}.`,
  ];
  return { base, mistakes, steps };
}

/** 난이도 2: 최댓값(최솟값)과 그 인덱스 */
function level2(rng: Rng) {
  const n = rng.int(5, 7);
  const findMax = rng.chance(0.6);
  // 같은 극값을 서로 다른 두 자리(0번은 피함)에 두고, 나머지는 그보다 작게(크게) 만든다
  const ext = findMax ? rng.int(15, 25) : rng.int(2, 6);
  // 두 번째 자리는 절반쯤 마지막 칸으로 둔다(끝 인덱스를 하나 덜 보는 실수가 드러나게)
  const p1 = rng.int(1, n - 3);
  const p2 = rng.chance(0.5) ? n - 1 : rng.int(p1 + 1, n - 2);
  const a = Array.from({ length: n }, (_, i) => (i === p1 || i === p2 ? ext : findMax ? rng.int(1, ext - 1) : rng.int(ext + 1, 30)));
  const op = findMax ? '>' : '<';
  const build = (o: { op?: '>' | '<'; plusOne?: boolean; shortEnd?: boolean; zeroInit?: boolean; swapPrint?: boolean } = {}): Program => ({
    funcs: [],
    main: [
      arr('a', a),
      decl('m', o.zeroInit ? num(0) : idx('a', num(0))),
      decl('p', 0),
      for_('i', 1, '<', o.shortEnd ? bin('-', len('a'), num(1)) : len('a'), [if_(bin(o.op ?? op, idx('a', ref('i')), ref('m')), [set('m', '=', idx('a', ref('i'))), set('p', '=', ref('i'))])]),
      ...(o.swapPrint ? [print('p'), print('m')] : [print('m'), print(o.plusOne ? bin('+', ref('p'), num(1)) : ref('p'))]),
    ],
  });
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '경계값 비교 혼동', prog: relaxCompare(base) },
    { tag: '인덱스 시작 혼동', prog: build({ plusOne: true }) },
    { tag: '구하는 대상 혼동', prog: build({ op: findMax ? '<' : '>' }) },
    { tag: '반복 범위 오류', prog: build({ shortEnd: true }) },
    { tag: '구하는 대상 혼동', prog: build({ swapPrint: true }) },
    { tag: '누적 오류', prog: build({ zeroInit: true }) },
  ];
  const word = findMax ? '큰' : '작은';
  const steps = () => [
    `m은 a[0]에서 시작해, a[i]가 m보다 ${word} 값일 때만(같은 값은 제외) m과 p를 바꿉니다.`,
    `가장 ${word} 값(${ext})이 인덱스 ${p1}, ${p2} 두 곳에 있지만, 같은 값에서는 바꾸지 않으므로 p는 처음 나온 인덱스 ${p1}입니다(인덱스는 0부터).`,
  ];
  return { base, mistakes, steps };
}

/** 난이도 3: 앞뒤 교환으로 뒤집은 뒤 두 칸 출력 */
function level3(rng: Rng) {
  const n = rng.int(5, 7);
  const a = rng.sample(Array.from({ length: 30 }, (_, i) => i + 1), n);
  const half = Math.floor(n / 2);
  // 앞쪽 절반 한 칸과 뒤쪽 절반 한 칸을 출력한다(뒤쪽 칸이 있어야 임시 변수 없이 바꾼 실수가 드러난다)
  const x = rng.int(0, half - 1);
  const y = rng.pick(Array.from({ length: n }, (_, i) => i).filter((i) => i >= n - half && i !== n - 1 - x));
  const j: Expr = bin('-', bin('-', len('a'), num(1)), ref('i'));
  const jShort: Expr = bin('-', bin('-', len('a'), num(2)), ref('i'));
  const swap = (temp: boolean, jj: Expr): Stmt[] =>
    temp ? [decl('t', idx('a', ref('i'))), setIdx('a', ref('i'), '=', idx('a', jj)), setIdx('a', jj, '=', ref('t'))] : [setIdx('a', ref('i'), '=', idx('a', jj)), setIdx('a', jj, '=', idx('a', ref('i')))];
  const build = (o: { full?: boolean; noTemp?: boolean; from1?: boolean; short?: boolean; swapPrint?: boolean } = {}): Program => ({
    funcs: [],
    main: [
      arr('a', a),
      for_('i', o.from1 ? 1 : 0, '<', o.full ? len('a') : bin('/', len('a'), num(2)), swap(!o.noTemp, o.short ? jShort : j)),
      ...(o.swapPrint ? [print(idx('a', num(y))), print(idx('a', num(x)))] : [print(idx('a', num(x))), print(idx('a', num(y)))]),
    ],
  });
  const base = build();
  const mistakes: ProgramMistake[] = [
    { tag: '반복 범위 오류', prog: build({ full: true }) },
    { tag: '반복 범위 오류', prog: flipLoopBound(base) },
    { tag: '값 교환 오류', prog: build({ noTemp: true }) },
    { tag: '인덱스 시작 혼동', prog: build({ from1: true }) },
    { tag: '인덱스 시작 혼동', prog: build({ short: true }) },
    { tag: '구하는 대상 혼동', prog: build({ swapPrint: true }) },
  ];
  const rev = [...a].reverse();
  const steps = () => [
    `i는 0부터 ${n} / 2 = ${half}보다 작을 때까지이므로 a[i]와 a[${n} − 1 − i]를 ${half}번 바꿉니다${n % 2 ? '(가운데 원소는 그대로)' : ''}.`,
    `바꾼 뒤 배열: ${rev.join(', ')}. 따라서 a[${x}] = ${rev[x]}, a[${y}] = ${rev[y]}입니다.`,
  ];
  return { base, mistakes, steps };
}

export const array: Template<string> = {
  id: 'programming.array',
  area: 'programming',
  subtype: '배열 순회',
  difficulties: [1, 2, 3],
  generate(rng, ctx) {
    const v = pickVariant(() => (ctx.difficulty === 1 ? level1(rng) : ctx.difficulty === 2 ? level2(rng) : level3(rng)));
    return programProblem(rng, ctx, v.base, v.mistakes, v.steps);
  },
};
