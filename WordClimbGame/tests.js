// ============================================================
//  WordClimbGame/tests.js — Word Climb · Sky Graphics
//  Behavioral (runtime) tests — simulates real command sequences
//  and asserts on the resulting game state / replies, unlike
//  scripts/verify-games.js which only checks static wiring.
//
//  Written specifically after the solo-lobby bug (SESSION_HANDOFF.md
//  §"Testing architecture"): config.MIN_PLAYERS_TO_BEGIN was set to 1
//  and the admin-side pre-check in adminCommands.js honored it, but
//  gameEngine.js's closeLobbyAndStart() had its own hardcoded `< 2`
//  that silently overrode it — both the manual "/wcl begin" path and
//  the natural lobby-timer-expiry path were broken, and no existing
//  test caught it because verify-games.js never simulates a lobby
//  actually running.
//
//  Run standalone:  node WordClimbGame/tests.js
//  Run with every game: node scripts/run-tests.js
// ============================================================

const { makeCtx, run, assert, assertEqual, report, resetCounts } = require('../scripts/tests/_harness')
const { TIERS } = require('../permissions')
const config = require('./config')
const engine = require('./gameEngine')
const adminCommands = require('./adminCommands')
const publicCommands = require('./publicCommands')

async function main() {
    resetCounts()
    console.log('WordClimbGame — behavioral tests')

    // ── The regression itself: solo lobby via the ENGINE directly ──
    // (this is the function both the manual and automatic paths funnel
    // through — see closeLobbyAndStart in gameEngine.js) ────────────
    await run('closeLobbyAndStart() starts a solo (1-player) climb when MIN_PLAYERS_TO_BEGIN is 1', async () => {
        assertEqual(config.MIN_PLAYERS_TO_BEGIN, 1, 'This test assumes the project is configured for solo play — update the test if that config value is intentionally changed')

        const chatId = 'test-chat-solo-engine@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        engine.addToLobby(gameState, '15551234567', 'Solo Player', '15551234567@s.whatsapp.net')
        gameState.lobbyActive = true

        await engine.closeLobbyAndStart(chatId, ctx)

        assert(gameState.active === true, 'Expected the climb to actually start with 1 player, but gameState.active is false')
        assert(gameState.lobbyActive === false, 'Lobby should be closed once the climb starts')
        const cancelMsg = ctx.sentMessages.find(m => m.text.includes('Not enough players'))
        assert(!cancelMsg, `Bot sent a "not enough players" cancellation even though the floor is ${config.MIN_PLAYERS_TO_BEGIN}: "${cancelMsg && cancelMsg.text}"`)

        engine.clearTimers(gameState) // don't leave a live turn timer running past the test
    })

    // ── The regression, through the ACTUAL admin command path ──────
    // (adminCommands.js's own pre-check + the engine call it makes —
    // this is what a real "/wcl begin" message triggers end to end) ──
    await run('/wcl begin (admin) starts a solo climb, not just passes its own pre-check', async () => {
        const chatId = 'test-chat-solo-admin@g.us'
        const ctx = makeCtx({
            senderTier: TIERS.CREATOR,
            sender: '15551234567',
            body: `${config.ADMIN_PREFIX}begin`
        })
        ctx.activeGameChatRef.value = chatId
        const gameState = engine.getGameState(chatId, ctx.games)
        engine.addToLobby(gameState, '15551234567', 'Solo Player', '15551234567@s.whatsapp.net')
        gameState.lobbyActive = true

        const handled = await adminCommands.handleAdminCommand(ctx)

        assert(handled === true, 'Expected /wcl begin to be recognized and handled')
        assert(gameState.active === true, 'Expected the climb to start; the admin-side pre-check alone is not sufficient proof — this is exactly how the original bug hid')
        const lastMsg = ctx.sentMessages[ctx.sentMessages.length - 1]
        assert(!lastMsg.text.includes('Need at least'), `Admin got a "need at least N players" reply despite passing the same floor: "${lastMsg.text}"`)

        engine.clearTimers(gameState)
    })

    // ── Natural (automatic) lobby-timer-expiry path, not just the
    // manual /wcl begin shortcut — these are two different call
    // sites into the same closeLobbyAndStart(), both must agree ──────
    await run('lobby-timer expiry also starts a solo climb (not just manual /wcl begin)', async () => {
        const chatId = 'test-chat-solo-timer@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        engine.addToLobby(gameState, '15551234567', 'Solo Player', '15551234567@s.whatsapp.net')
        gameState.lobbyActive = true
        gameState.lobbySecondsLeft = 0

        // Same function the setInterval in startLobbyCountdown calls
        // once lobbySecondsLeft hits 0 — invoked directly here so the
        // test doesn't have to wait on a real 1-second interval.
        await engine.closeLobbyAndStart(chatId, ctx)

        assert(gameState.active === true, 'Timer-expiry path did not start the climb with 1 player')
        engine.clearTimers(gameState)
    })

    // ── Unknown public subcommand must reply, not go silent ────────
    await run('unrecognized !wcl subcommand replies instead of silently dropping', async () => {
        const chatId = 'test-chat-unknown@g.us'
        const ctx = makeCtx({ body: `${config.PREFIX} boguscommand`, rawBody: `${config.PREFIX} boguscommand` })
        ctx.from = chatId

        const handled = await publicCommands.handlePublicMessage(ctx)

        assert(handled === true, 'Expected the message to be marked handled')
        assert(ctx.sentMessages.length > 0, 'Unrecognized !wcl subcommand produced zero replies — silent fallback regression')
    })

    // ── 0-player lobby must still be correctly rejected — the fix
    // must not have widened the floor into "any number, including 0" ──
    await run('closeLobbyAndStart() still rejects an empty (0-player) lobby', async () => {
        const chatId = 'test-chat-empty@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.lobbyActive = true // no players added

        await engine.closeLobbyAndStart(chatId, ctx)

        assert(gameState.active === false, 'A 0-player lobby should never start a climb')
        const cancelMsg = ctx.sentMessages.find(m => m.text.includes('Not enough players'))
        assert(cancelMsg, 'Expected a "not enough players" message for a 0-player lobby, got none')
    })

    return report('WordClimbGame')
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1))
}

module.exports = { main }
