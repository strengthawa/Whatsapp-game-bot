# NEW_GAME_HANDOFF.md — adding game folder #4 (or #5, #6...)

This is the step-by-step spec for another AI or dev dropping a new game
into this bot. Read `ARCHITECTURE.md` first — it's the actual contract
and the "why" behind every rule below. This file is the checklist
version: what to import, what to create, what "done" looks like.

---

## 1. Before writing any code

Answer these two questions. They decide almost everything else:

- **Does this game have a live "round" that can be paused?** (A turn
  timer ticking, a lobby counting down, something with state that
  persists between messages.) If yes → you'll use the kernel's
  pause/resume. If no (like `RoastGame` — every request is a stateless
  lookup) → skip pause/resume entirely, don't add it for symmetry.
- **Does this game need a public "start a lobby" step, or is every
  interaction a one-shot command?** If it has a lobby → your
  `gameEngine.js` owns opening/counting down/closing it (see §4 below).
  If not → you likely don't need `openFreshLobby` at all.

## 2. Required files

```
/YourGameName/
    config.js           ← REQUIRED
    gameEngine.js        ← REQUIRED
    adminCommands.js     ← REQUIRED
    publicCommands.js    ← REQUIRED (or fold into gameEngine.js — either works)
    matchSummary.js       ← OPTIONAL, only if there's a report worth building
    README.md            ← REQUIRED — this game's own rules + command list
    tests.js             ← REQUIRED — see §10 below
    <anything else your game needs>
```

`games-registry.js` discovers this folder automatically at boot — you
never touch `index.js`, `games-registry.js`, or any other game's files.
`scripts/run-tests.js` discovers `tests.js` the same way — you never
touch that file either.

## 3. `config.js` — copy this shape exactly

```js
module.exports = {
    GAME_KEY:      'yourgame',      // lowercase, unique — checked at boot
    GAME_NAME:     'Your Game Name',
    GAME_ACRONYM:  'YGN',
    PREFIX:        '!ygn',          // public prefix
    ADMIN_PREFIX:  '/ygn ',         // admin prefix — note the trailing space
    BOT_EMOJI:     '🎯',            // used by kernel.buildCard()
    DIVIDER:       '━━━━━━━━━━━━━━━━━━━━━━',
    // ...any tuning constants your game needs
}
```

## 4. `gameEngine.js` — what to import, what to build

```js
const kernel = require('../gameKernel')
const { nameTag, resolveSetting } = require('../permissions')
const config = require('./config')
```

- **`getGameState(chatId, games)`** — REQUIRED. State key must be
  `${config.GAME_KEY}:${chatId}`, never the bare `chatId`
  (ARCHITECTURE.md §4 — this is the single most-violated rule when
  people skip this doc).
- **If you have a lobby**, write `openFreshLobby(chatId, ctx)` +
  `startLobbyCountdown` + `closeLobbyAndStart` following
  `WordClimbGame/gameEngine.js` as the reference — it's the cleanest
  current example of the engine-owns-the-lobby pattern. Do **not** put
  any of this inline in `publicCommands.js`; that's exactly the
  layering bug this handoff exists to prevent from recurring.
- **If you have pause/resume**, wrap `kernel.pauseTimer` /
  `kernel.resumeTimer` with your own timer's clear/re-arm logic — see
  either `HangmanGame` (interval-based) or `WordClimbGame`
  (timeout-based) `gameEngine.js` for the two reference shapes.
- **`forceStopActiveSession(chatId, ctx)`** — optional but recommended;
  see ARCHITECTURE.md §10.
- **If your difficulty climbs along a numeric axis** (word length, round
  number, anything that only goes up), use
  `kernel.computeScaledSeconds({ current, min, max, startSeconds, floorSeconds })`
  instead of a fixed turn timer — linear interpolation from
  `startSeconds` at `min` down to `floorSeconds` at `max`, no per-level
  table to hand-maintain. See `WordClimbGame/gameEngine.js`'s
  `turnSecondsFor()` for the reference shape, including how it lets an
  admin's fixed override win outright over the curve.
- **For any duration you show on a board** (total match time, a
  player's own time-on-clock), use `kernel.formatDuration(ms)` instead
  of hand-rolling `padStart` math — mm:ss, or h:mm:ss past an hour.
- **If you want to show players' own accumulated thinking time**, call
  `kernel.markTurnStart(gameState)` when a turn is announced,
  `kernel.markPauseStart(gameState)` / `kernel.markPauseEnd(gameState)`
  around your existing pause/resume, and
  `kernel.accumulateTurnTime(gameState, player, capMs)` when a turn
  resolves (answered or timed out) — pause time is automatically
  excluded, and `capMs` (pass your current turn's own timeout length)
  stops a delayed callback from ever over-crediting. All state lives
  under `gameState.turnStartedAt` / `pausedAt` / `pausedMsThisTurn` /
  `answerTimeMs`, so multiple games in the same process never collide.
  See `WordClimbGame/gameEngine.js` for the reference wiring and
  `WordClimbGame/matchSummary.js` for how it's surfaced on the final
  board.

## 5. `publicCommands.js` — the bare-acronym rule is non-negotiable

```js
const kernel = require('../gameKernel')
```

```js
if (body === config.PREFIX || subCmd === 'help') {
    await sock.sendMessage(from, {
        text: kernel.buildCard(config, `${config.GAME_NAME} (${config.GAME_ACRONYM})`,
            `🤖 ${kernel.botIdentityLine()}\n\n` +
            `...your game's actual rules text...`)
    })
    return true
}
```

This branch must come **before** any `'start'` check, must never touch
game state, and must be **one message** — no ping/pong volleys, no
multi-message intros. `scripts/verify-games.js` check 6 enforces this
dynamically at boot; a game that fails it is loaded but flagged.

## 6. `adminCommands.js` — the tier gate is the first line, always

```js
const senderIsCreator = senderTier === TIERS.CREATOR
const isAdmin = senderIsCreator || senderTier === TIERS.ADMIN
if (!isAdmin) return
```

Then, for any unrecognized subcommand at the end of your handler:

```js
await sendSafeMessage(sock, replyTo, {
    text: `⚠️ *Unknown command.* Try \`${config.ADMIN_PREFIX}help\`.`
})
```

Explicit error, not silence — see ARCHITECTURE.md §10.3.

**Do not add `set public` / `set start` / `set autojoin` here.** Those
are bot-wide now (`/game set ...`, in `game-switch-commands.js`) — see
ARCHITECTURE.md §10.4 for the rule on which bucket a setting belongs in.
If your admin dashboard needs to reference them, point to `/game`, don't
duplicate the toggle.

## 7. `matchSummary.js` — only if you have one, and only pure

```js
function buildYourReport(gameState, outcome, tag) {
    // ...compose text/mentions...
    return { text: report, mentions: [...mentionSet] }
}
module.exports = { buildYourReport }
```

Never `sock.sendMessage` from inside this file. The caller
(`publicCommands.js`) sends. See ARCHITECTURE.md §10.2 — this exact
inconsistency (one game's `matchSummary.js` sent directly, another only
returned) was a real bug found and fixed in this codebase; don't
reintroduce it. **Update, this session:** a second, missed instance of
the same bug was found in `HangmanGame/gameEngine.js` — its skip-timeout
elimination path was still calling a `matchSummary.sendMatchReport()`
that had never actually been exported (only `buildMatchReport()` was),
which would have thrown the first time that specific path fired live.
Fixed to call `buildMatchReport()` + `sock.sendMessage()` directly, same
as every other call site. Lesson: "this was fixed" doesn't mean every
call site was checked — grep for the banned function name across the
whole game folder, not just the file you're already looking at.

- **Board shape convention**: every final board shows one stat line per
  participant — winner included, not just a win/loss flag — and one
  disqualified-count line, no dividers, no footer tip. See
  `WordClimbGame/matchSummary.js` and `HangmanGame/matchSummary.js` for
  the reference shape; a new game should match it rather than invent
  its own report layout.
- **Track a match "record" independently of who wins.** Don't assume the
  winner automatically holds your game's best-stat record (longest
  word, highest score, fastest time) — trace through whether an
  eliminated player could out-perform the eventual winner on that one
  stat before the match ended. `WordClimbGame`'s `longestWord` field is
  the reference: updated on every qualifying event regardless of who
  ends up winning, always shown on the board with credit to whoever
  actually earned it.

## 8. `README.md` — what it must say, accurately

- What the game is, how a round is won/lost
- Full command list (public + admin) — this should match what
  `COMMAND_REFERENCE.md` says about your game once you add your section
  there (see §9 below)
- Any privacy/delivery guarantees your game makes ("DM only", etc.)
  **must be backed by an actual code check**, not just stated. If you
  can't point to the line of code that enforces it, don't claim it —
  see RoastGame's fix in this pass for exactly this mistake.

## 9. Update the shared docs (last step, not optional)

- Add your game's row/section to `COMMAND_REFERENCE.md` §3, following
  the existing Hangman/Word Climb/Roast Game sections as the template.
- If your game introduces a genuinely new *kind* of setting or pattern
  (not covered by anything in `ARCHITECTURE.md`), add a section there
  too — don't leave future AI/devs to reverse-engineer it from your code.

## 10. `tests.js` — required, and it exists to catch YOUR assumptions

Every past game folder shipped with an assumption that turned out
false and was only found after a real deploy broke: Hangman's solo-game
floor, WordClimb's hardcoded 2-player minimum, RoastGame's unenforced
"DM only" claim. `tests.js` is the mechanism that makes those specific
mistakes structurally impossible to repeat unnoticed — it is not
generic boilerplate, it is where you encode the specific things you are
assuming about your own game and prove them.

```js
const { makeCtx, run, assert, assertEqual, report, resetCounts } = require('../scripts/tests/_harness')
const config = require('./config')
const engine = require('./gameEngine')
// ...require whatever else your tests exercise

async function main() {
    resetCounts()
    console.log('YourGameName — behavioral tests')

    await run('describe the assumption you are proving true', async () => {
        // ...exercise engine/adminCommands/publicCommands, then assert()
    })

    return report()
}

module.exports = { main }
```

- Write one `run(...)` block per assumption you're making about your
  own game — not generic smoke tests. Ask yourself: "what have I just
  assumed is true without checking?" (minimum player count, who's
  allowed to run a command, what happens on a duplicate start, what a
  stateless vs stateful game does differently) — then write the test
  that would fail if that assumption were wrong. See
  `HangmanGame/tests.js`, `WordClimbGame/tests.js`, and
  `RoastGame/tests.js` for the reference shape and the specific bugs
  each one now locks in.
- `scripts/run-tests.js` auto-discovers your `tests.js` by folder name
  at run time — same mechanism `games-registry.js` uses for
  `config.js`/`gameEngine.js`/`adminCommands.js`. You never edit
  `scripts/run-tests.js`. If your folder has no `tests.js`, it's
  flagged with a `⚠️ WARN` (not a silent skip, not a hard failure) so
  a missing test file is always visible, never invisible.
- `npm test` (or `node scripts/run-tests.js`) must be run and passing
  before shipping, same as `npm run verify`.

## 11. Before shipping

```
npm run verify
npm test
```

Fix every ❌. `verify` checks your `config.js` exports, your
`getGameState` key isolation against every other loaded game, that
`package.json` declares anything you `require()`, and that your bare
acronym never goes stateful. `test` runs your `tests.js` (auto-discovered,
see §10) against every other game's — if it fails, the message tells you
exactly which assumption broke and in which file.

---

## Checklist (copy this into your PR/commit message)

- [ ] `config.js` exports all 6 required fields, `GAME_KEY` is unique
- [ ] `getGameState` keys state as `${GAME_KEY}:${chatId}`
- [ ] Bare `${PREFIX}` (no args) shows the explainer, one message,
      never touches state — checked before any other subcommand branch
- [ ] `adminCommands.js` gates on tier before anything else
- [ ] Unrecognized admin subcommand → explicit `⚠️ Unknown command` reply
- [ ] No `set public`/`set start`/`set autojoin` duplicated here — point
      to `/game` if relevant
- [ ] `matchSummary.js` (if present) only builds/returns, never sends
- [ ] Any privacy/delivery claim in the README is backed by a real
      code check
- [ ] `package.json` has every npm package this game `require()`s
- [ ] `tests.js` exists and encodes the specific assumptions this game
      makes (not generic smoke tests)
- [ ] `COMMAND_REFERENCE.md` §3 updated with this game's section
- [ ] `npm run verify` passes with zero ❌
- [ ] `npm test` passes with zero ❌
