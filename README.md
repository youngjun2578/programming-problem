# programming-problem

NCS 전산직 프로그래밍·SQL 진단 사이트입니다. 현재 개발 초기 단계입니다.

기존 진단 사이트(ncs-problem)의 구조를 출발점으로 삼았습니다. 시드로 문제를 만들고 서버에서 채점하는 구조는 그대로 두고, 영역을 프로그래밍(C·C++·Python·Java)과 SQL로 바꿨습니다. 지금 문제는 영역마다 임시 샘플 하나씩뿐입니다(`server/templates/`).

- 사이트 이름과 한 줄 설명: `shared/site.ts` 한 곳에서 바꿉니다.
- 영역 정의: `server/areas.ts`, 템플릿 등록: `server/registry.ts`

## 실행

```bash
npm ci
npm run dev
npm run build
```
