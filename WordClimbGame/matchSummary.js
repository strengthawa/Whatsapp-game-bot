// ============================================================
//  WordClimbGame/matchSummary.js — Word Climb · Sky Graphics
//  Pure bookkeeping + message formatting for the end-of-match
//  board. Never owns game state — gameEngine.js hands it a
//  finished gameState and gets back a plain report object;
//  publicCommands.js turns that into the WhatsApp text.
// ============================================================

const config = require('./config')

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

    return {
        reasonText: REASON_TEXT[reason] || 'The climb has ended.',
        winner: winner
            ? {
                number: winner,
                name: gameState.playerNames[winner] || winner,
                bestLength: gameState.bestLength[winner] || 0,
                strikes: gameState.strikes[winner] || 0
            }
            : null,
        survivors: survivorsRanked.map(num => ({
            number: num,
            name: gameState.playerNames[num] || num,
            bestLength: gameState.bestLength[num] || 0,
            strikes: gameState.strikes[num] || 0
        })),
        eliminated: eliminatedOrder.map(e => ({
            order: e.order,
            number: e.number,
            name: e.name,
            atLength: e.atLength,
            bestLength: e.bestLength,
            reason: e.reason
        })),
        matchDurationMs: Date.now() - (gameState.matchStartedAt || Date.now())
    }
}

/**
 * Renders the report object from buildFinalBoard() into the
 * WhatsApp text block. Kept separate from buildFinalBoard so a
 * future admin command (e.g. "!wcl lastboard") can re-render a
 * stored report without recomputing anything.
 */
function renderFinalBoardText(report, nameTagFn, settings) {
    const lines = []
    lines.push(config.DIVIDER)
    lines.push(`${config.BOT_EMOJI} *${config.GAME_NAME} — Final Board*`)
    lines.push(config.DIVIDER)
    lines.push(report.reasonText)
    lines.push('')

    if (report.winner) {
        lines.push(`🏆 *Winner:* ${report.winner.name} — reached *${report.winner.bestLength}-letter* words`)
    } else if (report.survivors.length > 0) {
        lines.push('🏔️ *No outright winner — ranked by longest word reached:*')
    } else {
        lines.push('🪦 Nobody survived the climb this time.')
    }

    if (report.survivors.length > 1 || (!report.winner && report.survivors.length > 0)) {
        lines.push('')
        lines.push('*Survivors:*')
        report.survivors.forEach((s, i) => {
            lines.push(`${i + 1}. ${s.name} — best: ${s.bestLength} letters (${s.strikes} strikes)`)
        })
    }

    if (report.eliminated.length > 0) {
        lines.push('')
        lines.push('*Knocked out (in order):*')
        report.eliminated.forEach(e => {
            lines.push(`${e.order}. ${e.name} — out at ${e.atLength} letters, best was ${e.bestLength}`)
        })
    }

    lines.push('')
    lines.push(`_Type ${config.PREFIX} start to climb again._`)
    return lines.join('\n')
}

module.exports = {
    buildFinalBoard,
    renderFinalBoardText
}
