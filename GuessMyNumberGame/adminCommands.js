// ============================================================
//  GuessMyNumberGame/adminCommands.js — Guess My Number · Sky Graphics
//  Handles all "/gmn" commands.
//
//  Access tiers:
//    CREATOR / ADMIN — full access to every command below.
//    EVERYONE ELSE   — total silence, per ARCHITECTURE.md §5.
//
//  Message convention (matches WordClimbGame/adminCommands.js):
//    - Every reply to the admin goes PRIVATELY to their own DM
//      (`senderJid`), via `sendSafeMessage` — never back into the
//      group the command was typed in. `replyTo = senderJid`.
//    - Any command that changes something players can see in a
//      LIVE session ALSO posts a separate, differently-worded
//      announcement into the actual game chat
//      (`activeGameChatRef.value`), via `sock.sendMessage`.
//    - Admin identity onboarding lives in admin-onboarding.js at the
//      project root, reachable via the fixed "/admin" prefix — not
//      handled here.
// ============================================================

const { TIERS, resolveSetting, writeSetting, hasGameAccess } = require('../permissions')
const config = require('./config')
const engine = require('./gameEngine')

async function handleAdminCommand(ctx) {
    const {
        sock, settings, games, activeGameChatRef, persistGames,
        sendSafeMessage, senderTier, senderJid, body
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
        await sendSafeMessage(sock, replyTo, {
            text:
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI} *${config.GAME_ACRONYM} Admin Dashboard*\n` +
                `${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_\n\n` +
                `*Game Controls:*\n` +
                `› \`${config.ADMIN_PREFIX}status\` — current session state\n` +
                `› \`${config.ADMIN_PREFIX}begin\` — force-start the open lobby early (min *${config.MIN_PLAYERS_TO_BEGIN}* player${config.MIN_PLAYERS_TO_BEGIN === 1 ? '' : 's'})\n` +
                `› \`${config.ADMIN_PREFIX}pause\` — freeze the round timer\n` +
                `› \`${config.ADMIN_PREFIX}resume\` — unfreeze the round timer\n` +
                `› \`${config.ADMIN_PREFIX}skip\` — end the current round unsolved, reveal the number, move to the next round\n` +
                `› \`${config.ADMIN_PREFIX}stop\` — end the session, post the final board\n` +
                `› \`${config.ADMIN_PREFIX}reset\` — hard reset, wipes session silently\n\n` +
                `*Settings (apply to the NEXT match):*\n` +
                `› \`${config.ADMIN_PREFIX}mode <classic|speedrun|megagrid>\` — switch difficulty mode\n` +
                `› \`${config.ADMIN_PREFIX}setrounds <1-15>\` — rounds per match\n` +
                `› \`${config.ADMIN_PREFIX}chaos <off|light|full>\` — chaos dial (see below)\n\n` +
                `*📊 Live Config:*\n` +
                `› Mode: *${engine.modeDisplay(settings)}*\n` +
                `› Rounds per match: *${engine.roundsForMatch(settings)}*\n` +
                `› Chaos: *${engine.chaosIntensityFor(settings)}*\n` +
                `› Range/guess-cap/timer all scale up with lobby size (see README)\n\n` +
                `_Chaos is autonomous, not a checklist — the engine itself rolls WHICH ` +
                `event fires, WHO it targets, and WHEN. "light" is flavor only (taunts, ` +
                `a final-stretch lockout, end-of-match titles) and never changes who wins. ` +
                `"full" adds bounty rounds, a sabotage tax, a hidden cursed number, and a ` +
                `rare whole-match Team Chaos split for bigger lobbies. See README for detail._\n\n` +
                `${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_`
        })
        return true
    }

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
                    `› Mode: *${engine.modeDisplay(settings)}*\n` +
                    `› Rounds per match: *${engine.roundsForMatch(settings)}*\n` +
                    `› Chaos: *${engine.chaosIntensityFor(settings)}*`
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
            statusText += `🔢 *ROUND ${gameState.roundNumber}/${gameState.roundsPerMatch}* — ${liveChat}\n`
            statusText += `🎯 Range: *${gameState.effectiveMin}–${gameState.effectiveMax}* (×${gameState.multiplier.toFixed(2)} scale)\n`
            statusText += `🔢 Guesses used: *${gameState.guessCount}/${gameState.guessCap}*\n`
            statusText += `⏳ Time left: *${gameState.roundSecondsLeft}s*\n`
            statusText += `🎲 Chaos: *${gameState.chaosIntensity}*` +
                (gameState.chaosEvent && gameState.chaosEvent.type !== 'none' ? ` — this round: *${gameState.chaosEvent.type}*` : '') + `\n`
            if (gameState.teamChaos && gameState.teamChaos.active) {
                statusText += `⚔️ Team A: *${gameState.teamScores.A}* pts · Team B: *${gameState.teamScores.B}* pts\n`
            } else {
                statusText += `👥 Standings: ${gameState.players.map(n => `${gameState.playerNames[n] || n} (${gameState.roundsWon[n] || 0}pt)`).join(', ')}\n`
            }
        }
        statusText += `\n*Config:*\n`
        statusText += `› Mode: *${engine.modeDisplay(settings)}*\n`
        statusText += `› Rounds per match: *${engine.roundsForMatch(settings)}*`

        await sendSafeMessage(sock, replyTo, { text: statusText })
        return true
    }

    if (cmd === 'pause') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active round to pause right now.` })
            return true
        }
        const ok = engine.pauseSession(liveChat, gameCtx)
        if (ok) {
            persistGames()
            await sendSafeMessage(sock, replyTo, { text: `⏸️ *Round paused.* ✅` })
            await sock.sendMessage(liveChat, { text: `⏸️ *Round paused by the admin.* Sit tight — we'll be right back! ☕` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Round is already paused or no round is in progress.` })
        }
        return true
    }

    if (cmd === 'resume') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active round to resume right now.` })
            return true
        }
        const ok = engine.resumeSession(liveChat, gameCtx)
        if (ok) {
            await sendSafeMessage(sock, replyTo, { text: `▶️ *Round resumed!* ✅` })
            await sock.sendMessage(liveChat, { text: `▶️ *Round resumed by the admin!* Fresh timer — keep guessing! 🔢` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Round is not currently paused.` })
        }
        return true
    }

    if (cmd === 'skip') {
        if (!liveChat || !gameState || !gameState.active) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active round to skip right now.` })
            return true
        }
        const secret = gameState.secretNumber
        engine.resolveRoundEnd(gameState, 'timeout', null)
        persistGames()
        await sock.sendMessage(liveChat, {
            text: `⏭️ *Round skipped by the admin.* The number was *${secret}*. No round win this time.`
        })
        await engine.advanceRoundOrEndMatch(liveChat, gameCtx)
        await sendSafeMessage(sock, replyTo, { text: `⏭️ *Round skipped.* ✅` })
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
                text: `🛑 *${config.GAME_NAME} terminated by the admin.* Thanks for guessing, everyone! 👋`
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
                  `*${config.GAME_NAME}* state was wiped back to defaults for its chat. Mode and rounds-per-match settings are untouched — ` +
                  `use \`${config.ADMIN_PREFIX}mode\` / \`${config.ADMIN_PREFIX}setrounds\` if you want to change those too.`
                : `ℹ️ *Nothing to reset.*\n\nNo active *${config.GAME_NAME}* session was found for this chat — there was nothing to wipe.`
        })
        return true
    }

    if (cmd === 'mode') {
        const key = (arg || '').toLowerCase()
        if (!config.MODES[key]) {
            await sendSafeMessage(sock, replyTo, {
                text: `⚠️ Usage: \`${config.ADMIN_PREFIX}mode <${Object.keys(config.MODES).join('|')}>\``
            })
            return true
        }
        writeSetting(senderTier, `${config.GAME_KEY}_mode`, key, settings)
        const mode = config.MODES[key]
        await sendSafeMessage(sock, replyTo, {
            text: `⚙️ Mode set to *${mode.LABEL} (${mode.MIN}–${mode.MAX})* 🎮 — takes effect on the *next* match.`
        })
        return true
    }

    if (cmd === 'setrounds') {
        const n = parseInt(arg, 10)
        if (!Number.isInteger(n) || n < 1 || n > 15) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`${config.ADMIN_PREFIX}setrounds <1-15>\`` })
            return true
        }
        writeSetting(senderTier, `${config.GAME_KEY}_rounds`, n, settings)
        await sendSafeMessage(sock, replyTo, {
            text: `⚙️ Rounds per match set to *${n}* 🔢 — takes effect on the *next* match.`
        })
        return true
    }

    if (cmd === 'chaos') {
        const key = (arg || '').toLowerCase()
        if (!config.CHAOS_INTENSITIES.includes(key)) {
            const current = engine.chaosIntensityFor(settings)
            await sendSafeMessage(sock, replyTo, {
                text:
                    `⚠️ Usage: \`${config.ADMIN_PREFIX}chaos <${config.CHAOS_INTENSITIES.join('|')}>\`\n` +
                    `Currently: *${current}*\n\n` +
                    `_This is a single dial, not a feature checklist — the engine rolls WHICH ` +
                    `chaos event fires, WHO it targets, and WHEN, autonomously. You're only ` +
                    `choosing how wild the match gets, not the specifics._`
            })
            return true
        }
        writeSetting(senderTier, `${config.GAME_KEY}_chaos`, key, settings)
        await sendSafeMessage(sock, replyTo, {
            text: `🎲 Chaos set to *${key}* — takes effect on the *next* match.`
        })
        return true
    }

    // Unrecognised /gmn subcommand — explicit error, not silence.
    await sendSafeMessage(sock, replyTo, {
        text: `⚠️ *Unknown command.* Try \`${config.ADMIN_PREFIX}help\`.`
    })
    return true
}

module.exports = { handleAdminCommand }
