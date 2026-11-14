# lsp-plugins

공식 마켓플레이스에 없는 Claude Code 언어 서버 플러그인 4개를 제공하는 마켓플레이스입니다.

| 플러그인 | 맡는 파일 | 필요한 프로그램 |
|---|---|---|
| `web-js-stack-lsp` | `.svelte`, 그리고 ESLint 훅으로 JS, TS, Svelte 전부 | `svelteserver`, 프로젝트의 ESLint |
| `ruff-server-lsp` | `.py`, `.pyi` | `ruff` |
| `qt-stack-lsp` | `.qml`, 그리고 검사 훅으로 `.qml`, `.ui`, `.qrc` | Qt 설치본의 `qmlls`, `qmllint`, `uic`, `rcc`, Node |
| `slint-lsp` | `.slint` | `slint-lsp` |

## 설치

claude.ai의 플러그인 설정에서 `115dkk/lsp-plugins`를 마켓플레이스로 추가하고 원하는 플러그인을 켜십시오. 같은 계정으로 로그인한 Claude Code에 내려옵니다. Claude Code에서 직접 설치하려면 다음 명령을 실행하십시오.

```
/plugin marketplace add 115dkk/lsp-plugins
/plugin install web-js-stack-lsp@115dkk-lsp
/plugin install ruff-server-lsp@115dkk-lsp
/plugin install qt-stack-lsp@115dkk-lsp
/plugin install slint-lsp@115dkk-lsp
```

언어 서버 프로그램은 플러그인에 들어 있지 않습니다. 아래 안내대로 따로 설치하고, Claude Code를 띄우는 셸의 PATH에서 찾을 수 있게 두십시오.

## web-js-stack-lsp

웹 자바스크립트 스택 언어서버입니다. Svelte, React, Vite로 만드는 프로젝트에서 Claude Code가 파일을 고친 직후에 오류를 알 수 있게 합니다.

**Svelte 언어 서버.** `.svelte` 파일은 svelte-language-server가 맡습니다. 공식 `typescript-lsp`는 `.svelte`를 열지 않아서, 컴포넌트 안 `<script lang="ts">`의 타입 오류는 이 서버가 있어야 고친 직후에 잡힙니다.

**ESLint 훅.** Claude가 JS, TS, Svelte 파일을 고칠 때마다 그 프로젝트에 깔린 ESLint를 고친 파일 하나에 돌리고, 결과를 Claude에게 전달합니다. 오류는 고쳐야 할 항목으로, 경고는 참고 사항으로 전달합니다. React 훅 규칙(eslint-plugin-react-hooks), Vite HMR 규칙(eslint-plugin-react-refresh), Svelte 규칙(eslint-plugin-svelte)은 이 훅으로 들어옵니다. 프로젝트에 ESLint와 설정 파일이 없으면 아무것도 하지 않습니다.

TypeScript, JavaScript, JSX, TSX는 공식 `typescript-lsp`가 맡습니다. React 컴포넌트도 `.jsx`, `.tsx`라서 여기에 들어갑니다. Claude Code는 확장자 하나에 언어 서버를 하나만 붙이므로 이 플러그인은 그 확장자들을 건드리지 않습니다. Vite에는 언어 서버가 없고, `vite.config.ts`는 `typescript-lsp`가 봅니다.

필요한 프로그램은 다음 명령으로 설치하십시오. TypeScript 쪽은 공식 플러그인 `typescript-lsp@claude-plugins-official`도 함께 켜십시오.

```
npm i -g svelte-language-server
npm i -g typescript-language-server typescript
```

| 환경 변수 | 뜻 |
|---|---|
| `WEB_JS_STACK_ESLINT=0` | ESLint 훅만 끕니다. Svelte 언어 서버는 그대로 돕니다. |
| `WEB_JS_STACK_ESLINT_TIMEOUT_MS` | ESLint 한 번에 기다리는 시간입니다. 기본값은 40000(40초)입니다. |

## ruff-server-lsp

Pyright 대신 Ruff에 들어 있는 언어 서버(`ruff server`)로 Python 파일을 봅니다. Claude가 `.py`, `.pyi` 파일을 고치면 Ruff의 린트 진단이 바로 전달됩니다. 규칙은 프로젝트의 `pyproject.toml`이나 `ruff.toml`을 따르고, 설정이 없으면 Ruff 기본 규칙을 씁니다.

Ruff 서버는 린터라서 타입 검사를 하지 않고, 정의로 가기나 참조 찾기도 하지 않습니다. 공식 `pyright-lsp`와 같은 확장자를 맡으므로 둘 중 하나만 켜십시오.

Ruff는 다음 중 하나로 설치하십시오. 설치한 판에 언어 서버가 들어 있는지는 `ruff server --help`로 확인할 수 있습니다.

```
uv tool install ruff
pip install ruff
```

## qt-stack-lsp

Qt로 만드는 프로젝트에서 Claude Code가 C++, QML, Designer 파일의 오류를 고친 직후에 알 수 있게 합니다. C++ 자체는 공식 `clangd-lsp`가 맡고, 이 플러그인은 clangd가 Qt 프로젝트에서 제대로 돌도록 돕는 일과 Qt 전용 파일을 맡습니다.

**qmake 프로젝트의 컴파일 데이터베이스.** qmake는 `compile_commands.json`을 만들지 않아서, clangd는 qmake 프로젝트의 파일을 include 경로 없이 열고 `'QElapsedTimer' file not found` 같은 가짜 오류를 냅니다. `qmake-compile-db` 스킬이 qmake가 만든 Makefile에서 컴파일 명령을 읽어 프로젝트 루트에 `compile_commands.json`을 만듭니다. Claude가 이런 오류를 보면 스킬을 꺼내 쓰고, 직접 시킬 수도 있습니다. 만든 파일에는 이 컴퓨터의 절대 경로가 들어가므로 `.gitignore`에 넣으십시오.

**QML 언어 서버.** `.qml` 파일은 Qt에 들어 있는 qmlls가 맡습니다. qmlls는 보통 PATH에 없어서, 플러그인이 다음 순서로 찾습니다.

1. 환경 변수 `QT_STACK_QT_BIN`(Qt의 `bin` 폴더), `QTDIR`, `QT_ROOT_DIR`
2. 프로젝트 안의 qmake Makefile(`QMAKE =` 줄)과 `CMakeCache.txt`(`Qt6_DIR`)가 가리키는 Qt
3. PATH
4. 표준 설치 위치(`C:\Qt`, `~/Qt`, `/usr/lib/qt6/bin`, Homebrew 등)
5. PySide6의 `pyside6-qmlls`

Qt 문서에 따르면 qmlls는 qmake 프로젝트에서 잘못된 경고를 낼 수 있습니다.

**`.qml`, `.ui`, `.qrc` 검사 훅.** Claude가 QML 파일을 고치면 `qmllint`로, Designer 파일(`.ui`)을 고치면 `uic`로, 리소스 파일(`.qrc`)을 고치면 `rcc`로 그 파일을 검사합니다. 문법 오류나 변환 실패는 고쳐야 할 항목으로, qmllint 경고는 참고 사항으로 Claude에게 전달합니다. 도구는 qmlls와 같은 순서로 찾고, 못 찾으면 아무것도 하지 않습니다.

QML에 훅을 따로 두는 이유는 시간 차이 때문입니다. qmlls는 편집 후 0.14~0.2초 뒤에 진단을 보내는데, Claude Code는 편집 후 약 0.1초에 진단을 거둡니다. 그래서 qmlls의 진단은 그 편집에 붙지 못하고 다음 차례로 밀리거나 버려집니다. qmllint는 qmlls와 같은 검사기라 결과가 같고, 훅으로 돌리면 편집 결과와 함께 전달됩니다. 정의로 가기, 참조 찾기, 심볼 목록은 qmlls가 맡습니다.

`.qss`는 검사하지 않습니다. Qt에는 스타일시트를 검사하는 명령줄 도구가 없습니다.

| 환경 변수 | 뜻 |
|---|---|
| `QT_STACK_QT_BIN` | Qt의 `bin` 폴더를 직접 지정합니다. 다른 위치보다 먼저 봅니다. |
| `QT_STACK_CHECK=0` | `.qml`, `.ui`, `.qrc` 검사 훅만 끕니다. |
| `QT_STACK_CHECK_TIMEOUT_MS` | `qmllint`, `uic`, `rcc` 한 번에 기다리는 시간입니다. 기본값은 20000(20초)입니다. |

## slint-lsp

`.slint` 파일은 Slint에 들어 있는 언어 서버(`slint-lsp`)가 맡습니다. Claude가 `.slint` 파일을 고치면 Slint의 진단이 바로 전달됩니다.

Rust 파일 안의 `slint!` 매크로는 맡지 않습니다. `.rs` 파일은 rust-analyzer가 맡고, Claude Code는 확장자 하나에 언어 서버를 하나만 붙입니다.

`slint-lsp`는 다음 중 하나로 설치하십시오. 두 번째는 cargo-binstall이 있을 때 미리 빌드된 바이너리를 받습니다.

```
cargo install slint-lsp --locked
cargo binstall slint-lsp
```
