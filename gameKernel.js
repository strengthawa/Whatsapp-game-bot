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

// ─── Difficulty-scaled turn timer ────────────────────────────────
// Generic "harder stage = less time" curve for any game whose
// difficulty climbs along a numeric axis (WordClimb: word length).
// Linear interpolation between startSeconds (at `min`) and
// floorSeconds (at `max`) — no hardcoded per-level table to
// maintain if a game's own min/max ever changes.
//
// @param {object} opts
// @param {number} opts.current      — current difficulty value (e.g. word length)
// @param {number} opts.min          — difficulty floor (start of the curve)
// @param {number} opts.max          — difficulty ceiling (end of the curve)
// @param {number} opts.startSeconds — seconds given at `min`
// @param {number} opts.floorSeconds — seconds given at `max`
// @returns {number} whole seconds for this stage
function computeScaledSeconds({ current, min, max, startSeconds, floorSeconds }) {
    if (max <= min) return startSeconds
    const t = Math.min(Math.max((current - min) / (max - min), 0), 1)
    return Math.round(startSeconds - (startSeconds - floorSeconds) * t)
}

// ─── Duration formatting ──────────────────────────────────────────
// mm:ss for anything under an hour, h:mm:ss beyond that. Used by
// any game's final-board report instead of each one hand-rolling
// its own padStart math.
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Per-player accumulated answer time ──────────────────────────
// Tracks how long each player actually spends thinking on their own
// turns, summed across the whole match — pause time never counts
// against them. Any game adopts this by calling markTurnStart() when
// a turn is announced, markPauseStart()/markPauseEnd() around its
// existing pause/resume, and accumulateTurnTime() when a turn
// resolves (answered right, wrong, or timed out). All state lives on
// the game's own gameState object under the field names below, so
// multiple games in the same process never collide.
function markTurnStart(gameState) {
    gameState.turnStartedAt = Date.now()
    gameState.pausedMsThisTurn = 0
}

function markPauseStart(gameState) {
    gameState.pausedAt = Date.now()
}

function markPauseEnd(gameState) {
    if (gameState.pausedAt) {
        gameState.pausedMsThisTurn = (gameState.pausedMsThisTurn || 0) + (Date.now() - gameState.pausedAt)
        gameState.pausedAt = null
    }
}

// @param {object} gameState
// @param {string} player — the player number/key this turn belonged to
// @param {number} capMs  — the turn's own time limit in ms, so a
//   delayed timeout callback can never over-credit elapsed time
// @returns {number} ms actually credited to this player this turn
function accumulateTurnTime(gameState, player, capMs) {
    if (!gameState.turnStartedAt || !player) return 0
    const raw = Date.now() - gameState.turnStartedAt - (gameState.pausedMsThisTurn || 0)
    const elapsed = Math.max(0, Math.min(raw, capMs))
    gameState.answerTimeMs = gameState.answerTimeMs || {}
    gameState.answerTimeMs[player] = (gameState.answerTimeMs[player] || 0) + elapsed
    return elapsed
}

module.exports = {
    buildCard,
    pauseTimer,
    resumeTimer,
    botIdentityLine,
    computeScaledSeconds,
    formatDuration,
    markTurnStart,
    markPauseStart,
    markPauseEnd,
    accumulateTurnTime,
    getLeaderboard,
    recordMatchResult,
    renderLeaderboardText
}

// ─── Cross-match leaderboard (opt-in, per game, per chat) ────────
// Persists under the SAME `games` object every game's own match state
// already lives in (survives restarts via the caller's persistGames(),
// same mechanism as everything else) — but under a key that a fresh
// match's freshState()/startClimb() never touches, so it isn't wiped
// between matches. Isolated per game AND per chat, same convention as
// stateKey() in every game's own gameEngine.js (ARCHITECTURE.md §4).
//
// This is entirely optional — a game that never calls these functions
// is completely unaffected, and a brand-new game folder gets nothing
// here until it explicitly wires it in. Nothing about auto-discovery
// (games-registry.js / scripts/run-tests.js) changes either way.
function leaderboardKey(gameKey, chatId) {
    return `${gameKey}:leaderboard:${chatId}`
}

function getLeaderboard(games, gameKey, chatId) {
    const key = leaderboardKey(gameKey, chatId)
    if (!games[key]) games[key] = {}
    return games[key]
}

// @param {object[]} participants — [{ number, name, won, statValue? }, ...]
//   for EVERY player in the match that just ended, winner included.
//   statValue is that player's own personal stat for this one match
//   (e.g. WordClimb's bestLength, Hangman's wrongGuesses) — optional;
//   omit it for a game with no single "best stat" worth tracking.
// @param {function} [isBetterFn] — (candidate, current) => boolean.
//   Required only if any participant has a statValue. WordClimb would
//   pass (a, b) => a > b (higher is better); Hangman would pass
//   (a, b) => a < b (fewer wrong guesses is better).
function recordMatchResult(games, gameKey, chatId, participants, isBetterFn) {
    const board = getLeaderboard(games, gameKey, chatId)
    for (const p of participants) {
        if (!board[p.number]) {
            board[p.number] = { name: p.name, wins: 0, losses: 0, streak: 0, bestStatValue: null }
        }
        const entry = board[p.number]
        entry.name = p.name || entry.name

        if (p.won) {
            entry.wins += 1
            entry.streak = entry.streak >= 0 ? entry.streak + 1 : 1
        } else {
            entry.losses += 1
            entry.streak = entry.streak <= 0 ? entry.streak - 1 : -1
        }

        if (typeof p.statValue === 'number' && typeof isBetterFn === 'function') {
            if (entry.bestStatValue === null || isBetterFn(p.statValue, entry.bestStatValue)) {
                entry.bestStatValue = p.statValue
            }
        }
    }
}

// Renders the standings — one line per player: win/loss record, a
// streak indicator, and (if tracked) their own personal best. The
// personal-best column is what keeps this from being pure leaderboard
// pressure — someone ranked last by win/loss can still see and be
// credited for their own best result, not just their rank.
// @param {object} opts
// @param {string}   [opts.title]      — heading line, defaults to 'Leaderboard'
// @param {string}   [opts.emptyText]  — shown when no matches recorded yet
// @param {number}   [opts.limit]      — max rows shown, default 10
// @param {string}   [opts.statLabel]  — unit suffix for the personal-best column (e.g. 'L' or ' wrong guesses')
// @param {function} [opts.formatStat] — (value) => string, custom formatting for the stat column
function renderLeaderboardText(games, gameKey, chatId, opts = {}) {
    const board = getLeaderboard(games, gameKey, chatId)
    const entries = Object.entries(board).map(([number, e]) => ({ number, ...e }))

    if (entries.length === 0) return opts.emptyText || 'No matches recorded yet — play one to get on the board!'

    entries.sort((a, b) => (b.wins - b.losses) - (a.wins - a.losses) || b.wins - a.wins)

    const lines = [opts.title || '🏆 Leaderboard']
    entries.slice(0, opts.limit || 10).forEach((e, i) => {
        const streakTxt = e.streak > 0 ? `🔥${e.streak}` : e.streak < 0 ? `❄️${Math.abs(e.streak)}` : '–'
        const statTxt = (e.bestStatValue !== null && opts.statLabel)
            ? ` · best: ${opts.formatStat ? opts.formatStat(e.bestStatValue) : e.bestStatValue}${opts.statLabel}`
            : ''
        lines.push(`${i + 1}. ${e.name} — ${e.wins}W/${e.losses}L (${streakTxt})${statTxt}`)
    })
    return lines.join('\n')
}
