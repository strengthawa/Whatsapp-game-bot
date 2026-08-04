# WhatsApp Game Bots · Sky Graphics

A WhatsApp game bot (built on Baileys) with a pluggable structure — the
creator can add and switch between games without touching the core bot.
Currently runs **five games**: **Hangman** (`hangman`), **Word Climb**
(`wordclimb`), **Roast Game** (`roast`), **Guess My Number**
(`guessmynumber`), and **Word Chain** (`wordchain`).

**→ Building a new game? Read [`ARCHITECTURE.md`](./ARCHITECTURE.md)
first.** That's the canonical plugin contract — this file is the tour.

**→ Want every command, the message-format conventions, and the file
layout in one place? Read [`COMMAND_REFERENCE.md`](./COMMAND_REFERENCE.md).**
This README won't repeat what's there.

**→ Before every deploy, run `npm run verify`** (`scripts/verify-games.js`).
It catches missing dependencies, unwired game folders, broken contracts,
and state-isolation bugs before any host sees them.

**→ Only one game is active at a time, bot-wide.** Switching with
`/game setgame [key]` makes every other game's public prefix stop
responding until you switch back — this isn't a bug, see
`ARCHITECTURE.md` if you're unsure why.

This project is written so it can be handed to **another AI** (or another
developer) to build a new game with **zero changes to any existing game
folder** — only the shared root files (`index.js`, `admin-onboarding.js`,
`game-switch-commands.js`, `games-registry.js`) are meant to be touched
across the whole project's lifetime, and even those only for genuinely
game-agnostic concerns. `index.js` in particular should never reference
a specific game's name/acronym directly — only `activeGame.config.*`.

---

## 1. Project structure

```
/index.js                  ← root orchestrator ONLY: connection, sender
                              resolution (LID/PN), message routing.
                              Contains no game-specific logic or strings.
/permissions.js             ← shared, game-agnostic: CREATOR/ADMIN/PUBLIC
                              tier resolution, setting overrides, name tags.
/admin-onboarding.js         ← "/admin ..." — bot-wide admin IDENTITY:
                              who is the admin, and which game(s) they
                              may operate. Fixed prefix, independent of
                              which game is currently active.
/game-switch-commands.js     ← "/game ..." — which game is currently
                              active, and the confirmed admin's scope.
                              Also a fixed prefix.
/games-registry.js           ← auto-discovers EVERY game folder at boot
                              (scans the project root — nothing hardcoded).
/package.json                ← REQUIRED — see ARCHITECTURE.md §7.
/scripts/verify-games.js      ← pre-deploy check, also runs via `npm start`.
/README.md                    ← this file.
/ARCHITECTURE.md              ← the plugin contract — read this to add a game.
/COMMAND_REFERENCE.md          ← every command, message shape, file layout.

/HangmanGame/       ← !hmg / /hmg
/WordClimbGame/     ← !wcl / /wcl
/RoastGame/         ← !roast / /roast

/<AnyNewGame>/              ← next game goes here; see ARCHITECTURE.md
    config.js
    gameEngine.js
    publicCommands.js
    adminCommands.js
    matchSummary.js         ← optional but recommended
    README.md               ← that game's own rules + commands
```

**Runtime files** (created automatically, never committed — see
`.gitignore`): `settings.json`, `words.json`, `games.json`, `names.json`,
`lidcache.json`, `auth_info/`.

**Not created automatically — you must make this yourself:** `.env`.
See §7 below; the bot cannot identify its own creator without it.

---

## 2. Settings that are game-agnostic

`settings.json` (root-level, shared across every game):

```jsonc
{
  "adminNumber": "",
  "adminJid": "",
  "activeGame": "hangman",        // which game folder is currently live
  "adminGameAccess": "all",       // "all" or a specific GAME_KEY
  "creatorRoleTag": true,         // (Creator) name tag — creator's own, sets via "/game roletags"
  "adminRoleTag": true,           // (Admin) name tag — admin's own, independent of the creator's
  "publicVisible": true,
  "publicCanStart": false
  // + any game-specific keys, namespaced by that game's GAME_KEY,
  // e.g. "wordclimb_turnSeconds" — see each game's config.js
}
```

- `activeGame` — read by `games-registry.getActiveGame()`. Only the
  **creator** can change it, via `/game setgame [key]`.
- `adminNumber` / `adminJid` / `adminGameAccess` — bot-wide admin
  identity, set via `/admin` (see `admin-onboarding.js`) — **never**
  from inside an individual game's own admin commands.

---

## 3. The plugin contract — summary

**See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full, authoritative
contract.** Short version: drop a folder with `config.js` +
`gameEngine.js` + `adminCommands.js` + `publicCommands.js` in the
project root, following the shapes documented there —
`games-registry.js` auto-discovers it, no other file changes.

---

## 4. How admin identity and game switching work end-to-end

Two separate, fixed, game-independent prefixes — neither lives inside
any individual game's folder:

- **`/admin`** answers *"who is registered on this bot, and what
  game(s) are they stationed on"* — bot identity. Request access,
  redeem a key to become Registered, then the creator **stations**
  them on a game separately with `/admin set [num] [gamekey|all]` —
  connecting and being assigned a game are always two distinct steps.
- **`/game`** answers *"which game is currently live, and what are
  the bot-wide toggles"* — configuration, not identity. `/game
  setgame [key]` switches games (cleanly stopping any live session
  first, if the outgoing game supports it); `/game set public|start|
  autojoin [on|off]` are the bot-wide toggles; `/game status` shows
  both at a glance. Station assignment does **not** live here —
  that's `/admin`'s job, exclusively.

Full command tables for all five games: [`COMMAND_REFERENCE.md`](./COMMAND_REFERENCE.md) §1.

---

## 5. Games built so far

| Game | Key | Public prefix | Admin prefix |
|---|---|---|---|
| Hangman | `hangman` | `!hmg` | `/hmg ` |
| Word Climb | `wordclimb` | `!wcl` | `/wcl ` |
| Roast Game | `roast` | `!roast` | `/roast ` |
| Guess My Number | `guessmynumber` | `!gmn` | `/gmn ` |
| Word Chain | `wordchain` | `!wch` | `/wch ` |

### Hangman (HMG)
Classic single-word elimination, adapted for a live group chat.
- Adaptive word-length difficulty — target length drifts based on group
  performance round to round (`gameEngine.adjustNextWordLength`).
- 2-minute post-round cooldown with an automatic fresh lobby — no admin
  action needed between matches.
- Per-player stick-figure elimination card, posted live in the **group**
  (not a DM) and tagged with that player's name + strike count, the
  moment they miss a guess.
- Full rules + command list: [`HangmanGame/README.md`](./HangmanGame/README.md).

### Word Climb (WCL)
Turn-based elimination — the required word length escalates a rung at
a time (3→8 letters), 3 strikes and you're out.
- Full rules + command list: [`WordClimbGame/README.md`](./WordClimbGame/README.md).

### Roast Game (RST)
Private, DM-delivered roasts, hand-curated once from real group chat
history — no live AI call, no rebuild command, no lobby or round.
- Content lives in `RoastGame/roastData.js` and is edited offline.
- Full rules, command list, and exclusion policy:
  [`RoastGame/README.md`](./RoastGame/README.md).

### Guess My Number (GMN)
Free-for-all number-guessing match — no turn order, anyone can guess
any time. Best of `N` rounds, Higher/Lower + coarse Hot/Cold proximity
tiers, range/guess-cap/timer all scale together with lobby size.
- 3 difficulty modes (Classic, Speed Run, Mega Grid) plus an
  autonomous **chaos** system (`/gmn chaos off|light|full`) — one
  admin dial; the engine itself decides which chaos event fires, on
  whom, and when (bounty rounds, a sabotage tax, a hidden cursed
  number, end-of-match titles, a rare whole-match Team Chaos split).
- Full rules + command list: [`GuessMyNumberGame/README.md`](./GuessMyNumberGame/README.md).

### Word Chain (WCH)
Live elimination word game — each word must start with the last letter
of the word before it, turn timer shrinks as the chain grows.
- Automatic category "sectors" cycle the whole match on their own
  (free/animals/fruits/countries), stacking scoring bonuses (rare
  letter, long word, speed, streak), and a steal window after any
  missed turn for another player to grab a rescue bonus.
- Full rules + command list: [`WordChainGame/README.md`](./WordChainGame/README.md).

---

## 6. Adding a new game

1. Read `ARCHITECTURE.md` end to end.
2. Create `<NewGame>/` with the required files (see §1 above).
3. Give it its own `GAME_KEY` / `PREFIX` / `ADMIN_PREFIX` in `config.js`
   — no other file needs to know it exists.
4. Write `<NewGame>/README.md` following the same shape as the other
   games' READMEs.
5. Run `npm run verify` before deploying. It checks the contract, state
   isolation, and the bare-acronym rule automatically.

---

## 7. Running it locally

```
npm install
```

**Before your first run**, create a `.env` file in the project root
(next to `index.js` — this file is never shipped, never committed, and
must be created by hand on every machine you run the bot on):

```
CREATOR_JID=23768XXXXXXX@s.whatsapp.net
```

Use your real WhatsApp number, digits only, in the full JID format
(`number@s.whatsapp.net`) — not a bare number, no `+`/spaces/dashes.
Without this file, the bot will still connect and pair via QR code, but
it will never recognize you as CREATOR — no boot DM, no `/game`
commands, no admin approvals will work, because `permissions.js` has
nothing to compare the sender against.

Then:

```
node index.js
```

Scan the printed QR code with WhatsApp on first run. `auth_info/` then
holds the session — delete it to force a fresh QR-code login.

---

## 8. Hosting

Previously hosted on Railway. Baileys needs an **always-on process with
persistent disk** (for `auth_info/`, `settings.json`, etc.) — serverless
platforms and free tiers that sleep on inactivity aren't a fit. Current
options in use or under consideration: running locally, or a small
always-on VPS (Oracle Cloud's Always Free tier, or a low-cost DigitalOcean
droplet). On any host other than local, set `CREATOR_JID` through that
host's environment-variable UI instead of a `.env` file.
