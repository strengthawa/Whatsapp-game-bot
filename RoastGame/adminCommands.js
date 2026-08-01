// ============================================================
//  RoastGame/adminCommands.js — Roast Game · Sky Graphics
//  Handles all "/roast" commands.
//
//  Access tiers:
//    CREATOR / ADMIN — full access to every command below.
//    EVERYONE ELSE   — total silence, per ARCHITECTURE.md §5.
//
//  There is deliberately NO "/roast rebuild". roastData.js is
//  hand-curated offline (see that file's header) — adding or
//  updating a person means editing roastData.js directly and
//  restarting the bot, never a command a WhatsApp message can
//  trigger.
//
//  Every reply goes privately to the admin's own DM
//  (`senderJid`) via `sendSafeMessage` — never back into the
//  group the command was typed in (ARCHITECTURE.md §6).
// ============================================================

const { TIERS, hasGameAccess } = require('../permissions')
const config = require('./config')
const { profiles } = require('./roastData')

async function handleAdminCommand(ctx) {
    const { sock, sendSafeMessage, senderTier, senderJid, body, settings } = ctx

    // ── §5: mandatory tier gate, before anything else ────────
    const senderIsCreator = senderTier === TIERS.CREATOR
    // Scope gate — see WordClimbGame/adminCommands.js for the full note.
    // Same gap existed here: an admin scoped away from RoastGame could
    // still run /roast list unrestricted.
    const isScopedIn = senderIsCreator || hasGameAccess(config.GAME_KEY, settings)
    const isAdmin = (senderIsCreator || senderTier === TIERS.ADMIN) && isScopedIn
    if (!isAdmin) return false

    const replyTo = senderJid
    const raw = body.slice(config.ADMIN_PREFIX.length).trim()
    const parts = raw.split(/\s+/)
    const cmd = parts[0] || ''

    if (!cmd || cmd === 'help') {
        await sendSafeMessage(sock, replyTo, {
            text:
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI} *${config.GAME_ACRONYM} Admin Dashboard*\n` +
                `${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_\n\n` +
                `› \`${config.ADMIN_PREFIX}list\` — who currently has a roast profile\n\n` +
                `There is no rebuild command. Roast content is edited directly ` +
                `in \`RoastGame/roastData.js\` and shipped with a restart.`
        })
        return true
    }

    if (cmd === 'list') {
        const keys = Object.keys(profiles)
        if (keys.length === 0) {
            await sendSafeMessage(sock, replyTo, { text: `📊 *Roast profiles.*\n\nNone loaded — roastData.js is empty.` })
            return true
        }
        const lines = keys.map(k => {
            const p = profiles[k]
            const niceCount   = (p.nice   || []).length
            const savageCount = (p.savage || []).length
            return `• *${p.displayName}* — ${p.tier} (${niceCount} nice / ${savageCount} savage)`
        })
        await sendSafeMessage(sock, replyTo, {
            text:
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI} *Roast Profiles (${keys.length})*\n` +
                `${config.DIVIDER}\n\n` +
                lines.join('\n') +
                `\n\n${config.DIVIDER}\n` +
                `_Sky Graphics — ${config.GAME_NAME}_`
        })
        return true
    }

    await sendSafeMessage(sock, replyTo, {
        text: `⚠️ *Unknown command.* Try \`${config.ADMIN_PREFIX}help\`.`
    })
    return true
}

module.exports = { handleAdminCommand }
