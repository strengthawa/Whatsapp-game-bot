// ============================================================
//  scripts/tests/_harness.js — Game Bots · Sky Graphics
//  Minimal fake sock/ctx used by every per-game behavioral test
//  file (HangmanGame/tests.js, WordClimbGame/tests.js,
//  RoastGame/tests.js).
//
//  This is deliberately NOT a mock library — no jest, no sinon.
//  It's the smallest thing that can stand in for Baileys' `sock`
//  and record what the bot actually sent, so tests can assert on
//  real outcomes (message text, game state) instead of just
//  "the file parses" (that's what scripts/verify-games.js already
//  covers — this is the runtime-behavior layer verify-games.js
//  cannot see, per SESSION_HANDOFF.md §"Testing architecture").
//
//  Usage:
//    const { makeCtx, run, assert, report } = require('../scripts/tests/_harness')
// ============================================================

let passCount = 0
let failCount = 0
const failures = []

// ─── Fake sock — records every sendMessage call instead of hitting
// the network. Tests read ctx.sentMessages afterward. ──────────
function makeSock() {
    const sentMessages = []
    return {
        sentMessages,
        sendMessage: async (chatId, payload) => {
            sentMessages.push({ chatId, text: payload.text || '', mentions: payload.mentions || [] })
            return { key: { id: `fake-${sentMessages.length}` } }
        }
    }
}

// ─── Fake ctx — the same shape every gameEngine.js / adminCommands.js
// / publicCommands.js expects as `ctx` or `msgCtx`. Extra fields
// beyond what a given call needs are simply ignored by that call. ──
function makeCtx(overrides = {}) {
    const sock = makeSock()
    const ctx = {
        sock,
        games: {},
        settings: { adminNumber: '', creatorOverrides: {} },
        saveSettings: () => {},
        words: {},
        activeGameChatRef: { value: null },
        persistGames: () => {},
        nameCache: {},
        sendSafeMessage: async (s, jid, payload) => s.sendMessage(jid, payload),
        senderNumber: '15550001111',
        senderJid: '15550001111@s.whatsapp.net',
        senderName: 'Test Player',
        isAdmin: false,
        receivedAt: Date.now(),
        ...overrides,
        get sentMessages() { return sock.sentMessages }
    }
    // Real index.js passes buildCtx as "() => buildCtx(sock)" — a fresh
    // engine-shaped ctx built from the same live sock/games/settings.
    // Self-reference here so games that call ctx.buildCtx() (as
    // HangmanGame/publicCommands.js does) get the same fake state back,
    // not a crash.
    if (!overrides.buildCtx) ctx.buildCtx = () => ctx
    return ctx
}

// ─── Tiny assertion + runner, enough to fail loudly and specifically
// (which line, which game, what was expected vs. actual) without
// pulling in a test framework dependency this project doesn't have. ──
async function run(label, fn) {
    try {
        await fn()
        passCount++
        console.log(`  ✅ ${label}`)
    } catch (err) {
        failCount++
        failures.push({ label, err })
        console.log(`  ❌ ${label}`)
        console.log(`     ${err.message}`)
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed')
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'Values differ'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
}

function report(gameName) {
    console.log('')
    if (failCount === 0) {
        console.log(`  ${gameName}: ${passCount}/${passCount} passed`)
    } else {
        console.log(`  ${gameName}: ${passCount} passed, ${failCount} FAILED`)
    }
    return failCount === 0
}

function resetCounts() {
    passCount = 0
    failCount = 0
    failures.length = 0
}

module.exports = { makeCtx, makeSock, run, assert, assertEqual, report, resetCounts }
