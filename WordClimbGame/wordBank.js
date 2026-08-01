// ============================================================
//  WordClimbGame/wordBank.js — Word Climb · Sky Graphics
//  Real offline dictionary (not a hand-curated pool), grouped by
//  length (3-12) then by starting letter, so the engine can cheaply:
//    1. pick a starting letter that actually HAS words at the
//       current target length (never serve an impossible prompt)
//    2. validate a player's guess (real word + right length +
//       right starting letter + not already used this match)
//
//  Backing data: dictionary-data.json, generated offline from the
//  `word-list` npm package (274k English words) — that package is
//  NOT imported at runtime anywhere in this file or project. Its
//  latest version is ESM-only (`"type": "module"`), while this
//  project is CommonJS; importing it directly would either throw or
//  silently resolve to the wrong shape (a namespace object, not the
//  string it used to return) depending on your Node version. That's
//  exactly the failure mode ARCHITECTURE.md §7 warns about for
//  WordChainGame's undeclared dependency — so instead of repeating
//  it, the word list was
//  filtered, deduped, capped at 120 words per length/letter cell, and
//  put through a profanity filter *once, offline*, then the result
//  was committed as static JSON. Zero runtime npm dependency, zero
//  ESM/CJS risk, same words every time the bot boots.
//
//  Regenerating dictionary-data.json (e.g. to widen the per-cell cap
//  or refresh the profanity list) is a one-time offline step, not
//  something that runs in production — see NEW_GAME_HANDOFF.md if a
//  future game wants to reuse this same approach.
// ============================================================

const DICTIONARY = require('./dictionary-data.json')


// ─── Integrity guard ────────────────────────────────────────────
// Every word above was hand-picked to be a real word of the right
// length starting with the right letter, but this check runs once
// at module load and silently drops anything that slipped through
// wrong (wrong length, wrong first letter, or a duplicate) rather
// than letting a bad entry corrupt a live round later.
function cleanDictionary(raw) {
    const clean = {}
    for (const lenStr of Object.keys(raw)) {
        const len = parseInt(lenStr, 10)
        clean[len] = {}
        for (const letter of Object.keys(raw[lenStr])) {
            const seen = new Set()
            const words = raw[lenStr][letter].filter(w => {
                const lw = (w || '').toLowerCase()
                if (lw.length !== len) return false
                if (lw[0] !== letter) return false
                if (seen.has(lw)) return false
                seen.add(lw)
                return true
            })
            if (words.length > 0) clean[len][letter] = words
        }
    }
    return clean
}

const CLEAN_DICTIONARY = cleanDictionary(DICTIONARY)

function lettersWithWordsAt(length) {
    const byLen = CLEAN_DICTIONARY[length]
    if (!byLen) return []
    return Object.keys(byLen)
}

// Picks a starting letter that has at least one word at `length`,
// preferring one not in `excludeLetters` (used to avoid repeating
// the same letter twice in a row within a round). Falls back to
// the full pool if every letter is excluded.
function randomLetterAt(length, excludeLetters = []) {
    const fullPool = lettersWithWordsAt(length)
    if (fullPool.length === 0) return null
    const preferred = fullPool.filter(l => !excludeLetters.includes(l))
    const pool = preferred.length > 0 ? preferred : fullPool
    return pool[Math.floor(Math.random() * pool.length)]
}

function isValidWord(word, length, letter, usedWords = []) {
    const lw = (word || '').trim().toLowerCase()
    if (lw.length !== length) return false
    if (lw[0] !== letter) return false
    if (usedWords.includes(lw)) return false
    const byLen = CLEAN_DICTIONARY[length]
    if (!byLen || !byLen[letter]) return false
    return byLen[letter].includes(lw)
}

function maxKnownLength() {
    return Math.max(...Object.keys(CLEAN_DICTIONARY).map(n => parseInt(n, 10)))
}

function minKnownLength() {
    return Math.min(...Object.keys(CLEAN_DICTIONARY).map(n => parseInt(n, 10)))
}

module.exports = {
    DICTIONARY: CLEAN_DICTIONARY,
    lettersWithWordsAt,
    randomLetterAt,
    isValidWord,
    maxKnownLength,
    minKnownLength
}
