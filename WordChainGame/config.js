// ============================================================
//  WordChainGame/config.js — Word Chain · Sky Graphics
//  Single source of truth for this game's identity + prefixes.
// ============================================================

module.exports = {
    GAME_KEY:      'wordchain',
    GAME_NAME:     'Word Chain',
    GAME_ACRONYM:  'WCH',

    // Public command prefix (e.g. "!wch join")
    PREFIX:        '!wch',
    // Admin command prefix — note trailing space, matches project convention
    ADMIN_PREFIX:  '/wch ',

    // ── The chain ────────────────────────────────────────────
    // No letter/length is ever picked by the bot — the required
    // starting letter for a turn is always just the LAST letter of
    // whatever the previous player actually said. The opening word
    // of a match has no constraint at all (see gameEngine.js).
    MIN_WORD_LENGTH: 3,

    // ── Difficulty curve ─────────────────────────────────────
    // The turn timer shrinks as the chain gets longer (total valid
    // words played this match), via gameKernel.computeScaledSeconds()
    // — same curve shape as WordClimbGame, just on a "chain length"
    // axis instead of "word length". Caps at DIFFICULTY_MAX_WORDS —
    // a chain that outlives that just stays at the floor, it doesn't
    // extrapolate into an ever-shrinking/negative timer.
    TURN_SECONDS_START:   25,
    TURN_SECONDS_FLOOR:   10,
    DIFFICULTY_MAX_WORDS: 20,

    // ── Category modes ────────────────────────────────────────
    // "free" = any real English word. Anything else restricts every
    // word in the match to that curated list (see wordBank.js) —
    // still obeying the chain rule, no-repeat, and MIN_WORD_LENGTH.
    //
    // NOT admin-toggled mid-match anymore — the category is now an
    // automatic, timed "sector" the whole match cycles through on
    // its own (see SECTOR_SEQUENCE/SECTOR_LENGTH below), announced
    // as a big shift moment rather than a quiet setting someone has
    // to remember exists.
    CATEGORIES: {
        free:      { label: 'Free-for-all', emoji: '🔤' },
        animals:   { label: 'Animals',      emoji: '🐾' },
        fruits:    { label: 'Fruits',       emoji: '🍎' },
        countries: { label: 'Countries',    emoji: '🌍' }
    },

    // ── Automatic category rotation ("sectors") ───────────────
    // Every SECTOR_LENGTH valid words, the match announces a shift
    // into the next category in SECTOR_SEQUENCE (wrapping around) —
    // a live, timed event every player sees, not a toggle only an
    // admin knows about. Always starts a fresh match at index 0.
    SECTOR_SEQUENCE: ['free', 'animals', 'fruits', 'countries'],
    SECTOR_LENGTH:   8,

    // ── Chain trail ────────────────────────────────────────────
    // How many of the most recent words to show inline on the turn
    // prompt, so the chain is visible as it grows instead of players
    // having to remember it themselves.
    CHAIN_DISPLAY_COUNT: 5,

    // ── Scoring ─────────────────────────────────────────────────
    // A correct word always earns 1 base point (still tracked as
    // `contributions` for backward-compatible display), plus any
    // bonuses below — all stack on the same word.
    RARE_LETTERS:              ['q', 'x', 'z', 'j'],
    RARE_LETTER_BONUS:         2,   // starts with a rare letter
    LONG_WORD_MIN_LENGTH:      7,   // 7+ letters counts as "long"
    LONG_WORD_BONUS:           1,
    SPEED_BONUS_FRACTION:      0.34, // answered within the first third of the turn's time
    SPEED_BONUS:               1,
    STREAK_MILESTONE:          5,   // every 5th correct answer IN A ROW
    STREAK_BONUS:              2,

    // ── Steal window ────────────────────────────────────────────
    // After ANY failed turn (wrong word or timeout — whether or not
    // it eliminates that player), the SAME required letter stays
    // open for this many seconds for ANY OTHER active player to grab
    // out of turn order for a rescue bonus, before normal rotation
    // resumes. Set to 0 to disable entirely.
    STEAL_WINDOW_SECONDS: 8,
    STEAL_BONUS:          2,

    // ── Sprint finish line ────────────────────────────────────
    // A chain that reaches this many total valid words ends the
    // match even with multiple survivors still standing (ranked by
    // fewest strikes, then highest score) — same shape as
    // WordClimbGame's "reached_top", so a group that's all skilled
    // enough to never strike out still gets a clean finish instead
    // of an endless match.
    CHAIN_TARGET: 40,

    LOBBY_SECONDS: 45,

    // ── Strikes ──────────────────────────────────────────────
    // A strike is a timeout, a repeat, or an invalid/wrong-category
    // word. 3 strikes and that player is eliminated from the chain.
    MAX_STRIKES: 3,

    // ── Early start ──────────────────────────────────────────
    MIN_PLAYERS_TO_BEGIN: 1,

    // ── Shared brand identity (mirrors Hangman/WordClimb banding) ──
    BOT_EMOJI: '🔗',
    DIVIDER:   '━━━━━━━━━━━━━━━━━━━━━━'
}
