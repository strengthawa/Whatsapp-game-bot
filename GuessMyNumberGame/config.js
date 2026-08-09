// ============================================================
//  GuessMyNumberGame/config.js — Guess My Number · Sky Graphics
//  Single source of truth for this game's identity + prefixes.
// ============================================================

module.exports = {
    GAME_KEY:      'guessmynumber',
    GAME_NAME:     'Guess My Number',
    GAME_ACRONYM:  'GMN',

    // Public command prefix (e.g. "!gmn join")
    PREFIX:        '!gmn',
    // Admin command prefix — note trailing space, matches project convention
    ADMIN_PREFIX:  '/gmn ',

    // ── Difficulty modes ────────────────────────────────────
    // Each mode is a base range + base timer + base guess cap.
    // Both the guess cap and the round timer get scaled up by
    // computeEffectiveRange()'s multiplier (see gameEngine.js) so a
    // bigger lobby doesn't just get a bigger haystack with the same
    // number of needles to find it — see design note in gameEngine.js
    // header for why this was necessary (public Higher/Lower hints
    // let the whole group binary-search together, so range size alone
    // barely changes how many guesses a round actually takes).
    MODES: {
        classic: {
            LABEL:         'Classic',
            MIN:           1,
            MAX:           100,
            ROUND_SECONDS: 60,
            GUESS_CAP:     8
        },
        speedrun: {
            LABEL:         'Speed Run',
            MIN:           1,
            MAX:           50,
            ROUND_SECONDS: 30,
            GUESS_CAP:     6
        },
        megagrid: {
            LABEL:         'Mega Grid',
            MIN:           1,
            MAX:           1000,
            ROUND_SECONDS: 90,
            GUESS_CAP:     12
        }
    },
    DEFAULT_MODE: 'classic',

    // ── Range scaling by lobby size ──────────────────────────
    // Each player beyond the first widens the mode's base range by
    // this fraction of its base width, up to RANGE_SCALE_CAP times
    // the base width. The SAME multiplier also scales the guess cap
    // and round timer, so guesses-per-range-unit and time-per-range-
    // unit both stay roughly constant as the lobby grows — a 5-player
    // Mega Grid round isn't just "bigger," it's proportionally harder
    // AND proportionally longer.
    RANGE_SCALE_PER_PLAYER: 0.5,
    RANGE_SCALE_CAP:        3,

    // ── Match format ─────────────────────────────────────────
    // A match is a best-of-N sequence of rounds, not a single round —
    // see gameEngine.js header for why a single round alone tends to
    // resolve fast regardless of range size. Cumulative round wins
    // decide the match; a fresh secret is picked every round.
    ROUNDS_PER_MATCH: 3,

    // ── Lobby ────────────────────────────────────────────────
    LOBBY_SECONDS:        30,
    MIN_PLAYERS_TO_BEGIN: 1,

    // Auto-join used to silently pad every lobby with the Creator/Admin
    // accounts, which inflated player counts (and therefore range/cap/
    // timer scaling) even in genuine solo sessions. OFF by default now —
    // an admin who actually wants Creator/Admin auto-seated can opt in
    // per-chat via settings.autoJoin / settings.creatorOverrides.autoJoin.
    AUTO_JOIN_DEFAULT: false,

    // ── Hint tiers ───────────────────────────────────────────
    // Higher/Lower direction is always exact. Proximity is DELIBERATELY
    // coarse — banded tiers, never a raw percentage or distance — so a
    // guesser can't just do math and snipe the secret in 2-3 guesses
    // (interpolation search). Ratio = |guess - secret| / effective range
    // width. Order matters: first tier whose ceiling the ratio falls
    // under wins.
    PROXIMITY_TIERS: [
        { ceiling: 0.02, emoji: '🌋', label: 'Blazing' },
        { ceiling: 0.08, emoji: '🔥', label: 'Hot' },
        { ceiling: 0.20, emoji: '🌤️', label: 'Warm' },
        { ceiling: Infinity, emoji: '🧊', label: 'Cold' }
    ],

    // ── Unique math/game emoji set — never reused by other games ──
    HIGHER_EMOJI: '📈',
    LOWER_EMOJI:  '📉',
    WINNER_EMOJI: '🎯',
    TROPHY_EMOJI: '🏆',
    GRID_EMOJI:   '🔢',

    // ── Chaos system ─────────────────────────────────────────
    // ONE admin-facing dial — "/gmn chaos off|light|full" — instead of
    // a wall of individual on/off switches. Everything else (WHICH
    // event fires, WHO it targets, WHEN) is picked autonomously by
    // gameEngine.rollRoundChaosEvent() using these weights, so no two
    // matches play out the same way even at the same intensity. See
    // gameEngine.js header for the full design reasoning.
    CHAOS_INTENSITIES: ['off', 'light', 'full'],
    DEFAULT_CHAOS: 'off',

    // "light" = flavor only (taunts, lockout, titles) — no mechanical
    // risk/reward, safe default that never changes who wins.
    // "full" adds the three round-level chaos events below, rolled
    // once per round, mutually exclusive, plus a rare team-chaos match.
    CHAOS_EVENT_WEIGHTS: {
        none:     55,
        bounty:   20,
        sabotage: 15,
        cursed:   10
    },
    BOUNTY_POINTS:        2,     // a bounty round win counts as this many points instead of 1
    SABOTAGE_GUESS_TAX:   2,     // the sabotage target's guesses each cost this many toward the shared cap
    CURSED_GUESS_TAX:     2,     // landing on the cursed number costs this many toward the shared cap

    // Once guessCount reaches this fraction of guessCap, proximity
    // tier hints are withheld (Higher/Lower only) — tension without
    // taking away the core signal players need to keep playing fair.
    LOCKOUT_THRESHOLD_RATIO: 0.8,

    // Team Chaos — full intensity only, needs a decent-sized lobby, and
    // is rare on purpose (a whole-match modifier, not a per-round one).
    TEAM_CHAOS_MIN_PLAYERS: 4,
    TEAM_CHAOS_CHANCE:      0.25,

    TAUNT_LINES: [
        "Bold guess. Wrong, but bold. 😏",
        "Not even close, and yet — respect for trying. 🫡",
        "The number is judging you right now. 👀",
        "That guess had main-character energy. Shame it whiffed. 🎬",
        "Statistically unlikely. Emotionally devastating. 💀",
        "Somewhere, a number is laughing at you. 😂"
    ],

    // Titles are derived at match-end from stats already tracked —
    // no new bookkeeping, purely cosmetic on the final board.
    TITLES: {
        sniper:      { emoji: '🎯', label: 'The Sniper',    desc: 'won a round in the fewest guesses' },
        iceCold:     { emoji: '🧊', label: 'Ice Cold',      desc: 'never once got a Hot/Blazing hint' },
        closeCall:   { emoji: '🔥', label: 'Closest Call',  desc: "held the match's single nearest miss" }
    },

    // ── Shared brand identity ───────────────────────────────
    BOT_EMOJI: '🔢',
    DIVIDER:   '━━━━━━━━━━━━━━━━━━━━━━'
}
