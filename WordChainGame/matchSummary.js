// ============================================================
//  WordChainGame/matchSummary.js — Word Chain · Sky Graphics
//  Pure bookkeeping + message formatting for the end-of-match
//  board. Never owns game state — gameEngine.js hands it a
//  finished gameState and gets back a plain report object. Board
//  shape mirrors WordClimbGame/HangmanGame's convention: one
//  result line, one longest-word line, one disqualified list, no
//  dividers, no footer tip.
// ============================================================

const config = require('./config')
const kernel = require('../gameKernel')

const REASON_TEXT = {
    last_standing: 'Only one player left standing.',
    chain_target:  `The chain reached ${config.CHAIN_TARGET} words!`,
    no_survivors:  'Everyone struck out. The chain broke.'
}

/**
 * Builds the final board shown at the end of a match.
 * @param {object} gameState — the just-ended WCH gameState
 * @param {string|null} winner — the winning player's number, or null
 * @param {string} reason — 'last_standing' | 'chain_target' | 'no_survivors'
 */
function buildFinalBoard(gameState, winner, reason) {
    const eliminatedOrder = [...gameState.eliminated].sort((a, b) => a.order - b.order)

    // Same tie-break gameEngine.endChainState() uses when picking a
    // winner: fewest strikes first, then highest score — kept in sync
    // here purely for the DISPLAY order of the ranked list.
    const survivorsRanked = [...gameState.players].sort((a, b) => {
        const strikeDiff = (gameState.strikes[a] || 0) - (gameState.strikes[b] || 0)
        if (strikeDiff !== 0) return strikeDiff
        return (gameState.score[b] || 0) - (gameState.score[a] || 0)
    })

    const answerTimeFor = num => (gameState.answerTimeMs && gameState.answerTimeMs[num]) || 0

    return {
        reasonText: REASON_TEXT[reason] || 'The chain has ended.',
        category: gameState.category,
        totalWords: gameState.totalWords || 0,
        matchDurationMs: Date.now() - (gameState.matchStartedAt || Date.now()),
        // Last few words of the chain, for a bit of "here's what we
        // actually built" flavor on the board — not the whole thing,
        // which could be up to config.CHAIN_TARGET words long.
        chainTrail: (gameState.usedWords || []).slice(-8),
        // Single longest word of the WHOLE match, winner or not — see
        // NEW_GAME_HANDOFF.md §7's "track a match record independently
        // of who wins" rule (WordClimbGame's longestWord is the
        // reference this follows).
        longestWord: gameState.longestWord
            ? {
                word: gameState.longestWord.word,
                name: gameState.playerNames[gameState.longestWord.number] || gameState.longestWord.number
            }
            : null,
        winner: winner
            ? {
                number: winner,
                name: gameState.playerNames[winner] || winner,
                contributions: gameState.contributions[winner] || 0,
                score: gameState.score[winner] || 0,
                strikes: gameState.strikes[winner] || 0,
                answerTimeMs: answerTimeFor(winner)
            }
            : null,
        survivors: survivorsRanked.map(num => ({
            number: num,
            name: gameState.playerNames[num] || num,
            contributions: gameState.contributions[num] || 0,
            score: gameState.score[num] || 0,
            strikes: gameState.strikes[num] || 0,
            answerTimeMs: answerTimeFor(num)
        })),
        eliminated: eliminatedOrder.map(e => ({
            order: e.order,
            number: e.number,
            name: e.name,
            atWordCount: e.atWordCount,
            contributions: e.contributions,
            score: e.score || 0,
            reason: e.reason,
            answerTimeMs: answerTimeFor(e.number)
        }))
    }
}

/**
 * Renders the report object from buildFinalBoard() into the
 * WhatsApp text block.
 */
function renderFinalBoardText(report) {
    const lines = []
    const dur = kernel.formatDuration(report.matchDurationMs)
    const t = ms => kernel.formatDuration(ms)

    if (report.winner) {
        lines.push(
            `🏆 ${report.winner.name} won the chain! ${report.winner.score} pts · ` +
            `${report.totalWords} words total · ⏱️ match ${dur}`
        )
        lines.push(`⏳ ${report.winner.name}'s answer time: ${t(report.winner.answerTimeMs)}`)
    } else if (report.survivors.length > 0) {
        lines.push(`🔗 Chain complete! Ranked by fewest strikes, then score · ⏱️ match ${dur}`)
        report.survivors.forEach((s, i) => {
            const medal = i === 0 ? ' 🏆' : ''
            lines.push(`${i + 1}. ${s.name} — ${s.score} pts, ${s.contributions} words, ${s.strikes}💢 (⏳ ${t(s.answerTimeMs)})${medal}`)
        })
    } else {
        lines.push(`🪦 Nobody survived — no winner this chain. ⏱️ match ${dur}`)
    }

    if (report.longestWord) {
        lines.push(`🏅 Longest word: ${report.longestWord.word.toUpperCase()} (${report.longestWord.word.length}) by ${report.longestWord.name}`)
    }

    if (report.chainTrail.length > 0) {
        lines.push(`🔗 Final stretch: ${report.chainTrail.join(' → ')}`)
    }

    if (report.eliminated.length > 0) {
        lines.push(`🚫 Disqualified (${report.eliminated.length}):`)
        report.eliminated.forEach(e => {
            lines.push(`${e.order}. ${e.name} — out after ${e.contributions} words, ${e.score} pts (⏳ ${t(e.answerTimeMs)})`)
        })
    }

    return lines.join('\n')
}

module.exports = {
    buildFinalBoard,
    renderFinalBoardText
}
