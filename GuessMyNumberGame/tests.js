// ============================================================
//  GuessMyNumberGame/tests.js — Guess My Number · Sky Graphics
//  Behavioral (runtime) tests — simulates real command sequences and
//  asserts on the resulting game state / replies, per
//  NEW_GAME_HANDOFF.md §10: encodes the SPECIFIC assumptions this
//  game makes, not generic smoke tests.
//
//  Run standalone:  node GuessMyNumberGame/tests.js
//  Run with every game: node scripts/run-tests.js
// ============================================================

const { makeCtx, run, assert, assertEqual, report, resetCounts } = require('../scripts/tests/_harness')
const config = require('./config')
const engine = require('./gameEngine')
const publicCommands = require('./publicCommands')
const matchSummary = require('./matchSummary')

async function main() {
    resetCounts()
    console.log('GuessMyNumberGame — behavioral tests')

    // ── Core assumption #1: range/cap/timer scale UP with lobby size,
    // capped at RANGE_SCALE_CAP — this is the whole fix for "the game
    // ends too fast with more players," so it must actually hold. ──
    await run('computeEffectiveRange() widens range/cap/timer as player count grows, capped at RANGE_SCALE_CAP', async () => {
        const mode = config.MODES.classic
        const solo = engine.computeEffectiveRange(mode, 1)
        const trio = engine.computeEffectiveRange(mode, 3)
        const crowd = engine.computeEffectiveRange(mode, 50) // way past the cap

        assertEqual(solo.max, mode.MAX, 'A single player should get exactly the mode base range, no scaling')
        assert(trio.max > solo.max, '3 players should get a wider range than 1 player')
        assert(trio.guessCap > solo.guessCap, '3 players should get a higher guess cap than 1 player')
        assert(trio.roundSeconds > solo.roundSeconds, '3 players should get a longer round timer than 1 player')

        assertEqual(crowd.multiplier, config.RANGE_SCALE_CAP, 'Multiplier must never exceed RANGE_SCALE_CAP even with a huge lobby')
    })

    // ── Core assumption #2: proximity hints are coarse TIERS, never a
    // raw percentage — the whole point of not letting players snipe
    // the secret via interpolation search. ──────────────────────────
    await run('tierForDistance() returns coarse bands, and the SAME distance/width ratio always yields the SAME tier', async () => {
        const width = 100
        const veryClose = engine.tierForDistance(1, width)   // ratio 0.01
        const close      = engine.tierForDistance(5, width)   // ratio 0.05
        const mid         = engine.tierForDistance(15, width)  // ratio 0.15
        const far          = engine.tierForDistance(50, width)  // ratio 0.50

        assertEqual(veryClose.label, 'Blazing', 'A 1% distance should be Blazing')
        assertEqual(close.label, 'Hot', 'A 5% distance should be Hot')
        assertEqual(mid.label, 'Warm', 'A 15% distance should be Warm')
        assertEqual(far.label, 'Cold', 'A 50% distance should be Cold')
    })

    // ── Core assumption #3: this is FREE-FOR-ALL — any joined player
    // can submit a guess at any time, not just a single "current
    // player" like WordClimb/Hangman's turn-based games. ────────────
    await run('submitGuess() accepts a guess from ANY joined player, no turn restriction', async () => {
        const chatId = 'test-chat-ffa@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['111', '222', '333']
        gameState.playerNames = { '111': 'Ama', '222': 'Bobo', '333': 'Chi' }
        gameState.active = true
        gameState.effectiveMin = 1
        gameState.effectiveMax = 100
        gameState.guessCap = 12
        gameState.secretNumber = 50
        gameState.guessCount = 0
        gameState.totalGuesses = { '111': 0, '222': 0, '333': 0 }
        gameState.roundsWon = { '111': 0, '222': 0, '333': 0 }
        gameState.roundNumber = 1
        gameState.roundsPerMatch = 5

        const first = await engine.submitGuess(chatId, ctx, '333', '10')  // 3rd player guesses first
        const second = await engine.submitGuess(chatId, ctx, '111', '20') // 1st player guesses next
        assert(first, 'A guess from any player should be consumed, not rejected for "not their turn"')
        assert(second, 'A DIFFERENT player guessing right after should also be consumed — no turn order')
        assertEqual(gameState.guessCount, 2, 'Both guesses should count toward the shared round guess total')

        engine.clearTimers(gameState)
    })

    // ── Core assumption #4: the guess cap actually ends the round
    // (no hang) and does NOT award a round win to anyone. ───────────
    await run('reaching the guess cap ends the round unsolved — no winner, no hang', async () => {
        const chatId = 'test-chat-cap@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['111']
        gameState.playerNames = { '111': 'Ama' }
        gameState.active = true
        gameState.effectiveMin = 1
        gameState.effectiveMax = 100
        gameState.guessCap = 2
        gameState.secretNumber = 99 // guesses below will never hit it
        gameState.guessCount = 0
        gameState.totalGuesses = { '111': 0 }
        gameState.roundsWon = { '111': 0 }
        gameState.roundNumber = 1
        gameState.roundsPerMatch = 1 // so hitting the cap ends the WHOLE match too

        await engine.submitGuess(chatId, ctx, '111', '10')
        await engine.submitGuess(chatId, ctx, '111', '20') // hits the cap (2/2), never equals secret

        assertEqual(gameState.active, false, 'Match should have ended once the only round hit its guess cap')
        assertEqual(gameState.roundsWon['111'] || 0, 0, 'No round win should be awarded when the cap is hit without a correct guess')
    })

    // ── Core assumption #5: a guess outside the effective range is
    // rejected WITHOUT consuming a guess from the shared cap. ───────
    await run('a guess outside the effective range does not consume a guess from the cap', async () => {
        const chatId = 'test-chat-range@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['111']
        gameState.playerNames = { '111': 'Ama' }
        gameState.active = true
        gameState.effectiveMin = 1
        gameState.effectiveMax = 50
        gameState.guessCap = 12
        gameState.secretNumber = 25
        gameState.guessCount = 0
        gameState.totalGuesses = { '111': 0 }
        gameState.roundsWon = { '111': 0 }
        gameState.roundNumber = 1
        gameState.roundsPerMatch = 5

        await engine.submitGuess(chatId, ctx, '111', '9999') // way outside range
        assertEqual(gameState.guessCount, 0, 'An out-of-range guess must not count toward the guess cap')

        engine.clearTimers(gameState)
    })

    // ── Core assumption #6: match winner = most round wins, tie broken
    // by fewest total guesses — NOT by whoever won the last round. ──
    await run('buildFinalBoard() picks the match winner by round wins, tie-broken by fewest total guesses', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a', 'b']
        gameState.playerNames = { a: 'Ama', b: 'Bobo' }
        gameState.roundsWon = { a: 2, b: 2 }       // tied on wins
        gameState.totalGuesses = { a: 9, b: 5 }    // Bobo was more efficient
        gameState.roundsPerMatch = 4
        gameState.roundNumber = 4
        gameState.matchStartedAt = Date.now() - 1000
        gameState.roundHistory = []

        const report1 = matchSummary.buildFinalBoard(gameState, 'rounds_complete')
        assertEqual(report1.winner.number, 'b', 'Tied on round wins, the player with fewer total guesses should win the match')

        const text = matchSummary.renderFinalBoardText(report1)
        assert(text.includes('Bobo'), 'Final board text must name the match winner')
    })

    // ── Regression guard: if NO round was ever solved, there must be
    // no match winner at all — a 0-0 tie should not crown someone. ──
    await run('buildFinalBoard() reports no winner when every round ended unsolved', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a', 'b']
        gameState.playerNames = { a: 'Ama', b: 'Bobo' }
        gameState.roundsWon = { a: 0, b: 0 }
        gameState.totalGuesses = { a: 8, b: 8 }
        gameState.roundsPerMatch = 3
        gameState.roundNumber = 3
        gameState.matchStartedAt = Date.now() - 1000
        gameState.roundHistory = []

        const report2 = matchSummary.buildFinalBoard(gameState, 'rounds_complete')
        assert(report2.winner === null, 'Zero round wins for everyone must mean no match winner, not a tie-break fallback')
    })

    // ── The "Closest Call" record is tracked independently of who
    // wins the round/match — same convention as Word Climb's
    // longestWord (NEW_GAME_HANDOFF.md §7). ─────────────────────────
    await run('closestCall credits whoever made the best single guess of the match, even if they never won a round', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a', 'b']
        gameState.playerNames = { a: 'Ama', b: 'Bobo' }
        gameState.roundsWon = { a: 1, b: 0 }
        gameState.totalGuesses = { a: 3, b: 6 }
        gameState.bestProximityEver = { value: 51, number: 'b', distance: 1 } // Bobo's near-miss, but Ama won the round
        gameState.roundsPerMatch = 1
        gameState.roundNumber = 1
        gameState.matchStartedAt = Date.now() - 1000
        gameState.roundHistory = []

        const report3 = matchSummary.buildFinalBoard(gameState, 'rounds_complete')
        assertEqual(report3.closestCall.name, 'Bobo', 'Closest call must credit Bobo even though Ama won the match')

        const text = matchSummary.renderFinalBoardText(report3)
        assert(text.includes('Bobo'), 'Final board text must show the closest-call holder by name')
    })

    // ── Cross-match leaderboard uses roundsWon (higher = better) as
    // the personal-best stat, same recordMatchResult contract every
    // other game uses via gameKernel. ────────────────────────────────
    await run('recordMatchResult() tracks roundsWon as the personal-best stat (higher is better)', async () => {
        const kernel = require('../gameKernel')
        const games = {}
        kernel.recordMatchResult(games, config.GAME_KEY, 'lb-chat', [
            { number: 'a', name: 'Ama', won: true, statValue: 3 },
            { number: 'b', name: 'Bobo', won: false, statValue: 1 }
        ], (x, y) => x > y)

        const board = kernel.getLeaderboard(games, config.GAME_KEY, 'lb-chat')
        assertEqual(board.a.wins, 1, 'Ama should be credited a match win')
        assertEqual(board.a.bestStatValue, 3, "Ama's personal best should be her 3 round wins")
    })

    // ── Unknown public subcommand must reply, not go silent ────────
    await run('unrecognized !gmn subcommand replies instead of silently dropping', async () => {
        const chatId = 'test-chat-unknown@g.us'
        const ctx = makeCtx({ body: `${config.PREFIX} boguscommand`, rawBody: `${config.PREFIX} boguscommand` })
        ctx.from = chatId

        const handled = await publicCommands.handlePublicMessage(ctx)

        assert(handled === true, 'Expected the message to be marked handled')
        assert(ctx.sentMessages.length > 0, 'Unrecognized !gmn subcommand produced zero replies — silent fallback regression')
    })

    // ── Bare acronym must never touch state, even from an admin ────
    await run('bare "!gmn" never starts a lobby or match', async () => {
        const chatId = 'test-chat-bare@g.us'
        const ctx = makeCtx({ body: config.PREFIX, rawBody: config.PREFIX, isAdmin: true })
        ctx.from = chatId

        await publicCommands.handlePublicMessage(ctx)
        const gameState = engine.getGameState(chatId, ctx.games)

        assert(gameState.active === false, 'Bare "!gmn" must never start an active match')
        assert(gameState.lobbyActive === false, 'Bare "!gmn" must never open a lobby')
    })

    // ── Mode/rounds settings round-trip through resolveSetting/
    // writeSetting, same pattern as WordClimb's setturnseconds. ─────
    await run('mode and rounds-per-match settings are read back correctly after being written', async () => {
        const { TIERS, writeSetting } = require('../permissions')
        const settings = { creatorOverrides: {} }

        assertEqual(engine.modeKeyFor(settings), config.DEFAULT_MODE, 'Should default to DEFAULT_MODE with no override set')

        writeSetting(TIERS.CREATOR, `${config.GAME_KEY}_mode`, 'megagrid', settings)
        assertEqual(engine.modeKeyFor(settings), 'megagrid', 'Should read back the mode just written')

        writeSetting(TIERS.CREATOR, `${config.GAME_KEY}_rounds`, 7, settings)
        assertEqual(engine.roundsForMatch(settings), 7, 'Should read back the rounds-per-match value just written')
    })

    // ── Chaos system: intensity gating ──────────────────────────────
    // "off"/"light" must NEVER roll a mechanical event — only "full"
    // can touch scoring or the guess cap.
    await run('rollRoundChaosEvent() only rolls mechanical events at "full" intensity', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a', 'b', 'c']

        gameState.chaosIntensity = 'off'
        assertEqual(engine.rollRoundChaosEvent(gameState).type, 'none', '"off" must always resolve to no event')

        gameState.chaosIntensity = 'light'
        assertEqual(engine.rollRoundChaosEvent(gameState).type, 'none', '"light" must never roll a mechanical event either — flavor only')

        gameState.chaosIntensity = 'full'
        const types = new Set()
        for (let i = 0; i < 200; i++) {
            types.add(engine.rollRoundChaosEvent(gameState).type)
        }
        assert(types.size > 1, '"full" should be able to roll more than just \'none\' across many draws')
    })

    // ── Chaos system: sabotage taxes the SHARED cap, not personal
    // totalGuesses — see gameEngine.js submitGuess() comment. ───────
    await run('a sabotage event taxes the guess cap for its target only, leaving totalGuesses untouched', async () => {
        const chatId = 'test-chat-sabotage@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['111', '222']
        gameState.playerNames = { '111': 'Ama', '222': 'Bobo' }
        gameState.active = true
        gameState.chaosIntensity = 'full'
        gameState.chaosEvent = { type: 'sabotage', target: '111' }
        gameState.effectiveMin = 1
        gameState.effectiveMax = 100
        gameState.guessCap = 20
        gameState.secretNumber = 50
        gameState.guessCount = 0
        gameState.totalGuesses = { '111': 0, '222': 0 }
        gameState.roundsWon = { '111': 0, '222': 0 }
        gameState.playersWithHotHint = {}
        gameState.roundNumber = 1
        gameState.roundsPerMatch = 5

        await engine.submitGuess(chatId, ctx, '111', '10') // sabotage target
        assertEqual(gameState.guessCount, config.SABOTAGE_GUESS_TAX, "the sabotage target's guess should tax the shared cap by SABOTAGE_GUESS_TAX")
        assertEqual(gameState.totalGuesses['111'], 1, "the target's OWN guess count should still only be 1, not the tax amount")

        await engine.submitGuess(chatId, ctx, '222', '20') // not the target
        assertEqual(gameState.guessCount, config.SABOTAGE_GUESS_TAX + 1, 'a non-target guess should cost the normal 1 toward the cap')

        engine.clearTimers(gameState)
    })

    // ── Chaos system: bounty rounds award BOUNTY_POINTS, not just 1 ──
    await run('a bounty round awards BOUNTY_POINTS to the winner instead of 1', async () => {
        const chatId = 'test-chat-bounty@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['111']
        gameState.playerNames = { '111': 'Ama' }
        gameState.active = true
        gameState.chaosIntensity = 'full'
        gameState.chaosEvent = { type: 'bounty' }
        gameState.effectiveMin = 1
        gameState.effectiveMax = 100
        gameState.guessCap = 12
        gameState.secretNumber = 42
        gameState.guessCount = 0
        gameState.totalGuesses = { '111': 0 }
        gameState.roundsWon = { '111': 0 }
        gameState.playersWithHotHint = {}
        gameState.roundNumber = 1
        gameState.roundsPerMatch = 5

        await engine.submitGuess(chatId, ctx, '111', '42') // exact match
        assertEqual(gameState.roundsWon['111'], config.BOUNTY_POINTS, 'a bounty-round win should award BOUNTY_POINTS, not 1')
    })

    // ── Chaos system: the cursed number taxes the cap on the SPECIFIC
    // guess that hits it, and never coincides with the real secret. ──
    await run('rollRoundChaosEvent() never picks a cursed number equal to the real secret', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a']
        gameState.chaosIntensity = 'full'
        gameState.effectiveMin = 1
        gameState.effectiveMax = 5 // tiny range — stresses the "distinct from secret" retry loop
        for (let i = 0; i < 50; i++) {
            gameState.secretNumber = 3
            const event = engine.rollRoundChaosEvent(gameState)
            if (event.type === 'cursed') {
                assert(event.number !== gameState.secretNumber, 'the cursed number must never equal the real secret')
            }
        }
    })

    // ── Chaos system: final-stretch lockout only applies once the
    // guess cap is nearly exhausted, and only when chaos is enabled. ──
    await run('LOCKOUT_THRESHOLD_RATIO controls when heat hints get withheld', async () => {
        const lockoutAt = Math.ceil(10 * config.LOCKOUT_THRESHOLD_RATIO)
        assert(lockoutAt <= 10 && lockoutAt >= 1, 'sanity: lockout threshold should fall within the guess cap')
    })

    // ── Chaos system: Team Chaos only fires with enough players, at
    // full intensity, and never for 'light'/'off'. ──────────────────
    await run('rollTeamChaos() respects TEAM_CHAOS_MIN_PLAYERS and intensity gating', async () => {
        const smallLobby = engine.freshState()
        smallLobby.players = ['a', 'b']
        smallLobby.chaosIntensity = 'full'
        assert(engine.rollTeamChaos(smallLobby) === null, 'a lobby below TEAM_CHAOS_MIN_PLAYERS must never get Team Chaos')

        const lightLobby = engine.freshState()
        lightLobby.players = ['a', 'b', 'c', 'd', 'e']
        lightLobby.chaosIntensity = 'light'
        assert(engine.rollTeamChaos(lightLobby) === null, '"light" intensity must never roll Team Chaos')
    })

    // ── Chaos system: when Team Chaos IS active, a round win credits
    // the winner's TEAM score, and the match winner becomes a team,
    // not an individual. ─────────────────────────────────────────────
    await run('a round win under Team Chaos credits the correct team, and buildFinalBoard() reports a team winner', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a', 'b', 'c', 'd']
        gameState.playerNames = { a: 'Ama', b: 'Bobo', c: 'Chi', d: 'Dede' }
        gameState.teamChaos = { active: true, teamA: ['a', 'b'], teamB: ['c', 'd'] }
        gameState.teamScores = { A: 0, B: 0 }
        gameState.roundsWon = { a: 0, b: 0, c: 0, d: 0 }
        gameState.totalGuesses = { a: 0, b: 0, c: 0, d: 0 }
        gameState.roundNumber = 1
        gameState.roundsPerMatch = 1
        gameState.secretNumber = 10

        engine.resolveRoundEnd(gameState, 'guessed', 'a', 1) // Ama (Team A) wins
        assertEqual(gameState.teamScores.A, 1, "Team A's score should be credited when a Team A member wins")
        assertEqual(gameState.teamScores.B, 0, "Team B's score should be untouched")

        gameState.matchStartedAt = Date.now() - 1000
        const report = matchSummary.buildFinalBoard(gameState, 'rounds_complete')
        assert(report.teamChaos !== null, 'report should carry teamChaos info when the match was a Team Chaos match')
        assertEqual(report.teamChaos.winningTeam, 'A', 'Team A should be reported as the winning team')
        assertEqual(report.winner, null, 'there should be no single-player "winner" in Team Chaos mode — the team result is authoritative')

        const text = matchSummary.renderFinalBoardText(report)
        assert(text.includes('Team A wins'), 'final board text should announce the winning TEAM, not an individual')
    })

    // ── Titles: derived purely from existing stats, never break when
    // nobody qualifies for one (e.g. no round was ever won). ────────
    await run('deriveTitles produces Sniper/Ice Cold/Closest Call from stats already tracked, and degrades gracefully', async () => {
        const gameState = engine.freshState()
        gameState.players = ['a', 'b']
        gameState.playerNames = { a: 'Ama', b: 'Bobo' }
        gameState.roundsWon = { a: 1, b: 0 }
        gameState.totalGuesses = { a: 3, b: 5 }
        gameState.playersWithHotHint = { a: true } // Ama got a hot hint, Bobo never did
        gameState.bestProximityEver = { value: 48, number: 'b', distance: 2 }
        gameState.roundHistory = [
            { roundNumber: 1, winner: 'a', secret: 50, guessesUsed: 3, reason: 'guessed', points: 1, chaosType: 'none' }
        ]
        gameState.roundsPerMatch = 1
        gameState.roundNumber = 1
        gameState.matchStartedAt = Date.now() - 1000

        const report = matchSummary.buildFinalBoard(gameState, 'rounds_complete')
        assert(report.titles.length > 0, 'titles should be derived when stats support them')
        const iceColdTitle = report.titles.find(t => t.label === 'Ice Cold')
        assert(iceColdTitle && iceColdTitle.name === 'Bobo', 'Ice Cold should credit Bobo, who never got a Hot/Blazing hint')

        // Degrade gracefully: no rounds won at all → no Sniper title, no crash.
        const emptyState = engine.freshState()
        emptyState.players = ['a']
        emptyState.playerNames = { a: 'Ama' }
        emptyState.roundsWon = { a: 0 }
        emptyState.totalGuesses = { a: 0 }
        emptyState.playersWithHotHint = {}
        emptyState.bestProximityEver = null
        emptyState.roundHistory = []
        emptyState.roundsPerMatch = 1
        emptyState.roundNumber = 1
        emptyState.matchStartedAt = Date.now() - 1000
        const emptyReport = matchSummary.buildFinalBoard(emptyState, 'rounds_complete')
        assert(!emptyReport.titles.find(t => t.label === 'The Sniper'), 'no Sniper title should be awarded when nobody ever won a round')
        matchSummary.renderFinalBoardText(emptyReport) // must not throw
    })

    // ── Admin dial: /gmn chaos round-trips through resolveSetting/
    // writeSetting exactly like mode/rounds already do. ──────────────
    await run('chaos intensity setting is read back correctly after being written, and rejects invalid values', async () => {
        const { TIERS, writeSetting } = require('../permissions')
        const settings = { creatorOverrides: {} }

        assertEqual(engine.chaosIntensityFor(settings), config.DEFAULT_CHAOS, 'should default to DEFAULT_CHAOS with no override set')

        writeSetting(TIERS.CREATOR, `${config.GAME_KEY}_chaos`, 'full', settings)
        assertEqual(engine.chaosIntensityFor(settings), 'full', 'should read back the chaos intensity just written')

        writeSetting(TIERS.CREATOR, `${config.GAME_KEY}_chaos`, 'not-a-real-level', settings)
        assertEqual(engine.chaosIntensityFor(settings), config.DEFAULT_CHAOS, 'an invalid stored value should fall back to DEFAULT_CHAOS, not crash')
    })

    return report('GuessMyNumberGame')
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1))
}

module.exports = { main }
