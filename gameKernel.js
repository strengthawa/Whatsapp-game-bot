// ============================================================
//  gameKernel.js — Game Bots · Sky Graphics
//  Shared, game-agnostic building blocks that every game's own
//  gameEngine.js imports instead of reimplementing. Game-agnostic
//  in the same sense as permissions.js: never import a game module
//  from here, no circular deps.
//
//  This exists because pause/resume and the standard "card" message
//  shape were built once, inside Hangman, and silently never
//  abstracted out — every later game either copy-pasted the pattern
//  (drift risk) or lacked the feature entirely. See MEMORY.md rule 2
//  and NEW_GAME_HANDOFF.md for the contract a new game folder must
//  follow when using these.
// ============================================================

// ─── Card template — the "big moment" message shape ─────────────
// One consistent header/footer banding rule across every game
// (COMMAND_REFERENCE.md §2, Shape A). Body is the caller's own
// content; this only standardizes the divider/emoji/footer frame.
function buildCard(config, titleLine, bodyText) {
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *${titleLine}*\n` +
        `${config.DIVIDER}\n\n` +
        `${bodyText}\n\n` +
        `${config.DIVIDER}\n` +
        `_Sky Graphics — ${config.GAME_NAME}_`
    )
}

// ─── Pause / resume — generic timer freeze/unfreeze ──────────────
// Every game's turn timer is shaped differently (Hangman: a
// self-clearing setInterval; WordClimb: a one-shot setTimeout), so
// this doesn't try to own the timer type itself — it owns the
// paused-flag contract and the clear/re-arm sequencing, and takes
// the game's own clear/re-arm functions as callbacks. A game's
// gameEngine.js wraps this into its own pauseSession/resumeSession
// with its specific timer field name and re-arm logic.
//
// @param {object}   gameState   — must have .active and .paused
// @param {*}        activeTimer — the current timer handle, or falsy
// @param {function} clearFn     — called with activeTimer if present
// @returns {boolean} true if the pause was applied
function pauseTimer(gameState, activeTimer, clearFn) {
    if (!gameState.active || gameState.paused) return false
    if (activeTimer) clearFn(activeTimer)
    gameState.paused = true
    return true
}

// @param {object}   gameState — must have .active and .paused
// @param {function} rearmFn   — called with no args to restart the timer
// @returns {boolean} true if the resume was applied
function resumeTimer(gameState, rearmFn) {
    if (!gameState.active || !gameState.paused) return false
    gameState.paused = false
    rearmFn()
    return true
}

// ─── Bare-acronym identity line ──────────────────────────────────
// The single-line liveness signal every game's bare command shows
// as the first line of its explainer card (ARCHITECTURE.md §9).
// Replaces the old per-game ping/pong debug volleys.
//
// @param {number} [receivedAt] — Date.now() captured when the inbound
//   message was first seen (index.js). If provided, the line reports
//   the real elapsed ms between receipt and this line being built —
//   an honest, measured number, not a fabricated one. If omitted (a
//   caller that doesn't have it), falls back to the plain "online"
//   signal rather than inventing a number.
function botIdentityLine(receivedAt) {
    if (typeof receivedAt === 'number' && receivedAt > 0) {
        const elapsedMs = Date.now() - receivedAt
        return `online · ${elapsedMs}ms`
    }
    return `online`
}

module.exports = {
    buildCard,
    pauseTimer,
    resumeTimer,
    botIdentityLine
}
