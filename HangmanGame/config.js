// ============================================================
//  HangmanGame/config.js — Hangman · Sky Graphics
//  Single source of truth for this game's identity + prefixes.
//  Change these once here — every other file imports from this
//  module instead of hardcoding strings.
// ============================================================

module.exports = {
    GAME_KEY:      'hangman',
    GAME_NAME:     'HangMan Game',
    GAME_ACRONYM:  'HMG',

    // Public command prefix (e.g. "!hmg join")
    PREFIX:        '!hmg',
    // Admin command prefix — note trailing space, matches original convention
    ADMIN_PREFIX:  '/hmg ',

    // ── Adaptive word-length difficulty ─────────────────────
    MIN_WORD_LENGTH:   4,
    MAX_WORD_LENGTH:   12,
    START_WORD_LENGTH: 5,
    LENGTH_STEP:       1,   // letters to drift up/down per round

    // ── Timers ───────────────────────────────────────────────
    LOBBY_SECONDS:        60,

    // Minimum players in the lobby before an admin can force-start early
    // with "/hmg begin" — see adminCommands.js. Matches Word Climb's
    // MIN_PLAYERS_TO_BEGIN convention; Hangman has no floor beyond "at
    // least one," same as before this was made an explicit config value.
    MIN_PLAYERS_TO_BEGIN: 1,
    TURN_SECONDS:         30,
    COOLDOWN_SECONDS:     120,  // 2-minute post-round discussion window
    COOLDOWN_WARNING_AT:  30,   // send "starting soon" ping at T-30s

    // ── Shared brand identity (apply to every "card" message) ──
    // Big structural messages (lobby open/close, help dashboard, match
    // report) use BOT_EMOJI + DIVIDER for an instantly-recognizable
    // header/footer band. Quick transactional replies (single-line
    // confirmations, errors) skip this and stay minimal on purpose.
    BOT_EMOJI:  '🤖',
    DIVIDER:    '━━━━━━━━━━━━━━━━━━━━━━'
}
