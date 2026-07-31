# COMMAND_REFERENCE.md — HMG Bot · Sky Graphics

One file to answer three questions: **what commands exist**, **what does
every message look like**, and **what does a game folder look like**.
Everything below reflects what's actually implemented — verified against
`scripts/verify-games.js` — not aspirational.

---

## 1. Universal commands (bot-wide, work no matter which game is active)

These live in shared, game-agnostic files — never duplicated per game.
Both use a **fixed prefix** so they always work, even if the currently
active game is broken or its folder is missing entirely.

### `/admin` — admin *identity* (who is the admin, for which game) — `admin-onboarding.js`

| Command | Tier | What it does |
|---|---|---|
| `/admin` | Everyone | Request access. Generates a key, DMs the creator to approve/deny |
| `/admin [key]` | Everyone | Redeem a key you were given |
| `/admin approve [num] [gamekey\|all]` | Creator | Deliver the key, scoped to one game or all |
| `/admin deny [num]` | Creator | Void a pending request |
| `/admin set [num] [gamekey\|all]` | Creator or Admin | Assign admin directly, no key needed |
| `/admin confirm` / `/admin cancel` | Creator or Admin | Apply or discard a pending `set` |
| `/admin clear` | Creator only | Remove the admin identity entirely |
| `/admin help` | Creator or Admin | This command list |

All replies go **privately to the sender's own DM** — never posted back
into the group the command was typed in.

### `/game` — which game is active, and what the admin can touch — `game-switch-commands.js`

| Command | Tier | What it does |
|---|---|---|
| `/game setgame [key]` | Creator | Switch the active game (cleanly stops the old one's live session first, if it supports that) |
| `/game setadminaccess [gamekey\|all]` | Creator | Scope which game(s) the admin's commands work on |
| `/game status` | Creator or Admin | Active game, admin's scope, all available game keys |
| `/game roletags on\|off` | Creator | Toggle the (Creator)/(Admin) name tag, bot-wide |

**Why two prefixes, not one:** `/admin` answers "who is allowed to run
admin commands, and for which games" — bot identity. `/game` answers
"which game is currently live, and what can the *current* admin touch"
— bot configuration. Neither depends on the other, and neither lives
inside any individual game's folder.

---

## 2. Message structure — one template, tweaked per game

Every message in this bot is one of exactly two shapes. There is no
third shape — if a new message doesn't fit one of these, that's a sign
to reconsider it rather than invent a new format.

### Shape A — the "card" (big/structural moments: lobby open, final
board, onboarding, access granted)

```
{DIVIDER}
{maybe 3 spaces}{BOT_EMOJI or specific emoji}  {Title, Title Case}
{DIVIDER}

{body — usually 1 blank-line-separated paragraphs, bold for emphasis}

{DIVIDER}
_{game or brand attribution in italics}_ {closing emoji}
```

### Shape B — the everyday transactional reply (status, confirmations,
warnings, errors)

```
{status emoji} *{Title, sentence case}.* {optional trailing emoji}

{optional one-line explanatory body}
```

### The shared emoji vocabulary (reused, not reinvented per game)

| Emoji | Meaning |
|---|---|
| ✅ | success / confirmed |
| ⚠️ | warning / blocked / bad usage |
| ❌ | rejected / denied / wrong |
| 🛑 | session terminated |
| 📊 | status report |
| ⏱️ | timers / time remaining |
| 👥 | player / lobby lists |
| 🎮 | game-related, generic |
| 🔐 / 🗝️ / 👑 | admin identity — request / key / granted |

### What's identical across every game
- `DIVIDER` — same `━━━━━━━━━━━━━━━━━━━━━━` string
- Both message shapes (A and B) and when to use each
- The emoji vocabulary table above
- The admin-reply pattern: **DM the admin privately** (`senderJid`),
  and if the action touches a *live* session, **separately post a
  differently-worded announcement to the actual game chat**
  (`activeGameChatRef.value`)
- Bare-acronym safety: typing just `!hmg` or `!wcl` alone always shows
  the explainer card and **never** starts or joins anything

### What each game tweaks (via its own `config.js`)
| Field | Hangman | Word Climb |
|---|---|---|
| `BOT_EMOJI` | (game-specific figure emoji) | 🧗 |
| `GAME_NAME` / `GAME_ACRONYM` | Hangman / HMG | Word Climb / WCL |
| `PREFIX` / `ADMIN_PREFIX` | `!hmg` / `/hmg ` | `!wcl` / `/wcl ` |
| Extra emoji flavor | stick-figure elimination-tracker card, posted in the *group* per player | 🧗 💢 🚫 for climb-specific states |

A game is free to add its own extra emoji for states that don't exist
in other games (Hangman's stick-figure art, Word Climb's strikes) —
the *shapes* and *shared vocabulary* stay fixed, the *flavor* doesn't.

---

## 3. Game-specific commands

### Hangman (`!hmg` / `/hmg `)

**Public:**
| Command | What it does |
|---|---|
| `!hmg` (bare) | Explainer card, never stateful |
| `!hmg start` | Open a lobby |
| `!hmg join` | Join the open lobby |
| `!hmg help` | Same as bare |
| live letter/word guess | No prefix — guesses a letter or the full word |

**Admin:**
| Command | What it does |
|---|---|
| `/hmg help` | Dashboard (DM only) |
| `/hmg start` | Force-start / break a cooldown early |
| `/hmg pause` / `/hmg resume` | Freeze / unfreeze the turn timer |
| `/hmg end` / `/hmg stop` | Terminate the session |
| `/hmg status` | Full state dump |
| `/hmg set maxtries [n\|auto]` | Override guess-attempt limit |
| `/hmg set public [on\|off]` | Toggle public visibility |
| `/hmg set start [on\|off]` | Toggle `publicCanStart` |
| `/hmg set autojoin [on\|off]` | Toggle auto-join behavior |
| `/hmg addword` / `removeword` / `listwords` / `setwords` / `clearwords` | Manage the word pool |
| `/hmg clearadmin` | Reset Hangman's *own* settings only (see below) |
| `/hmg reset` | Reset word pool + settings, admin identity untouched |
| `/hmg admin` / `approve` / `deny` / `set admin` / `confirm` / `cancel` | **Redirect only** → use `/admin` (see §1) |

### Word Climb (`!wcl` / `/wcl `)

**Public:**
| Command | What it does |
|---|---|
| `!wcl` (bare) | Explainer card, never stateful |
| `!wcl start` | Open a lobby |
| `!wcl join` | Join the open lobby |
| `!wcl begin` | Force-start early once 2+ joined |
| `!wcl help` | Same as bare |
| live word guess | No prefix — only the current turn's player is heard |

**Admin:**
| Command | What it does |
|---|---|
| `/wcl help` | Dashboard (DM only) |
| `/wcl status` | Lobby/climb state, current rung, turn timer |
| `/wcl stop` / `end` | Terminate the session |
| `/wcl reset` | Hard-wipe this chat's Word Climb state |
| `/wcl setturnseconds <10-90>` | Per-turn timer for the *next* match |

**A note on why the two admin command lists aren't the same length:**
Hangman has accumulated word-pool and access-toggle commands over time;
Word Climb doesn't need equivalents yet (no word pool to manage — its
dictionary is fixed, and its access toggles are the same
`publicCanStart` setting every game already reads via
`resolveSetting()`). Same *shape*, different *surface area*, which is
expected — see ARCHITECTURE.md if a game genuinely needs a new kind of
setting.

---

### Roast Game (`!roast` / `/roast `)

No lobby, no round, no live session — every request is a stateless
lookup into `roastData.js`.

**Public:**
| Command | What it does |
|---|---|
| `!roast` (bare) / `!roast help` | Explainer card, never stateful |
| `!roast me` / `!roast me again` | Nice-tier roast, variation A/B (DM only) |
| `!roast savage` / `!roast savage again` | Savage-tier roast, variation A/B (DM only) |

**Admin:**
| Command | What it does |
|---|---|
| `/roast help` | Dashboard (DM only) |
| `/roast list` | Every profile loaded, tier + variation counts |

No word pool, no admin toggles for public visibility beyond the
universal `publicVisible` setting — content is entirely hand-curated
in `roastData.js`, restart to pick up changes. Name matching tolerates
near-miss spelling — see RoastGame/README.md "How matching works".

---

## 4. File structure

### Root — shared, game-agnostic (never import a game module from here)
```
index.js                  — message loop, dispatch to /admin, /game, or active game
permissions.js            — tier resolution (CREATOR/ADMIN/PUBLIC), nameTag(), settings helpers
admin-onboarding.js        — /admin ... (identity: who's admin, for which game(s))
game-switch-commands.js    — /game ... (which game is active, admin's scope)
games-registry.js          — discovers + loads every game folder, validates the contract
ARCHITECTURE.md            — the plugin contract every game folder must satisfy
COMMAND_REFERENCE.md        — this file
package.json
scripts/verify-games.js     — pre-deploy check: contract, state isolation, bare-acronym safety
```

### Each game folder — the plugin contract (`ARCHITECTURE.md` §2-3)
```
<GameName>Game/
  config.js            — GAME_KEY, GAME_NAME, GAME_ACRONYM, PREFIX, ADMIN_PREFIX, BOT_EMOJI, DIVIDER, tunables
  gameEngine.js         — state (scoped under `${GAME_KEY}:${chatId}`), turn/timer logic, forceStopActiveSession()
  publicCommands.js     — handlePublicMessage(msgCtx) — bare acronym, start/join, live guesses
  adminCommands.js      — handleAdminCommand(ctx) — tier gate FIRST, then this game's own settings/session control
  matchSummary.js       — (optional) end-of-match scoring/board — pure bookkeeping, no state ownership
  README.md             — this game's own rules + command list (a subset of §3 above, for this game only)
  <supporting files>    — e.g. wordBank.js — anything the engine needs that isn't shared
```

`games-registry.js` discovers every folder matching this shape
automatically — adding a new game means adding a new folder, never
editing `index.js`.
