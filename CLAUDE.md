# 작업 규칙

- 플러그인은 `plugins/<이름>/`에 하나씩 두고, 루트의 `.claude-plugin/marketplace.json`에 등록한다.
- 각 플러그인 `plugin.json`의 `version`은 손으로 고치지 않는다. main에 푸시되면 `plugin-version.yml`이 그 플러그인 폴더를 건드린 커밋 수로 정한다.
- `web-js-stack-lsp`는 `.ts`, `.tsx`, `.js`, `.jsx` 계열 확장자에 언어 서버를 붙이지 않는다. 그 확장자는 공식 `typescript-lsp`가 맡고, Claude Code는 확장자 하나에 서버를 하나만 쓴다.
- 훅 스크립트는 Node 기본 모듈만 쓴다. 의존성을 넣지 않는다.
- 테스트는 플러그인 폴더 밖 `tests/<플러그인>/`에 둔다. 플러그인 폴더는 설치할 때 통째로 복사되기 때문이다.
- 테스트는 `node --test tests/web-js-stack-lsp/eslint-after-edit.test.mjs`처럼 파일 이름을 주고 돌린다. 이름 없이 `node --test`를 돌리면 `tests/**/fixtures` 아래 파일까지 테스트로 실행된다. 돌릴 파일 목록은 `.github/workflows/test.yml`에 있다.
- `qt-stack-lsp`의 `QT_STACK_QMLLS_OVERRIDE`, `QT_STACK_TOOL_OVERRIDE_DIR`는 테스트가 가짜 도구를 끼우려고 쓰는 환경 변수다. README에 적지 않는다.
- Qt 도구는 프로젝트 안의 Qt를 먼저 찾는다(`scripts/find-qt-bin.mjs`). 순서를 바꾸면 README의 목록도 같이 고친다.
- `whitespace-guard`가 기대는 Claude Code 동작은 2026-11-22에 확인했다. Write는 CRLF 파일을 덮어써도 LF로 저장하고, Edit는 파일의 줄끝을 지킨다. PostToolUse 입력의 `tool_response.originalFile`은 줄끝을 LF로 바꾼 원본이고, `structuredPatch`의 줄 내용은 탭을 스페이스로 펼친 것이라 줄 번호만 쓴다. 훅이 줄끝만 바꾸면 다음 Edit가 막히지 않지만, 다른 내용을 바꾸면 Claude Code가 파일이 디스크에서 바뀌었다고 알린다. 그래서 들여쓰기는 고치지 않고 알리기만 한다.
- `whitespace-guard` 테스트는 임시 저장소마다 `core.autocrlf`를 직접 정한다. Git for Windows는 시스템 설정에 `core.autocrlf=true`를 두므로, 기본값에 기대면 Windows와 Linux에서 결과가 달라진다.
- README는 사람이 읽는 문서다. 작업 기록과 에이전트용 지시는 이 파일에 둔다.
