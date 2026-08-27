from pathlib import Path

path = Path('scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js')
source = path.read_text()

def replace_once(needle: str, replacement: str, label: str):
    global source
    count = source.count(needle)
    if count != 1:
        raise RuntimeError(f'{label}: expected one anchor, found {count}')
    source = source.replace(needle, replacement, 1)

def replace_between(start: str, end: str, replacement: str, label: str):
    global source
    i = source.find(start)
    if i < 0:
        raise RuntimeError(f'{label}: missing start')
    j = source.find(end, i + len(start))
    if j < 0:
        raise RuntimeError(f'{label}: missing end')
    source = source[:i] + replacement + source[j:]

replace_once('// @version      1.12.3', '// @version      1.12.4', 'version')

replace_between(
    '    function normalizeCuratedStore(value) {',
    '    curatedBurnStore = normalizeCuratedStore(curatedBurnStore);',
    r'''    function normalizeCuratedStore(value) {
        const store = value && typeof value === "object" ? value : {};
        if (!store.users || typeof store.users !== "object" || Array.isArray(store.users)) store.users = {};
        if (!store.seedUsage || typeof store.seedUsage !== "object" || Array.isArray(store.seedUsage)) store.seedUsage = {};
        store.recentSeedIds = Array.isArray(store.recentSeedIds) ? store.recentSeedIds.slice(-30) : [];
        store.recentSeedFamilies = Array.isArray(store.recentSeedFamilies) ? store.recentSeedFamilies.slice(-16) : [];
        store.recentResponseFingerprints = Array.isArray(store.recentResponseFingerprints) ? store.recentResponseFingerprints.slice(-24) : [];
        store.recentAngleIds = Array.isArray(store.recentAngleIds) ? store.recentAngleIds.slice(-16) : [];
        store.recentMemoryFamilies = Array.isArray(store.recentMemoryFamilies) ? store.recentMemoryFamilies.slice(-16) : [];
        store.noveltyRerolls = Math.max(0, Number(store.noveltyRerolls) || 0);
        const diagnostic = store.lastMemoryDiagnostic;
        store.lastMemoryDiagnostic = diagnostic && typeof diagnostic === "object" && !Array.isArray(diagnostic)
            ? {
                source: String(diagnostic.source || "").slice(0, 24),
                angle: String(diagnostic.angle || "").slice(0, 40),
                family: String(diagnostic.family || "").slice(0, 40),
                at: String(diagnostic.at || "").slice(0, 40)
            }
            : null;
        store.schemaVersion = CURATED_BURNS_SCHEMA;
        store.lastProcessedSeq = Number(store.lastProcessedSeq) || 0;
        return store;
    }

''',
    'normalizeCuratedStore'
)

replace_once(
    '''        curatedBurnStore.recentSeedIds = [...new Set(curatedBurnStore.recentSeedIds || [])].slice(-30);\n        curatedBurnStore.recentSeedFamilies = (curatedBurnStore.recentSeedFamilies || []).slice(-16);''',
    '''        curatedBurnStore.recentSeedIds = [...new Set(curatedBurnStore.recentSeedIds || [])].slice(-30);\n        curatedBurnStore.recentSeedFamilies = (curatedBurnStore.recentSeedFamilies || []).slice(-16);\n        curatedBurnStore.recentResponseFingerprints = [...new Set(curatedBurnStore.recentResponseFingerprints || [])].slice(-24);\n        curatedBurnStore.recentAngleIds = (curatedBurnStore.recentAngleIds || []).slice(-16);\n        curatedBurnStore.recentMemoryFamilies = (curatedBurnStore.recentMemoryFamilies || []).slice(-16);''',
    'prune novelty metadata'
)

replace_between(
    '    function updateCuratedBurnStatus(root = document) {',
    '    function normalizeCuratedText(text) {',
    r'''    function updateCuratedBurnStatus(root = document) {
        const status = root?.querySelector?.("#curatedBurnStatus");
        if (status) status.textContent = curatedBurnSummaryText();
        const memoryStatus = root?.querySelector?.("#curatedBurnMemoryDiagnostic");
        if (memoryStatus) {
            const diagnostic = curatedBurnStore?.lastMemoryDiagnostic;
            const rerolls = Math.max(0, Number(curatedBurnStore?.noveltyRerolls) || 0);
            memoryStatus.textContent = diagnostic?.angle
                ? `Last memory angle: ${diagnostic.angle} · ${diagnostic.source || "local"} · novelty rerolls ${rerolls}`
                : `Memory intelligence ready · novelty rerolls ${rerolls}`;
        }
    }

''',
    'updateCuratedBurnStatus'
)

replacement = r'''    function safeBurnMemorySnippet(value, max = 82) {
        const text = normalizeCuratedText(value);
        if (!isCuratableMessage(text) || isBlockedBurnSubject(text)) return "";
        return text.replace(/[“”]/g, '"').slice(0, max).trim();
    }

    function buildBurnMemoryContext(ctx, profile) {
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        const target = String(ctx?.target || profile?.displayName || ctx?.from || "there")
            .replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "there";
        const currentText = normalizeCuratedText(ctx?.message || "");
        const currentTokens = curatedTokens(currentText);
        const incomingBlocked = isBlockedBurnSubject(ctx?.message || "") || !isCuratableMessage(ctx?.message || "");
        const contextRanking = incomingBlocked
            ? [{ family: "british_banter", score: 34 }, { family: "generic_savage", score: 32 }]
            : classifyCuratedContext(ctx, profile);
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

        if (!incomingBlocked && profile) {
            const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
            const repeatStat = repeatKey.length >= 12 ? profile.repeats?.[simpleCuratedHash(repeatKey)] : null;
            if (repeatStat && statCount(repeatStat) >= 2 && repeatStat.sample) {
                addEvidence({ id: `repeat:${simpleCuratedHash(repeatKey)}`, source: "live", kind: "repeat", family: "repetition", text: repeatStat.sample, count: statCount(repeatStat), rank: 92, burnId: `live-repeat:${simpleCuratedHash(repeatKey)}` });
            }

            const recent = Array.isArray(profile.recent) ? profile.recent.slice(-18) : [];
            for (let i = 0; i < recent.length; i += 1) {
                const a = recent[i];
                if (!a?.text || !isCuratableMessage(a.text) || isBlockedBurnSubject(a.text)) continue;
                for (let j = i + 1; j < recent.length; j += 1) {
                    const b = recent[j];
                    if (!b?.text || !isCuratableMessage(b.text) || isBlockedBurnSubject(b.text)) continue;
                    const overlap = overlapCount(a.tokens || [], b.tokens || []);
                    if (overlap < 2 || a.negated === b.negated || a.text === b.text) continue;
                    const aLive = overlapCount(currentTokens, a.tokens || []);
                    const bLive = overlapCount(currentTokens, b.tokens || []);
                    const relevance = Math.max(aLive, bLive);
                    if (relevance >= 1) addEvidence({ id: `flip:${a.seq}:${b.seq}`, source: "history", kind: "contradiction", family: "contradiction", text: bLive >= aLive ? b.text : a.text, rank: 88 + relevance, burnId: `flip:${Math.min(a.seq, b.seq)}:${Math.max(a.seq, b.seq)}` });
                }
            }

            recent.slice().reverse().forEach((entry, index) => {
                const text = safeBurnMemorySnippet(entry?.text);
                if (!text) return;
                const overlap = overlapCount(currentTokens, entry.tokens || []);
                if (overlap < 1) return;
                addEvidence({ id: `recent:${entry.seq || simpleCuratedHash(text)}`, source: "history", kind: "callback", family: contextRanking[0]?.family || "generic_savage", text, rank: 58 + overlap * 7 - index, burnId: `callback:${entry.seq || simpleCuratedHash(text)}` });
            });
        }

        const seededCandidates = buildSeededCuratedCandidates(ctx, profile, contextRanking)
            .filter((entry) => entry?.burn?.template && isCuratableMessage(entry.burn.template) && !isBlockedBurnSubject(entry.burn.template))
            .slice(0, 8);
        evidence.sort((a, b) => b.rank - a.rank);
        return Object.freeze({ target, currentText, currentTokens, contextRanking, evidence: Object.freeze(evidence.slice(0, 8)), seededCandidates: Object.freeze(seededCandidates), incomingBlocked });
    }

    function chooseBurnMemoryAngle(memoryContext) {
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
        const callback = (memoryContext.evidence || []).find((item) => item.kind === "callback");
        if (callback) add("attack_reversal", callback.source, callback.family || "callback", callback.rank + 6, callback);
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

    function composeMemoryBurn(memoryContext, angle, attempt = 0) {
        if (!memoryContext || !angle) return null;
        const target = memoryContext.target || "there";
        const callback = safeBurnMemorySnippet(angle.evidence?.text || "", 72);
        const count = Math.max(2, Number(angle.evidence?.count) || 2);
        const variants = {
            contradiction_callback: [
                callback ? `@${target} you said “${callback}” and now you're arguing with your own archive. Pick a version.` : `@${target} your latest version just collided with the archive. Pick a story before the transcript does.`,
                callback ? `@${target} “${callback}” is still in the archive, mate. Today's rewrite didn't survive contact with it.` : `@${target} the archive has entered the chat and your current story has immediately requested a lawyer.`,
                callback ? `@${target} the callback is “${callback}”. Awkward time to launch the opposite version.` : `@${target} your old claim and new claim are fighting over custody of the truth.`
            ],
            repeat_callback: [
                callback ? `@${target} “${callback}” again — that's at least lap ${count}. Even your copy button looks knackered.` : `@${target} same line again. The copy button is doing more work than the material.`,
                callback ? `@${target} we've already got “${callback}” on repeat. ${count} spins and still no remix.` : `@${target} another rerun. At this point the comeback needs an episode guide.`,
                callback ? `@${target} ${count} outings for “${callback}”. Retire it before it starts claiming a pension.` : `@${target} the line came back again and somehow brought even less luggage.`
            ],
            brag_deflation: [
                `@${target} that's premium confidence strapped to budget evidence.`,
                `@${target} magnificent victory speech. Tiny issue: the victory forgot to happen.`,
                callback ? `@${target} huge confidence today, especially with “${callback}” still sitting in the archive.` : `@${target} confidence at stadium volume, point still on mute.`
            ],
            attack_reversal: [
                callback ? `@${target} you're swinging again while “${callback}” is still sitting behind you like unattended evidence.` : `@${target} all that swinging and the point still hasn't taken a scratch.`,
                `@${target} you brought an insult to a logic fight and somehow dropped both.`,
                callback ? `@${target} bold attack from the author of “${callback}”. The archive really does write its own material.` : `@${target} the aggression arrived first; the argument apparently missed the bus.`
            ],
            bait_deflection: [
                `@${target} nice bait. Put a point on the hook next time.`,
                `@${target} you keep rattling the cage but forgot to bring anything worth answering.`,
                callback ? `@${target} bait noted. “${callback}” is still the more interesting thing you accidentally contributed.` : `@${target} that's a lot of beckoning for somebody with no destination.`
            ],
            generic_banter: [
                angle.seed?.burn?.template ? String(angle.seed.burn.template).replace(/\{target\}/g, target) : `@${target} enormous delivery, microscopic payload.`,
                `@${target} you've brought theatre again. The script still hasn't brought a point.`,
                `@${target} that comeback arrived fully dressed and forgot to pack the material.`
            ]
        };
        const pool = variants[angle.id] || variants.generic_banter;
        return pool[Math.abs(Number(attempt) || 0) % pool.length] || null;
    }

    function memoryBurnFingerprint(text) {
        const normalized = String(text || "").toLowerCase().replace(/@[a-z0-9_.-]+/gi, "@target").replace(/[^a-z0-9@ ]+/g, " ").replace(/\s+/g, " ").trim();
        return simpleCuratedHash(normalized);
    }

    function isNovelMemoryBurn(candidate, angle) {
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        const fingerprint = memoryBurnFingerprint(candidate);
        if (!candidate || curatedBurnStore.recentResponseFingerprints.includes(fingerprint)) return false;
        const recentAngles = curatedBurnStore.recentAngleIds.slice(-5);
        const recentFamilies = curatedBurnStore.recentMemoryFamilies.slice(-6);
        if (angle?.id && recentAngles.length >= 3 && recentAngles.slice(-3).every((id) => id === angle.id)) return false;
        if (angle?.family && recentFamilies.length >= 4 && recentFamilies.slice(-4).every((family) => family === angle.family)) return false;
        return true;
    }

    function rememberMemoryBurn(candidate, angle) {
        if (!candidate || !angle) return;
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        const fingerprint = memoryBurnFingerprint(candidate);
        curatedBurnStore.recentResponseFingerprints = [...curatedBurnStore.recentResponseFingerprints.filter((value) => value !== fingerprint), fingerprint].slice(-24);
        curatedBurnStore.recentAngleIds = [...curatedBurnStore.recentAngleIds, String(angle.id || "generic_banter")].slice(-16);
        curatedBurnStore.recentMemoryFamilies = [...curatedBurnStore.recentMemoryFamilies, String(angle.family || "generic_savage")].slice(-16);
        curatedBurnStore.lastMemoryDiagnostic = { source: String(angle.source || "local").slice(0, 24), angle: String(angle.id || "generic_banter").slice(0, 40), family: String(angle.family || "generic_savage").slice(0, 40), at: new Date().toISOString() };
        scheduleCuratedBurnSave();
    }

    function selectCuratedBurn(ctx) {
        return selectCuratedBurnWithOptions(ctx);
    }

    function selectCuratedBurnWithOptions(ctx, options = {}) {
        if (!settings.curatedBurnsEnabled || (!options.allowEngineDisabled && settings.burnEnginesEnabled?.curated === false)) return null;
        const username = String(ctx.from || "").trim().toLowerCase();
        const profile = curatedBurnStore.users?.[username] || null;
        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        const memoryContext = buildBurnMemoryContext(ctx, profile && (Number(profile.messageCount) || 0) >= minMessages ? profile : null);
        let angle = chooseBurnMemoryAngle(memoryContext);
        if (!angle) return null;
        let candidate = null;
        let rerolls = 0;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            candidate = composeMemoryBurn(memoryContext, angle, attempt);
            if (candidate && isNovelMemoryBurn(candidate, angle)) break;
            candidate = null;
            rerolls += 1;
            curatedBurnStore.noveltyRerolls = Math.max(0, Number(curatedBurnStore.noveltyRerolls) || 0) + 1;
            if (attempt === 2 && angle.id !== "generic_banter") angle = chooseBurnMemoryAngle(Object.freeze({ ...memoryContext, evidence: Object.freeze([]) })) || angle;
        }
        if (!candidate) return null;
        const evidence = angle.evidence || null;
        const seed = angle.seed || null;
        pendingCuratedBurnSelection = {
            kind: seed ? "seed" : evidence?.source === "history" ? "history" : "live",
            username,
            burnId: seed?.burn?.id || evidence?.burnId || evidence?.id || `memory:${angle.id}`,
            family: angle.family || "generic_savage",
            strategy: `memory:${angle.id}`,
            context: angle.family || memoryContext.contextRanking?.[0]?.family || "generic_savage",
            angle: { id: angle.id, source: angle.source, family: angle.family },
            response: candidate,
            rerolls
        };
        return candidate;
    }

    function markCuratedBurnUsed(selection) {
        if (!selection?.burnId) return;
        if (selection.response && selection.angle) rememberMemoryBurn(selection.response, selection.angle);
        if (selection.kind === "seed") {
            curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
            const old = curatedBurnStore.seedUsage[selection.burnId] || {};
            const usedAt = new Date().toISOString();
            curatedBurnStore.seedUsage[selection.burnId] = { family: selection.family || old.family || "generic_savage", timesUsed: (Number(old.timesUsed) || 0) + 1, lastUsedAt: usedAt };
            curatedBurnStore.recentSeedIds = [...(curatedBurnStore.recentSeedIds || []).filter((id) => id !== selection.burnId), selection.burnId].slice(-30);
            curatedBurnStore.recentSeedFamilies = [...(curatedBurnStore.recentSeedFamilies || []), selection.family || "generic_savage"].slice(-16);
            scheduleCuratedBurnSave();
            return;
        }
        if (selection.kind === "live" || !selection.username) return;
        const profile = curatedBurnStore.users?.[selection.username];
        const burn = profile?.burns?.find((item) => item.id === selection.burnId);
        if (burn) {
            burn.timesUsed = (Number(burn.timesUsed) || 0) + 1;
            burn.lastUsedAt = new Date().toISOString();
            profile.updatedAt = burn.lastUsedAt;
        }
        scheduleCuratedBurnSave();
    }

'''
replace_between(
    '    function selectCuratedBurn(ctx) {',
    '    /***********************\n     * Export / Import / Backup',
    replacement,
    'curated selection pipeline'
)

replace_once(
    '            <div id="curatedBurnStatus" style="font-size:12px;color:gray;margin-top:5px">${curatedBurnSummaryText()}</div>',
    '''            <div id="curatedBurnStatus" style="font-size:12px;color:gray;margin-top:5px">${curatedBurnSummaryText()}</div>\n            <div id="curatedBurnMemoryDiagnostic" style="font-size:11px;color:gray;margin-top:3px">${curatedBurnStore.lastMemoryDiagnostic?.angle ? `Last memory angle: ${curatedBurnStore.lastMemoryDiagnostic.angle} · ${curatedBurnStore.lastMemoryDiagnostic.source || "local"} · novelty rerolls ${Math.max(0, Number(curatedBurnStore.noveltyRerolls) || 0)}` : `Memory intelligence ready · novelty rerolls ${Math.max(0, Number(curatedBurnStore.noveltyRerolls) || 0)}`}</div>''',
    'curated diagnostic UI'
)

replace_once(
    '''        const custom = window.rumbleBlocker?.customBurnGenerator;\n\n        const generateFromEngine = (engine) => {''',
    r'''        const custom = window.rumbleBlocker?.customBurnGenerator;
        const customProfile = curatedBurnStore.users?.[normalizedCtx.from] || null;
        const customRawMemoryContext = buildBurnMemoryContext(normalizedCtx, customProfile);
        const customAngle = chooseBurnMemoryAngle(customRawMemoryContext);
        const customMemoryContext = Object.freeze({
            angle: customAngle ? Object.freeze({ id: customAngle.id, source: customAngle.source, family: customAngle.family }) : null,
            evidence: Object.freeze((customRawMemoryContext.evidence || []).slice(0, 4).map((item) => Object.freeze({ source: item.source, kind: item.kind, family: item.family, text: safeBurnMemorySnippet(item.text, 72), count: item.count })))
        });

        const generateFromEngine = (engine) => {''',
    'custom safe context'
)
replace_once(
    '                try { return custom(normalizedCtx) || null; } catch (err) { console.warn("Custom burn generator threw", err); return null; }',
    '                try { return custom(normalizedCtx, customMemoryContext) || null; } catch (err) { console.warn("Custom burn generator threw", err); return null; }',
    'custom generator call'
)

path.write_text(source)
print('Applied burn memory intelligence patch')
