// ============================================================
//  WordClimbGame/adminCommands.js — Word Climb · Sky Graphics
//  Handles all "/wcl" commands.
//
//  Access tiers:
//    CREATOR / ADMIN — full access to every command below.
//    EVERYONE ELSE   — total silence, per ARCHITECTURE.md §5.
//
//  Message convention (matches HangmanGame/adminCommands.js):
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
    // Scope gate: an admin stationed on a different game (via
    // /admin set/clear) gets total silence here, same as any other
    // non-permitted tier — this was previously missing entirely, which
    // meant scoping an admin to Hangman-only did nothing to restrict
    // their access to Word Climb. The creator always bypasses this.
    const isScopedIn = senderIsCreator || hasGameAccess(config.GAME_KEY, settings)
    const isAdmin = (senderIsCreator || senderTier === TIERS.ADMIN) && isScopedIn
    if (!isAdmin) return false

    const replyTo = senderJid
    const raw = body.slice(config.ADMIN_PREFIX.length).trim()
    const parts = raw.split(' ')
    const cmd = parts[0] || ''
    const arg = parts[1]

    // The chat a live (or lobby-open) Word Climb session is actually
    // running in, if any — NOT necessarily the chat this admin command
    // was typed in, since Hangman-style admin flows are DM-first.
    const liveChat = activeGameChatRef.value
    const gameCtx = { sock, games, settings, activeGameChatRef, persistGames }
    const gameState = liveChat ? engine.getGameState(liveChat, games) : null

    if (!cmd || cmd === 'help') {
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
                `› \`${config.ADMIN_PREFIX}setturnseconds <10-90>\` — fixed override, replaces the auto shrink-as-you-climb curve\n\n` +
                `*📊 Live Config:*\n` +
                `› Turn Timer: *${engine.turnTimerDisplay(settings)}*\n` +
                `› Length Range: *${config.MIN_LENGTH}–${config.MAX_LENGTH} letters*\n` +
                `› Max Strikes: *${config.MAX_STRIKES}*\n\n` +
                `${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_`
        })
        return true
    }

    // ─── /wcl begin — force-start the open lobby early ───────────
    // Moved here from publicCommands.js: this used to be self-service
    // for any joined player once 2+ had joined. Now admin-only, and the
    // floor is config.MIN_PLAYERS_TO_BEGIN (currently 1, so a solo climb
    // is allowed) instead of a hardcoded 2.
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
                    `› Turn Timer: *${engine.turnTimerDisplay(settings)}*`
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
            statusText += `🧗 *CLIMB IN PROGRESS* — ${liveChat}\n`
            statusText += `📏 Current rung: *${gameState.currentLength} letters* (of ${config.MAX_LENGTH})\n`
            statusText += `👥 Climbers left: *${gameState.players.length}*\n`
            statusText += `🎯 Current turn: *${gameState.playerNames[gameState.currentPlayer] || gameState.currentPlayer}*\n`
            statusText += `💢 Strikes so far: ${gameState.players.map(n => `${gameState.playerNames[n] || n} (${gameState.strikes[n] || 0}/${config.MAX_STRIKES})`).join(', ')}\n`
        }
        statusText += `\n*Config:*\n`
        statusText += `› Turn Timer: *${engine.turnTimerDisplay(settings)}*`

        await sendSafeMessage(sock, replyTo, { text: statusText })
        return true
    }

    if (cmd === 'pause') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active climb to pause right now.` })
            return true
        }
        const ok = engine.pauseSession(liveChat, gameCtx)
        if (ok) {
            persistGames()
            await sendSafeMessage(sock, replyTo, { text: `⏸️ *Climb paused.* ✅` })
            await sock.sendMessage(liveChat, { text: `⏸️ *Climb paused by the admin.* Sit tight — we'll be right back! ☕` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Climb is already paused or no round is in progress.` })
        }
        return true
    }

    if (cmd === 'resume') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active climb to resume right now.` })
            return true
        }
        const ok = engine.resumeSession(liveChat, gameCtx)
        if (ok) {
            await sendSafeMessage(sock, replyTo, { text: `▶️ *Climb resumed!* ✅` })
            await sock.sendMessage(liveChat, { text: `▶️ *Climb resumed by the admin!* Fresh timer — keep climbing! 🔥` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Climb is not currently paused.` })
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
                text: `🛑 *${config.GAME_NAME} terminated by the admin.* Thanks for climbing, everyone! 👋`
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
        // Honest reply: "Reset Complete" used to be shown even when there
        // was nothing live to wipe, which reads as if something happened
        // when it didn't. Now says so plainly either way.
        await sendSafeMessage(sock, replyTo, {
            text: hadSession
                ? `🔄 *Reset Complete* ✅\n\n` +
                  `*${config.GAME_NAME}* state was wiped back to defaults for its chat. The turn-timer setting is untouched — ` +
                  `use \`${config.ADMIN_PREFIX}setturnseconds\` if you want to change that too.`
                : `ℹ️ *Nothing to reset.*\n\nNo active *${config.GAME_NAME}* session was found for this chat — there was nothing to wipe.`
        })
        return true
    }

    if (cmd === 'setturnseconds') {
        const n = parseInt(arg, 10)
        if (!Number.isInteger(n) || n < 10 || n > 90) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`${config.ADMIN_PREFIX}setturnseconds <10-90>\`` })
            return true
        }
        writeSetting(senderTier, `${config.GAME_KEY}_turnSeconds`, n, settings)
        await sendSafeMessage(sock, replyTo, {
            text: `⚙️ Turn timer fixed at *${n}s* for every length 💥 — replaces the auto shrink-as-you-climb curve, takes effect on the *next* match.`
        })
        return true
    }

    // Unrecognised /wcl subcommand — explicit error, not silence.
    // Standardized across all games (was silent here and in Hangman,
    // explicit in RoastGame — now explicit everywhere).
    await sendSafeMessage(sock, replyTo, {
        text: `⚠️ *Unknown command.* Try \`${config.ADMIN_PREFIX}help\`.`
    })
    return true
}

module.exports = { handleAdminCommand }
