# Session Handoff — Sky Graphics WhatsApp Game Bots

**Purpose of this file:** give any AI picking this up everything it needs
to continue without re-litigating decisions already made. If you're that
AI: read this first, then open the actual project files
(`ARCHITECTURE.md`, `COMMAND_REFERENCE.md`, `MEMORY.md`) for full detail —
this file is the map, those are the territory.

---

## 1. What this project is

A pluggable, multi-game WhatsApp bot (Node/CommonJS, Baileys) built by
one person (self-taught engineer, brand: **Sky Graphics**) running
**three game plugins** off one shared root:

| Game | Key | Prefix |
|---|---|---|
| Hangman | `hangman` | `!hmg` / `/hmg` |
| Word Climb | `wordclimb` | `!wcl` / `/wcl` |
| Roast Game | `roast` | `!roast` / `/roast` |

Each game folder plugs into shared root infrastructure
(`permissions.js`, `gameKernel.js`, `games-registry.js`,
`admin-onboarding.js`, `game-switch-commands.js`, `index.js`). **A game
folder cannot run standalone** — it `require('../permissions')` etc.
This is one bot, three plugins, not three independent bots. (Flagged as
an open design question at the end of this file — the user was asking
whether true per-repo independence is wanted; not yet decided.)

---

## 2. Genesis — what was received, what was found

The user brought two zips: one with the three game folders, one (later)
with the actual root project. A full read-through of the code (not just
the docs) surfaced real bugs the user didn't know about:

- **RoastGame had no DM/group gate at all** — its whole pitch was
  "private, DM-delivered roasts," but `!roast me`/`savage` would fire
  the private roast card straight into a group if typed there. Fixed
  early — this was the most severe finding.
- **Hangman's bare command sent 4 messages** (ping/pong/latency/card)
  before the real explainer — leftover debug code on the
  highest-traffic command. Collapsed to one line.
- **`matchSummary.js` meant two different things** in Hangman vs. Word
  Climb (one sent messages itself, one didn't) — unified to "pure
  function, caller sends" everywhere.
- **Admin game-access scoping only worked in Hangman.** WordClimb and
  RoastGame's admin handlers checked tier but never checked
  `adminGameAccess` — an admin scoped to Hangman-only could still run
  every command in the other two games, unrestricted. This was a live
  permissions bug, found and fixed.
- **Phantom commands**: Hangman's own help dashboard advertised
  `/hmg set admin`/`confirm`/`cancel` as real commands; they only ever
  redirected to `/admin`. Docs claimed things the code didn't do.
- **Feature parity was fiction**: Hangman had pause/resume/auto-restart/
  word-pool CRUD; Word Climb had almost none of it, despite both being
  "pluggable games."

---

## 3. Everything that changed, in order

**Round 1 — core plumbing:**
- `!wcl begin` (any joined player, hardcoded 2-player floor) →
  `/wcl begin`, **admin-only**, floor now `config.MIN_PLAYERS_TO_BEGIN`
  (set to 1 — solo play is allowed and resolves cleanly).
- Word Climb's word bank rebuilt: was a hand-typed array capped at 8
  letters. Now a **real offline dictionary**, 3–12 letters, 234k+ words
  filtered/deduped/profanity-checked, shipped as static
  `dictionary-data.json` — **deliberately not** a live `require('word-list')`,
  because that package's current version is ESM-only and this project
  is CommonJS (would silently break). Generated once, offline, capped
  at 120 words per length/letter cell (~292KB file).
- `adminGameAccess` moved from a single string (`'all'` or one gamekey)
  to a proper **list model** (`'all' | string[]`). `/admin set` grants
  additively; `/admin clear [gamekey|all]` (new) revokes subtractively,
  same confirm/cancel safety net as `set`, auto-demotes if it empties
  the scope. `permissions.hasGameAccess()` is the one function
  everything reads through now — nothing inlines its own scope check.
- The scope-gate bug above: fixed in all three games by folding the
  check directly into `isAdmin` (not checking it separately further
  down, which used to leak the full help dashboard to a scoped-out
  admin even though mutating commands were blocked).

**Round 2 — branding, flow, and naming corrections (user pushback,
all valid):**
- **Terminology locked in: "Registered" vs. "Stationed."** Registered =
  connected to the bot/system, no game decided yet. Stationed =
  assigned to operate a specific game. Two distinct words, used
  consistently in every message and every doc.
- **Rebranding**: every file/doc had said `HMG Bot · Sky Graphics` —
  including root files and even other games' own files — treating one
  game's acronym as the platform's name. Fixed: root/shared files and
  docs now say `Game Bots · Sky Graphics`; each game's own files use
  their own name (`Hangman`, `Word Climb`, `Roast Game`).
- **`/admin approve` decoupled from game assignment.** It used to bake
  the gamekey into the key itself, before the person had even
  connected. Now: `/admin approve [num]` only authorizes the
  connection; redeeming a key makes someone **Registered with zero
  stations**; `/admin set [num] [gamekey|all]` is the one place a game
  ever gets decided, with its own distinct DM to the new admin. (A
  separate direct-install shortcut still exists: `/admin set` on a
  brand-new, never-approved number registers *and* stations them in
  one step — this was kept deliberately, not removed.)
- **`/game setadminaccess` deleted entirely** — it was a second,
  differently-behaved (replace vs. additive) path to the exact same
  thing `/admin set`/`/admin clear` already do. Station assignment now
  lives in exactly one place.
- **`/hmg clearadmin` → `/hmg resetsettings`.** The old name implied it
  touched admin identity; it never did (it reset Hangman's own
  `maxTries`). Worse: it (and `/hmg reset`) were still silently
  resetting `publicVisible`/`publicCanStart`/`autoJoin` — bot-wide
  values that had already been moved to `/game set ...` in round 1.
  That leak is now stripped out; a per-game command never touches
  bot-wide state again.
- **`/hmg start` split into `/hmg begin` + `/hmg skipcooldown`.** It used
  to silently do three different things depending on invisible state
  (force-start an open lobby / break a cooldown / error). `begin` now
  means exactly one thing, same name/tier/shape as `/wcl begin`, in
  every game that has a lobby. `skipcooldown` stays Hangman-specific
  (only Hangman auto-cools-down between rounds).
- Did a full project-wide sweep afterward for stale comments/docs still
  referencing the old command names (`index.js`, `ARCHITECTURE.md`,
  both READMEs, `WordClimbGame/adminCommands.js`) — all corrected.

Every round was verified against the project's own
`scripts/verify-games.js` (all 6 checks) plus a manual `node --check`
syntax pass on every file before delivery. Nothing shipped unverified.

---

## 4. Current command surface (the real one, post-fixes)

**Bot-wide, fixed prefix (`admin-onboarding.js` / `game-switch-commands.js`):**
- `/admin` — status (Creator/Registered admin) or request access (public)
- `/admin [key]` — redeem → Registered, zero stations
- `/admin approve [num]` / `/admin deny [num]` — Creator only
- `/admin set [num] [gamekey|all]` — Stations (additive), also the
  direct-install shortcut for a brand-new number
- `/admin clear [gamekey|all]` — Un-stations (subtractive); `/admin
  clear` with no args = full de-registration, Creator only, no confirm
- `/admin confirm` / `/admin cancel`
- `/game setgame [key]`, `/game set public|start|autojoin [on|off]`,
  `/game status`, `/game roletags on|off`

**Per game (`<prefix>` = `hmg`/`wcl`/`roast`):**
- Public: bare explainer, `join`, `start` (gated on `publicCanStart`,
  bypassed for admins)
- Admin: `status`, `begin` (shared name, min-players gated), `pause`/
  `resume`, `stop`/`end`, `reset`
- Hangman-only: `skipcooldown`, word-pool CRUD, `set maxtries`,
  `resetsettings`
- Word Climb-only: `setturnseconds`
- Roast Game: intentionally opts out of most of the above — no lobby,
  no live session, nothing to pause/stop/reset. Just `me`/`me again`/
  `savage`/`savage again` (DM-gated) and `/roast list`.

Full detail, always current: `COMMAND_REFERENCE.md` in the project root.

---

## 5. Known open items (do not silently drop)

- **"All except X" can't be stored as a standing rule.** `/admin clear
  [gamekey]` on a currently-unrestricted admin materializes "every
  other loaded game" as a one-time snapshot. A game folder added later
  won't automatically be excluded too — re-run the clear if that
  matters.
- **Independent-repo question is unresolved.** The user asked whether
  each game folder should be able to run as its own separate repo/bot.
  Current architecture: no — they're plugins sharing one root, not
  standalone. This was surfaced as an open question, not yet answered:
  does the user want (a) things to stay as-is (folders are copy-in
  modules into an existing shared root, matching `NEW_GAME_HANDOFF.md`),
  or (b) true per-repo independence (would need either duplicated root
  files per game, or a shared published package)?
- Two pre-existing minor items from before this session, still open:
  `index.js`/`games-registry.js` hardcode `'hangman'` as a fallback
  default active game key (low-risk); and unverified `.env` presence
  on the machine after a Railway→local hosting move.

---

## 6. Where things stand right now

Latest delivered zip: `sky-graphics-bot-restructured-v3.zip`, contains
the full project (root + all three game folders + `ARCHITECTURE.md` /
`COMMAND_REFERENCE.md` / `MEMORY.md` / `NEW_GAME_HANDOFF.md`, all kept
in sync with the actual code). Verified clean against
`npm run verify` and a full syntax pass at time of delivery. No pending
uncommitted fixes — the open items above are known gaps, not
in-progress work.
