// ============================================================
//  WordClimbGame/gameEngine.js — Word Climb · Sky Graphics
//  Game-state logic AND turn-timer/messaging, following the same
//  convention already established by HangmanGame/gameEngine.js in
//  this project (its startTurnCountdown() also owns setInterval +
//  sock.sendMessage directly) — publicCommands.js stays a thin
//  layer over these functions rather than duplicating turn flow.
//
//  How a match works:
//   - Players take turns in a shuffled rotation. On your turn the
//     bot gives you a starting LETTER and a required LENGTH.
//   - You have a turn timer to reply with a real word of exactly
//     that length, starting with that letter, not already used
//     this match. Correct → your turn ends cleanly, your personal
//     best length updates. Wrong / invalid / timeout → a strike.
//   - The required length is the same for every player during one
//     full lap of the rotation. Once everyone still standing has
//     had a turn at the current length, the length climbs by +1
//     for the next lap (config.MIN_LENGTH → config.MAX_LENGTH).
//   - The turn timer shrinks as the length climbs (see
//     gameKernel.computeScaledSeconds — config.TURN_SECONDS_START
//     down to config.TURN_SECONDS_FLOOR), unless an admin has set a
//     fixed override via "/wcl setturnseconds", which wins outright.
//   - 3 strikes (accumulated across the whole match, not per lap)
//     and you're eliminated. Elimination order is preserved for
//     the final report, along with each player's own accumulated
//     answer time (gameKernel's pause-aware turn-time tracker) and
//     the single longest word of the match regardless of who
//     ultimately won it.
//   - The match ends when either only one player remains (they
//     win outright) or the climb passes config.MAX_LENGTH with
//     multiple survivors (best personal length wins; ties broken
//     by fewest strikes).
// ============================================================

const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')
const kernel = require('../gameKernel')
const config = require('./config')
const wordBank = require('./wordBank')

// Effective turn-timer seconds for the CURRENT length. An admin's
// fixed "/wcl setturnseconds" override replaces the whole curve;
// otherwise it's gameKernel's shared shrink-as-you-climb curve.
function turnSecondsFor(gameState, settings) {
    const override = resolveSetting(`${config.GAME_KEY}_turnSeconds`, settings, null)
    if (override !== null && override !== undefined) return override
    return kernel.computeScaledSeconds({
        current:      gameState.currentLength,
        min:          config.MIN_LENGTH,
        max:          config.MAX_LENGTH,
        startSeconds: config.TURN_SECONDS_START,
        floorSeconds: config.TURN_SECONDS_FLOOR
    })
}

// Human-readable line for admin status/help screens — shows the
// live curve range when no override is set, or the fixed override
// value when one is. Exported so adminCommands.js never has to know
// which mode is active to render it correctly.
function turnTimerDisplay(settings) {
    const override = resolveSetting(`${config.GAME_KEY}_turnSeconds`, settings, null)
    if (override !== null && override !== undefined) return `${override}s (fixed override)`
    return `${config.TURN_SECONDS_START}s → ${config.TURN_SECONDS_FLOOR}s as length climbs (auto)`
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

        players:      [],   // numbers still in the climb
        playerNames:  {},
        playerJids:   {},
        strikes:      {},   // { [number]: count }
        bestLength:   {},   // { [number]: highest length successfully answered }
        eliminated:   [],   // [{ number, name, reason, atLength, bestLength, order }]

        currentLength:   config.MIN_LENGTH,
        usedWords:       {},  // { [length]: [word, ...] } — no repeats within a length
        turnOrder:       [],  // rotation for the current/next lap
        turnIndex:       0,
        currentPlayer:   null,
        currentLetter:   null,
        recentLetters:   [],  // avoid repeating the same letter back-to-back

        matchStartedAt: 0,
        answerTimeMs:      {},   // { [number]: accumulated ms spent on own turns }
        turnStartedAt:     0,
        pausedAt:          null,
        pausedMsThisTurn:  0,
        longestWord:       null  // { word, length, number } — single longest word of the match, winner or not
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
    if (gameState.turnTimer) clearTimeout(gameState.turnTimer)
    gameState.lobbyTimer = null
    gameState.turnTimer = null
}

function jidFor(gameState, number) {
    return gameState.playerJids[number] || `${number}@s.whatsapp.net`
}

function tagFor(gameState, number, settings) {
    return nameTag(number, gameState.playerNames, settings)
}

// ── Pure state transition: which player/letter/length is next ───
// Returns { type: 'turn_started', ... } or { type: 'match_ended', ... }.
// Never touches sock — that's announceAndArm()'s job below.
function advanceToNextTurn(gameState) {
    if (gameState.turnOrder.length === 0) {
        return endClimbState(gameState, 'no_survivors')
    }

    if (gameState.turnIndex >= gameState.turnOrder.length) {
        gameState.turnIndex = 0
        gameState.currentLength += 1
        if (gameState.currentLength > config.MAX_LENGTH) {
            return endClimbState(gameState, 'reached_top')
        }
    }

    const letter = wordBank.randomLetterAt(gameState.currentLength, gameState.recentLetters)
    if (!letter) {
        // Dictionary ran out at this length — treat as reaching the top
        // rather than serving an impossible prompt.
        return endClimbState(gameState, 'reached_top')
    }

    gameState.recentLetters = [letter, ...gameState.recentLetters].slice(0, 2)
    gameState.currentPlayer = gameState.turnOrder[gameState.turnIndex]
    gameState.currentLetter = letter

    return {
        type: 'turn_started',
        player: gameState.currentPlayer,
        length: gameState.currentLength,
        letter
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
        atLength: gameState.currentLength,
        bestLength: gameState.bestLength[number] || 0,
        answerTimeMs: (gameState.answerTimeMs && gameState.answerTimeMs[number]) || 0,
        order: gameState.eliminated.length + 1
    })

    const playerIdx = gameState.players.indexOf(number)
    if (playerIdx !== -1) gameState.players.splice(playerIdx, 1)

    if (gameState.turnOrder.length <= 1) {
        return endClimbState(gameState, gameState.turnOrder.length === 1 ? 'last_standing' : 'no_survivors')
    }
    return null // still going — caller should call advanceToNextTurn next
}

function endClimbState(gameState, reason) {
    clearTimers(gameState)
    gameState.active = false

    const survivors = [...gameState.players]
    let winner = null

    if (reason === 'last_standing' && survivors.length === 1) {
        winner = survivors[0]
    } else if (survivors.length > 0) {
        winner = [...survivors].sort((a, b) => {
            const lenDiff = (gameState.bestLength[b] || 0) - (gameState.bestLength[a] || 0)
            if (lenDiff !== 0) return lenDiff
            return (gameState.strikes[a] || 0) - (gameState.strikes[b] || 0)
        })[0]
    }

    const report = matchSummary.buildFinalBoard(gameState, winner, reason)
    return { type: 'match_ended', reason, winner, survivors, report }
}

// ─── Sock-aware turn flow ───────────────────────────────────────
// This is the part that owns the timer and posts messages — see
// the file header for why that lives here rather than purely in
// publicCommands.js.
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
    const totalWords = Object.values(gameState.usedWords).reduce((n, list) => n + list.length, 0)

    await sock.sendMessage(chatId, {
        text:
            `🎲 ${tag}'s turn — next: ${nextTag}\n` +
            `🆎 ${turnResult.length} letters, starts with "${turnResult.letter.toUpperCase()}"\n` +
            `⏳ ${seconds}s · 🏆 ${gameState.turnOrder.length} left · 📝 ${totalWords} words`,
        mentions: [jid, nextPlayer ? jidFor(gameState, nextPlayer) : jid]
    })

    kernel.markTurnStart(gameState)
    if (gameState.turnTimer) clearTimeout(gameState.turnTimer)
    persistGames()
    gameState.turnTimer = setTimeout(() => handleTimeout(chatId, ctx), seconds * 1000)
}

async function sendFinalBoard(chatId, ctx, endResult) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const text = matchSummary.renderFinalBoardText(endResult.report)
    await sock.sendMessage(chatId, { text })

    // Cross-match leaderboard (opt-in, see gameKernel.js) — every
    // player who was ever in this match, winner and eliminated alike,
    // with their own bestLength as the personal-best stat (higher is
    // better for WordClimb).
    const allParticipants = [
        ...gameState.players.map(num => ({
            number: num,
            name: gameState.playerNames[num] || num,
            won: num === endResult.winner,
            statValue: gameState.bestLength[num] || 0
        })),
        ...gameState.eliminated.map(e => ({
            number: e.number,
            name: e.name,
            won: false,
            statValue: e.bestLength || 0
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
    kernel.accumulateTurnTime(gameState, number, seconds * 1000)

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

    if (endResult) {
        await announceAndArm(chatId, ctx, endResult)
        return
    }
    const nextTurn = advanceToNextTurn(gameState)
    await announceAndArm(chatId, ctx, nextTurn)
}

// Called by publicCommands.js when the currently-active player
// posts a message during their open turn window. Returns true if
// this message was consumed as a guess attempt (right or wrong),
// false if it wasn't this player's turn / no round is active.
async function submitGuess(chatId, ctx, senderNumber, rawWord) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (!gameState.active || gameState.paused) return false
    if (senderNumber !== gameState.currentPlayer) return false

    if (gameState.turnTimer) clearTimeout(gameState.turnTimer)

    const length = gameState.currentLength
    const letter = gameState.currentLetter
    const usedAtLength = gameState.usedWords[length] || []
    const word = (rawWord || '').trim().toLowerCase()
    const tag = tagFor(gameState, senderNumber, settings)
    const seconds = turnSecondsFor(gameState, settings)
    kernel.accumulateTurnTime(gameState, senderNumber, seconds * 1000)

    const valid = wordBank.isValidWord(word, length, letter, usedAtLength)

    if (!valid) {
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
                ? `❌ "${rawWord}" doesn't fit — ${tag} is *out* (${config.MAX_STRIKES}/${config.MAX_STRIKES} strikes) 🚫`
                : `❌ "${rawWord}" doesn't fit — ${tag} takes strike ${gameState.strikes[senderNumber]}/${config.MAX_STRIKES} 💢`
        })

        const nextTurn = endResult || advanceToNextTurn(gameState)
        await announceAndArm(chatId, ctx, nextTurn)
        return true
    }

    gameState.usedWords[length] = [...usedAtLength, word]
    gameState.bestLength[senderNumber] = Math.max(gameState.bestLength[senderNumber] || 0, length)
    if (!gameState.longestWord || length > gameState.longestWord.length) {
        gameState.longestWord = { word, length, number: senderNumber }
    }
    gameState.turnIndex += 1
    persistGames()

    await sock.sendMessage(chatId, {
        text: `✅ "${word}" — ${tag} climbs to ${length}! 🧗`
    })

    const nextTurn = advanceToNextTurn(gameState)
    await announceAndArm(chatId, ctx, nextTurn)
    return true
}

// ─── Lobby open + countdown (engine-owned, see file header) ────
// Previously this lived inline in publicCommands.js (direct
// gameState mutation + its own setInterval), while HangmanGame
// routed the equivalent through gameEngine.openFreshLobby(). Two
// different architectural layers for the same job under the same
// folder-naming convention — moved here so WCL matches Hangman's
// contract: publicCommands.js stays a thin glue layer, the engine
// owns lobby state + timers + messaging, same as it already owns
// the turn flow above.
async function openFreshLobby(chatId, ctx) {
    const { sock, games, settings, nameCache, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.players = []
    gameState.playerNames = {}
    gameState.playerJids = {}
    gameState.lobbyActive = true
    gameState.lobbySecondsLeft = config.LOBBY_SECONDS

    // Auto-join — same bot-wide "autoJoin" setting Hangman reads,
    // now reachable via "/game set autojoin" from any active game.
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
            `🧗 *${config.GAME_NAME}* starting! Type *${config.PREFIX} join* — ${config.LOBBY_SECONDS}s to join.\n` +
            `👥 ${autoJoinText}`,
        mentions: autoJoinMentions
    })

    startLobbyCountdown(chatId, ctx)
}

function startLobbyCountdown(chatId, ctx) {
    const { sock, games, settings, persistGames } = ctx
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
            text: `⚠️ Not enough players joined — *${config.GAME_NAME}* lobby closed without a climb.`
        })
        return
    }
    await sock.sendMessage(chatId, {
        text: `🚀 Climb begins! ${gameState.players.length} climber${gameState.players.length === 1 ? '' : 's'} ready.`
    })
    await startClimb(chatId, ctx)
}

// ─── Starting the climb (called once the lobby closes) ─────────
async function startClimb(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    clearTimers(gameState)
    gameState.lobbyActive = false
    gameState.active = true
    gameState.currentLength = config.MIN_LENGTH
    gameState.usedWords = {}
    gameState.eliminated = []
    gameState.strikes = {}
    gameState.bestLength = {}
    gameState.recentLetters = []
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
        gameState.bestLength[num] = 0
        gameState.answerTimeMs[num] = 0
    }

    persistGames()

    const first = advanceToNextTurn(gameState)
    await announceAndArm(chatId, ctx, first)
}

// ─── Pause / resume (kernel-parity feature — see MEMORY.md rule 5:
// game-agnostic admin needs that were only ever built once, inside
// Hangman). WCL's turn timer is a setTimeout, not Hangman's
// self-clearing setInterval, so pause clears the pending timeout
// outright; resume re-arms a fresh full-length timer rather than
// trying to recover an exact remaining count — simplest correct
// behavior, and the resume message says so.
function pauseSession(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    const paused = kernel.pauseTimer(gameState, gameState.turnTimer, clearTimeout)
    if (paused) kernel.markPauseStart(gameState)
    return paused
}

function resumeSession(chatId, ctx) {
    const { games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    kernel.markPauseEnd(gameState)
    const seconds = turnSecondsFor(gameState, settings)
    const resumed = kernel.resumeTimer(gameState, () => {
        gameState.turnTimer = setTimeout(() => handleTimeout(chatId, ctx), seconds * 1000)
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
    openFreshLobby,
    closeLobbyAndStart,
    startClimb,
    submitGuess,
    pauseSession,
    resumeSession,
    forceStopActiveSession
}
