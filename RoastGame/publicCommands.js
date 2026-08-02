// ============================================================
//  RoastGame/publicCommands.js — Roast Game · Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !roast              — explainer card (never stateful — see
//                           ARCHITECTURE.md §9, bare-acronym rule)
//    !roast help         — same as bare
//    !roast me           — nice-tier roast, variation A     (DM)
//    !roast me again     — nice-tier roast, variation B     (DM)
//    !roast savage       — savage-tier roast, variation A   (DM)
//    !roast savage again — savage-tier roast, variation B   (DM)
//
//  There is no live round, no lobby, no turn — every roast
//  request is a single stateless lookup into roastData.js.
//  Admin "/roast list" lives in adminCommands.js.
// ============================================================

const config = require('./config')
const engine = require('./gameEngine')
const kernel = require('../gameKernel')

// TODO(kernel): group-vs-DM detection is a generic message-shape concern,
// not specific to RoastGame. When the shared kernel module is extracted,
// move this to that module so every game can gate on it, not just this one.
function isGroupChat(jid) {
    return typeof jid === 'string' && jid.endsWith('@g.us')
}

const GROUP_REDIRECT_TEXT =
    `🔒 *That one's private.*\n` +
    `DM me *${config.PREFIX} me* or *${config.PREFIX} savage* — nothing posts here. 🤐`

// Was a module-level constant — kernel.botIdentityLine() only ran once,
// at process startup, freezing the identity line for the bot's entire
// lifetime. Now a function, built fresh per request.
function buildHelpText(receivedAt) {
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n` +
        `🤖 ${kernel.botIdentityLine(receivedAt)}\n` +
        `${config.DIVIDER}\n\n` +
        `Your roast is 100% private — nobody in this group sees it unless ` +
        `you choose to screenshot and post it yourself.\n\n` +
        `*🎮 How to get yours:*\n` +
        `DM me directly (not in this group) with:\n` +
        `1️⃣ *${config.PREFIX} me* — a nice roast\n` +
        `2️⃣ *${config.PREFIX} me again* — a second nice one\n` +
        `3️⃣ *${config.PREFIX} savage* — the dirty version\n` +
        `4️⃣ *${config.PREFIX} savage again* — a second dirty one\n\n` +
        `${config.DIVIDER}\n` +
        `_Sky Graphics — ${config.GAME_NAME}_ 😁`
    )
}

const NO_PROFILE_TEXT =
    `😅 *No roast on file for you yet.*\n\n` +
    `Roast profiles are hand-built from the group's chat history — ` +
    `if you're not in the current batch, there isn't one to pull yet.`

function buildRoastCard(profile, tierLabel, variationText) {
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *Your Roast — ${tierLabel}*\n` +
        `${config.DIVIDER}\n\n` +
        `${profile.floor}\n\n` +
        `${variationText}\n\n` +
        `${config.DIVIDER}\n` +
        `_Screenshot this and drop it in the group if you dare_ 😁\n` +
        `_Sky Graphics — ${config.GAME_NAME}_`
    )
}

async function deliverRoast(sock, from, profile, tier, wantsAgain) {
    const variations = tier === 'savage' ? profile.savage : profile.nice
    const tierLabel   = tier === 'savage' ? 'Savage 🔥' : 'Nice 😊'

    let index = wantsAgain ? 1 : 0
    let note  = ''
    if (index >= variations.length) {
        index = variations.length - 1
        if (wantsAgain) note = `\n\n_(That's the only ${tier} one I've got for you right now 😅)_`
    }

    const card = buildRoastCard(profile, tierLabel, variations[index] + note)
    await sock.sendMessage(from, { text: card })
}

async function handlePublicMessage(msgCtx) {
    const {
        sock, nameCache, from, body, senderNumber, senderName, receivedAt
    } = msgCtx

    if (!body.startsWith(config.PREFIX)) return false

    // ── Bare "!roast" (or "!roast help") = explainer only, NEVER
    // stateful (ARCHITECTURE.md §9) — true even inside a DM. ──────
    const rest = body.slice(config.PREFIX.length).trim()
    const parts = rest.length ? rest.split(/\s+/) : []
    const subCmd = parts[0]

    if (!subCmd || subCmd === 'help') {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt) })
        return true
    }

    if (subCmd !== 'me' && subCmd !== 'savage') {
        await sock.sendMessage(from, { text: buildHelpText(receivedAt) })
        return true
    }

    // ── Privacy gate: 'me'/'savage' NEVER deliver into a group chat. ──
    // This is the actual guarantee the README/help text advertises —
    // it must be enforced here, not just claimed in copy. No roast
    // lookup happens at all for a group invocation; the group only
    // ever sees the redirect line, never a "no profile" leak either.
    if (isGroupChat(from)) {
        await sock.sendMessage(from, { text: GROUP_REDIRECT_TEXT })
        return true
    }

    const wantsAgain = parts[1] === 'again'
    const tier = subCmd === 'me' ? 'nice' : 'savage'

    const profile = engine.resolveProfileForSender(senderNumber, senderName, nameCache)
    if (!profile) {
        await sock.sendMessage(from, { text: NO_PROFILE_TEXT })
        return true
    }

    await deliverRoast(sock, from, profile, tier, wantsAgain)
    return true
}

module.exports = { handlePublicMessage }
