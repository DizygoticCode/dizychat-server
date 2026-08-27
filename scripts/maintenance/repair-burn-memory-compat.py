from pathlib import Path

path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
source = path.read_text()

if "// @version      1.12.4" not in source:
    raise SystemExit("expected userscript v1.12.4")


def replace_between(start: str, end: str, replacement: str, label: str) -> None:
    global source
    i = source.find(start)
    j = source.find(end, i + len(start))
    if i < 0 or j <= i:
        raise SystemExit(f"missing boundary for {label}")
    source = source[:i] + replacement + source[j:]


retrieval = r'''    function buildBurnMemoryContext(ctx, profile) {
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        const target = String(ctx?.target || profile?.displayName || ctx?.from || "there")
            .replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "there";
        const currentText = normalizeCuratedText(ctx?.message || "");
        const currentTokens = curatedTokens(currentText);
        const incomingBlocked = isBlockedBurnSubject(ctx?.message || "") || !isCuratableMessage(ctx?.message || "");
        const profileReady = !incomingBlocked && !!profile;
        const tagCount = Math.max(1, Number(ctx?.tagCount) || 1);
        const quote = incomingBlocked || !shouldUseBurnQuote(ctx, "curated")
            ? ""
            : safeBurnQuote(ctx.message || "");
        const contextRanking = incomingBlocked
            ? [{ family: "british_banter", score: 34 }, { family: "generic_savage", score: 32 }]
            : classifyCuratedContext(ctx, profile);
        const primaryContext = contextRanking[0]?.family || "generic_savage";
        const evidence = [];
        const addEvidence = (item) => {
            if (!item?.text || !isCuratableMessage(item.text) || isBlockedBurnSubject(item.text)) return;
            const text = safeBurnMemorySnippet(item.text);
            if (!text) return;
            evidence.push(Object.freeze({
                id: String(item.id || simpleCuratedHash(text)).slice(0, 120),
                source: item.source === "seed" ? "seed" : item.source === "live" ? "live" : "history",
                kind: String(item.kind || "callback").slice(0, 40),
                family: String(item.family || item.kind || "generic_savage").slice(0, 40),
                text,
                count: Math.max(0, Number(item.count) || 0),
                rank: Number(item.rank) || 0,
                burnId: item.burnId ? String(item.burnId).slice(0, 140) : null
            }));
        };
        const recent = profileReady && Array.isArray(profile.recent) ? profile.recent.slice(-18) : [];
        const historySourceText = (burn) => {
            const seqs = new Set((Array.isArray(burn?.sourceSeqs) ? burn.sourceSeqs : []).map((value) => Number(value) || 0).filter(Boolean));
            const sourceEntry = recent.slice().reverse().find((entry) => seqs.has(Number(entry?.seq) || 0));
            if (sourceEntry?.text) return sourceEntry.text;
            if (burn?.kind === "repeat" && String(burn.id || "").startsWith("repeat:")) {
                const hash = String(burn.id).slice("repeat:".length);
                const sample = profile?.repeats?.[hash]?.sample;
                if (sample) return sample;
            }
            if (burn?.kind === "topic" && String(burn.id || "").startsWith("topic:")) return String(burn.id).slice("topic:".length);
            if (Array.isArray(burn?.keywords) && burn.keywords.length) return burn.keywords.slice(0, 6).join(" ");
            return "";
        };

        if (profileReady && Array.isArray(profile.burns)) {
            profile.burns.map((burn) => {
                const relevance = curatedHistoryRelevance(burn, currentTokens, currentText);
                const rawHistoryRank = (CURATED_HISTORY_RANKS[burn.kind] || 32)
                    + Math.min(10, Number(burn.score) || 0)
                    + relevance
                    + overlapCount(currentTokens, burn.keywords || []) * 4
                    - (Number(burn.timesUsed) || 0) * 3;
                return { burn, relevance, rank: Math.min(82, Math.max(58, rawHistoryRank)) };
            }).filter((entry) => entry.relevance > 0).slice(0, 8).forEach((entry) => {
                addEvidence({
                    id: entry.burn.id,
                    source: "history",
                    kind: entry.burn.kind,
                    family: entry.burn.kind || primaryContext,
                    text: historySourceText(entry.burn),
                    rank: entry.rank,
                    burnId: entry.burn.id
                });
            });
        }

        if (profileReady) {
            const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
            const repeatStat = repeatKey.length >= 12 ? profile.repeats?.[simpleCuratedHash(repeatKey)] : null;
            if (repeatStat && statCount(repeatStat) >= 2 && repeatStat.sample) {
                addEvidence({
                    id: `repeat:${simpleCuratedHash(repeatKey)}`,
                    source: "live",
                    kind: "repeat",
                    family: "repetition",
                    text: repeatStat.sample,
                    count: statCount(repeatStat),
                    rank: 92 + Math.min(10, statCount(repeatStat)),
                    burnId: `live-repeat:${simpleCuratedHash(repeatKey)}`
                });
            }

            const liveContradiction = contextRanking.find((item) => item.family === "contradiction" && item.contradiction);
            if (liveContradiction) {
                addEvidence({
                    id: `live-contradiction:${simpleCuratedHash(`${ctx?.from || ""}:${currentText}`)}`,
                    source: "live",
                    kind: "contradiction",
                    family: "contradiction",
                    text: liveContradiction.contradiction?.text || currentText,
                    rank: 88,
                    burnId: `live-contradiction:${simpleCuratedHash(`${ctx?.from || ""}:${currentText}`)}`
                });
            }

            recent.slice().reverse().forEach((entry, index) => {
                const text = safeBurnMemorySnippet(entry?.text);
                if (!text) return;
                const overlap = overlapCount(currentTokens, entry.tokens || []);
                if (overlap < 1) return;
                addEvidence({
                    id: `recent:${entry.seq || simpleCuratedHash(text)}`,
                    source: "history",
                    kind: "callback",
                    family: primaryContext,
                    text,
                    rank: Math.min(76, 58 + overlap * 7 - index),
                    burnId: `callback:${entry.seq || simpleCuratedHash(text)}`
                });
            });
        }

        if (quote) {
            addEvidence({
                id: `live-quote:${simpleCuratedHash(`${quote}:${tagCount}`)}`,
                source: "live",
                kind: "callback",
                family: tagCount >= 2 ? "tag_pressure" : primaryContext,
                text: quote,
                rank: 48 + Math.min(tagCount, 6),
                burnId: `live-quote:${simpleCuratedHash(`${quote}:${tagCount}`)}`
            });
        }

        const seededCandidates = buildSeededCuratedCandidates(ctx, profile, contextRanking)
            .filter((entry) => entry?.burn?.template && isCuratableMessage(entry.burn.template) && !isBlockedBurnSubject(entry.burn.template))
            .slice(0, 8);
        evidence.sort((a, b) => b.rank - a.rank);
        return Object.freeze({
            target,
            currentText,
            currentTokens,
            contextRanking,
            evidence: Object.freeze(evidence.slice(0, 8)),
            seededCandidates: Object.freeze(seededCandidates),
            incomingBlocked,
            profileReady
        });
    }

'''

replace_between(
    "    function buildBurnMemoryContext(ctx, profile) {",
    "    function chooseBurnMemoryAngle(memoryContext) {",
    retrieval,
    "memory retrieval",
)

chooser = r'''    function chooseBurnMemoryAngle(memoryContext) {
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        if (!memoryContext) return null;
        const angles = [];
        const recentAngleIds = curatedBurnStore.recentAngleIds || [];
        const recentMemoryFamilies = curatedBurnStore.recentMemoryFamilies || [];
        const add = (id, source, family, rank, evidence = null, seed = null) => {
            const anglePenalty = recentAngleIds.slice(-8).filter((value) => value === id).length * 9;
            const familyPenalty = recentMemoryFamilies.slice(-8).filter((value) => value === family).length * 5;
            angles.push({ id, source, family, evidence, seed, rank: rank - anglePenalty - familyPenalty });
        };
        const strongest = memoryContext.evidence?.[0] || null;
        if (strongest?.kind === "contradiction") add("contradiction_callback", strongest.source, "contradiction", strongest.rank + 28, strongest);
        if (strongest?.kind === "repeat") add("repeat_callback", strongest.source, "repetition", strongest.rank + 24, strongest);
        if (strongest && strongest.kind !== "contradiction" && strongest.kind !== "repeat") {
            add("attack_reversal", strongest.source, strongest.family || strongest.kind || "callback", strongest.rank + 8, strongest);
        }
        const callback = (memoryContext.evidence || []).find((item) => item.kind === "callback");
        if (callback && callback !== strongest) add("attack_reversal", callback.source, callback.family || "callback", callback.rank + 6, callback);
        const text = memoryContext.currentText || "";
        if (/\b(?:best|better than|smartest|genius|expert|always right|never wrong|easy win|destroyed|owned|rekt)\b/i.test(text)) add("brag_deflation", "live", "bragging", 63, callback);
        if (/\b(?:idiot|moron|stupid|clown|loser|pathetic|dumb|muppet|bellend|wanker|tosser)\b/i.test(text)) add("attack_reversal", "live", "direct_attack", 60, callback);
        if (/\?|\b(?:why|what|how|prove it|answer me|come on|try harder|is that it)\b/i.test(text)) add("bait_deflection", "live", "bait", 54, callback);
        const seed = memoryContext.seededCandidates?.[0] || null;
        if (seed) add("generic_banter", "seed", seed.context || seed.burn?.kind || "generic_savage", 36 + Math.min(18, Number(seed.rank) || 0), null, seed);
        add("generic_banter", "live", memoryContext.contextRanking?.[0]?.family || "generic_savage", 28);
        angles.sort((a, b) => b.rank - a.rank);
        return angles[0] ? Object.freeze(angles[0]) : null;
    }

'''

replace_between(
    "    function chooseBurnMemoryAngle(memoryContext) {",
    "    function composeMemoryBurn(memoryContext, angle, attempt = 0) {",
    chooser,
    "angle chooser",
)

old_selector = '''        const profile = curatedBurnStore.users?.[username] || null;\n        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);\n        const memoryContext = buildBurnMemoryContext(ctx, profile && (Number(profile.messageCount) || 0) >= minMessages ? profile : null);'''
new_selector = '''        const profile = curatedBurnStore.users?.[username] || null;\n        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);\n        const incomingBlocked = isBlockedBurnSubject(ctx.message || "") || !isCuratableMessage(ctx.message || "");\n        const profileReady = !incomingBlocked && !!profile && (Number(profile.messageCount) || 0) >= minMessages;\n        const memoryContext = buildBurnMemoryContext(ctx, profileReady ? profile : null);'''
if old_selector not in source:
    raise SystemExit("missing selector readiness seam")
source = source.replace(old_selector, new_selector, 1)

path.write_text(source)
print("Applied curated memory compatibility repair")
