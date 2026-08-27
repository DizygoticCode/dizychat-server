# Burn Memory Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the v1.12.3 Curated burn engine so locally stored safe history is retrieved, reduced to one conversational angle, freshly worded, novelty-checked, and then sent through the existing output/safety boundaries.

**Architecture:** Keep the IndexedDB transcript and curated-v2 profile/store intact. Add bounded safe-memory context, explicit one-angle selection, local composition variants, compact novelty metadata, and a structured safe context for the existing custom generator seam. Do not add a third-party model dependency or weaken existing trigger, cooldown, sensitive-data, threat, quote-back, or 200-character output controls.

**Tech Stack:** Tampermonkey userscript JavaScript, browser IndexedDB/localStorage, Node.js 22 source-regression tests.

**Spec:** `docs/superpowers/specs/2026-08-27-burn-memory-intelligence-design.md`

## Global Constraints

- Public-chat history stays local in the browser.
- Sensitive/personal/contact/network/health/bereavement material never enters selected burn memory.
- Exactly one primary angle is selected for each Curated reply.
- Existing seeds remain fallback material.
- Existing output boundaries and automatic trigger/cooldown controls remain authoritative.
- No direct external LLM/API credential handling is added.
- Existing curated-v2 users/history/seed-usage data loads without loss.

---

### Task 1: Add memory-intelligence regression contracts

**Files:**
- Create: `scripts/tests/rumble-burn-memory-intelligence-source.test.mjs`
- Modify: `scripts/tests/rumble-userscript-version-source.test.mjs`

**Interfaces:**
- Consumes: current monolithic userscript source.
- Produces: regression contracts for `buildBurnMemoryContext`, `chooseBurnMemoryAngle`, `composeMemoryBurn`, novelty metadata, custom-generator safe context, and v1.12.4.

- [ ] **Step 1: Write the failing tests**

Add source-regression assertions proving the new stages exist and are wired in this order: safe retrieval → one-angle selection → composition → novelty rejection; assert bounded evidence arrays, blocked/sensitive filtering before selection, recent response/angle/family metadata, and custom generator receiving a structured safe context rather than raw transcript history.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --test scripts/tests/rumble-burn-memory-intelligence-source.test.mjs scripts/tests/rumble-userscript-version-source.test.mjs`
Expected: FAIL because v1.12.3 has none of the new helper names/metadata and version remains 1.12.3.

- [ ] **Step 3: Commit only the RED regression tests**

Commit message: `test: pin burn memory intelligence contracts`

### Task 2: Implement bounded safe retrieval and one-angle selection

**Files:**
- Modify: `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`

**Interfaces:**
- Produces: `buildBurnMemoryContext(ctx, profile) -> { target, currentText, currentTokens, contextRanking, evidence, seededCandidates }` and `chooseBurnMemoryAngle(memoryContext) -> { id, source, family, evidence, rank } | null`.

- [ ] **Step 1: Add additive curated-store metadata defaults**

Extend normalization/pruning with bounded `recentResponseFingerprints`, `recentAngleIds`, `recentMemoryFamilies`, `noveltyRerolls`, and `lastMemoryDiagnostic`. Existing v2 stores must initialize these lazily without deleting users, burns, seed usage, recent seed IDs, or recent seed families.

- [ ] **Step 2: Implement safe memory retrieval**

Build a bounded evidence list from already-curated profile burns/repeats/recent entries and context-matched seeds. Re-run `isCuratableMessage` / blocked-subject checks on any historical snippet before it can enter evidence. Cap evidence to a small fixed count and never scan the full transcript in the hot path.

- [ ] **Step 3: Implement explicit angle selection**

Map candidates to one of: contradiction callback, repeat callback, brag/overconfidence deflation, attack reversal, bait/question deflection, or generic banter. Score relevance, recency/current overlap, confidence, usage, and recent angle/family penalties. Return exactly one selected angle.

- [ ] **Step 4: Run targeted tests**

Run: `node --check scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js && node --test scripts/tests/rumble-burn-memory-intelligence-source.test.mjs`
Expected: remaining failures only for composition/novelty/custom seam/version items.

### Task 3: Add fresh composition, novelty gate, and custom-generator safe context

**Files:**
- Modify: `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`

**Interfaces:**
- Consumes: one selected angle and bounded safe memory context.
- Produces: `composeMemoryBurn(...)`, `memoryBurnFingerprint(...)`, `isNovelMemoryBurn(...)`, `rememberMemoryBurn(...)`, and structured custom-generator context.

- [ ] **Step 1: Implement fresh local wording**

Compose a response from the target, one selected angle, at most one short safe callback, and bounded template variants. Do not return stored historical burn templates verbatim as the default path.

- [ ] **Step 2: Implement novelty rejection**

Normalize/tokenize the candidate, compare against compact recent response fingerprints plus recent angle/family history, reroll when too similar, and fall back to a different seed/family when repeated attempts collide. Persist only compact hashes/IDs/timestamps, not copied source messages.

- [ ] **Step 3: Upgrade the custom generator seam**

Pass the existing `customBurnGenerator` a second structured argument containing the selected angle and bounded already-safe memory evidence. Keep `normalizedCtx` as the first argument for backward compatibility. Never pass `chatLog`, raw IndexedDB records, raw profile objects, or blocked/sensitive records.

- [ ] **Step 4: Wire Curated generation through the new pipeline**

Replace direct best-template return with retrieval → angle → composition → clean/output boundaries. Keep `pendingCuratedBurnSelection`, transcript strategy/context metadata, seed/history usage accounting, trigger/cooldown/send queue, threat firewall, and final 200-character clamp intact.

- [ ] **Step 5: Run targeted tests**

Run: `node --check scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js && node --test scripts/tests/rumble-burn-memory-intelligence-source.test.mjs scripts/tests/rumble-burn-output-boundaries-source.test.mjs scripts/tests/rumble-curated-v2-source.test.mjs scripts/tests/rumble-curated-relevance-v1101-source.test.mjs`
Expected: PASS.

### Task 4: Add compact diagnostics and release bump

**Files:**
- Modify: `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`
- Modify: `scripts/tests/rumble-userscript-version-source.test.mjs`

**Interfaces:**
- Produces: Curated panel status showing last selected source/angle and novelty reroll count; userscript v1.12.4.

- [ ] **Step 1: Add compact panel diagnostics**

Keep the existing Curated panel and append a single small diagnostic line sourced from `lastMemoryDiagnostic` and `noveltyRerolls`. Do not add a new settings surface.

- [ ] **Step 2: Bump userscript version to 1.12.4**

Update the metadata header and version regression.

- [ ] **Step 3: Run full userscript validation**

Run: `node --check scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`
Run: `node --test scripts/tests/*.test.mjs`
Expected: all tests PASS with zero failures.

- [ ] **Step 4: Review diff for scope and safety**

Confirm only the approved design/plan, userscript, and focused tests remain. Confirm no temporary workflow/patcher survives, no raw transcript export was added, no external API dependency was added, and existing output-boundary tests are unchanged or stronger.

- [ ] **Step 5: Commit final implementation**

Commit message: `feat: use curated burn memory intelligently`
