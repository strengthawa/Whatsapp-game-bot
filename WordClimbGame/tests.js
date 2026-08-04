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
const matchSummary = require('./matchSummary')

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

    // ── Turn timer shrinks with length, following the curve exactly ──
    // (the assumption behind "the timer shrinks as you climb" — if this
    // silently stopped scaling, nothing else would catch it) ──────────
    await run('turnSecondsFor() gives TURN_SECONDS_START at MIN_LENGTH and TURN_SECONDS_FLOOR at MAX_LENGTH', async () => {
        const gameState = engine.freshState()
        const settings = { creatorOverrides: {} }

        gameState.currentLength = config.MIN_LENGTH
        assertEqual(engine.turnSecondsFor(gameState, settings), config.TURN_SECONDS_START,
            'Expected the full starting time at the easiest (shortest) length')

        gameState.currentLength = config.MAX_LENGTH
        assertEqual(engine.turnSecondsFor(gameState, settings), config.TURN_SECONDS_FLOOR,
            'Expected the timer floor at the hardest (longest) length')
    })

    // ── An admin's fixed override must win outright over the curve —
    // this is the back-compat contract for the existing /wcl
    // setturnseconds command ───────────────────────────────────────
    await run('a fixed /wcl setturnseconds override replaces the shrink curve entirely', async () => {
        const gameState = engine.freshState()
        gameState.currentLength = config.MAX_LENGTH // would be the floor under the curve
        const settings = { creatorOverrides: {}, [`${config.GAME_KEY}_turnSeconds`]: 50 }
        assertEqual(engine.turnSecondsFor(gameState, settings), 50,
            'A fixed override must be used as-is, ignoring currentLength entirely')
    })

    // ── The actual bug this session found: a winner's bestLength is
    // NOT guaranteed to be the match's longest word — an eliminated
    // player can hold that record. buildFinalBoard() must track it
    // independently of who wins, not derive it from the winner. ──────
    await run('longest word of the match is credited correctly even when the winner never held it', async () => {
        const gameState = engine.freshState()
        gameState.players = ['winner-num']
        gameState.playerNames = { 'winner-num': 'Quiet Winner', 'out-num': 'Early Achiever' }
        gameState.bestLength = { 'winner-num': 0, 'out-num': 5 }
        gameState.strikes = { 'winner-num': 0, 'out-num': 3 }
        gameState.answerTimeMs = { 'winner-num': 500, 'out-num': 1000 }
        gameState.longestWord = { word: 'apple', length: 5, number: 'out-num' }
        gameState.eliminated = [{
            number: 'out-num', name: 'Early Achiever', reason: 'wrong_guess',
            atLength: 5, bestLength: 5, order: 1
        }]
        gameState.usedWords = {}
        gameState.matchStartedAt = Date.now() - 1000

        const rep = matchSummary.buildFinalBoard(gameState, 'winner-num', 'last_standing')

        assert(rep.winner.bestLength < rep.longestWord.length,
            'Test setup should reflect the winner NOT holding the record — otherwise this test proves nothing')
        assertEqual(rep.longestWord.name, 'Early Achiever',
            'Longest word must credit whoever actually achieved it, not be derived from the winner')

        const text = matchSummary.renderFinalBoardText(rep)
        assert(text.includes('Early Achiever'), 'Final board text must name the longest-word holder even though they lost')
        assert(text.includes('Disqualified (1)'), 'Final board text must show the disqualified count')
    })

    // ── Cross-match leaderboard: wins/losses/streak persist across
    // matches, and the personal-best column shows even for a losing
    // player — the "pairing" requested alongside the leaderboard ────
    await run('recordMatchResult() accumulates wins/losses/streak across matches, independent of any single match state', async () => {
        const kernel = require('../gameKernel')
        const games = {}
        kernel.recordMatchResult(games, config.GAME_KEY, 'lb-chat', [
            { number: 'a', name: 'Ama', won: true,  statValue: 5 },
            { number: 'b', name: 'Bobo', won: false, statValue: 3 }
        ], (x, y) => x > y)
        kernel.recordMatchResult(games, config.GAME_KEY, 'lb-chat', [
            { number: 'a', name: 'Ama', won: false, statValue: 4 },
            { number: 'b', name: 'Bobo', won: true,  statValue: 7 }
        ], (x, y) => x > y)

        const board = kernel.getLeaderboard(games, config.GAME_KEY, 'lb-chat')
        assertEqual(board.a.wins, 1, 'Ama should have 1 win across the two matches')
        assertEqual(board.a.losses, 1, 'Ama should have 1 loss across the two matches')
        assertEqual(board.a.bestStatValue, 5, "Ama's personal best should stay 5 (higher than her second match's 4), not get overwritten by a worse result")
        assertEqual(board.b.bestStatValue, 7, "Bobo's personal best should update to 7 once he beats his earlier 3")

        const text = kernel.renderLeaderboardText(games, config.GAME_KEY, 'lb-chat', { statLabel: 'L' })
        assert(text.includes('Ama'), 'Leaderboard text must show every tracked player, not just the current top')
        assert(text.includes('Bobo'), 'Leaderboard text must show every tracked player, not just the current top')
    })

    // ── Regression: required length is a MINIMUM, not exact ──────
    // isValidWord() used to reject any word whose length wasn't an
    // exact match to the rung — a longer real word (e.g. "orange" at
    // a 3-letter rung) was wrongly rejected as if it weren't a real
    // word at all, when it just exceeded the minimum. Also confirms
    // the dictionary lookup uses the WORD's own length, not the rung.
    await run('isValidWord() accepts a real word longer than the required minimum', async () => {
        const wordBank = require('./wordBank')
        const longWord = wordBank.lettersWithWordsAt(6)[0]
        assert(longWord, 'Test assumes at least one 6-letter starting letter exists in the dictionary')
        const sample = wordBank.DICTIONARY[6][longWord][0]

        assert(wordBank.isValidWord(sample, 3, longWord, []), `"${sample}" is a real ${sample.length}-letter word starting with "${longWord}" — it must satisfy a 3-letter-MINIMUM rung, not be rejected for not being exactly 3`)
        assert(!wordBank.isValidWord(sample, sample.length + 1, longWord, []), 'The same word must still fail a rung that requires MORE letters than it has')
    })

    // ── Regression: turns must show periodic "Xs left" ticks ──────
    // The turn timer used to fire once, silently, after the full
    // duration — no feedback in between. Now it should post a
    // "seconds left" update every 5s.
    await run('an active turn posts a "seconds left" tick every 5s', async () => {
        const chatId = 'test-chat-tick@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['15551111111']
        gameState.playerNames = { '15551111111': 'Ama' }
        gameState.playerJids = { '15551111111': '15551111111@s.whatsapp.net' }
        gameState.active = true
        gameState.turnOrder = ['15551111111']
        gameState.turnIndex = 0
        gameState.currentPlayer = '15551111111'
        gameState.currentLetter = 'd'
        gameState.currentLength = config.MIN_LENGTH
        gameState.strikes = { '15551111111': 0 }
        gameState.turnSecondsLeft = 6

        await engine.tickTurnTimer(chatId, ctx) // 6 -> 5, a tick multiple of 5
        const tick = ctx.sentMessages.find(m => /left/.test(m.text))
        assert(tick, `Expected a "seconds left" tick message at 5s remaining. Sent: ${JSON.stringify(ctx.sentMessages.map(m => m.text))}`)
        assert(tick.text.includes('5s'), `Tick message should report 5s left, got: "${tick.text}"`)
    })

    return report('WordClimbGame')
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1))
}

module.exports = { main }
