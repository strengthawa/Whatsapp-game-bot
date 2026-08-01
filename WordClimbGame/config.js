// ============================================================
//  WordClimbGame/config.js — Word Climb · Sky Graphics
//  Single source of truth for this game's identity + prefixes.
// ============================================================

module.exports = {
    GAME_KEY:      'wordclimb',
    GAME_NAME:     'Word Climb',
    GAME_ACRONYM:  'WCL',

    // Public command prefix (e.g. "!wcl join")
    PREFIX:        '!wcl',
    // Admin command prefix — note trailing space, matches project convention
    ADMIN_PREFIX:  '/wcl ',

    // ── The climb ────────────────────────────────────────────
    // Length starts here and climbs by +1 every time the turn
    // rotation completes a full cycle through the surviving
    // players — never per-turn, so everyone faces each rung
    // of the ladder at the same length before it gets harder.
    MIN_LENGTH:  3,
    MAX_LENGTH:  12,

    // ── Lobby + turn timers ─────────────────────────────────
    LOBBY_SECONDS: 45,
    TURN_SECONDS:  30,

    // ── Strikes ──────────────────────────────────────────────
    // A strike is a timeout OR a wrong/invalid guess. 3 strikes
    // and that player is eliminated from the climb.
    MAX_STRIKES: 3,

    // ── Early start ──────────────────────────────────────────
    // Minimum players in the lobby before an admin can force-start
    // early with "/wcl begin" (see adminCommands.js). Set to 1 so a
    // solo climb is allowed — a lone climber who never strikes out
    // still resolves cleanly via the normal "reached_top" win path
    // in gameEngine.js. Matches HangmanGame's lack of a floor.
    MIN_PLAYERS_TO_BEGIN: 1,

    // ── Shared brand identity (mirrors HangmanGame's banding) ──
    BOT_EMOJI: '🧗',
    DIVIDER:   '━━━━━━━━━━━━━━━━━━━━━━'
}
