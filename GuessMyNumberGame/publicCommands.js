// ============================================================
//  GuessMyNumberGame/publicCommands.js — Guess My Number · Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !gmn            — explainer card (never stateful — see
//                       ARCHITECTURE.md §9, bare-acronym rule)
//    !gmn start      — open a lobby
//    !gmn join       — join the open lobby
//    !gmn mode       — show the current mode (read-only; admin sets
//                       it via "/gmn mode")
//    !gmn chaos      — show the current chaos intensity (read-only;
//                       admin sets it via "/gmn chaos")
//    !gmn board      — live scoreboard for the round in progress
//    !gmn leaderboard / lb — cross-match standings for this chat
//    !gmn help       — how-to-play card
//    bare-number messages — free-for-all guesses while a round is
//    live, no prefix needed, ANY joined player, no turn order
//
//  Admin "/" commands live in adminCommands.js. Round mechanics +
//  scoring live in gameEngine.js — this file is the glue between an
//  inbound WhatsApp message and that engine.
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

// Built fresh per request (not a module-level constant) so
// kernel.botIdentityLine()'s elapsed-time reading is honest every
// time, not frozen from the first call after boot.
function buildHelpText(receivedAt, settings) {
    const mode = engine.modeConfigFor(settings)
    const rounds = engine.roundsForMatch(settings)
    const chaos = engine.chaosIntensityFor(settings)
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM}) Bot*\n` +
        `🤖 ${kernel.botIdentityLine(receivedAt)}\n` +
        `${config.DIVIDER}\n` +
        `A free-for-all number-guessing match — no turn order, anyone can guess ` +
        `any time. Best of *${rounds} rounds*, current mode *${mode.LABEL} (${mode.MIN}–${mode.MAX})*, ` +
        `chaos *${chaos}*.\n\n` +
        `*🎮 How to Play:*\n` +
        `1️⃣ Type *${config.PREFIX} start* to open a lobby\n` +
        `2️⃣ Type *${config.PREFIX} join* to enter it\n` +
        `3️⃣ Once a round is live, just type a *number* — no prefix — any time. ` +
        `Every guess gets ${config.HIGHER_EMOJI} Higher / ${config.LOWER_EMOJI} Lower plus a heat hint ` +
        `(🌋 Blazing → 🔥 Hot → 🌤️ Warm → 🧊 Cold)\n` +
        `4️⃣ Exact match = ${config.WINNER_EMOJI} round win! A round also ends if the guess cap or ` +
        `timer runs out — nobody scores that round\n` +
        `5️⃣ Most round wins after *${rounds} rounds* takes the match ${config.TROPHY_EMOJI}\n` +
        `🎲 *Chaos* (currently *${chaos}*) can autonomously throw in bounty rounds, a sabotage ` +
        `tax, a hidden cursed number, or even a whole-match Team Chaos split — the engine ` +
        `decides which, who, and when. Type *${config.PREFIX} chaos* to check the current setting\n` +
        `📊 Type *${config.PREFIX} board* any time to see the live round + standings\n` +
        `🏆 Type *${config.PREFIX} leaderboard* to see this chat's all-time standings\n` +
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

    // ── Bare "!gmn" = explainer only, NEVER stateful (§9) ────
    if (body === config.PREFIX) {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt, settings) })
        return true
    }

    if (!body.startsWith(config.PREFIX)) {
        // ── Live free-for-all guess during an active round ─────
        if (gameState.active) {
            const consumed = await engine.submitGuess(from, ctx, senderNumber, (rawBody || '').trim())
            if (consumed) return true
        }
        return false
    }

    const parts = body.split(' ')
    const subCmd = parts[1]

    if (!subCmd || subCmd === 'help') {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt, settings) })
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
                `✅ *${nameTag(senderNumber, nameCache, settings)} joined!* ${config.GRID_EMOJI}\n` +
                `👥 *Lobby:*\n${lobbyText}`,
            mentions: lobbyMentions
        })
        persistGames()
        return true
    }

    if (subCmd === 'board') {
        await sock.sendMessage(from, { text: engine.buildLiveBoardText(gameState, settings) })
        return true
    }

    if (subCmd === 'mode') {
        const mode = engine.modeConfigFor(settings)
        const rounds = engine.roundsForMatch(settings)
        await sock.sendMessage(from, {
            text:
                `🎮 Current mode: *${mode.LABEL} (${mode.MIN}–${mode.MAX})* · Best of *${rounds}* rounds\n` +
                `_Only an admin can change this — see \`${config.ADMIN_PREFIX}mode\`._`
        })
        return true
    }

    if (subCmd === 'chaos') {
        const chaos = engine.chaosIntensityFor(settings)
        await sock.sendMessage(from, {
            text:
                `🎲 Current chaos: *${chaos}*\n` +
                `_The engine decides which event fires, who it targets, and when — nobody, ` +
                `not even the admin, controls the specifics. Only an admin can change the ` +
                `dial itself — see \`${config.ADMIN_PREFIX}chaos\`._`
        })
        return true
    }

    if (subCmd === 'leaderboard' || subCmd === 'lb') {
        const text = kernel.renderLeaderboardText(games, config.GAME_KEY, from, {
            title: `${config.TROPHY_EMOJI} *${config.GAME_NAME} — Leaderboard*`,
            statLabel: ' points (best match)',
            emptyText: `No matches recorded yet in this chat — type *${config.PREFIX} start* to begin!`
        })
        await sock.sendMessage(from, { text })
        return true
    }

    // Unrecognised !gmn subcommand — explicit, not silent (see
    // NEW_GAME_HANDOFF.md §5 and ARCHITECTURE.md §10.3).
    await sock.sendMessage(from, {
        text:
            `❓ *Unknown command:* "${subCmd}"\n` +
            `Type *${config.PREFIX} help* to see everything I can do.`
    })
    return true
}

module.exports = { handlePublicMessage }
