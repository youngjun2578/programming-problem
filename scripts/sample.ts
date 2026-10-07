/** 템플릿별 예시 출력: npx tsx scripts/sample.ts [템플릿id 접두어] [개수] [언어(c|cpp|python|java, 기본 python)] [난이도(1~3, 기본 1)] */
import { TEMPLATES } from '../server/registry.js';
import { Rng } from '../server/engine/rng.js';
import { makeProblem } from '../server/engine/set.js';
import { availableFor } from '../server/engine/types.js';
import { isLanguageId } from '../shared/languages.js';

const [prefix = '', count = '2', langArg = 'python', diffArg = '1'] = process.argv.slice(2);
const difficulty = Number(diffArg) as 1 | 2 | 3;
if (!isLanguageId(langArg)) throw new Error(`언어는 c, cpp, python, java 가운데 하나: ${langArg}`);
const lang = langArg;
for (const t of TEMPLATES.filter((t) => t.id.startsWith(prefix) && availableFor(t, lang))) {
  for (let i = 0; i < Number(count); i++) {
    const p = makeProblem(t, new Rng(Date.now() + i * 101), { lang, difficulty: difficulty });
    console.log(`\n[${t.id}] ${p.text}`);
    if (p.figure?.kind === 'code') {
      if (p.figure.table) console.log('  (표)', JSON.stringify(p.figure.table));
      console.log(`  (${p.figure.lang} 코드)\n` + p.figure.code.replace(/^/gm, '    | '));
    } else if (p.figure) console.log('  (도표)', JSON.stringify(p.figure.kind === 'chart' ? p.figure.spec : p.figure.table));
    p.choices.forEach((c, k) => console.log(`  ${k === p.answerIndex ? '*' : ' '} ${c.label}${c.mistakeTag ? `  ← ${c.mistakeTag}` : ''}`));
    p.steps.forEach((s) => console.log('    · ' + s));
  }
}
