import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start boundary: ${startNeedle}`);
  assert.ok(end > start, `missing end boundary: ${endNeedle}`);
  return source.slice(start, end);
}

const personalities = [
  "british",
  "scottish",
  "irish",
  "welsh",
  "canadian",
  "southern",
  "australian",
  "american",
  "indian_callcentre",
  "chinese",
  "japanese",
  "dizycat",
  "derp",
  "incel"
];

test("v1.11+ exposes the personality engines in Burn Bot preferences", () => {
  assert.match(source, /\/\/ @version\s+1\.11\.\d+/);
  const recommendations = between("const burnEngineRecommendations = [", "];\n\n    const CURATED_STOP_WORDS");
  for (const key of personalities) assert.match(recommendations, new RegExp(`key: ["']${key}["']`));
  assert.match(recommendations, /key: ["']random_personality["']/);
  assert.match(recommendations, /DRILL SARGE/);
});

test("personality engines are enabled independently and share Curated memory", () => {
  const defaults = between("burnEnginesEnabled: {", "},\n        burnMarkovCorpus");
  for (const key of personalities) assert.match(defaults, new RegExp(`${key}: true`));
  assert.match(defaults, /random_personality: true/);

  assert.match(source, /function selectCuratedBurn\(ctx\)/);
  assert.match(source, /function selectCuratedBurnWithOptions\(ctx, options = \{\}\)/);
  const personality = between("const BURN_PERSONALITY_KEYS = Object.freeze([", "function drillPrivateName(target)");
  assert.match(personality, /selectCuratedBurnWithOptions\(ctx, \{ allowEngineDisabled: true \}\)/);
  assert.match(personality, /function renderPersonalityBurn\(engine, ctx\)/);
});

test("each requested personality has an original style bank", () => {
  const personality = between("const BURN_PERSONALITY_KEYS = Object.freeze([", "function drillPrivateName(target)");
  for (const key of personalities) assert.match(personality, new RegExp(`\\b${key}:\\s*\\[`));
  assert.match(personality, /lawn chair in a tornado|bait shop|duct tape/i);
  assert.match(personality, /DizyCat/);
  assert.match(personality, /ticket|verification|restart your argument/i);
  assert.match(personality, /DERP/i);
  assert.match(personality, /basement|forum|discord/i);
  assert.match(personality, /quality control|factory|specification|inspection/i);
  assert.match(personality, /meeting|manual|precision|formal/i);
});

test("country/archetype styles roast behaviour rather than protected traits", () => {
  const personality = between("const BURN_PERSONALITY_KEYS = Object.freeze([", "function drillPrivateName(target)");
  const indian = personality.slice(personality.indexOf("indian_callcentre:"), personality.indexOf("chinese:"));
  assert.doesNotMatch(indian, /paki|curry|dothead|brown skin/i);
  const chinese = personality.slice(personality.indexOf("chinese:"), personality.indexOf("japanese:"));
  assert.doesNotMatch(chinese, /chink|yellow|rice|eyes/i);
  const japanese = personality.slice(personality.indexOf("japanese:"), personality.indexOf("dizycat:"));
  assert.doesNotMatch(japanese, /jap\b|yellow|rice|eyes/i);
  const incel = personality.slice(personality.indexOf("incel:"), personality.indexOf("};", personality.indexOf("incel:")));
  assert.doesNotMatch(incel, /women are|girls are|female[s]? are|bitch(?:es)? are/i);
});

test("random personality rotates only safe personalities and never DRILL SARGE", () => {
  const personality = between("const BURN_PERSONALITY_KEYS = Object.freeze([", "function drillPrivateName(target)");
  assert.doesNotMatch(personality.match(/const BURN_PERSONALITY_KEYS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "", /drill/);
  assert.match(personality, /engine === "random_personality"/);
  assert.match(personality, /BURN_PERSONALITY_KEYS/);

  const generate = between("function generateBurnResponse(ctx)", "async function maybeHandleAutoBurn(ctx)");
  const fallbackMatch = generate.match(/const normalFallbackOrder = \[([^\]]*)\];/);
  assert.ok(fallbackMatch, "normal fallback order should remain explicit");
  assert.doesNotMatch(fallbackMatch[1], /drill|british|scottish|irish|welsh|canadian|southern|australian|american|indian_callcentre|chinese|japanese|dizycat|derp|incel|random_personality/);
});

test("selected personalities render before normal fallback and preserve the outbound firewall", () => {
  const generate = between("function generateBurnResponse(ctx)", "async function maybeHandleAutoBurn(ctx)");
  assert.match(generate, /BURN_PERSONALITY_KEYS\.includes\(engine\) \|\| engine === "random_personality"/);
  assert.match(generate, /renderPersonalityBurn\(engine, normalizedCtx\)/);
  assert.match(generate, /cleanGeneratedBurn\(result, normalizedCtx\.target\)/);

  const clean = between("function cleanGeneratedBurn(text, target)", "function burnResponseKey(text)");
  assert.match(clean, /isBlockedBurnSubject\(candidate\)/);
  assert.match(clean, /BURN_DIRECT_THREAT_PATTERN\.test\(candidate\)/);
});
