# Word Climb (WCL)

A turn-based elimination word game built for live WhatsApp groups. Not
a variant of Word Ladder or Word Chain — the mechanic is bespoke: the
bot escalates a required word length one rung at a time, and misses
cost you strikes until you're out.

## The pitch

Every player takes a turn, in rotation. On your turn the bot gives you
a starting **letter** and a required **length** — say, "6 letters,
starting with G." You have 30 seconds to reply with a real word that
fits, and hasn't already been used this match. Get it right and you
climb; get it wrong, run out the clock, or repeat a word already used,
and that's a strike. **3 strikes and you're out.**

The required length is the same for every surviving player during one
full lap of the rotation — once everyone still standing has taken a
turn at, say, 5 letters, the length climbs to 6 for the next lap. It
runs from `config.MIN_LENGTH` (3) to `config.MAX_LENGTH` (12).

The match ends when either:
- **Only one player is left standing** — they win outright, or
- **The climb passes 12 letters with multiple survivors** — the
  survivor with the highest length they successfully answered wins
  (ties broken by fewest strikes).

The final board shows the elimination order (who went out, at what
length, and their personal best) plus the winner/ranked survivors.

## Files in this folder

| File | Role |
|---|---|
| `config.js` | `GAME_KEY`, `GAME_NAME`, `GAME_ACRONYM`, `PREFIX` (`!wcl`), `ADMIN_PREFIX` (`/wcl `), timers, strike count |
| `wordBank.js` | Real offline dictionary, grouped by length (3–12) then starting letter — lets the engine pick a letter that actually has valid words at the current length, and validate guesses. Backed by static `dictionary-data.json`, not a runtime dependency |
| `gameEngine.js` | Lobby (open/countdown/close, with auto-join), turn rotation, the escalating-length climb, strikes/elimination, turn timer + messaging, pause/resume — via `../gameKernel` (same contract as `HangmanGame/gameEngine.js`; this used to be true only for the turn timer and false for the lobby, which lived inline in `publicCommands.js` — fixed, now genuinely true for both) |
| `publicCommands.js` | `!wcl` commands (`start`, `join`, `help`) + routes live guesses to the engine — thin glue only, no state mutation of its own |
| `adminCommands.js` | `/wcl` commands (`status`, `begin`, `pause`, `resume`, `stop`, `reset`, `setturnseconds`), gated on `senderTier` + game-access scope per `ARCHITECTURE.md` §5 |
| `matchSummary.js` | Builds and returns the final board — pure bookkeeping, never calls `sock.sendMessage` (see `ARCHITECTURE.md` §10.2) |

## Switching to Word Climb

```
/game setgame wordclimb
```

## Public commands (`!wcl`)

| Command | What it does |
|---|---|
| `!wcl` (bare) | Explainer card — never starts anything, per §9 |
| `!wcl start` | Open a lobby (subject to `publicCanStart`) |
| `!wcl join` | Join the open lobby |
| `!wcl help` | Same as bare `!wcl` |

To **answer**, just type a word during your turn. No prefix needed.

## Admin commands (`/wcl`)

| Command | What it does |
|---|---|
| `/wcl status` | Lobby/climb state, current rung, turn timer setting, paused/live indicator |
| `/wcl pause` / `/wcl resume` | Freeze / unfreeze the turn timer mid-climb |
| `/wcl stop` / `/wcl end` | End the session immediately |
| `/wcl reset` | Hard reset — wipes session for this chat |
| `/wcl setturnseconds <10-90>` | Change the per-turn timer for the *next* match |
| `/wcl help` | Admin command list |

**Not handled here:** who gets ADMIN tier in the first place, which
game(s) they're scoped to, or the bot-wide `publicVisible` /
`publicCanStart` / `autoJoin` toggles. Those live at `/admin` and
`/game` respectively — see the root `COMMAND_REFERENCE.md` §1. They
used to be reachable only through Hangman's admin commands even though
they govern whichever game is active; that's fixed now (`ARCHITECTURE.md`
§10.4).

## Design notes

- **Turn-based, not simultaneous.** Only the current player's message
  is consumed as a guess (`gameEngine.submitGuess` checks
  `senderNumber === gameState.currentPlayer`) — this is what makes
  "skips you" and "3 strikes" meaningful the way a chain/relay game
  needs them to be, rather than a free-for-all like Word Chain.
- **Strikes are cumulative across the whole match**, not reset per
  lap — a player who's been sloppy across three different rungs is
  just as eliminated as one who bombed three times in a row.
- **The word bank is a real offline dictionary (3-12 letters), not a
  hand-picked pool.** Generated once, offline, from the `word-list`
  npm package (234k+ words after filtering), deduped, capped at 120
  words per length/letter cell, and passed through a profanity filter
  — then shipped as static `dictionary-data.json`, not a runtime
  dependency (that package's current version is ESM-only, which
  would conflict with this project's CommonJS setup if required
  directly — see `wordBank.js`'s header for the full reasoning).
  `wordBank.isValidWord()` is still the only function anything else
  in this game calls — regenerating or re-filtering the data later
  never touches any other file.
- **State isolation, settings isolation, tier gate, bare-acronym
  rule, `forceStopActiveSession`** — all implemented per
  `ARCHITECTURE.md` and confirmed via `npm run verify`.
