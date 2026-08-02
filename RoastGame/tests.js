// ============================================================
//  RoastGame/tests.js — Roast Game · Sky Graphics
//  Behavioral (runtime) tests — see WordClimbGame/tests.js header
//  for why this layer exists alongside scripts/verify-games.js.
//
//  The single most important test in this file is the group/DM
//  privacy gate: RoastGame's entire pitch is "private, DM-delivered
//  roasts," and the original codebase had ZERO enforcement of that —
//  "!roast me"/"savage" fired the private roast card straight into
//  a group if typed there (SESSION_HANDOFF.md §2, "the most severe
//  finding"). This file locks that fix in permanently.
//
//  Run standalone:  node RoastGame/tests.js
//  Run with every game: node scripts/run-tests.js
// ============================================================

const { makeCtx, run, assert, assertEqual, report, resetCounts } = require('../scripts/tests/_harness')
const config = require('./config')
const publicCommands = require('./publicCommands')

const GROUP_JID = '123456789-987654321@g.us'
const DM_JID    = '15550001111@s.whatsapp.net'

async function main() {
    resetCounts()
    console.log('RoastGame — behavioral tests')

    // ── THE flagship regression test ────────────────────────────────
    await run('"!roast me" in a GROUP never leaks a roast card into the group', async () => {
        const ctx = makeCtx({ body: `${config.PREFIX} me`, from: GROUP_JID })

        const handled = await publicCommands.handlePublicMessage(ctx)

        assert(handled === true, 'Expected the message to be marked handled')
        assertEqual(ctx.sentMessages.length, 1, 'Expected exactly one reply (the redirect), not a leaked roast card')
        assert(ctx.sentMessages[0].chatId === GROUP_JID, 'Redirect should go back into the group, not a DM')
        assert(ctx.sentMessages[0].text.includes('private'), `Expected the private/redirect message, got: "${ctx.sentMessages[0].text}"`)
        assert(!ctx.sentMessages[0].text.match(/floor|variation/i), 'Reply appears to contain actual roast content — privacy gate did not hold')
    })

    await run('"!roast savage again" in a GROUP also gets redirected, not delivered', async () => {
        const ctx = makeCtx({ body: `${config.PREFIX} savage again`, from: GROUP_JID })

        await publicCommands.handlePublicMessage(ctx)

        assertEqual(ctx.sentMessages.length, 1, 'Expected exactly one reply (the redirect)')
        assert(ctx.sentMessages[0].text.includes('private'), 'Expected the group redirect text for "savage" too, not just "me"')
    })

    // ── Companion test: DM path is NOT blocked by the same gate ────
    // (proves the fix gates on chat type, not on the command itself)
    await run('"!roast me" in a DM is not blocked by the group gate', async () => {
        const ctx = makeCtx({ body: `${config.PREFIX} me`, from: DM_JID, senderNumber: '19998887777', senderName: 'Nobody Real' })

        await publicCommands.handlePublicMessage(ctx)

        const redirected = ctx.sentMessages.some(m => m.text.includes("That one's private"))
        assert(!redirected, 'DM request should never hit the group-redirect branch')
        // No profile exists for this fake sender, so the honest outcome
        // here is the "no roast on file" message, not a redirect — that
        // distinction is the whole point of this test.
        assert(ctx.sentMessages.length === 1, 'Expected exactly one reply for a DM request')
    })

    // ── Unknown public subcommand replies with help (already correct
    // pre-fix, locked in as a cross-game consistency guard — this is
    // the pattern Hangman/WordClimb's public handlers were fixed to
    // match) ─────────────────────────────────────────────────────────
    await run('unrecognized !roast subcommand replies with help, not silence', async () => {
        const ctx = makeCtx({ body: `${config.PREFIX} boguscommand`, from: DM_JID })

        const handled = await publicCommands.handlePublicMessage(ctx)

        assert(handled === true, 'Expected the message to be marked handled')
        assert(ctx.sentMessages.length > 0, 'Unrecognized !roast subcommand produced zero replies')
    })

    // ── Bare command works in a group too (explainer only, never
    // stateful — ARCHITECTURE.md §9 — so it's exempt from the gate) ──
    await run('bare "!roast" in a GROUP shows the explainer, not a redirect or a roast', async () => {
        const ctx = makeCtx({ body: config.PREFIX, from: GROUP_JID })

        await publicCommands.handlePublicMessage(ctx)

        assertEqual(ctx.sentMessages.length, 1, 'Expected exactly one reply')
        assert(!ctx.sentMessages[0].text.includes("That one's private"), 'Bare command should show the explainer, not the group-redirect text (the explainer legitimately mentions "private" too, so check the specific redirect phrase)')
    })

    return report('RoastGame')
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1))
}

module.exports = { main }
