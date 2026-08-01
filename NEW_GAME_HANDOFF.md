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
    <anything else your game needs>
```

`games-registry.js` discovers this folder automatically at boot — you
never touch `index.js`, `games-registry.js`, or any other game's files.

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
reintroduce it.

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

## 10. Before shipping

```
npm run verify
```

Fix every ❌. This checks your `config.js` exports, your `getGameState`
key isolation against every other loaded game, that
`package.json` declares anything you `require()`, and that your bare
acronym never goes stateful. If it fails, the message tells you exactly
which rule and which file.

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
- [ ] `COMMAND_REFERENCE.md` §3 updated with this game's section
- [ ] `npm run verify` passes with zero ❌
