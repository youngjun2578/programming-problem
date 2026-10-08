/**
 * 진단 세트 생성과 채점·리포트. HTTP와 무관한 순수 로직이라 골든 스냅샷 비교에서도 그대로 쓴다.
 */
import { TEMPLATES } from './registry.js';
import { AREAS, AREA_BY_ID } from './areas.js';
import { generateSet } from './engine/set.js';
import type { Difficulty, Problem } from './engine/types.js';
import { analyze, LEVEL_LABEL, type Report } from './report/analyze.js';
import type { Explanation, PublicChoice, PublicQuestion, ReportResponse } from '../shared/api.js';
import { FREE_EXPLANATION_COUNT } from '../shared/product.js';
import { reasonFor } from './engine/reasons.js';
import type { DiagnosisLevel } from '../shared/api.js';
import { languageName, type LanguageId } from '../shared/languages.js';

/** 영역별 문항 수. 세트는 영역 안에서 서로 다른 유형만 고르므로 영역의 유형 수보다 클 수 없다(지금 영역마다 4유형). */
export const PER_AREA = 3;

/** 영역 안 문항 자리별 난이도(docs/engine-design.md 3절). 기본 1·1·2, 심화 2·2·3 */
export const SLOT_DIFFICULTY: Record<DiagnosisLevel, readonly Difficulty[]> = { basic: [1, 1, 2], advanced: [2, 2, 3] };
const AREA_IDS = AREAS.filter((a) => TEMPLATES.some((t) => t.area === a.id)).map((a) => a.id);
/** 영역의 문항 수: PER_AREA와 그 영역 유형 수 가운데 작은 값(유형이 모자란 영역은 있는 만큼만) */
export const areaQuestionCount = (area: (typeof AREA_IDS)[number]) => Math.min(PER_AREA, new Set(TEMPLATES.filter((t) => t.area === area).map((t) => t.subtype)).size);
export const QUESTION_COUNT = AREA_IDS.reduce((n, a) => n + areaQuestionCount(a), 0);

/**
 * level을 주지 않으면 기본 세트. 심화(서버 스위치 ADVANCED_LEVEL_ENABLED가 켜졌을 때만)는 같은 템플릿을 더 높은 난이도로 만든다.
 * 생성 시드도 따로라(server/token.ts의 generationSeed) 같은 공개 시드에서도 다른 문항이 나온다. 문항 수는 기본과 같다.
 */
export function generateQuestions(genSeed: number, lang: LanguageId, level: DiagnosisLevel = 'basic'): Problem[] {
  return generateSet(TEMPLATES, genSeed, { areas: AREA_IDS, perArea: PER_AREA, lang, difficulties: SLOT_DIFFICULTY[level] });
}

/** 보기에서 정답 여부·실수 유형을 빼고 표시용 값만 남긴다 */
function publicChoices(p: Problem): PublicChoice[] {
  return p.choices.map((c) => (c.chart ? { label: c.label, chart: c.chart } : { label: c.label }));
}

/** 풀이 화면용 문항. 필요한 필드만 골라 담는다(정답·해설·템플릿 정보는 넣지 않는다). */
export function toPublicQuestion(p: Problem): PublicQuestion {
  const q: PublicQuestion = { area: p.area, areaName: AREA_BY_ID[p.area].name, text: p.text, choices: publicChoices(p) };
  if (p.figure) q.figure = p.figure;
  return q;
}

/** 채점과 분석 결과 전체 (서버 안에서만 쓴다) */
export interface FullResult {
  qs: Problem[];
  answers: number[];
  report: Report;
  /** 사용자가 고른 프로그래밍 언어 */
  lang: LanguageId;
  /** 심화일 때만 'advanced' (기본은 없음: 이전과 같은 응답) */
  level?: 'advanced';
}

export function score(qs: Problem[], answers: number[], secs: number[], lang: LanguageId, level: DiagnosisLevel = 'basic'): FullResult {
  const attempts = answers.map((picked, i) => ({ picked, sec: secs[i] }));
  // 총 풀이 시간 = 문항별 시간 합의 반올림 (이전 브라우저 계산과 같은 기준)
  const totalSec = Math.round(secs.reduce((a, b) => a + b, 0));
  // 심화도 판정 규칙과 영역 메타(권장 시간·학습 순서)는 기본과 같다. 응답에 심화 표시만 붙인다.
  if (level === 'advanced') return { qs, answers, report: analyze(qs, attempts, totalSec), lang, level: 'advanced' };
  return { qs, answers, report: analyze(qs, attempts, totalSec), lang };
}

const pct = (r: number) => Math.round(r * 100);

/** 보기마다 그 값이 나오는 이유(정답은 null). 프로그래밍 문항은 고른 언어의 문구, SQL은 SQL 문구 */
export function choiceReasons(q: Problem, lang: LanguageId): (string | null)[] {
  return q.choices.map((c) => (c.mistakeTag === null ? null : reasonFor(c.mistakeTag, q.area === 'sql' ? 'sql' : lang)));
}

function explanation(q: Problem, picked: number, lang: LanguageId): Explanation {
  const isCorrect = picked === q.answerIndex;
  const e: Explanation = {
    areaName: AREA_BY_ID[q.area].name,
    subtype: q.subtype,
    text: q.text,
    choices: publicChoices(q),
    picked,
    answerIndex: q.answerIndex,
    isCorrect,
    pickedMistakeTag: isCorrect ? null : (q.choices[picked]?.mistakeTag ?? null),
    steps: q.steps,
    choiceReasons: choiceReasons(q, lang),
  };
  if (q.figure) e.figure = q.figure;
  if (q.detail) e.detail = q.detail;
  return e;
}

/**
 * 응답에 담을 범위.
 *  - undefined: 기능 스위치 꺼짐. 이전과 똑같이 전체를 돌려주고 gated 필드도 넣지 않는다.
 *  - 'full': 이용권 있음. 전체 + gated: false
 *  - 'free': 게스트·이용권 없음. 요약 + 해설 1·2번만 + gated: true
 */
export type ReportScope = 'full' | 'free' | undefined;

/**
 * 응답을 만드는 유일한 지점. 무료 응답은 여기서 구역을 잘라 내며,
 * 잘린 내용(영역별 상세 문구, 3번 이후 해설)은 응답 본문에 아예 들어가지 않는다.
 */
export function composeReportResponse(full: FullResult, scope?: ReportScope): ReportResponse {
  const all = composeAll(full);
  if (scope === undefined) return all;
  if (scope === 'full') return { gated: false, ...all };
  return {
    gated: true,
    meta: all.meta,
    summary: all.summary,
    areaDetails: [],
    explanations: all.explanations.slice(0, FREE_EXPLANATION_COUNT),
  };
}

function composeAll(full: FullResult): ReportResponse {
  const { qs, answers, report: r } = full;
  return {
    meta: {
      total: r.total,
      correct: r.correct,
      totalSec: r.totalSec,
      perArea: r.areas[0]?.total ?? 0,
      language: { id: full.lang, name: languageName(full.lang) },
      ...(full.level === 'advanced' ? { level: 'advanced' as const } : {}),
    },
    summary: r.areas.map((a) => ({
      areaId: a.meta.id,
      name: a.meta.name,
      correct: a.correct,
      total: a.total,
      ratePct: pct(a.rate),
      avgSec: a.avgSec,
      level: a.level,
      levelLabel: LEVEL_LABEL[a.level],
    })),
    areaDetails: r.areas.map((a) => ({
      areaId: a.meta.id,
      description: a.meta.description,
      correct: a.correct,
      total: a.total,
      ratePct: pct(a.rate),
      avgSec: a.avgSec,
      targetSec: a.meta.targetSec,
      weakSubtypes: a.weakSubtypes,
      levelReason: a.levelReason,
      patterns: a.patterns.map((p) => ({ tag: p.tag, count: p.count, text: p.text })),
    })),
    explanations: qs.map((q, i) => explanation(q, answers[i], full.lang)),
  };
}
