# Burn Memory Intelligence Design

Date: 2026-08-27
Branch: `feat/burn-memory-intelligence`
Base: `581a5d8eeddc41033d567e181a6bc9113d885d77`
Target: `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js` (v1.12.3)

## Goal

Upgrade the existing curated burn engine so it uses the locally recorded chat history more like a quick-witted human: retrieve the most relevant safe history, identify the best conversational angle, choose one angle, generate a fresh response, and reject stale/repetitive output before sending.

This is an upgrade to the existing IndexedDB transcript + curated-v2 system, not a replacement. Existing learned users, history burns, seed usage, cooldowns, selected-user/mention triggers, sensitive-data filtering, and output-boundary protections stay in place.

## Constraints

- Public-chat history stays local in the browser.
- Existing filters that reject sensitive/personal/contact/network material remain upstream of memory selection.
- The bot must not use sensitive history as ammunition even if it exists in the raw transcript.
- The engine chooses one conversational angle per reply rather than stacking multiple personal callbacks.
- Existing cooldown and trigger controls remain authoritative.
- Existing seed combinations remain fallback material for new/low-history users.
- No vendor API key or direct third-party LLM dependency is added in this slice.
- Existing `customBurnGenerator` remains the extension seam for an optional external/model generator later; the upgraded local engine will provide it with safer, better-selected context.

## Current seam

The current v1.12.3 script already has:

- IndexedDB transcript persistence with no app-level message-count ceiling.
- Curated schema v2 user profiles.
- history candidates including repeats, contradictions and learned phrases.
- context classification and seed families.
- recent seed/family penalties.
- output boundaries and blocked-subject filtering.

The weakness is that ranking is still mostly candidate-score arithmetic. It does not explicitly separate retrieval, angle selection, wording, and novelty validation, so more history does not automatically produce more human-like timing or phrasing.

## Design

### 1. Safe memory retrieval

Add a small `buildBurnMemoryContext(ctx, profile)` stage that returns only bounded, already-safe evidence for the current target. It will select a handful of candidates from:

- strongest relevant contradictions;
- strongest relevant repeats;
- strongest relevant learned phrases/callbacks;
- recent safe target messages useful for context;
- context-matched seed families as fallback.

Retrieval is bounded so a 90k+ transcript does not become a giant prompt or expensive full scan on every tag. Existing curated profile summaries remain the primary index; raw transcript lookups are limited to a small recent window for the current user.

### 2. Angle selection

Add an explicit angle classifier/chooser. Candidate angles are semantic categories such as:

- contradiction callback;
- repeat/catchphrase callback;
- brag/boast deflation;
- accusation/attack reversal;
- bait/question deflection;
- generic banter fallback.

The chooser scores relevance, recency, confidence, prior-use penalty and current-message overlap. It selects exactly one primary angle. Strong live contradictions/repeats beat generic seeds; weak history does not force a callback.

### 3. Fresh local wording

Instead of returning the stored historical burn verbatim, add a local composition layer that combines:

- target name;
- selected angle;
- one short safe callback/snippet where justified;
- one style/family template;
- current-message context.

The composer rephrases around the selected evidence using bounded template variants and the existing personality engines. Stored history is evidence, not the final sentence.

### 4. Novelty gate

Before a response is accepted, compute a normalized fingerprint/token similarity against recent bot outputs for that target and globally. Reject or reroll candidates that are too close to recently used output, recently used callbacks, or the same angle/family sequence.

Persist only compact novelty metadata (hashes/angle IDs/timestamps), never a second copy of sensitive source messages.

### 5. Better custom-generator seam

When `window.rumbleBlocker.customBurnGenerator` is present, pass a structured safe context containing the chosen angle and bounded safe memory evidence. The external generator still does not receive raw transcript history or blocked/sensitive records.

No direct OpenAI/other API integration is added here. That keeps credentials out of the userscript and lets the local engine work fully offline.

## Data compatibility

Prefer an additive store migration rather than deleting/rebuilding learned memory. Existing curated-v2 `users`, learned burns, seed usage and recent seed/family state are preserved. New optional fields such as recent response fingerprints and recent angle IDs are initialized lazily when absent.

If a schema bump is required by implementation, migration must be one-way and lossless for current v2 learned data.

## UI

Keep the existing Curated burn memory panel. Add only compact diagnostics useful for tuning, for example the last selected source/angle and counts of novelty rerolls. Do not add a large new settings surface unless implementation proves it necessary.

## Tests

TDD first. Add focused regression coverage for:

1. a relevant contradiction outranking an unrelated high-score seed;
2. a repeat/catchphrase callback outranking generic banter when overlap is strong;
3. weak/unrelated history falling back to context-matched seeds;
4. one-angle selection (no stacked callback dump);
5. recent-output similarity causing reroll/fallback;
6. recent angle/family reuse being penalised;
7. blocked/sensitive records never entering selected memory context;
8. existing curated-v2 data loading without loss;
9. existing output-length/quote-back boundaries remaining intact.

After targeted tests pass, run the repo's userscript/script test suite and any existing syntax/lint checks before opening a draft PR.

## Non-goals

- No autonomous flood/spam mode.
- No bypass of Rumble moderation/rate limits.
- No use of private, contact, network, health, bereavement or other sensitive personal material for burns.
- No direct third-party LLM credential handling in this change.
- No rewrite of the transcript recorder or IndexedDB storage layer.
