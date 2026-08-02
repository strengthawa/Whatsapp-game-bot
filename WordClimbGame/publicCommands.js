// ============================================================
//  WordClimbGame/publicCommands.js — Word Climb · Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !wcl            — explainer card (never stateful — see
//                       ARCHITECTURE.md §9, bare-acronym rule)
//    !wcl start      — open a lobby
//    !wcl join       — join the open lobby
//    !wcl help       — how-to-play card
//    live word guesses while a round is active (no prefix needed,
//    same convention as HangmanGame's letter/word guesses)
//
//  Force-starting an open lobby early ("begin") is admin-only —
//  see "/wcl begin" in adminCommands.js, not a public command here.
//
//  Admin "/" commands live in adminCommands.js. Turn-timer +
//  scoring mechanics live in gameEngine.js — this file is the
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

// Was a module-level constant — meant kernel.botIdentityLine() only ever
// ran once, at process startup, and every "!wcl" reply afterward showed
// that same frozen line forever. Now a function, built fresh per request,
// so the identity line (and its real elapsed-time reading) is honest
// every time, not just on the first call after boot.
function buildHelpText(receivedAt) {
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM}) Bot*\n` +
        `🤖 ${kernel.botIdentityLine(receivedAt)}\n` +
        `${config.DIVIDER}\n` +
        `A live elimination word game — the required word length climbs a rung ` +
        `every lap, from *${config.MIN_LENGTH} letters* all the way to *${config.MAX_LENGTH}*.\n\n` +
        `*🎮 How to Play:*\n` +
        `1️⃣ Type *${config.PREFIX} start* to open a lobby\n` +
        `2️⃣ Type *${config.PREFIX} join* to enter it\n` +
        `3️⃣ On your turn, the bot gives you a starting *letter* + required *length* — reply with a real word matching both\n` +
        `4️⃣ You have *${config.TURN_SECONDS} seconds*. Timeout, wrong word, or a repeat = a strike\n` +
        `5️⃣ *${config.MAX_STRIKES} strikes* and you're eliminated 🚫\n` +
        `6️⃣ Last climber standing wins — or if everyone survives to the top, the *longest word reached* wins 🏆\n` +
        `📖 Type *${config.PREFIX} help* any time to see this again.\n\n` +
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

    // ── Bare "!wcl" = explainer only, NEVER stateful (§9) ────
    if (body === config.PREFIX) {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt) })
        return true
    }

    if (!body.startsWith(config.PREFIX)) {
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
        await sock.sendMessage(from, { text: buildHelpText(receivedAt) })
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
                `✅ *${nameTag(senderNumber, nameCache, settings)} joined the climb!* 🧗\n\n` +
                `👥 *Lobby:*\n${lobbyText}\n\n` +
                `_Type *${config.PREFIX} join* to hop in!_\n` +
                `_Type *${config.PREFIX} help* for commands._`,
            mentions: lobbyMentions
        })
        persistGames()
        return true
    }

    // "begin" (force-start the open lobby early) moved to the admin-only
    // "/wcl begin" — see adminCommands.js. It used to be self-service for
    // any joined player once 2+ had joined; that's now an admin call, and
    // the floor is config.MIN_PLAYERS_TO_BEGIN (currently 1) instead of a
    // hardcoded 2.

    // Unrecognised !wcl subcommand — now explicit (was silent here and
    // in HangmanGame; both fixed together, matching RoastGame's public
    // side and every admin handler, which already reply).
    await sock.sendMessage(from, {
        text:
            `❓ *Unknown command:* "${subCmd}"\n` +
            `Type *${config.PREFIX} help* to see everything I can do.`
    })
    return true
}

module.exports = { handlePublicMessage }
