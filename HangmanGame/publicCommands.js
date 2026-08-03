// ============================================================
//  HangmanGame/publicCommands.js — Hangman · Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !hmg            — ping + intro
//    !hmg start      — open a lobby
//    !hmg join       — join the open lobby
//    !hmg help       — how-to-play card
//    live letter/word guesses while a round is active
//
//  Admin "/" commands live in adminCommands.js. Pure game-state
//  mechanics (timers, boards, word picking) live in gameEngine.js.
//  This file is the glue between an inbound WhatsApp message and
//  those two.
// ============================================================

const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')
const kernel = require('../gameKernel')
const config = require('./config')
const engine = require('./gameEngine')

function jidOf(number) {
    if (!number) return ''
    return number.includes('@') ? number : `${number}@s.whatsapp.net`
}

function resolveJid(number, playerJids) {
    if (!number) return ''
    if (number.includes('@')) return number
    return (playerJids && playerJids[number]) || `${number}@s.whatsapp.net`
}

/**
 * @param {object} msgCtx — everything index.js already knows about this message:
 *   { sock, games, settings, words, activeGameChatRef, persistGames, nameCache,
 *     sendSafeMessage, buildCtx, from, body, rawBody, senderNumber, senderJid,
 *     senderName, isAdmin }
 * @returns {boolean} true if this message was handled by the Hangman game.
 */
async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache,
        sendSafeMessage, buildCtx, from, body, rawBody, senderNumber, senderJid,
        senderName, isAdmin, receivedAt
    } = msgCtx

    const ctx = buildCtx()

    // ── !hmg (alone) = single-message identity + intro card ──
    // Previously 4 separate messages (Ping/Pong/latency/card) — a
    // debug artifact left wired into the highest-traffic command.
    // Collapsed to one message: the identity/liveness signal is now
    // the card's own first line, not 3 messages ahead of it.
    if (body === config.PREFIX) {
        // Real elapsed time from message receipt (index.js) to this line
        // being built — a genuine measured latency, not a fabricated one.
        await sock.sendMessage(from, {
            text:
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM}) Bot*\n` +
                `🤖 ${kernel.botIdentityLine(receivedAt)}\n` +
                `${config.DIVIDER}\n` +
                `Hey there! 👋 I'm the *${config.GAME_ACRONYM} Bot* — a live multiplayer word-guessing game built for WhatsApp groups.\n` +
                `Players take turns guessing letters to reveal a hidden word. Miss 3 turns in a row and you're out! The last one standing wins. 🏆\n` +
                `📏 *No fixed difficulty levels* — the word length quietly adapts round to round based on how the group is doing.\n` +
                `${config.DIVIDER}\n` +
                `*🎮 How to Play:*\n` +
                `1️⃣ Type *${config.PREFIX} start* to open a lobby\n` +
                `2️⃣ Type *${config.PREFIX} join* to enter it\n` +
                `3️⃣ Guess a letter, or the full word for an instant win ⚡\n` +
                `4️⃣ Miss 3 turns in a row and you're disqualified 🚫\n` +
                `📖 Type *${config.PREFIX} help* any time to see this again.`
        })
        return true
    }

    // ── !hmg start = open lobby ──────────────────────────────
    if (rawBody.toLowerCase() === `${config.PREFIX} start`) {
        const effectivePublicCanStart = resolveSetting('publicCanStart', settings, false)
        if (!isAdmin && !effectivePublicCanStart) {
            await sock.sendMessage(from, {
                text: `🔒 *Game Locked*\nThe admin hasn't enabled public game starts. Only the admin can open a lobby right now.`
            })
            return true
        }

        if (activeGameChatRef.value) {
            if (activeGameChatRef.value === from) {
                await sock.sendMessage(from, { text: `⚠️ A game or lobby is *already active in this chat!* ⏳` })
            } else {
                await sock.sendMessage(from, {
                    text: `⚠️ A game is currently running in another chat. It must end before a new one can start.`
                })
                const adminTarget = settings.adminJid || settings.adminNumber
                if (adminTarget) {
                    try {
                        await sendSafeMessage(sock, adminTarget, {
                            text:
                                `⚠️ *Duplicate Game Attempt*\n\n` +
                                `Someone tried to start a game in *${from}* while a game is already active in *${activeGameChatRef.value}*.\n\n` +
                                `Use */hmg end* to stop the current game if needed. 🎮`
                        })
                    } catch (_) {}
                }
            }
            return true
        }

        await engine.openFreshLobby(from, ctx)
        return true
    }

    // ── !hmg join / !hmg help ────────────────────────────────
    if (body.startsWith(config.PREFIX)) {
        const parts  = body.split(' ')
        const subCmd = parts[1]
        const gameState = engine.getGameState(from, games)

        if (subCmd === 'join') {
            if (!gameState.lobbyActive) {
                await sock.sendMessage(from, { text: `⚠️ No active lobby to join! Type *${config.PREFIX} start* to open one. 🎮` })
                return true
            }
            if (!gameState.players.includes(senderNumber)) {
                gameState.players.push(senderNumber)
                gameState.playerNames[senderNumber] = senderName
                gameState.playerJids[senderNumber]  = senderJid

                const lobbyMentions = gameState.players.map(num => resolveJid(num, gameState.playerJids))
                const lobbyText = gameState.players
                    .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
                    .join('\n')

                await sock.sendMessage(from, {
                    text:
                        `✅ *${nameTag(senderNumber, nameCache, settings)} joined the lobby!* 🎉\n\n` +
                        `👥 *Current Lobby:*\n${lobbyText}\n\n` +
                        `_Type *${config.PREFIX} join* to hop in!_ ⏱️\n` +
                        `_Type *${config.PREFIX} help* for commands._`,
                    mentions: [...new Set([resolveJid(senderNumber, gameState.playerJids), ...lobbyMentions])]
                })
                persistGames()
            } else {
                await sock.sendMessage(from, { text: `⚠️ You're already in the lobby! Sit tight — the game is starting soon. 🕐` })
            }
            return true
        }

        if (subCmd === 'start') {
            if (!gameState.lobbyActive) {
                await sock.sendMessage(from, { text: `⚠️ No active lobby! Type *${config.PREFIX} start* to open one. 🎮` })
                return true
            }
            if (gameState.players.includes(senderNumber) || isAdmin) {
                await engine.startActualGame(from, ctx)
            }
            return true
        }

        if (subCmd === 'leaderboard' || subCmd === 'lb') {
            const text = kernel.renderLeaderboardText(games, config.GAME_KEY, from, {
                title: `🏆 *${config.GAME_NAME} — Leaderboard*`,
                statLabel: ' wrong guesses',
                emptyText: `No rounds recorded yet in this chat — type *${config.PREFIX} start* to begin!`
            })
            await sock.sendMessage(from, { text })
            return true
        }

        if (!subCmd || subCmd === 'help') {
            await sock.sendMessage(from, {
                text:
                    `🎮 *Welcome to ${config.GAME_NAME} (${config.GAME_ACRONYM})!*\n\n` +
                    `*How to play:*\n` +
                    `1️⃣ Type *${config.PREFIX} start* to open a game lobby\n` +
                    `2️⃣ Type *${config.PREFIX} join* to enter the lobby\n` +
                    `3️⃣ Once the timer hits zero, the game begins automatically!\n` +
                    `4️⃣ On your turn, type a *single letter* to guess it, or the *full word* to win instantly ⚡\n` +
                    `5️⃣ Miss *3 turns in a row* and you're disqualified 🚫\n` +
                    `6️⃣ Last player standing wins! 🏆\n` +
                    `📏 Word length adapts automatically each round — no fixed difficulty setting.\n` +
                    `🏆 Type *${config.PREFIX} leaderboard* to see this chat's standings.\n\n` +
                    `_Sky Graphics — ${config.GAME_NAME}_`
            })
            return true
        }

        // Unrecognised !hmg subcommand — now explicit, matching the
        // admin-side handlers (was silent here only; RoastGame's
        // public side and every admin handler already reply).
        await sock.sendMessage(from, {
            text:
                `❓ *Unknown command:* "${subCmd}"\n` +
                `Type *${config.PREFIX} help* to see everything I can do.`
        })
        return true
    }

    // ── Active game play (letter / word guesses) ─────────────
    const gameState = engine.getGameState(from, games)
    if (!gameState.active || gameState.paused) return false

    const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
    const isPlayerTurn        = senderNumber === currentPlayerNumber
    const isAdminBypass       = isAdmin && !gameState.players.includes(senderNumber)

    if (!isPlayerTurn && !isAdminBypass) return false
    if (body.length !== 1 && body !== gameState.targetWord) return false

    gameState.skipStreaks[currentPlayerNumber] = 0

    // ── Full word guess = instant win ─────────────────────
    if (body === gameState.targetWord && body.length !== 1) {
        if (gameState.turnTimer) clearInterval(gameState.turnTimer)
        gameState.active = false
        await sock.sendMessage(from, {
            text: `⚡ *INSTANT WIN!* ${nameTag(senderNumber, nameCache, settings)} guessed the full word *${gameState.targetWord.toUpperCase()}*! Incredible! 🎉🏆`
        })
        const outcome = { type: 'winner_instant', winnerNumber: senderNumber }
        const report = matchSummary.buildMatchReport(gameState, outcome, (n) => nameTag(n, nameCache, settings))
        matchSummary.recordLeaderboard(games, from, gameState, outcome)
        await sock.sendMessage(from, { text: report.text, mentions: report.mentions })
        engine.adjustNextWordLength(gameState, outcome)
        gameState.players = []
        persistGames()
        await engine.startCooldown(from, ctx)
        return true
    }

    if (body.length !== 1) return false // shouldn't reach here, safety net

    // ── Single-letter guess ────────────────────────────────
    let foundIndex = -1
    for (let i = 0; i < gameState.targetWord.length; i++) {
        if (gameState.targetWord[i] === body && gameState.hiddenWord[i] === '_') {
            foundIndex = i
            break
        }
    }

    if (gameState.turnTimer) clearInterval(gameState.turnTimer)

    if (foundIndex !== -1) {
        gameState.hiddenWord[foundIndex] = body

        if (!gameState.hiddenWord.includes('_')) {
            gameState.active = false
            await sock.sendMessage(from, {
                text: `🎉 *VICTORY!* The word was *${gameState.targetWord.toUpperCase()}*! Well done! 🏆`
            })
            const outcome = { type: 'winner_letter', winnerNumber: senderNumber }
            const report = matchSummary.buildMatchReport(gameState, outcome, (n) => nameTag(n, nameCache, settings))
            matchSummary.recordLeaderboard(games, from, gameState, outcome)
            await sock.sendMessage(from, { text: report.text, mentions: report.mentions })
            engine.adjustNextWordLength(gameState, outcome)
            gameState.players = []
            persistGames()
            await engine.startCooldown(from, ctx)
        } else {
            const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
            gameState.currentTurnIndex = nextTurnIndex
            const feedback = `✅ ${nameTag(senderNumber, nameCache, settings)} guessed "${body.toUpperCase()}" — correct! 🟢`
            await engine.sendGameBoard(from, feedback, [resolveJid(senderNumber, gameState.playerJids)], ctx)
        }
        return true
    }

    // ── Wrong guess ─────────────────────────────────────────
    gameState.attempts[currentPlayerNumber] = (gameState.attempts[currentPlayerNumber] || 0) + 1
    const roundMaxTries = gameState.roundMaxTries || settings.maxTries
    const wrongCount = gameState.attempts[currentPlayerNumber]

    // Per-player stick figure card, fired the moment THIS player misses.
    // Posted in the GROUP (not a private DM) tagged with their name and
    // strike count, so everyone sees it live and dynamically per player.
    try {
        const playerTag = nameTag(senderNumber, nameCache, settings)
        const playerJid = resolveJid(senderNumber, gameState.playerJids)
        await sock.sendMessage(from, {
            text: engine.buildStickFigureCard(playerTag, wrongCount, roundMaxTries),
            mentions: playerJid ? [playerJid] : []
        })
    } catch (_) {}

    const feedback = `❌ ${nameTag(senderNumber, nameCache, settings)} guessed "${body.toUpperCase()}" — not in the word (${wrongCount}/${roundMaxTries}) 🔴`

    if (wrongCount >= roundMaxTries) {
        matchSummary.recordDisqualification(gameState, currentPlayerNumber, matchSummary.DQ_REASONS.ATTEMPTS_EXHAUSTED)
        const removedIndex = gameState.currentTurnIndex

        const dqFeedback =
            `${feedback}\n` +
            `🚫 ${nameTag(currentPlayerNumber, nameCache, settings)} used all ${roundMaxTries} guesses — *disqualified* 💀`

        const lastStanding = matchSummary.checkLastPlayerStanding(gameState)
        if (lastStanding) {
            gameState.active = false
            await sock.sendMessage(from, {
                text: `${dqFeedback}\n🏆 *Last player standing!* The word was *${gameState.targetWord.toUpperCase()}*. 🎉`
            })
            const outcome = { type: 'last_standing', winnerNumber: lastStanding }
            const report = matchSummary.buildMatchReport(gameState, outcome, (n) => nameTag(n, nameCache, settings))
            matchSummary.recordLeaderboard(games, from, gameState, outcome)
            await sock.sendMessage(from, { text: report.text, mentions: report.mentions })
            engine.adjustNextWordLength(gameState, outcome)
            gameState.players = []
            persistGames()
            await engine.startCooldown(from, ctx)
        } else if (gameState.players.length === 0) {
            gameState.active = false
            await sock.sendMessage(from, {
                text: `${dqFeedback}\n💀 *Game over* — no players remain. The word was *${gameState.targetWord.toUpperCase()}*.`
            })
            const outcome = { type: 'no_winner' }
            const report = matchSummary.buildMatchReport(gameState, outcome, (n) => nameTag(n, nameCache, settings))
            matchSummary.recordLeaderboard(games, from, gameState, outcome)
            await sock.sendMessage(from, { text: report.text, mentions: report.mentions })
            engine.adjustNextWordLength(gameState, outcome)
            persistGames()
            await engine.startCooldown(from, ctx)
        } else {
            gameState.currentTurnIndex = removedIndex % gameState.players.length
            await engine.sendGameBoard(from, dqFeedback, [], ctx)
        }
    } else {
        const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
        gameState.currentTurnIndex = nextTurnIndex
        await engine.sendGameBoard(from, feedback, [], ctx)
    }

    return true
}

module.exports = { handlePublicMessage }
