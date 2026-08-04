// ============================================================
//  WordChainGame/publicCommands.js — Word Chain · Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !wch            — explainer card (never stateful — see
//                       ARCHITECTURE.md §9, bare-acronym rule)
//    !wch start      — open a lobby
//    !wch join       — join the open lobby
//    !wch help       — how-to-play card
//    !wch leaderboard / lb — this chat's standings
//    live word guesses while a round is active (no prefix needed,
//    same convention as HangmanGame/WordClimbGame) — including
//    STEAL attempts from anyone else during a steal window, which
//    are also unprefixed live messages, just from someone other
//    than gameState.currentPlayer.
//
//  Force-starting an open lobby early ("begin") is admin-only — see
//  adminCommands.js. There is no manual category command anymore —
//  the category ("sector") rotates automatically, see gameEngine.js.
//
//  Admin "/" commands live in adminCommands.js. Turn-timer +
//  chain mechanics live in gameEngine.js — this file is the
//  glue between an inbound WhatsApp message and that engine.
// ============================================================

const { nameTag, resolveSetting } = require('../permissions')
const kernel = require('../gameKernel')
const config = require('./config')
const engine = require('./gameEngine')

function resolveJid(number, playerJids) {
    if (!number) return ''
    if (number.includes('@')) return number
    return (playerJids && playerJids[number]) || `${number}@s.whatsapp.net`
}

function buildHelpText(receivedAt, category) {
    const catMeta = config.CATEGORIES[category] || config.CATEGORIES[config.SECTOR_SEQUENCE[0]]
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM}) Bot*\n` +
        `🤖 ${kernel.botIdentityLine(receivedAt)}\n` +
        `${config.DIVIDER}\n` +
        `A live elimination word game — each word must start with the *last letter* ` +
        `of the word before it. Current sector: *${catMeta.emoji} ${catMeta.label}*.\n\n` +
        `*🎮 How to Play:*\n` +
        `1️⃣ Type *${config.PREFIX} start* to open a lobby\n` +
        `2️⃣ Type *${config.PREFIX} join* to enter it\n` +
        `3️⃣ The first player opens the chain with ANY valid word (${config.MIN_WORD_LENGTH}+ letters). ` +
        `Every player after that must reply with a real word starting with the *last letter* of the word before theirs — not already used this match\n` +
        `4️⃣ Reply before time's up — the timer shrinks as the chain grows (*${config.TURN_SECONDS_START}s → ${config.TURN_SECONDS_FLOOR}s*). Timeout, repeat, or an invalid word = a strike\n` +
        `5️⃣ *${config.MAX_STRIKES} strikes* and you're eliminated 🚫\n` +
        `6️⃣ Last player standing wins — or if the chain reaches *${config.CHAIN_TARGET} words*, fewest strikes then highest score wins 🏆\n` +
        `7️⃣ Score every word: base point + bonuses for a *rare letter*, a *long word*, answering *fast*, and every *${config.STREAK_MILESTONE}-streak* 🔥\n` +
        `8️⃣ The sector *auto-shifts* every ${config.SECTOR_LENGTH} words — a big announcement, no admin toggle needed\n` +
        `9️⃣ Miss a turn? The chain opens for a *${config.STEAL_WINDOW_SECONDS}s steal window* — anyone else can grab it for a bonus 🦸\n` +
        `📖 Type *${config.PREFIX} help* any time to see this again.\n` +
        `🏆 Type *${config.PREFIX} leaderboard* to see this chat's standings.\n\n` +
        `${config.DIVIDER}\n` +
        `_Sky Graphics — ${config.GAME_NAME}_`
    )
}

async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache,
        from, body, rawBody, senderNumber, senderJid, senderName, isAdmin, receivedAt
    } = msgCtx

    const ctx = { sock, games, settings, activeGameChatRef, persistGames, nameCache }
    const gameState = engine.getGameState(from, games)

    // ── Bare "!wch" = explainer only, NEVER stateful (§9) ────
    if (body === config.PREFIX) {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt, gameState.category) })
        return true
    }

    if (!body.startsWith(config.PREFIX)) {
        // ── Live STEAL attempt (anyone except the player who just
        // failed, only while a steal window is open) — checked FIRST,
        // since gameState.currentPlayer already points ahead to the
        // next-in-rotation player during the window (their turn just
        // hasn't been announced/armed yet), so this can't be inferred
        // from currentPlayer the way a normal guess is ─────────────
        if (gameState.active && gameState.steal && gameState.steal.open && senderNumber !== gameState.steal.excludeNumber) {
            const stolen = await engine.attemptSteal(from, ctx, senderNumber, rawBody.trim())
            if (stolen) return true
        }
        // ── Live guess during an active round ─────────────────
        if (gameState.active && senderNumber === gameState.currentPlayer) {
            const consumed = await engine.submitGuess(from, ctx, senderNumber, rawBody.trim())
            if (consumed) return true
        }
        return false
    }

    const parts = body.split(' ')
    const subCmd = parts[1]

    if (!subCmd || subCmd === 'help') {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt, gameState.category) })
        return true
    }

    if (subCmd === 'start') {
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
            }
            return true
        }

        await engine.openFreshLobby(from, ctx)
        return true
    }

    if (subCmd === 'join') {
        if (!gameState.lobbyActive) {
            await sock.sendMessage(from, { text: `⚠️ No active lobby to join! Type *${config.PREFIX} start* to open one. 🎮` })
            return true
        }
        if (gameState.players.includes(senderNumber)) {
            await sock.sendMessage(from, { text: `⚠️ You're already in the lobby! Sit tight. 🕐` })
            return true
        }
        engine.addToLobby(gameState, senderNumber, senderName, senderJid)
        const lobbyMentions = gameState.players.map(num => resolveJid(num, gameState.playerJids))
        const lobbyText = gameState.players
            .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
            .join('\n')
        await sock.sendMessage(from, {
            text:
                `✅ *${nameTag(senderNumber, nameCache, settings)} joined the chain!* 🔗\n\n` +
                `👥 *Lobby:*\n${lobbyText}\n\n` +
                `_Type *${config.PREFIX} join* to hop in!_\n` +
                `_Type *${config.PREFIX} help* for commands._`,
            mentions: lobbyMentions
        })
        persistGames()
        return true
    }

    if (subCmd === 'leaderboard' || subCmd === 'lb') {
        const text = kernel.renderLeaderboardText(games, config.GAME_KEY, from, {
            title: `🏆 *${config.GAME_NAME} — Leaderboard*`,
            statLabel: ' pts',
            emptyText: `No chains recorded yet in this chat — type *${config.PREFIX} start* to begin!`
        })
        await sock.sendMessage(from, { text })
        return true
    }

    // "begin" (force-start the open lobby early) is admin-only — see
    // adminCommands.js. There's no manual category/sector command.

    // Unrecognised !wch subcommand — explicit, not silent.
    await sock.sendMessage(from, {
        text:
            `❓ *Unknown command:* "${subCmd}"\n` +
            `Type *${config.PREFIX} help* to see everything I can do.`
    })
    return true
}

module.exports = { handlePublicMessage }
