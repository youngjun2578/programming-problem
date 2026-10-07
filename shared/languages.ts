/**
 * 프로그래밍 영역에서 고를 수 있는 언어. 화면(언어 선택)과 서버(문제 생성·토큰·채점)가 함께 쓴다.
 * 언어를 더하거나 이름을 바꿀 때는 이 파일만 고친다.
 */
export const LANGUAGES = [
  { id: 'c', name: 'C' },
  { id: 'cpp', name: 'C++' },
  { id: 'python', name: 'Python' },
  { id: 'java', name: 'Java' },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]['id'];

export const LANGUAGE_IDS: readonly LanguageId[] = LANGUAGES.map((l) => l.id);

export const isLanguageId = (v: unknown): v is LanguageId => typeof v === 'string' && (LANGUAGE_IDS as readonly string[]).includes(v);

export const languageName = (id: LanguageId): string => LANGUAGES.find((l) => l.id === id)!.name;
