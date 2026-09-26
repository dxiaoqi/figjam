Map this repository on the board with arch-kit.

1. Read the workspace manifest and each package's manifest, entry points and imports.
2. One `arch-kit.module` per package (fill `path`, `layer`, `language`), one `arch-kit.service` per running process,
   in a frame "Modules"; apply `arch-kit.layers`.
3. Connect internal imports (module → module) and the external dependencies that shape the design.
4. One `arch-kit.interface` per boundary (HTTP, MCP, CLI, WebSocket, file format) in a frame "Contracts" with a
   short `signature`; apply `arch-kit.contracts`.
5. Data stores, accepted decisions you can see in the code, and the top risks (apply `arch-kit.risk-matrix`).
6. `lint_layout`, `render_snapshot`, commit the change set and tell me what to review first.
