/**
 * 브라우저와 서버(api/)가 주고받는 데이터 모양.
 * 타입만 있으므로 브라우저 번들에는 아무것도 들어가지 않는다.
 */
import type { ChartSpec, Figure, TableSpec } from './charts/types.js';
import type { LanguageId } from './languages.js';

export type AreaId = 'programming' | 'sql';
export type Level = 'stable' | 'improve' | 'focus';

/** 풀이 화면에 보이는 보기. 정답 여부나 실수 유형은 담지 않는다. */
export interface PublicChoice {
  label: string;
  chart?: ChartSpec;
}

/** 풀이 화면에 보이는 문항. 정답·해설·유형 이름은 담지 않는다. */
export interface PublicQuestion {
  area: AreaId;
  areaName: string;
  text: string;
  figure?: Figure;
  choices: PublicChoice[];
}

/** POST /api/session 응답 */
/** 진단 수준. basic이 이전부터 있던 진단, advanced는 심화(서버 스위치가 켜졌을 때만). */
export type DiagnosisLevel = 'basic' | 'advanced';

/** POST /api/session 요청 본문. lang(프로그래밍 언어)은 꼭 있어야 하고, level이 없으면 기본. */
export interface SessionRequest {
  lang: LanguageId;
  level?: DiagnosisLevel;
}

export interface SessionResponse {
  token: string;
  /** 토큰 만료 시각 (ISO 8601) */
  expiresAt: string;
  questions: PublicQuestion[];
}

/** POST /api/report 요청 */
export interface ReportRequest {
  token: string;
  /** 문항별로 고른 보기 번호 (0부터) */
  answers: number[];
  /** 문항별 풀이 시간(초) */
  secs: number[];
}

/** 영역별 요약 표 한 줄 */
export interface SummaryRow {
  areaId: AreaId;
  name: string;
  correct: number;
  total: number;
  /** 정답률(%) 정수 */
  ratePct: number;
  /** 문항당 평균 풀이 시간(초) */
  avgSec: number;
  level: Level;
  levelLabel: string;
}

export interface PatternView {
  tag: string;
  count: number;
  text: string;
}

/** 영역별 상세 (요약 표에서 펼치는 내용) */
export interface AreaDetail {
  areaId: AreaId;
  description: string;
  correct: number;
  total: number;
  ratePct: number;
  avgSec: number;
  targetSec: number;
  weakSubtypes: string[];
  levelReason: string;
  patterns: PatternView[];
}

/** 프로그래밍 추적표 한 행: 실행한 줄(코드 줄 번호), 그 뒤의 변수 값, 출력 */
export interface TraceRow {
  step: number;
  line: number;
  /** 함수 호출 깊이(main = 0) */
  depth: number;
  /** 예: "sum = 3, i = 2" */
  vars: string;
  /** 이 단계에서 출력한 값(없으면 빈 문자열) */
  out: string;
  /** 조건 참·거짓, 반복 끝, 호출·반환 같은 설명(없으면 빈 문자열) */
  note: string;
}

/** 추적표. 길면 가운데를 { omitted: 줄인 단계 수 }로 줄인다 */
export interface TraceView {
  rows: (TraceRow | { omitted: number })[];
  /** 줄이기 전 전체 단계 수 */
  total: number;
}

/** SQL 처리 단계 하나(FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT) */
export interface SqlStageView {
  /** 예: "WHERE salary >= 300" */
  title: string;
  /** 이 단계 뒤의 행 수(GROUP BY는 그룹 수) */
  rowCount: number;
  /** 중간 결과 표(앞쪽 몇 행만) */
  table: TableSpec;
  /** 표에서 줄인 행 수 */
  more: number;
  /** NULL 때문에 행이 빠지거나 집계가 달라졌을 때 한 문장 */
  note?: string;
}

/** 해설의 단계별 풀이. 프로그래밍은 trace, SQL은 sqlStages */
export interface ExplainDetail {
  trace?: TraceView;
  sqlStages?: SqlStageView[];
}

/** 문항별 해설 */
export interface Explanation {
  areaName: string;
  subtype: string;
  text: string;
  figure?: Figure;
  choices: PublicChoice[];
  picked: number;
  answerIndex: number;
  isCorrect: boolean;
  /** 오답일 때 고른 보기가 나오는 실수 유형 */
  pickedMistakeTag: string | null;
  steps: string[];
  /** 보기마다 그 값이 나오는 이유(정답 보기는 null) */
  choiceReasons: (string | null)[];
  /** 단계별 풀이(추적표 또는 SQL 단계별 중간 결과) */
  detail?: ExplainDetail;
}

/**
 * POST /api/report 응답: 머리말 정보 + 세 구역.
 * gated: 서버 기능 스위치(MONETIZATION_ENABLED)가 켜져 있을 때만 들어간다.
 *   true면 무료 응답(영역별 상세 없음, 해설은 1·2번만), false면 이용권 응답(전체).
 *   스위치가 꺼져 있으면 이 필드가 없고 응답은 전체다.
 */
export interface ReportResponse {
  gated?: boolean;
  meta: {
    total: number;
    correct: number;
    totalSec: number;
    perArea: number;
    /** 진단을 시작할 때 고른 프로그래밍 언어(서명된 토큰에서 나온 값) */
    language: { id: LanguageId; name: string };
    /** 심화일 때만 "advanced". 기본 응답에는 이 필드가 없다(이전과 같음). */
    level?: 'advanced';
  };
  summary: SummaryRow[];
  areaDetails: AreaDetail[];
  explanations: Explanation[];
}

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_token'
  | 'token_expired'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'server_misconfigured'
  | 'not_found'
  | 'level_unavailable'
  | 'auth_invalid'
  | 'service_unavailable'
  | 'internal';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}
