// ============================================================
//  admin-onboarding.js — Bot-wide admin identity management
//  Sky Graphics
//
//  Extracted out of HangmanGame/adminCommands.js, where it used
//  to live. That was a real bug: settings.adminNumber/adminJid
//  are bot-wide, unprefixed settings (see ARCHITECTURE.md §4) —
//  "who is the admin" is bot identity, not a Hangman concern. As
//  built, the key-request/approve/deny flow only ever worked
//  while Hangman happened to be the active game; switching to any
//  other game (e.g. Word Climb) silently broke onboarding, because
//  no other game folder had a copy of this flow.
//
//  This module is invoked under a FIXED, game-independent prefix
//  ("/admin ...") the exact same way game-switch-commands.js
//  handles "/game ..." — checked in index.js BEFORE the active
//  game's own ADMIN_PREFIX, so it works no matter which game is
//  currently active.
//
//  Commands:
//    /admin                       — request access (or "welcome back" if
//                                    already Creator/Admin)
//    /admin [key]                 — redeem a previously-issued key
//    /admin approve [num]         — creator only: deliver the key
//    /admin deny [num]            — creator only: void the request
//    /admin set [num] [gamekey|all]   — creator/admin: grant access,
//                                    ADDS gamekey to the current scope
//                                    (or replaces it with 'all')
//    /admin clear [gamekey|all]   — creator/admin: revoke access,
//                                    REMOVES gamekey from the current
//                                    scope (or wipes it entirely on
//                                    'all') — auto-demotes to PUBLIC
//                                    if this empties the scope
//    /admin clear                 — creator only, no args: removes the
//                                    admin identity entirely (unchanged
//                                    from before the list model)
//
//  settings.adminGameAccess is 'all' | string[] — see permissions.js
//  hasGameAccess()/gameAccessList()/describeGameAccess() for the
//  single source of truth on reading/formatting it. Every write in
//  this file goes through gameAccessList() so the array-vs-'all'
//  shape never has to be branched on more than once per command.
// ============================================================

const crypto = require('crypto')
const { TIERS, gameAccessList, describeGameAccess } = require('./permissions')
const registry = require('./games-registry')

const DIVIDER   = '━━━━━━━━━━━━━━━━━━━━━━'
const BOT_EMOJI = '🤖'

// ─── Pending key sessions (module-level, shared across every game) ──
const pendingKeys     = {}
const approvalQueue   = {}
const voidedSessions  = {}
const VOIDED_LOCKOUT_MS = 30 * 60 * 1000
const adminRateLimit = {}

// ─── Pending MANUAL admin change (creator/admin direct override,
// bypassing the key-request/approve dance entirely) ──────────────
// Single pending change at a time, bot-wide — mirrors the same
// "singular ref" shape index.js used to hold this in before it was
// scoped to Hangman only.
let pendingManualChange = null

let adminLastActive = 0
let adminInactivityTimer = null

// Resolves a "[gamekey|all]" argument for /admin set and /admin clear —
// the one place this parsing logic lives, so both agree on what a
// valid gamekey/scope looks like.
// Returns { ok: true, scope } or { ok: false, error }.
function resolveGameScope(rawScope) {
    if (!rawScope || rawScope.toLowerCase() === 'all') {
        return { ok: true, scope: 'all' }
    }
    const game = registry.getGame(rawScope.toLowerCase())
    if (!game) {
        const available = registry.listGameKeys().join(', ') || 'none loaded'
        return { ok: false, error: `Unknown game \`${rawScope}\`. Available: *${available}* (or \`all\`).` }
    }
    return { ok: true, scope: game.config.GAME_KEY }
}

function generateKey() {
    return crypto.randomUUID()
}

function cleanExpiredKeys() {
    const now = Date.now()
    for (const jid in pendingKeys) {
        if (pendingKeys[jid].expiresAt < now) {
            const num = pendingKeys[jid].senderNumber
            delete pendingKeys[jid]
            delete approvalQueue[num]
        }
    }
    for (const num in voidedSessions) {
        if (voidedSessions[num].voidedAt + VOIDED_LOCKOUT_MS < now) {
            delete voidedSessions[num]
        }
    }
}

function checkAdminRateLimit(senderNumber) {
    const now = Date.now()
    const entry = adminRateLimit[senderNumber] || { count: 0, lockedUntil: 0 }

    if (now < entry.lockedUntil) return true
    if (entry.lockedUntil && now >= entry.lockedUntil) {
        entry.count = 0
        entry.lockedUntil = 0
    }
    entry.count++
    if (entry.count >= 5) {
        entry.lockedUntil = now + 10 * 60 * 1000
        entry.count = 0
    }
    adminRateLimit[senderNumber] = entry
    return false
}

function startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage) {
    if (adminInactivityTimer) clearInterval(adminInactivityTimer)
    adminLastActive = Date.now()

    adminInactivityTimer = setInterval(async () => {
        if (!settings.adminNumber) {
            clearInterval(adminInactivityTimer)
            adminInactivityTimer = null
            return
        }
        const thirtyDays = 30 * 24 * 60 * 60 * 1000
        if (Date.now() - adminLastActive >= thirtyDays) {
            clearInterval(adminInactivityTimer)
            adminInactivityTimer = null

            const cleared = settings.adminNumber
            settings.adminNumber = ''
            settings.adminJid    = ''
            settings.adminGameAccess = 'all'
            saveSettings()

            const creatorJid = process.env.CREATOR_JID || ''
            if (creatorJid) {
                try {
                    await sendSafeMessage(sock, creatorJid, {
                        text:
                            `⚠️ *Admin Slot Auto-Cleared*\n\n` +
                            `${cleared} has been inactive for *30 days* — the admin slot has been reset.\n\n` +
                            `The bot is now unconfigured. The next */admin* request will begin fresh onboarding. 🚀`
                    })
                } catch (_) {}
            }
            console.log(`[inactivity] Admin slot cleared — ${cleared} inactive for 30 days.`)
        }
    }, 60 * 60 * 1000)
}

// Call this once, right after a successful onboarding OR at boot if
// settings.adminNumber is already set — index.js is responsible for
// the boot-time call; onboarding calls it itself below.
function ensureInactivityTimerRunning(settings, saveSettings, sock, sendSafeMessage) {
    if (settings.adminNumber && !adminInactivityTimer) {
        startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage)
    }
}

/**
 * @param {object} ctx — { sock, settings, saveSettings, sendSafeMessage,
 *   senderNumber, senderJid, senderName, senderTier, cmd (array, already
 *   stripped of "/admin"), activeGame (optional — the currently active
 *   game module, used only to point people at "[prefix] help") }
 * @returns {boolean} true if this was an "/admin ..." command and has
 *   been fully handled — caller should not process it any further.
 */
async function handleAdminOnboarding(ctx) {
    cleanExpiredKeys()

    const {
        sock, settings, saveSettings, sendSafeMessage,
        senderNumber, senderJid, senderName, senderTier, cmd, activeGame
    } = ctx

    const senderIsCreator = senderTier === TIERS.CREATOR
    const isAdmin = senderIsCreator || senderTier === TIERS.ADMIN
    const requesterJid = senderJid
    const creatorJid = process.env.CREATOR_JID || ''

    const helpHint = activeGame
        ? `${activeGame.config.ADMIN_PREFIX.trim()} help`
        : `[game's admin prefix] help`

    // ══════════════════════════════════════════════
    //  /admin help
    // ══════════════════════════════════════════════
    if (cmd[0] === 'help') {
        if (!senderIsCreator && !isAdmin) return true

        let text =
            `${DIVIDER}\n` +
            `${BOT_EMOJI} *Admin Identity Commands*\n` +
            `${DIVIDER}\n` +
            `_Sky Graphics — bot-wide, works no matter which game is active_\n\n` +
            `*Everyone:*\n` +
            `› \`/admin\` — request access\n` +
            `› \`/admin [key]\` — redeem a key you were given\n\n`

        if (senderIsCreator) {
            text +=
                `*Creator only:*\n` +
                `› \`/admin approve [num] [gamekey|all]\` — deliver a key, scoped to one game or all\n` +
                `› \`/admin deny [num]\` — void a pending request\n` +
                `› \`/admin clear\` — remove the admin identity entirely\n\n`
        }

        text +=
            `*Creator or Admin:*\n` +
            `› \`/admin set [num] [gamekey|all]\` — grant access; adds *gamekey* to their existing scope (or replaces it with *all*)\n` +
            `› \`/admin clear [gamekey|all]\` — revoke access; removes *gamekey* from their scope (or wipes it on *all*) — auto-demotes if it empties their scope\n` +
            `› \`/admin confirm\` / \`/admin cancel\` — apply or discard a pending \`set\`/\`clear\`\n\n` +
            `${DIVIDER}\n` +
            `_Each game's own commands live under its own prefix — type \`${helpHint}\`._`

        await sendSafeMessage(sock, senderJid, { text })
        return true
    }

    // ══════════════════════════════════════════════
    //  /admin
    // ══════════════════════════════════════════════
    if (cmd[0] === undefined || cmd[0] === '') {
        if (senderIsCreator) {
            await sendSafeMessage(sock, senderJid, {
                text:
                    `${DIVIDER}\n` +
                    `   🔐  Sky Graphics Creator\n` +
                    `${DIVIDER}\n\n` +
                    `Welcome back, *Founder*. 👋\n\n` +
                    `You have *unrestricted access* to every function of this bot — ` +
                    `no keys, no approvals, no gates.\n\n` +
                    `Type *${helpHint}* to open the active game's dashboard.\n\n` +
                    `${DIVIDER}\n` +
                    `_Sky Graphics_ 🎨`
            })
            return true
        }

        if (isAdmin && settings.adminNumber !== '') {
            const hasStation = settings.adminGameAccess === 'all' ||
                (Array.isArray(settings.adminGameAccess) && settings.adminGameAccess.length > 0) ||
                (typeof settings.adminGameAccess === 'string' && settings.adminGameAccess !== '')

            await sendSafeMessage(sock, senderJid, {
                text: hasStation
                    ? (
                        `${DIVIDER}\n` +
                        `   👑  Bot Administrator\n` +
                        `${DIVIDER}\n\n` +
                        `Welcome back, *Administrator*. 👋\n\n` +
                        `You're *registered* on this bot, stationed on: *${describeGameAccess(settings)}*.\n\n` +
                        `Type *${helpHint}* to open your dashboard.\n\n` +
                        `${DIVIDER}\n` +
                        `_Sky Graphics_ 🎨`
                    ) : (
                        `${DIVIDER}\n` +
                        `   👑  Bot Administrator\n` +
                        `${DIVIDER}\n\n` +
                        `Welcome back, *Administrator*. 👋\n\n` +
                        `You're *registered* on this bot, but not *stationed* on a game yet — your creator hasn't assigned you one.\n\n` +
                        `Check back with *${helpHint}* once you've been assigned. 🕓\n\n` +
                        `${DIVIDER}\n` +
                        `_Sky Graphics_ 🎨`
                    )
            })
            return true
        }

        if (settings.adminNumber !== '' && !isAdmin) {
            if (checkAdminRateLimit(senderNumber)) return true
            await sendSafeMessage(sock, requesterJid, {
                text: `ℹ️ This bot is already configured. Contact the group admin for assistance.`
            })
            return true
        }

        const voided = voidedSessions[senderNumber]
        if (voided && Date.now() - voided.voidedAt < VOIDED_LOCKOUT_MS) {
            if (checkAdminRateLimit(senderNumber)) return true
            await sendSafeMessage(sock, requesterJid, {
                text:
                    `🚫 *Session Voided*\n\n` +
                    `Too many incorrect attempts. Your access session has been cancelled.\n\n` +
                    `Contact the *Sky Graphics* team to request a new key. 📩`
            })
            return true
        }

        if (checkAdminRateLimit(senderNumber)) return true

        const newKey  = generateKey()
        const reqName = senderName || senderNumber

        pendingKeys[senderJid] = {
            key: newKey,
            expiresAt: Date.now() + 10 * 60 * 1000,
            senderNumber,
            senderName: reqName
        }
        approvalQueue[senderNumber] = senderJid

        await sendSafeMessage(sock, requesterJid, {
            text:
                `${DIVIDER}\n` +
                `   🔐  Admin Configuration\n` +
                `${DIVIDER}\n` +
                `_Sky Graphics Bot_ 🎨\n\n` +
                `Hello! 👋\n\n` +
                `You're attempting to access the *Bot Administration Panel*.\n\n` +
                `To proceed, enter the access key provided to you by the *Sky Graphics team*:\n\n` +
                `\`/admin YOURKEY\`\n\n` +
                `${DIVIDER}\n` +
                `📩 Don't have a key? Contact Sky Graphics to request access.`
        })

        if (creatorJid) {
            try {
                await sendSafeMessage(sock, creatorJid, {
                    text:
                        `${DIVIDER}\n` +
                        `   🔔  Admin Access Request\n` +
                        `${DIVIDER}\n\n` +
                        `Someone is requesting admin access to your bot.\n\n` +
                        `👤 *Name:* ${reqName}\n` +
                        `📱 *Number:* \`${senderNumber}\`\n` +
                        `🗝️ *Key:* \`${newKey}\`\n\n` +
                        `*What do you want to do?*\n\n` +
                        `✅ To *approve* and send them the key:\n` +
                        `\`/admin approve ${senderNumber}\`\n\n` +
                        `❌ To *deny* and void the key immediately:\n` +
                        `\`/admin deny ${senderNumber}\`\n\n` +
                        `_If you do nothing, the key auto-expires in 10 minutes._\n\n` +
                        `${DIVIDER}\n` +
                        `_Sky Graphics_ 🎨`
                })
            } catch (err) {
                console.log('⚠️ Could not DM creator with key request:', err.message)
                console.log(`[FALLBACK] Admin key for ${senderNumber}: ${newKey}`)
            }
        } else {
            console.log(`[NO CREATOR_JID SET] Admin key for ${senderNumber}: ${newKey}`)
        }
        return true
    }

    // ══════════════════════════════════════════════
    //  /admin approve [number] — CREATOR ONLY
    // ══════════════════════════════════════════════
    // ══════════════════════════════════════════════
    //  /admin approve [number] — CREATOR ONLY
    //  Authorizes the connection ONLY — no game decision happens here
    //  anymore. The requester redeems their key and becomes REGISTERED
    //  with no game assigned; the creator then STATIONS them on a game
    //  separately via /admin set. This used to take a [gamekey|all]
    //  argument and decide scope before the person had even connected —
    //  moved to /admin set, which is now the single place assignment
    //  happens, so "connect" and "assign a game" are always two
    //  distinct, separately-notified steps.
    // ══════════════════════════════════════════════
    if (cmd[0] === 'approve') {
        if (!senderIsCreator) return true

        const targetNumber = (cmd[1] || '').replace(/[^0-9]/g, '')
        if (!targetNumber) {
            await sendSafeMessage(sock, creatorJid, { text: `⚠️ Usage: \`/admin approve [number]\`` })
            return true
        }

        const targetJid = approvalQueue[targetNumber]
        if (!targetJid || !pendingKeys[targetJid]) {
            await sendSafeMessage(sock, creatorJid, {
                text: `⚠️ *No active request found for* \`${targetNumber}\`\n\nThe session may have already expired or been denied.`
            })
            return true
        }

        const session = pendingKeys[targetJid]

        if (Date.now() > session.expiresAt) {
            delete pendingKeys[targetJid]
            delete approvalQueue[targetNumber]
            await sendSafeMessage(sock, creatorJid, {
                text: `⏰ *Too late* — the session for \`${targetNumber}\` already expired.`
            })
            return true
        }

        try {
            await sendSafeMessage(sock, targetJid, {
                text:
                    `${DIVIDER}\n` +
                    `   🗝️  Your Access Key\n` +
                    `${DIVIDER}\n` +
                    `_From the Sky Graphics Team_ 🎨\n\n` +
                    `Your request has been *approved*. ✅\n\n` +
                    `Here is your access key:\n\n` +
                    `*\`${session.key}\`*\n\n` +
                    `To activate your admin account, type:\n` +
                    `\`/admin ${session.key}\`\n\n` +
                    `⏰ *This key expires in 10 minutes.*\n` +
                    `Do not share it with anyone.\n\n` +
                    `${DIVIDER}\n` +
                    `_Sky Graphics_ 🎨`
            })

            await sendSafeMessage(sock, creatorJid, {
                text:
                    `✅ *Key delivered to* \`${targetNumber}\`\n\n` +
                    `They now have until the 10-minute window closes to activate. Once they redeem it, station them on a game with:\n` +
                    `\`/admin set ${targetNumber} [gamekey|all]\` ⏱️`
            })
        } catch (err) {
            await sendSafeMessage(sock, creatorJid, {
                text: `⚠️ *Could not deliver key to* \`${targetNumber}\`: ${err.message}`
            })
        }
        return true
    }

    // ══════════════════════════════════════════════
    //  /admin deny [number] — CREATOR ONLY
    // ══════════════════════════════════════════════
    if (cmd[0] === 'deny') {
        if (!senderIsCreator) return true

        const targetNumber = (cmd[1] || '').replace(/[^0-9]/g, '')
        if (!targetNumber) {
            await sendSafeMessage(sock, creatorJid, { text: `⚠️ Usage: \`/admin deny [number]\`` })
            return true
        }

        const targetJid = approvalQueue[targetNumber]
        if (targetJid) {
            delete pendingKeys[targetJid]
            try {
                await sendSafeMessage(sock, targetJid, {
                    text: `❌ *Your access request was denied.*\n\nContact the *Sky Graphics* team if you believe this is a mistake.`
                })
            } catch (_) {}
        }
        delete approvalQueue[targetNumber]
        voidedSessions[targetNumber] = { voidedAt: Date.now() }

        await sendSafeMessage(sock, creatorJid, {
            text: `✅ *Request from* \`${targetNumber}\` *denied and voided.*`
        })
        return true
    }

    // ══════════════════════════════════════════════
    //  /admin set [number] [gamekey|all] — CREATOR or ADMIN
    //  Direct manual override — skips the key-exchange dance
    //  entirely. This used to be "/hmg set admin", reachable only
    //  while Hangman was active — moved here because "who is the
    //  admin, and for which game(s)" is bot identity, exactly like
    //  the key-request flow above, not a Hangman concern.
    // ══════════════════════════════════════════════
    if (cmd[0] === 'set') {
        if (!senderIsCreator && !isAdmin) return true

        const newAdmin = (cmd[1] || '').replace(/[^0-9]/g, '')
        if (!newAdmin) {
            await sendSafeMessage(sock, senderJid, { text: `⚠️ Usage: \`/admin set [full number with country code] [gamekey|all]\`` })
            return true
        }

        const scopeResult = resolveGameScope(cmd[2])
        if (!scopeResult.ok) {
            await sendSafeMessage(sock, senderJid, { text: `⚠️ ${scopeResult.error}` })
            return true
        }

        // Same admin already on file? "set" is additive — stations one
        // more game on top of whatever they're already stationed on.
        // Different number? This is the direct-install shortcut (no key
        // needed) — still valid, unchanged from before; it's a separate
        // path from "approve → redeem → set" and both are fine to keep.
        const isSameAdmin = !!settings.adminNumber && newAdmin === settings.adminNumber
        pendingManualChange = { action: 'set', number: newAdmin, scope: scopeResult.scope, isSameAdmin }

        const scopePreview = scopeResult.scope === 'all'
            ? 'ALL games'
            : isSameAdmin && settings.adminGameAccess !== 'all'
                ? `${describeGameAccess(settings)} + ${scopeResult.scope}`
                : scopeResult.scope

        await sendSafeMessage(sock, senderJid, {
            text:
                `⚠️ *Confirm Station Assignment?*\n\n` +
                `Number: *${newAdmin}*${isSameAdmin ? ' _(already registered — adding a station)_' : ' _(registered, not yet stationed)_'}\n` +
                `Stationed on after this change: *${scopePreview}*\n\n` +
                `Type */admin confirm* to apply, or */admin cancel* to discard.`
        })
        return true
    }

    // ══════════════════════════════════════════════
    //  /admin clear             — CREATOR ONLY, no args
    //                             Removes the admin identity entirely,
    //                             immediately — no confirm step, same as
    //                             before the list model. Deliberately
    //                             creator-only (unlike the scoped form
    //                             below) — an admin shouldn't be able to
    //                             lock everyone else out including the
    //                             creator's ability to re-onboard cleanly.
    //  /admin clear [gamekey|all] — CREATOR or ADMIN
    //                             Mirrors "set" in the opposite direction
    //                             and goes through the SAME confirm/cancel
    //                             step — revoking access is consequential
    //                             enough (can fully demote someone) that
    //                             it deserves the same safety net as set.
    // ══════════════════════════════════════════════
    if (cmd[0] === 'clear' && !cmd[1]) {
        if (!senderIsCreator) return true

        const cleared = settings.adminNumber
        settings.adminNumber = ''
        settings.adminJid = ''
        settings.adminGameAccess = 'all'
        saveSettings()
        pendingManualChange = null

        await sendSafeMessage(sock, senderJid, {
            text:
                `✅ *Admin identity cleared.*\n\n` +
                `${cleared || 'No admin'} has been removed. The next */admin* request will begin fresh onboarding. 🔑\n\n` +
                `Per-game settings (word pools, timers, etc.) are untouched — clear those individually via each game's own admin \`reset\`.`
        })
        return true
    }

    if (cmd[0] === 'clear') {
        if (!senderIsCreator && !isAdmin) return true

        if (!settings.adminNumber) {
            await sendSafeMessage(sock, senderJid, { text: `⚠️ There's no admin set right now — nothing to clear.` })
            return true
        }

        const scopeResult = resolveGameScope(cmd[1])
        if (!scopeResult.ok) {
            await sendSafeMessage(sock, senderJid, { text: `⚠️ ${scopeResult.error}` })
            return true
        }

        pendingManualChange = { action: 'clear', scope: scopeResult.scope }

        const preview = scopeResult.scope === 'all'
            ? 'nothing — fully de-registered'
            : (() => {
                const remaining = settings.adminGameAccess === 'all'
                    ? registry.listGameKeys().filter(k => k !== scopeResult.scope)
                    : gameAccessList(settings).filter(k => k !== scopeResult.scope)
                return remaining.length ? remaining.join(', ') : 'nothing — fully de-registered'
            })()

        await sendSafeMessage(sock, senderJid, {
            text:
                `⚠️ *Confirm Station Revoke?*\n\n` +
                `Admin: *${settings.adminNumber}*\n` +
                `Revoking: *${scopeResult.scope === 'all' ? 'ALL games' : scopeResult.scope}*\n` +
                `Stationed on after this change: *${preview}*\n\n` +
                `Type */admin confirm* to apply, or */admin cancel* to discard.`
        })
        return true
    }

    if (cmd[0] === 'confirm') {
        if (!senderIsCreator && !isAdmin) return true

        if (!pendingManualChange) {
            await sendSafeMessage(sock, senderJid, { text: `⚠️ Nothing to confirm. Use \`/admin set\` or \`/admin clear\` first.` })
            return true
        }

        const confirmed = pendingManualChange
        pendingManualChange = null

        // ── Applying a pending "set" ──────────────────────────
        if (confirmed.action === 'set') {
            let finalScope
            if (confirmed.scope === 'all') {
                finalScope = 'all'
            } else if (confirmed.isSameAdmin && settings.adminGameAccess !== 'all') {
                const list = gameAccessList(settings)
                if (!list.includes(confirmed.scope)) list.push(confirmed.scope)
                finalScope = list
            } else if (confirmed.isSameAdmin) {
                finalScope = 'all' // already unrestricted, adding one more game is a no-op
            } else {
                finalScope = [confirmed.scope] // brand-new admin — their scope starts here
            }

            settings.adminNumber = confirmed.number
            settings.adminJid    = confirmed.isSameAdmin ? settings.adminJid : ''
            settings.adminGameAccess = finalScope
            saveSettings()
            startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage)

            await sendSafeMessage(sock, senderJid, {
                text:
                    `✅ *Admin* \`${settings.adminNumber}\` *is stationed on:* *${describeGameAccess(settings)}*\n\n` +
                    `New admin must send any message to the bot so their JID is captured. 📡`
            })
            try {
                await sendSafeMessage(sock, `${settings.adminNumber}@s.whatsapp.net`, {
                    text:
                        `${DIVIDER}\n` +
                        `   👑  You're the Admin\n` +
                        `${DIVIDER}\n\n` +
                        `Welcome! 🎉 You've been *stationed* on *${settings.adminGameAccess === 'all' ? 'every game this bot runs' : describeGameAccess(settings)}*.\n\n` +
                        `Type *${helpHint}* to see all your commands.\n\n` +
                        `${DIVIDER}\n` +
                        `_Sky Graphics_ 🎨`
                })
            } catch (err) {
                console.log('⚠️ Could not DM new admin:', err.message)
            }
            return true
        }

        // ── Applying a pending "clear" ─────────────────────────
        const clearedNum = settings.adminNumber

        if (confirmed.scope === 'all') {
            settings.adminNumber = ''
            settings.adminJid = ''
            settings.adminGameAccess = 'all'
            saveSettings()
            await sendSafeMessage(sock, senderJid, {
                text: `✅ *All stations revoked from* \`${clearedNum}\`.\n\nThey've been fully de-registered — the next */admin* request will begin fresh onboarding.`
            })
            return true
        }

        // This model can't store "all except X" as a standing rule, so
        // it materializes "every OTHER game currently loaded" as an
        // explicit list. Known limitation: a game folder added later
        // won't automatically be excluded too — re-run this command if
        // that matters to you.
        const nextScope = settings.adminGameAccess === 'all'
            ? registry.listGameKeys().filter(k => k !== confirmed.scope)
            : gameAccessList(settings).filter(k => k !== confirmed.scope)

        if (nextScope.length === 0) {
            settings.adminNumber = ''
            settings.adminJid = ''
            settings.adminGameAccess = 'all'
            saveSettings()
            await sendSafeMessage(sock, senderJid, {
                text: `✅ *${confirmed.scope}* station revoked — that was \`${clearedNum}\`'s last remaining station, so they've been fully de-registered.`
            })
            return true
        }

        settings.adminGameAccess = nextScope
        saveSettings()
        await sendSafeMessage(sock, senderJid, {
            text: `✅ *${confirmed.scope}* station revoked from \`${clearedNum}\`.\n\nStill stationed on: *${describeGameAccess(settings)}*.`
        })
        return true
    }

    if (cmd[0] === 'cancel') {
        if (!senderIsCreator && !isAdmin) return true

        if (pendingManualChange) {
            const label = pendingManualChange.action === 'set'
                ? `admin change to \`${pendingManualChange.number}\``
                : `access revoke (*${pendingManualChange.scope === 'all' ? 'ALL games' : pendingManualChange.scope}*)`
            pendingManualChange = null
            await sendSafeMessage(sock, senderJid, { text: `❌ Pending ${label} cancelled.` })
        } else {
            await sendSafeMessage(sock, senderJid, { text: `⚠️ Nothing to cancel.` })
        }
        return true
    }

    // ══════════════════════════════════════════════
    //  /admin [key] — redeem a key
    // ══════════════════════════════════════════════
    {
        if (checkAdminRateLimit(senderNumber)) return true

        const input = cmd.join(' ').trim()
        const session = pendingKeys[senderJid]

        if (!session) {
            await sendSafeMessage(sock, requesterJid, {
                text:
                    `🔒 *Access Denied*\n\n` +
                    `No active configuration session was found for your account.\n\n` +
                    `If you believe this is an error, contact the *Sky Graphics* team. 📩`
            })
            return true
        }

        if (Date.now() > session.expiresAt) {
            delete pendingKeys[senderJid]
            delete approvalQueue[senderNumber]
            await sendSafeMessage(sock, requesterJid, {
                text:
                    `⏰ *Session Expired*\n\n` +
                    `Your configuration window has closed.\n\n` +
                    `Contact the *Sky Graphics* team to request access again. 📩`
            })
            return true
        }

        if (input.toLowerCase() !== session.key.toLowerCase()) {
            session.attempts = (session.attempts || 0) + 1
            console.warn(`[SECURITY] Wrong key attempt ${session.attempts}/3 from ${senderNumber} (JID: ${senderJid})`)

            if (session.attempts >= 3) {
                delete pendingKeys[senderJid]
                delete approvalQueue[senderNumber]
                voidedSessions[senderNumber] = { voidedAt: Date.now() }
                await sendSafeMessage(sock, requesterJid, {
                    text:
                        `🚫 *Session Voided*\n\n` +
                        `Too many incorrect attempts. Your access session has been cancelled.\n\n` +
                        `Contact the *Sky Graphics* team to request a new key. 📩`
                })
                if (creatorJid) {
                    try {
                        await sendSafeMessage(sock, creatorJid, {
                            text:
                                `⚠️ *Key Session Voided*\n\n` +
                                `\`${senderNumber}\` made 3 incorrect key attempts — their session has been cancelled automatically. 🔒`
                        })
                    } catch (_) {}
                }
            } else {
                await sendSafeMessage(sock, requesterJid, {
                    text:
                        `❌ *Invalid Key*\n\n` +
                        `The key you entered is incorrect. (Attempt ${session.attempts}/3)\n\n` +
                        `Double-check the key and try again: \`/admin YOURKEY\` 🔑`
                })
            }
            return true
        }

        const approvedSession = { ...session }
        delete pendingKeys[senderJid]
        delete approvalQueue[senderNumber]

        const confirmedPN  = requesterJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
        const confirmedJid = requesterJid

        settings.adminNumber = confirmedPN || senderNumber
        settings.adminJid    = confirmedJid || senderJid
        // Redeeming a key REGISTERS the admin only — no game is STATIONED
        // yet. That's a deliberate separate step now, via /admin set. See
        // the "approve" block above for why this moved.
        settings.adminGameAccess = []
        saveSettings()

        console.log(`👑 Admin registered — PN: ${settings.adminNumber} | JID: ${settings.adminJid} | not yet stationed on a game`)
        startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage)

        await sendSafeMessage(sock, confirmedJid, {
            text:
                `${DIVIDER}\n` +
                `   👑  Access Granted\n` +
                `${DIVIDER}\n\n` +
                `Welcome, *Administrator!* 🎉\n\n` +
                `You're now *registered* on this bot. Your creator will *station* you on a game shortly — check back with \`/admin\` anytime to see your assignment.\n\n` +
                `${DIVIDER}\n` +
                `_Sky Graphics_ 🎨`
        })

        if (creatorJid) {
            try {
                await sendSafeMessage(sock, creatorJid, {
                    text:
                        `✅ *Admin Registration Complete*\n\n` +
                        `👤 Name: *${approvedSession.senderName || 'Unknown'}*\n` +
                        `📱 Number: \`${settings.adminNumber}\`\n\n` +
                        `They're registered but not stationed on a game yet — assign one with:\n` +
                        `\`/admin set ${settings.adminNumber} [gamekey|all]\``
                })
            } catch (_) {}
        }
        return true
    }
}

module.exports = { handleAdminOnboarding, ensureInactivityTimerRunning }
