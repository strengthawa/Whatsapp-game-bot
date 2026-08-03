// ============================================================
//  HangmanGame/gameEngine.js — Hangman · Sky Graphics
//  Pure game logic: lobby, countdowns, boards, turn management,
//  adaptive word-length difficulty, post-round cooldown, and the
//  per-player DM "stick figure" life tracker.
//
//  Imports permissions.js (root) for nameTag + resolveSetting only.
//  No admin logic, no "/" command handling — that's adminCommands.js.
// ============================================================

const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')
const kernel = require('../gameKernel')
const config = require('./config')

// ─── Default flat word pool ────────────────────────────────────
// Difficulty is no longer three hand-picked tiers. It is a single
// pool, and "difficulty" is simply the target word LENGTH for the
// current chat, which drifts up/down round to round based on how
// the group performed (see adjustNextWordLength below). Words below
// span the full 4–12 letter range so there's always something to
// pick close to the current target.
const DEFAULT_WORDS = [
    // 4
    'blue', 'fire', 'gold', 'king', 'moon', 'rain', 'star', 'wolf', 'zero', 'frog',
    // 5
    'apple', 'bread', 'cloud', 'dance', 'earth', 'flame', 'grape', 'house', 'ivory', 'juice',
    // 6
    'orange', 'purple', 'castle', 'forest', 'guitar', 'planet', 'silver', 'turtle', 'wizard', 'yellow',
    // 7
    'browser', 'element', 'network', 'program', 'website', 'science', 'offline', 'desktop', 'journey', 'rainbow',
    // 8
    'database', 'keyboard', 'mountain', 'elephant', 'sandwich', 'umbrella', 'triangle', 'calendar',
    // 9
    'algorithm', 'framework', 'hierarchy', 'interface', 'butterfly', 'chocolate', 'dashboard', 'landscape',
    // 10
    'blockchain', 'deployment', 'governance', 'javascript', 'basketball', 'photograph', 'skateboard',
    // 11
    'application', 'celebration', 'fingerprint', 'grandmother',
    // 12
    'cryptography', 'organization', 'entertainment', 'international'
]

// ─── Automated maxTries ─────────────────────────────────────────
// Attempts scale with word length only (no more difficulty tiers).
// settings.maxTries can be 'auto' (default) or a positive integer
// manual override, snapshotted onto gameState.roundMaxTries the
// moment a word is picked so a live /hmg set maxtries change never
// affects a round already in progress.
function calcMaxTries(word) {
    const len = (word || '').length
    return Math.max(5, Math.min(10, Math.round(len * 0.7) + 2))
}

function resolveRoundMaxTries(word, settings) {
    const configured = resolveSetting('maxTries', settings, 'auto')
    if (configured === 'auto' || configured === undefined || configured === null) {
        return calcMaxTries(word)
    }
    const n = typeof configured === 'number' ? configured : parseInt(configured, 10)
    if (Number.isInteger(n) && n > 0) return n
    return calcMaxTries(word)
}

// ─── Word selection by target length ───────────────────────────
// Picks a random word matching the target length exactly. If none
// exist at that exact length, expands outward (±1, ±2, ...) until
// it finds a match, so a sparse pool never crashes the game.
function pickWordForLength(pool, targetLength) {
    for (let radius = 0; radius <= config.MAX_WORD_LENGTH; radius++) {
        const candidates = pool.filter(w =>
            Math.abs(w.length - targetLength) === radius
        )
        if (candidates.length > 0) {
            return candidates[Math.floor(Math.random() * candidates.length)]
        }
    }
    // Should never happen with a non-empty pool, but stay safe.
    return pool[Math.floor(Math.random() * pool.length)]
}

// ─── Adaptive difficulty adjustment ─────────────────────────────
// Called once a round ends. Nudges gameState.wordLengthTarget for
// NEXT round based on how this one went:
//   - Clean win (instant full-word guess, or low wrong-guess ratio,
//     no disqualifications) → word gets longer (harder).
//   - Any disqualification, or the round ended with no winner       → word gets shorter (easier).
//   - Otherwise (normal single-letter win with some misses)         → stays the same.
// This is intentionally simple — one signal, one small nudge — so it
// stays readable and never overshoots into wildly swinging lengths.
function adjustNextWordLength(gameState, outcome) {
    const current = gameState.wordLengthTarget || config.START_WORD_LENGTH
    const dqCount = (gameState.disqualified || []).length
    const roundMaxTries = gameState.roundMaxTries || 6
    const totalWrong = Object.values(gameState.attempts || {}).reduce((a, b) => a + b, 0)
    const wrongRatio = roundMaxTries > 0 ? totalWrong / roundMaxTries : 0

    let next = current

    if (outcome.type === 'winner_instant' || (outcome.type === 'winner_letter' && wrongRatio <= 0.34 && dqCount === 0)) {
        next = current + config.LENGTH_STEP
    } else if (dqCount > 0 || outcome.type === 'no_winner') {
        next = current - config.LENGTH_STEP
    }

    gameState.wordLengthTarget = Math.max(
        config.MIN_WORD_LENGTH,
        Math.min(config.MAX_WORD_LENGTH, next)
    )
}

// ─── Stick figure ASCII art — adaptive to word length ───────────
// 6 body parts, removed one guess at a time: Right Leg, Left Leg,
// Right Arm, Left Arm, Torso, Head (head gone = disqualified).
//
// The schedule adapts to THIS round's maxTries (word-length driven,
// 5-10 in auto mode) instead of assuming a fixed 10 wrong guesses:
//   - maxTries >= 6: the first (maxTries-6) parts each get an X
//     ("hit") guess before their own "gone" guess; any parts beyond
//     that go straight from whole to gone in one guess. At exactly
//     maxTries===6, every part goes straight to gone -- no X shown
//     anywhere, since there's no guess to spare for a warning.
//   - maxTries < 6: there are MORE parts than guesses, so a single
//     wrong guess removes more than one part at once (never skips a
//     part, never leaves one dangling) -- guaranteed to reach exactly
//     zero parts remaining on the final guess, whatever maxTries is.
// Either way, the last wrong guess always empties the figure -- the
// body is never "left over" after elimination, and never runs out
// before it.
const BODY_PARTS = ['Right Leg', 'Left Leg', 'Right Arm', 'Left Arm', 'Torso', 'Head']

const PART_EMOJI = {
    'Right Leg': '🦵', 'Left Leg': '🦵', 'Right Arm': '💪', 'Left Arm': '💪',
    'Torso': '🫥', 'Head': '💀'
}

function buildStickSchedule(maxTries) {
    const schedule = []
    if (maxTries >= BODY_PARTS.length) {
        const extra = Math.min(maxTries - BODY_PARTS.length, BODY_PARTS.length)
        BODY_PARTS.forEach((part, i) => {
            if (i < extra) schedule.push({ hit: part })
            schedule.push({ gone: [part] })
        })
    } else {
        let goneSoFar = 0
        for (let g = 1; g <= maxTries; g++) {
            const goalGone = Math.min(BODY_PARTS.length, Math.ceil((g * BODY_PARTS.length) / maxTries))
            schedule.push({ gone: BODY_PARTS.slice(goneSoFar, goalGone) })
            goneSoFar = goalGone
        }
    }
    return schedule
}

// Replays the schedule up through wrongCount guesses and returns the
// per-part state ('whole' | 'hit' | 'gone') plus the event that
// happened on THIS exact guess (for the caption).
function computeBodyState(wrongCount, maxTries) {
    const schedule = buildStickSchedule(maxTries)
    const state = {}
    BODY_PARTS.forEach(p => { state[p] = 'whole' })

    const clamped = Math.max(0, Math.min(wrongCount, schedule.length))
    let lastEvent = null
    for (let i = 0; i < clamped; i++) {
        const ev = schedule[i]
        if (ev.hit) state[ev.hit] = 'hit'
        if (ev.gone) ev.gone.forEach(p => { state[p] = 'gone' })
        if (i === clamped - 1) lastEvent = ev
    }
    return { state, lastEvent }
}

function renderPart(status, whole, hit) {
    if (status === 'whole') return whole
    if (status === 'hit') return hit
    return ' ' // gone
}

function buildStickFigureArt(state) {
    const head  = renderPart(state['Head'],       'O',  'x')
    const larm  = renderPart(state['Left Arm'],    '/',  'x')
    const torso = renderPart(state['Torso'],       '|',  'x')
    const rarm  = renderPart(state['Right Arm'],   '\\', 'x')
    const lleg  = renderPart(state['Left Leg'],    '/',  'x')
    const rleg  = renderPart(state['Right Leg'],   '\\', 'x')
    return (
        ` ______\n` +
        ` |    |\n` +
        ` |    ${head}\n` +
        ` |   ${larm}${torso}${rarm}\n` +
        ` |   ${lleg} ${rleg}\n` +
        `_|__`
    )
}

// One-time intro card -- sent the first time a player is up, so they
// see their full, untouched figure before losing anything.
function buildStickFigureIntro(playerTag) {
    const wholeState = {}
    BODY_PARTS.forEach(p => { wholeState[p] = 'whole' })
    const art = buildStickFigureArt(wholeState)
    return (
        `🪢 *${playerTag}* -- this is you. Lose a body part with every wrong guess:\n` +
        '```' + art + '```\n' +
        `Lose it all → you're out. Good luck! 🎯`
    )
}

// Group-chat card: tagged with the player's name + strike count, sent
// the moment THIS player misses -- dynamic and per-player.
function buildStickFigureCard(playerTag, wrongCount, maxTries) {
    const { state, lastEvent } = computeBodyState(wrongCount, maxTries)
    const art = buildStickFigureArt(state)
    const remaining = Math.max(0, maxTries - wrongCount)
    const allGone = BODY_PARTS.every(p => state[p] === 'gone')

    let eventLine
    if (lastEvent && lastEvent.hit) {
        eventLine = `${PART_EMOJI[lastEvent.hit]} *${lastEvent.hit} marked — one more miss and it's gone!*`
    } else if (lastEvent && lastEvent.gone && lastEvent.gone.length > 0) {
        const label = lastEvent.gone.join(' + ')
        eventLine = `${PART_EMOJI[lastEvent.gone[0]]} *Lost: ${label} — gone!*`
    } else {
        eventLine = `💥 *Miss!*`
    }

    return (
        `💀 *${playerTag} — Strike ${wrongCount}/${maxTries}!*\n\n` +
        '```' + art + '```\n' +
        `${eventLine}\n` +
        (allGone
            ? `Figure is gone — *${playerTag}* has been disqualified. 🚫`
            : `${remaining} wrong guess${remaining === 1 ? '' : 'es'} left before elimination. Hang in there! 🙌`)
    )
}

// ─── getGameState ─────────────────────────────────────────────
// State is stored under a GAME_KEY-prefixed key (not the bare chatId).
// The `games` object is shared across every game module — without this
// prefix, switching the active game in a chat that a DIFFERENT game had
// previously used in would hand this game a wrong-shaped leftover state
// object instead of a fresh one (confirmed to crash getScoreboard-style
// code in other games). Every game module must follow this convention.
function stateKey(chatId) {
    return `${config.GAME_KEY}:${chatId}`
}

function getGameState(chatId, games) {
    const key = stateKey(chatId)
    if (!games[key]) {
        games[key] = {
            active:            false,
            lobbyActive:       false,
            lobbyTimer:        null,
            lobbySecondsLeft:  config.LOBBY_SECONDS,
            turnTimer:         null,
            turnSecondsLeft:   config.TURN_SECONDS,
            targetWord:        '',
            hiddenWord:        [],
            attempts:          {},   // per-player: { [playerNumber]: count }
            players:           [],
            playerNames:       {},
            playerJids:        {},
            skipStreaks:       {},
            disqualified:      [],
            introShown:        {}, // { [number]: true } — one-time full-figure intro per player, per lobby/round
            currentTurnIndex:  0,
            paused:            false,
            wordLengthTarget:  config.START_WORD_LENGTH,
            cooldownActive:    false,
            cooldownTimer:     null,
            cooldownSecondsLeft: 0
        }
    }
    if (typeof games[key].attempts === 'number') games[key].attempts = {}
    if (!games[key].disqualified) games[key].disqualified = []
    if (!games[key].playerJids)   games[key].playerJids   = {}
    if (!games[key].wordLengthTarget) games[key].wordLengthTarget = config.START_WORD_LENGTH
    return games[key]
}

// ─── Lobby countdown ──────────────────────────────────────────
/** ctx = { sock, games, settings, words, activeGameChatRef, persistGames, nameCache } */
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
            await startActualGame(chatId, ctx)
        } else if (gameState.lobbySecondsLeft % 10 === 0) {
            const lobbyMentions = gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
            const lobbyText = gameState.players
                .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, ctx.settings)}`)
                .join('\n')

            await sock.sendMessage(chatId, {
                text:
                    `⏱️ *${config.GAME_ACRONYM} Lobby — Hurry Up!*\n` +
                    `*${gameState.lobbySecondsLeft} seconds* left to join! Type *${config.PREFIX} join* now.\n` +
                    `📏 Word length this round: *~${gameState.wordLengthTarget} letters*\n\n` +
                    `👥 *Current Lobby:*\n${lobbyText || '[No players yet — be first! 🎯]'}`,
                mentions: lobbyMentions
            })
        }
        persistGames()
    }, 1000)
}

// ─── Open a fresh lobby (used by manual start AND cooldown auto-restart) ──
async function openFreshLobby(chatId, ctx) {
    const { sock, games, settings, nameCache, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.lobbyActive      = true
    gameState.lobbySecondsLeft = config.LOBBY_SECONDS
    gameState.players          = []
    gameState.playerNames      = {}
    gameState.playerJids       = {}
    gameState.skipStreaks      = {}
    gameState.disqualified     = []
    gameState.introShown       = {}

    const creatorEnvJid   = process.env.CREATOR_JID || ''
    const creatorNum      = creatorEnvJid ? creatorEnvJid.split('@')[0].split(':')[0] : ''
    const creatorAutoJoin = settings.creatorOverrides?.autoJoin !== false
    const adminAutoJoin   = settings.autoJoin !== false

    if (creatorNum && creatorAutoJoin) {
        gameState.players.push(creatorNum)
        gameState.playerNames[creatorNum] = nameCache[creatorNum] || 'Creator'
        gameState.playerJids[creatorNum]  = creatorEnvJid
    }
    if (settings.adminNumber && settings.adminNumber !== creatorNum && adminAutoJoin) {
        gameState.players.push(settings.adminNumber)
        gameState.playerNames[settings.adminNumber] = nameCache[settings.adminNumber] || 'Admin'
        gameState.playerJids[settings.adminNumber]  = settings.adminJid || `${settings.adminNumber}@s.whatsapp.net`
    }

    const autoJoinMentions = gameState.players.map(num => gameState.playerJids[num])
    const autoJoinText = gameState.players.length > 0
        ? gameState.players.map((num, i) => `${i + 1}. ${nameTag(num, nameCache, settings)} — Auto-joined 👑`).join('\n')
        : '[No players yet — be first! 🎯]'

    await sock.sendMessage(chatId, {
        text:
            `${config.DIVIDER}\n` +
            `${config.BOT_EMOJI} *${config.GAME_NAME} (${config.GAME_ACRONYM}) is Starting!*\n` +
            `${config.DIVIDER}\n\n` +
            `📏 Word length this round: *~${gameState.wordLengthTarget} letters*\n\n` +
            `You have *${config.LOBBY_SECONDS} seconds* to join! ⏱️\n\n` +
            `👥 *Current Lobby:*\n${autoJoinText}\n\n` +
            `*Commands:*\n` +
            `*${config.PREFIX} join* — Enter the lobby\n` +
            `*${config.PREFIX} help* — See all commands\n\n` +
            `_Type *${config.PREFIX} join* now before time runs out!_ 🔥`,
        mentions: autoJoinMentions
    })

    activeGameChatRef.value = chatId
    persistGames()
    startLobbyCountdown(chatId, ctx)
}

// ─── Start actual game ────────────────────────────────────────
async function startActualGame(chatId, ctx) {
    const { sock, games, settings, words, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    gameState.lobbyActive = false
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)

    if (gameState.players.length === 0) {
        gameState.active = false
        activeGameChatRef.value = null
        persistGames()
        return await sock.sendMessage(chatId, {
            text: `🚫 *Game Cancelled*\nNo one joined the lobby in time. Type *${config.PREFIX} start* to open a fresh lobby! 🎮`
        })
    }

    const pool = (words && words.length > 0) ? words : DEFAULT_WORDS
    gameState.targetWord       = pickWordForLength(pool, gameState.wordLengthTarget)
    gameState.hiddenWord       = gameState.targetWord.split('').map(() => '_')
    gameState.attempts         = {}
    gameState.skipStreaks      = {}
    gameState.disqualified     = []
    gameState.currentTurnIndex = 0
    gameState.active           = true
    gameState.paused           = false
    gameState.roundMaxTries    = resolveRoundMaxTries(gameState.targetWord, settings)
    gameState.roundStartedAt   = Date.now()

    const lobbyMentions = gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
    const lobbyText = gameState.players
        .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
        .join('\n')

    await sock.sendMessage(chatId, {
        text:
            `💀 Game on! ${gameState.targetWord.length} letters · ${gameState.roundMaxTries} attempts each\n` +
            `👥 ${lobbyText}`,
        mentions: lobbyMentions
    })

    persistGames()
    // BUG FIX: this used to call startTurnCountdown() directly, which
    // starts the 30s timer but never shows the masked word / whose-turn
    // message — so round 1 (and every force-started round) began silently.
    // sendGameBoard() renders that first board AND starts the countdown.
    await sendGameBoard(chatId, '', [], ctx)
}

// ─── Game board ───────────────────────────────────────────────
async function sendGameBoard(chatId, actionFeedback = '', extraMentions = [], ctx) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active) return

    const roundMaxTries = gameState.roundMaxTries || calcMaxTries(gameState.targetWord)

    const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
    const currentPlayerJid    = gameState.playerJids[currentPlayerNumber]
    const currentPlayerName   = nameTag(currentPlayerNumber, gameState.playerNames, settings)

    const hasMultiplePlayers = gameState.players.length > 1
    let nextPlayerName = null, nextPlayerJid = null

    if (hasMultiplePlayers) {
        const nextIndex  = (gameState.currentTurnIndex + 1) % gameState.players.length
        const nextNumber = gameState.players[nextIndex]
        nextPlayerJid    = gameState.playerJids[nextNumber]
        nextPlayerName   = nameTag(nextNumber, gameState.playerNames, settings)
    }

    const playerAttempts = gameState.attempts[currentPlayerNumber] || 0
    const attemptsLeft   = roundMaxTries - playerAttempts

    if (!gameState.introShown[currentPlayerNumber]) {
        gameState.introShown[currentPlayerNumber] = true
        await sock.sendMessage(chatId, {
            text: buildStickFigureIntro(currentPlayerName),
            mentions: currentPlayerJid ? [currentPlayerJid] : []
        })
        if (typeof persistGames === 'function') persistGames()
    }

    let boardText = ''
    if (actionFeedback) boardText += `${actionFeedback}\n\n`

    boardText += `\`${gameState.hiddenWord.join(' ')}\` (${gameState.targetWord.length} letters)\n`
    boardText += hasMultiplePlayers
        ? `🎯 ${currentPlayerName} (${attemptsLeft}/${roundMaxTries} left) — next: ${nextPlayerName}\n`
        : `🎯 ${currentPlayerName} (${attemptsLeft}/${roundMaxTries} left) — solo run 😄\n`
    boardText += `⏳ ${config.TURN_SECONDS}s — guess a letter or the full word`

    const mentionJids = [...new Set([
        ...(currentPlayerJid ? [currentPlayerJid] : []),
        ...(nextPlayerJid    ? [nextPlayerJid]    : []),
        ...extraMentions
    ])]

    await sock.sendMessage(chatId, { text: boardText, mentions: mentionJids })

    persistGames()
    startTurnCountdown(chatId, ctx)
}

// ─── Turn countdown ───────────────────────────────────────────
function startTurnCountdown(chatId, ctx) {
    const { sock, games, settings, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (gameState.turnTimer) clearInterval(gameState.turnTimer)

    gameState.turnSecondsLeft = config.TURN_SECONDS

    gameState.turnTimer = setInterval(async () => {
        if (!gameState.active || gameState.paused) {
            clearInterval(gameState.turnTimer)
            return
        }

        gameState.turnSecondsLeft--

        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        const currentPlayerJid    = gameState.playerJids[currentPlayerNumber]
        const currentPlayerName   = nameTag(currentPlayerNumber, gameState.playerNames, settings)

        if (gameState.turnSecondsLeft <= 0) {
            clearInterval(gameState.turnTimer)

            gameState.skipStreaks[currentPlayerNumber] = (gameState.skipStreaks[currentPlayerNumber] || 0) + 1
            const skipCount    = gameState.skipStreaks[currentPlayerNumber]
            const removedIndex = gameState.currentTurnIndex

            if (skipCount >= 3) {
                matchSummary.recordDisqualification(gameState, currentPlayerNumber, matchSummary.DQ_REASONS.SKIPPED_3)

                if (gameState.players.includes(currentPlayerNumber)) {
                    gameState.players.splice(gameState.players.indexOf(currentPlayerNumber), 1)
                }
                delete gameState.playerNames[currentPlayerNumber]
                delete gameState.playerJids[currentPlayerNumber]
                delete gameState.skipStreaks[currentPlayerNumber]
                delete gameState.attempts[currentPlayerNumber]

                const dqText = `🚫 ${currentPlayerName} skipped 3 turns in a row — *removed* 👋`

                const lastStanding = matchSummary.checkLastPlayerStanding(gameState)
                if (lastStanding) {
                    gameState.active = false
                    await sock.sendMessage(chatId, {
                        text: `${dqText}\n🏆 *Last player standing!* The word was *${gameState.targetWord.toUpperCase()}*. 🎉`
                    })
                    const outcome = { type: 'last_standing', winnerNumber: lastStanding }
                    const rep = matchSummary.buildMatchReport(gameState, outcome, (n) => nameTag(n, gameState.playerNames, settings))
                    matchSummary.recordLeaderboard(games, chatId, gameState, outcome)
                    await sock.sendMessage(chatId, { text: rep.text, mentions: rep.mentions })
                    adjustNextWordLength(gameState, outcome)
                    gameState.players = []
                    persistGames()
                    await startCooldown(chatId, ctx)
                    return
                }

                if (gameState.players.length === 0) {
                    gameState.active = false
                    await sock.sendMessage(chatId, {
                        text: `${dqText}\n💀 *Game over* — no players remain. The word was *${gameState.targetWord.toUpperCase()}*.`
                    })
                    const outcome = { type: 'no_winner' }
                    const rep = matchSummary.buildMatchReport(gameState, outcome, (n) => nameTag(n, gameState.playerNames, settings))
                    matchSummary.recordLeaderboard(games, chatId, gameState, outcome)
                    await sock.sendMessage(chatId, { text: rep.text, mentions: rep.mentions })
                    adjustNextWordLength(gameState, outcome)
                    persistGames()
                    await startCooldown(chatId, ctx)
                    return
                }

                gameState.currentTurnIndex = removedIndex % gameState.players.length
                await sendGameBoard(chatId, dqText, [], ctx)
                return
            }

            const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
            gameState.currentTurnIndex = nextTurnIndex

            const feedback = `⏰ ${currentPlayerName} timed out (${skipCount}/3 skip-strikes) 🟥`

            await sendGameBoard(chatId, feedback, [], ctx)

        } else if (gameState.turnSecondsLeft === 20) {
            await sock.sendMessage(chatId, {
                text:
                    `⏱️ *${currentPlayerName}, 20 seconds left!* Make your move — ` +
                    `guess a letter or the full word! 🤔`,
                mentions: currentPlayerJid ? [currentPlayerJid] : []
            })
        } else if (gameState.turnSecondsLeft === 10) {
            await sock.sendMessage(chatId, {
                text: `🚨 *${currentPlayerName} — 10 seconds! GO GO GO!* ⚡`,
                mentions: currentPlayerJid ? [currentPlayerJid] : []
            })
        }

        persistGames()
    }, 1000)
}

// ─── Post-round cooldown (2 min break, 30s-remaining ping, auto-restart) ──
function startCooldown(chatId, ctx) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.cooldownActive     = true
    gameState.cooldownSecondsLeft = config.COOLDOWN_SECONDS
    activeGameChatRef.value      = chatId // keep the chat reserved through the break

    if (gameState.cooldownTimer) clearInterval(gameState.cooldownTimer)

    sock.sendMessage(chatId, {
        text:
            `${config.BOT_EMOJI} 🏁 *Round over!* Take a *${Math.round(config.COOLDOWN_SECONDS / 60)}-minute break* to chat before the next round. 💬\n` +
            `_A fresh lobby opens automatically when time's up — no need to type anything._`
    })
    persistGames()

    let warned = false
    gameState.cooldownTimer = setInterval(async () => {
        if (!gameState.cooldownActive) {
            clearInterval(gameState.cooldownTimer)
            return
        }
        gameState.cooldownSecondsLeft--

        if (!warned && gameState.cooldownSecondsLeft <= config.COOLDOWN_WARNING_AT) {
            warned = true
            await sock.sendMessage(chatId, {
                text:
                    `⏳ *Next round in ${config.COOLDOWN_WARNING_AT} seconds!*\n\n` +
                    `📏 Word length this time: *~${gameState.wordLengthTarget} letters*\n` +
                    `_Get ready — the lobby reopens automatically!_ 🎮`
            })
        }

        if (gameState.cooldownSecondsLeft <= 0) {
            clearInterval(gameState.cooldownTimer)
            gameState.cooldownActive = false
            persistGames()
            await openFreshLobby(chatId, ctx)
            return
        }
        persistGames()
    }, 1000)
}

// ─── Force-stop — optional contract addition (ARCHITECTURE.md §10) ──
// Called ONLY by game-switch-commands.js, ONLY when the creator runs
// "/game setgame ..." while Hangman has a live session in this chat.
// Clears every timer type Hangman uses (lobby/turn/cooldown) and
// resets state to idle. Never sends a chat message itself — the
// caller (game-switch-commands.js) reports what was stopped, once,
// in its own confirmation message, so the player never sees two
// separate "stopped"/"switched" messages for one action.
// Returns true if something was actually running (worth reporting),
// false if there was nothing to clean up.
// ─── Pause / resume — via shared kernel (gameKernel.js) ─────────
// Previously this lived inline inside adminCommands.js (direct
// gs.paused mutation) — the same admin-reaches-into-engine-state
// layering bug WordClimb had for its lobby-open path. Moved here so
// the engine owns its own state transitions and admin files stay a
// thin glue layer, consistent with the rest of this file.
function pauseSession(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    return kernel.pauseTimer(gameState, gameState.turnTimer, clearInterval)
}

function resumeSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const resumed = kernel.resumeTimer(gameState, () => startTurnCountdown(chatId, ctx))
    if (resumed && typeof persistGames === 'function') persistGames()
    return resumed
}

function forceStopActiveSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    const wasRunning = !!(gameState.active || gameState.lobbyActive || gameState.cooldownActive)

    if (gameState.lobbyTimer)    clearInterval(gameState.lobbyTimer)
    if (gameState.turnTimer)     clearInterval(gameState.turnTimer)
    if (gameState.cooldownTimer) clearInterval(gameState.cooldownTimer)

    gameState.lobbyTimer     = null
    gameState.turnTimer      = null
    gameState.cooldownTimer  = null
    gameState.active         = false
    gameState.lobbyActive    = false
    gameState.cooldownActive = false
    gameState.paused         = false

    if (typeof persistGames === 'function') persistGames()
    return wasRunning
}

module.exports = {
    config,
    DEFAULT_WORDS,
    getGameState,
    startLobbyCountdown,
    openFreshLobby,
    startActualGame,
    sendGameBoard,
    startTurnCountdown,
    startCooldown,
    calcMaxTries,
    resolveRoundMaxTries,
    pickWordForLength,
    adjustNextWordLength,
    buildStickFigureCard,
    buildStickFigureIntro,
    pauseSession,
    resumeSession,
    forceStopActiveSession
}
