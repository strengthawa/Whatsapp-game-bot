// ============================================================
//  WordChainGame/gameEngine.js — Word Chain · Sky Graphics
//  Game-state logic AND turn-timer/messaging, following the same
//  convention already established by HangmanGame/WordClimbGame in
//  this project — publicCommands.js stays a thin layer over these
//  functions rather than duplicating turn flow.
//
//  How a match works:
//   - Players take turns in a shuffled rotation. The FIRST player's
//     word has no constraint beyond being valid for the match's
//     current sector (see below) and at least config.MIN_WORD_LENGTH
//     — it opens the chain.
//   - Every word after that must START with the LAST LETTER of the
//     previous word. The bot never picks this letter — it's always
//     just derived from whatever the previous player actually said.
//   - A word must also be real (or, in the current sector, IN that
//     category — see wordBank.js) and not already used this match.
//     Wrong / invalid / timeout → a strike, and the player's streak
//     resets to 0. A rejection names the SPECIFIC reason (too short,
//     wrong letter, already used, not in this sector) via
//     wordBank.validateWord() — not a generic "doesn't fit".
//   - Category is NOT admin-toggled anymore. Every SECTOR_LENGTH
//     valid words, the match automatically shifts into the next
//     category in config.SECTOR_SEQUENCE and announces it as a big,
//     live moment (see maybeRotateSector/announceSectorShift) —
//     always starting a fresh match at sequence[0].
//   - Scoring stacks on every correct word: 1 base point, +bonus for
//     a rare starting letter, +bonus for a long word, +bonus for
//     answering fast, +bonus at every Nth-in-a-row streak milestone
//     (see computeBonus()). Score — not raw word count — is the
//     primary tie-break for who wins a multi-survivor finish.
//   - After ANY failed turn (wrong word or timeout), the same
//     required letter stays open for a short STEAL WINDOW where any
//     OTHER active player can grab it out of turn order for a rescue
//     bonus, before normal rotation resumes (see openStealWindow/
//     attemptSteal). The original failing player still takes their
//     strike either way — stealing saves the chain's momentum, not
//     their strike count.
//   - The turn timer shrinks as the chain gets longer (see
//     gameKernel.computeScaledSeconds — config.TURN_SECONDS_START
//     down to config.TURN_SECONDS_FLOOR, capped at
//     config.DIFFICULTY_MAX_WORDS), unless an admin has set a fixed
//     override via "/wch setturnseconds", which wins outright.
//   - 3 strikes (accumulated across the whole match) and you're
//     eliminated. Elimination order is preserved for the final
//     report, along with each player's own accumulated answer time
//     and the single longest word of the match regardless of who
//     ultimately won it.
//   - The match ends when either only one player remains (they win
//     outright) or the chain reaches config.CHAIN_TARGET total valid
//     words with multiple survivors (fewest strikes wins the tie,
//     then highest score).
// ============================================================

const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')
const kernel = require('../gameKernel')
const config = require('./config')
const wordBank = require('./wordBank')

// Effective turn-timer seconds for the CURRENT chain length. An
// admin's fixed "/wch setturnseconds" override replaces the whole
// curve; otherwise it's gameKernel's shared shrink-as-you-go curve.
function turnSecondsFor(gameState, settings) {
    const override = resolveSetting(`${config.GAME_KEY}_turnSeconds`, settings, null)
    if (override !== null && override !== undefined) return override
    return kernel.computeScaledSeconds({
        current:      gameState.totalWords,
        min:          0,
        max:          config.DIFFICULTY_MAX_WORDS,
        startSeconds: config.TURN_SECONDS_START,
        floorSeconds: config.TURN_SECONDS_FLOOR
    })
}

function turnTimerDisplay(settings) {
    const override = resolveSetting(`${config.GAME_KEY}_turnSeconds`, settings, null)
    if (override !== null && override !== undefined) return `${override}s (fixed override)`
    return `${config.TURN_SECONDS_START}s → ${config.TURN_SECONDS_FLOOR}s as the chain grows (auto)`
}

function categoryDisplay(category) {
    const meta = config.CATEGORIES[category] || config.CATEGORIES[config.SECTOR_SEQUENCE[0]]
    return `${meta.emoji} ${meta.label}`
}

// Human-readable reason for a rejected word — see wordBank.validateWord().
function reasonText(reason) {
    switch (reason) {
        case 'too_short':      return `is too short (need ${config.MIN_WORD_LENGTH}+ letters)`
        case 'wrong_letter':   return `doesn't start with the right letter`
        case 'repeat':         return `has already been used this match`
        case 'not_in_category': return `isn't in this sector's category`
        case 'not_real':
        default:                return `isn't a real word`
    }
}

// ── Scoring ──────────────────────────────────────────────────────
// 1 base point always, plus any bonuses below — all stack on the
// same word. streakCount is the streak BEFORE this word; the
// returned nextStreak is what the caller should store.
// @param {number|null} elapsedMs — ms since the turn opened, or null
//   to skip the speed bonus entirely (used for opportunistic steals,
//   which don't have a normal turn-timer window to measure against).
function computeBonus(word, elapsedMs, turnSeconds, streakCount) {
    let points = 1
    const tags = []

    if (config.RARE_LETTERS.includes(word[0])) {
        points += config.RARE_LETTER_BONUS
        tags.push(`+${config.RARE_LETTER_BONUS} rare letter`)
    }
    if (word.length >= config.LONG_WORD_MIN_LENGTH) {
        points += config.LONG_WORD_BONUS
        tags.push(`+${config.LONG_WORD_BONUS} long word`)
    }
    if (elapsedMs !== null && turnSeconds > 0 && elapsedMs <= turnSeconds * 1000 * config.SPEED_BONUS_FRACTION) {
        points += config.SPEED_BONUS
        tags.push(`+${config.SPEED_BONUS} speed`)
    }

    const nextStreak = streakCount + 1
    if (nextStreak % config.STREAK_MILESTONE === 0) {
        points += config.STREAK_BONUS
        tags.push(`+${config.STREAK_BONUS} streak x${nextStreak} 🔥`)
    }

    return { points, tags, nextStreak }
}

// Applies a successful word (normal turn OR a steal) to gameState —
// the one place that updates usedWords/totalWords/lastWord/
// contributions/score/streak/longestWord/wordsInCurrentSector, so a
// steal can't silently update a different subset of fields than a
// normal correct guess.
function applySuccessfulWord(gameState, number, word, elapsedMs, turnSeconds) {
    const bonus = computeBonus(word, elapsedMs, turnSeconds || 0, gameState.streak[number] || 0)

    gameState.usedWords.push(word)
    gameState.totalWords += 1
    gameState.lastWord = word
    gameState.contributions[number] = (gameState.contributions[number] || 0) + 1
    gameState.score[number] = (gameState.score[number] || 0) + bonus.points
    gameState.streak[number] = bonus.nextStreak
    gameState.wordsInCurrentSector = (gameState.wordsInCurrentSector || 0) + 1

    if (!gameState.longestWord || word.length > gameState.longestWord.word.length) {
        gameState.longestWord = { word, number }
    }

    return bonus
}

// Every config.SECTOR_LENGTH valid words, shift to the next category
// in config.SECTOR_SEQUENCE (wrapping around). Returns the new
// category key if a shift happened, or null if not yet due — the
// caller uses the return value to decide whether to announce it.
function maybeRotateSector(gameState) {
    if ((gameState.wordsInCurrentSector || 0) < config.SECTOR_LENGTH) return null
    gameState.wordsInCurrentSector = 0
    gameState.sectorIndex = (gameState.sectorIndex + 1) % config.SECTOR_SEQUENCE.length
    gameState.category = config.SECTOR_SEQUENCE[gameState.sectorIndex]
    return gameState.category
}

async function announceSectorShift(chatId, ctx, newCategory) {
    const { sock } = ctx
    const meta = config.CATEGORIES[newCategory]
    await sock.sendMessage(chatId, {
        text:
            `🚨 *SECTOR SHIFT!* 🚨\n` +
            `The chain enters ${meta.emoji} *${meta.label}* for the next ${config.SECTOR_LENGTH} words!`
    })
}

// ─── State isolation — see ARCHITECTURE.md §4 ──────────────────
function stateKey(chatId) {
    return `${config.GAME_KEY}:${chatId}`
}

function getGameState(chatId, games) {
    const key = stateKey(chatId)
    if (!games[key]) {
        games[key] = freshState()
    }
    return games[key]
}

function freshState() {
    return {
        active:           false,
        paused:           false,
        lobbyActive:      false,
        lobbyTimer:       null,
        lobbySecondsLeft: config.LOBBY_SECONDS,
        turnTimer:        null,
        turnSecondsLeft:  config.TURN_SECONDS_START,

        category:            config.SECTOR_SEQUENCE[0],
        sectorIndex:         0,
        wordsInCurrentSector: 0,

        players:      [],   // numbers still in the chain
        playerNames:  {},
        playerJids:   {},
        strikes:      {},   // { [number]: count }
        contributions: {},  // { [number]: count of valid words THEY added }
        score:        {},   // { [number]: total points, including bonuses }
        streak:       {},   // { [number]: current consecutive-correct streak }
        eliminated:   [],   // [{ number, name, reason, atWordCount, contributions, order }]

        steal:      null,   // { open, requiredLetter, category, excludeNumber, pendingNextTurn } or null
        stealTimer: null,

        lastWord:        null,  // the most recently played word, or null before the opener
        usedWords:       [],    // flat list — no repeats for the whole match
        totalWords:      0,
        turnOrder:       [],    // rotation for the current match
        turnIndex:       0,
        currentPlayer:   null,

        matchStartedAt:    0,
        answerTimeMs:      {},   // { [number]: accumulated ms spent on own turns }
        turnStartedAt:     0,
        pausedAt:          null,
        pausedMsThisTurn:  0,
        longestWord:       null  // { word, number } — single longest word of the match, winner or not
    }
}

function shuffle(arr) {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

// ─── Lobby ──────────────────────────────────────────────────────
function addToLobby(gameState, number, name, jid) {
    if (gameState.players.includes(number)) return false
    gameState.players.push(number)
    gameState.playerNames[number] = name
    gameState.playerJids[number] = jid
    return true
}

function clearTimers(gameState) {
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
    if (gameState.turnTimer) clearInterval(gameState.turnTimer)
    if (gameState.stealTimer) clearTimeout(gameState.stealTimer)
    gameState.lobbyTimer = null
    gameState.turnTimer = null
    gameState.stealTimer = null
    gameState.steal = null
}

function jidFor(gameState, number) {
    return gameState.playerJids[number] || `${number}@s.whatsapp.net`
}

function tagFor(gameState, number, settings) {
    return nameTag(number, gameState.playerNames, settings)
}

// ── Pure state transition: whose turn is it next ────────────────
// Returns { type: 'turn_started', ... } or { type: 'match_ended', ... }.
// Never touches sock — that's announceAndArm()'s job below.
function advanceToNextTurn(gameState) {
    if (gameState.turnOrder.length === 0) {
        return endChainState(gameState, 'no_survivors')
    }
    if (gameState.totalWords >= config.CHAIN_TARGET) {
        return endChainState(gameState, 'chain_target')
    }

    if (gameState.turnIndex >= gameState.turnOrder.length) {
        gameState.turnIndex = 0
    }
    gameState.currentPlayer = gameState.turnOrder[gameState.turnIndex]

    return {
        type: 'turn_started',
        player: gameState.currentPlayer,
        requiredLetter: gameState.lastWord ? gameState.lastWord.slice(-1) : null
    }
}

function eliminateFromState(gameState, number, reason) {
    const idx = gameState.turnOrder.indexOf(number)
    if (idx !== -1) gameState.turnOrder.splice(idx, 1)
    if (idx !== -1 && idx < gameState.turnIndex) {
        gameState.turnIndex -= 1
    }

    gameState.eliminated.push({
        number,
        name: gameState.playerNames[number] || number,
        reason,
        atWordCount: gameState.totalWords,
        contributions: gameState.contributions[number] || 0,
        score: gameState.score[number] || 0,
        answerTimeMs: (gameState.answerTimeMs && gameState.answerTimeMs[number]) || 0,
        order: gameState.eliminated.length + 1
    })

    const playerIdx = gameState.players.indexOf(number)
    if (playerIdx !== -1) gameState.players.splice(playerIdx, 1)

    if (gameState.turnOrder.length <= 1) {
        return endChainState(gameState, gameState.turnOrder.length === 1 ? 'last_standing' : 'no_survivors')
    }
    return null // still going — caller should call advanceToNextTurn next
}

function endChainState(gameState, reason) {
    clearTimers(gameState)
    gameState.active = false

    const survivors = [...gameState.players]
    let winner = null

    if (reason === 'last_standing' && survivors.length === 1) {
        winner = survivors[0]
    } else if (survivors.length > 0) {
        winner = [...survivors].sort((a, b) => {
            const strikeDiff = (gameState.strikes[a] || 0) - (gameState.strikes[b] || 0)
            if (strikeDiff !== 0) return strikeDiff
            return (gameState.score[b] || 0) - (gameState.score[a] || 0)
        })[0]
    }

    const report = matchSummary.buildFinalBoard(gameState, winner, reason)
    return { type: 'match_ended', reason, winner, survivors, report }
}

// ─── Sock-aware turn flow ───────────────────────────────────────
async function announceAndArm(chatId, ctx, turnResult) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (turnResult.type === 'match_ended') {
        await sendFinalBoard(chatId, ctx, turnResult)
        return
    }

    const tag = tagFor(gameState, turnResult.player, settings)
    const jid = jidFor(gameState, turnResult.player)
    const seconds = turnSecondsFor(gameState, settings)

    const nextIdx = gameState.turnOrder.length > 0
        ? (gameState.turnIndex + 1) % gameState.turnOrder.length
        : gameState.turnIndex
    const nextPlayer = gameState.turnOrder[nextIdx]
    const nextTag = nextPlayer ? tagFor(gameState, nextPlayer, settings) : tag

    const opener = !turnResult.requiredLetter
    const trail = gameState.usedWords.length > 0
        ? `\n🔗 ${gameState.usedWords.slice(-config.CHAIN_DISPLAY_COUNT).join(' → ')}`
        : ''
    await sock.sendMessage(chatId, {
        text: opener
            ? (
                `🔗 ${tag} opens the chain — next: ${nextTag}\n` +
                `🔤 any real word (${categoryDisplay(gameState.category)}), ${config.MIN_WORD_LENGTH}+ letters\n` +
                `⏳ ${seconds}s · 🏆 ${gameState.turnOrder.length} left · 📝 0 words`
              )
            : (
                `🔗 ${tag}'s turn — next: ${nextTag}\n` +
                `🔤 must start with "${turnResult.requiredLetter.toUpperCase()}" (${categoryDisplay(gameState.category)})\n` +
                `⏳ ${seconds}s · 🏆 ${gameState.turnOrder.length} left · 📝 ${gameState.totalWords} words${trail}`
              ),
        mentions: [jid, nextPlayer ? jidFor(gameState, nextPlayer) : jid]
    })

    kernel.markTurnStart(gameState)
    if (gameState.turnTimer) clearInterval(gameState.turnTimer)
    persistGames()
    armTurnTimer(chatId, ctx, seconds)
}

// Turn timer — ticks every 1s, posts a "X seconds left" update every
// 5s, and calls handleTimeout() at 0. Same shape as WordClimbGame's
// armTurnTimer/tickTurnTimer and HangmanGame's startTurnCountdown.
function armTurnTimer(chatId, ctx, seconds) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    gameState.turnSecondsLeft = seconds
    gameState.turnTimer = setInterval(() => tickTurnTimer(chatId, ctx), 1000)
}

async function tickTurnTimer(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)

    if (!gameState.active || gameState.paused) {
        if (gameState.turnTimer) clearInterval(gameState.turnTimer)
        return
    }

    gameState.turnSecondsLeft -= 1

    if (gameState.turnSecondsLeft <= 0) {
        clearInterval(gameState.turnTimer)
        gameState.turnTimer = null
        await handleTimeout(chatId, ctx)
        return
    }

    if (gameState.turnSecondsLeft % 5 === 0) {
        const tag = tagFor(gameState, gameState.currentPlayer, ctx.settings)
        await sock.sendMessage(chatId, {
            text: `⏳ ${gameState.turnSecondsLeft}s left for ${tag}...`
        })
    }
}

async function sendFinalBoard(chatId, ctx, endResult) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const text = matchSummary.renderFinalBoardText(endResult.report)
    await sock.sendMessage(chatId, { text })

    // Cross-match leaderboard (opt-in, see gameKernel.js) — every
    // player who was ever in this match, winner and eliminated alike,
    // with their own SCORE (base + bonuses) as the personal-best stat
    // (more is better for Word Chain).
    const allParticipants = [
        ...gameState.players.map(num => ({
            number: num,
            name: gameState.playerNames[num] || num,
            won: num === endResult.winner,
            statValue: gameState.score[num] || 0
        })),
        ...gameState.eliminated.map(e => ({
            number: e.number,
            name: e.name,
            won: false,
            statValue: e.score || 0
        }))
    ]
    if (allParticipants.length > 0) {
        kernel.recordMatchResult(games, config.GAME_KEY, chatId, allParticipants, (a, b) => a > b)
        if (typeof persistGames === 'function') persistGames()
    }

    if (activeGameChatRef && activeGameChatRef.value === chatId) {
        activeGameChatRef.value = null
    }
}

async function handleTimeout(chatId, ctx) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active) return

    const number = gameState.currentPlayer
    const tag = tagFor(gameState, number, settings)
    const seconds = turnSecondsFor(gameState, settings)
    const requiredLetter = gameState.lastWord ? gameState.lastWord.slice(-1) : null
    kernel.accumulateTurnTime(gameState, number, seconds * 1000)
    gameState.streak[number] = 0

    gameState.strikes[number] = (gameState.strikes[number] || 0) + 1
    const struckOut = gameState.strikes[number] >= config.MAX_STRIKES

    let endResult = null
    if (struckOut) {
        endResult = eliminateFromState(gameState, number, 'timeout')
    } else {
        gameState.turnIndex += 1
    }
    persistGames()

    await sock.sendMessage(chatId, {
        text: struckOut
            ? `⏱️ ${tag} timed out — ${tag} is *out* (${config.MAX_STRIKES}/${config.MAX_STRIKES} strikes) 🚫`
            : `⏱️ ${tag} timed out — strike ${gameState.strikes[number]}/${config.MAX_STRIKES} 💢`
    })

    const nextTurn = endResult || advanceToNextTurn(gameState)
    await maybeOpenStealOrContinue(chatId, ctx, requiredLetter, gameState.category, number, nextTurn)
}

// Called by publicCommands.js when the currently-active player
// posts a message during their open turn window. Returns true if
// this message was consumed as a guess attempt (right or wrong),
// false if it wasn't this player's turn / no round is active.
async function submitGuess(chatId, ctx, senderNumber, rawWord) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (!gameState.active || gameState.paused) return false
    // A steal window suspends normal turn submission entirely — the
    // upcoming player's turn hasn't actually been announced or armed
    // yet (gameState.currentPlayer already points to them internally,
    // since advanceToNextTurn() runs before the window opens), so a
    // message from them here belongs to attemptSteal(), not this.
    if (gameState.steal && gameState.steal.open) return false
    if (senderNumber !== gameState.currentPlayer) return false

    if (gameState.turnTimer) clearInterval(gameState.turnTimer)

    const requiredLetter = gameState.lastWord ? gameState.lastWord.slice(-1) : null
    const word = (rawWord || '').trim().toLowerCase()
    const tag = tagFor(gameState, senderNumber, settings)
    const seconds = turnSecondsFor(gameState, settings)
    const elapsedMs = gameState.turnStartedAt ? Date.now() - gameState.turnStartedAt : null
    kernel.accumulateTurnTime(gameState, senderNumber, seconds * 1000)

    const result = wordBank.validateWord(word, requiredLetter, gameState.category, gameState.usedWords)

    if (!result.valid) {
        gameState.streak[senderNumber] = 0
        gameState.strikes[senderNumber] = (gameState.strikes[senderNumber] || 0) + 1
        const struckOut = gameState.strikes[senderNumber] >= config.MAX_STRIKES

        let endResult = null
        if (struckOut) {
            endResult = eliminateFromState(gameState, senderNumber, 'wrong_guess')
        } else {
            gameState.turnIndex += 1
        }
        persistGames()

        await sock.sendMessage(chatId, {
            text: struckOut
                ? `❌ "${rawWord}" ${reasonText(result.reason)} — ${tag} is *out* (${config.MAX_STRIKES}/${config.MAX_STRIKES} strikes) 🚫`
                : `❌ "${rawWord}" ${reasonText(result.reason)} — ${tag} takes strike ${gameState.strikes[senderNumber]}/${config.MAX_STRIKES} 💢`
        })

        const nextTurn = endResult || advanceToNextTurn(gameState)
        await maybeOpenStealOrContinue(chatId, ctx, requiredLetter, gameState.category, senderNumber, nextTurn)
        return true
    }

    const bonus = applySuccessfulWord(gameState, senderNumber, word, elapsedMs, seconds)
    gameState.turnIndex += 1
    persistGames()

    await sock.sendMessage(chatId, {
        text: `✅ "${word}" — ${tag} keeps the chain going! 🔗${bonus.tags.length ? ` (+${bonus.points}: ${bonus.tags.join(', ')})` : ''}`
    })

    const rotated = maybeRotateSector(gameState)
    if (rotated) await announceSectorShift(chatId, ctx, rotated)

    persistGames()
    const nextTurn = advanceToNextTurn(gameState)
    await announceAndArm(chatId, ctx, nextTurn)
    return true
}

// ─── Steal window ─────────────────────────────────────────────
// After ANY failed turn, hold off on announcing the next turn and
// instead give any OTHER active player a short window to grab the
// same required letter for a rescue bonus. If nobody does, the
// already-computed nextTurn (whatever it would normally have been)
// gets announced exactly as if the window had never existed.
async function maybeOpenStealOrContinue(chatId, ctx, requiredLetter, category, excludeNumber, nextTurn) {
    if (nextTurn.type === 'match_ended' || config.STEAL_WINDOW_SECONDS <= 0) {
        await announceAndArm(chatId, ctx, nextTurn)
        return
    }
    await openStealWindow(chatId, ctx, requiredLetter, category, excludeNumber, nextTurn)
}

async function openStealWindow(chatId, ctx, requiredLetter, category, excludeNumber, nextTurn) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.steal = { open: true, requiredLetter, category, excludeNumber, pendingNextTurn: nextTurn }
    if (typeof persistGames === 'function') persistGames()

    const needText = requiredLetter
        ? `still needs "${requiredLetter.toUpperCase()}"`
        : `still needs to open the chain — any valid word works`
    await sock.sendMessage(chatId, {
        text: `💥 Chain in danger! ${needText}. First correct reply in the next ${config.STEAL_WINDOW_SECONDS}s STEALS it for a bonus! 🦸`
    })

    gameState.stealTimer = setTimeout(() => resolveStealTimeout(chatId, ctx), config.STEAL_WINDOW_SECONDS * 1000)
}

async function resolveStealTimeout(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.steal || !gameState.steal.open) return

    const pending = gameState.steal.pendingNextTurn
    gameState.steal = null
    gameState.stealTimer = null
    await announceAndArm(chatId, ctx, pending)
}

// Called by publicCommands.js for a message from anyone OTHER than
// the player whose turn just failed, while a steal window is open.
// Returns true if it was consumed as a (successful) steal — an
// unsuccessful attempt is silently ignored (return false) so trying
// and missing never costs the would-be rescuer anything; only a
// correct steal changes any state.
async function attemptSteal(chatId, ctx, senderNumber, rawWord) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (!gameState.active || !gameState.steal || !gameState.steal.open) return false
    if (senderNumber === gameState.steal.excludeNumber) return false
    if (!gameState.players.includes(senderNumber)) return false

    const { requiredLetter, category } = gameState.steal
    const word = (rawWord || '').trim().toLowerCase()
    const result = wordBank.validateWord(word, requiredLetter, category, gameState.usedWords)
    if (!result.valid) return false

    if (gameState.stealTimer) clearTimeout(gameState.stealTimer)
    gameState.steal = null
    gameState.stealTimer = null

    const tag = tagFor(gameState, senderNumber, settings)
    const bonus = applySuccessfulWord(gameState, senderNumber, word, null, 0)
    gameState.score[senderNumber] = (gameState.score[senderNumber] || 0) + config.STEAL_BONUS

    await sock.sendMessage(chatId, {
        text: `🦸 ${tag} STOLE it with "${word}"! +${bonus.points + config.STEAL_BONUS} pts (incl. +${config.STEAL_BONUS} steal) 🔥`
    })

    const rotated = maybeRotateSector(gameState)
    if (rotated) await announceSectorShift(chatId, ctx, rotated)

    if (typeof persistGames === 'function') persistGames()
    const nextTurn = advanceToNextTurn(gameState)
    await announceAndArm(chatId, ctx, nextTurn)
    return true
}

// ─── Lobby open + countdown (engine-owned) ─────────────────────
async function openFreshLobby(chatId, ctx) {
    const { sock, games, settings, nameCache, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.players = []
    gameState.playerNames = {}
    gameState.playerJids = {}
    gameState.lobbyActive = true
    gameState.lobbySecondsLeft = config.LOBBY_SECONDS

    const creatorEnvJid   = process.env.CREATOR_JID || ''
    const creatorNum      = creatorEnvJid ? creatorEnvJid.split('@')[0].split(':')[0] : ''
    const creatorAutoJoin = settings.creatorOverrides?.autoJoin !== false
    const adminAutoJoin   = settings.autoJoin !== false

    if (creatorNum && creatorAutoJoin) {
        gameState.players.push(creatorNum)
        gameState.playerNames[creatorNum] = (nameCache && nameCache[creatorNum]) || 'Creator'
        gameState.playerJids[creatorNum]  = creatorEnvJid
    }
    if (settings.adminNumber && settings.adminNumber !== creatorNum && adminAutoJoin) {
        gameState.players.push(settings.adminNumber)
        gameState.playerNames[settings.adminNumber] = (nameCache && nameCache[settings.adminNumber]) || 'Admin'
        gameState.playerJids[settings.adminNumber]  = settings.adminJid || `${settings.adminNumber}@s.whatsapp.net`
    }

    activeGameChatRef.value = chatId
    persistGames()

    const autoJoinMentions = gameState.players.map(num => gameState.playerJids[num])
    const autoJoinText = gameState.players.length > 0
        ? gameState.players.map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)} — Auto-joined 👑`).join('\n')
        : '[No one yet — be first! 🎯]'

    await sock.sendMessage(chatId, {
        text:
            `🔗 *${config.GAME_NAME}* starting! Type *${config.PREFIX} join* — ${config.LOBBY_SECONDS}s to join.\n` +
            `🎯 Opens in: ${categoryDisplay(config.SECTOR_SEQUENCE[0])} — auto-shifts sector every ${config.SECTOR_LENGTH} words\n` +
            `👥 ${autoJoinText}`,
        mentions: autoJoinMentions
    })

    startLobbyCountdown(chatId, ctx)
}

function startLobbyCountdown(chatId, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
    gameState.lobbyTimer = setInterval(async () => {
        if (!gameState.lobbyActive) {
            clearInterval(gameState.lobbyTimer)
            return
        }
        gameState.lobbySecondsLeft--
        if (gameState.lobbySecondsLeft <= 0) {
            clearInterval(gameState.lobbyTimer)
            await closeLobbyAndStart(chatId, ctx)
        } else if (gameState.lobbySecondsLeft % 10 === 0) {
            await sock.sendMessage(chatId, {
                text: `⏳ ${gameState.lobbySecondsLeft}s left to join — 👥 ${gameState.players.length} joined`
            })
        }
        persistGames()
    }, 1000)
}

async function closeLobbyAndStart(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)

    if (gameState.players.length < config.MIN_PLAYERS_TO_BEGIN) {
        gameState.lobbyActive = false
        ctx.activeGameChatRef.value = null
        await sock.sendMessage(chatId, {
            text: `⚠️ Not enough players joined — *${config.GAME_NAME}* lobby closed without starting a chain.`
        })
        return
    }
    await sock.sendMessage(chatId, {
        text: `🚀 Chain begins! ${gameState.players.length} player${gameState.players.length === 1 ? '' : 's'} ready.`
    })
    await startChain(chatId, ctx)
}

// ─── Starting the chain (called once the lobby closes) ─────────
async function startChain(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    clearTimers(gameState)
    gameState.lobbyActive = false
    gameState.active = true
    gameState.lastWord = null
    gameState.usedWords = []
    gameState.totalWords = 0
    gameState.eliminated = []
    gameState.strikes = {}
    gameState.contributions = {}
    gameState.score = {}
    gameState.streak = {}
    gameState.category = config.SECTOR_SEQUENCE[0]
    gameState.sectorIndex = 0
    gameState.wordsInCurrentSector = 0
    gameState.steal = null
    gameState.turnOrder = shuffle(gameState.players)
    gameState.turnIndex = 0
    gameState.matchStartedAt = Date.now()
    gameState.answerTimeMs = {}
    gameState.longestWord = null
    gameState.turnStartedAt = 0
    gameState.pausedAt = null
    gameState.pausedMsThisTurn = 0

    for (const num of gameState.players) {
        gameState.strikes[num] = 0
        gameState.contributions[num] = 0
        gameState.score[num] = 0
        gameState.streak[num] = 0
        gameState.answerTimeMs[num] = 0
    }

    persistGames()

    const first = advanceToNextTurn(gameState)
    await announceAndArm(chatId, ctx, first)
}

// ─── Pause / resume (kernel-parity feature) ─────────────────────
function pauseSession(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    const paused = kernel.pauseTimer(gameState, gameState.turnTimer, clearInterval)
    if (paused) kernel.markPauseStart(gameState)
    return paused
}

function resumeSession(chatId, ctx) {
    const { games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    kernel.markPauseEnd(gameState)
    const seconds = turnSecondsFor(gameState, settings)
    const resumed = kernel.resumeTimer(gameState, () => {
        armTurnTimer(chatId, ctx, seconds)
    })
    if (resumed && typeof persistGames === 'function') persistGames()
    return resumed
}

function forceStopActiveSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const wasRunning = !!(gameState.active || gameState.lobbyActive)

    clearTimers(gameState)
    gameState.active = false
    gameState.lobbyActive = false

    if (typeof persistGames === 'function') persistGames()
    return wasRunning
}

module.exports = {
    stateKey,
    getGameState,
    freshState,
    addToLobby,
    clearTimers,
    jidFor,
    tagFor,
    turnSecondsFor,
    turnTimerDisplay,
    categoryDisplay,
    openFreshLobby,
    closeLobbyAndStart,
    startChain,
    submitGuess,
    attemptSteal,
    pauseSession,
    resumeSession,
    forceStopActiveSession,
    tickTurnTimer
}
