from pathlib import Path
import re

path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    text = text.replace(old, new, 1)


def replace_function(start: str, end: str, new: str, label: str) -> None:
    global text
    a = text.find(start)
    b = text.find(end, a + len(start))
    if a < 0 or b <= a:
        raise SystemExit(f"{label}: boundaries not found")
    text = text[:a] + new.rstrip() + "\n\n    " + text[b:]


replace_once("// @version      1.9.7", "// @version      1.10.0", "version")
replace_once("const CURATED_BURNS_SCHEMA = 1;", "const CURATED_BURNS_SCHEMA = 2;", "curated schema")
text = text.replace(
    "{ schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} }",
    "{ schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {}, seedUsage: {}, recentSeedIds: [], recentSeedFamilies: [] }"
)

anchor = '    const CURATED_PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|(?:\\+?\\d[\\d ()-]{7,}\\d))/i;\n'
if text.count(anchor) != 1:
    raise SystemExit("seed bank anchor not found exactly once")

seed_block = r'''    const CURATED_SEED_BLUEPRINTS = Object.freeze({
        weak_comeback: {
            baseScore: 25,
            openers: [
                "that comeback arrived with confidence",
                "that reply came charging in",
                "that response made a dramatic entrance",
                "that comeback used every ounce of momentum",
                "that reply showed up ready for battle"
            ],
            closers: [
                "and forgot to bring a point.",
                "then tripped over its own setup.",
                "but the punchline never made the journey.",
                "and still landed like an empty envelope.",
                "only to lose the argument on arrival.",
                "then quietly became evidence for the other side."
            ]
        },
        bad_argument: {
            baseScore: 24,
            openers: [
                "your argument is doing a lot of travelling",
                "that argument arrived carrying several assumptions",
                "your point took the scenic route through logic",
                "that reasoning started with a brave idea",
                "your argument built itself a grand entrance"
            ],
            closers: [
                "without ever reaching a conclusion.",
                "and misplaced the evidence on the way.",
                "before collapsing under the first follow-up.",
                "then discovered the foundation was decorative.",
                "and somehow argued against itself.",
                "but skipped the part where it becomes convincing."
            ]
        },
        overconfidence: {
            baseScore: 26,
            openers: [
                "the confidence is doing heroic work",
                "you delivered that with championship certainty",
                "that level of confidence deserves better material",
                "your certainty entered the room ten minutes early",
                "the swagger arrived in perfect condition"
            ],
            closers: [
                "while the reasoning is still looking for parking.",
                "but the point never passed inspection.",
                "and the evidence missed the appointment.",
                "while the argument waits outside without a ticket.",
                "but reality declined to sign the paperwork.",
                "and somehow the claim still came up empty."
            ]
        },
        repetition: {
            baseScore: 28,
            openers: [
                "you have brought that line around again",
                "the same point just completed another lap",
                "your repeat button is carrying the performance",
                "that sentence has returned for another shift",
                "you keep sending the same idea back out"
            ],
            closers: [
                "and it still has not collected a reason.",
                "as if mileage eventually becomes evidence.",
                "but repetition has not upgraded the material.",
                "and the sequel fixed none of the original problems.",
                "while the point remains exactly where you left it.",
                "and every replay makes the first version look generous."
            ]
        },
        contradiction: {
            baseScore: 28,
            openers: [
                "your latest version just met your earlier version",
                "the archive has introduced your two stories",
                "your current claim ran directly into the previous one",
                "you have managed to debate your own transcript",
                "the new story just bumped into the old story"
            ],
            closers: [
                "and neither one wants to explain the collision.",
                "so the cross-examination can basically run itself.",
                "and the contradiction did all the heavy lifting.",
                "leaving everyone else with nothing to add.",
                "and somehow both are asking us for trust.",
                "so pick one before they start arguing with each other."
            ]
        },
        moving_goalposts: {
            baseScore: 27,
            openers: [
                "the goalposts have packed another suitcase",
                "your point changed lanes the moment traffic appeared",
                "that argument just relocated its finish line",
                "you moved the target before the question landed",
                "the original claim has quietly left the building"
            ],
            closers: [
                "and the new destination still solves nothing.",
                "but the scoreboard remembers where it started.",
                "while the transcript keeps the original coordinates.",
                "and called the detour a victory.",
                "as though changing the test changes the result.",
                "but everyone can still see the tyre marks."
            ]
        },
        no_evidence: {
            baseScore: 27,
            openers: [
                "that claim arrived completely self-certified",
                "you submitted confidence where evidence was requested",
                "your proof appears to be an enthusiastic tone",
                "that conclusion skipped the supporting material",
                "you brought a very certain claim"
            ],
            closers: [
                "and left every receipt at home.",
                "then expected volume to pass as verification.",
                "without giving the facts a speaking role.",
                "and hoped nobody would inspect the packaging.",
                "but certainty is not a substitute for support.",
                "and somehow the source is still imaginary."
            ]
        },
        too_much_talking: {
            baseScore: 24,
            openers: [
                "that message covered impressive mileage",
                "you used a whole parade of words",
                "the speech kept expanding like it had a zoning permit",
                "that paragraph brought enough luggage for a holiday",
                "you gave the point every possible sentence"
            ],
            closers: [
                "and still never found the destination.",
                "to avoid saying one convincing thing.",
                "while the actual argument stayed remarkably small.",
                "and the conclusion somehow missed the bus.",
                "but quantity never introduced itself to quality.",
                "and buried the useful part beyond recovery."
            ]
        },
        failed_roast: {
            baseScore: 27,
            openers: [
                "you aimed for a roast and produced a status update",
                "that insult entered with theatrical lighting",
                "your punchline had a full runway",
                "you wound up that roast for maximum impact",
                "that shot had all the ceremony of a main event"
            ],
            closers: [
                "then forgot the part where it hurts.",
                "and still needed directions to the target.",
                "before landing safely in the audience.",
                "only to become its own punchline.",
                "and somehow missed from conversational distance.",
                "but the setup deserves compensation."
            ]
        },
        tag_pressure: {
            baseScore: 28,
            openers: [
                "another tag has entered the collection",
                "you rang the bell again with fresh confidence",
                "the notification count is becoming part of the joke",
                "you came back for another round voluntarily",
                "another tag and the subscription remains active"
            ],
            closers: [
                "and still brought the same amount of ammunition.",
                "so apparently the previous lesson needed a replay.",
                "while the comeback budget remains unchanged.",
                "and somehow made persistence the punchline.",
                "as if summoning me improves the material.",
                "and the queue is now roasting itself."
            ]
        },
        self_own: {
            baseScore: 27,
            openers: [
                "you accidentally supplied both sides of the joke",
                "that message did the opposition's work for them",
                "you walked directly into your own setup",
                "the self-own arrived fully assembled",
                "you managed to provide the rebuttal yourself"
            ],
            closers: [
                "so everyone else can take the round off.",
                "and even included complimentary evidence.",
                "before anybody else needed to swing.",
                "which is efficient if nothing else.",
                "and saved the room considerable effort.",
                "then signed your name underneath it."
            ]
        },
        topic_dodge: {
            baseScore: 26,
            openers: [
                "that subject change had visible tyre smoke",
                "you changed topics with impressive emergency speed",
                "the original question just watched you sprint past",
                "your answer took an immediate side exit",
                "the conversation asked one thing"
            ],
            closers: [
                "and you answered a safer question instead.",
                "but the first point is still standing there.",
                "while the transcript quietly keeps the route map.",
                "and the detour did not erase the destination.",
                "but changing rooms does not end the argument.",
                "and somehow you returned with everything except an answer."
            ]
        },
        generic_savage: {
            baseScore: 14,
            openers: [
                "that was a spectacular amount of confidence",
                "you made a very dramatic contribution",
                "the entrance promised considerably more",
                "that message arrived wearing its best suit",
                "you put real commitment into that delivery"
            ],
            closers: [
                "for such a tiny payload.",
                "and the point still missed roll call.",
                "before the material let the whole performance down.",
                "but the argument never showed up.",
                "and somehow the silence afterwards has more structure.",
                "only to leave the punchline doing paperwork."
            ]
        }
    });
    const CURATED_SEED_TEMPLATE_COUNT = Object.values(CURATED_SEED_BLUEPRINTS)
        .reduce((sum, spec) => sum + spec.openers.length * spec.closers.length, 0);
    const CURATED_SEED_BLOCKED_PATTERN = /\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\b/i;
    const CURATED_HISTORY_RANKS = Object.freeze({
        repeat: 56,
        contradiction: 49,
        phrase: 44,
        callback: 40,
        topic: 35
    });

    function isSafeCuratedSeedTemplate(text) {
        const value = String(text || "").replace(/\s+/g, " ").trim();
        return value.length >= 18 && value.length <= 220 &&
            !CURATED_SEED_BLOCKED_PATTERN.test(value) &&
            !CURATED_PERSONAL_DATA_PATTERN.test(value);
    }
'''
text = text.replace(anchor, anchor + seed_block, 1)

replace_function(
    "function normalizeCuratedStore(value)",
    "curatedBurnStore = normalizeCuratedStore(curatedBurnStore);",
    r'''function normalizeCuratedStore(value) {
        const store = value && typeof value === "object" ? value : {};
        if (!store.users || typeof store.users !== "object" || Array.isArray(store.users)) store.users = {};
        if (!store.seedUsage || typeof store.seedUsage !== "object" || Array.isArray(store.seedUsage)) store.seedUsage = {};
        store.recentSeedIds = Array.isArray(store.recentSeedIds) ? store.recentSeedIds.slice(-30) : [];
        store.recentSeedFamilies = Array.isArray(store.recentSeedFamilies) ? store.recentSeedFamilies.slice(-16) : [];
        store.schemaVersion = CURATED_BURNS_SCHEMA;
        store.lastProcessedSeq = Number(store.lastProcessedSeq) || 0;
        return store;
    }''',
    "normalize curated store"
)

replace_function(
    "function pruneCuratedStore()",
    "function saveCuratedBurnStore()",
    r'''function pruneCuratedStore() {
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        Object.values(curatedBurnStore.users).forEach((profile) => {
            profile.phrases = pruneStatMap(profile.phrases, 60);
            profile.topics = pruneStatMap(profile.topics, 50);
            profile.repeats = pruneStatMap(profile.repeats, 30);
            profile.recent = Array.isArray(profile.recent) ? profile.recent.slice(-18) : [];
            profile.burns = Array.isArray(profile.burns)
                ? profile.burns.slice(0, Math.max(3, Number(settings.curatedBurnMaxPerUser) || 12))
                : [];
        });
        const users = Object.entries(curatedBurnStore.users);
        if (users.length > CURATED_MAX_USERS) {
            users
                .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")))
                .slice(CURATED_MAX_USERS)
                .forEach(([key]) => delete curatedBurnStore.users[key]);
        }
        curatedBurnStore.recentSeedIds = [...new Set(curatedBurnStore.recentSeedIds || [])].slice(-30);
        curatedBurnStore.recentSeedFamilies = (curatedBurnStore.recentSeedFamilies || []).slice(-16);
        const seedUsage = Object.entries(curatedBurnStore.seedUsage || {});
        if (seedUsage.length > 300) {
            seedUsage
                .sort((a, b) => String(b[1]?.lastUsedAt || "").localeCompare(String(a[1]?.lastUsedAt || "")))
                .slice(300)
                .forEach(([id]) => delete curatedBurnStore.seedUsage[id]);
        }
    }''',
    "prune curated store"
)

replace_once(
    'return `${profiles.length} learned users · ${ready} ready · ${burns} curated burns`;',
    'return `${profiles.length} learned users · ${ready} ready · ${burns} history burns · ${CURATED_SEED_TEMPLATE_COUNT.toLocaleString()} seed combinations`;',
    "curated status summary"
)

classifier_and_seeds = r'''    function classifyCuratedContext(ctx, profile) {
        const message = String(ctx?.message || "").replace(/\s+/g, " ").trim();
        const currentText = normalizeCuratedText(message);
        const tokens = curatedTokens(currentText);
        const tagCount = Math.max(1, Number(ctx?.tagCount) || 1);
        const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const repeatStat = repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;
        const ranked = new Map([["bad_argument", 14], ["generic_savage", 8]]);
        const bump = (family, score) => ranked.set(family, Math.max(Number(ranked.get(family)) || 0, score));

        if (repeatStat && statCount(repeatStat) >= 2) bump("repetition", 38 + Math.min(8, statCount(repeatStat)));
        if (tagCount >= 2) bump("tag_pressure", 30 + Math.min(10, tagCount * 2));

        let contradiction = null;
        const currentNegated = /\b(?:no|not|never|isnt|isn't|arent|aren't|dont|don't|doesnt|doesn't|didnt|didn't|cant|can't|wont|won't|wouldnt|wouldn't|shouldnt|shouldn't)\b/i.test(currentText);
        for (const old of [...(profile?.recent || [])].reverse()) {
            if (!old?.text || old.text === currentText) continue;
            const overlap = overlapCount(tokens, old.tokens || []);
            if (overlap >= 2 && Boolean(old.negated) !== currentNegated) {
                contradiction = old;
                bump("contradiction", 37 + Math.min(8, overlap));
                break;
            }
        }

        if (/\b(?:not what i meant|different point|not the point|new point|anyway|besides|forget that|instead)\b/i.test(currentText)) {
            bump("moving_goalposts", 34);
            bump("topic_dodge", 31);
        }
        if (/\b(?:proof|source|evidence|trust me|everyone knows|everybody knows|take my word)\b/i.test(currentText)) bump("no_evidence", 33);
        if (/\b(?:obviously|clearly|definitely|certainly|fact|facts|period|guaranteed|no doubt|hundred percent|100%)\b/i.test(currentText)) bump("overconfidence", 31);
        if (currentText.length > 160 || currentText.split(/\s+/).filter(Boolean).length > 28) bump("too_much_talking", 32);
        if (/\b(?:roast|burn|owned|rekt|wrecked|comeback|clown|cope|cry more|sit down|destroyed)\b/i.test(currentText)) bump("failed_roast", 32);
        if (/\b(?:i dont care|i don't care|not mad|im not mad|i'm not mad|doesnt bother me|doesn't bother me|whatever)\b/i.test(currentText) && (tagCount >= 2 || currentText.length > 80)) bump("self_own", 34);
        if (/\b(?:anyway|what about|besides|different topic|change the subject|not the point)\b/i.test(currentText)) bump("topic_dodge", 33);
        if (currentText.split(/\s+/).filter(Boolean).length <= 6 || /^(?:lol|lmao|cope|clown|weak|boring|whatever|nice try)[!. ]*$/i.test(currentText)) bump("weak_comeback", 30);

        return [...ranked.entries()]
            .map(([family, score]) => ({ family, score, repeatStat, contradiction }))
            .sort((a, b) => b.score - a.score);
    }

    function buildSeededCuratedCandidates(ctx, profile, contextRanking = classifyCuratedContext(ctx, profile)) {
        const seedUsage = curatedBurnStore.seedUsage || (curatedBurnStore.seedUsage = {});
        const recentSeedIds = curatedBurnStore.recentSeedIds || (curatedBurnStore.recentSeedIds = []);
        const recentSeedFamilies = curatedBurnStore.recentSeedFamilies || (curatedBurnStore.recentSeedFamilies = []);
        const contextScores = new Map((contextRanking || []).map((item) => [item.family, Number(item.score) || 0]));
        const wanted = [...new Set([...(contextRanking || []).slice(0, 4).map((item) => item.family), "generic_savage"])];
        const now = Date.now();
        const candidates = [];

        wanted.forEach((family) => {
            const spec = CURATED_SEED_BLUEPRINTS[family];
            if (!spec) return;
            spec.openers.forEach((opener, openerIndex) => {
                spec.closers.forEach((closer, closerIndex) => {
                    const template = `@{target} ${opener} ${closer}`;
                    if (!isSafeCuratedSeedTemplate(template)) return;
                    const id = `seed:${family}:${openerIndex}:${closerIndex}`;
                    const usage = seedUsage[id] || {};
                    const timesUsed = Number(usage.timesUsed) || 0;
                    const lastUsedAt = usage.lastUsedAt || null;
                    const usedAt = lastUsedAt ? Date.parse(lastUsedAt) : 0;
                    const exactRecentPenalty = recentSeedIds.includes(id) ? 32 : 0;
                    const familyRecentCount = recentSeedFamilies.filter((item) => item === family).length;
                    const familyPenalty = Math.min(14, familyRecentCount * 5);
                    const frequencyPenalty = Math.min(18, timesUsed * 3);
                    const timePenalty = usedAt && now - usedAt < 30 * 60 * 1000 ? 8 : 0;
                    const contextBoost = Math.min(12, Math.floor((contextScores.get(family) || 0) / 3));
                    const jitter = parseInt(simpleCuratedHash(`${ctx?.message || ""}:${id}`).slice(-2), 36) % 4;
                    candidates.push({
                        seeded: true,
                        live: false,
                        context: family,
                        rank: spec.baseScore + contextBoost + jitter - exactRecentPenalty - familyPenalty - frequencyPenalty - timePenalty,
                        burn: { id, kind: family, template, timesUsed, lastUsedAt }
                    });
                });
            });
        });
        return candidates.sort((a, b) => b.rank - a.rank).slice(0, 18);
    }

'''
insert_at = text.find("    function buildCuratedCandidates(profile)")
if insert_at < 0:
    raise SystemExit("buildCuratedCandidates insertion point missing")
text = text[:insert_at] + classifier_and_seeds + text[insert_at:]

replace_function(
    "function selectCuratedBurn(ctx)",
    "function markCuratedBurnUsed(selection)",
    r'''function selectCuratedBurn(ctx) {
        if (!settings.curatedBurnsEnabled || settings.burnEnginesEnabled?.curated === false) return null;
        const username = String(ctx.from || "").trim().toLowerCase();
        const profile = curatedBurnStore.users?.[username] || null;
        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        const profileReady = !!profile && (Number(profile.messageCount) || 0) >= minMessages;

        const target = String(ctx.target || profile?.displayName || username || "there")
            .replace(/^@+/, "")
            .replace(/[^A-Za-z0-9_.-]/g, "")
            .slice(0, 40) || "there";
        const currentTokens = curatedTokens(ctx.message || "");
        const currentText = normalizeCuratedText(ctx.message || "");
        const tagCount = Math.max(1, Number(ctx.tagCount) || 1);
        const quote = safeBurnQuote(ctx.message || "");
        const contextRanking = classifyCuratedContext(ctx, profile);
        const primaryContext = contextRanking[0]?.family || "generic_savage";
        const ranked = profileReady && Array.isArray(profile.burns)
            ? profile.burns.map((burn) => ({
                burn,
                live: false,
                seeded: false,
                context: primaryContext,
                rank: (CURATED_HISTORY_RANKS[burn.kind] || 32) + Math.min(10, Number(burn.score) || 0) + overlapCount(currentTokens, burn.keywords || []) * 4 - (Number(burn.timesUsed) || 0) * 3
            }))
            : [];

        const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const repeatStat = repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;
        if (repeatStat && statCount(repeatStat) >= 2) {
            ranked.push({
                live: true,
                seeded: false,
                context: "repetition",
                rank: 72 + Math.min(10, statCount(repeatStat)),
                burn: {
                    id: `live-repeat:${simpleCuratedHash(repeatKey)}`,
                    kind: "repeat",
                    timesUsed: 0,
                    template: `@{target} you've posted that exact line ${statCount(repeatStat)} times. Your copy button is carrying the whole act.`
                }
            });
        }

        if (quote) {
            const template = tagCount >= 5
                ? `@{target} “${quote}” — tag #${tagCount}. You're not fighting back; you're renewing the subscription.`
                : tagCount >= 3
                    ? `@{target} “${quote}” — tag #${tagCount} and you're still bringing your own punchline.`
                    : tagCount >= 2
                        ? `@{target} “${quote}” — back again? You didn't bring a comeback, you brought another target.`
                        : `@{target} “${quote}” — you tagged me just to volunteer as the punchline.`;
            ranked.push({
                live: true,
                seeded: false,
                context: tagCount >= 2 ? "tag_pressure" : primaryContext,
                rank: 42 + Math.min(tagCount, 6),
                burn: {
                    id: `live-quote:${simpleCuratedHash(`${quote}:${tagCount}`)}`,
                    kind: "callback",
                    timesUsed: 0,
                    template
                }
            });
        }

        const seeded = buildSeededCuratedCandidates(ctx, profile, contextRanking);
        ranked.push(...seeded);
        if (!ranked.length) return null;
        ranked.sort((a, b) => b.rank - a.rank || (Number(a.burn.timesUsed) || 0) - (Number(b.burn.timesUsed) || 0));
        const bestRank = ranked[0]?.rank;
        const pool = ranked.filter((entry) => entry.rank >= bestRank - 2).slice(0, 4);
        const selected = pool[Math.floor(Math.random() * pool.length)];
        const chosen = selected?.burn;
        if (!chosen) return null;

        pendingCuratedBurnSelection = {
            kind: selected.seeded ? "seed" : selected.live ? "live" : "history",
            username,
            burnId: chosen.id,
            family: chosen.kind || selected.context || primaryContext,
            strategy: selected.seeded ? `seed:${chosen.kind}` : selected.live ? `live:${chosen.kind}` : `history:${chosen.kind}`,
            context: selected.context || primaryContext
        };
        return String(chosen.template || "").replace(/\{target\}/g, target).slice(0, 240);
    }''',
    "select curated burn"
)

replace_function(
    "function markCuratedBurnUsed(selection)",
    "/***********************\n     * Export / Import / Backup",
    r'''function markCuratedBurnUsed(selection) {
        if (!selection?.burnId) return;
        if (selection.kind === "seed") {
            curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
            const old = curatedBurnStore.seedUsage[selection.burnId] || {};
            const usedAt = new Date().toISOString();
            curatedBurnStore.seedUsage[selection.burnId] = {
                family: selection.family || old.family || "generic_savage",
                timesUsed: (Number(old.timesUsed) || 0) + 1,
                lastUsedAt: usedAt
            };
            curatedBurnStore.recentSeedIds = [
                ...(curatedBurnStore.recentSeedIds || []).filter((id) => id !== selection.burnId),
                selection.burnId
            ].slice(-30);
            curatedBurnStore.recentSeedFamilies = [
                ...(curatedBurnStore.recentSeedFamilies || []),
                selection.family || "generic_savage"
            ].slice(-16);
            scheduleCuratedBurnSave();
            return;
        }
        if (selection.kind === "live" || !selection.username) return;
        const profile = curatedBurnStore.users?.[selection.username];
        const burn = profile?.burns?.find((item) => item.id === selection.burnId);
        if (!burn) return;
        burn.timesUsed = (Number(burn.timesUsed) || 0) + 1;
        burn.lastUsedAt = new Date().toISOString();
        profile.updatedAt = burn.lastUsedAt;
        scheduleCuratedBurnSave();
    }''',
    "mark curated used"
)

replace_once(
    '["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle"]',
    '["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle","botStrategy","botContext"]',
    "CSV header"
)
replace_once(
    'r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||""',
    'r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||"",r.botStrategy||"",r.botContext||""',
    "CSV row metadata"
)

replace_once(
    '            target: String(meta.target || ""),\n            fontStyle: settings.outgoingFontStyle || "default",',
    '            target: String(meta.target || ""),\n            strategy: String(meta.strategy || ""),\n            context: String(meta.context || ""),\n            fontStyle: settings.outgoingFontStyle || "default",',
    "pending burn metadata"
)
replace_once(
    '            botTarget: pendingBurnEcho.target,\n            botFontStyle: pendingBurnEcho.fontStyle',
    '            botTarget: pendingBurnEcho.target,\n            botFontStyle: pendingBurnEcho.fontStyle,\n            botStrategy: pendingBurnEcho.strategy,\n            botContext: pendingBurnEcho.context',
    "consumed burn metadata"
)

replace_once(
    '            const sent = await sendChatMessage(response, { engine: lastBurnEngineUsed, target: ctx.target || ctx.from || "" });',
    '            const sent = await sendChatMessage(response, {\n                engine: lastBurnEngineUsed,\n                target: ctx.target || ctx.from || "",\n                strategy: curatedSelection?.strategy || lastBurnEngineUsed,\n                context: curatedSelection?.context || ""\n            });',
    "send curated metadata"
)

replace_once(
    '<div style="font-size:12px;color:gray;margin-top:3px">Automatically learns reusable callbacks from the locally recorded public chat. It stores bounded phrase/topic/repetition evidence and source message sequence IDs; messages that look sensitive or contain personal contact/network data are ignored.</div>',
    '<div style="font-size:12px;color:gray;margin-top:3px">Curated v2 learns reusable callbacks from the locally recorded public chat and adds ${CURATED_SEED_TEMPLATE_COUNT.toLocaleString()} seed combinations for new or low-history users. Live repeats, contradictions and relevant history rank ahead of context-matched seeds; recent seed IDs and families are penalised to keep replies varied. Messages that look sensitive or contain personal contact/network data are ignored.</div>',
    "Curated panel description"
)
replace_once(
    'Successful Burn Bot echoes are labelled with engine, target and font style in new transcript exports so future live tests can be analysed directly.',
    'Successful Burn Bot echoes are labelled with engine, target, font style, strategy and context in transcript exports so future live tests can be analysed directly.',
    "metadata panel description"
)

path.write_text(text, encoding="utf-8")
print("Curated v2 patch applied")
