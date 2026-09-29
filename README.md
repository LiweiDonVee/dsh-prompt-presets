# DSH Prompt Presets — empty framework

Versioned prompt editing, composition and SillyTavern JSON import/export for DeepSeek Harness. **No story cards, characters, writing presets, example prompt packs or artwork are bundled or installed.** A new data directory starts with zero profiles. Schema defaults are editor settings, not prewritten narrative content.

## Install

Requires Node.js 24, npm and DSH **0.1.7-rc.2**.

```sh
git clone https://github.com/LiweiDonVee/dsh-prompt-presets.git
cd dsh-prompt-presets
npm ci
npm run check
npx --yes @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add .
npx --yes @deepseek-ai/dsh@0.1.7-rc.2 web
```

Restart the host after installation, keep the clone if installed as a local link, and open its printed authentication URL. In **Settings → Prompt Presets**, choose **Create blank profile** or import a JSON file you have permission to use. Add your own entries, edit ordering/groups/roles and save a version. The interface includes English and Chinese navigation; some detailed editing labels remain Chinese in this preview.

Data lives at `$DSH_HOME/prompt-presets`, defaulting to `~/.dsh/prompt-presets`. Installing this empty framework into an existing data directory preserves user-created/imported profiles; it does not erase them. Back up that directory before upgrades.

## Framework integration

This editor does not replace DSH's active system prompt automatically. A user-authored agent runtime must call the provided `ctx.promptPresets.compileForAgent()` service during prompt assembly and `compileForRender()` for its separate render pass, then consume the returned sections. This repository supplies that compiler/API, not a roleplay engine or a complete two-pass agent.

A runtime can provide a `prompt-manifest.json` containing its own profile IDs:

```json
{
  "schemaVersion": 1,
  "baseProfiles": [],
  "cardProfiles": [],
  "optionalProfiles": [],
  "defaultOverlay": { "enabledEntries": [], "disabledEntries": [] }
}
```

Pass its absolute `manifestPath`, `sessionId` and any `parentSessionId`/template variables to `compileForAgent`. The output carries `profileHash`, `narrativeContract`, `sections`, diagnostics and `blocked`. Strict callers must honor blocked results. A session pins profile versions; overlays affect the next compilation. The session drawer appears once a runtime has created a binding. No binding or profiles means no automatic content injection.

The authenticated loopback HTTP API at `/prompt-presets/api` includes `GET /catalog`, `GET /profiles/:id`, `PUT /profiles/:id`, `POST /validate`, import/export routes, and session effective/overlay routes. Writes use `expectedRevision`; stale writes return 409. See `src/host/http.js` and tests for complete request shapes.

## Compatibility and boundaries

- ST prompt entries, disabled entries, order and unhandled extension data are retained for round trips. Group inference is heuristic, not full ST runtime emulation.
- Bounded identity/variable macros are supported. Imported JavaScript, regex scripts and Tavern Helper data are retained for export but are **not executed**.
- Local APIs require DSH login plus loopback access. Remote-host usage is not supported by these custom endpoints.
- Runtime code must enforce its own state visibility and use returned render-safe sections correctly; the editor itself is not a sandbox.
- Session logs are not migrated by this plugin. Uninstall stops the editor/service but retains user profile data.

```sh
npx --yes @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web remove dsh-prompt-presets
```

## Development

`npm run check` runs deterministic synthetic-fixture tests and builds `lib/`. Tests cover empty startup, first user save, content-free packaging contract, rc.2 UI slot registration, composition, pinned versions, overlays, imports and HTTP authentication. Test strings are artificial data and are excluded from installation archives. CI covers Windows/Ubuntu with Node 24. No private workspace, third-party prompt pack or model account is needed.

MIT. Independent community project; see [NOTICE](NOTICE.md), [SECURITY](SECURITY.md) and [CONTRIBUTING](CONTRIBUTING.md).
