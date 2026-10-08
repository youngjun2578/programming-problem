/**
 * 참조 평가기의 추적 기록(eval.ts의 TraceEvent) → 해설 추적표(shared/api.ts의 TraceView).
 *  - 실행한 줄은 렌더러의 줄 번호 표(render.ts의 lineOf)로 찾는다. 그래서 고른 언어의 코드 줄 번호와 맞는다.
 *  - 변수 값은 그 단계를 실행한 뒤의 값("sum = 3, i = 2", 배열은 "a = [1, 2, 3]")
 *  - 길면(TRACE_MAX_ROWS 초과) 앞 TRACE_HEAD행과 뒤 TRACE_TAIL행만 남기고 가운데를 { omitted }로 줄인다.
 *    상한 12행: 좁은 화면(높이 740px)에서 표 머리와 함께 한 화면 남짓에 들어오는 양이고,
 *    앞쪽(처음 몇 회차의 규칙)과 뒤쪽(마지막 회차와 출력)이 정답을 확인하는 데 필요한 부분이기 때문이다(docs/engine-design.md 10절).
 */
import type { TraceRow, TraceView } from '../../../shared/api.js';
import type { TraceEvent } from './eval.js';

export const TRACE_MAX_ROWS = 12;
export const TRACE_HEAD = 6;
export const TRACE_TAIL = 5;

const fmtVars = (v: TraceEvent['vars']) =>
  Object.entries(v)
    .map(([k, x]) => `${k} = ${Array.isArray(x) ? `[${x.join(', ')}]` : x}`)
    .join(', ');

export function traceRows(events: TraceEvent[], lineOf: Map<object, number>): TraceRow[] {
  return events.map((e, i) => {
    const line = lineOf.get(e.node);
    if (line === undefined) throw new Error('추적 단계의 줄 번호를 찾지 못함');
    return { step: i + 1, line, depth: e.depth, vars: fmtVars(e.vars), out: e.out === undefined ? '' : String(e.out), note: e.note ?? '' };
  });
}

/** 추적표(길면 줄임) */
export function traceView(events: TraceEvent[], lineOf: Map<object, number>): TraceView {
  const rows = traceRows(events, lineOf);
  if (rows.length <= TRACE_MAX_ROWS) return { rows, total: rows.length };
  return { rows: [...rows.slice(0, TRACE_HEAD), { omitted: rows.length - TRACE_HEAD - TRACE_TAIL }, ...rows.slice(-TRACE_TAIL)], total: rows.length };
}

/** 추적에서 출력된 값을 차례로(검증용: 정답 출력과 같아야 한다) */
export const traceOutput = (events: TraceEvent[]) => events.filter((e) => e.out !== undefined).map((e) => e.out!);
