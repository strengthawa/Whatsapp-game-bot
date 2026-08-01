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

// ─── Stick figure ASCII art — 10 atomic damage stages ───────────
// Locked-in design: legs first, each limb gets a "hit" sub-stage
// before it's fully "gone", so there are 10 distinct art states —
// matching config's max possible maxTries (10). Because there are
// never fewer stages than possible wrong guesses, no two wrong
// guesses in a row can ever render the identical picture.
//
// Order: Right Leg hit→gone → Left Leg hit→gone → Right Arm hit→gone
//        → Left Arm hit→gone → Torso gone → Head gone (disqualified)
//
// Each part has 3 states: whole ('/', '\', '|', 'O') → hit ('x') → gone (' ').
const STICK_STAGES = [
    // stage 0 = full figure (used only for reference / round start, never sent as a "loss" frame)
    { rleg: 'w', lleg: 'w', rarm: 'w', larm: 'w', torso: 'w', head: 'w', part: null,        state: null   },
    { rleg: 'x', lleg: 'w', rarm: 'w', larm: 'w', torso: 'w', head: 'w', part: 'Right Leg', state: 'hit'  },
    { rleg: 'g', lleg: 'w', rarm: 'w', larm: 'w', torso: 'w', head: 'w', part: 'Right Leg', state: 'gone' },
    { rleg: 'g', lleg: 'x', rarm: 'w', larm: 'w', torso: 'w', head: 'w', part: 'Left Leg',  state: 'hit'  },
    { rleg: 'g', lleg: 'g', rarm: 'w', larm: 'w', torso: 'w', head: 'w', part: 'Left Leg',  state: 'gone' },
    { rleg: 'g', lleg: 'g', rarm: 'x', larm: 'w', torso: 'w', head: 'w', part: 'Right Arm', state: 'hit'  },
    { rleg: 'g', lleg: 'g', rarm: 'g', larm: 'w', torso: 'w', head: 'w', part: 'Right Arm', state: 'gone' },
    { rleg: 'g', lleg: 'g', rarm: 'g', larm: 'x', torso: 'w', head: 'w', part: 'Left Arm',  state: 'hit'  },
    { rleg: 'g', lleg: 'g', rarm: 'g', larm: 'g', torso: 'w', head: 'w', part: 'Left Arm',  state: 'gone' },
    { rleg: 'g', lleg: 'g', rarm: 'g', larm: 'g', torso: 'g', head: 'w', part: 'Torso',     state: 'gone' },
    { rleg: 'g', lleg: 'g', rarm: 'g', larm: 'g', torso: 'g', head: 'g', part: 'Head',      state: 'gone' }
]

const PART_EMOJI = {
    'Right Leg': '🦵', 'Left Leg': '🦵', 'Right Arm': '💪', 'Left Arm': '💪',
    'Torso': '🫥', 'Head': '💀'
}

function renderChar(code, whole, hit) {
    if (code === 'w') return whole
    if (code === 'x') return hit
    return ' ' // gone
}

function buildStickFigureArt(stage) {
    const s     = STICK_STAGES[Math.max(0, Math.min(10, stage))]
    const head  = renderChar(s.head,  'O', 'x')
    const larm  = renderChar(s.larm,  '/', 'x')
    const torso = renderChar(s.torso, '|', 'x')
    const rarm  = renderChar(s.rarm,  '\\', 'x')
    const lleg  = renderChar(s.lleg,  '/', 'x')
    const rleg  = renderChar(s.rleg,  '\\', 'x')
    return (
        ` ______\n` +
        ` |    |\n` +
        ` |    ${head}\n` +
        ` |   ${larm}${torso}${rarm}\n` +
        ` |   ${lleg} ${rleg}\n` +
        `_|__`
    )
}

// Maps wrongCount/maxTries onto one of the 10 stages. Math.round keeps
// the sequence strictly increasing (and always distinct) for every
// maxTries from 5–10, and the final wrong guess always lands exactly
// on stage 10 (head gone / disqualified).
function resolveStickStage(wrongCount, maxTries) {
    const raw = Math.round((wrongCount / Math.max(1, maxTries)) * 10)
    return Math.max(1, Math.min(10, raw))
}

// Group-chat card: tagged with the player's name + strike count, sent
// the moment THIS player misses — dynamic and per-player, replacing
// the old private-DM-only behaviour.
function buildStickFigureCard(playerTag, wrongCount, maxTries) {
    const stage     = resolveStickStage(wrongCount, maxTries)
    const s         = STICK_STAGES[stage]
    const art       = buildStickFigureArt(stage)
    const emoji     = PART_EMOJI[s.part] || '💥'
    const captionOp = s.state === 'gone'
        ? `gone!${s.part === 'Head' ? ' Disqualified 💀' : ''}`
        : 'hit!'
    const remaining = Math.max(0, maxTries - wrongCount)

    return (
        `💀 *${playerTag} — Strike ${wrongCount}/${maxTries}!*\n\n` +
        '```' + art + '```\n' +
        `${emoji} *Lost: ${s.part} — ${captionOp}*\n` +
        (stage >= 10
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

    const lobbyMentions = gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
    const lobbyText = gameState.players
        .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
        .join('\n')

    await sock.sendMessage(chatId, {
        text:
            `${config.DIVIDER}\n` +
            `${config.BOT_EMOJI} *Lobby Closed — Game On!*\n` +
            `${config.DIVIDER}\n\n` +
            `📏 *Word length:* ${gameState.targetWord.length} letters\n` +
            `💥 *Attempts per player:* ${gameState.roundMaxTries}\n\n` +
            `👥 *Final Player Lineup:*\n${lobbyText}\n\n` +
            `🏆 May the best guesser win!`,
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

    let boardText = ''
    if (actionFeedback) boardText += `${actionFeedback}\n\n`

    boardText += `🎮 *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n`
    boardText += `📝 Word: \`${gameState.hiddenWord.join(' ')}\` *(${gameState.targetWord.length} letters)*\n`
    boardText += `💥 *${currentPlayerName}'s attempts left: ${attemptsLeft}/${roundMaxTries}*\n\n`
    boardText += `🎯 *Your turn:* ${currentPlayerName}\n`

    if (hasMultiplePlayers) {
        boardText += `⏭️ *Up next:* ${nextPlayerName}\n\n`
    } else {
        boardText += `🕹️ Playing solo — no pressure... just all of it 😄\n\n`
    }
    boardText += `_⏱️ You have ${config.TURN_SECONDS} seconds — guess a letter or the full word!_`

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

                const dqText =
                    `🚫 *Disqualified!*\n` +
                    `*${currentPlayerName}* skipped *3 turns in a row* and has been removed. 👋`

                const lastStanding = matchSummary.checkLastPlayerStanding(gameState)
                if (lastStanding) {
                    gameState.active = false
                    await sock.sendMessage(chatId, {
                        text:
                            `${dqText}\n\n` +
                            `🏆 *LAST PLAYER STANDING!*\n` +
                            `The word was *${gameState.targetWord.toUpperCase()}*. 🎉`
                    })
                    const outcome = { type: 'last_standing', winnerNumber: lastStanding }
                    await matchSummary.sendMatchReport(sock, chatId, gameState, outcome, (n) => nameTag(n, gameState.playerNames, settings))
                    adjustNextWordLength(gameState, outcome)
                    gameState.players = []
                    persistGames()
                    await startCooldown(chatId, ctx)
                    return
                }

                if (gameState.players.length === 0) {
                    gameState.active = false
                    await sock.sendMessage(chatId, {
                        text: `${dqText}\n\n💀 *GAME OVER!* No players remain. The word was *${gameState.targetWord.toUpperCase()}*.`
                    })
                    const outcome = { type: 'no_winner' }
                    await matchSummary.sendMatchReport(sock, chatId, gameState, outcome, (n) => nameTag(n, gameState.playerNames, settings))
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

            const feedback =
                `⏰ *Timeout!*\n` +
                `*${currentPlayerName}* took too long. ` +
                `(${skipCount}/3 strikes before lockout 🟥)`

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
    pauseSession,
    resumeSession,
    forceStopActiveSession
}
