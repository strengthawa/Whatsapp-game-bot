// ============================================================
//  GuessMyNumberGame/gameEngine.js — Guess My Number · Sky Graphics
//  Game-state logic AND round-timer/messaging, following the same
//  convention already established by HangmanGame/gameEngine.js and
//  WordClimbGame/gameEngine.js in this project — publicCommands.js
//  stays a thin layer over these functions rather than duplicating
//  round flow.
//
//  DESIGN NOTE — why this isn't just "pick X, race to guess it":
//  Because every Higher/Lower/proximity reply is broadcast to the
//  whole group, the group collectively performs a binary search no
//  matter how many people are playing — a bigger range barely slows
//  that down (log2(1000) is only ~3 guesses more than log2(100)).
//  Three things in this file exist specifically to fix that instead
//  of pretending range size alone creates suspense:
//    1. Proximity hints are coarse tiers (config.PROXIMITY_TIERS),
//       never a raw percentage/distance — stops interpolation-search
//       sniping, which would be even faster than binary search.
//    2. A match is best-of-N ROUNDS_PER_MATCH, not one round — the
//       game's actual length/replay value comes from the match
//       format, not from artificially stretching a single round.
//    3. Range, guess cap, AND round timer all scale together with
//       lobby size (computeEffectiveRange below) — a bigger group
//       gets a proportionally bigger haystack, a proportional number
//       of needles, and proportional time, not just a bigger number.
//
//  How a match works:
//   - Players join a free-for-all lobby — no turn order, ever.
//     Anyone in the group can guess at any time once a round is live.
//   - Each round: the bot picks a secret in the mode's (scaled)
//     range. Any guess gets Higher/Lower + a coarse Hot/Cold tier.
//     Exact match = round win. Reaching the round's guess cap or
//     round timer with no winner = round ends unsolved, secret is
//     revealed, no one scores.
//   - After ROUNDS_PER_MATCH rounds, the player with the most round
//     wins takes the match (ties broken by fewest total guesses,
//     then by their own best-ever proximity this match).
//
//  CHAOS SYSTEM — autonomous, not admin-toggled per feature:
//  The admin sets ONE dial, chaosIntensityFor() ("/gmn chaos
//  off|light|full"). Everything else — which event fires, on whom,
//  when — is rolled by the engine itself (rollRoundChaosEvent,
//  rollTeamChaos), weighted by config.CHAOS_EVENT_WEIGHTS, so no two
//  matches play out the same way even at the same intensity:
//    - "light": flavor only (taunts, a lockout on the final stretch
//      of guesses, end-of-match titles) — never changes who wins.
//    - "full": light's flavor PLUS round-level events (bounty rounds
//      worth double points, a sabotage tax on a random player's
//      guesses, a hidden cursed number that costs extra if hit) and
//      a rare whole-match Team Chaos split for bigger lobbies.
// ============================================================

const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting, writeSetting } = require('../permissions')
const kernel = require('../gameKernel')
const config = require('./config')

// ─── Mode + match-length settings (admin-tunable, see adminCommands.js) ──
// Same resolveSetting/writeSetting pattern as WordClimb's
// "/wcl setturnseconds" — a bot-wide/tenant setting, not gameState,
// so it survives a reset and is visible to /gmn status before a
// lobby even opens.
function modeKeyFor(settings) {
    const key = resolveSetting(`${config.GAME_KEY}_mode`, settings, config.DEFAULT_MODE)
    return config.MODES[key] ? key : config.DEFAULT_MODE
}

function modeConfigFor(settings) {
    return config.MODES[modeKeyFor(settings)]
}

function modeDisplay(settings) {
    const key = modeKeyFor(settings)
    const mode = config.MODES[key]
    return `${mode.LABEL} (${mode.MIN}–${mode.MAX})`
}

function roundsForMatch(settings) {
    const n = resolveSetting(`${config.GAME_KEY}_rounds`, settings, config.ROUNDS_PER_MATCH)
    return Number.isInteger(n) && n > 0 ? n : config.ROUNDS_PER_MATCH
}

// ─── Chaos system — see file header ──────────────────────────────
function chaosIntensityFor(settings) {
    const val = resolveSetting(`${config.GAME_KEY}_chaos`, settings, config.DEFAULT_CHAOS)
    return config.CHAOS_INTENSITIES.includes(val) ? val : config.DEFAULT_CHAOS
}

function pickWeighted(weights) {
    const entries = Object.entries(weights)
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = Math.random() * total
    for (const [key, w] of entries) {
        if (roll < w) return key
        roll -= w
    }
    return entries[entries.length - 1][0]
}

// Rolled once per round, "full" intensity only — mutually exclusive
// event types, entirely autonomous (no admin input into which one or
// who it targets). At "off"/"light" this always resolves to 'none',
// so those intensities never touch scoring or the guess cap.
function rollRoundChaosEvent(gameState) {
    if (gameState.chaosIntensity !== 'full' || gameState.players.length === 0) {
        return { type: 'none' }
    }

    const type = pickWeighted(config.CHAOS_EVENT_WEIGHTS)

    if (type === 'sabotage') {
        const target = gameState.players[Math.floor(Math.random() * gameState.players.length)]
        return { type: 'sabotage', target }
    }

    if (type === 'cursed') {
        // A decoy number, distinct from the real secret, hidden
        // somewhere in the range — never revealed until it's hit.
        let cursedNumber = gameState.secretNumber
        let attempts = 0
        while (cursedNumber === gameState.secretNumber && attempts < 10) {
            cursedNumber = randomInt(gameState.effectiveMin, gameState.effectiveMax)
            attempts += 1
        }
        return { type: 'cursed', number: cursedNumber }
    }

    if (type === 'bounty') {
        return { type: 'bounty' }
    }

    return { type: 'none' }
}

// Rolled once per MATCH (not per round) — a rare whole-match modifier
// for bigger lobbies, "full" intensity only. Returns null when it
// doesn't fire, so every caller can just check `if (gameState.teamChaos)`.
function rollTeamChaos(gameState) {
    if (gameState.chaosIntensity !== 'full') return null
    if (gameState.players.length < config.TEAM_CHAOS_MIN_PLAYERS) return null
    if (Math.random() > config.TEAM_CHAOS_CHANCE) return null

    const shuffled = shuffle(gameState.players)
    const mid = Math.ceil(shuffled.length / 2)
    return {
        active: true,
        teamA:  shuffled.slice(0, mid),
        teamB:  shuffled.slice(mid)
    }
}

function teamOf(gameState, number) {
    if (!gameState.teamChaos || !gameState.teamChaos.active) return null
    if (gameState.teamChaos.teamA.includes(number)) return 'A'
    if (gameState.teamChaos.teamB.includes(number)) return 'B'
    return null
}

// ─── Range/cap/timer scaling by lobby size ───────────────────────
// See file header. Multiplier grows linearly with each player beyond
// the first, capped at RANGE_SCALE_CAP so a huge group doesn't spiral
// into an unplayable Mega Grid round.
function computeMultiplier(playerCount) {
    const extra = Math.max(playerCount - 1, 0)
    const raw = 1 + config.RANGE_SCALE_PER_PLAYER * extra
    return Math.min(raw, config.RANGE_SCALE_CAP)
}

function computeEffectiveRange(mode, playerCount) {
    const multiplier = computeMultiplier(playerCount)
    const baseWidth = mode.MAX - mode.MIN
    const effectiveWidth = Math.round(baseWidth * multiplier)
    return {
        min:          mode.MIN,
        max:          mode.MIN + effectiveWidth,
        guessCap:     Math.max(1, Math.round(mode.GUESS_CAP * multiplier)),
        roundSeconds: Math.max(10, Math.round(mode.ROUND_SECONDS * multiplier)),
        multiplier
    }
}

// ─── Proximity tiering ────────────────────────────────────────────
// Deliberately coarse — see file header. Returns the first tier whose
// ceiling the ratio falls under.
function tierForDistance(distance, rangeWidth) {
    const ratio = rangeWidth > 0 ? distance / rangeWidth : 0
    return config.PROXIMITY_TIERS.find(t => ratio <= t.ceiling) || config.PROXIMITY_TIERS[config.PROXIMITY_TIERS.length - 1]
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

// ─── State isolation — see ARCHITECTURE.md §4 ──────────────────
function stateKey(chatId) {
    return `${config.GAME_KEY}:${chatId}`
}

function getGameState(chatId, games) {
    const key = stateKey(chatId)
    if (!games[key]) {
        games[key] = freshState()
    }
    return games[key]
}

function freshState() {
    return {
        active:           false,
        paused:           false,
        lobbyActive:      false,
        lobbyTimer:       null,
        lobbySecondsLeft: config.LOBBY_SECONDS,
        roundTimer:       null,
        roundSecondsLeft: 0,

        players:     [],   // numbers currently in the match (free-for-all, no order)
        playerNames: {},
        playerJids:  {},

        modeKey:      config.DEFAULT_MODE,
        effectiveMin: config.MODES[config.DEFAULT_MODE].MIN,
        effectiveMax: config.MODES[config.DEFAULT_MODE].MAX,
        guessCap:     config.MODES[config.DEFAULT_MODE].GUESS_CAP,
        roundSeconds: config.MODES[config.DEFAULT_MODE].ROUND_SECONDS,
        multiplier:   1,

        roundsPerMatch: config.ROUNDS_PER_MATCH,
        roundNumber:    0,
        secretNumber:   null,
        guessCount:     0,
        closestGuess:   null,  // { value, number, distance } — CURRENT round only
        roundStartedAt: 0,

        roundsWon:         {},   // { [number]: count } — really "points," bounty rounds can add more than 1
        totalGuesses:       {},  // { [number]: count } — across the whole match
        bestProximityEver:  null, // { value, number, distance } — best guess of the WHOLE match, regardless of round winner
        matchStartedAt:     0,
        roundHistory:       [],  // [{ roundNumber, winner|null, secret, guessesUsed, reason, points }]

        // ── Chaos system — see file header ──────────────────────
        chaosIntensity:     config.DEFAULT_CHAOS,
        chaosEvent:         { type: 'none' },  // current round's rolled event
        teamChaos:          null,              // { active, teamA:[...], teamB:[...] } | null
        teamScores:         null,              // { A: n, B: n } | null
        playersWithHotHint: {}   // { [number]: true } — for the "Ice Cold" title, across the whole match
    }
}

function shuffle(arr) {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

// ─── Lobby ──────────────────────────────────────────────────────
function addToLobby(gameState, number, name, jid) {
    if (gameState.players.includes(number)) return false
    gameState.players.push(number)
    gameState.playerNames[number] = name
    gameState.playerJids[number] = jid
    return true
}

function clearTimers(gameState) {
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
    if (gameState.roundTimer) clearInterval(gameState.roundTimer)
    gameState.lobbyTimer = null
    gameState.roundTimer = null
}

function jidFor(gameState, number) {
    return gameState.playerJids[number] || `${number}@s.whatsapp.net`
}

function tagFor(gameState, number, settings) {
    return nameTag(number, gameState.playerNames, settings)
}

// ─── Live scoreboard text — used by "!gmn board" and inline after
// key events. Shows current round progress + standings, never the
// secret itself. ────────────────────────────────────────────────
function buildLiveBoardText(gameState, settings) {
    if (!gameState.active) return `📭 No *${config.GAME_NAME}* round is currently live.`

    const lines = [
        `${config.GRID_EMOJI} *Round ${gameState.roundNumber}/${gameState.roundsPerMatch}* — ` +
        `${gameState.guessCount}/${gameState.guessCap} guesses used · ⏳ ${gameState.roundSecondsLeft}s left`
    ]

    if (gameState.chaosEvent && gameState.chaosEvent.type !== 'none') {
        lines.push(describeChaosEvent(gameState, settings))
    }

    if (gameState.closestGuess) {
        const tag = tagFor(gameState, gameState.closestGuess.number, settings)
        const tier = tierForDistance(gameState.closestGuess.distance, gameState.effectiveMax - gameState.effectiveMin)
        lines.push(`${tier.emoji} Closest so far: ${tag} (${tier.label})`)
    }

    if (gameState.teamChaos && gameState.teamChaos.active) {
        lines.push('', `${config.TROPHY_EMOJI} *Team Chaos Standings:*`)
        lines.push(`⚔️ Team A: *${gameState.teamScores.A}* pts — ${gameState.teamChaos.teamA.map(n => tagFor(gameState, n, settings)).join(', ')}`)
        lines.push(`⚔️ Team B: *${gameState.teamScores.B}* pts — ${gameState.teamChaos.teamB.map(n => tagFor(gameState, n, settings)).join(', ')}`)
    } else {
        const standings = [...gameState.players].sort((a, b) => (gameState.roundsWon[b] || 0) - (gameState.roundsWon[a] || 0))
        if (standings.length > 0) {
            lines.push('', `${config.TROPHY_EMOJI} *Standings:*`)
            standings.forEach((num, i) => {
                lines.push(`${i + 1}. ${tagFor(gameState, num, settings)} — ${gameState.roundsWon[num] || 0} point${(gameState.roundsWon[num] || 0) === 1 ? '' : 's'}`)
            })
        }
    }

    return lines.join('\n')
}

// One-line, NEVER spoils the cursed number itself — only announces
// that something is in play, same as what gets posted at round start.
function describeChaosEvent(gameState, settings) {
    const event = gameState.chaosEvent
    if (event.type === 'bounty') return `💰 *Bounty Round* — worth *${config.BOUNTY_POINTS}* points this round!`
    if (event.type === 'sabotage') return `🎭 *Chaos Strike* — ${tagFor(gameState, event.target, settings)}'s guesses cost double this round!`
    if (event.type === 'cursed') return `☠️ *A cursed number is hiding in this range...* guess wisely.`
    return ''
}

// ─── Round flow ───────────────────────────────────────────────────
// `points` defaults to 1 — a bounty round passes config.BOUNTY_POINTS
// instead. `roundsWon` is really "points" once bounty rounds exist,
// but the field name stays for backward compatibility with normal
// (non-bounty) rounds, where points is always exactly 1 per win.
function resolveRoundEnd(gameState, reason, winnerNumber, points) {
    const awardedPoints = winnerNumber ? (points || 1) : 0

    gameState.roundHistory.push({
        roundNumber:  gameState.roundNumber,
        winner:       winnerNumber || null,
        secret:       gameState.secretNumber,
        guessesUsed:  gameState.guessCount,
        reason,
        points:       awardedPoints,
        chaosType:    (gameState.chaosEvent && gameState.chaosEvent.type) || 'none'
    })

    if (winnerNumber) {
        gameState.roundsWon[winnerNumber] = (gameState.roundsWon[winnerNumber] || 0) + awardedPoints

        const team = teamOf(gameState, winnerNumber)
        if (team && gameState.teamScores) {
            gameState.teamScores[team] += awardedPoints
        }
    }
    if (gameState.roundTimer) {
        clearInterval(gameState.roundTimer)
        gameState.roundTimer = null
    }
}

async function startRound(chatId, ctx) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.roundNumber += 1
    gameState.secretNumber = randomInt(gameState.effectiveMin, gameState.effectiveMax)
    gameState.guessCount = 0
    gameState.closestGuess = null
    gameState.roundStartedAt = Date.now()
    gameState.roundSecondsLeft = gameState.roundSeconds
    gameState.chaosEvent = rollRoundChaosEvent(gameState)
    persistGames()

    const chaosLine = gameState.chaosEvent.type !== 'none'
        ? `\n${describeChaosEvent(gameState, settings)}`
        : ''

    await sock.sendMessage(chatId, {
        text:
            `${config.GRID_EMOJI} *Round ${gameState.roundNumber}/${gameState.roundsPerMatch}* — guess between ` +
            `*${gameState.effectiveMin}–${gameState.effectiveMax}*!\n` +
            `${config.HIGHER_EMOJI}${config.LOWER_EMOJI} Higher/Lower + heat hints on every guess. No turn order — anyone can guess any time.\n` +
            `⏳ ${gameState.roundSeconds}s · 🎯 ${gameState.guessCap} guesses max for the round` +
            chaosLine
    })

    armRoundTimer(chatId, ctx)
}

function armRoundTimer(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    if (gameState.roundTimer) clearInterval(gameState.roundTimer)
    gameState.roundTimer = setInterval(() => tickRoundTimer(chatId, ctx), 1000)
}

async function tickRoundTimer(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)

    if (!gameState.active || gameState.paused) {
        if (gameState.roundTimer) clearInterval(gameState.roundTimer)
        return
    }

    gameState.roundSecondsLeft -= 1

    if (gameState.roundSecondsLeft <= 0) {
        clearInterval(gameState.roundTimer)
        gameState.roundTimer = null
        await handleRoundTimeout(chatId, ctx)
        return
    }

    if (gameState.roundSecondsLeft % 15 === 0) {
        await sock.sendMessage(chatId, {
            text: `⏳ ${gameState.roundSecondsLeft}s left · 🔢 ${gameState.guessCount}/${gameState.guessCap} guesses used`
        })
    }
}

async function handleRoundTimeout(chatId, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active) return

    const secret = gameState.secretNumber
    resolveRoundEnd(gameState, 'timeout', null)
    persistGames()

    await sock.sendMessage(chatId, {
        text: `⏱️ *Time's up!* Nobody found it — the number was *${secret}*. No round win this time.`
    })

    await advanceRoundOrEndMatch(chatId, ctx)
}

// Called by publicCommands.js for ANY message during an active round —
// free-for-all, so no sender restriction beyond "must be a bare integer".
// Returns true if the message was consumed as a guess attempt.
async function submitGuess(chatId, ctx, senderNumber, rawText) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (!gameState.active || gameState.paused) return false

    const text = (rawText || '').trim()
    if (!/^\d+$/.test(text)) return false
    const guessValue = parseInt(text, 10)

    const tag = tagFor(gameState, senderNumber, settings)

    if (guessValue < gameState.effectiveMin || guessValue > gameState.effectiveMax) {
        await sock.sendMessage(chatId, {
            text: `⚠️ ${tag}, this round's range is *${gameState.effectiveMin}–${gameState.effectiveMax}* — that guess is outside it.`
        })
        return true
    }

    const intensity = gameState.chaosIntensity || 'off'
    const chaosEvent = gameState.chaosEvent || { type: 'none' }

    // Sabotage/cursed both tax the SHARED guess cap, never the
    // player's own totalGuesses efficiency stat — see file header.
    let tax = 1
    let chaosNote = ''
    if (chaosEvent.type === 'sabotage' && chaosEvent.target === senderNumber) {
        tax = config.SABOTAGE_GUESS_TAX
        chaosNote = `\n🎭 Sabotage tax — this guess cost *${tax}* toward the cap.`
    } else if (chaosEvent.type === 'cursed' && guessValue === chaosEvent.number) {
        tax = config.CURSED_GUESS_TAX
        chaosNote = `\n☠️ *Cursed number!* That guess cost *${tax}* toward the cap.`
    }

    gameState.guessCount += tax
    gameState.totalGuesses[senderNumber] = (gameState.totalGuesses[senderNumber] || 0) + 1

    const secret = gameState.secretNumber
    const distance = Math.abs(guessValue - secret)
    const rangeWidth = gameState.effectiveMax - gameState.effectiveMin

    if (!gameState.closestGuess || distance < gameState.closestGuess.distance) {
        gameState.closestGuess = { value: guessValue, number: senderNumber, distance }
    }
    if (!gameState.bestProximityEver || distance < gameState.bestProximityEver.distance) {
        gameState.bestProximityEver = { value: guessValue, number: senderNumber, distance }
    }

    if (guessValue === secret) {
        const points = chaosEvent.type === 'bounty' ? config.BOUNTY_POINTS : 1
        resolveRoundEnd(gameState, 'guessed', senderNumber, points)
        persistGames()

        const bonusNote = points > 1 ? ` 💰 *Bounty bonus — worth ${points} points!*` : ''
        const teamNote = gameState.teamChaos && gameState.teamChaos.active
            ? ` Team ${teamOf(gameState, senderNumber)} scores!`
            : ''
        await sock.sendMessage(chatId, {
            text: `${config.WINNER_EMOJI} *WINNER!* ${tag} nailed it — the number was *${secret}*! ` +
                  `(${gameState.guessCount} guess${gameState.guessCount === 1 ? '' : 'es'} this round) ${config.TROPHY_EMOJI}` +
                  bonusNote + teamNote
        })
        await advanceRoundOrEndMatch(chatId, ctx)
        return true
    }

    const tier = tierForDistance(distance, rangeWidth)
    const direction = guessValue < secret
        ? `${config.HIGHER_EMOJI} Higher`
        : `${config.LOWER_EMOJI} Lower`

    // Tracked for the "Ice Cold" title regardless of whether the
    // lockout below hides it in chat this particular guess.
    if (tier.label === 'Hot' || tier.label === 'Blazing') {
        gameState.playersWithHotHint[senderNumber] = true
    }

    const lockoutThreshold = Math.ceil(gameState.guessCap * config.LOCKOUT_THRESHOLD_RATIO)
    const isLockout = intensity !== 'off' && gameState.guessCount >= lockoutThreshold

    const hintText = isLockout
        ? `${direction} — 🔒 *FINAL STRETCH*, no more heat hints!`
        : `${tier.emoji} ${direction} (${tier.label})`

    let taunt = ''
    if (intensity !== 'off' && Math.random() < 0.35) {
        taunt = '\n' + config.TAUNT_LINES[Math.floor(Math.random() * config.TAUNT_LINES.length)]
    }

    if (gameState.guessCount >= gameState.guessCap) {
        resolveRoundEnd(gameState, 'guess_cap', null)
        persistGames()
        await sock.sendMessage(chatId, {
            text: `${hintText} — but that's the last guess this round! Nobody found it — the number was *${secret}*.${chaosNote}`
        })
        await advanceRoundOrEndMatch(chatId, ctx)
        return true
    }

    persistGames()
    await sock.sendMessage(chatId, {
        text: `${hintText} — ${tag} · ${gameState.guessCount}/${gameState.guessCap} guesses used${chaosNote}${taunt}`
    })
    return true
}

async function advanceRoundOrEndMatch(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)

    if (gameState.roundNumber >= gameState.roundsPerMatch) {
        await endMatch(chatId, ctx, 'rounds_complete')
        return
    }
    await startRound(chatId, ctx)
}

async function endMatch(chatId, ctx, reason) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    clearTimers(gameState)
    gameState.active = false

    const report = matchSummary.buildFinalBoard(gameState, reason)
    const text = matchSummary.renderFinalBoardText(report)
    await sock.sendMessage(chatId, { text })

    // Cross-match leaderboard (opt-in, see gameKernel.js) — every
    // player who was ever in this match, winner and non-winner alike,
    // with their own roundsWon (points) as the personal-best stat
    // (higher is better for GMN). In Team Chaos, "won" is credited to
    // every member of the winning team, not just the top scorer.
    const allParticipants = gameState.players.map(num => {
        let won = false
        if (report.teamChaos) {
            const team = teamOf(gameState, num)
            won = !!(report.teamChaos.winningTeam && team === report.teamChaos.winningTeam)
        } else {
            won = report.winner ? num === report.winner.number : false
        }
        return {
            number:    num,
            name:      gameState.playerNames[num] || num,
            won,
            statValue: gameState.roundsWon[num] || 0
        }
    })
    if (allParticipants.length > 0) {
        kernel.recordMatchResult(games, config.GAME_KEY, chatId, allParticipants, (a, b) => a > b)
        if (typeof persistGames === 'function') persistGames()
    }

    if (activeGameChatRef && activeGameChatRef.value === chatId) {
        activeGameChatRef.value = null
    }
}

// ─── Lobby open + countdown (engine-owned) ──────────────────────
async function openFreshLobby(chatId, ctx) {
    const { sock, games, settings, nameCache, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.players = []
    gameState.playerNames = {}
    gameState.playerJids = {}
    gameState.lobbyActive = true
    gameState.lobbySecondsLeft = config.LOBBY_SECONDS

    // Auto-join — same bot-wide "autoJoin" setting every other game reads.
    const creatorEnvJid   = process.env.CREATOR_JID || ''
    const creatorNum      = creatorEnvJid ? creatorEnvJid.split('@')[0].split(':')[0] : ''
    const creatorAutoJoin = settings.creatorOverrides?.autoJoin !== false
    const adminAutoJoin   = settings.autoJoin !== false

    if (creatorNum && creatorAutoJoin) {
        gameState.players.push(creatorNum)
        gameState.playerNames[creatorNum] = (nameCache && nameCache[creatorNum]) || 'Creator'
        gameState.playerJids[creatorNum]  = creatorEnvJid
    }
    if (settings.adminNumber && settings.adminNumber !== creatorNum && adminAutoJoin) {
        gameState.players.push(settings.adminNumber)
        gameState.playerNames[settings.adminNumber] = (nameCache && nameCache[settings.adminNumber]) || 'Admin'
        gameState.playerJids[settings.adminNumber]  = settings.adminJid || `${settings.adminNumber}@s.whatsapp.net`
    }

    activeGameChatRef.value = chatId
    persistGames()

    const mode = modeConfigFor(settings)
    const rounds = roundsForMatch(settings)
    const autoJoinMentions = gameState.players.map(num => gameState.playerJids[num])
    const autoJoinText = gameState.players.length > 0
        ? gameState.players.map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)} — Auto-joined 👑`).join('\n')
        : '[No one yet — be first! 🎯]'

    await sock.sendMessage(chatId, {
        text:
            `${config.GRID_EMOJI} *${config.GAME_NAME}* starting! Type *${config.PREFIX} join* — ${config.LOBBY_SECONDS}s to join.\n` +
            `🎮 Mode: *${mode.LABEL} (${mode.MIN}–${mode.MAX})* · Best of *${rounds}* rounds\n` +
            `👥 ${autoJoinText}`,
        mentions: autoJoinMentions
    })

    startLobbyCountdown(chatId, ctx)
}

function startLobbyCountdown(chatId, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
    gameState.lobbyTimer = setInterval(async () => {
        if (!gameState.lobbyActive) {
            clearInterval(gameState.lobbyTimer)
            return
        }
        gameState.lobbySecondsLeft--
        if (gameState.lobbySecondsLeft <= 0) {
            clearInterval(gameState.lobbyTimer)
            await closeLobbyAndStart(chatId, ctx)
        } else if (gameState.lobbySecondsLeft % 10 === 0) {
            await sock.sendMessage(chatId, {
                text: `⏳ ${gameState.lobbySecondsLeft}s left to join — 👥 ${gameState.players.length} joined`
            })
        }
        persistGames()
    }, 1000)
}

async function closeLobbyAndStart(chatId, ctx) {
    const { sock, games, settings } = ctx
    const gameState = getGameState(chatId, games)

    if (gameState.players.length < config.MIN_PLAYERS_TO_BEGIN) {
        gameState.lobbyActive = false
        ctx.activeGameChatRef.value = null
        await sock.sendMessage(chatId, {
            text: `⚠️ Not enough players joined — *${config.GAME_NAME}* lobby closed without a match.`
        })
        return
    }
    await sock.sendMessage(chatId, {
        text: `🚀 Match begins! ${gameState.players.length} guesser${gameState.players.length === 1 ? '' : 's'} ready.`
    })
    await startMatch(chatId, ctx, settings)
}

// ─── Starting the match (called once the lobby closes) ─────────
async function startMatch(chatId, ctx, settings) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const resolvedSettings = settings || ctx.settings

    clearTimers(gameState)
    gameState.lobbyActive = false
    gameState.active = true

    const mode = modeConfigFor(resolvedSettings)
    const scaled = computeEffectiveRange(mode, gameState.players.length)

    gameState.modeKey      = modeKeyFor(resolvedSettings)
    gameState.effectiveMin = scaled.min
    gameState.effectiveMax = scaled.max
    gameState.guessCap     = scaled.guessCap
    gameState.roundSeconds = scaled.roundSeconds
    gameState.multiplier   = scaled.multiplier

    gameState.roundsPerMatch = roundsForMatch(resolvedSettings)
    gameState.roundNumber = 0
    gameState.roundsWon = {}
    gameState.totalGuesses = {}
    gameState.bestProximityEver = null
    gameState.roundHistory = []
    gameState.matchStartedAt = Date.now()
    gameState.playersWithHotHint = {}

    gameState.chaosIntensity = chaosIntensityFor(resolvedSettings)
    gameState.teamChaos = rollTeamChaos(gameState)
    gameState.teamScores = gameState.teamChaos ? { A: 0, B: 0 } : null

    for (const num of gameState.players) {
        gameState.roundsWon[num] = 0
        gameState.totalGuesses[num] = 0
    }

    persistGames()

    if (gameState.teamChaos) {
        await sock.sendMessage(chatId, {
            text:
                `⚔️ *TEAM CHAOS!* This match is Team A vs Team B — round wins score for your team, not just you.\n` +
                `🅰️ Team A: ${gameState.teamChaos.teamA.map(n => tagFor(gameState, n, resolvedSettings)).join(', ')}\n` +
                `🅱️ Team B: ${gameState.teamChaos.teamB.map(n => tagFor(gameState, n, resolvedSettings)).join(', ')}`
        })
    }

    await startRound(chatId, ctx)
}

// ─── Pause / resume ───────────────────────────────────────────
function pauseSession(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    const paused = kernel.pauseTimer(gameState, gameState.roundTimer, clearInterval)
    return paused
}

function resumeSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const resumed = kernel.resumeTimer(gameState, () => {
        armRoundTimer(chatId, ctx)
    })
    if (resumed && typeof persistGames === 'function') persistGames()
    return resumed
}

function forceStopActiveSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const wasRunning = !!(gameState.active || gameState.lobbyActive)

    clearTimers(gameState)
    gameState.active = false
    gameState.lobbyActive = false

    if (typeof persistGames === 'function') persistGames()
    return wasRunning
}

module.exports = {
    stateKey,
    getGameState,
    freshState,
    addToLobby,
    clearTimers,
    jidFor,
    tagFor,
    modeKeyFor,
    modeConfigFor,
    modeDisplay,
    roundsForMatch,
    computeMultiplier,
    computeEffectiveRange,
    tierForDistance,
    buildLiveBoardText,
    chaosIntensityFor,
    pickWeighted,
    rollRoundChaosEvent,
    rollTeamChaos,
    teamOf,
    describeChaosEvent,
    openFreshLobby,
    closeLobbyAndStart,
    startMatch,
    startRound,
    submitGuess,
    resolveRoundEnd,
    advanceRoundOrEndMatch,
    endMatch,
    pauseSession,
    resumeSession,
    forceStopActiveSession,
    tickRoundTimer
}
