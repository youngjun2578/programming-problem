/**
 * 본문(예제 밖)에 적은 숫자 검산. 글에 아래 문장이 그대로 있어야 하고, 계산이 맞아야 한다.
 * 예제의 정답과 중간 숫자는 examples.ts가 따로 검산한다.
 */
import { buildExample } from './examples.js';

/** 예제 문제 문장에 parts가 모두 들어 있는지 (검산 항목에서 예제 숫자를 확인할 때 쓴다) */
export const exampleHas = (id: string, seed: number, ...parts: string[]) => {
  const t = buildExample(id, seed).problem.text;
  return parts.every((p) => t.includes(p));
};

// 가이드 글이 없어 검산 항목도 없다. 글을 쓰면 { slug, text: '본문 문장', ok: () => 계산 } 형식으로 추가한다.
export const CLAIMS: { slug: string; text: string; ok: () => boolean }[] = [];
