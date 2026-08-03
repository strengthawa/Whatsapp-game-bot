// ============================================================
//  WordClimbGame/matchSummary.js — Word Climb · Sky Graphics
//  Pure bookkeeping + message formatting for the end-of-match
//  board. Never owns game state — gameEngine.js hands it a
//  finished gameState and gets back a plain report object;
//  the board text itself is compact by design (see
//  WORDCLIMB_MESSAGE_REDESIGN.md) — one result line, one
//  longest-word line, one disqualified list, no dividers.
// ============================================================

const config = require('./config')
const kernel = require('../gameKernel')

const REASON_TEXT = {
    last_standing: 'Only one climber left standing.',
    reached_top:   `The climb reached the top — ${config.MAX_LENGTH}-letter words conquered!`,
    no_survivors:  'Everyone struck out. No one reached the summit.'
}

/**
 * Builds the final board shown at the end of a match.
 * @param {object} gameState — the just-ended WCL gameState
 * @param {string|null} winner — the winning player's number, or null
 * @param {string} reason — 'last_standing' | 'reached_top' | 'no_survivors'
 */
function buildFinalBoard(gameState, winner, reason) {
    const eliminatedOrder = [...gameState.eliminated].sort((a, b) => a.order - b.order)

    const survivorsRanked = [...gameState.players].sort((a, b) => {
        const lenDiff = (gameState.bestLength[b] || 0) - (gameState.bestLength[a] || 0)
        if (lenDiff !== 0) return lenDiff
        return (gameState.strikes[a] || 0) - (gameState.strikes[b] || 0)
    })

    const answerTimeFor = num => (gameState.answerTimeMs && gameState.answerTimeMs[num]) || 0
    const totalWords = Object.values(gameState.usedWords || {}).reduce((n, list) => n + list.length, 0)

    return {
        reasonText: REASON_TEXT[reason] || 'The climb has ended.',
        totalWords,
        matchDurationMs: Date.now() - (gameState.matchStartedAt || Date.now()),
        // Single longest word of the WHOLE match, winner or not — a
        // player who got eliminated after the winner had already
        // stalled can still hold this record. See WORDCLIMB_MESSAGE_REDESIGN.md §4.
        longestWord: gameState.longestWord
            ? {
                word: gameState.longestWord.word,
                length: gameState.longestWord.length,
                name: gameState.playerNames[gameState.longestWord.number] || gameState.longestWord.number
            }
            : null,
        winner: winner
            ? {
                number: winner,
                name: gameState.playerNames[winner] || winner,
                bestLength: gameState.bestLength[winner] || 0,
                strikes: gameState.strikes[winner] || 0,
                answerTimeMs: answerTimeFor(winner)
            }
            : null,
        survivors: survivorsRanked.map(num => ({
            number: num,
            name: gameState.playerNames[num] || num,
            bestLength: gameState.bestLength[num] || 0,
            strikes: gameState.strikes[num] || 0,
            answerTimeMs: answerTimeFor(num)
        })),
        eliminated: eliminatedOrder.map(e => ({
            order: e.order,
            number: e.number,
            name: e.name,
            atLength: e.atLength,
            bestLength: e.bestLength,
            reason: e.reason,
            answerTimeMs: answerTimeFor(e.number)
        }))
    }
}

/**
 * Renders the report object from buildFinalBoard() into the
 * WhatsApp text block — one compact block, no dividers, no footer
 * tip. Kept separate from buildFinalBoard so a future admin command
 * (e.g. "!wcl lastboard") can re-render a stored report without
 * recomputing anything.
 */
function renderFinalBoardText(report) {
    const lines = []
    const dur = kernel.formatDuration(report.matchDurationMs)
    const t = ms => kernel.formatDuration(ms)

    if (report.winner) {
        lines.push(
            `🏆 ${report.winner.name} won the climb! Reached ${report.winner.bestLength}L · ` +
            `${report.totalWords} words · ⏱️ match ${dur}`
        )
        lines.push(`⏳ ${report.winner.name}'s answer time: ${t(report.winner.answerTimeMs)}`)
    } else if (report.survivors.length > 0) {
        lines.push(`🏔️ Climb topped out! Ranked by longest word · ⏱️ match ${dur}`)
        report.survivors.forEach((s, i) => {
            const medal = i === 0 ? ' 🏆' : ''
            lines.push(`${i + 1}. ${s.name} — ${s.bestLength}L (⏳ ${t(s.answerTimeMs)})${medal}`)
        })
    } else {
        lines.push(`🪦 Nobody survived — no winner this climb. ⏱️ match ${dur}`)
    }

    if (report.longestWord) {
        lines.push(`🏅 Longest word: ${report.longestWord.word.toUpperCase()} (${report.longestWord.length}) by ${report.longestWord.name}`)
    }

    if (report.eliminated.length > 0) {
        lines.push(`🚫 Disqualified (${report.eliminated.length}):`)
        report.eliminated.forEach(e => {
            lines.push(`${e.order}. ${e.name} — out at ${e.atLength}L (⏳ ${t(e.answerTimeMs)})`)
        })
    }

    return lines.join('\n')
}

module.exports = {
    buildFinalBoard,
    renderFinalBoardText
}
