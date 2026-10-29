# AI Setup, Privacy and Polish Plan

## Summary

One review pass (2026-10-29) over the experimental AI features on `develop` (engines and settings, the rewrite family, Explain and Translate, `/summary`, `/title`, Properties Suggest, the AI toolbar button and first-run panel, the thinking dial, the Experimental badge, the lazy AI chunk). Nothing was changed; this document is the output.

Goals, in Mike's words:

1. **Very easy AI inference setup.** A first-time user goes from "AI off" to a working engine with the fewest decisions possible, local (oMLX, LM Studio, Ollama) or cloud (Anthropic, OpenAI and the other presets).
2. **Clear cloud privacy and training implications.** At the moment of deciding, the user understands that text leaves the machine, what the provider may do with it (API terms differ from consumer terms and differ per provider), and that a local engine is the alternative. Claims that can go stale are links to the provider's own policy, not hardcoded prose.
3. **UI polish** for what is already built: naming, discoverability, empty, loading and error states, consistency across the context menu, toolbar menu, popover, sidebar and commands, and keyboard access.

Critical success factors:

- A local server that is already running is found and used with one click; a cloud key is the only thing a cloud user types.
- Every place text can leave the machine says so in the same words, with a link to the provider's policy, before the first byte is sent, on VS Code and Desktop alike.
- No new setting without the three-place rule (`package.json`, `src/settings.ts`, the Settings modal). Secrets stay in SecretStorage or the keychain. `mikedown.ai.engines` stays machine scope. `ai-ui` stays a lazy chunk. No `editor.view.dom` writes outside a PM transaction.
- The product calls listed under [Open Questions for Mike](#open-questions-for-mike) are answered by Mike, not by a worker.

Defaults applied by the planning skill: incremental testing (a test milestone after each group), automated verification first, no Playwright, no screenshot review (the hands-on pass judges the look), Opus on UI milestones, no database schema (no schema gate), no LymeStack mode.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1 Find running local servers, one-click local setup](#m1-find-running-local-servers-one-click-local-setup) | Opus | ✅ Done | 14 | `7d9ea11`; one-click saves the engine quietly first, then one patch |
| [M1b Setup wizard: recommend a path, cloud by default](#m1b-setup-wizard-recommend-a-path-cloud-by-default) | Opus | 🔄 In Progress | 17 (a) | M1b-a backend done `dbe2a23`; M1b-b wizard UI running |
| [M2 Cloud setup in one place](#m2-cloud-setup-in-one-place) | Opus | ✅ Done | 45 | `a78eaf4`; OQ2 scope change done by M4 |
| [T1 Setup tests](#t1-setup-tests) | Sonnet | ✅ Done | 14 | Unit, host, cargo |
| [M3 Privacy copy and provider policy links](#m3-privacy-copy-and-provider-policy-links) | Opus | ✅ Done | 16 | `f5b48a7` (cherry-picked from worktree); openLink and panel wiring passed to M2/M4 |
| [M4 Consent flow hardening](#m4-consent-flow-hardening) | Sonnet | ✅ Done | 15 | `e73e2c2` (cherry-picked from worktree) |
| [T2 Privacy and consent tests](#t2-privacy-and-consent-tests) | Sonnet | ✅ Done | 6 | Unit, host, cargo |
| [M5 UI polish: surfaces, naming, states, keyboard](#m5-ui-polish-surfaces-naming-states-keyboard) | Opus | ⬜ Not Started | — | Context menu, toolbar menu, popover, sidebar, commands |
| [M6 Docs, settings sync, release notes](#m6-docs-settings-sync-release-notes) | Sonnet | ⬜ Not Started | — | README, CHANGELOG, Desktop README, package.json descriptions |
| [T3 Hands-on sign-off](#t3-hands-on-sign-off) | Sonnet | ⬜ Not Started | — | VS Code and Desktop, Mike signs off |
| [T4 Fresh-user onboarding walk (Mike)](#t4-fresh-user-onboarding-walk-mike) | Mike | ⬜ Not Started | — | Clean slate, OpenAI, Anthropic, DeepSeek, then local; before the release |

[Return to Top](#ai-setup-privacy-polish-plan)

---

## Table of Contents

- [Summary](#summary)
- [Review Findings](#review-findings)
  - [Setup friction (goal 1)](#setup-friction-goal-1)
  - [Privacy and consent gaps (goal 2)](#privacy-and-consent-gaps-goal-2)
  - [Polish findings (goal 3)](#polish-findings-goal-3)
  - [Bugs found](#bugs-found)
- [Open Questions for Mike](#open-questions-for-mike)
- [Rules for every worker](#rules-for-every-worker)
- [M1 Find running local servers, one-click local setup](#m1-find-running-local-servers-one-click-local-setup)
- [M1b Setup wizard: recommend a path, cloud by default](#m1b-setup-wizard-recommend-a-path-cloud-by-default)
- [M2 Cloud setup in one place](#m2-cloud-setup-in-one-place)
- [T1 Setup tests](#t1-setup-tests)
- [M3 Privacy copy and provider policy links](#m3-privacy-copy-and-provider-policy-links)
- [M4 Consent flow hardening](#m4-consent-flow-hardening)
- [T2 Privacy and consent tests](#t2-privacy-and-consent-tests)
- [M5 UI polish: surfaces, naming, states, keyboard](#m5-ui-polish-surfaces-naming-states-keyboard)
- [M6 Docs, settings sync, release notes](#m6-docs-settings-sync-release-notes)
- [T3 Hands-on sign-off](#t3-hands-on-sign-off)
- [T4 Fresh-user onboarding walk (Mike)](#t4-fresh-user-onboarding-walk-mike)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

---

## Review Findings

Files read: `packages/core/src/ai/` (presets, discovery, locality, errors, router, schema, defaults), `ai-lite.ts`, `ai-ui.ts`, `ai-toolbar.ts`, `ai-request.ts`, `ai-settings.ts`, `ai-settings-dom.ts`, `ai-settings-model.ts` (the setup paths), `ai-engines-page.ts`, `ai-engine-form.ts`, `ai-rewrite.ts` (menu, header, footer, error rendering), `outlineSidebar.ts` (Suggest, chip), `contextmenu.ts` (AI submenu), the AI wiring in `editor.ts` (lines 2206 to 2600); `src/ai/engineService.ts`, `secrets.ts`, `webviewBridge.ts`, `vscodeAi.ts`, `statusBar.ts`, `providers/http.ts`; `packages/desktop/src-tauri/src/commands/ai.rs` (consent and gate), `packages/desktop/src/host/aiHost.ts`, `packages/desktop/src/settings/aiSettings.ts`; `package.json#contributes` for `mikedown.ai.*`; the three plans named in the brief.

### Setup friction (goal 1)

The current path from "AI off" to a working local engine: toolbar AI button → first-run panel → "Turn on and set up" (saves `ai.enabled: true` at once) → AI Engines page on the quick-start cards → pick a card → the form opens, models fetch on their own → pick a model (local: first chat model becomes the default route) → Done. That is good already; the friction is around it.

| # | Where | What | Why it hurts |
|---|---|---|---|
| F1 | Quick-start cards (`ai-engines-page.ts#buildPresetCards`) | Six local cards, all equal, none says whether that server is running on this machine. | The user has to know which app they installed and on which port. LM Studio on `:1234` and Ollama on `:11434` answer a `GET /models` in milliseconds; MikeDown never looks. |
| F2 | First-run panel (`ai-toolbar.ts#showAiFirstRunPanel`) | Two buttons: Cancel, "Turn on and set up". | The panel could already say "LM Studio is running on this Mac" and offer "Use LM Studio" as the primary action. One click instead of four. |
| F3 | `editor.ts#turnOnAiAndSetUp` | AI is switched on before an engine exists; Back or Escape on the page leaves AI on with no engine ("AI: no route", every menu entry disabled with "No engine and model is chosen for this task."). | Confusing first impression; also the opposite of "nothing is sent until you choose". Turn AI on when the page is finished with at least one usable route, or revert on Cancel. |
| F4 | Cloud engines, two places | The Engines page has no **Allow cloud engines** switch; it lives on the AI tab of the Settings modal. A newly added Anthropic engine shows the pill "blocked by Allow cloud" with no way to flip it there. | The user finishes the form, presses Done, tries a rewrite and gets "Cloud engines are off". The switch belongs where the cloud engine is added (and that is where the privacy explanation belongs too, see goal 2). |
| F5 | Cloud, three gates | Allow cloud (global) + consent per workspace/folder (modal) + the Experimental disclaimer. | Each is defensible; together they read as three "are you sure". M2 and M3 fold the explanation into one card and keep two gates: the switch (decided once, with the policy in front of you) and the consent (per workspace, names the engine). |
| F6 | `ai-settings-model.ts#autoFetchDecision`, cloud `open` → no fetch | A cloud engine whose key already comes from `ANTHROPIC_API_KEY` or a key file never fetches models on open; the list says "No models yet. Fetch them from the server, or type an id." | A user with the env var set did the hard part already and still has to find "Fetch models". |
| F7 | `ai-engine-form.ts#buildKey`, `engineService.ts#status` | `keySource` reports only `stored` and `file`; a key from the env var shows as "Stored in the system's secure storage". | Wrong statement about where a secret lives. Clear is also offered, and does nothing visible (the env key keeps working). |
| F8 | `statusBadge` "Not tested" | A cloud engine that just fetched its models fine still shows the grey dot until Test connection; on VS Code discovery does set the probe, on the AI tab the dot is often stale until the refresh lands. | The dot is the only health cue in the compact list. A successful fetch is a successful test. |
| F9 | Error copy, `ai/errors.ts` | "Engine not reachable … Check that the server is running and the base URL is right." with **Open AI settings**, which opens the AI *tab*, not the failing engine. | Two more clicks to reach the form; the engine name is known. |
| F10 | VS Code vs Desktop | Desktop from the Dock has no shell env, so `apiKeyEnv` silently fails there and only the key file or the keychain works; the form caption mentions it only under Advanced. The VS Code consent modal says "workspace", Desktop says "folder" or "session". | Same product, two vocabularies and one silent difference. |
| F11 | Tier-1 hosts (npm consumers without `listEngines`) | "Turn on and set up" lands on the AI tab, which only has the master switch and feature toggles. | Fine, but the first-run panel copy ("set up") promises more than tier 1 gets. |

### Privacy and consent gaps (goal 2)

What exists: `allowCloud` off by default; a cloud engine needs Allow cloud **and** a per-workspace (VS Code `workspaceState`) or per-folder (Desktop `.mikedown/settings.json`) consent, asked in host UI (`vscodeAi.ts#askCloudConsent`, `ai.rs#ai_request_cloud_consent`); the gate runs in core's router and again in each host; the sidebar chip and the VS Code status bar show local or cloud after each request; the disclaimer says "With a cloud engine, the selected text is sent to that provider".

| # | Gap | Detail |
|---|---|---|
| P1 | **Nothing says what the provider does with the text.** | Neither the consent modal, the Allow cloud row, the cloud cards nor the disclaimer mention training, retention, or that API terms differ from consumer products (ChatGPT, Claude.ai). No link to any provider policy anywhere. The decision point (pasting a key, flipping Allow cloud) has the least information. |
| P2 | The consent modal understates what is sent. | VS Code: "the selected text and the paragraph before and after it" for rewrite, else "the text *Feature* works on". `/summary`, `/title`, Properties Suggest and whole-document Translate send **the whole document** (up to the context budget), and Properties sends the frontmatter and the tag vocabulary of the workspace. Desktop's dialog only describes Rewrite. |
| P3 | Consent is keyed by engine id, not by where the text goes. | Editing an engine's base URL (say Anthropic → a proxy) keeps the consent; `engineService.ts` voids the probe cache by fingerprint but not the consent. Desktop likewise. |
| P4 | Desktop consent lives in a repo-writable file. | `ai.consent.<engineId>: true` in `<folder>/.mikedown/settings.json`; the README already warns that a cloned repo can arrive with consent recorded. The engine id is random per install, so a stranger cannot guess it, but a teammate who shares the folder and the same exported settings can. Also, deleting an engine on Desktop never removes its `ai.consent.*` keys from folder files. |
| P5 | No way to see or revoke consent. | VS Code: `workspaceState`, invisible; only deleting the engine forgets it. Desktop: hand-edit the JSON. "Not now" is not stored in VS Code, so every attempt asks again (by design, but there is no "don't ask for this engine here" either). |
| P6 | `allowCloud` is workspace-overridable in VS Code. | Scope is the default (window), so a repo's `.vscode/settings.json` can set `mikedown.ai.enabled`, `allowCloud` and `routing` (engine ids are random, so routing to the user's cloud engine is unlikely but not impossible). The consent modal is then the only gate. `saveAiSettingsPatch` already warns when a workspace forces it off; the reverse is silent. CLAUDE.md pins only `engines` to machine scope. |
| P7 | Tier-1 hosts skip consent. | `ai-request.ts`: without `requestCloudConsent`, `granted = true`. Documented for npm consumers, but the same disclaimer text promises a consent step in those hosts. |
| P8 | Local is not explained as the alternative at the decision point. | The cards' "Run on this machine" explainer is the only place; the consent modal and the Allow cloud row do not say "or use a local engine, which keeps text here". |

### Polish findings (goal 3)

| # | Where | Finding |
|---|---|---|
| U1 | Entry points differ per surface | Toolbar AI menu: Rewrite selection, Summarize document, Suggest titles, Manage engines. Context menu `AI` submenu: the rewrite groups (Length, Tone, Audience, Translate, Explain, Custom) only, and only with a selection. Commands: rewrite, explain, translate, summarize, suggestTitle, suggestProperties. Slash: `/summary`, `/outline`, `/title`. Sidebar: Suggest. No surface has all of them; Explain and Translate are not in the toolbar menu, Summarize and Titles are not in the context menu, Suggest properties is in neither. |
| U2 | Keyboard | Only `mikedown.ai.rewrite` has a keybinding (`Cmd+Alt+K`). Explain, Translate, Summarize, Titles have none; on Desktop they are menu items only. The popover's chips are reachable, the thinking dial is a segmented control without an announced value change. |
| U3 | Naming | "Engines" (the servers), "Routing" (jargon for "which model does what"), "Make default" star, "Fetch models", "Model default" thinking, "Allow cloud engines", "Manage engines…" vs "AI settings…" on tier 1, "Add detail" vs "Longer" in the Length group (both exist). "AI: no route" on the chip. |
| U4 | Empty states | Cards page: good. AI tab with no engines: "No engines yet" plus a button labelled "Add engine…" (good). Properties Suggest with nothing to suggest: the chips row shows a message; the disabled Suggest button only has a tooltip (hover only, not reachable by keyboard). |
| U5 | Loading states | The form shows "Fetching…" and a spinner on Models; the compact list dot pulses. The toolbar menu entries have no busy state while a request runs elsewhere (the popover owns it). Fine, but the Suggest button in the sidebar keeps its sparkle while running (the chips row says "running"). |
| U6 | Error states | Popover: title, generic copy, detail, Open AI settings, Retry, Close. Good. The length-limit note and the structure "Check:" warning are strong. Missing: a deep link to the engine (F9) and, for `auth`, which engine rejected the key. |
| U7 | Consistency of the engine badge | Popover footer: `local · oMLX · model`; sidebar chip: same words; VS Code status bar: `$(home) AI: local · oMLX · model`. Good. The chip's tooltip says "Click to open AI settings" and sometimes opens the Engines page instead (`openAiFromChip`). |
| U8 | Settings modal AI tab | The Experimental intro, master switch, toolbar button switch, Allow cloud, Engines summary, Features. Features offers a task picker per feature on tier 2 that most users will never touch; it sits above the fold while the engine list is below. |
| U9 | First-run panel | Title "AI features", the disclaimer paragraph, two buttons. No hint of what AI can do (one line of verbs would sell it), nothing about local vs cloud. |
| U10 | Desktop | The Desktop README documents the per-folder consent file; the app itself never shows it. The native consent dialog cannot carry a link. |

### Bugs found

Listed here, not fixed (scope guard). Each has a home in a milestone.

- [x] B1 `src/ai/engineService.ts#status`: `keySource` leaves out `env`, so `ai-engine-form.ts#buildKey` (lines 456 to 503) says "Stored in the system's secure storage" for a key read from `apiKeyEnv`. → M2.
- [x] B2 `ai-settings-model.ts#autoFetchDecision`: a cloud engine with a key available from env or file never auto-fetches on open; only a typed key triggers it. → M2.
- [x] B3 `editor.ts#turnOnAiAndSetUp` persists `ai.enabled: true` before the Engines page opens; Cancel leaves AI on with no route. → M1.
- [x] B4 Consent is not voided when an engine's `baseUrl` or `kind` changes (`engineService.ts#settingsChanged` prunes consent only for removed engines; Desktop never prunes). → M4.
- [x] B5 Desktop: `ai.consent.<id>` keys of deleted engines stay in every folder's `.mikedown/settings.json`. → M4.
- [x] B6 `engineService.ts#requestCloudConsent` returns `false` when `allowCloud` is off (no error), while Desktop rejects with `cloudBlocked`; the webview shows "Not allowed in this workspace" on VS Code for what is really "Cloud engines are off". Reachable only when the webview's settings copy is stale. → M4.
- [x] B7 The VS Code consent modal's "what is sent" line is wrong for every whole-document feature (P2). → M3.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## Open Questions for Mike

Product calls. Workers proceed with the recommendation unless Mike answers otherwise here.

**Decided 2026-10-29:** Mike accepted every recommendation, OQ1 to OQ13, including OQ12 (build the `vscode-lm` Copilot engine kind and surface it first in the VS Code wizard).

| # | Question | Recommendation |
|---|---|---|
| OQ1 | Should Desktop keep per-folder consent in the folder's `.mikedown/settings.json` (committable, visible, portable) or move it to app data keyed by folder path (like VS Code's `workspaceState`)? | Move to app data, keyed by canonical folder path plus engine id, and stop writing `ai.consent.*` into folder files (migrate: read the old key once, then delete it). A repo should never carry a consent. |
| OQ2 | Should `mikedown.ai.allowCloud` become machine scope like `engines`, so a repo's `.vscode/settings.json` cannot turn cloud on? (It would also stop a team repo from forcing it *off*.) | Yes, machine scope. A team that wants AI off can still set `mikedown.ai.enabled: false` in the workspace. Note the CLAUDE.md Settings rule change if accepted. |
| OQ3 | Should "Not now" be remembered for the workspace (a third state: "never for this engine here") with a visible way to change it, or stay ask-every-time? | Add "Not for this workspace" as a third button, stored like a grant, with a **Cloud consents** list on the AI tab (engine, workspace, Allow / Not allowed, Forget). |
| OQ4 | Where should the provider data-use note come from: a short careful sentence per preset in `presets.ts` plus the official policy link, or only the link? | Both: one neutral sentence that cannot go stale ("API traffic is covered by the provider's API terms, which differ from its consumer apps; see the policy") and the link. No "does not train" claims in code. |
| OQ5 | Should a cloud preset card be hidden until Allow cloud is on, or shown with the switch inline on the card group? | Shown, with the switch and the privacy card inline above the cloud cards (M2). Hiding them makes cloud undiscoverable. |
| OQ6 | Should local server detection probe all five local preset ports on the Engines page open, or only on the first-run panel and the cards page? | Only on the first-run panel and the cards page, with a 1.5 s cap, never in the background from the toolbar. |
| OQ7 | Should the toolbar AI menu grow Explain, Translate and Suggest properties (one flat list of seven), or should the context menu gain Summarize and Suggest titles? | Both: the toolbar menu lists every feature (selection ones disabled with "Select text first"), the context menu's `AI` submenu adds a separator and the two document items. One mental model: the same list everywhere. |
| OQ8 | Keybindings for Explain, Translate, Summarize, Titles? | Only `Cmd+Alt+K` stays bound; add the others to the VS Code `commands` with no default key (users bind them), and give Desktop menu items the same names. |
| OQ9 | Tier-1 hosts and consent (P7): keep "consumer's problem", or make core refuse cloud without `requestCloudConsent`? | Keep, but make the disclaimer say "this app" instead of promising a consent step when `requestCloudConsent` is absent. |
| OQ10 | Rename "Routing" to "Which model does what" (or "Tasks") and the star to "Use by default"? | Rename the nav entry and page title to **Tasks**; keep "default model" wording; star tooltip "Use this engine by default". |
| OQ11 | Hardware threshold for "Local is an option on this machine" (M1b)? | Apple Silicon with 16 GB or more unified memory; or any machine with 32 GB RAM or more; or an NVIDIA GPU with 8 GB VRAM or more (Desktop only, where it can be read). Below that, local is still reachable under Advanced, just not recommended. Model size hint: under 24 GB → "up to about 8B parameters", 24 to 48 GB → "up to about 30B", above → "larger models work". |
| OQ12 | `vscode.lm` (Copilot) as an engine: build it, and make it the first option in VS Code when a Copilot model is available? | Yes, as a new engine kind `vscode-lm` (VS Code host only, no key, no URL), shown first in the VS Code wizard when `vscode.lm.selectChatModels()` returns a model. Core treats it as a cloud engine (text leaves the machine through GitHub's service), so Allow cloud and consent apply, with Copilot's own data policy linked. Confirm Mike wants the Copilot dependency surfaced in a MikeDown feature. |
| OQ13 | Cloud by default: confirm the wizard's first screen leads with "Connect a provider" and puts local under "Advanced", even on a machine where a local server is already running? | Running server first (signal a beats the default), else cloud, with local under Advanced. A detected running server is the one case where local is the easier path. |

[Return to Top](#ai-setup-privacy-polish-plan)

---

## Rules for every worker

- Complete **every** checkbox in your milestone. Do not skip an item because it looks lower priority or slightly out of scope. If an item should be dropped or deferred, say so in your summary for the orchestrator to decide, and still attempt it unless it is truly blocked.
- Settings rule: any new `mikedown.ai.*` key lands in `package.json#contributes.configuration`, `src/settings.ts` and the in-editor Settings UI (the AI tab or the Engines page), plus `AI_SETTINGS_KEYS` in `packages/core/src/ai/schema.ts` and the Desktop schema.
- Secrets never go in settings. Keys are written with `host.ai.setSecret`. `mikedown.ai.engines` stays `machine` scope.
- `ai-ui.ts` is loaded only through `loadAiUi()` or `ai-ui-eager.ts`; never import it statically from `editor.ts`'s main path. New AI UI modules are reached through `ai-ui.ts`'s exports. `test/packages/web-component-shape.test.ts` keeps the 850 kB budget.
- Never mutate `editor.view.dom` outside a ProseMirror transaction. Settings UI, the popover and the sidebar are portal or sidebar DOM, not the editor's.
- The pure AI layer (`packages/core/src/ai/`) stays free of DOM, network and provider SDKs (the package shape test checks).
- Host-and-webview message changes are documented at the top of `packages/core/src/editor-main.ts` and in `src/ai/webviewBridge.ts`; the Desktop twin is `packages/desktop/src/host/aiApi.ts` and `commands/ai.rs`.
- Commits: `git commit -- <your paths>` only, human wording, no AI attribution of any kind. Do not push.
- Summary: `.orchestrator/ai-setup-privacy-polish-plan/worker-summary-<milestone-slug>.md`, then ask the user to clear the context.
- Only one worker edits `packages/core/src/editor.ts` at a time (see Parallel groups).

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M1 Find running local servers, one-click local setup

**Recommended model: Opus** (host plumbing on two hosts plus first-run and cards UI; the cards and panel are the first thing a user sees, so design craft matters: calm, one obvious action, nothing that looks like a wizard).

Fixes F1, F2, F3, F11 and B3. Answers OQ6 with its recommendation unless Mike says otherwise.

Core (pure, `packages/core/src/ai/`):

- [x] Add `AiLocalServerProbe = { presetId: string; baseUrl: string; ok: boolean; models?: number; latencyMs?: number }` to `types.ts`, and an optional host method `detectLocalServers?(candidates: { presetId: string; baseUrl: string }[], signal: AbortSignal): Promise<AiLocalServerProbe[]>` on `MikeDownAiHost`. Candidates come from `AI_ENGINE_PRESETS` where `family === 'local'` and `id !== 'custom'`. Document it next to `listEngines` in `types.ts`.
- [x] `presets.ts`: add `detectPath` per local preset where it differs from `/models` (LM Studio `/api/v0/models`, Ollama `/api/tags`), so the probe counts models without auth where possible. oMLX needs its key: the host resolves `apiKeyFile` for the preset the same way `secrets.ts#fileKey` does, so "oMLX running, 2 models" works out of the box.
- [x] `ai-settings-model.ts`: pure `rankLocalCandidates(probes, existingEngines)` returning the cards order: running servers first (most models first), then not running, and marking presets that already have an engine at that address as `alreadyAdded`.

VS Code host (`src/ai/`):

- [x] `engineService.ts#detectLocalServers`: parallel GET with a 1.5 s cap each (`AUTO_PROBE_TIMEOUT_MS` style), results never cached longer than the page is open, one log line ("Detect local servers: LM Studio ok (3 models), Ollama no answer…"). Never runs unless the webview asks.
- [x] `webviewBridge.ts`: `aiDetectLocalServers { requestId, candidates }` → `aiEngineProbes { requestId, probes }`; add to `AI_WEBVIEW_MESSAGE_TYPES` and the protocol comment. `src/webview/editor-main.ts` host adapter gains `detectLocalServers`.

Desktop host:

- [x] `commands/ai.rs`: `ai_detect_local_servers(candidates)` with the same cap, resolving the oMLX key file through `secrets::resolve_key_with_file`; `aiApi.ts` and `aiHost.ts` expose it. Register the command in the capabilities file.

UI (`packages/core/src/`):

- [x] Quick-start cards (`ai-engines-page.ts#buildPresetCards`): when the host has `detectLocalServers`, probe on open (and on a small "Look again" link), and give each local card a state: **Running · 3 models** (green dot, the card becomes the primary action), **Not running** (quiet), **Added** (links to the existing engine). Cards keep working without the probe (tier 2 hosts without the method, and tier 1).
- [x] First-run panel (`ai-toolbar.ts#showAiFirstRunPanel`): accept an optional `detect()` promise; while it runs show "Looking for local AI servers…" (no spinner larger than the text); when one is found, the primary button becomes **Use LM Studio** (adds the engine from the preset, fetches models, picks the first chat model as the default route, turns AI on, closes) and "Set up another way…" opens the Engines page as today. When none is found, the panel says "No local AI server found. Install LM Studio or Ollama, or use a cloud API key." and the primary button stays "Set up". Add one line of verbs under the title: "Rewrite, translate, explain, summarize, suggest titles and tags." Keep the Experimental badge and the disclaimer.
- [x] B3: `editor.ts#turnOnAiAndSetUp` no longer saves `ai.enabled` first. The Engines page gets a `turnOnWhenDone?: boolean` option; its Done includes `'ai.enabled': true` in the patch when the result has a usable default route, and the page title line says "AI turns on when you choose Done". Back/Cancel leaves AI off. The one-click path in the panel saves engines, routing and `enabled` in one `saveSettings` patch.
- [x] Tier-1 first-run copy (F11): "Turn on" instead of "Turn on and set up" when `aiHostTier(ai) === 1`.
- [x] Add the new strings to the existing a11y announcements (`announce`) and keep Tab order: card, card…, "Look again".
- [x] Update the module comments in `ai-toolbar.ts` and `ai-engines-page.ts`.

Worker notes: edits `editor.ts` (the turn-on path only). Run `npm run lint`, `npm run test:unit`, `npm run test:packages` before committing; add tests in T1, but keep existing tests green here (`test/unit/ai-toolbar*.test.ts`, `packages/core/test/ai-engines-page*.test.ts`).

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M1b Setup wizard: recommend a path, cloud by default

**Recommended model: Opus** (the first-run flow is the product's front door; a few screens, each with one decision, written and laid out with care).

Added 2026-10-29 from Mike: the wizard guides the user on whether to use local AI at all. Cloud is the default path; local is the advanced path, kept as easy as possible. Depends on M1 (detection host method) and on OQ11 to OQ13.

**Facts from the review that shape this milestone:**

- There is **no `vscode.lm` integration today.** `src/ai/vscodeAi.ts` is the VS Code wiring (engine service, consent modal, settings patch); nothing in `src/` or `packages/core/src/ai/` calls `vscode.lm.selectChatModels`. "Use Copilot" is new work: a new engine kind, not a review of an existing surface.
- There is **no hardware detection** on either host. Desktop has no `sysinfo` crate; VS Code reads nothing from `os`. Both are new, small additions.

Path recommendation (pure core + two host methods):

- [x] `packages/core/src/ai/setup.ts` (pure, exported from `ai/index.ts`): `AiHardwareInfo = { arch: 'arm64' | 'x64' | string; platform: 'darwin' | 'win32' | 'linux' | string; totalMemoryBytes: number; appleSilicon: boolean; gpu?: { vendor: 'nvidia' | 'amd' | 'apple' | 'other'; vramBytes?: number; name?: string } }` and `recommendSetupPath({ running: AiLocalServerProbe[]; hardware: AiHardwareInfo | null; vscodeLm?: { available: boolean; models: number } }) → { path: 'runningLocal' | 'vscodeLm' | 'cloud'; localCapable: boolean; localHint: string; reasons: string[] }`, checked in this order: (a) a running local engine (oMLX, LM Studio `:1234`, Ollama `:11434`, from M1's `detectLocalServers`) → offer it first; (b) `vscode-lm` available (OQ12) → offer it first on VS Code; (c) hardware above the OQ11 threshold → cloud by default with "Local is an option on this machine" shown; (d) otherwise cloud, local under Advanced without the hint. `localHint` is the model-size sentence from OQ11.
- [x] `MikeDownAiHost` gains optional `hardwareInfo?(): Promise<AiHardwareInfo | null>`. **VS Code** (`src/ai/engineService.ts` or a new `src/ai/hardware.ts`, pure Node): `process.arch`, `process.platform`, `os.totalmem()`, `os.cpus()[0].model` (Apple Silicon when `platform === 'darwin' && arch === 'arm64'`); no GPU probe (a rough call is enough; say so in the hint). Bridge message `aiHardwareInfo {}` → `aiHardware { info }`. **Desktop** (`commands/ai/hardware.rs`): add the `sysinfo` crate for total memory and CPU brand; Apple Silicon from `cfg!(target_arch = "aarch64")` on macOS (unified memory = total memory); NVIDIA from `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader` when present on the PATH (Windows and Linux), never failing the call when absent; command `ai_hardware_info`, exposed through `aiApi.ts` / `aiHost.ts`. One log line per host, never more than once per session.
- [ ] Cache the recommendation for the editor session; recompute when the first-run panel or the wizard opens (detection is live, hardware is static).

The wizard (replaces M1's first-run panel body when the user chooses "Set up"; M1's one-click "Use LM Studio" stays as the running-engine shortcut):

- [ ] Mount it on the Engines page as a new initial section `'wizard'` (`AiEnginesPageSection`), so it reuses the session, Done and Back semantics, and the Experimental badge; the first-run panel's "Set up" opens the page on it. Three steps at most, one decision each, a step indicator in the header line, Back returns to the previous step.
- [ ] **Step 1, path:** the recommendation drives the layout. Running engine or `vscode-lm` found → a primary card ("LM Studio is running on this Mac · 3 models" / "Use GitHub Copilot, no key needed") plus "Connect a cloud provider" and, under an **Advanced: run models on this machine** disclosure, the local cards. Otherwise → "Connect a cloud provider" leads (the provider cards from M2's cloud group with the Allow cloud row and privacy card), and local sits under the Advanced disclosure with the hardware line ("Local is an option on this machine: Apple Silicon, 32 GB. Models up to about 30B run well." or "This machine is on the small side for local models; cloud is the easier path.").
- [ ] **Step 2, provider (cloud path):** the cloud preset cards. Picking one opens M2's key-first form inline with a **Subscription vs API key** note above the key field: "Consumer subscriptions such as ChatGPT Plus or Claude Pro do not include API access. An API key is billed separately by the provider, per use. Get a key:" followed by the preset's `keyUrl` and a "Pricing" link (`pricingUrl`, new on `AiEnginePreset`, official page only). The sentence is generic on purpose; the links carry the current facts (verify each at writing time and log the date; no per-provider claims in code).
- [ ] **Step 2, local path (Advanced):** detected engines first (Running / Not running / Added from M1), each not-running card with an **Install** link (`installUrl` on local presets: LM Studio, Ollama, oMLX, llama.cpp, vLLM official download pages) and a one-line "then come back and choose Look again"; after a server answers, the form fetches models and the picker groups them by size when ids carry a parameter count (`7b`, `30b`; pure helper `modelSizeHint(id, hardware)` in `setup.ts` that tags options "fits" / "tight" / "too large" from OQ11's table). Never blocks a pick; the tags are hints.
- [ ] **Step 3, done:** "AI is ready: <engine> · <model>, <local | cloud>", the privacy line for the chosen locality, Done (which turns AI on, per M1's `turnOnWhenDone`). Skipping the wizard at any step leaves AI off.
- [ ] Tier-1 hosts never see the wizard (they have no engines); the first-run panel keeps M1's tier-1 wording.

`vscode-lm` engine kind (VS Code only, OQ12):

- [x] Core: `AI_ENGINE_KINDS` gains `'vscode-lm'` with label "GitHub Copilot (VS Code)"; `expressFields` for it: `name`, `models`, `defaultModel`, `enabled` (no key, no URL); `engineLocality` returns `cloud` for the kind regardless of `baseUrl` (empty), so Allow cloud and consent apply; `capabilityHeuristics` maps `vendor/family` to chat + stream; a preset `vscodelm` in `presets.ts` under a third family `'host'` ("Built into VS Code") that the cards show only when the host reports it (`AiEngineStatus` for the kind reports `ok` from `selectChatModels().length > 0`). Desktop and npm hosts treat the kind as unsupported (the existing "engine kind this version does not support" path), and the Desktop settings parser skips it as today.
- [x] VS Code host: `src/ai/providers/vscodeLm.ts` adapter: `probe` and `listModels` through `vscode.lm.selectChatModels({ vendor: 'copilot' })` (ids `vendor/family`, `maxInputTokens` as `contextTokens`), `complete` through `model.sendRequest(messages, {}, token)` streaming `text` parts, cancellation through a `CancellationTokenSource` tied to the `AbortSignal`, errors mapped (`LanguageModelError.NoPermissions` → `auth` with the message "Allow MikeDown to use Copilot in the VS Code prompt", `Blocked` → `badOutput`, quota → `rateLimited`). The first `sendRequest` triggers VS Code's own consent prompt; MikeDown's consent modal runs before it (two prompts the first time; say so in the wizard card). `package.json`: no new activation event needed; add `"enabledApiProposals"` only if the stable API requires none (check the VS Code version in `engines.vscode`; `vscode.lm` is stable since 1.90).
- [x] Privacy and terms: the preset's `policy` links GitHub Copilot's privacy/data page; the privacy card for this kind says text goes to GitHub's Copilot service under the user's Copilot plan (individual vs business plans differ in data handling; link, do not claim). Consent dialog `host` reads "GitHub Copilot" instead of a URL. Note in the README that this needs a Copilot subscription and the Copilot Chat extension.
- [x] Thinking: `thinkingChoices('vscode-lm')` is empty (no mapping); the dial hides.

Worker notes: edits `ai-engines-page.ts` (new section), `ai-toolbar.ts` (panel hands off to the page), `presets.ts`, `types.ts`, `schema.ts`, `locality.ts`, `capabilityHeuristics.ts`, `src/ai/providers/`, `engineService.ts`, `webviewBridge.ts`, `ai.rs` + `hardware.rs`, `aiApi.ts`, `aiHost.ts`, `package.json` (three-place rule for nothing new unless a setting is added; none is planned). Runs after M1 and M2 on the same files; one `editor.ts` touch (the panel → page hand-off) after M1 lands. Design craft: the wizard must read like a macOS "Add Account" sheet or VS Code's walkthrough, not a form; one primary action per step.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M2 Cloud setup in one place

**Recommended model: Opus** (Engines page layout, the cloud card group with an inline switch, key field states).

Fixes F4, F5 (the switch half), F6, F7, F8, F10, B1, B2. Depends on OQ5 (default: show the cloud cards with the switch inline).

- [x] Engines page, cloud card group: above the cloud cards, a compact row **Allow cloud engines** (switch) with one line: "Text you ask about is sent to the provider over the internet." and a "What this means" disclosure that mounts the privacy card from M3 (until M3 lands, the disclosure shows the existing `AI_EXPERIMENTAL_DISCLAIMER` cloud sentence). Flipping it edits `session.draft.allowCloud`, so Done saves it with everything else. The AI tab keeps its switch; both read the same draft (`ai-settings-session.ts`).
- [x] Adding a cloud engine while Allow cloud is off: the card press adds the engine and the engine head shows an inline note with a **Turn on cloud engines** button instead of the bare "blocked by Allow cloud" pill. The pill stays in the list for engines that remain blocked.
- [x] Key-first form for cloud presets: the key field is the first focused field (already), and under it the preset's `keyHint` becomes a real link (`https://console.anthropic.com/settings/keys`, `https://platform.openai.com/api-keys`, etc., add `keyUrl` to `AiEnginePreset`; hosts open links through the existing `openLink` path, never `window.open`).
- [x] B1: `AiEngineStatus.keySource` gains `'env'`; VS Code `engineService.ts#status` and Desktop `aiHost.ts#statusFor` report it (Rust `EngineInfo.key_source` too). `ai-engine-form.ts#buildKey`: placeholder "Found" and caption "Key found in `ANTHROPIC_API_KEY`. Paste a key to use another one." for `env`; Clear is hidden for env and file sources (there is nothing stored to clear; keep the existing stored-key Clear).
- [x] B2 / F6: `autoFetchDecision` gets `hasKey` in `AutoFetchState`; a cloud `open` with `hasKey && models.length === 0 && neverProbed` fetches. The form's `snapshot()` passes `deps.hasKey(id)`.
- [x] F8: a successful discovery marks the engine's status `ok` with the discovery latency on both hosts (VS Code already does; make Desktop's `ai_discover_models` fill the probe cache too), and `statusBadge` reads "Not tested" only when neither a test nor a fetch has succeeded.
- [x] F10 Desktop env vars: when the host is Desktop (`host.ai` without an `env` capability, or a new `AiEngineStatus.keySources?: ('stored'|'env'|'file')[]` listing what the host can read), the Advanced "Key from variable" caption says "This app does not read shell variables when opened from the Dock; use the key file or paste the key." Choose the simplest signal; document it in `types.ts`.
- [x] Cloud card captions: replace "API key from console.anthropic.com" (repeated in `caption` and `keyHint`) with what the engine is good for in one clause ("Claude models, API key from Anthropic"), since the key hint is now a link under the field.
- [x] Keep `mikedown.ai.allowCloud` registered in all three places; if OQ2 is accepted, change its scope to `machine` in `package.json`, drop the `allowCloud` special case in `vscodeAi.ts#saveAiSettingsPatch`, and update `README.md` ("Cloud is opt-in" bullet).

Worker notes: no `editor.ts` edits expected. Touches `packages/core/src/ai/types.ts`, `presets.ts`, `ai-settings-model.ts`, `ai-engine-form.ts`, `ai-engines-page.ts`, `ai-settings-dom.ts` (card states), `src/ai/engineService.ts`, `packages/desktop/src-tauri/src/commands/ai.rs` and `ai/model.rs`, `packages/desktop/src/host/aiHost.ts`, `package.json`.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## T1 Setup tests

**Recommended model: Sonnet** · **Mode: unit/integration (vitest, host tests, cargo). No screenshots, no hands-on (T3 covers the feel).**

- [x] `packages/core/test/ai-presets.test.ts`: every local preset has a `detectPath` or defaults to `/models`; every cloud preset has a `keyUrl` that parses as `https:`; `rankLocalCandidates` puts running first, most models first, marks `alreadyAdded`.
- [x] `packages/core/test/ai-settings-model.test.ts`: `autoFetchDecision` fetches on cloud `open` with `hasKey` and no models, not when models exist, not when `hasKey` is false; existing cases unchanged.
- [x] `packages/core/test/ai-engines-page.test.ts` (jsdom, fake host): cards render Running / Not running / Added from a fake `detectLocalServers`; the cloud group shows the Allow cloud row and the draft flips; adding a cloud engine while off shows "Turn on cloud engines"; Done without a usable route does not include `ai.enabled`, with one it does when `turnOnWhenDone` is set.
- [x] `packages/core/test/ai-toolbar.test.ts`: first-run panel with a detect promise: "Use LM Studio" primary when found, "Set up" when not, tier-1 wording.
- [x] `test/unit/ai-engineService.test.ts`: `detectLocalServers` caps at the timeout, logs one line, never caches; `status()` reports `keySource: 'env'`.
- [x] `test/unit/ai-webviewBridge.test.ts`: `aiDetectLocalServers` round trip and malformed input.
- [x] `packages/desktop/src-tauri`: `cargo test` cases for `ai_detect_local_servers` (fixture server, timeout) and `key_source` env reporting.
- [x] M1b, `packages/core/test/ai-setup.test.ts`: `recommendSetupPath` order (running local beats `vscode-lm` beats hardware beats cloud), the OQ11 threshold edges (16 GB Apple Silicon yes, 8 GB no, 32 GB x64 yes, NVIDIA 8 GB yes), `localHint` per memory band, `modelSizeHint` tags for `7b`, `30b`, `70b` ids and ids without a size; every cloud preset has `pricingUrl` and every local preset `installUrl` under `https:`; no string in `setup.ts` names a subscription as including API access.
- [ ] M1b, `packages/core/test/ai-engines-page.test.ts`: the wizard section renders the running-engine card first when a probe answers, the cloud-first layout otherwise, local under Advanced with the hardware line, the subscription note above a cloud key field, step Back/Next, and Done only turns AI on with a usable route.
- [x] M1b, `test/unit/ai-hardware.test.ts`: VS Code `hardwareInfo` from faked `os` and `process` values; `test/unit/ai-vscodeLm.test.ts`: the adapter against a fake `vscode.lm` (list, stream, cancel, `NoPermissions` → `auth`); `cargo test`: `ai_hardware_info` with and without `nvidia-smi` on the PATH.
- [x] `npm run lint`, `npm run test:unit`, `npm run test:edge`, `npm run test:packages`, `cargo test` all green; record the run in the Progress Log.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M3 Privacy copy and provider policy links

**Recommended model: Opus** (copywriting that must be accurate and calm, plus a small card component used on four surfaces).

Fixes P1, P2, P8, B7, U10. Depends on OQ4 (default: one neutral sentence plus the link per provider).

Pure copy module, `packages/core/src/ai/privacy.ts` (exported from `ai/index.ts`, no DOM):

- [x] `AI_CLOUD_PRIVACY` with: `leaves` ("Text you ask about is sent over the internet to the provider and processed on their servers."), `terms` ("API traffic is covered by the provider's API terms, which differ from its consumer apps. Whether it is retained or used for training is set by those terms and may change; read them before you decide."), `local` ("A local engine keeps everything on this machine or your network."), `keys` ("Your API key stays in this app's secure storage on this machine."). No provider-specific claims about training or retention in code.
- [x] Per cloud preset in `presets.ts`: `policy: { label: 'Anthropic privacy and data use', url: 'https://…' }` pointing at the provider's **official** API data-use or privacy page (worker verifies each URL exists at the time of writing and records the check date in the Progress Log; the plan does not hardcode them here). OpenRouter's note says it routes to many providers; the link is OpenRouter's own policy.
- [x] `whatIsSent(feature)` → a sentence per feature id for the consent dialogs and the popover footer tooltip: rewrite, explain and translate (selection) "the selected text and the paragraph before and after it"; translate (document), summary, title "the whole document, up to what fits the model"; frontmatter (Properties) "the document, its frontmatter and the tag names used in this workspace". `AI_FEATURES` in `features.ts` gains a `sends` key so this is data, not a switch.
- [x] `aiConsentText({ engineName, host, feature, scopeWord })` → `{ title, body, allow, notNow, never? }`, the single source for both hosts' dialogs (VS Code modal, Desktop native dialog). The body: what is sent, where, `terms`, "You can use a local engine instead." and the policy label with its URL spelled out in text (native dialogs cannot link).

UI, `packages/core/src/ai-settings-dom.ts` and callers:

- [x] `privacyCard(preset?)`: the four `AI_CLOUD_PRIVACY` lines, the preset's policy link (opens through the host's `openLink`), styled like the quiet notes already on the page (no warning triangle; a cloud glyph). Used by: the Engines page cloud group disclosure (M2), a cloud engine's form head (collapsed, "What is sent" disclosure), the AI tab's Allow cloud row (replaces the current one-line note), and the first-run panel when the user picks "Set up another way…" (one line plus "Learn more" that opens the page).
- [x] `AI_EXPERIMENTAL_DISCLAIMER`: keep the experimental sentences; replace the cloud clause with `AI_CLOUD_PRIVACY.leaves` and add `local`. When `host.ai.requestCloudConsent` is absent (OQ9), drop the "asks before" wording wherever it appears (`ai-settings.ts` Allow cloud note).
- [x] Popover footer badge (`ai-rewrite.ts`): the cloud badge's tooltip adds `whatIsSent(feature)` and the engine host; the sidebar chip tooltip does the same for the last request.

Hosts:

- [x] VS Code `vscodeAi.ts#askCloudConsent`: build from `aiConsentText`, add a third item **Read the provider's policy** that opens the URL with `vscode.env.openExternal` and asks again (the modal returns; loop until Allow or Not now). Keep it a modal warning message (host UI).
- [x] Desktop `ai.rs#ai_request_cloud_consent`: same text (port `aiConsentText` to Rust next to the existing `text` string, with a shared fixture in `test/ai-fixtures/consent/` so both hosts render the same words), buttons "Allow for this folder" / "Not now"; the policy URL is in the body. The Engines page privacy card is the linkable place on Desktop.
- [x] VS Code `README.md` and `packages/desktop/README.md`: a **Privacy** subsection under the AI section with the four lines and a sentence on how to read the provider's policy from the app. (M6 reviews the wording with the rest of the docs.)

Worker notes: no `editor.ts` edits beyond passing `openLink` into the settings context if it is not already there (check `settingsSectionContext`). Copy must avoid claims about any provider's training policy; "may" and "see the policy" are the words.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M4 Consent flow hardening

**Recommended model: Sonnet** (well-defined host work on both sides; the small Cloud consents list on the AI tab is a plain list, pattern already on the page).

Fixes P3, P4, P5, P6, P7, B4, B5, B6. Depends on OQ1, OQ2, OQ3 (defaults: app-data consent on Desktop; `allowCloud` machine scope; a third "Not for this workspace" answer with a visible list).

VS Code:

- [x] Consent key includes the engine fingerprint: `mikedown.ai.consent.<engineId>` stores `{ fingerprint, answer: 'allow' | 'never', at }`; `engineService.ts#ensureConsent` treats a fingerprint mismatch as "never asked" (B4). `settingsChanged` forgets consent for removed engines (already) and for fingerprint changes.
- [x] OQ3: `askConsent` returns `'allow' | 'never' | 'notNow'`; `never` is stored and makes the route `consentDenied` without asking; `notNow` is session-only (unchanged). `ConsentStore` API grows accordingly; `AiConsentState` already carries `false`, map `never` to it.
- [x] B6: `requestCloudConsent` rejects with `cloudBlocked` when `allowCloud` is off, matching Desktop; `webviewBridge.ts` already posts `aiError` for a rejection, so the webview shows "Cloud engines are off".
- [x] `listConsents()` on the service (engine id, answer, at) and a bridge message `aiListConsents` → `aiConsents`, plus `aiForgetConsent { engineId }`. Document in `webviewBridge.ts` and `editor-main.ts`.
- [x] OQ2: `mikedown.ai.allowCloud` scope `machine` in `package.json` (and the CLAUDE.md Settings rule sentence gains "and `mikedown.ai.allowCloud`"; the worker edits CLAUDE.md only for that sentence).

Desktop:

- [x] OQ1: consent moves to `<app-data>/ai-consent.json` keyed by canonical folder path and engine id, with the engine fingerprint and answer; `read_folder_consent` reads the old `ai.consent.*` key once as a migration, then `write_folder_consent` is retired and the old keys are removed from the folder file on the next write (B5). `aiSettings.ts#aiSettingsFromFlat` keeps stripping `ai.consent.*` for old files.
- [x] Three answers in the native dialog (`MessageDialogButtons::YesNoCancelCustom` or two dialogs if the plugin lacks three custom labels; pick what Tauri 2's dialog plugin offers and note it in the summary).
- [x] `ai_list_consents` and `ai_forget_consent` commands; `aiApi.ts` / `aiHost.ts` expose them as `listConsents` / `forgetConsent` on `MikeDownAiHost` (optional methods).

Core and UI:

- [x] `MikeDownAiHost` gains optional `listConsents?()` and `forgetConsent?(engineId)`; `AiConsentRecord` type in `types.ts`.
- [x] AI tab (`ai-settings.ts`): a **Cloud consents** row under Allow cloud, shown when the host has `listConsents`: one line per record ("Anthropic · this workspace · Allowed · Forget"), empty text "No cloud engine has been allowed here." Forget calls the host and refreshes.
- [x] `ai-request.ts`: a `never` answer from the host is written into `ctx.consent` as `false` for the session so the menu entries disable with the router's reason, not a re-ask.
- [x] P7 (OQ9): no code change beyond M3's wording; add a line to `packages/core/README.md` (or the AI section of the npm docs, wherever `requestCloudConsent` is documented) that a host without it sends to cloud engines without asking.

Worker notes: `editor.ts` is touched only to pass the two new host methods through `aiSessionOptions`; coordinate with M5 (sequential). Update the protocol comment blocks on both hosts.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## T2 Privacy and consent tests

**Recommended model: Sonnet** · **Mode: unit/integration (vitest, host tests, cargo), with the shared consent fixture read by both hosts. No screenshots, no hands-on.**

- [x] `packages/core/test/ai-privacy.test.ts`: `whatIsSent` has a sentence for every `AI_FEATURES` id; `aiConsentText` output matches `test/ai-fixtures/consent/*.json` (title, body, buttons) for rewrite, summary, frontmatter on both scope words; every cloud preset has a `policy.url` under `https:`; no string in `privacy.ts` or `presets.ts` contains "does not train", "never trains" or "not used for training" (a guard against stale claims).
- [x] `packages/desktop/src-tauri` `cargo test`: the Rust consent text renders the same fixtures byte for byte.
- [x] `test/unit/ai-engineService.test.ts`: fingerprint change voids consent; `never` is stored and routes `consentDenied` without asking; `notNow` asks again; `requestCloudConsent` rejects `cloudBlocked` when Allow cloud is off; `listConsents` / forget round trip.
- [x] `test/unit/ai-webviewBridge.test.ts`: `aiListConsents`, `aiForgetConsent`.
- [x] `cargo test`: app-data consent store read/write keyed by folder and engine; migration from a folder file with `ai.consent.<id>` (key removed after); deleted engine leaves no record (only after Forget on Desktop; pruning on delete is a gap, sent to M1b-b); three answers.
- [x] `packages/core/test/ai-settings.test.ts`: the Cloud consents row renders records and the empty text; Forget calls the host.
- [x] `test/unit/settings.test.ts` (or wherever `package.json` scopes are asserted): `mikedown.ai.allowCloud` and `mikedown.ai.engines` are `machine` scope.
- [x] Full suites green (`lint`, `test:unit`, `test:edge`, `test:packages`, `cargo test`); record in the Progress Log.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M5 UI polish: surfaces, naming, states, keyboard

**Recommended model: Opus** (interaction consistency and naming across five surfaces; every change is user-facing).

Fixes F9, U1 to U9. Depends on OQ7, OQ8, OQ10 (defaults: same list everywhere; no new default keys; "Tasks").

Same list everywhere (U1, OQ7):

- [ ] `ai-toolbar.ts#aiToolbarMenuEntries`: one flat list in this order: Rewrite selection, Explain selection, Translate…, separator, Summarize document…, Suggest titles…, Suggest properties, separator, Thinking row (move it to the bottom, where it reads as a setting), separator, Manage engines… / AI settings…. Selection entries disabled with "Select text first"; each entry carries the router's reason when disabled (already the pattern).
- [ ] `contextmenu.ts#buildAiRewriteEntries`: the `AI` submenu gains, after the rewrite groups, a separator and "Summarize document…", "Suggest titles…"; with an empty selection the submenu shows only those two (today the whole entry is omitted). `editor.ts` passes `summarize` and `titles` callbacks into `ContextMenuActions.aiRewrite`.
- [ ] Desktop menus and VS Code commands already have all six; make the labels match the toolbar words (VS Code `package.json#contributes.commands` titles, Desktop menu items), and add `mikedown.ai.suggestProperties` to the Desktop menu if missing.

Naming (U3, OQ10):

- [ ] "Routing" → **Tasks** on the Engines page nav, title ("Which model does what") and the AI tab's "Change…" target; `ai-routing-section.ts` keeps its file name. The chip's "AI: no route" → "AI: no model chosen". Star tooltip "Use this engine by default". "Fetch models" → "Refresh models" once a list exists (first time stays "Fetch models"). "Model default" → "Default".
- [ ] Length group: keep both Longer and Add detail only if they produce different prompts (they do: `expand` vs `longer`); make the labels explain it: "Longer" and "Add detail (facts and examples)" as the tooltip, not the label.

Error and loading states (F9, U5, U6):

- [ ] `AiErrorCopy.action` gains `'openEngine'`; the popover's **Open AI settings** button becomes **Open <engine name>** for `unreachable`, `auth` and `modelNotFound` when the error carries the route, and opens the Engines page on that engine (`deps.openSettings(engineId?)` → `showAiEnginesPage({ initial: { engineId } })`). `auth` copy names the engine: "Anthropic refused the API key."
- [ ] Sidebar Suggest button: a running state (the sparkle pulses or is replaced by the existing spinner) and `aria-busy`; the disabled reason also goes into the chips row as text so keyboard users can read it.
- [ ] Toolbar AI button: while a request is running anywhere in this editor, the button gets a subtle running state (the same pulse); no new layout.

Settings modal AI tab (U8):

- [ ] Reorder: intro, master switch, Engines summary (with the default model line), Allow cloud (+ consents from M4), toolbar button switch, Features (task pickers folded under an "Advanced: task per feature" disclosure).

First-run panel (U9) and chip (U7):

- [ ] The verbs line from M1 stays; add "Local engines keep your text here; cloud engines send it to the provider." under the disclaimer when space allows (one line).
- [ ] `openAiFromChip`: the tooltip says what it opens ("Click to choose a model" when `tone === 'none'`, "Click for AI settings" otherwise).

Keyboard (U2, OQ8):

- [ ] Thinking dial (popover and toolbar row): arrow keys move between segments and the live region announces "Thinking: High"; `role="radiogroup"` with `aria-checked` if not already.
- [ ] VS Code: no new default keybindings; make sure each `mikedown.ai.*` command has a `when` of `mikedown.editorActive` so the palette shows them only in MikeDown. Desktop: menu items get mnemonics where the platform supports them.
- [ ] Every new or renamed string is reflected in `test/` and `packages/core/test/` expectations (run the suites; fix labels in tests, not behaviour).

Worker notes: this is the milestone that edits `editor.ts` the most (`openAiToolbar`, context menu actions, `openAiFromChip`, popover deps). Runs after M1 and M4 have merged. Apply genuine front-end craft: spacing and rhythm match the existing Engines page and popover (quiet notes, 10 px glyphs, `settings-btn` variants), no new colours outside `tokens.css`, transitions only where the page already has them.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## M6 Docs, settings sync, release notes

**Recommended model: Sonnet.**

- [ ] `package.json#contributes.configuration`: descriptions of `mikedown.ai.allowCloud` (scope and the consent sentence), `mikedown.ai.enabled` ("turns on when setup finishes" if M1 changed it); any new key from M1 to M5 is present with schema and default; `src/settings.ts` reads it; the Settings UI shows it (three-place rule audit, one checkbox per key, list them in the summary).
- [ ] `README.md` AI section: the one-click local path, the cloud path (key, Allow cloud, consent), the Privacy subsection (from M3), the consents list (M4), the renamed Tasks page. `packages/desktop/README.md`: consent now in app data (OQ1), the Dock env-var note. `website/vscode/index.html` AI paragraph matches.
- [ ] `CHANGELOG.md` (Unreleased): one entry per user-visible change in M1 to M5, grouped Setup / Privacy / Polish.
- [ ] `ai-inference-engines-plan.md` "Follow-up plans" and `ai-writing-features-plan.md` "Follow-ups": add a line pointing at this plan for the items it absorbed (no other edits to those plans).
- [ ] `docs/` (contributor docs from `a5c54e5`): the new host methods (`detectLocalServers`, `listConsents`, `forgetConsent`), the privacy module, and the protocol messages.
- [ ] `RESUME.md`: not edited by this milestone (the session owner updates it).

[Return to Top](#ai-setup-privacy-polish-plan)

---

## T3 Hands-on sign-off

**Recommended model: Sonnet** · **Mode: hands-on (interactive workflows: detection, one-click setup, cloud key, consent, errors) after the full automated suites. No screenshot review: Mike judges the look during the walk-through.** The orchestrator pauses for Mike's sign-off at the end.

Automated first:

- [ ] `npm run lint`, `npm run test:unit`, `npm run test:edge`, `npm run test:packages`, `cargo test` in `packages/desktop/src-tauri`, all green at the final `develop` sha (record it).

VS Code (`npm run dev` in `/Users/michaeljosephwork/git/mikedown`, dev host on `test/workspace`; open `test/workspace/sample.md` with MikeDown; the output channel is **MikeDown AI**). Start LM Studio with a chat model loaded and oMLX; keep Ollama off.

- [ ] Fresh state (set `mikedown.ai.enabled` false, `engines` `[]` in user settings): click the toolbar AI button → the panel says "Looking for local AI servers…" then offers **Use LM Studio** (or oMLX, whichever ranks first); one click → AI on, the sidebar chip reads `AI: local · LM Studio · <model>`; select a sentence, `Cmd+Alt+K`, Shorter streams; `Cmd+Z` restores. Judge the panel's look here.
- [ ] Open the Engines page: cards show Running / Not running / Added; "Look again" after stopping LM Studio flips it to Not running within 2 s.
- [ ] Wizard (M1b): reset to fresh state with every local server stopped, click the AI button, "Set up": step 1 leads with "Connect a cloud provider" and, on this Mac Studio, the Advanced disclosure shows the hardware line (Apple Silicon, memory, model-size hint); open it, LM Studio card shows Not running with an Install link that opens the browser. Start LM Studio, "Look again", the card flips to Running and moves to the top. Step 2 on the cloud path: pick OpenAI, the subscription-vs-API-key note sits above the key field and both links open official pages. Judge the wizard's look here (one decision per step, no form feel).
- [ ] Copilot (M1b, OQ12): with Copilot Chat signed in, the wizard's first card is "Use GitHub Copilot, no key needed"; pick it, Done; Rewrite → MikeDown's consent modal names GitHub Copilot, then VS Code's own Copilot permission prompt the first time; the stream lands and the chip reads `AI: cloud · GitHub Copilot · <model>`. Sign out of Copilot: the engine's dot turns Failed with "Allow MikeDown to use Copilot" wording and the rewrite entry disables with that reason.
- [ ] Add Anthropic from the cloud card with Allow cloud off: the inline **Turn on cloud engines** note appears; the privacy card reads correctly and its policy link opens the browser; paste a real key; models fill without a click; Done. Select text, Rewrite → the consent modal shows the M3 text (what is sent for Rewrite), **Read the provider's policy** opens the browser and the modal returns; **Not for this workspace** → the menu entry disables with the reason; AI tab → Cloud consents lists it; Forget; rewrite again → **Allow for this workspace** streams; `/summary` → no second modal (same engine, same workspace); check the output channel shows `cloud`.
- [ ] Edit the Anthropic base URL under Advanced to `https://openrouter.ai/api/v1`, Done, rewrite: the consent modal asks again (fingerprint changed).
- [ ] Set `ANTHROPIC_API_KEY` in the shell that launches the dev host, delete the stored key with Clear: the field says "Found in ANTHROPIC_API_KEY", no Clear button, models still fetch on open.
- [ ] Stop oMLX, route rewrite to it, rewrite: the popover error says "Engine not reachable" with **Open oMLX** → lands on the oMLX form.
- [ ] Context menu with a selection: `AI` submenu has the rewrite groups plus Summarize and Suggest titles; without a selection: only the two document items. Toolbar menu: all seven entries, Thinking at the bottom; arrow keys on the dial announce the level (VoiceOver on, one check).
- [ ] Add a `.vscode/settings.json` to `test/workspace` with `"mikedown.ai.allowCloud": true`: it has no effect (machine scope), and the AI tab shows the user value. Remove it afterwards.

Desktop (quit `/Applications/MikeDown.app`; `export PATH="$HOME/.cargo/bin:$PATH"; npm run dev` in `packages/desktop`; open `test/workspace`):

- [ ] First run from the Dock-like state (no shell env; launch the built app, not `npm run dev`, for this one check): the oMLX card says Running (key file read); the Advanced "Key from variable" caption carries the Dock note.
- [ ] Wizard on Desktop (M1b): the hardware line reads from Rust (Apple Silicon, unified memory; check the stderr `[mikedown ai]` line shows it once); no Copilot card anywhere on Desktop; the `vscode-lm` kind, if present in exported settings, shows as "not supported by this version" and is never routed.
- [ ] Consent on Desktop: the native dialog shows the M3 text with the policy URL spelled out, three answers; **Allow for this folder** writes `<app-data>/ai-consent.json` (open it in a text editor and confirm the folder path and engine id), and `test/workspace/.mikedown/settings.json` has no `ai.consent.*` key; opening a second folder asks again.
- [ ] Migration: hand-write `"ai.consent.<id>": true` into a folder's `.mikedown/settings.json`, open it: no dialog on the first cloud request, and the key is gone from the folder file afterwards.
- [ ] Delete the Anthropic engine: the consents list no longer shows it; the keychain entry under `net.iadev.mikedown` is gone (Keychain Access).

- [ ] Orchestrator pauses for Mike's sign-off; findings go into the Progress Log and are fixed here or listed under a follow-up.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## T4 Fresh-user onboarding walk (Mike)

**Who: Mike, hands-on.** Added 2026-10-29 at Mike's request. Runs after T3 and every automated suite, **before the AI release**. Mike experiences onboarding as a brand-new user, with nothing from his own setup preconfigured (no oMLX engine, no stored keys, no routing). The orchestrator prepares the clean slate and a walk checklist, then pauses for Mike.

Clean-slate prep (orchestrator or a Sonnet worker, nothing destructive to Mike's real setup):

- [ ] VS Code: a throwaway profile or `--user-data-dir` plus `--extensions-dir` so `mikedown.ai.*`, SecretStorage and `workspaceState` start empty; no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` in the launching shell. Document the exact launch command.
- [ ] Desktop: a fresh app-data directory (or a renamed copy of the real one, restored afterwards), no keychain entries under `net.iadev.mikedown`, no consent file.
- [ ] oMLX: hide its key file (`~/.omlx/settings.json`) from detection for the cloud part, or stop oMLX, so the first run truly sees nothing local; restore afterwards. Record what was moved and how to put it back.

Walk (Mike), on VS Code first, then Desktop:

- [ ] Cloud 1: from "AI off", connect **OpenAI** with an API key through the wizard; Allow cloud, privacy card, consent, first rewrite.
- [ ] Cloud 2: add **Anthropic** with a key; make it the default for one task.
- [ ] Cloud 3: add **DeepSeek** with a key (preset `deepseek`).
- [ ] Local: start LM Studio and/or oMLX (restore its key file), then go through the local path (detection, one-click, Advanced cards, Install links, model size hints).
- [ ] Findings go into the Progress Log; fixes before the release, or a follow-up list Mike signs off.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## Parallel Development Recommendations

Sequential blockers: **M1 and M4 both edit `editor.ts`** (M1 the turn-on path, M4 the session options) and **M5 edits it most**; never two of those at once. M3 is pure copy plus host dialogs and can run beside M1. M2 depends on M3 only for the privacy card (it ships a placeholder disclosure until M3 lands) and on M1 for nothing.

| Group | Milestones | Notes |
|---|---|---|
| A (now) | M1, M3 | Different files; M3 touches `vscodeAi.ts` and `ai.rs` consent text, M1 touches `engineService.ts`, `webviewBridge.ts`, `ai.rs` detection and `editor.ts`. Both touch `ai.rs`: M1 adds a command, M3 edits the dialog text; rebase before commit. |
| B (after A) | M2, M4 | M2 is UI and `engineService.ts#status`; M4 is `engineService.ts` consent plus `ai.rs` consent store and one `editor.ts` line. Both edit `engineService.ts`: assign M4 the consent section and M2 the status section, rebase before commit. |
| B2 (after B) | M1b | Builds on M1's detection and M2's cloud group and form; alone on `ai-engines-page.ts`, `presets.ts` and the providers. Its `vscode-lm` adapter and `hardware.rs` could be split to a second worker (no shared files with the wizard UI) if time matters. |
| C | T1 after M1, M2 and M1b; T2 after M3 and M4 | Tests can run in parallel with each other. |
| D (after B2 and C) | M5 | Alone on `editor.ts`. |
| E (after D) | M6, then T3, then T4 | M6 can start as soon as M5's strings are final. T4 is Mike's clean-slate walk, last before the release. |

Worktrees start from a stale commit: `git reset --hard <develop sha>` first, `npm run build:core` before `test:unit`; `test:integration` cannot run in a worktree. Workers commit only their own paths.

Orchestrator context: dispatching several prompts can fill the orchestrator's context. When that happens, prompt the user to run `/compact` while workers run; the orchestrator monitors its own usage and suggests compacting before the limit, then resumes from `.orchestrator/state.json`. Teammate idle notifications often repeat a finished worker's report; check `.orchestrator/ai-setup-privacy-polish-plan/processed/` before reprocessing.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## Gap-Filling Prompts

When a milestone comes back with items skipped or partly done, the orchestrator writes a follow-up prompt that:

- Follows the same structure as the original milestone prompt (header, mission statement, reference to this planning document and the milestone section).
- States what the first attempt completed, which files it changed (from its summary and `git log -- <paths>`), and which checkboxes remain.
- Lists the other active workers and their directories so paths do not collide.
- Is labelled "Worker Context: <Milestone name> - Gap Fill".
- Ends with the standard completion steps: commit the code (own paths only, no AI attribution), write `.orchestrator/ai-setup-privacy-polish-plan/worker-summary-<milestone-slug>-gap.md`, then prompt the user to clear the context.

[Return to Top](#ai-setup-privacy-polish-plan)

---

## Progress Log / Notes

**2026-10-29 08:40** - T1 done (`405f787` in the worktree, cherry-picked to develop as `79fbfa3`, 14 min, tests only). New files: `ai-engines-page-setup`, `ai-toolbar-first-run`, `ai-local-setup`, `ai-presets` tests in core, `test/unit/ai-hardware`, `ai-webviewBridge`, extensions of `ai-setup`, `ai-vscodeLm`, `ai-engineService`, cargo `hardware.rs` / `command_layer.rs`. Extras: Discard after `lookUpKey`, the oMLX/vLLM `:8000` ranking, one-click cleanup on failure. Worktree: test:unit 3077, test:edge 22, test:packages 83, cargo 267, lint 0 errors. The wizard-section test box is M1b-b's. Bug found: on an 8 GB NVIDIA card the hint says "up to about 8B" while `modelSizeHint` tags 7b `tight` and 8b `too large` (`it.fails` in `ai-setup.test.ts`); sent to M1b-b to make hint and tags agree.

**2026-10-29 08:25** - Dispatched M1b-b (wizard UI, Opus, main tree; also writes the wizard's own tests, the Copilot privacy card variant, `aiConsentStepNote` on the cloud group, `aiPendingBadgeTitle`, the Copilot consent wording and Desktop consent pruning on engine delete) and T1 (Sonnet, worktree; every T1 box except the wizard tests).

**2026-10-29 08:20** - M1b-a done (`dbe2a23`, 17 min): `ai/setup.ts` (`recommendSetupPath`, `modelSizeHint`, OQ11 bands, `hardwareLine`), `hardwareInfo` on VS Code (`src/ai/hardware.ts`) and Desktop (`hardware.rs`, `sysinfo`, `nvidia-smi`), `pricingUrl` / `installUrl` on presets (checked 2026-10-29; Groq pricing now a console billing FAQ because `groq.com/pricing` redirects home; re-check before release), the `vscode-lm` kind with `src/ai/providers/vscodeLm.ts`, a `host` preset family, `detectHostEngines` (VS Code), policy by kind, `aiConsentHost`. Main tree with M4 and T2: lint 0 errors, test:unit 2955, test:packages 83, Desktop 571, cargo 223+26+7. Notes: a `vscode-lm` engine is routable only where `listEngines` reports a status for it (Desktop leaves it out); Copilot ignores `maxTokens` / temperature, sends the system prompt as the first user message; consent body reads "GitHub Copilot is a cloud engine at GitHub Copilot." (fixture wording, left for M1b-b). Left for M1b-b: the privacy card's API key line for Copilot (`ai-settings-dom.ts`), `editor.ts#aiPendingBadgeTitle` → `aiConsentHost`.

**2026-10-29 08:12** - T2 done (`55c3493` in the worktree, cherry-picked to develop as `e46dda9`, 6 min, tests only). New: `test/unit/ai-consent-bridge.test.ts`, `test/unit/ai-settings-scope.test.ts`, cases in `ai-privacy`, `ai-settings`, `ai-engineService` tests and Rust `consent.rs` / `consent_store.rs`; much was already covered by M3/M4. Worktree: lint 0 errors, test:unit, test:edge, test:packages, cargo green. Gap found: Desktop never prunes `ai-consent.json` records when an engine is deleted (only Forget removes one), against B5's intent and T3's "Delete the Anthropic engine" check. Assigned to M1b-b.

**2026-10-29 08:00** - M4 done (`36ac87a` in the worktree, cherry-picked to develop as `e73e2c2`, 15 min; one import conflict in Desktop `aiApi.ts`). Consent is keyed by engine fingerprint with `allow` / `never` answers (B4); three answers on both hosts (OQ3); `cloudBlocked` on VS Code when Allow cloud is off (B6); `listConsents` / `forgetConsent` with a Cloud consents row on the AI tab; Desktop consent in `<app-data>/ai-consent.json` with migration from folder files (OQ1, B5); `allowCloud` machine scope plus the CLAUDE.md sentence (OQ2); `openLink` into `settingsSectionContext` and the badge tooltip (M3 follow-ups); AI tab checkbox re-sync and the shared `aiConsentStepNote` (M2 follow-ups). Worktree run: lint 0 errors, test:unit 2885, test:packages 83, Desktop 570, cargo green. Behaviour changes: existing VS Code users get one extra consent prompt per cloud engine (old bare `true` has no fingerprint); Desktop legacy folder consent migrates on first lookup and is removed from the folder file, so an older build on another machine asks again; `ai_request_cloud_consent` now returns a string answer. Leftover → M1b-b: point M2's cloud card in `ai-engines-page.ts` at `aiConsentStepNote`. Main-tree suites after the merge run with M1b-a's commit (it was already editing the tree).

**2026-10-29 07:45** - M1b split in two (Parallel table allows it): M1b-a (backend: `setup.ts`, `hardwareInfo` on both hosts, `vscode-lm` kind, preset `installUrl`/`pricingUrl`; Opus, main tree) starts now beside M4; M1b-b (the wizard UI, touches `editor.ts`) waits until M4 has merged, so no two workers edit `editor.ts` at once.

**2026-10-29 07:40** - M2 done (`a78eaf4`, 45 min). The Engines page cloud group has the Allow cloud switch and M3's `privacyCard` under "What this means"; a cloud engine added while cloud is off gets a **Turn on cloud engines** note; `keyUrl` links; B1 (`keySource: 'env'` on both hosts and in Rust), B2 (auto-fetch with a key), F8 (Desktop discovery fills the probe cache), the F10 Dock caption, new cloud card captions; `privacyLine` in the first-run panel. The OQ2 scope change was delegated to M4. Lint 0 errors, test:unit 2887, test:packages 83, Desktop 570, cargo 204+26+7. Sent to M4: re-check the AI tab's Allow cloud box after the page flips it, and one shared consent-sentence constant. Note: `lookUpKey` saves the engine to host settings on a card click, before Done (taken back on Discard), so T1 should test Discard. M6: mention env-var keys and the Dock key-file note.

**2026-10-29 07:15** - M3 done (`b7d8793` in the worktree, cherry-picked to develop as `f5b48a7`, 16 min). `ai/privacy.ts` (four lines, `whatIsSent`, `aiConsentText`), `policy` on every cloud preset (all seven URLs answered 2026-10-29), Rust port `consent.rs` with the shared fixture `test/ai-fixtures/consent/`, VS Code modal with Read the provider's policy, `privacyCard` on the AI tab and cloud engine forms, README Privacy subsections. B7 fixed (`requestCloudConsent(engineId, { feature, sends })`). Merge: 7 keep-both conflicts with M1 (presets, `ai.rs`, Desktop `aiApi`/`aiHost`, bridge, vsCodeHost, protocol comment); main tree after merge: compile ok, lint 0 errors, test:unit 2871, test:packages 83, Desktop typecheck + vitest 569, cargo 202+26+7. Follow-ups assigned: pass `openLink` into `settingsSectionContext` and the badge tooltip host in `editor.ts#aiBadge` → M4 (the editor.ts worker of group B); `privacyLine` in M1's "Set up another way…" panel path → M2; `vscode-lm` policy looked up by engine kind → M1b.

**2026-10-29 06:46** - M1 done (`7d9ea11`, 14 min). Detection on both hosts (1.5 s cap, only on the panel and cards), Running / Not running / Added cards with Look again, one-click "Use LM Studio", B3 and F11 fixed. Lint clean, test:unit 2839, test:packages 83, Desktop vitest 569, cargo 233. Notes: one-click saves the engine quietly before fetching models (hosts need it), then one patch with engines, routing and `ai.enabled`; the oMLX key is sent only to oMLX's own address after a 401; oMLX and vLLM share `:8000` (a keyless vLLM shows Running on both cards). Follow-up for M6: CLAUDE.md says the protocol comment is in `packages/core/src/editor-main.ts`, it's `src/webview/editor-main.ts`. New tests are T1's.

**2026-10-29 06:50** - Added T4: Mike's fresh-user onboarding walk (clean slate, OpenAI, Anthropic, DeepSeek keys, then local) after T3 and all automated tests, before the AI release.

**2026-10-29 06:35** - Orchestrator started. Mike accepted all 13 open-question recommendations (OQ12 Copilot included). Group A dispatched: M1 (main tree) and M3 (worktree), both Opus.

**2026-10-29 02:40** - Added M1b (setup wizard: path recommendation, cloud by default, local under Advanced, subscription vs API key note, `vscode-lm` engine kind) from Mike's request via team-lead, plus OQ11 to OQ13, T1 and T3 items and parallel group B2. Review facts recorded in M1b: no `vscode.lm` integration exists today (`src/ai/vscodeAi.ts` is wiring only) and neither host has hardware detection code.

**2026-10-29 02:15** - Plan written after one review pass over the AI features on `develop` (`42a8983`). Findings: eleven setup friction points, eight privacy gaps, ten polish items, seven bugs (listed, not fixed). Six milestones, three test milestones, ten open questions for Mike. No code changed.

[Return to Top](#ai-setup-privacy-polish-plan)
