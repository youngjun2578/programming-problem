/**
 * 작은 프로그램 모델. 프로그래밍 템플릿은 시드로 이 모델을 만들고,
 *  - render.ts가 C·C++·Java·Python 코드로 바꿔 보여 주고
 *  - eval.ts(참조 평가기)가 모델을 직접 해석해 정답 출력을 구한다.
 * 실제 코드를 실행하지 않는다. 언어마다 결과가 같도록 쓸 수 있는 구조만 모델에 둔다(docs/engine-design.md 5절).
 *
 * 값은 모두 정수(배열은 정수 배열). 조건식(비교·논리)은 if·while·for 조건에만 쓴다.
 */

export type ArithOp = '+' | '-' | '*' | '/' | '%';
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type LogicOp = '&&' | '||';
export type BinOp = ArithOp | CmpOp | LogicOp;

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'bin'; op: BinOp; a: Expr; b: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'idx'; arr: string; i: Expr }
  | { k: 'len'; arr: string }
  | { k: 'call'; fn: string; args: Expr[] };

export type AssignOp = '=' | '+=' | '-=' | '*=';

export type Stmt =
  /** int name = init; */
  | { k: 'decl'; name: string; init: Expr }
  /** int name[] = {values}; */
  | { k: 'arr'; name: string; values: number[] }
  | { k: 'set'; name: string; op: AssignOp; e: Expr }
  | { k: 'setIdx'; arr: string; i: Expr; op: AssignOp; e: Expr }
  /** name++; / name--; (식 안에서는 쓰지 않는다) */
  | { k: 'inc'; name: string; d: 1 | -1 }
  | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; else?: Stmt[] }
  /**
   * 세는 반복. cmp가 < 또는 <=면 step씩 커지고, > 또는 >=면 step씩 작아진다(step은 양수).
   * 반복 변수는 반복 안에서만 쓰고 본문에서 바꾸지 않는다. to는 반복 중에 바뀌지 않아야 한다.
   */
  | { k: 'for'; v: string; from: Expr; to: Expr; cmp: '<' | '<=' | '>' | '>='; step: number; body: Stmt[] }
  | { k: 'while'; cond: Expr; body: Stmt[] }
  /** C·C++·Java 전용. brk가 false면 다음 case로 이어진다(fall-through). */
  | { k: 'switch'; e: Expr; cases: { v: number; body: Stmt[]; brk: boolean }[]; def?: Stmt[] }
  | { k: 'break' }
  | { k: 'continue' }
  /** 정수 하나를 한 줄로 출력 */
  | { k: 'print'; e: Expr }
  | { k: 'return'; e: Expr };

export interface Func {
  name: string;
  params: string[];
  body: Stmt[];
}

export interface Program {
  /** main보다 먼저 정의하는 함수(정수 매개변수, 정수 반환) */
  funcs: Func[];
  main: Stmt[];
}

/* ---------- 만들기 도우미 ---------- */

export const num = (v: number): Expr => ({ k: 'num', v });
export const ref = (name: string): Expr => ({ k: 'var', name });
export const bin = (op: BinOp, a: Expr, b: Expr): Expr => ({ k: 'bin', op, a, b });
export const not = (e: Expr): Expr => ({ k: 'not', e });
export const idx = (arr: string, i: Expr): Expr => ({ k: 'idx', arr, i });
export const len = (arr: string): Expr => ({ k: 'len', arr });
export const call = (fn: string, ...args: Expr[]): Expr => ({ k: 'call', fn, args });

export const decl = (name: string, init: Expr | number): Stmt => ({ k: 'decl', name, init: typeof init === 'number' ? num(init) : init });
export const arr = (name: string, values: number[]): Stmt => ({ k: 'arr', name, values });
export const set = (name: string, op: AssignOp, e: Expr | number): Stmt => ({ k: 'set', name, op, e: typeof e === 'number' ? num(e) : e });
export const setIdx = (a: string, i: Expr, op: AssignOp, e: Expr): Stmt => ({ k: 'setIdx', arr: a, i, op, e });
export const inc = (name: string, d: 1 | -1 = 1): Stmt => ({ k: 'inc', name, d });
export const if_ = (cond: Expr, body: Stmt[], elseBody?: Stmt[]): Stmt => ({ k: 'if', branches: [{ cond, body }], ...(elseBody ? { else: elseBody } : {}) });
export const ifChain = (branches: { cond: Expr; body: Stmt[] }[], elseBody?: Stmt[]): Stmt => ({ k: 'if', branches, ...(elseBody ? { else: elseBody } : {}) });
export const for_ = (v: string, from: Expr | number, cmp: '<' | '<=' | '>' | '>=', to: Expr | number, body: Stmt[], step = 1): Stmt => ({
  k: 'for',
  v,
  from: typeof from === 'number' ? num(from) : from,
  to: typeof to === 'number' ? num(to) : to,
  cmp,
  step,
  body,
});
export const while_ = (cond: Expr, body: Stmt[]): Stmt => ({ k: 'while', cond, body });
export const print = (e: Expr | string): Stmt => ({ k: 'print', e: typeof e === 'string' ? ref(e) : e });
export const ret = (e: Expr): Stmt => ({ k: 'return', e });
export const brk: Stmt = { k: 'break' };
export const cont: Stmt = { k: 'continue' };

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/* ---------- 정적 검사: 네 언어에서 모두 컴파일·실행되는 모양인지 ---------- */

export class ModelError extends Error {}

const isCmp = (op: BinOp): op is CmpOp => ['<', '<=', '>', '>=', '==', '!='].includes(op);
const isLogic = (op: BinOp): op is LogicOp => op === '&&' || op === '||';

/** 식의 종류: 정수인지 조건(참/거짓)인지 */
export function exprType(e: Expr): 'int' | 'bool' {
  if (e.k === 'not') return 'bool';
  if (e.k === 'bin') return isCmp(e.op) || isLogic(e.op) ? 'bool' : 'int';
  return 'int';
}

function checkExpr(e: Expr, want: 'int' | 'bool'): void {
  const t = exprType(e);
  if (t !== want) throw new ModelError(`식의 종류가 ${want}이어야 함`);
  switch (e.k) {
    case 'num':
      if (!Number.isInteger(e.v) || e.v < 0) throw new ModelError(`정수 상수는 0 이상: ${e.v}`);
      return;
    case 'not':
      return checkExpr(e.e, 'bool');
    case 'bin':
      if (isLogic(e.op)) {
        checkExpr(e.a, 'bool');
        checkExpr(e.b, 'bool');
      } else {
        // 비교·산술의 피연산자는 정수(Python의 비교 연결 a < b < c 같은 모양이 생기지 않는다)
        checkExpr(e.a, 'int');
        checkExpr(e.b, 'int');
      }
      return;
    case 'idx':
      return checkExpr(e.i, 'int');
    case 'call':
      return e.args.forEach((a) => checkExpr(a, 'int'));
    default:
      return;
  }
}

/**
 * 블록 검사
 *  - 빈 블록 금지(Python은 pass가 필요하다)
 *  - break·continue·return 뒤에 같은 블록의 문장 금지(Java는 도달할 수 없는 코드를 컴파일 오류로 본다)
 *  - switch의 case 안 선언 금지(C는 label 바로 뒤 선언을 허용하지 않는다)
 */
function checkBlock(body: Stmt[], ctx: { inLoop: boolean; inSwitch: boolean; inFunc: boolean; inCase: boolean }): void {
  if (!body.length) throw new ModelError('빈 블록');
  body.forEach((s, i) => {
    if ((s.k === 'break' || s.k === 'continue' || s.k === 'return') && i !== body.length - 1) throw new ModelError(`${s.k} 뒤에 문장이 있음`);
    checkStmt(s, ctx);
  });
}

function checkStmt(s: Stmt, ctx: { inLoop: boolean; inSwitch: boolean; inFunc: boolean; inCase: boolean }): void {
  switch (s.k) {
    case 'decl':
      if (ctx.inCase) throw new ModelError('case 안의 선언');
      return checkExpr(s.init, 'int');
    case 'arr':
      if (ctx.inCase) throw new ModelError('case 안의 선언');
      if (!s.values.length || s.values.some((v) => !Number.isInteger(v) || v < 0)) throw new ModelError('배열 값은 0 이상 정수');
      return;
    case 'set':
      return checkExpr(s.e, 'int');
    case 'setIdx':
      checkExpr(s.i, 'int');
      return checkExpr(s.e, 'int');
    case 'inc':
      return;
    case 'if':
      if (!s.branches.length) throw new ModelError('if 분기 없음');
      s.branches.forEach((b) => {
        checkExpr(b.cond, 'bool');
        checkBlock(b.body, { ...ctx, inCase: false });
      });
      if (s.else) checkBlock(s.else, { ...ctx, inCase: false });
      return;
    case 'for':
      if (!Number.isInteger(s.step) || s.step < 1) throw new ModelError('for step은 1 이상');
      checkExpr(s.from, 'int');
      checkExpr(s.to, 'int');
      return checkBlock(s.body, { ...ctx, inLoop: true, inSwitch: false, inCase: false });
    case 'while':
      checkExpr(s.cond, 'bool');
      return checkBlock(s.body, { ...ctx, inLoop: true, inSwitch: false, inCase: false });
    case 'switch':
      checkExpr(s.e, 'int');
      if (new Set(s.cases.map((c) => c.v)).size !== s.cases.length) throw new ModelError('case 값 중복');
      s.cases.forEach((c) => {
        if (!c.body.length) throw new ModelError('빈 case');
        c.body.forEach((x) => {
          if (x.k === 'break' || x.k === 'continue' || x.k === 'return') throw new ModelError('case 본문 안의 break·continue·return은 brk로만');
          checkStmt(x, { ...ctx, inSwitch: true, inCase: true });
        });
      });
      if (s.def) s.def.forEach((x) => checkStmt(x, { ...ctx, inSwitch: true, inCase: true }));
      return;
    case 'break':
    case 'continue':
      if (!ctx.inLoop) throw new ModelError(`반복 밖의 ${s.k}`);
      return;
    case 'print':
      return checkExpr(s.e, 'int');
    case 'return':
      if (!ctx.inFunc) throw new ModelError('함수 밖의 return');
      return checkExpr(s.e, 'int');
  }
}

/** 마지막 문장이 return인가(모든 경로가 값을 돌려주는지 Java가 컴파일 때 확인한다) */
function endsWithReturn(body: Stmt[]): boolean {
  const last = body[body.length - 1];
  if (!last) return false;
  if (last.k === 'return') return true;
  if (last.k === 'if' && last.else) return last.branches.every((b) => endsWithReturn(b.body)) && endsWithReturn(last.else);
  return false;
}

export function checkProgram(p: Program): void {
  const names = new Set<string>();
  for (const f of p.funcs) {
    if (names.has(f.name)) throw new ModelError(`함수 이름 중복 ${f.name}`);
    names.add(f.name);
    checkBlock(f.body, { inLoop: false, inSwitch: false, inFunc: true, inCase: false });
    if (!endsWithReturn(f.body)) throw new ModelError(`함수 ${f.name}의 마지막이 return이 아님`);
  }
  checkBlock(p.main, { inLoop: false, inSwitch: false, inFunc: false, inCase: false });
}

/** 모델 안에 switch가 있는가(Python에서는 쓸 수 없다) */
export function hasSwitch(p: Program): boolean {
  const walk = (b: Stmt[]): boolean =>
    b.some((s) =>
      s.k === 'switch'
        ? true
        : s.k === 'if'
          ? s.branches.some((x) => walk(x.body)) || (s.else ? walk(s.else) : false)
          : s.k === 'for' || s.k === 'while'
            ? walk(s.body)
            : false,
    );
  return walk(p.main) || p.funcs.some((f) => walk(f.body));
}
