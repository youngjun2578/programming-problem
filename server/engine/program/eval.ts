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
  /** 해설용 단계별 추적을 남긴다. 남겨도 실행 결과는 같다(상태를 읽기만 하고 복사한다). */
  trace?: boolean;
}

/**
 * 추적 한 단계. node는 그 단계를 만든 모델 조각(문장·if 분기·else 블록·case·함수)으로,
 * 렌더러의 lineOf(render.ts)로 코드 줄 번호를 찾는다.
 */
export interface TraceEvent {
  node: object;
  /** 그 시점에 보이는 변수(지금 함수 안) */
  vars: Record<string, number | number[]>;
  /** 이 단계에서 출력한 값 */
  out?: number;
  /** 사람이 읽을 설명(조건 참·거짓, 반복 끝, 호출·반환 등) */
  note?: string;
  /** 함수 호출 깊이(main = 0) */
  depth: number;
}

export interface RunResult {
  out: number[];
  /** watch 변수의 값 변화(선언 포함) */
  log: { name: string; value: number }[];
  /** trace를 켰을 때만 */
  trace?: TraceEvent[];
}

type Value = number | number[];

class Signal {
  constructor(
    readonly kind: 'break' | 'continue' | 'return',
    readonly value = 0,
    /** return 문(추적에서 줄 번호를 찾는다) */
    readonly node?: object,
  ) {}
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
  const trace: TraceEvent[] | undefined = opts.trace ? [] : undefined;

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
    /** 지금 보이는 변수의 복사본(안쪽 블록이 바깥 이름을 가리지 않으므로 그대로 합친다) */
    snapshot(): Record<string, number | number[]> {
      const o: Record<string, number | number[]> = {};
      for (const sc of this.scopes) for (const [k, v] of sc) o[k] = Array.isArray(v) ? v.slice() : v;
      return o;
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

  /** 추적 한 단계 남기기(trace가 꺼져 있으면 아무것도 하지 않는다) */
  const rec = (f: Frame, node: object, extra: { out?: number; note?: string } = {}) => {
    if (trace) trace.push({ node, vars: f.snapshot(), depth, ...extra });
  };

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
    const callText = `${name}(${args.join(', ')})`;
    rec(f, fn, { note: `${callText} 호출` });
    try {
      execBlock(f, fn.body);
    } catch (s) {
      if (s instanceof Signal && s.kind === 'return') {
        rec(f, s.node!, { note: `${callText} = ${s.value} 반환` });
        return s.value;
      }
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
        f.declare(s.name, num(f, s.init));
        return rec(f, s);
      case 'arr':
        f.declare(s.name, s.values.slice());
        return rec(f, s);
      case 'set': {
        const cur = s.op === '=' ? 0 : (f.get(s.name) as number);
        f.assign(s.name, apply(s.op, cur, num(f, s.e)));
        return rec(f, s);
      }
      case 'setIdx': {
        const a = array(f, s.arr);
        const i = num(f, s.i);
        if (i < 0 || i >= a.length) throw new EvalError(`배열 범위 밖 ${s.arr}[${i}]`);
        a[i] = apply(s.op, a[i], num(f, s.e));
        return rec(f, s);
      }
      case 'inc':
        f.assign(s.name, int((f.get(s.name) as number) + s.d));
        return rec(f, s);
      case 'print': {
        const v = num(f, s.e);
        if (v < 0) throw new EvalError('음수 출력');
        out.push(v);
        if (out.length > maxLines) throw new EvalError('출력 줄 수 초과');
        return rec(f, s, { out: v });
      }
      case 'return':
        throw new Signal('return', num(f, s.e), s);
      case 'break':
        rec(f, s, { note: 'break → 반복을 끝냄' });
        throw new Signal('break');
      case 'continue':
        rec(f, s, { note: 'continue → 다음 회차로' });
        throw new Signal('continue');
      case 'if': {
        for (const b of s.branches) {
          const t = truth(f, b.cond);
          rec(f, b, { note: t ? '조건 참' : '조건 거짓' });
          if (t) {
            execBlock(f, b.body);
            return;
          }
        }
        if (s.else) {
          rec(f, s.else, { note: 'else 실행' });
          execBlock(f, s.else);
        }
        return;
      }
      case 'while':
        for (;;) {
          tick();
          const t = truth(f, s.cond);
          rec(f, s, { note: t ? '조건 참' : '조건 거짓 → 반복 끝' });
          if (!t) return;
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
          let i = from;
          for (; inRange(i); i = int(i + (up ? s.step : -s.step))) {
            tick();
            f.assign(s.v, i);
            rec(f, s, { note: `${s.v} = ${i}` });
            try {
              execBlock(f, s.body);
            } catch (sig) {
              if (sig instanceof Signal && sig.kind === 'break') break;
              if (!(sig instanceof Signal && sig.kind === 'continue')) throw sig;
            }
            if (f.get(s.v) !== i) throw new EvalError(`반복 변수 ${s.v}를 본문에서 바꿈`);
            if (num(f, s.to) !== to) throw new EvalError('반복 끝값이 반복 중에 바뀜');
          }
          // 조건이 거짓이 되어 끝났을 때만(break로 끝나면 위에서 이미 기록)
          if (!inRange(i)) rec(f, s, { note: `${s.v}의 다음 값(${i})은 범위 밖 → 반복 끝` });
        });
        return;
      }
      case 'switch': {
        const v = num(f, s.e);
        let start = s.cases.findIndex((c) => c.v === v);
        if (start < 0) {
          if (s.def) {
            rec(f, s.def, { note: `맞는 case 없음 → default` });
            f.block(() => s.def!.forEach((x) => exec(f, x)));
          }
          return;
        }
        // case 안에서는 선언을 쓰지 않으므로(정적 검사) switch 전체를 한 블록으로 본다
        f.block(() => {
          const first = start;
          for (; start < s.cases.length; start++) {
            rec(f, s.cases[start], { note: start === first ? `case ${v} 일치` : 'break 없음 → 이어서 실행' });
            s.cases[start].body.forEach((x) => exec(f, x));
            if (s.cases[start].brk) {
              rec(f, s.cases[start].body, { note: 'break → switch를 나감' });
              return;
            }
          }
          // 마지막 case까지 break 없이 내려오면 default도 실행한다(default는 맨 뒤에 둔다)
          if (s.def) {
            rec(f, s.def, { note: 'break 없음 → default까지 실행' });
            s.def.forEach((x) => exec(f, x));
          }
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
  return trace ? { out, log, trace } : { out, log };
}

/** 출력 줄을 보기 표시 문자열로(한 줄에 정수 하나) */
export const outputLabel = (out: number[]) => out.join('\n');
