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
//   - You have TURN_SECONDS to reply with a real word of exactly
//     that length, starting with that letter, not already used
//     this match. Correct → your turn ends cleanly, your personal
//     best length updates. Wrong / invalid / timeout → a strike.
//   - The required length is the same for every player during one
//     full lap of the rotation. Once everyone still standing has
//     had a turn at the current length, the length climbs by +1
//     for the next lap (config.MIN_LENGTH → config.MAX_LENGTH).
//   - 3 strikes (accumulated across the whole match, not per lap)
//     and you're eliminated. Elimination order is preserved for
//     the final report.
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

function turnSeconds(settings) {
    return resolveSetting(`${config.GAME_KEY}_turnSeconds`, settings, config.TURN_SECONDS)
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
        turnSecondsLeft:  config.TURN_SECONDS,

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

        matchStartedAt: 0
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
    const seconds = turnSeconds(settings)

    await sock.sendMessage(chatId, {
        text:
            `${config.DIVIDER}\n` +
            `${config.BOT_EMOJI} *Rung: ${turnResult.length} letters*\n` +
            `${config.DIVIDER}\n` +
            `👉 ${tag}, give me a *${turnResult.length}-letter* word starting with *"${turnResult.letter.toUpperCase()}"*\n` +
            `⏱️ You have *${seconds} seconds*.`,
        mentions: [jid]
    })

    if (gameState.turnTimer) clearTimeout(gameState.turnTimer)
    persistGames()
    gameState.turnTimer = setTimeout(() => handleTimeout(chatId, ctx), seconds * 1000)
}

async function sendFinalBoard(chatId, ctx, endResult) {
    const { sock, activeGameChatRef } = ctx
    const text = matchSummary.renderFinalBoardText(endResult.report)
    await sock.sendMessage(chatId, { text })
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

    gameState.strikes[number] = (gameState.strikes[number] || 0) + 1
    const struckOut = gameState.strikes[number] >= config.MAX_STRIKES

    let endResult = null
    if (struckOut) {
        endResult = eliminateFromState(gameState, number, 'timeout')
    } else {
        gameState.turnIndex += 1
    }
    persistGames()

    if (struckOut) {
        await sock.sendMessage(chatId, {
            text:
                `⏱️ *Time's up!* ${tag} didn't answer in time — that's strike ` +
                `*${config.MAX_STRIKES}/${config.MAX_STRIKES}*. 🚫 *Eliminated from the climb!*`
        })
    } else {
        await sock.sendMessage(chatId, {
            text: `⏱️ *Time's up!* ${tag} takes a strike (*${gameState.strikes[number]}/${config.MAX_STRIKES}*). 💢`
        })
    }

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
                ? `❌ *"${rawWord}"* doesn't work (needs ${length} letters, start with "${letter.toUpperCase()}", and be a real word). ` +
                  `That's strike *${config.MAX_STRIKES}/${config.MAX_STRIKES}* — ${tag} is *eliminated!* 🚫`
                : `❌ *"${rawWord}"* doesn't work (needs ${length} letters, start with "${letter.toUpperCase()}", and be a real word). ` +
                  `Strike *${gameState.strikes[senderNumber]}/${config.MAX_STRIKES}* for ${tag}. 💢`
        })

        const nextTurn = endResult || advanceToNextTurn(gameState)
        await announceAndArm(chatId, ctx, nextTurn)
        return true
    }

    gameState.usedWords[length] = [...usedAtLength, word]
    gameState.bestLength[senderNumber] = Math.max(gameState.bestLength[senderNumber] || 0, length)
    gameState.turnIndex += 1
    persistGames()

    await sock.sendMessage(chatId, {
        text: `✅ *"${word}"* is good! ${tag} climbs to *${length} letters*. 🧗`
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
            `${config.DIVIDER}\n` +
            `${config.BOT_EMOJI} *${config.GAME_NAME} is Starting!*\n` +
            `${config.DIVIDER}\n\n` +
            `The climb begins at *${config.MIN_LENGTH} letters* and tops out at *${config.MAX_LENGTH}*.\n\n` +
            `You have *${config.LOBBY_SECONDS} seconds* to join! ⏱️\n\n` +
            `👥 *Current Lobby:*\n${autoJoinText}\n\n` +
            `*Commands:*\n` +
            `*${config.PREFIX} join* — Enter the lobby\n` +
            `_(an admin can start early with \`${config.ADMIN_PREFIX.trim()} begin\`)_\n\n` +
            `_Type *${config.PREFIX} join* now!_ 🔥`,
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
            const lobbyText = gameState.players
                .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
                .join('\n')
            await sock.sendMessage(chatId, {
                text:
                    `⏱️ *${gameState.lobbySecondsLeft}s* left to join *${config.GAME_NAME}*!\n\n` +
                    `👥 *Lobby:*\n${lobbyText || '[No one yet — be first! 🎯]'}`
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
        text: `🚀 *Lobby closed — the climb begins!* ${gameState.players.length} climber${gameState.players.length === 1 ? '' : 's'} ready.`
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

    for (const num of gameState.players) {
        gameState.strikes[num] = 0
        gameState.bestLength[num] = 0
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
    return kernel.pauseTimer(gameState, gameState.turnTimer, clearTimeout)
}

function resumeSession(chatId, ctx) {
    const { games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const seconds = turnSeconds(settings)
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
    openFreshLobby,
    closeLobbyAndStart,
    startClimb,
    submitGuess,
    pauseSession,
    resumeSession,
    forceStopActiveSession
}
