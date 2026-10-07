/**
 * 임시 샘플: 반복문 출력 맞히기. 화면·서버·채점이 끊기지 않게 하려고 둔 문항이며 실제 문제 템플릿으로 바꿀 예정이다.
 * 언어(C·C++·Python·Java) 하나를 골라 "범위 안에서 K의 배수만 더해 출력"하는 코드를 보여 주고 출력값을 묻는다.
 */
import type { Template, Wrong } from '../../engine/types.js';
import type { Rng } from '../../engine/rng.js';
import { nearBy } from '../../engine/choices.js';
import { LANGUAGES, type LanguageId } from '../../areas.js';

interface Loop {
  start: number;
  /** 코드에 적힌 끝값 */
  end: number;
  /** true면 끝값을 포함하지 않는다(i < end, range(start, end)) */
  exclusive: boolean;
  k: number;
}

function code(lang: LanguageId, l: Loop): string {
  const cmp = l.exclusive ? '<' : '<=';
  const cLoop = (indent: string, v: string) =>
    [
      `${indent}int ${v} = 0;`,
      `${indent}for (int i = ${l.start}; i ${cmp} ${l.end}; i++) {`,
      `${indent}    if (i % ${l.k} == 0) {`,
      `${indent}        ${v} += i;`,
      `${indent}    }`,
      `${indent}}`,
    ];
  switch (lang) {
    case 'c':
      return ['#include <stdio.h>', '', 'int main(void) {', ...cLoop('    ', 'sum'), '    printf("%d\\n", sum);', '    return 0;', '}'].join('\n');
    case 'cpp':
      return ['#include <iostream>', '', 'int main() {', ...cLoop('    ', 'sum'), '    std::cout << sum << std::endl;', '    return 0;', '}'].join('\n');
    case 'java':
      return ['public class Main {', '    public static void main(String[] args) {', ...cLoop('        ', 'sum'), '        System.out.println(sum);', '    }', '}'].join('\n');
    case 'python':
      return [
        'total = 0',
        `for i in range(${l.start}, ${l.exclusive ? l.end : `${l.end} + 1`}):`,
        `    if i % ${l.k} == 0:`,
        '        total += i',
        'print(total)',
      ].join('\n');
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const loopOutput: Template<number> = {
  id: 'programming.loopOutput',
  area: 'programming',
  subtype: '반복문 출력',
  difficulty: 1,
  generate(rng: Rng) {
    const lang = rng.pick(LANGUAGES);
    const k = rng.int(2, 5);
    // 시작값과 끝값을 모두 k의 배수로 두어, 범위 실수(시작·끝 포함 여부)가 항상 다른 값이 되게 한다
    const start = k * rng.int(1, 3);
    const end = start + k * rng.int(3, 6);
    const exclusive = rng.chance(0.5);
    const last = exclusive ? end - 1 : end;
    const all = range(start, last);
    const picked = all.filter((i) => i % k === 0);
    const answer = sum(picked);

    const wrongs: Wrong<number>[] = [
      { value: exclusive ? answer + end : answer - end, mistakeTag: '반복 범위 오류' },
      { value: answer - start, mistakeTag: '반복 범위 오류' },
      { value: sum(all), mistakeTag: '조건 누락' },
      { value: sum(all) - answer, mistakeTag: '조건 반전' },
      { value: picked.length, mistakeTag: '구하는 대상 혼동' },
    ];
    const text = rng.pick([
      `다음 ${lang.name} 코드를 실행했을 때 출력되는 값은?`,
      `아래 ${lang.name} 프로그램의 실행 결과로 옳은 것은?`,
      `다음 ${lang.name} 코드가 출력하는 수는 무엇인가?`,
    ]);
    return {
      text,
      answer,
      wrongs,
      steps: [
        `i는 ${start}부터 ${last}까지 1씩 커집니다(끝값 ${end}${exclusive ? '는 포함하지 않음' : '까지 포함'}).`,
        `i % ${k} == 0일 때만 더하므로 ${k}의 배수만 더합니다: ${picked.join(', ')}.`,
        `합 = ${picked.join(' + ')} = ${answer}. 따라서 출력되는 값은 ${answer}입니다.`,
      ],
      format: (v) => String(v),
      figure: { kind: 'code', lang: lang.name, code: code(lang.id, { start, end, exclusive, k }) },
      near: nearBy(answer, k),
    };
  },
};
