/**
 * 프로그램 모델 → C·C++·Java·Python 코드.
 * 같은 모델이 네 언어에서 같은 출력을 내도록 문법만 바꾼다(의미는 eval.ts와 같다).
 *  - 출력: C printf("%d\n", x) / C++ std::cout << x << "\n" / Java System.out.println(x) / Python print(x)
 *  - Python: for는 range(...), 나눗셈은 //, &&·||·!는 and·or·not, else if는 elif, x++는 x += 1
 *  - 배열 길이: C·C++은 숫자 그대로, Java a.length, Python len(a)
 */
import type { LanguageId } from '../../../shared/languages.js';
import { checkProgram, hasSwitch, ModelError, type BinOp, type Expr, type Program, type Stmt } from './model.js';

const IND = '    ';

/** 우선순위(클수록 먼저). 네 언어 모두 이 순서가 같다. 비교끼리 섞는 식은 모델이 만들지 않는다. */
const PREC: Record<BinOp, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};
/** 오른쪽에 같은 우선순위의 같은 연산자가 와도 괄호를 뺄 수 있는 연산자. 그 밖에는 오른쪽 같은 우선순위에 괄호를 친다(a - (b - c), a * (b / c)) */
const ASSOC = new Set<BinOp>(['+', '*', '&&', '||']);

export function renderExpr(e: Expr, lang: LanguageId, arrLens: Map<string, number> = new Map()): string {
  const py = lang === 'python';
  const go = (x: Expr, parent = 0, right = false, parentOp?: BinOp): string => {
    switch (x.k) {
      case 'num':
        return String(x.v);
      case 'var':
        return x.name;
      case 'len': {
        if (py) return `len(${x.arr})`;
        if (lang === 'java') return `${x.arr}.length`;
        const n = arrLens.get(x.arr);
        if (n === undefined) throw new ModelError(`배열 길이를 모름 ${x.arr}`);
        return String(n);
      }
      case 'idx':
        return `${x.arr}[${go(x.i)}]`;
      case 'call':
        return `${x.fn}(${x.args.map((a) => go(a)).join(', ')})`;
      case 'not': {
        const inner = go(x.e, 99);
        return py ? `not ${inner.startsWith('(') ? inner : `(${inner})`}` : `!${inner.startsWith('(') ? inner : `(${inner})`}`;
      }
      case 'bin': {
        const p = PREC[x.op];
        const op = py ? (x.op === '&&' ? 'and' : x.op === '||' ? 'or' : x.op === '/' ? '//' : x.op) : x.op;
        const s = `${go(x.a, p, false, x.op)} ${op} ${go(x.b, p, true, x.op)}`;
        const need = p < parent || (p === parent && right && !(parentOp === x.op && ASSOC.has(x.op)));
        return need ? `(${s})` : s;
      }
    }
  };
  return go(e);
}

/** 조건식: C 계열은 괄호 안에 넣으므로 바깥 괄호를 벗긴다 */
const cond = (e: Expr, lang: LanguageId, lens: Map<string, number>) => renderExpr(e, lang, lens);

function pyRange(s: Extract<Stmt, { k: 'for' }>, lens: Map<string, number>): string {
  const up = s.cmp === '<' || s.cmp === '<=';
  const from = renderExpr(s.from, 'python', lens);
  // 끝값: <=는 +1, >=는 -1(range는 끝값을 포함하지 않는다)
  let end: string;
  if (s.cmp === '<' || s.cmp === '>') end = renderExpr(s.to, 'python', lens);
  else if (s.to.k === 'num') end = String(s.to.v + (up ? 1 : -1));
  else end = `${renderExpr(s.to, 'python', lens)} ${up ? '+' : '-'} 1`;
  if (up && s.step === 1) return from === '0' ? `range(${end})` : `range(${from}, ${end})`;
  return `range(${from}, ${end}, ${up ? s.step : -s.step})`;
}

function cFor(s: Extract<Stmt, { k: 'for' }>, lang: LanguageId, lens: Map<string, number>): string {
  const up = s.cmp === '<' || s.cmp === '<=';
  const upd = s.step === 1 ? `${s.v}${up ? '++' : '--'}` : `${s.v} ${up ? '+=' : '-='} ${s.step}`;
  return `for (int ${s.v} = ${renderExpr(s.from, lang, lens)}; ${s.v} ${s.cmp} ${renderExpr(s.to, lang, lens)}; ${upd})`;
}

function printStmt(e: string, lang: LanguageId): string {
  switch (lang) {
    case 'c':
      return `printf("%d\\n", ${e});`;
    case 'cpp':
      return `std::cout << ${e} << "\\n";`;
    case 'java':
      return `System.out.println(${e});`;
    case 'python':
      return `print(${e})`;
  }
}

/** 렌더링한 한 줄과, 그 줄을 만든 모델 조각(문장·if 분기·else 블록·case). 줄 번호 표(lineOf)를 만들 때 쓴다 */
interface Line {
  t: string;
  k?: object;
}

function lines(body: Stmt[], lang: LanguageId, depth: number, lens: Map<string, number>): Line[] {
  return body.flatMap((s) => stmt(s, lang, depth, lens));
}

function stmt(s: Stmt, lang: LanguageId, depth: number, lens: Map<string, number>): Line[] {
  const py = lang === 'python';
  const ind = IND.repeat(depth);
  const semi = py ? '' : ';';
  const E = (e: Expr) => renderExpr(e, lang, lens);
  const one = (t: string, k: object = s): Line[] => [{ t, k }];
  const block = (head: string, body: Stmt[]): Line[] =>
    py ? [{ t: `${ind}${head}:`, k: s }, ...lines(body, lang, depth + 1, lens)] : [{ t: `${ind}${head} {`, k: s }, ...lines(body, lang, depth + 1, lens), { t: `${ind}}` }];
  switch (s.k) {
    case 'decl':
      return one(py ? `${ind}${s.name} = ${E(s.init)}` : `${ind}int ${s.name} = ${E(s.init)};`);
    case 'arr': {
      lens.set(s.name, s.values.length);
      const vals = s.values.join(', ');
      if (py) return one(`${ind}${s.name} = [${vals}]`);
      if (lang === 'java') return one(`${ind}int[] ${s.name} = {${vals}};`);
      return one(`${ind}int ${s.name}[${s.values.length}] = {${vals}};`);
    }
    case 'set':
      return one(`${ind}${s.name} ${s.op} ${E(s.e)}${semi}`);
    case 'setIdx':
      return one(`${ind}${s.arr}[${E(s.i)}] ${s.op} ${E(s.e)}${semi}`);
    case 'inc':
      return one(py ? `${ind}${s.name} ${s.d > 0 ? '+=' : '-='} 1` : `${ind}${s.name}${s.d > 0 ? '++' : '--'};`);
    case 'print':
      return one(ind + printStmt(E(s.e), lang));
    case 'return':
      return one(`${ind}return ${E(s.e)}${semi}`);
    case 'break':
      return one(`${ind}break${semi}`);
    case 'continue':
      return one(`${ind}continue${semi}`);
    case 'while':
      return block(py ? `while ${cond(s.cond, lang, lens)}` : `while (${cond(s.cond, lang, lens)})`, s.body);
    case 'for':
      return block(py ? `for ${s.v} in ${pyRange(s, lens)}` : cFor(s, lang, lens), s.body);
    case 'if': {
      const out: Line[] = [];
      if (py) {
        s.branches.forEach((b, i) => out.push({ t: `${ind}${i === 0 ? 'if' : 'elif'} ${cond(b.cond, lang, lens)}:`, k: b }, ...lines(b.body, lang, depth + 1, lens)));
        if (s.else) out.push({ t: `${ind}else:`, k: s.else }, ...lines(s.else, lang, depth + 1, lens));
        return out;
      }
      s.branches.forEach((b, i) => {
        const head = `if (${cond(b.cond, lang, lens)}) {`;
        if (i === 0) out.push({ t: `${ind}${head}`, k: b });
        else out[out.length - 1] = { t: `${ind}} else ${head}`, k: b };
        out.push(...lines(b.body, lang, depth + 1, lens), { t: `${ind}}` });
      });
      if (s.else) {
        out[out.length - 1] = { t: `${ind}} else {`, k: s.else };
        out.push(...lines(s.else, lang, depth + 1, lens), { t: `${ind}}` });
      }
      return out;
    }
    case 'switch': {
      if (py) throw new ModelError('Python에는 switch가 없음');
      const out: Line[] = [{ t: `${ind}switch (${E(s.e)}) {`, k: s }];
      for (const c of s.cases) {
        out.push({ t: `${ind}${IND}case ${c.v}:`, k: c }, ...lines(c.body, lang, depth + 2, lens));
        // case 끝의 break 줄은 그 case의 본문 배열을 열쇠로 둔다
        if (c.brk) out.push({ t: `${ind}${IND}${IND}break;`, k: c.body });
      }
      if (s.def) out.push({ t: `${ind}${IND}default:`, k: s.def }, ...lines(s.def, lang, depth + 2, lens));
      out.push({ t: `${ind}}` });
      return out;
    }
  }
}

export interface RenderedProgram {
  code: string;
  /**
   * 모델 조각 → 줄 번호(1부터). 문장, for·while 머리, if 분기(branches의 원소), else 블록(배열), switch의 case와 case 끝 break(case.body),
   * default 블록(def 배열), 함수(Func) 머리. 참조 평가기의 추적 기록을 이 번호로 코드와 맞춘다.
   */
  lineOf: Map<object, number>;
}

/** 모델 전체를 한 언어의 완전한 프로그램으로(줄 번호 표 포함) */
export function renderProgramLines(p: Program, lang: LanguageId): RenderedProgram {
  checkProgram(p);
  if (lang === 'python' && hasSwitch(p)) throw new ModelError('Python에는 switch가 없음');
  const lens = new Map<string, number>();
  const fnHead = (f: Program['funcs'][number]) =>
    lang === 'python' ? `def ${f.name}(${f.params.join(', ')})` : `${lang === 'java' ? 'static ' : ''}int ${f.name}(${f.params.map((x) => `int ${x}`).join(', ')})`;
  let out: Line[];
  switch (lang) {
    case 'python':
      out = [];
      for (const f of p.funcs) out.push({ t: `${fnHead(f)}:`, k: f }, ...lines(f.body, lang, 1, lens), { t: '' });
      out.push(...lines(p.main, lang, 0, lens));
      break;
    case 'c':
    case 'cpp':
      out = [{ t: lang === 'c' ? '#include <stdio.h>' : '#include <iostream>' }, { t: '' }];
      for (const f of p.funcs) out.push({ t: `${fnHead(f)} {`, k: f }, ...lines(f.body, lang, 1, lens), { t: '}' }, { t: '' });
      out.push({ t: lang === 'c' ? 'int main(void) {' : 'int main() {' }, ...lines(p.main, lang, 1, lens), { t: `${IND}return 0;` }, { t: '}' });
      break;
    case 'java':
      out = [{ t: 'public class Main {' }];
      for (const f of p.funcs) out.push({ t: `${IND}${fnHead(f)} {`, k: f }, ...lines(f.body, lang, 2, lens), { t: `${IND}}` }, { t: '' });
      out.push({ t: `${IND}public static void main(String[] args) {` }, ...lines(p.main, lang, 2, lens), { t: `${IND}}` }, { t: '}' });
      break;
  }
  const lineOf = new Map<object, number>();
  out.forEach((l, i) => {
    if (l.k && !lineOf.has(l.k)) lineOf.set(l.k, i + 1);
  });
  return { code: out.map((l) => l.t).join('\n'), lineOf };
}

/** 모델 전체를 한 언어의 완전한 프로그램으로 */
export function renderProgram(p: Program, lang: LanguageId): string {
  return renderProgramLines(p, lang).code;
}
