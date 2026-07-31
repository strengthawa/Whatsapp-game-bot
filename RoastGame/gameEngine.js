// ============================================================
//  RoastGame/gameEngine.js — Sky Graphics
//
//  Roast has no live session/round — no lobby, no timer, no
//  win/loss state — so this file is intentionally thin. It still
//  satisfies the plugin contract (ARCHITECTURE.md §3): a
//  getGameState() export, correctly namespaced under GAME_KEY,
//  and an optional forceStopActiveSession() that's a safe no-op
//  since there's never anything running to stop.
// ============================================================

const config = require('./config')
const { findProfile } = require('./roastData')

// State isolation (ARCHITECTURE.md §4): always key under
// `${GAME_KEY}:${chatId}`, never the bare chatId. Roast doesn't
// currently store anything meaningful per chat, but the slot exists
// so a future feature (e.g. a daily roast-request cap) has
// somewhere correct to live without restructuring this file.
function getGameState(chatId, games) {
    const key = `${config.GAME_KEY}:${chatId}`
    if (!games[key]) {
        games[key] = { active: false, lobbyActive: false }
    }
    return games[key]
}

// Nothing to stop — Roast never sets `active`/`lobbyActive` true.
// Exported anyway so game-switching away from Roast behaves
// identically to every other game (ARCHITECTURE.md §10).
function forceStopActiveSession(chatId, ctx) {
    return false
}

// Resolves the requester's roast profile. The chat export only has
// saved display names, never phone numbers, for named contacts — so
// matching happens on name, not senderNumber. Tries, in order: the
// bot's cached WhatsApp display name for this number, then the raw
// pushName off the current message. First match wins. findProfile()
// itself now tolerates near-miss spelling (see roastData.js) instead
// of requiring an exact string match.
function resolveProfileForSender(senderNumber, senderName, nameCache) {
    const candidates = []
    if (nameCache && senderNumber && nameCache[senderNumber]) {
        candidates.push(nameCache[senderNumber])
    }
    if (senderName) candidates.push(senderName)
    const found = findProfile(candidates)

    if (!found) {
        // Diagnostic only — not sent to the user. Shows the real live
        // pushName next to what roastData.js expects, so a genuine
        // miss (zero shared words with any alias) can be reconciled
        // by adding a new alias line by hand.
        console.log(`[roast] No profile match for number=${senderNumber} candidates=${JSON.stringify(candidates)}`)
    }

    return found
}

module.exports = {
    getGameState,
    forceStopActiveSession,
    resolveProfileForSender
}
