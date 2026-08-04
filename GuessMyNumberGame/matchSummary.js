// ============================================================
//  GuessMyNumberGame/matchSummary.js — Guess My Number · Sky Graphics
//  Pure bookkeeping + message formatting for the end-of-match board.
//  Never owns game state — gameEngine.js hands it a finished
//  gameState and gets back a plain report object; the caller
//  (gameEngine.endMatch) sends the text. See ARCHITECTURE.md §10.2 —
//  this file never calls sock.sendMessage.
// ============================================================

const kernel = require('../gameKernel')
const config = require('./config')

const REASON_TEXT = {
    rounds_complete: 'All rounds played.',
    stopped_early:   'Match ended early by the admin.'
}

const CHAOS_ICON = { bounty: '💰', sabotage: '🎭', cursed: '☠️', none: '' }

/**
 * Derives end-of-match titles purely from stats already tracked in
 * gameState/roundHistory — no new bookkeeping. Cosmetic only; never
 * affects who won. A player can hold more than one title, and a
 * title can go unawarded if no one qualifies (e.g. no round was won,
 * so there's no Sniper).
 */
function deriveTitles(gameState) {
    const titles = []

    // 🎯 Sniper — the fewest guesses used to win ANY round this match.
    const wins = gameState.roundHistory.filter(r => r.winner)
    if (wins.length > 0) {
        const best = wins.reduce((a, b) => (b.guessesUsed < a.guessesUsed ? b : a))
        titles.push({
            ...config.TITLES.sniper,
            name: gameState.playerNames[best.winner] || best.winner,
            detail: `${best.guessesUsed} guess${best.guessesUsed === 1 ? '' : 'es'} in R${best.roundNumber}`
        })
    }

    // 🧊 Ice Cold — guessed at least once, never once got a Hot/Blazing hint.
    const iceCandidates = gameState.players.filter(num =>
        (gameState.totalGuesses[num] || 0) > 0 && !gameState.playersWithHotHint[num]
    )
    if (iceCandidates.length > 0) {
        titles.push({
            ...config.TITLES.iceCold,
            name: iceCandidates.map(num => gameState.playerNames[num] || num).join(', '),
            detail: 'never got a Hot/Blazing hint all match'
        })
    }

    // 🔥 Closest Call — see buildFinalBoard's closestCall, surfaced as a title too.
    if (gameState.bestProximityEver) {
        titles.push({
            ...config.TITLES.closeCall,
            name:   gameState.playerNames[gameState.bestProximityEver.number] || gameState.bestProximityEver.number,
            detail: `±${gameState.bestProximityEver.distance} on ${gameState.bestProximityEver.value}`
        })
    }

    return titles
}

/**
 * Builds the final board shown at the end of a match.
 *
 * Two modes:
 *  - Normal: winner = most points (roundsWon), ties broken by fewest
 *    total guesses (efficiency) — NOT by who happened to win the
 *    last round. A player with zero points can never be the match
 *    winner, even if every round ended unsolved (winner stays null).
 *  - Team Chaos: winner is a TEAM (by total team score), individual
 *    standings still shown underneath for bragging rights.
 * @param {object} gameState — the just-ended GMN gameState
 * @param {string} reason — 'rounds_complete' | 'stopped_early'
 */
function buildFinalBoard(gameState, reason) {
    const ranked = [...gameState.players].sort((a, b) => {
        const winDiff = (gameState.roundsWon[b] || 0) - (gameState.roundsWon[a] || 0)
        if (winDiff !== 0) return winDiff
        return (gameState.totalGuesses[a] || 0) - (gameState.totalGuesses[b] || 0)
    })

    const topWins = ranked.length > 0 ? (gameState.roundsWon[ranked[0]] || 0) : 0
    const winnerNumber = topWins > 0 ? ranked[0] : null

    const teamChaosActive = !!(gameState.teamChaos && gameState.teamChaos.active)
    let winningTeam = null
    if (teamChaosActive) {
        if (gameState.teamScores.A > gameState.teamScores.B) winningTeam = 'A'
        else if (gameState.teamScores.B > gameState.teamScores.A) winningTeam = 'B'
        // equal scores → winningTeam stays null, a genuine tie
    }

    return {
        reasonText:      REASON_TEXT[reason] || 'The match has ended.',
        roundsPlayed:    gameState.roundNumber,
        roundsPerMatch:  gameState.roundsPerMatch,
        matchDurationMs: Date.now() - (gameState.matchStartedAt || Date.now()),
        mode: {
            key: gameState.modeKey,
            min: gameState.effectiveMin,
            max: gameState.effectiveMax
        },
        chaosIntensity: gameState.chaosIntensity,
        teamChaos: teamChaosActive ? {
            teamA:       gameState.teamChaos.teamA.map(num => gameState.playerNames[num] || num),
            teamB:       gameState.teamChaos.teamB.map(num => gameState.playerNames[num] || num),
            scoreA:      gameState.teamScores.A,
            scoreB:      gameState.teamScores.B,
            winningTeam
        } : null,
        // In Team Chaos mode there's no single "match winner" player —
        // the team result above is authoritative. `winner` is only
        // meaningful in normal mode.
        winner: (!teamChaosActive && winnerNumber) ? {
            number:       winnerNumber,
            name:         gameState.playerNames[winnerNumber] || winnerNumber,
            roundsWon:    gameState.roundsWon[winnerNumber] || 0,
            totalGuesses: gameState.totalGuesses[winnerNumber] || 0
        } : null,
        standings: ranked.map(num => ({
            number:       num,
            name:         gameState.playerNames[num] || num,
            roundsWon:    gameState.roundsWon[num] || 0,
            totalGuesses: gameState.totalGuesses[num] || 0,
            team:         teamChaosActive ? (gameState.teamChaos.teamA.includes(num) ? 'A' : 'B') : null
        })),
        // Best single guess of the WHOLE match, regardless of who won
        // that round or the match overall — see ARCHITECTURE.md
        // NEW_GAME_HANDOFF.md §7 "track a record independently of who wins".
        closestCall: gameState.bestProximityEver ? {
            value:    gameState.bestProximityEver.value,
            distance: gameState.bestProximityEver.distance,
            name:     gameState.playerNames[gameState.bestProximityEver.number] || gameState.bestProximityEver.number
        } : null,
        titles: deriveTitles(gameState),
        roundHistory: gameState.roundHistory.map(r => ({
            ...r,
            winnerName: r.winner ? (gameState.playerNames[r.winner] || r.winner) : null
        }))
    }
}

/**
 * Renders the report object from buildFinalBoard() into the WhatsApp
 * text block — compact, one line per participant, one round-by-round
 * recap line, no dividers/footer tip. Matches the project's Shape B
 * (everyday transactional) convention for match reports.
 */
function renderFinalBoardText(report) {
    const lines = []
    const dur = kernel.formatDuration(report.matchDurationMs)

    if (report.teamChaos) {
        const t = report.teamChaos
        if (t.winningTeam) {
            lines.push(`${config.TROPHY_EMOJI} *Team ${t.winningTeam} wins the match!* ${t.scoreA} – ${t.scoreB} · ⏱️ ${dur}`)
        } else {
            lines.push(`🤝 *Team Chaos ends in a tie!* ${t.scoreA} – ${t.scoreB} · ⏱️ ${dur}`)
        }
        lines.push('', `⚔️ Team A (${t.scoreA} pts): ${t.teamA.join(', ')}`)
        lines.push(`⚔️ Team B (${t.scoreB} pts): ${t.teamB.join(', ')}`)
    } else if (report.winner) {
        lines.push(
            `${config.TROPHY_EMOJI} *${report.winner.name} wins the match!* ` +
            `${report.winner.roundsWon}/${report.roundsPerMatch} rounds · ⏱️ ${dur}`
        )
    } else {
        lines.push(`🤝 No round was ever solved — no match winner this time. ⏱️ ${dur}`)
    }

    if (report.standings.length > 0) {
        lines.push('', '📊 *Standings:*')
        report.standings.forEach((s, i) => {
            const medal = i === 0 && s.roundsWon > 0 && !report.teamChaos ? ' 🏆' : ''
            const teamTag = s.team ? ` [Team ${s.team}]` : ''
            lines.push(`${i + 1}. ${s.name}${teamTag} — ${s.roundsWon}pt · ${s.totalGuesses} guesses${medal}`)
        })
    }

    if (report.titles && report.titles.length > 0) {
        lines.push('', '🎖️ *Titles:*')
        report.titles.forEach(t => {
            lines.push(`${t.emoji} *${t.label}* — ${t.name} (${t.detail})`)
        })
    }

    if (report.closestCall) {
        lines.push('', `🔥 Closest call: ${report.closestCall.name} guessed *${report.closestCall.value}* (±${report.closestCall.distance})`)
    }

    if (report.roundHistory.length > 0) {
        const recap = report.roundHistory.map(r => {
            const chaosIcon = CHAOS_ICON[r.chaosType] || ''
            return r.winner
                ? `R${r.roundNumber}${chaosIcon} ${config.WINNER_EMOJI} ${r.winnerName} (${r.guessesUsed}g)`
                : `R${r.roundNumber}${chaosIcon} 🧊 unsolved (was ${r.secret})`
        }).join(' · ')
        lines.push('', `📜 Rounds: ${recap}`)
    }

    return lines.join('\n')
}

module.exports = {
    buildFinalBoard,
    renderFinalBoardText
}
