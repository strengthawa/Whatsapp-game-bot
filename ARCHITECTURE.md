# ARCHITECTURE.md — the game-plugin contract

This document exists for one reason: **a deploy crashed, and several
bugs were found that a document like this should have made impossible.**
It defines the abstract structure every game folder — existing or future
— must follow. If you (human or AI) are building a new game for this
bot, this is the file to read first. If you're debugging a crash, the
"Failure modes this prevents" section at the bottom maps every rule here
to a real bug it was written to stop.

This is a contract, not a suggestion. `scripts/verify-games.js` enforces
large parts of it automatically — **run `npm run verify` before every
deploy** (it also runs automatically as `prestart`).

---

## 1. The project is a plugin host, nothing more

`index.js`, `permissions.js`, and `games-registry.js` know **nothing**
about any specific game. They only know the shape every game folder must
have. A game folder is added, removed, or broken without ever touching
these three files. If you find yourself editing `index.js` to add a new
game, stop — that almost certainly means the game folder isn't following
the contract below.

## 2. One game folder = one self-contained plugin

```
/YourGameName/
    config.js          ← REQUIRED. Identity + prefixes.
    gameEngine.js       ← REQUIRED. Pure game-state logic.
    adminCommands.js    ← REQUIRED. "/" command handler.
    publicCommands.js   ← Public "!" command + live-play handler
                         (or export handlePublicMessage from gameEngine.js
                         instead — either location works).
    matchSummary.js      ← Optional. Win/loss bookkeeping, if useful.
    (any other files your game needs — dictionary.js, solver.js,
     wordBank.js, display.js, etc. — are entirely up to you.)
```

`games-registry.js` scans **every top-level folder** in the project root
at boot. A folder becomes a loaded game only if it has all three required
files AND each one exports the right shape (see §3). Nothing is
hardcoded by folder name — dropping in a new folder is the entire
integration step. **A folder that fails its contract check is logged and
skipped — it must never take any other game, or the bot process, down
with it.**

## 3. Required exports — the exact contract

### `config.js`
```js
module.exports = {
    GAME_KEY:     'yourgame',      // lowercase, unique across all games
    GAME_NAME:    'Your Game Name',
    GAME_ACRONYM: 'YGN',           // shown in boot/status messages
    PREFIX:       '!ygn',          // public command prefix
    ADMIN_PREFIX: '/ygn ',         // admin prefix — note the trailing space
    // ...any tuning constants your game needs
}
```
`GAME_KEY`, `PREFIX`, and `ADMIN_PREFIX` are mandatory — the registry
rejects a game folder missing any of them. `GAME_KEY` must be unique; a
duplicate is logged and the second folder is ignored (first loaded wins).

### `gameEngine.js`
Must export **`getGameState(chatId, games)`**. `games` is a single plain
object **shared across every loaded game module** — see §4 for the rule
that makes this safe. Also export `handlePublicMessage(msgCtx)` here, OR
put it in `publicCommands.js` instead (both are auto-detected).

### `adminCommands.js`
Must export **`handleAdminCommand(ctx)`**. See §5 for the required
authorization gate — this is the single most important rule in this
document.

## 4. State isolation — the `games` object rule

**`games` is one shared plain object for the entire bot, not one per
game.** Every game's `getGameState(chatId, games)` MUST store its state
under a key prefixed with its own `GAME_KEY`, never the bare `chatId`:

```js
function getGameState(chatId, games) {
    const key = `${config.GAME_KEY}:${chatId}`   // ✅ correct
    if (!games[key]) games[key] = { /* fresh state */ }
    return games[key]
}
```

Never do this instead:

```js
function getGameState(chatId, games) {
    if (!games[chatId]) games[chatId] = { /* fresh state */ }  // ❌ WRONG
    return games[chatId]
}
```

**Why this matters, concretely:** the creator can switch the active game
in any chat at any time (`/game setgame ...`). If two games both key off
the bare `chatId`, the second game to run in that chat inherits the
*first* game's leftover state object — wrong shape, wrong fields,
silently. This is not theoretical: it's exactly what crashed
`getScoreboard()` in this codebase (a `TypeError` on `state.scores`,
because the leftover object was a different game's state entirely). The
fix must be structural, not a one-off patch, which is why it's rule #1
in this section and why `scripts/verify-games.js` checks it automatically
by calling every loaded game's `getGameState()` on the same fake chat id
and asserting none of them return the same object reference.

If your game needs to directly manipulate `games[...]` anywhere outside
`getGameState` (a reset command, for example), use the same prefixed key
— or better, export a `stateKey(chatId)` helper from `gameEngine.js` and
reuse it everywhere, the way `WordLadderGame` does.

**The exact same rule applies to `settings`, not just `games`.**
`settings` (via `resolveSetting`/`writeSetting` in `permissions.js`) is
also one shared plain object for the entire bot. A per-game tunable
(difficulty, a timer length, a strike count, anything only your game
cares about) must be written under a key prefixed with your `GAME_KEY`:

```js
writeSetting(tier, `${config.GAME_KEY}_difficulty`, value, settings)   // ✅
resolveSetting(`${config.GAME_KEY}_difficulty`, settings, 'easy')      // ✅
```

Never a bare generic name like `'difficulty'`, `'timerSeconds'`, or
`'maxStrikes'` — nothing stops a second game from picking the exact same
generic name later and silently reading or overwriting the first game's
setting. Only truly bot-wide flags that are meant to be shared on purpose
(`publicVisible`, `publicCanStart`, `adminNumber`, `adminGameAccess`) may
stay unprefixed. This was found as a latent (not-yet-triggered) collision
risk in `WordChainGame`, which stored `difficulty` / `maxStrikes` /
`timerSeconds` as bare keys — fixed by prefixing all three with
`wordchain_`.

## 5. Every admin command handler MUST gate on tier — no exceptions

`ctx.senderTier` is always one of `permissions.TIERS.CREATOR / ADMIN /
PUBLIC`. The very first thing `handleAdminCommand` does, before looking
at `cmd[0]` at all, is refuse anyone who isn't at least ADMIN:

```js
const senderIsCreator = senderTier === TIERS.CREATOR
const isAdmin = senderIsCreator || senderTier === TIERS.ADMIN
if (!isAdmin) return   // or `return false` — match your file's convention
```

**This was missing entirely in two of the six existing games**, and the
result was a real authorization bypass: any random group member could
run every admin command in those games, including ones that changed
settings. There is no command in `adminCommands.js` that should be
reachable without this check running first. If a command is meant to be
public (like a self-service "claim the admin role" command), put that
check in `publicCommands.js`, not here.

After the tier gate, also respect the creator's per-game admin scoping
(the confirmed ADMIN — never the CREATOR — can be restricted to one or
more games via `/admin set`/`/admin clear` — the only place station
assignment happens; see COMMAND_REFERENCE.md §1 for the Registered
vs. Stationed distinction).
Use `permissions.hasGameAccess()` rather than inlining this check —
it's the one function that knows `settings.adminGameAccess` can be
`'all'`, an array, or (for data written before the list model) a bare
legacy string:

```js
const { hasGameAccess } = require('../permissions')
const isScopedIn = senderIsCreator || hasGameAccess(config.GAME_KEY, settings)
const isAdmin    = (senderIsCreator || senderTier === TIERS.ADMIN) && isScopedIn
if (!isAdmin) return
```

Fold this into `isAdmin` itself rather than checking it separately
further down the function — Hangman's original version computed
`isAdmin` first and only checked scope later, right before the
mutating commands, which meant a scoped-out admin still received the
*full help dashboard* (an information leak, not a mutation risk, but
still not "total silence"). Folding the scope check into `isAdmin`
directly means every command — including `help` — gets exactly the
same silent refusal.

**This scope check was found completely missing** in `WordClimbGame`
and `RoastGame`'s admin handlers — only `HangmanGame` had it. An admin
stationed on Hangman-only could still run every command in the other
two games, unrestricted. If you're adding a new game folder, copy the
pattern above verbatim; don't reimplement it, and don't skip it because
"it probably doesn't matter for this game" — it mattered here too,
right up until someone checked.

## 6. The `sendSafeMessage` contract

`sendSafeMessage(sock, jidOrNumber, payload)` — **always three
arguments, `sock` first, a Baileys payload object third** (e.g.
`{ text: '...' }`). It is passed to every game via `ctx.sendSafeMessage`
(admin ctx) or `msgCtx.sendSafeMessage` (public ctx). It never throws —
a malformed call is logged and normalized where possible, but **do not
rely on that as a substitute for calling it correctly**; a silently
swallowed send is still a broken feature.

If your file's existing code was written against a different local
convention (e.g. `sendSafeMessage(jid, text)`), the safe fix is a
one-line shim at the top of the function, not touching every call site:
```js
const { sendSafeMessage: _sendSafeMessage, sock } = ctx
const sendSafeMessage = (jid, text) =>
    _sendSafeMessage(sock, jid, typeof text === 'string' ? { text } : text)
```
This is the actual fix applied to `WordLadderGame` in this pass — see
`reports/CHANGE_LOG.md`.

If you'd rather call `sock.sendMessage(jid, payload)` directly (bypassing
the shared helper entirely, the way `MomentumGame` and `WordChainGame`
do), that's fine too — just always wrap it in try/catch or let the
message-loop-level safety net in `index.js` catch it (see §8). Never call
`sock.sendMessage` unguarded inside a `setInterval`/`setTimeout` callback,
since those aren't covered by the per-message try/catch.

## 7. `package.json` is not optional

Every `require('some-npm-package')` anywhere in the codebase must have a
matching entry in `package.json`'s `dependencies`. No `package.json` at
all — or one missing a dependency a game actually uses — means the
process crashes on boot the moment that file is `require`'d, before any
of the safety nets below can help, because it happens at module-load
time. `npm run verify` scans the entire codebase for exactly this and
fails loudly if anything is missing.

## 8. Crash containment — defense in depth

Even with the rules above followed perfectly, assume a bug will still
slip through someday. The bot has three independent layers so that a bug
in one game can never take the other five, or the whole process, down
with it:

1. **`games-registry.js`** — a game folder that throws while loading
   (bad syntax, a missing dependency, whatever) is caught, logged, and
   skipped. The other games still boot normally.
2. **Per-message try/catch in `index.js`** — every single inbound
   WhatsApp message is processed inside its own try/catch. A bug
   handling one message logs and moves on; it never blocks or kills the
   `messages.upsert` listener.
3. **`process.on('unhandledRejection'/'uncaughtException')`** — the
   final backstop, for errors thrown outside any message handler (e.g.
   inside a `setInterval` timer callback). Logs and keeps the process
   alive instead of exiting.

None of these three replace writing correct code — they exist so that
*when* something is still wrong, the failure mode is "one broken feature,
logged clearly" instead of "the entire bot is down on Railway with no
clue why."

## 9. Bare acronym → explain the game. Always. No exceptions.

This is the single most important *player-facing* rule in this document,
the same way §5's tier gate is the most important *security* rule.

**Typing the bare public prefix with no subcommand — `!ygn`, nothing
else — must always send the game's explainer (rules + command list) and
must NEVER start a session, join a lobby, submit a guess, or do anything
else stateful.** This is true regardless of who sends it — public,
admin, or creator. An admin typing the bare acronym is asking "what is
this," exactly like anyone else; `publicCanStart` and every other
start-gate is irrelevant to this specific case because bare-acronym must
never reach a start branch at all.

**The bug this prevents, concretely:** two of the six games in this
codebase (`TargetNumbersGame`, `TwentyFourGame`) wrote their bare-acronym
handling as `if (rest === '' || rest === 'start') { ...startSession... }`
— merging "nothing typed" and "the start subcommand" into the same
branch. A brand-new player typing just `!m4th` either force-started a
round with zero context, or silently hit the "only an admin can start"
wall — neither told them what the game even was. The other four games
(`HangmanGame`, `MomentumGame`, `WordChainGame`, `WordLadderGame`)
already got this right; use any of them as the reference pattern:

```js
// ✅ correct — bare acronym is its own branch, checked BEFORE 'start'
if (!subCmd || subCmd === 'help') {
    await sock.sendMessage(from, { text: HELP_TEXT })
    return true
}
if (subCmd === 'start') {
    // ...actual start logic, gated by publicCanStart/isAdmin as needed
}
```

```js
// ❌ wrong — bare acronym silently falls into 'start' logic
if (rest === '' || rest === 'start') {
    // ...
}
```

The explainer text itself should be short but self-sufficient: what the
game is, how a round is won/lost, and the handful of commands that
matter (at minimum `start`, and `join` if the game uses a lobby). Every
game's explainer is worded differently — that's fine, expected, and
where each game's personality shows — but the *trigger* (bare prefix,
checked first, before any other subcommand branch) and the *guarantee*
(never stateful) must be identical across every game, existing or
future. `scripts/verify-games.js` check 6 enforces this dynamically: it
actually invokes each game's real message handler as an ADMIN sending
the bare prefix and fails the build if the game's state goes active as a
result — so this can never regress silently again.

## 10. Optional: clean hand-off between games (`forceStopActiveSession`)

**The gap this closes:** `activeGameChatRef` — the pointer marking "this
chat has a live game session" — is one shared object for the entire bot,
not one per game (see §4's same rule for `games`/`settings`). Before this
section existed, `/game setgame [key]` only ever did this:

```js
settings.activeGame = game.config.GAME_KEY
saveSettings()
// ...confirmation message...
```

It never checked whether the *previous* game had a session running in
that chat, and never stopped one. Concretely: if Hangman has a round live
when the creator runs `/game setgame wordladder`, Hangman's `gameState.
active` stays `true` and its timers (turn countdown, disqualification,
cooldown) keep firing on their own schedule — but every new message in
that chat now routes to Word Ladder instead, so Hangman can never receive
another guess to end normally. Its orphaned timers keep posting into the
group (timeouts, "you're disqualified," etc.) at the same time Word
Ladder is posting its own round messages — genuinely interleaved,
confusing output in one chat.

**The fix — entirely optional per game, nothing is mandatory:**

```js
// gameEngine.js — optional export
function forceStopActiveSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const wasRunning = !!(gameState.active || gameState.lobbyActive)

    // clear every timer your game uses, then reset to idle:
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
    if (gameState.turnTimer)  clearInterval(gameState.turnTimer)
    gameState.active = false
    gameState.lobbyActive = false

    if (typeof persistGames === 'function') persistGames()
    return wasRunning   // true if there was something worth reporting
}
module.exports = { /* ...your other exports..., */ forceStopActiveSession }
```

`game-switch-commands.js`'s `setgame` handler checks for this export
generically, the exact same pattern already used for `getGameState` /
`handleAdminCommand`:

- **Exported and a session was running** → it's called, the session is
  cleanly stopped, `activeGameChatRef.value` is cleared, and the switch
  confirmation says exactly what was stopped.
- **Exported but nothing was running** → silently a no-op, switch
  proceeds normally.
- **Not exported at all** → the switch still happens (nobody is ever
  blocked from switching), but the confirmation message honestly warns
  that the previous game may still have a live session and suggests its
  own `stop` command first, instead of saying nothing and leaving
  orphaned timers running silently.

Never make a game's own logic reach into another game's state to stop
it — `forceStopActiveSession` is the only sanctioned entry point, called
generically through the registry, never a direct file-to-file reference
between two game folders. This preserves the same independence guarantee
as every other rule in this document: no game ever knows another game
exists.

## 10.1 The shared kernel (`gameKernel.js`)

Some behaviors are genuinely game-agnostic but were, for a while, built
exactly once inside `HangmanGame` and never abstracted out — every later
game either copy-pasted the pattern (drift risk, exactly what happened:
`HangmanGame` and `WordClimbGame`'s lobby-open logic ended up living in
two different architectural layers under the same folder-naming
convention) or simply lacked the feature. `gameKernel.js`, at the project
root, is where those pieces now live. Import it the same way you import
`permissions.js`:

```js
const kernel = require('../gameKernel')
```

Currently exported:

- **`buildCard(config, titleLine, bodyText)`** — the one consistent
  header/divider/footer frame every "card" message should use. Don't
  hand-roll your own divider/footer combination per game; three
  different footer phrasings across three games is exactly the drift
  this prevents.
- **`pauseTimer(gameState, activeTimer, clearFn)`** /
  **`resumeTimer(gameState, rearmFn)`** — the paused-flag contract and
  clear/re-arm sequencing for pause/resume. Every game's turn timer is
  shaped differently (a self-clearing `setInterval` vs. a one-shot
  `setTimeout`), so the kernel doesn't own the timer type — it owns the
  transition, and your `gameEngine.js` supplies the clear/re-arm
  callbacks specific to your timer. See `HangmanGame/gameEngine.js`'s
  or `WordClimbGame/gameEngine.js`'s `pauseSession`/`resumeSession` for
  the reference pattern.
- **`botIdentityLine()`** — the single-line liveness signal (`🤖
  online`) every game's bare-command card shows as its first line.
  Replaces any per-game "ping/pong" debug volley — a bare command
  should be **one message**, not several.

`pauseSession`/`resumeSession` are optional exports, same rule as
`forceStopActiveSession` in §10: a game with no live "round" to pause
(`RoastGame`, for instance — there's no session in progress between a
`!roast me` and its reply) simply doesn't implement or expose them, and
its admin dashboard doesn't advertise `pause`/`resume` at all. Don't add
these to a game for symmetry's sake if there's nothing to pause.

## 10.2 The `matchSummary.js` contract — pure functions only

If your game has a `matchSummary.js`, its exported functions **build and
return a report, they never call `sock.sendMessage` themselves.** The
caller (`publicCommands.js`, usually) owns sending:

```js
// matchSummary.js
function buildMatchReport(gameState, outcome, tag) {
    // ...compose the report text/mentions...
    return { text: report, mentions: [...mentionSet] }
}
module.exports = { buildMatchReport }
```

```js
// publicCommands.js
const report = matchSummary.buildMatchReport(gameState, outcome, tag)
await sock.sendMessage(from, { text: report.text, mentions: report.mentions })
```

This was previously inconsistent: `HangmanGame`'s `matchSummary.js` sent
directly (an active sender), `WordClimbGame`'s only ever returned a
value (pure bookkeeping) — same filename, same stated role in this
document's own table, opposite contract. That's exactly the kind of trap
that breaks a future game copying "the pattern" from whichever file it
happened to read first. Pure-return, always — if you don't have a
report worth building, don't export a `matchSummary.js` at all.

## 10.3 Unknown-subcommand convention

- **Admin (`/`) commands:** an unrecognized subcommand gets an
  **explicit reply** (`⚠️ Unknown command. Try /yourgame help.`), never
  silence. An admin typo deserves to know, not be left guessing —
  they're the one person actually supposed to be in control.
- **Public (`!`) commands:** an unrecognized subcommand is **silently
  ignored** (or, if you'd rather, falls through to the same explainer
  card as the bare acronym). Public chat is noisy already; don't add a
  bot reply to every random message that happens to start with your
  prefix.

Pick one of these per surface and apply it consistently — don't decide
file-by-file. This was previously inconsistent across all three
existing games and is now standardized to the rule above in each.

## 10.4 Bot-wide settings vs. per-game settings — where the line is

§4 already covers *how* to prefix a per-game setting. This is about
*which bucket a setting belongs in at all*, because getting this wrong
creates a specific, easy-to-miss bug: **`publicVisible`, `publicCanStart`,
and `autoJoin` govern whichever game is currently active, not any one
game in particular** — so they must be reachable regardless of which
game is active. They used to be exposed only through
`HangmanGame/adminCommands.js` (`/hmg set public`, etc.), which meant an
admin had no way to toggle them at all while a different game was
active — a real, live instance of the exact failure mode §1's "the
project is a plugin host, nothing more" rule exists to prevent, just one
level down (one *game*, not the host, owning a bot-wide concern).

They now live in `game-switch-commands.js`, reachable as `/game set
public|start|autojoin [on/off]` regardless of the active game. Rule of
thumb going forward: **if toggling a setting would stop making sense the
moment a different game became active, it's per-game and belongs behind
your own prefix (§4). If it would keep meaning the same thing no matter
which game is active, it's bot-wide and belongs in `game-switch-
commands.js`, not your game's folder — even if your game was the first
(or only) one to need it.**



```
npm run verify
```
This is also wired as `prestart`, so `npm start` runs it automatically.
It checks, in order: `package.json` completeness (1), that every game
folder in the project root actually loaded into the registry (2), that
every loaded game satisfies the export contract in §3 (3), that no two
games alias the same state key per §4 (4), flags any `sendSafeMessage`
call that doesn't look like it follows §6 (5), and dynamically invokes
every game's bare-acronym handling per §9 (6). Fix every ❌ before
deploying; ⚠️ warnings won't block a deploy but are worth reading.

---

## Failure modes this document prevents (and why each rule exists)

| What happened | Root cause | Rule that prevents it |
|---|---|---|
| Deploy crashed immediately on Railway | `package.json` was missing entirely — no dependencies installed, `require('@whiskeysockets/baileys')` threw at the top of `index.js` | §7 + `npm run verify` check 1 |
| `WordChainGame` would have crashed the moment it loaded | It requires the `word-list` npm package, which was never declared in `package.json` | §7 + `npm run verify` check 1 |
| 4 of 6 built games were completely unreachable | `games-registry.js` hardcoded a 2-folder allowlist instead of scanning the project root | §2 + `npm run verify` check 2 |
| Any random group member could run `/tgt ...` / `/m4th ...` admin commands | `adminCommands.js` computed `senderIsCreator` but never actually checked it (or ADMIN tier) before processing commands | §5 |
| `!wlg scores` crashed with a `TypeError` after switching from Hangman to Word Ladder in the same chat | Both games stored state at the bare `games[chatId]` key — Word Ladder inherited Hangman's leftover, wrong-shaped state object | §4 + `npm run verify` check 4 |
| `/wlg status` (and every other Word Ladder admin command) silently did nothing | `adminCommands.js` destructured a field named `from` that the shared ctx never provides (it's called `sender`) | §3 (contract shape) — always check the ctx fields index.js actually provides |
| Every `!wlg` command's replies silently failed | `sendSafeMessage` was called with the old 2-arg local convention against the real 3-arg shared contract | §6 |
| `/hmg reset` wiped every other game's saved data, not just Hangman's | It looped over the entire shared `games` object and deleted every key, and unconditionally deleted `games.json` | §4 — always scope bulk operations to your own `GAME_KEY:` prefix |
| Typing bare `!m4th` or `!tgt` (no subcommand) either silently force-started a round with no explanation, or hit a confusing "only an admin can start" wall | `publicCommands.js` merged the "nothing typed" case into the same `if` branch as the `'start'` subcommand | §9 + `npm run verify` check 6 |
| `WordChainGame`'s difficulty/timer/strikes settings were one future game's `writeSetting('difficulty', ...)` away from silently overwriting (or being overwritten by) another game's setting of the same name | Settings were written under bare generic keys (`'difficulty'`, `'timerSeconds'`, `'maxStrikes'`) instead of a `GAME_KEY`-prefixed key | §4 (settings sub-rule) |
| Switching games mid-round (`/game setgame ...`) left the previous game's timers running and posting into the group at the same time as the new game, with no message explaining what (if anything) had been stopped | `setgame`'s handler only ever wrote `settings.activeGame` — it never checked or stopped a live session in the shared `activeGameChatRef` chat | §10 (`forceStopActiveSession`) |
| `RoastGame`'s advertised privacy guarantee ("nobody in this group sees it") was a README claim, not a code guarantee — `!roast me` typed inside a group delivered the roast straight into the group | No check anywhere in `publicCommands.js`/`gameEngine.js`/`config.js` on whether the chat was a group or a DM before delivering | new: gate on chat type before any profile lookup, never just claim it in copy |
| `HangmanGame`'s dashboard advertised `/hmg set admin [number]` → `/hmg confirm`/`/hmg cancel` as live, working commands with real usage syntax; the actual handler for those tokens only redirects elsewhere | Nobody updated the displayed help text after the redirect was added | §10.4 pattern — a redirect-only handler should never also appear as a documented, syntax-bearing dashboard entry |
| Three different footer phrasings existed across cards (`_X Bot · Sky Graphics_ 🎨`, `_Created with ❤️ by Sky Graphics_ 🎨`, `_Sky Graphics — X_`), and one game's public explainer card had no footer at all | No shared card template — every file hand-rolled its own header/footer | §10.1 `kernel.buildCard` |
| The highest-traffic command (bare acronym, typed by literally every first-time player) sent 4 separate messages before the actual explainer card | A ping/pong debug snippet was left wired into production | §10.1 `kernel.botIdentityLine()` — one identity line, one message |
| An admin scoped to Hangman-only via `/game setadminaccess hangman` could still run every command in `WordClimbGame` and `RoastGame`, completely unrestricted | Only `HangmanGame`'s admin handler actually checked `settings.adminGameAccess` before proceeding — the other two only checked tier, never scope | §5 — use `permissions.hasGameAccess()`, don't reimplement or skip the scope check |
| `!wcl begin` let any joined player force-start the lobby, not just an admin, and required a hardcoded 2 players regardless of what the game actually needed | Early-start logic lived in `publicCommands.js` gated only on "you're in the lobby," with no `config`-driven floor | now `/wcl begin`, admin-only, gated on `config.MIN_PLAYERS_TO_BEGIN` |
| `WordClimbGame`'s word source was a hand-typed array capped at 8 letters, with no path to widen it without editing code | No dictionary was ever wired in, despite the file's own comment calling it a "drop-in upgrade later" | now backed by static, offline-generated `dictionary-data.json` (3–12 letters, profanity-filtered) — see `wordBank.js` header for why it's static rather than a live `word-list` require |

