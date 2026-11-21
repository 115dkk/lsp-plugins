# 작업 규칙

- 플러그인은 `plugins/<이름>/`에 하나씩 두고, 루트의 `.claude-plugin/marketplace.json`에 등록한다.
- 각 플러그인 `plugin.json`의 `version`은 손으로 고치지 않는다. main에 푸시되면 `plugin-version.yml`이 그 플러그인 폴더를 건드린 커밋 수로 정한다.
- `web-js-stack-lsp`는 `.ts`, `.tsx`, `.js`, `.jsx` 계열 확장자에 언어 서버를 붙이지 않는다. 그 확장자는 공식 `typescript-lsp`가 맡고, Claude Code는 확장자 하나에 서버를 하나만 쓴다.
- 훅 스크립트는 Node 기본 모듈만 쓴다. 의존성을 넣지 않는다.
- 테스트는 플러그인 폴더 밖 `tests/<플러그인>/`에 둔다. 플러그인 폴더는 설치할 때 통째로 복사되기 때문이다.
- 테스트는 `node --test tests/web-js-stack-lsp/eslint-after-edit.test.mjs`처럼 파일 이름을 주고 돌린다. 이름 없이 `node --test`를 돌리면 `tests/**/fixtures` 아래 파일까지 테스트로 실행된다. 돌릴 파일 목록은 `.github/workflows/test.yml`에 있다.
- `qt-stack-lsp`의 `QT_STACK_QMLLS_OVERRIDE`, `QT_STACK_TOOL_OVERRIDE_DIR`는 테스트가 가짜 도구를 끼우려고 쓰는 환경 변수다. README에 적지 않는다.
- Qt 도구는 프로젝트 안의 Qt를 먼저 찾는다(`scripts/find-qt-bin.mjs`). 순서를 바꾸면 README의 목록도 같이 고친다.
- `whitespace-guard`는 파일을 직접 수정하지 않는다. 1.0.1까지는 PostToolUse에서 파일을 읽고 git을 기다린 뒤 처음 읽은 내용으로 파일 전체를 다시 저장해서, 그 사이 다른 프로그램이 저장한 내용을 덮어쓸 수 있었다. 줄끝은 PreToolUse에서 Write의 `content`를 바꾼 `updatedInput`으로 맞추고, PostToolUse는 들여쓰기를 읽어 알리기만 한다. 저장 직전에 다시 읽어 비교하는 방식은 비교와 저장 사이에 같은 틈이 남으므로 쓰지 않는다.
- `whitespace-guard`가 기대는 Claude Code 동작은 2026-11-22에 확인했다. Write는 Claude가 보낸 `content`를 줄끝까지 그대로 저장한다(LF면 LF, CRLF면 CRLF). Edit는 CRLF 파일을 CRLF로 두고, 줄끝이 섞인 파일은 한 가지로 맞춰 저장한다. PreToolUse가 `permissionDecision` 없이 돌려준 `updatedInput`도 적용되고, 기본 권한 모드에서는 여전히 권한을 묻는다. PostToolUse 입력의 `tool_response.originalFile`은 줄끝을 LF로 바꾼 원본이고, `structuredPatch`의 줄 내용은 탭을 스페이스로 펼친 것이라 줄 번호만 쓴다.
- `whitespace-guard` 테스트는 임시 저장소마다 `core.autocrlf`를 직접 정한다. Git for Windows는 시스템 설정에 `core.autocrlf=true`를 두므로, 기본값에 기대면 Windows와 Linux에서 결과가 달라진다.
- README는 사람이 읽는 문서다. 작업 기록과 에이전트용 지시는 이 파일에 둔다.
