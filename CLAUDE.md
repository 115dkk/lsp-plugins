# 작업 규칙

- 플러그인은 `plugins/<이름>/`에 하나씩 두고, 루트의 `.claude-plugin/marketplace.json`에 등록한다.
- 각 플러그인 `plugin.json`의 `version`은 손으로 고치지 않는다. main에 푸시되면 `plugin-version.yml`이 그 플러그인 폴더를 건드린 커밋 수로 정한다.
- `web-js-stack-lsp`는 `.ts`, `.tsx`, `.js`, `.jsx` 계열 확장자에 언어 서버를 붙이지 않는다. 그 확장자는 공식 `typescript-lsp`가 맡고, Claude Code는 확장자 하나에 서버를 하나만 쓴다.
- 훅 스크립트는 Node 기본 모듈만 쓴다. 의존성을 넣지 않는다.
- 테스트는 플러그인 폴더 밖 `tests/<플러그인>/`에 둔다. 플러그인 폴더는 설치할 때 통째로 복사되기 때문이다.
- 테스트는 `node --test tests/web-js-stack-lsp/eslint-after-edit.test.mjs`처럼 파일 이름을 주고 돌린다. 이름 없이 `node --test`를 돌리면 `tests/**/fixtures` 아래 파일까지 테스트로 실행된다.
- README는 사람이 읽는 문서다. 작업 기록과 에이전트용 지시는 이 파일에 둔다.
