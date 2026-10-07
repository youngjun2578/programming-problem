export interface SeriesSpec {
  title?: string;
  /** 축 단위 (예: "억 원", "%") */
  unit: string;
  labels: string[];
  values: number[];
  /** 축 최댓값. 없으면 자동 */
  yMax?: number;
  /** 막대·점 위에 값 표시 */
  showValues?: boolean;
}
export interface BarSpec extends SeriesSpec {
  type: 'bar';
  horizontal?: boolean;
}
export interface LineSpec extends SeriesSpec {
  type: 'line';
}
export interface PieSpec {
  type: 'pie';
  title?: string;
  labels: string[];
  values: number[];
  /** 조각에 % 표시 */
  showPercent?: boolean;
  /** 조각에 원래 값 표시 (unit과 함께) */
  showValues?: boolean;
  unit?: string;
}
export interface ScatterSpec {
  type: 'scatter';
  title?: string;
  xLabel: string;
  yLabel: string;
  xs: number[];
  ys: number[];
}
export type ChartSpec = BarSpec | LineSpec | PieSpec | ScatterSpec;

export interface TableSpec {
  caption?: string;
  /** 단위 안내 (예: "단위: 억 원") */
  unit?: string;
  head: string[];
  rows: (string | number)[][];
}

/** 코드 조각. lang은 화면에 보이는 언어 이름(예: "Python", "SQL"). tables가 있으면 코드 위에 함께 보여 준다(SQL의 대상 표, 값이 없으면 "NULL"). */
export interface CodeSpec {
  lang: string;
  code: string;
  tables?: TableSpec[];
}

export type Figure =
  | { kind: 'chart'; spec: ChartSpec }
  | { kind: 'table'; table: TableSpec }
  | ({ kind: 'code' } & CodeSpec);
