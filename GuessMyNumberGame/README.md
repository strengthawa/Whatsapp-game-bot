# Guess My Number (GMN)

A free-for-all number-guessing match built for live WhatsApp groups.
No turn order, ever — anyone in the group can guess at any time, as
long as their guess is within the round's range.

## The pitch

The bot picks a secret number in a range (mode-dependent). Anyone can
type a bare number at any time. Every guess gets an exact
📈 Higher / 📉 Lower plus a coarse heat tier — 🌋 Blazing, 🔥 Hot,
🌤️ Warm, or 🧊 Cold — never a raw percentage or distance. Guess it
exactly and it's a 🎯 round win.

A **match** is best of `N` rounds (default 5), not a single round —
see "Why a best-of-N match" below for why. Most round wins after all
rounds are played takes the match; ties are broken by fewest total
guesses (efficiency).

## Why a best-of-N match, coarse hints, and scaling range/cap/timer

Every hint in this game is broadcast to the whole group, which means
the group can collectively binary-search a secret no matter how big
the range is — `log2(1000)` is only ~3 guesses more than
`log2(100)`. A single round, especially with several players
triangulating the same public hints, tends to resolve in well under
10 guesses regardless of mode. Three design choices exist specifically
to keep the game from feeling like it's "always over in 15 seconds":

1. **Coarse proximity tiers, not a percentage.** A raw "42% close"
   lets a sharp player calculate the remaining distance and snipe the
   secret in 2-3 guesses (interpolation search) — worse than plain
   binary search. Banded Hot/Cold tiers keep enough uncertainty that
   players still have to search.
2. **Best-of-N rounds, cumulative scoreboard.** The replay/engagement
   value comes from the match format (build a streak, chase the
   standings) rather than from trying to artificially stretch a single
   round past what the math naturally allows.
3. **Range, guess cap, AND round timer all scale together with lobby
   size** (`gameEngine.computeEffectiveRange`) — a 5-player Mega Grid
   round gets a proportionally bigger range, a proportional number of
   guesses to find it in, and proportional time, not just a bigger
   number with the same 8 guesses to find it.

## Difficulty modes (admin-set, `/gmn mode`)

| Mode | Range | Round timer (base) | Guess cap (base) |
|---|---|---|---|
| Classic | 1–100 | 60s | 12 |
| Speed Run | 1–50 | 30s | 8 |
| Mega Grid | 1–1000 | 90s | 18 |

All three numbers scale up together by the same lobby-size multiplier
(`1 + 0.5 × (players − 1)`, capped at ×3) — see `config.js` for the
exact constants.

## Chaos system (admin-set, `/gmn chaos off|light|full`)

One dial, not a checklist. The admin only decides how wild the match
gets — the engine itself autonomously rolls WHICH event fires, WHO it
targets, and WHEN (`gameEngine.rollRoundChaosEvent`,
`gameEngine.rollTeamChaos`), so no two matches at the same intensity
play out the same way. This exists because the base game (Higher/
Lower + best-of-N rounds) is mechanically sound but had zero
personality — see `gameEngine.js`'s file header for the original
"why doesn't this get boring" reasoning that predates chaos.

| Intensity | What's live |
|---|---|
| `off` | The base game exactly as designed — no taunts, no lockout, no titles, no round-level events, no Team Chaos. |
| `light` | Flavor only, never changes who wins: random taunt lines on wrong guesses, a final-stretch **lockout** (once guesses hit 80% of the cap, heat-tier hints are withheld — Higher/Lower only), and end-of-match **titles**. |
| `full` | Everything in `light`, PLUS round-level chaos events (weighted, mutually exclusive, one roll per round) and a rare whole-match **Team Chaos** split. |

**Round-level events** (`config.CHAOS_EVENT_WEIGHTS`, `full` only):

| Event | Weight | Effect |
|---|---|---|
| `bounty` | 20 | That round's win is worth `BOUNTY_POINTS` (2) instead of 1 — announced at round start. |
| `sabotage` | 15 | A random player's guesses each cost `SABOTAGE_GUESS_TAX` (2) toward the shared guess cap instead of 1 — their OWN `totalGuesses` stat is untouched, only the group's shared budget is taxed. Target is announced. |
| `cursed` | 10 | A decoy number, distinct from the real secret, is hidden in the range — landing on it costs `CURSED_GUESS_TAX` (2) toward the cap. Never revealed in advance, only announced that one exists. |
| `none` | 55 | A normal round — the majority outcome even at `full`. |

**Team Chaos** (`gameEngine.rollTeamChaos`, `full` only): needs at
least `TEAM_CHAOS_MIN_PLAYERS` (4) in the lobby, fires with
`TEAM_CHAOS_CHANCE` (25%) probability once per match (not per round).
When it fires, the lobby is randomly split into Team A / Team B for
the whole match — round wins credit the winner's team score, and the
match winner becomes the higher-scoring team, not an individual (see
`matchSummary.buildFinalBoard`'s `teamChaos` branch). Individual
per-player stats (points, titles) still track underneath for bragging
rights, shown in the final board's standings.

**Titles** (`light` and `full`, end-of-match only, purely cosmetic —
never affects scoring): derived entirely from stats already tracked,
no new bookkeeping —

- 🎯 **The Sniper** — won a round in the fewest guesses this match.
- 🧊 **Ice Cold** — guessed at least once, never got a Hot/Blazing hint.
- 🔥 **Closest Call** — held the match's single nearest miss (same
  record as the always-on `closestCall` in the final board).

## Files in this folder

| File | Role |
|---|---|
| `config.js` | `GAME_KEY`, `GAME_NAME`, `GAME_ACRONYM`, `PREFIX` (`!gmn`), `ADMIN_PREFIX` (`/gmn `), the 3 modes, range-scaling constants, proximity tiers, the chaos system's weights/thresholds/taunts/titles, emoji set |
| `gameEngine.js` | Lobby (open/countdown/close, with auto-join), free-for-all round flow, hint tiering, range/cap/timer scaling, multi-round match progression, the autonomous chaos roller (round events + Team Chaos), pause/resume — via `../gameKernel`, same contract as every other game here |
| `publicCommands.js` | `!gmn` commands (`start`, `join`, `mode`, `chaos`, `board`, `leaderboard`, `help`) + routes live bare-number guesses to the engine — thin glue only, no state mutation of its own |
| `adminCommands.js` | `/gmn` commands (`status`, `begin`, `pause`, `resume`, `skip`, `stop`, `reset`, `mode`, `setrounds`, `chaos`), gated on `senderTier` + game-access scope per `ARCHITECTURE.md` §5 |
| `matchSummary.js` | Builds and returns the final match board (including Team Chaos results + titles) — pure bookkeeping, never calls `sock.sendMessage` (see `ARCHITECTURE.md` §10.2) |

## Switching to Guess My Number

```
/game setgame guessmynumber
```

## Public commands (`!gmn`)

| Command | What it does |
|---|---|
| `!gmn` (bare) | Explainer card — never starts anything, per §9 |
| `!gmn start` | Open a lobby (subject to `publicCanStart`) |
| `!gmn join` | Join the open lobby |
| `!gmn board` | Live scoreboard — current round progress, non-spoiling chaos state, closest guess so far, standings |
| `!gmn mode` | Shows the current mode + rounds-per-match (read-only; admin sets it) |
| `!gmn chaos` | Shows the current chaos intensity (read-only; admin sets it) |
| `!gmn leaderboard` / `lb` | This chat's all-time standings across matches |
| `!gmn help` | Same as bare |

To **guess**, just type a bare number any time a round is live. No
prefix, no turn order — first correct guess from anyone wins the
round.

## Admin commands (`/gmn`)

| Command | What it does |
|---|---|
| `/gmn status` | Lobby/round state, range, guess count, timer, current chaos event, live standings (or team scores under Team Chaos) |
| `/gmn pause` / `/gmn resume` | Freeze / unfreeze the round timer |
| `/gmn skip` | End the current round unsolved, reveal the number, move on |
| `/gmn stop` / `end` | Terminate the session immediately |
| `/gmn reset` | Hard reset — wipes session for this chat |
| `/gmn mode <classic\|speedrun\|megagrid>` | Difficulty mode for the *next* match |
| `/gmn setrounds <1-15>` | Rounds per match for the *next* match |
| `/gmn chaos <off\|light\|full>` | Chaos intensity for the *next* match — see "Chaos system" above |
| `/gmn help` | Admin command list |

**Not handled here:** who gets ADMIN tier in the first place, which
game(s) they're scoped to, or the bot-wide `publicVisible` /
`publicCanStart` / `autoJoin` toggles. Those live at `/admin` and
`/game` respectively — see the root `COMMAND_REFERENCE.md` §1.

## Design notes

- **Free-for-all, not turn-based.** `gameEngine.submitGuess` accepts a
  guess from ANY joined player at ANY time while a round is active —
  the opposite of Word Climb/Hangman's strict current-player check.
  This is deliberate per the original spec ("no rigid player order").
- **A round can end three ways**: someone guesses exactly right, the
  guess cap is hit, or the timer runs out. Only the first awards a
  round win — the other two reveal the secret and move on scoreless.
- **The "Closest Call" record is tracked independently of who wins**,
  same convention as Word Climb's `longestWord` — a player who never
  won a single round can still hold the match's best single guess,
  and the final board credits them for it.
- **Chaos is autonomous by design, not a per-feature toggle list.**
  The admin only sets intensity; `rollRoundChaosEvent`/`rollTeamChaos`
  decide the rest via weighted randomness (`config.CHAOS_EVENT_WEIGHTS`,
  `config.TEAM_CHAOS_CHANCE`). This was a deliberate choice over
  exposing `/gmn set bounty on`, `/gmn set sabotage on`, etc. — a wall
  of individual switches isn't "something worth toggling."
- **Chaos never hides information that changes fairness** — a bounty
  round and a sabotage target are always announced at round start
  (drama without secrecy), but the cursed number itself is NEVER
  revealed in advance (the whole point is the surprise).
- **`roundsWon` is really "points" once bounty rounds exist** — a
  normal round is always worth exactly 1, so non-chaos behavior is
  byte-for-byte unchanged; the field name stayed to avoid touching
  every call site for a rename.
- **Titles and Team Chaos never change match-tie-break logic** —
  `buildFinalBoard`'s normal-mode winner calculation (most points,
  ties broken by fewest total guesses) is untouched; Team Chaos is a
  fully separate branch that only activates when `gameState.teamChaos`
  is set, so a non-Team-Chaos match can never accidentally trip it.
- **State isolation, settings isolation, tier gate, bare-acronym
  rule, `forceStopActiveSession`** — all implemented per
  `ARCHITECTURE.md` and confirmed via `npm run verify`.
