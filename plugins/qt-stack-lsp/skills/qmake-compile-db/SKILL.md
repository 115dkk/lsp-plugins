---
name: qmake-compile-db
description: Build compile_commands.json for a qmake project so clangd can resolve Qt and project headers. Use when clangd reports Qt headers (QWidget, QElapsedTimer, QtCore/...) or the project's own headers as "file not found", or Qt types as unknown, in a C++ project built with qmake (it has .pro files and qmake-generated Makefiles), or when the user asks to set up clangd or code intelligence for a qmake project.
---

# qmake compile database

qmake writes no `compile_commands.json`, so clangd opens every file of a qmake
project without its include paths and defines and reports false errors such as
`'QElapsedTimer' file not found`. The Makefiles qmake generates already hold the
exact compiler command (`CXX`, `CXXFLAGS`, `DEFINES`, `INCPATH`, `SOURCES`).
`qmake-compile-db.mjs`, in this skill's base directory, turns them into a
compilation database.

## Run it

From the project root (the generator otherwise takes the nearest folder above
the current directory that holds `.git`):

```
node "<this skill's base directory>/qmake-compile-db.mjs" --dry-run
node "<this skill's base directory>/qmake-compile-db.mjs"
```

The dry run prints which Makefile it picked for each `.pro` and how many
sources it found, without writing anything. The real run writes
`<root>/compile_commands.json`, the place clangd looks first. Other options:
`--root <dir>` and `--output <file>`.

When a project has several build folders for the same `.pro`, the newest
Makefile wins; on Windows `Makefile.Release` is preferred over
`Makefile.Debug`.

## Before and after

- Makefiles must exist. If none are found, run qmake for the project first,
  the way the project's own build script or README does it. Do not invent qmake
  arguments.
- Rerun the generator after qmake runs again with different settings, after
  sources are added to or removed from a `.pro`/`.pri`, or after switching to a
  different Qt version.
- `compile_commands.json` holds absolute paths for one machine. If `git status`
  shows it as untracked, tell the user and suggest adding it to `.gitignore`;
  do not commit it on your own.
- clangd reloads the database by itself. Check the result with the LSP tool
  (hover on a Qt type in a source file) or by looking at the diagnostics of
  the next edit.
