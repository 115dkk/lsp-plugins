# lsp-plugins

공식 마켓플레이스에 없는 Claude Code 언어 서버 플러그인 2개를 제공하는 마켓플레이스입니다.

| 플러그인 | 맡는 파일 | 필요한 프로그램 |
|---|---|---|
| `web-js-stack-lsp` | `.svelte`, 그리고 ESLint 훅으로 JS, TS, Svelte 전부 | `svelteserver`, 프로젝트의 ESLint |
| `ruff-server-lsp` | `.py`, `.pyi` | `ruff` |

## 설치

claude.ai의 플러그인 설정에서 `115dkk/lsp-plugins`를 마켓플레이스로 추가하고 원하는 플러그인을 켜십시오. 같은 계정으로 로그인한 Claude Code에 내려옵니다. Claude Code에서 직접 설치하려면 다음 명령을 실행하십시오.

```
/plugin marketplace add 115dkk/lsp-plugins
/plugin install web-js-stack-lsp@115dkk-lsp
/plugin install ruff-server-lsp@115dkk-lsp
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
