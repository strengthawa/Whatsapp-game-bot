// ============================================================
//  WordChainGame/tests.js — Word Chain · Sky Graphics
//  Behavioral (runtime) tests — see NEW_GAME_HANDOFF.md §10: this
//  encodes the specific assumptions THIS game makes about itself,
//  not generic smoke tests.
//
//  Run standalone:  node WordChainGame/tests.js
//  Run with every game: node scripts/run-tests.js
// ============================================================

const { makeCtx, run, assert, assertEqual, report, resetCounts } = require('../scripts/tests/_harness')
const config = require('./config')
const engine = require('./gameEngine')
const publicCommands = require('./publicCommands')
const matchSummary = require('./matchSummary')
const wordBank = require('./wordBank')

async function main() {
    resetCounts()
    console.log('WordChainGame — behavioral tests')

    // ── Solo play must not instantly end the match ────────────────
    // advanceToNextTurn() must NOT treat "only 1 player in turnOrder"
    // as an end condition by itself — that's true from the very first
    // turn of a solo match (config.MIN_PLAYERS_TO_BEGIN allows 1), and
    // WordClimbGame's own advanceToNextTurn only ends on turnOrder
    // .length === 0. The <=1 end check belongs in eliminateFromState
    // (AFTER a real elimination), not in the generic "whose turn is
    // it" transition — this was caught and fixed during this game's
    // own build, before it ever shipped, so it's locked in here.
    await run('a solo (1-player) match gets to open the chain instead of instantly ending', async () => {
        const chatId = 'test-chat-solo@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        engine.addToLobby(gameState, '15551234567', 'Solo Player', '15551234567@s.whatsapp.net')
        gameState.lobbyActive = true

        await engine.closeLobbyAndStart(chatId, ctx)

        assert(gameState.active === true, 'Expected the chain to actually start with 1 player, but gameState.active is false')
        const endedMsg = ctx.sentMessages.find(m => /won the chain|Nobody survived/.test(m.text))
        assert(!endedMsg, `Solo match ended immediately instead of opening — got: "${endedMsg && endedMsg.text}"`)
        const openMsg = ctx.sentMessages.find(m => m.text.includes('opens the chain'))
        assert(openMsg, `Expected an "opens the chain" prompt for the solo player. Sent: ${JSON.stringify(ctx.sentMessages.map(m => m.text))}`)

        engine.clearTimers(gameState)
    })

    // ── The chain rule itself: opener is unconstrained, the very
    // next word must start with the opener's last letter ──────────
    await run('the opening word has no letter constraint, but the next turn requires the opener\'s last letter', async () => {
        const chatId = 'test-chat-chainrule@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['a', 'b']
        gameState.playerNames = { a: 'Ama', b: 'Bobo' }
        gameState.playerJids = { a: 'a@s.whatsapp.net', b: 'b@s.whatsapp.net' }
        gameState.turnOrder = ['a', 'b']
        gameState.turnIndex = 0
        gameState.currentPlayer = 'a'
        gameState.active = true
        gameState.category = 'free'
        gameState.strikes = { a: 0, b: 0 }
        gameState.contributions = { a: 0, b: 0 }
        gameState.answerTimeMs = { a: 0, b: 0 }

        const consumedOpener = await engine.submitGuess(chatId, ctx, 'a', 'apple')
        assert(consumedOpener, 'Opening word should be consumed as a valid guess')
        assertEqual(gameState.lastWord, 'apple', 'lastWord should now be the opener')
        assertEqual(gameState.currentPlayer, 'b', 'Turn should advance to the next player')

        const badTurn = await engine.submitGuess(chatId, ctx, 'b', 'banana')
        assert(badTurn, 'A wrong-letter word is still consumed as an (invalid) guess attempt')
        assertEqual(gameState.strikes.b, 1, '"banana" does not start with "e" (apple\'s last letter) — must be struck, not silently accepted')

        engine.clearTimers(gameState)
    })

    // ── Category mode restricts to the curated list even for a
    // technically-real English word outside that category ──────────
    await run('a category match rejects a real word that is not in that category', async () => {
        assert(wordBank.isRealWord('bicycle'), 'Test assumes "bicycle" is a real dictionary word')
        assert(!wordBank.isValidWord('bicycle', null, 'animals', []), '"bicycle" is real English but not an animal — a category match must reject it')
        assert(wordBank.isValidWord('tiger', null, 'animals', []), '"tiger" must be accepted in the animals category')
    })

    // ── Category is no longer admin-toggled — every match always
    // starts at SECTOR_SEQUENCE[0], even if a previous match ended
    // deep into a later sector. startChain() must reset it, not
    // carry over whatever the last match happened to be on ──────────
    await run('a new match always opens on the first sector, regardless of where the previous match ended', async () => {
        const chatId = 'test-chat-sector-reset@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.category = 'countries' // simulate a previous match ending deep in rotation
        gameState.sectorIndex = 3
        engine.addToLobby(gameState, 'a', 'Ama', 'a@s.whatsapp.net')
        gameState.lobbyActive = true

        await engine.closeLobbyAndStart(chatId, ctx)

        assertEqual(gameState.category, config.SECTOR_SEQUENCE[0], 'A fresh match must reset to the first sector, not inherit the last match\'s sector')
        assertEqual(gameState.sectorIndex, 0, 'sectorIndex must reset to 0 for a fresh match')

        engine.clearTimers(gameState)
    })

    // ── Near-miss rejections must name the specific reason ──────────
    await run('validateWord() distinguishes too-short, wrong-letter, repeat, and not-in-category', async () => {
        assertEqual(wordBank.validateWord('ox', null, 'free', []).reason, 'too_short')
        assertEqual(wordBank.validateWord('apple', 'z', 'free', []).reason, 'wrong_letter')
        assertEqual(wordBank.validateWord('apple', null, 'free', ['apple']).reason, 'repeat')
        assertEqual(wordBank.validateWord('bicycle', null, 'animals', []).reason, 'not_in_category')
        assertEqual(wordBank.validateWord('apple', null, 'free', []).reason, null)
    })

    // ── Sector auto-rotation: fires exactly at SECTOR_LENGTH words,
    // announces it, and the NEXT turn prompt reflects the new sector ──
    await run('the sector automatically shifts after SECTOR_LENGTH words and announces it', async () => {
        const chatId = 'test-chat-rotate@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['a', 'b']
        gameState.playerNames = { a: 'Ama', b: 'Bobo' }
        gameState.playerJids = { a: 'a@s.whatsapp.net', b: 'b@s.whatsapp.net' }
        gameState.turnOrder = ['a', 'b']
        gameState.turnIndex = 0
        gameState.currentPlayer = 'a'
        gameState.active = true
        gameState.category = config.SECTOR_SEQUENCE[0]
        gameState.sectorIndex = 0
        gameState.wordsInCurrentSector = config.SECTOR_LENGTH - 1 // one word away from rotating
        gameState.strikes = { a: 0, b: 0 }
        gameState.contributions = { a: 0, b: 0 }
        gameState.score = { a: 0, b: 0 }
        gameState.streak = { a: 0, b: 0 }
        gameState.answerTimeMs = { a: 0, b: 0 }
        gameState.usedWords = []
        gameState.lastWord = 'orange' // so this word just needs to start with "e"

        await engine.submitGuess(chatId, ctx, 'a', 'egg')

        assertEqual(gameState.category, config.SECTOR_SEQUENCE[1], 'Sector should have advanced to the next entry in SECTOR_SEQUENCE')
        assertEqual(gameState.wordsInCurrentSector, 0, 'wordsInCurrentSector should reset after a rotation')
        const shiftMsg = ctx.sentMessages.find(m => m.text.includes('SECTOR SHIFT'))
        assert(shiftMsg, `Expected a SECTOR SHIFT announcement. Sent: ${JSON.stringify(ctx.sentMessages.map(m => m.text))}`)

        engine.clearTimers(gameState)
    })

    // ── Scoring: rare letter + long word + streak milestone bonuses
    // all stack on the same word ─────────────────────────────────────
    await run('computeBonus-driven scoring stacks rare-letter, long-word, and streak bonuses', async () => {
        const chatId = 'test-chat-scoring@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['a']
        gameState.playerNames = { a: 'Ama' }
        gameState.playerJids = { a: 'a@s.whatsapp.net' }
        gameState.turnOrder = ['a']
        gameState.turnIndex = 0
        gameState.currentPlayer = 'a'
        gameState.active = true
        gameState.category = 'free'
        gameState.strikes = { a: 0 }
        gameState.contributions = { a: 0 }
        gameState.score = { a: 0 }
        gameState.streak = { a: config.STREAK_MILESTONE - 1 } // this word completes a streak milestone
        gameState.answerTimeMs = { a: 0 }
        gameState.usedWords = []
        gameState.lastWord = null // opener, so no letter constraint

        // "xylophone" — starts with a rare letter (x) and is 7+ letters (long)
        await engine.submitGuess(chatId, ctx, 'a', 'xylophone')

        const expected = 1 + config.RARE_LETTER_BONUS + config.LONG_WORD_BONUS + config.STREAK_BONUS
        assertEqual(gameState.score.a, expected,
            `Expected base(1) + rare(${config.RARE_LETTER_BONUS}) + long(${config.LONG_WORD_BONUS}) + streak(${config.STREAK_BONUS}) = ${expected}, got ${gameState.score.a}`)
        assertEqual(gameState.streak.a, config.STREAK_MILESTONE, 'Streak should have incremented to the milestone value')

        engine.clearTimers(gameState)
    })

    // ── Steal window: opens on a failed turn, suspends the normal
    // turn for whoever's next, and a valid steal from someone else
    // is accepted and keeps the chain going ─────────────────────────
    await run('a failed turn opens a steal window that another player can win', async () => {
        const chatId = 'test-chat-steal@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.players = ['a', 'b', 'c']
        gameState.playerNames = { a: 'Ama', b: 'Bobo', c: 'Chi' }
        gameState.playerJids = { a: 'a@s.whatsapp.net', b: 'b@s.whatsapp.net', c: 'c@s.whatsapp.net' }
        gameState.turnOrder = ['a', 'b', 'c']
        gameState.turnIndex = 0
        gameState.currentPlayer = 'a'
        gameState.active = true
        gameState.category = 'free'
        gameState.strikes = { a: 0, b: 0, c: 0 }
        gameState.contributions = { a: 0, b: 0, c: 0 }
        gameState.score = { a: 0, b: 0, c: 0 }
        gameState.streak = { a: 0, b: 0, c: 0 }
        gameState.answerTimeMs = { a: 0, b: 0, c: 0 }
        gameState.usedWords = []
        gameState.lastWord = 'orange' // required letter: "e"

        await engine.submitGuess(chatId, ctx, 'a', 'banana') // wrong letter — fails, opens steal window

        assertEqual(gameState.strikes.a, 1, "Ama's failed word should still cost her a strike")
        assert(gameState.steal && gameState.steal.open, 'A steal window should now be open')
        assertEqual(gameState.steal.excludeNumber, 'a', 'Ama (who just failed) must be excluded from stealing her own turn back')

        // Ama trying to steal her own turn back must be rejected
        const amaSteal = await engine.attemptSteal(chatId, ctx, 'a', 'egg')
        assert(amaSteal === false, 'The player who just failed must not be able to steal their own turn')
        assert(gameState.steal && gameState.steal.open, 'Steal window must still be open after a self-steal attempt')

        // Chi successfully steals it
        const chiSteal = await engine.attemptSteal(chatId, ctx, 'c', 'egg')
        assert(chiSteal === true, "Chi's valid steal should be accepted")
        assertEqual(gameState.lastWord, 'egg', 'The chain should continue with the stolen word')
        assertEqual(gameState.contributions.c, 1, "Chi's steal should count as one of her contributions")
        assert(gameState.score.c >= config.STEAL_BONUS, 'Chi should have been credited the steal bonus')
        assert(!gameState.steal, 'Steal window should be closed after a successful steal')

        engine.clearTimers(gameState)
    })

    // ── Turn timer curve: full time at 0 words, floor at
    // DIFFICULTY_MAX_WORDS, and a fixed override wins outright ──────
    await run('turnSecondsFor() gives the start value at 0 words and the floor at DIFFICULTY_MAX_WORDS', async () => {
        const gameState = engine.freshState()
        const settings = { creatorOverrides: {} }

        gameState.totalWords = 0
        assertEqual(engine.turnSecondsFor(gameState, settings), config.TURN_SECONDS_START,
            'Expected the full starting time at the very start of the chain')

        gameState.totalWords = config.DIFFICULTY_MAX_WORDS
        assertEqual(engine.turnSecondsFor(gameState, settings), config.TURN_SECONDS_FLOOR,
            'Expected the timer floor once the chain reaches its difficulty cap')
    })

    await run('a fixed /wch setturnseconds override replaces the shrink curve entirely', async () => {
        const gameState = engine.freshState()
        gameState.totalWords = config.DIFFICULTY_MAX_WORDS // would be the floor under the curve
        const settings = { creatorOverrides: {}, [`${config.GAME_KEY}_turnSeconds`]: 33 }
        assertEqual(engine.turnSecondsFor(gameState, settings), 33,
            'A fixed override must be used as-is, ignoring totalWords entirely')
    })

    // ── Track a match record (longest word) independently of who
    // wins — same rule NEW_GAME_HANDOFF.md §7 names for WordClimbGame ──
    await run('longest word of the match is credited correctly even when the winner never held it', async () => {
        const gameState = engine.freshState()
        gameState.players = ['winner-num']
        gameState.playerNames = { 'winner-num': 'Quiet Winner', 'out-num': 'Early Achiever' }
        gameState.contributions = { 'winner-num': 1, 'out-num': 5 }
        gameState.strikes = { 'winner-num': 0, 'out-num': 3 }
        gameState.answerTimeMs = { 'winner-num': 500, 'out-num': 1000 }
        gameState.longestWord = { word: 'watermelon', number: 'out-num' }
        gameState.eliminated = [{
            number: 'out-num', name: 'Early Achiever', reason: 'wrong_guess',
            atWordCount: 6, contributions: 5, order: 1
        }]
        gameState.totalWords = 7
        gameState.category = 'free'
        gameState.matchStartedAt = Date.now() - 1000

        const rep = matchSummary.buildFinalBoard(gameState, 'winner-num', 'last_standing')

        assert(gameState.longestWord.number !== 'winner-num',
            'Test setup should reflect the winner NOT holding the record — otherwise this test proves nothing')
        assertEqual(rep.longestWord.name, 'Early Achiever',
            'Longest word must credit whoever actually achieved it, not be derived from the winner')

        const text = matchSummary.renderFinalBoardText(rep)
        assert(text.includes('Early Achiever'), 'Final board text must name the longest-word holder even though they lost')
        assert(text.includes('Disqualified (1)'), 'Final board text must show the disqualified count')
    })

    // ── Turn timer must tick a "seconds left" update every 5s ───────
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
        gameState.strikes = { '15551111111': 0 }
        gameState.turnSecondsLeft = 6

        await engine.tickTurnTimer(chatId, ctx) // 6 -> 5, a tick multiple of 5
        const tick = ctx.sentMessages.find(m => /left/.test(m.text))
        assert(tick, `Expected a "seconds left" tick message at 5s remaining. Sent: ${JSON.stringify(ctx.sentMessages.map(m => m.text))}`)
        assert(tick.text.includes('5s'), `Tick message should report 5s left, got: "${tick.text}"`)
    })

    // ── Dictionary sanity — common everyday words must validate.
    // Regression class: WordClimbGame's original dictionary was
    // capped per length/letter bucket and alphabetically truncated,
    // which silently dropped ordinary words ("house", "tiger",
    // "orange") entirely. This game's dictionary was generated
    // differently (see wordBank.js header) specifically to avoid
    // that — this test is the canary if it ever regresses.
    await run('common everyday words validate as real words in free mode', async () => {
        const commonWords = ['apple', 'elephant', 'orange', 'house', 'music', 'water', 'friend', 'guitar']
        for (const w of commonWords) {
            assert(wordBank.isRealWord(w), `"${w}" should be recognized as a real word — dictionary coverage regression`)
        }
    })

    // ── Every letter must have at least one word in free mode, or a
    // chain could dead-end structurally (not just via genuine player
    // difficulty) — the bot never picks the letter, so this can only
    // be guaranteed by the dictionary's own coverage ─────────────────
    await run('every letter a-z has at least one valid free-mode word', async () => {
        const letters = wordBank.lettersWithWords()
        for (const l of 'abcdefghijklmnopqrstuvwxyz') {
            assert(letters.includes(l), `No words found starting with "${l}" in free mode — a chain could dead-end on this letter for reasons unrelated to player skill`)
        }
    })

    // ── Unknown public subcommand must reply, not go silent ────────
    await run('unrecognized !wch subcommand replies instead of silently dropping', async () => {
        const chatId = 'test-chat-unknown@g.us'
        const ctx = makeCtx({ body: `${config.PREFIX} boguscommand`, rawBody: `${config.PREFIX} boguscommand` })
        ctx.from = chatId

        const handled = await publicCommands.handlePublicMessage(ctx)

        assert(handled === true, 'Expected the message to be marked handled')
        assert(ctx.sentMessages.length > 0, 'Unrecognized !wch subcommand produced zero replies — silent fallback regression')
    })

    // ── 0-player lobby must still be correctly rejected ─────────────
    await run('closeLobbyAndStart() still rejects an empty (0-player) lobby', async () => {
        const chatId = 'test-chat-empty@g.us'
        const ctx = makeCtx()
        const gameState = engine.getGameState(chatId, ctx.games)
        gameState.lobbyActive = true // no players added

        await engine.closeLobbyAndStart(chatId, ctx)

        assert(gameState.active === false, 'A 0-player lobby should never start a chain')
        const cancelMsg = ctx.sentMessages.find(m => m.text.includes('Not enough players'))
        assert(cancelMsg, 'Expected a "not enough players" message for a 0-player lobby, got none')
    })

    return report('WordChainGame')
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1))
}

module.exports = { main }
