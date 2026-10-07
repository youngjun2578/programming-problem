/**
 * 참조 평가기: 프로그램 모델(model.ts)을 직접 해석해 출력을 구한다.
 * 렌더링한 코드나 사용자 입력을 실행하지 않는다(외부 프로세스, eval 없음).
 *
 * 네 언어의 결과가 같아지는 범위만 허용하고, 벗어나면 EvalError를 던진다. 템플릿은 이 예외를 받으면 다시 뽑는다.
 *  - 정수 범위: 결과가 ±2³¹ 안(부호 있는 정수 오버플로 금지)
 *  - 나눗셈·나머지: 피연산자가 음수거나 0으로 나누면 오류(언어마다 결과가 다르다)
 *  - 배열 범위 밖 접근, 선언하지 않은 변수 읽기, 같은 이름 다시 선언(가림 포함) 금지
 *  - for: 반복 변수를 본문에서 바꾸거나, 끝값(to)이 반복 중에 바뀌면 오류(Python range와 C 계열 for의 차이)
 *  - 출력은 0 이상 정수, 줄 수와 실행 단계 수 제한
 */
import { checkProgram, type Expr, type Func, type Program, type Stmt } from './model.js';

export class EvalError extends Error {}

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

export interface RunOptions {
  /** 출력 줄 수 상한(넘으면 오류). 기본 6 */
  maxLines?: number;
  /** 실행 단계 수 상한. 기본 20,000 */
  maxSteps?: number;
  /** 값이 바뀔 때마다 기록할 변수 이름(해설용, main 안에서만) */
  watch?: string[];
}

export interface RunResult {
  out: number[];
  /** watch 변수의 값 변화(선언 포함) */
  log: { name: string; value: number }[];
}

type Value = number | number[];

class Signal {
  constructor(readonly kind: 'break' | 'continue' | 'return', readonly value = 0) {}
}

function int(n: number): number {
  if (!Number.isInteger(n) || n < INT_MIN || n > INT_MAX) throw new EvalError(`정수 범위를 벗어남: ${n}`);
  return n;
}

export function run(p: Program, opts: RunOptions = {}): RunResult {
  checkProgram(p);
  const maxLines = opts.maxLines ?? 6;
  const maxSteps = opts.maxSteps ?? 20000;
  const watch = new Set(opts.watch ?? []);
  const out: number[] = [];
  const log: RunResult['log'] = [];
  const funcs = new Map<string, Func>(p.funcs.map((f) => [f.name, f]));
  let steps = 0;
  let depth = 0;

  /** 함수 하나의 변수 공간: 블록마다 한 층 */
  class Frame {
    scopes: Map<string, Value>[] = [new Map()];
    constructor(readonly isMain: boolean) {}
    has(name: string) {
      return this.scopes.some((s) => s.has(name));
    }
    get(name: string): Value {
      for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name)!;
      throw new EvalError(`선언하지 않은 변수 ${name}`);
    }
    declare(name: string, v: Value) {
      // 같은 함수 안에서 이름을 다시 쓰지 않는다(C의 재선언 오류, Java의 지역 변수 가림 오류, Python의 덮어쓰기를 모두 피함)
      if (this.has(name) || funcs.has(name)) throw new EvalError(`이름 다시 선언 ${name}`);
      this.scopes[this.scopes.length - 1].set(name, v);
      this.note(name, v);
    }
    assign(name: string, v: number) {
      for (let i = this.scopes.length - 1; i >= 0; i--)
        if (this.scopes[i].has(name)) {
          if (typeof this.scopes[i].get(name) !== 'number') throw new EvalError(`배열에 정수 대입 ${name}`);
          this.scopes[i].set(name, v);
          this.note(name, v);
          return;
        }
      throw new EvalError(`선언하지 않은 변수 ${name}`);
    }
    note(name: string, v: Value) {
      if (this.isMain && watch.has(name) && typeof v === 'number') log.push({ name, value: v });
    }
    block<T>(fn: () => T): T {
      this.scopes.push(new Map());
      try {
        return fn();
      } finally {
        this.scopes.pop();
      }
    }
  }

  const tick = () => {
    if (++steps > maxSteps) throw new EvalError('실행 단계 수 초과');
  };

  function num(f: Frame, e: Expr): number {
    const v = value(f, e);
    if (typeof v !== 'number') throw new EvalError('정수가 아님');
    return v;
  }

  function array(f: Frame, name: string): number[] {
    const v = f.get(name);
    if (!Array.isArray(v)) throw new EvalError(`배열이 아님 ${name}`);
    return v;
  }

  function value(f: Frame, e: Expr): Value {
    tick();
    switch (e.k) {
      case 'num':
        return e.v;
      case 'var':
        return f.get(e.name);
      case 'len':
        return array(f, e.arr).length;
      case 'idx': {
        const a = array(f, e.arr);
        const i = num(f, e.i);
        if (i < 0 || i >= a.length) throw new EvalError(`배열 범위 밖 ${e.arr}[${i}]`);
        return a[i];
      }
      case 'not':
        return truth(f, e.e) ? 0 : 1;
      case 'call':
        return callFn(e.fn, e.args.map((a) => num(f, a)));
      case 'bin': {
        if (e.op === '&&') return truth(f, e.a) && truth(f, e.b) ? 1 : 0;
        if (e.op === '||') return truth(f, e.a) || truth(f, e.b) ? 1 : 0;
        const a = num(f, e.a);
        const b = num(f, e.b);
        switch (e.op) {
          case '+':
            return int(a + b);
          case '-':
            return int(a - b);
          case '*':
            return int(a * b);
          case '/':
          case '%':
            if (a < 0 || b <= 0) throw new EvalError(`음수 또는 0 나눗셈 ${a} ${e.op} ${b}`);
            return e.op === '/' ? Math.trunc(a / b) : a % b;
          case '<':
            return a < b ? 1 : 0;
          case '<=':
            return a <= b ? 1 : 0;
          case '>':
            return a > b ? 1 : 0;
          case '>=':
            return a >= b ? 1 : 0;
          case '==':
            return a === b ? 1 : 0;
          case '!=':
            return a !== b ? 1 : 0;
        }
      }
    }
  }

  const truth = (f: Frame, e: Expr) => num(f, e) !== 0;

  function callFn(name: string, args: number[]): number {
    const fn = funcs.get(name);
    if (!fn) throw new EvalError(`없는 함수 ${name}`);
    if (fn.params.length !== args.length) throw new EvalError(`인자 수가 다름 ${name}`);
    if (++depth > 40) throw new EvalError('재귀 깊이 초과');
    const f = new Frame(false);
    fn.params.forEach((p, i) => f.declare(p, args[i]));
    try {
      execBlock(f, fn.body);
    } catch (s) {
      if (s instanceof Signal && s.kind === 'return') return s.value;
      if (s instanceof Signal) throw new EvalError(`함수 밖으로 나온 ${s.kind}`);
      throw s;
    } finally {
      depth--;
    }
    throw new EvalError(`함수 ${name}가 값을 돌려주지 않음`);
  }

  function apply(op: string, cur: number, v: number): number {
    switch (op) {
      case '=':
        return v;
      case '+=':
        return int(cur + v);
      case '-=':
        return int(cur - v);
      case '*=':
        return int(cur * v);
    }
    throw new EvalError(`모르는 대입 ${op}`);
  }

  function execBlock(f: Frame, body: Stmt[]): void {
    f.block(() => body.forEach((s) => exec(f, s)));
  }

  function exec(f: Frame, s: Stmt): void {
    tick();
    switch (s.k) {
      case 'decl':
        return f.declare(s.name, num(f, s.init));
      case 'arr':
        return f.declare(s.name, s.values.slice());
      case 'set': {
        const cur = s.op === '=' ? 0 : (f.get(s.name) as number);
        return f.assign(s.name, apply(s.op, cur, num(f, s.e)));
      }
      case 'setIdx': {
        const a = array(f, s.arr);
        const i = num(f, s.i);
        if (i < 0 || i >= a.length) throw new EvalError(`배열 범위 밖 ${s.arr}[${i}]`);
        a[i] = apply(s.op, a[i], num(f, s.e));
        return;
      }
      case 'inc':
        return f.assign(s.name, int((f.get(s.name) as number) + s.d));
      case 'print': {
        const v = num(f, s.e);
        if (v < 0) throw new EvalError('음수 출력');
        out.push(v);
        if (out.length > maxLines) throw new EvalError('출력 줄 수 초과');
        return;
      }
      case 'return':
        throw new Signal('return', num(f, s.e));
      case 'break':
        throw new Signal('break');
      case 'continue':
        throw new Signal('continue');
      case 'if': {
        for (const b of s.branches)
          if (truth(f, b.cond)) {
            execBlock(f, b.body);
            return;
          }
        if (s.else) execBlock(f, s.else);
        return;
      }
      case 'while':
        for (;;) {
          tick();
          if (!truth(f, s.cond)) return;
          try {
            execBlock(f, s.body);
          } catch (sig) {
            if (sig instanceof Signal && sig.kind === 'break') return;
            if (sig instanceof Signal && sig.kind === 'continue') continue;
            throw sig;
          }
        }
      case 'for': {
        if (f.has(s.v)) throw new EvalError(`반복 변수 이름이 이미 있음 ${s.v}`);
        const up = s.cmp === '<' || s.cmp === '<=';
        const from = num(f, s.from);
        const to = num(f, s.to);
        const inRange = (i: number) => (s.cmp === '<' ? i < to : s.cmp === '<=' ? i <= to : s.cmp === '>' ? i > to : i >= to);
        f.block(() => {
          f.declare(s.v, from);
          for (let i = from; inRange(i); i = int(i + (up ? s.step : -s.step))) {
            tick();
            f.assign(s.v, i);
            try {
              execBlock(f, s.body);
            } catch (sig) {
              if (sig instanceof Signal && sig.kind === 'break') break;
              if (!(sig instanceof Signal && sig.kind === 'continue')) throw sig;
            }
            if (f.get(s.v) !== i) throw new EvalError(`반복 변수 ${s.v}를 본문에서 바꿈`);
            if (num(f, s.to) !== to) throw new EvalError('반복 끝값이 반복 중에 바뀜');
          }
        });
        return;
      }
      case 'switch': {
        const v = num(f, s.e);
        let start = s.cases.findIndex((c) => c.v === v);
        if (start < 0) {
          if (s.def) f.block(() => s.def!.forEach((x) => exec(f, x)));
          return;
        }
        // case 안에서는 선언을 쓰지 않으므로(정적 검사) switch 전체를 한 블록으로 본다
        f.block(() => {
          for (; start < s.cases.length; start++) {
            s.cases[start].body.forEach((x) => exec(f, x));
            if (s.cases[start].brk) return;
          }
          // 마지막 case까지 break 없이 내려오면 default도 실행한다(default는 맨 뒤에 둔다)
          if (s.def) s.def.forEach((x) => exec(f, x));
        });
        return;
      }
    }
  }

  const main = new Frame(true);
  try {
    execBlock(main, p.main);
  } catch (s) {
    if (s instanceof Signal) throw new EvalError(`main에서 ${s.kind}`);
    throw s;
  }
  if (!out.length) throw new EvalError('출력 없음');
  return { out, log };
}

/** 출력 줄을 보기 표시 문자열로(한 줄에 정수 하나) */
export const outputLabel = (out: number[]) => out.join('\n');
