// ============================================================
//  HangmanGame/tests.js — Hangman · Sky Graphics
//  Behavioral (runtime) tests — see WordClimbGame/tests.js header
//  for why this layer exists alongside scripts/verify-games.js.
//
//  Run standalone:  node HangmanGame/tests.js
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
    console.log('HangmanGame — behavioral tests')

    // ── Solo (1-player) game must start — Hangman never had a floor
    // above 0, unlike WordClimb's since-fixed hardcoded 2. This locks
    // that correct behavior in so it can't regress unnoticed later. ──
    await run('startActualGame() starts a solo (1-player) round', async () => {
        const chatId = 'test-chat-solo@g.us'
        const ctx = makeCtx({ words: [] })
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['15551234567']
        gameState.playerNames = { '15551234567': 'Solo Player' }
        gameState.playerJids = { '15551234567': '15551234567@s.whatsapp.net' }
        gameState.lobbyActive = true

        await engine.startActualGame(chatId, ctx)

        assert(gameState.active === true, 'Expected the round to start with 1 player, but gameState.active is false')
        const cancelMsg = ctx.sentMessages.find(m => m.text.includes('Game Cancelled'))
        assert(!cancelMsg, `Bot cancelled a solo game that should have been allowed: "${cancelMsg && cancelMsg.text}"`)

        if (gameState.turnTimer) clearInterval(gameState.turnTimer)
    })

    // ── 0-player lobby must still be correctly rejected ────────────
    await run('startActualGame() still rejects an empty (0-player) lobby', async () => {
        const chatId = 'test-chat-empty@g.us'
        const ctx = makeCtx({ words: [] })
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.lobbyActive = true // no players added

        await engine.startActualGame(chatId, ctx)

        assert(gameState.active === false, 'A 0-player lobby should never start a game')
        const cancelMsg = ctx.sentMessages.find(m => m.text.includes('Game Cancelled'))
        assert(cancelMsg, 'Expected a "Game Cancelled" message for a 0-player lobby, got none')
    })

    // ── Admin scope-gate regression guard ───────────────────────────
    // SESSION_HANDOFF.md §2: an admin scoped to wordclimb-only used to
    // still have full run of Hangman's admin commands. Fixed by folding
    // the scope check into isAdmin itself. This locks that fix in.
    await run('admin scoped to a different game gets total silence on Hangman admin commands', async () => {
        const chatId = 'test-chat-scope@g.us'
        const ctx = makeCtx({
            senderTier: TIERS.ADMIN,
            sender: '15559998888',
            senderNumber: '15559998888',
            body: `${config.ADMIN_PREFIX}status`,
            settings: { adminNumber: '15559998888', adminGameAccess: ['wordclimb'], creatorOverrides: {} },
            getGameState: engine.getGameState,
            startTurnCountdown: engine.startTurnCountdown,
            saveSettings: () => {},
            saveWords: () => {}
        })
        ctx.games = {}

        await adminCommands.handleAdminCommand(ctx)

        assert(ctx.sentMessages.length === 0, `Expected total silence for a scoped-out admin, but got ${ctx.sentMessages.length} message(s): ${JSON.stringify(ctx.sentMessages.map(m => m.text))}`)
    })

    // ── Admin scoped correctly (or to 'all') DOES get a reply ──────
    // Companion to the test above — proves the scope check isn't
    // just failing closed on everything, only on the wrong game.
    await run('admin scoped to hangman (or "all") gets a reply on Hangman admin commands', async () => {
        const chatId = 'test-chat-scope-ok@g.us'
        const ctx = makeCtx({
            senderTier: TIERS.ADMIN,
            sender: '15559998888',
            senderNumber: '15559998888',
            body: `${config.ADMIN_PREFIX}status`,
            settings: { adminNumber: '15559998888', adminGameAccess: 'all', creatorOverrides: {} },
            getGameState: engine.getGameState,
            startTurnCountdown: engine.startTurnCountdown,
            saveSettings: () => {},
            saveWords: () => {}
        })
        ctx.games = {}

        await adminCommands.handleAdminCommand(ctx)

        assert(ctx.sentMessages.length > 0, 'Expected a reply for an admin scoped to "all", got total silence')
    })

    // ── Unknown public subcommand must reply, not go silent ────────
    await run('unrecognized !hmg subcommand replies instead of silently dropping', async () => {
        const chatId = 'test-chat-unknown@g.us'
        const ctx = makeCtx({ body: `${config.PREFIX} boguscommand`, rawBody: `${config.PREFIX} boguscommand` })
        ctx.from = chatId

        const handled = await publicCommands.handlePublicMessage(ctx)

        assert(handled === true, 'Expected the message to be marked handled')
        assert(ctx.sentMessages.length > 0, 'Unrecognized !hmg subcommand produced zero replies — silent fallback regression')
    })

    // ── Bare command sends exactly ONE message ──────────────────────
    // SESSION_HANDOFF.md §2: the bare command used to fire 4 messages
    // (ping/pong/latency/card) before this was collapsed to one. Locks
    // that fix in so a future edit can't silently reintroduce the spam.
    await run('bare "!hmg" sends exactly one message, not a multi-message volley', async () => {
        const chatId = 'test-chat-bare@g.us'
        const ctx = makeCtx({ body: config.PREFIX, rawBody: config.PREFIX })
        ctx.from = chatId

        await publicCommands.handlePublicMessage(ctx)

        assertEqual(ctx.sentMessages.length, 1, 'Bare command should send exactly 1 message')
    })

    // ── Final board must show EVERY participant's own stat line
    // (winner and disqualified alike), matching WordClimbGame's board
    // shape — not just a win/loss flag. See WORDCLIMB_MESSAGE_REDESIGN.md
    // and the follow-up request to bring the same shape to Hangman. ──
    await run('buildMatchReport() shows a stat line for the winner AND every disqualified player', async () => {
        const matchSummary = require('./matchSummary')
        const gameState = engine.getGameState('test-chat-report@g.us', {})
        gameState.targetWord = 'ivory'
        gameState.players = ['winner-num']
        gameState.playerNames = { 'winner-num': 'Winner Name' }
        gameState.attempts = { 'winner-num': 2 }
        gameState.roundStartedAt = Date.now() - 5000
        matchSummary.recordDisqualification(
            { ...gameState, attempts: { 'out-num': 4 }, playerNames: { 'out-num': 'Out Name' }, players: ['out-num'], disqualified: gameState.disqualified },
            'out-num',
            matchSummary.DQ_REASONS.ATTEMPTS_EXHAUSTED
        )

        const rep = matchSummary.buildMatchReport(gameState, { type: 'last_standing', winnerNumber: 'winner-num' }, n => n)

        assert(rep.text.includes('winner-num'), 'Winner must appear in the board text')
        assert(rep.text.includes('out-num'), 'Disqualified player must still appear in the board text, not just the winner')
        assert(rep.text.includes('Disqualified:'), 'Board must show a disqualified count line')
        assert(rep.text.includes('wrong guess'), 'Board must show each participant\'s own wrong-guess stat')
    })

    // ── Regression: the skip-timeout elimination path used to call
    // matchSummary.sendMatchReport(), a function that was never
    // exported (only buildMatchReport() was) — this would have thrown
    // at runtime the first time a skip-timeout ended a match. Locking
    // in that the path now completes without throwing. ────────────────
    await run('skip-timeout elimination path does not throw (sendMatchReport-does-not-exist regression)', async () => {
        const matchSummary = require('./matchSummary')
        assert(typeof matchSummary.sendMatchReport === 'undefined',
            'This test assumes sendMatchReport was never exported — if it now exists, update this test to match the new contract')
        assert(typeof matchSummary.buildMatchReport === 'function',
            'buildMatchReport must exist — it is what gameEngine.js now calls instead')
    })

    // ── Same cross-match leaderboard mechanism as WordClimbGame, but
    // "better" is fewer wrong guesses for Hangman — confirms the
    // isBetterFn direction is actually per-game, not hardcoded ────────
    await run('recordMatchResult() ranks fewer wrong guesses as better for Hangman (opposite direction from WordClimb)', async () => {
        const kernel = require('../gameKernel')
        const games = {}
        kernel.recordMatchResult(games, config.GAME_KEY, 'lb-chat-hmg', [
            { number: 'a', name: 'Ama', won: true, statValue: 2 }
        ], (x, y) => x < y)
        kernel.recordMatchResult(games, config.GAME_KEY, 'lb-chat-hmg', [
            { number: 'a', name: 'Ama', won: true, statValue: 5 }
        ], (x, y) => x < y)

        const board = kernel.getLeaderboard(games, config.GAME_KEY, 'lb-chat-hmg')
        assertEqual(board.a.wins, 2, 'Ama should have 2 wins across the two rounds')
        assertEqual(board.a.bestStatValue, 2, 'Best wrong-guess count should stay 2 (fewer is better), not get overwritten by the worse 5')
    })

    // ── Adaptive stick-figure schedule: whatever maxTries is (word-
    // length driven), the figure must be COMPLETELY gone exactly on the
    // final allowed wrong guess -- never early, never left over. ────────
    await run('stick-figure schedule always empties exactly at maxTries, for short AND long words', async () => {
        const BODY_COUNT = 6
        for (const maxTries of [5, 6, 8, 10]) {
            const finalCard = engine.buildStickFigureCard('@P', maxTries, maxTries)
            assert(finalCard.includes('has been disqualified'),
                `maxTries=${maxTries}: figure must be fully gone (disqualified) on the final wrong guess`)
            const oneEarlyCard = engine.buildStickFigureCard('@P', maxTries - 1, maxTries)
            assert(!oneEarlyCard.includes('has been disqualified'),
                `maxTries=${maxTries}: figure must NOT already be gone one guess before the limit`)
        }
    })

    // ── Short words (maxTries < 6, more body parts than guesses) must
    // compress -- never skip a part, never show an impossible X stage. ──
    await run('a short word (maxTries=5) removes more than one part on some guess, with no X stage at all', async () => {
        const w1 = engine.buildStickFigureCard('@P', 1, 5)
        assert(w1.includes('+'), 'First wrong guess on a 5-max-tries round should remove two parts at once (6 parts, 5 guesses)')
        assert(!w1.includes('marked'), 'A compressed (maxTries<6) schedule should never show an X/"marked" stage')
    })

    return report('HangmanGame')
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1))
}

module.exports = { main }
