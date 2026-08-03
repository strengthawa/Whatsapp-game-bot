// HangmanGame/matchSummary.js — Hangman · Sky Graphics
//
// Standalone match-summary / disqualification module.
// Pure bookkeeping + message formatting — never owns game state.
// Final-board shape matches WordClimbGame/matchSummary.js's redesign:
// one compact block, everyone's own stats (wrong guesses, won/lost),
// no dividers, no footer tip. See WORDCLIMB_MESSAGE_REDESIGN.md.

const config = require('./config')
const kernel = require('../gameKernel')

const DQ_REASONS = {
    SKIPPED_3:          'Skipped 3 turns in a row',
    ADMIN_REMOVED:      'Removed by admin',
    LEFT_GROUP:         'Left the group',
    MANUAL_LEAVE:       'Left the game voluntarily',
    ATTEMPTS_EXHAUSTED: 'Used all wrong guesses'
}

/**
 * Record a player disqualification into gameState.disqualified
 * and remove them from gameState.players. Cleans up playerJids
 * and attempts so no orphaned keys remain.
 */
function recordDisqualification(gameState, number, reason = DQ_REASONS.SKIPPED_3) {
    if (!gameState.disqualified) gameState.disqualified = []

    const index = gameState.players.indexOf(number)
    if (index === -1) return -1

    gameState.disqualified.push({
        number,
        name: gameState.playerNames[number] || number,
        reason,
        wrongGuesses: (gameState.attempts && gameState.attempts[number]) || 0,
        eliminatedAt: new Date().toISOString()
    })

    gameState.players.splice(index, 1)
    delete gameState.playerNames[number]
    delete gameState.skipStreaks[number]
    delete gameState.playerJids?.[number]
    delete gameState.attempts?.[number]

    return index
}

/**
 * Returns the winning player's number if exactly one player remains
 * after a disqualification. Otherwise null.
 */
function checkLastPlayerStanding(gameState) {
    if (gameState.players.length !== 1) return null
    if (!gameState.disqualified || gameState.disqualified.length === 0) return null
    return gameState.players[0]
}

/**
 * Builds the full match report as a plain {text, mentions} object.
 * Never sends — the caller owns sock.sendMessage, same contract as
 * WordClimbGame/matchSummary.js's buildFinalBoard().
 * @param {function} tag — tag(number) → display string with role badge
 */
function buildMatchReport(gameState, outcome, tag) {
    const disqualified = gameState.disqualified || []
    const dur = kernel.formatDuration(Date.now() - (gameState.roundStartedAt || Date.now()))

    // Every survivor's own wrong-guess count, same field a DQ'd player
    // already carries — so the board shows one consistent stat for
    // everyone, winner or not, not just a win/loss flag.
    const survivorEntries = gameState.players.map(number => ({
        number,
        name: gameState.playerNames[number] || number,
        disqualified: false,
        wrongGuesses: (gameState.attempts && gameState.attempts[number]) || 0
    }))
    const dqEntries = disqualified.map(entry => ({
        number:       entry.number,
        name:         entry.name,
        disqualified: true,
        reason:       entry.reason,
        wrongGuesses: entry.wrongGuesses || 0
    }))

    const allParticipants   = [...survivorEntries, ...dqEntries]
    const totalDisqualified = dqEntries.length

    let winnerNumber = null, resultLine = ''
    const wordUpper = gameState.targetWord ? gameState.targetWord.toUpperCase() : 'N/A'

    switch (outcome.type) {
        case 'winner_letter':
            winnerNumber = outcome.winnerNumber
            resultLine = `🏆 ${tag(winnerNumber)} won! Word: ${wordUpper} · ⏱️ ${dur}`
            break
        case 'winner_instant':
            winnerNumber = outcome.winnerNumber
            resultLine = `⚡ ${tag(winnerNumber)} won with an instant full-word guess! ${wordUpper} · ⏱️ ${dur}`
            break
        case 'last_standing':
            winnerNumber = outcome.winnerNumber
            resultLine = `🏆 ${tag(winnerNumber)} won — last one standing! Word: ${wordUpper} · ⏱️ ${dur}`
            break
        case 'no_winner':
        default:
            resultLine = `💀 Nobody survived — word was ${wordUpper} · ⏱️ ${dur}`
            break
    }

    // Everyone's own stat line — winner first, then survivors, then
    // eliminated in the order they went out. One consistent shape per
    // person regardless of outcome, mirroring WordClimb's board.
    const statLines = []
    const winnerEntry = allParticipants.find(p => p.number === winnerNumber)
    if (winnerEntry) {
        statLines.push(`🏆 ${tag(winnerEntry.number)} — ${winnerEntry.wrongGuesses} wrong guess${winnerEntry.wrongGuesses === 1 ? '' : 'es'}`)
    }
    for (const entry of allParticipants) {
        if (entry.number === winnerNumber) continue
        if (entry.disqualified) {
            statLines.push(`💀 ${tag(entry.number)} — out (${entry.reason}), ${entry.wrongGuesses} wrong guess${entry.wrongGuesses === 1 ? '' : 'es'}`)
        } else {
            statLines.push(`✅ ${tag(entry.number)} — ${entry.wrongGuesses} wrong guess${entry.wrongGuesses === 1 ? '' : 'es'}`)
        }
    }

    const lines = [resultLine]
    if (statLines.length > 0) lines.push(...statLines)
    if (totalDisqualified > 0) lines.push(`🚫 Disqualified: ${totalDisqualified}/${allParticipants.length}`)

    const mentionSet = new Set()
    for (const p of allParticipants) {
        const jid = (gameState.playerJids && gameState.playerJids[p.number]) || `${p.number}@s.whatsapp.net`
        mentionSet.add(jid)
    }

    return { text: lines.join('\n'), mentions: [...mentionSet] }
}

/**
 * Records this match's result into the cross-match leaderboard (see
 * gameKernel.js — opt-in, per game per chat, survives across matches).
 * Fewer wrong guesses is "better" for Hangman's personal-best column.
 * Call once, right after buildMatchReport(), at every match-ending
 * call site (there are several — winner by letter, instant word guess,
 * last standing, no winner).
 */
function recordLeaderboard(games, chatId, gameState, outcome) {
    const disqualified = gameState.disqualified || []
    const participants = [
        ...gameState.players.map(number => ({
            number,
            name: gameState.playerNames[number] || number,
            won: number === outcome.winnerNumber,
            statValue: (gameState.attempts && gameState.attempts[number]) || 0
        })),
        ...disqualified.map(entry => ({
            number: entry.number,
            name: entry.name,
            won: false,
            statValue: entry.wrongGuesses || 0
        }))
    ]
    if (participants.length === 0) return
    kernel.recordMatchResult(games, config.GAME_KEY, chatId, participants, (a, b) => a < b)
}

module.exports = { DQ_REASONS, recordDisqualification, checkLastPlayerStanding, buildMatchReport, recordLeaderboard }
