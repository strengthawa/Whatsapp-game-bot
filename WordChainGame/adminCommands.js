// ============================================================
//  WordChainGame/adminCommands.js — Word Chain · Sky Graphics
//  Handles all "/wch" commands.
//
//  Access tiers:
//    CREATOR / ADMIN — full access to every command below.
//    EVERYONE ELSE   — total silence, per ARCHITECTURE.md §5.
//
//  Message convention (matches Hangman/WordClimb adminCommands.js):
//    - Every reply to the admin goes PRIVATELY to their own DM
//      (`senderJid`), via `sendSafeMessage` — never back into the
//      group the command was typed in. `replyTo = senderJid`.
//    - Any command that changes something players can see in a
//      LIVE session ALSO posts a separate, differently-worded
//      announcement into the actual game chat
//      (`activeGameChatRef.value`), via `sock.sendMessage`.
//    - Admin identity onboarding (who gets ADMIN tier in the first
//      place) is NOT handled here — see admin-onboarding.js at the
//      project root, reachable via the fixed "/admin" prefix.
// ============================================================

const { TIERS, resolveSetting, writeSetting, nameTag, hasGameAccess } = require('../permissions')
const config = require('./config')
const engine = require('./gameEngine')

async function handleAdminCommand(ctx) {
    const {
        sock, settings, games, activeGameChatRef, persistGames,
        sendSafeMessage, senderTier, sender, senderJid, body
    } = ctx

    // ── §5: mandatory tier gate, before anything else ────────
    const senderIsCreator = senderTier === TIERS.CREATOR
    const isScopedIn = senderIsCreator || hasGameAccess(config.GAME_KEY, settings)
    const isAdmin = (senderIsCreator || senderTier === TIERS.ADMIN) && isScopedIn
    if (!isAdmin) return false

    const replyTo = senderJid
    const raw = body.slice(config.ADMIN_PREFIX.length).trim()
    const parts = raw.split(' ')
    const cmd = parts[0] || ''
    const arg = parts[1]

    const liveChat = activeGameChatRef.value
    const gameCtx = { sock, games, settings, activeGameChatRef, persistGames }
    const gameState = liveChat ? engine.getGameState(liveChat, games) : null

    if (!cmd || cmd === 'help') {
        const sectorList = config.SECTOR_SEQUENCE
            .map(key => `${config.CATEGORIES[key].emoji} ${config.CATEGORIES[key].label}`)
            .join(' → ')
        await sendSafeMessage(sock, replyTo, {
            text:
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI} *${config.GAME_ACRONYM} Admin Dashboard*\n` +
                `${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_\n\n` +
                `*Game Controls:*\n` +
                `› \`${config.ADMIN_PREFIX}status\` — current session state\n` +
                `› \`${config.ADMIN_PREFIX}begin\` — force-start the open lobby early (min *${config.MIN_PLAYERS_TO_BEGIN}* player${config.MIN_PLAYERS_TO_BEGIN === 1 ? '' : 's'})\n` +
                `› \`${config.ADMIN_PREFIX}pause\` — freeze the turn timer\n` +
                `› \`${config.ADMIN_PREFIX}resume\` — unfreeze the turn timer\n` +
                `› \`${config.ADMIN_PREFIX}stop\` — end the session, post the final board\n` +
                `› \`${config.ADMIN_PREFIX}reset\` — hard reset, wipes session silently\n\n` +
                `*Settings:*\n` +
                `› \`${config.ADMIN_PREFIX}setturnseconds <5-60>\` — fixed override, replaces the auto shrink-as-the-chain-grows curve\n\n` +
                `*🎯 Sectors (automatic, not admin-toggled):*\n` +
                `${sectorList}\n` +
                `Shifts every *${config.SECTOR_LENGTH} words*, announced live in-chat.\n\n` +
                `*📊 Live Config:*\n` +
                `› Turn Timer: *${engine.turnTimerDisplay(settings)}*\n` +
                `› Current Sector: *${engine.categoryDisplay((gameState && gameState.category) || config.SECTOR_SEQUENCE[0])}*\n` +
                `› Chain Target: *${config.CHAIN_TARGET} words*\n` +
                `› Max Strikes: *${config.MAX_STRIKES}*\n` +
                `› Steal Window: *${config.STEAL_WINDOW_SECONDS}s (+${config.STEAL_BONUS} bonus)*\n\n` +
                `${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_`
        })
        return true
    }

    // ─── /wch begin — force-start the open lobby early ───────────
    if (cmd === 'begin') {
        if (!liveChat || !gameState || !gameState.lobbyActive) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No open lobby to start early right now.` })
            return true
        }
        if (gameState.players.length < config.MIN_PLAYERS_TO_BEGIN) {
            await sendSafeMessage(sock, replyTo, {
                text: `⚠️ Need at least *${config.MIN_PLAYERS_TO_BEGIN} player${config.MIN_PLAYERS_TO_BEGIN === 1 ? '' : 's'}* in the lobby to start.`
            })
            return true
        }
        if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
        await engine.closeLobbyAndStart(liveChat, gameCtx)
        await sendSafeMessage(sock, replyTo, { text: `🚀 *Lobby started early.* ✅` })
        return true
    }

    if (cmd === 'status') {
        if (!liveChat || !gameState || (!gameState.lobbyActive && !gameState.active)) {
            await sendSafeMessage(sock, replyTo, {
                text:
                    `📊 *${config.GAME_ACRONYM} Bot Status*\n\n` +
                    `🎮 No game or lobby is currently active.\n\n` +
                    `*Config:*\n` +
                    `› Turn Timer: *${engine.turnTimerDisplay(settings)}*\n` +
                    `› Current Sector: *${engine.categoryDisplay((gameState && gameState.category) || config.SECTOR_SEQUENCE[0])}*`
            })
            return true
        }

        let statusText = `📊 *${config.GAME_ACRONYM} Bot Status*\n\n`
        if (gameState.lobbyActive) {
            statusText += `🏠 *LOBBY OPEN* — ${liveChat}\n`
            statusText += `👥 Players joined: *${gameState.players.length}*\n`
            statusText += `⏱️ Time left: *${gameState.lobbySecondsLeft}s*\n`
            if (gameState.players.length > 0) {
                statusText += `\n*Players:*\n`
                gameState.players.forEach((num, i) => {
                    statusText += `${i + 1}. ${gameState.playerNames[num] || num}\n`
                })
            }
        } else if (gameState.active) {
            statusText += gameState.paused ? `⏸️ Status: *PAUSED*\n` : `▶️ Status: *LIVE*\n`
            statusText += `🔗 *CHAIN IN PROGRESS* — ${liveChat}\n`
            statusText += `📝 Words so far: *${gameState.totalWords}* (target ${config.CHAIN_TARGET})\n`
            statusText += `🎯 Sector: *${engine.categoryDisplay(gameState.category)}* (shifts in ${config.SECTOR_LENGTH - (gameState.wordsInCurrentSector || 0)} words)\n`
            statusText += `👥 Players left: *${gameState.players.length}*\n`
            statusText += `🎯 Current turn: *${gameState.playerNames[gameState.currentPlayer] || gameState.currentPlayer}*\n`
            statusText += `🔤 Last word: *${gameState.lastWord ? gameState.lastWord.toUpperCase() : '—'}*\n`
            statusText += `💢 Strikes: ${gameState.players.map(n => `${gameState.playerNames[n] || n} (${gameState.strikes[n] || 0}/${config.MAX_STRIKES}, ${gameState.score[n] || 0}pts)`).join(', ')}\n`
            if (gameState.steal && gameState.steal.open) {
                statusText += `💥 *Steal window is OPEN* — anyone but the last player can grab it!\n`
            }
        }
        statusText += `\n*Config:*\n`
        statusText += `› Turn Timer: *${engine.turnTimerDisplay(settings)}*\n`
        statusText += `› Current Sector: *${engine.categoryDisplay(gameState.category)}*`

        await sendSafeMessage(sock, replyTo, { text: statusText })
        return true
    }

    if (cmd === 'pause') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active chain to pause right now.` })
            return true
        }
        const ok = engine.pauseSession(liveChat, gameCtx)
        if (ok) {
            persistGames()
            await sendSafeMessage(sock, replyTo, { text: `⏸️ *Chain paused.* ✅` })
            await sock.sendMessage(liveChat, { text: `⏸️ *Chain paused by the admin.* Sit tight — we'll be right back! ☕` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Chain is already paused or no round is in progress.` })
        }
        return true
    }

    if (cmd === 'resume') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active chain to resume right now.` })
            return true
        }
        const ok = engine.resumeSession(liveChat, gameCtx)
        if (ok) {
            await sendSafeMessage(sock, replyTo, { text: `▶️ *Chain resumed!* ✅` })
            await sock.sendMessage(liveChat, { text: `▶️ *Chain resumed by the admin!* Fresh timer — keep it going! 🔥` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Chain is not currently paused.` })
        }
        return true
    }

    if (cmd === 'stop' || cmd === 'end') {
        if (!liveChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active *${config.GAME_NAME}* session to stop right now.` })
            return true
        }
        const wasRunning = engine.forceStopActiveSession(liveChat, gameCtx)
        activeGameChatRef.value = null

        await sendSafeMessage(sock, replyTo, {
            text: wasRunning
                ? `🛑 *Session terminated.* ✅`
                : `ℹ️ No active *${config.GAME_NAME}* session to stop.`
        })
        if (wasRunning) {
            await sock.sendMessage(liveChat, {
                text: `🛑 *${config.GAME_NAME} terminated by the admin.* Thanks for playing, everyone! 👋`
            })
        }
        return true
    }

    if (cmd === 'reset') {
        const hadSession = !!liveChat
        if (liveChat) {
            engine.forceStopActiveSession(liveChat, gameCtx)
            games[engine.stateKey(liveChat)] = engine.freshState()
            activeGameChatRef.value = null
            persistGames()
            await sock.sendMessage(liveChat, {
                text: `🔄 *${config.GAME_NAME} Reset* ✅\n\nAny active session was ended by the admin.`
            })
        }
        await sendSafeMessage(sock, replyTo, {
            text: hadSession
                ? `🔄 *Reset Complete* ✅\n\n` +
                  `*${config.GAME_NAME}* state was wiped back to defaults for its chat (sector resets to *${config.CATEGORIES[config.SECTOR_SEQUENCE[0]].label}* too). ` +
                  `The turn-timer override is untouched — use \`${config.ADMIN_PREFIX}setturnseconds\` if you want to change that too.`
                : `ℹ️ *Nothing to reset.*\n\nNo active *${config.GAME_NAME}* session was found for this chat — there was nothing to wipe.`
        })
        return true
    }

    if (cmd === 'setturnseconds') {
        const n = parseInt(arg, 10)
        if (!Number.isInteger(n) || n < 5 || n > 60) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`${config.ADMIN_PREFIX}setturnseconds <5-60>\`` })
            return true
        }
        writeSetting(senderTier, `${config.GAME_KEY}_turnSeconds`, n, settings)
        await sendSafeMessage(sock, replyTo, {
            text: `⚙️ Turn timer fixed at *${n}s* for every turn 💥 — replaces the auto shrink-as-the-chain-grows curve, takes effect on the *next* match.`
        })
        return true
    }

    // Unrecognised /wch subcommand — explicit error, not silence.
    await sendSafeMessage(sock, replyTo, {
        text: `⚠️ *Unknown command.* Try \`${config.ADMIN_PREFIX}help\`.`
    })
    return true
}

module.exports = { handleAdminCommand }
