// ============================================================
//  game-switch-commands.js — Game Bots · Sky Graphics
//  Shared, game-agnostic CREATOR-ONLY commands, called ONLY from
//  index.js under the fixed "/game" prefix — never from inside any
//  individual game's adminCommands.js. This is deliberate: the whole
//  point is that switching games never requires knowing that game's
//  own acronym/prefix. "/game" always works, no matter what's active.
//
//    /game setgame [key]         — switch which game is currently active
//    /game set public|start|autojoin [on|off] — bot-wide toggles, govern
//                                    whichever game is active
//    /game status                 — show what's active + what's available
//    /game roletags on|off        — bot-wide (Creator)/(Admin) name tag toggle
//
//  Station assignment ("which game(s) can the admin operate") is NOT
//  handled here — that's identity, not configuration, and lives
//  entirely in admin-onboarding.js as /admin set / /admin clear.
//
//  "setgame" also attempts a clean hand-off (ARCHITECTURE.md §10): if the
//  previous game has a live session in the shared activeGameChatRef chat
//  and exports gameEngine.forceStopActiveSession(chatId, ctx), it's
//  called and cleanly stopped before the switch. If a game doesn't
//  export that function, the switch still happens — the confirmation
//  message just says so honestly instead of leaving orphaned timers
//  running silently.
//
//  index.js calls handleGameSwitchCommands(ctx) directly when a message
//  starts with "/game". Returns true if handled (and replied to).
// ============================================================

const registry = require('./games-registry')
const { TIERS, writeSetting, resolveSetting, describeGameAccess } = require('./permissions')

async function handleGameSwitchCommands(ctx) {
    const {
        cmd, senderIsCreator, sock, sendSafeMessage, replyTo,
        settings, saveSettings, activeGameChatRef, games, persistGames
    } = ctx
    // ctx.senderIsAdmin is read directly (not destructured above) only by
    // the status branch below — kept optional so existing callers that
    // don't pass it still work fine for setgame/status/roletags.

    const senderIsAdmin = senderIsCreator || ctx.senderIsAdmin
    const senderTier    = senderIsCreator ? TIERS.CREATOR : TIERS.ADMIN

    // ── set public/start/autojoin [on/off] — bot-wide toggles ──
    // These used to live only inside HangmanGame/adminCommands.js
    // (as "/hmg set public" etc). That broke MEMORY.md rule 2 in
    // exactly the way it warns about: the setting governs whichever
    // game is active, but was only reachable while Hangman itself
    // was the active game — an admin running WordClimb had no way
    // to toggle it at all. Moved here, same writeSetting/creator-
    // override semantics, same admin-or-creator access as before.
    if (cmd[0] === 'set' && (cmd[1] === 'public' || cmd[1] === 'start' || cmd[1] === 'autojoin')) {
        if (!senderIsAdmin) return false

        const key = cmd[1] === 'public' ? 'publicVisible' : cmd[1] === 'start' ? 'publicCanStart' : 'autoJoin'
        const mode = (cmd[2] || '').toLowerCase()

        if (mode !== 'on' && mode !== 'off') {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/game set ${cmd[1]} [on/off]\`` })
            return true
        }

        const newValue = (mode === 'on')
        writeSetting(senderTier, key, newValue, settings)
        saveSettings()

        const labels = {
            publicVisible:  newValue ? `🔓 *Public Visibility: ON*\nNon-admins can interact with the bot. 👥`
                                      : `🔒 *Public Visibility: OFF*\nNon-admins are completely silenced. 🤐`,
            publicCanStart: newValue ? `🔓 *Public Game Starts: ON*\nAnyone can open a lobby in the active game. 🎮`
                                      : `🔒 *Public Game Starts: OFF*\nOnly admin can open a lobby. 👑`,
            autoJoin:       newValue ? `🟢 *Auto-Join: ON*\nCreator/Admin auto-join every lobby that opens. 🎮`
                                      : `🔴 *Auto-Join: OFF*\nCreator/Admin must \`join\` lobbies manually. 👋`
        }
        await sendSafeMessage(sock, replyTo, {
            text: labels[key] + `\n\n_Applies bot-wide — to whichever game is currently active._`
        })
        return true
    }

    // ── setgame [key] ───────────────────────────────────────
    if (cmd[0] === 'setgame') {
        if (!senderIsCreator) return false // not creator-only business here; let it fall through (will just be ignored)

        const target = (cmd[1] || '').toLowerCase()
        const game   = registry.getGame(target)

        if (!game) {
            const available = registry.listGameKeys().join(', ') || 'none loaded'
            await sendSafeMessage(sock, replyTo, {
                text:
                    `⚠️ Unknown game \`${target || '(none given)'}\`.\n` +
                    `Available: *${available}*\n` +
                    `Usage: \`setgame [key]\``
            })
            return true
        }

        // ── Clean hand-off — ARCHITECTURE.md §10 (optional contract) ──
        // If a previous game has a live session in the one shared
        // activeGameChatRef chat, try to stop it cleanly before flipping
        // settings.activeGame. Nothing here is mandatory on any game's
        // part: if forceStopActiveSession isn't exported, we say so
        // honestly instead of silently leaving orphaned timers running.
        const previousGame = registry.getActiveGame(settings)
        let stoppedNote = ''

        if (previousGame && activeGameChatRef && activeGameChatRef.value &&
            previousGame.config.GAME_KEY !== game.config.GAME_KEY) {

            if (typeof previousGame.gameEngine.forceStopActiveSession === 'function') {
                const stopped = await previousGame.gameEngine.forceStopActiveSession(
                    activeGameChatRef.value, { games, persistGames, sock, settings }
                )
                if (stopped) {
                    stoppedNote = `\n🛑 Stopped: *${previousGame.config.GAME_NAME}* was active in this chat — ended cleanly.\n`
                    activeGameChatRef.value = null
                    if (typeof persistGames === 'function') persistGames()
                }
            } else {
                stoppedNote =
                    `\n⚠️ *${previousGame.config.GAME_NAME}* may still have an active session in this chat — ` +
                    `it doesn't support clean hand-off yet. Consider \`${previousGame.config.ADMIN_PREFIX}stop\` first.\n`
            }
        }

        settings.activeGame = game.config.GAME_KEY
        saveSettings()

        await sendSafeMessage(sock, replyTo, {
            text:
                `✅ *Active game switched.*${stoppedNote}\n` +
                `🎮 Now running: *${game.config.GAME_NAME} (${game.config.GAME_ACRONYM})*\n` +
                `Public prefix: \`${game.config.PREFIX}\`\n` +
                `Admin prefix: \`${game.config.ADMIN_PREFIX.trim()}\`\n\n` +
                `_Only you, the creator, can switch the active game._`
        })
        return true
    }

    // "setadminaccess" removed — it was a second, differently-behaved
    // path (direct replace) to the same thing /admin set/clear already
    // do (additive/subtractive). Station assignment now happens in
    // exactly one place: /admin set [num] [gamekey|all] to add,
    // /admin clear [gamekey|all] to remove. See admin-onboarding.js.

    // ── status — show active game + admin scope + available games ──
    // Visible to admin tier and above (not senderIsCreator-only — the
    // admin should be able to see what's active even if scoped to it).
    if (cmd[0] === 'status') {
        if (!senderIsCreator && !ctx.senderIsAdmin) return false
        const active = registry.getActiveGame(settings)
        await sendSafeMessage(sock, replyTo, {
            text:
                `🎮 *Game Status*\n\n` +
                `Active: *${active ? `${active.config.GAME_NAME} (${active.config.GAME_ACRONYM})` : 'none loaded'}*\n` +
                `Admin stationed on: *${describeGameAccess(settings)}*\n` +
                `Available: *${registry.listGameKeys().join(', ') || 'none loaded'}*`
        })
        return true
    }

    // ── roletags on|off — bot-wide (Creator)/(Admin) name tag toggle ──
    // Creator-only. Read by permissions.nameTag() so it applies
    // identically across every game — one flag, one place, no per-game
    // duplication or drift.
    if (cmd[0] === 'roletags') {
        if (!senderIsCreator) return false

        const arg = (cmd[1] || '').toLowerCase()
        if (arg !== 'on' && arg !== 'off') {
            await sendSafeMessage(sock, replyTo, {
                text: `Usage: \`/game roletags on\` or \`/game roletags off\`\nCurrently: *${settings.showRoleTags === false ? 'OFF' : 'ON'}*`
            })
            return true
        }

        settings.showRoleTags = (arg === 'on')
        saveSettings()
        await sendSafeMessage(sock, replyTo, {
            text: `✅ Role tags (Creator)/(Admin) are now *${arg === 'on' ? 'ON' : 'OFF'}* — applies bot-wide, across every game.`
        })
        return true
    }

    return false
}

module.exports = { handleGameSwitchCommands }
