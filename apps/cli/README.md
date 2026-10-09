# apps/cli

Pendiente. Por ahora el depurador del motor es el smoke test
`apps/server/smoke.mjs` y los tests de `packages/engine/tests/`.

Si más adelante quieres una CLI interactiva, partir de:
- `engine` para `legalActions`, `apply`, `viewFor`, `newHand`.
- `bots` para `stepBot`.
- `readline` o `inquirer` para la UI de terminal.
