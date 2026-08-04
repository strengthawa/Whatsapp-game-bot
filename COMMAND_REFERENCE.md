# COMMAND_REFERENCE.md — Game Bots · Sky Graphics

One file to answer three questions: **what commands exist**, **what does
every message look like**, and **what does a game folder look like**.
Everything below reflects what's actually implemented — verified against
`scripts/verify-games.js` — not aspirational.

---

## 1. Universal commands (bot-wide, work no matter which game is active)

These live in shared, game-agnostic files — never duplicated per game.
Both use a **fixed prefix** so they always work, even if the currently
active game is broken or its folder is missing entirely.

### `/admin` — admin *identity* (who is registered, who is stationed on what) — `admin-onboarding.js`

Two distinct states, two distinct words, used consistently everywhere in
this file and in the bot's own messages:
- **Registered** — connected to the bot itself (redeemed a key, or was
  directly set). No game decided yet.
- **Stationed** — assigned to operate one or more specific games.

An admin can be Registered without being Stationed on anything yet —
that's the normal state right after redeeming a key, and it's a
deliberate two-step process: connecting and being assigned a game are
always separately triggered, separately confirmed, separately notified.

| Command | Tier | What it does |
|---|---|---|
| `/admin` | Everyone | Creator sees their own status; a Registered admin sees whether they're Stationed yet; anyone else requests access (generates a key, DMs the creator) |
| `/admin [key]` | Everyone | Redeem a key — this is what makes you Registered. You are NOT Stationed on anything yet after this |
| `/admin approve [num]` | Creator | Authorizes the connection and delivers the key. Does **not** decide a game — that's a separate step, below |
| `/admin deny [num]` | Creator | Void a pending request |
| `/admin set [num] [gamekey\|all]` | Creator or Admin | **Stations** — adds `gamekey` to that admin's existing stations, or replaces with `all`. Works whether `num` is already Registered or brand new (a direct-install shortcut that skips the key exchange entirely) |
| `/admin clear [gamekey\|all]` | Creator or Admin | **Un-stations** — removes `gamekey` from that admin's stations, or wipes on `all`. Auto-de-registers if this empties their stations |
| `/admin confirm` / `/admin cancel` | Creator or Admin | Apply or discard a pending `set` or `clear` |
| `/admin clear` (no args) | Creator only | De-register the admin identity entirely, immediately, no confirm step |
| `/admin help` | Creator or Admin | This command list |

`settings.adminGameAccess` is `'all' | string[]` — never a single bare
gamekey string once written through `set`/`clear` (a legacy single-string
value may still exist on data written before this model; `permissions.js`
`hasGameAccess()` reads that shape too, so nothing breaks on upgrade,
but every write goes out as `'all'` or an array). A newly-Registered
admin (via key redemption) always starts as `[]` — Registered, zero
stations — never `'all'`. See `permissions.js` for `hasGameAccess()` /
`gameAccessList()` / `describeGameAccess()` — the single source of
truth for reading this value; no other file should inline its own
scope check.

All replies go **privately to the sender's own DM** — never posted back
into the group the command was typed in.

### `/game` — which game is active, and bot-wide toggles — `game-switch-commands.js`

| Command | Tier | What it does |
|---|---|---|
| `/game setgame [key]` | Creator | Switch the active game (cleanly stops the old one's live session first, if it supports that) |
| `/game set public [on\|off]` | Creator or Admin | Toggle `publicVisible`, bot-wide — governs whichever game is active. Bare (no on/off) shows current status |
| `/game set start [on\|off]` | Creator or Admin | Toggle `publicCanStart`, bot-wide. Bare shows current status |
| `/game set autojoin [on\|off]` | Creator or Admin | Toggle creator/admin auto-join on lobby open, bot-wide. Bare shows current status |
| `/game status` | Creator or Admin | Active game, admin's stations, all available game keys |
| `/game roletags [on\|off]` | Creator or Admin | Toggle **your own** name tag only — Creator controls `(Creator)`, Admin controls `(Admin)`; neither can see or set the other's. Bare shows your own current status |

There used to be a `/game setadminaccess [gamekey|all]` here too — cut
entirely. It was a second, differently-behaved path (direct replace)
to the exact same outcome `/admin set`/`/admin clear` already cover
(additive/subtractive), and having two commands that both claim to
answer "what can the admin operate" — with different semantics — was
exactly the kind of redundant, confusing surface this whole restructure
exists to remove. Station assignment now happens in exactly one place.

**Why two prefixes, not one:** `/admin` answers "who is registered,
and what are they stationed on" — bot identity. `/game` answers
admin commands, and for which games" — bot identity. `/game` answers
"which game is currently live, and what can the *current* admin touch"
— bot configuration, including the three bot-wide toggles above. Those
three used to be exposed only through Hangman's own admin commands
(`/hmg set public`, etc.) — see ARCHITECTURE.md §10.4 for why that was
wrong and why they moved here. Neither `/admin` nor `/game` depends on
the other, and neither lives inside any individual game's folder.

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
- Bare-acronym safety: typing just `!hmg`, `!wcl`, or `!roast` alone
  always shows the explainer card — one message, with `🤖 online` as
  its own first line (via `gameKernel.botIdentityLine()`) — and
  **never** starts or joins anything
- If a game has a `matchSummary.js`, it builds and returns a report; it
  never sends. See ARCHITECTURE.md §10.2

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
| `/hmg begin` | Force-start the *currently open* lobby now (min `MIN_PLAYERS_TO_BEGIN`, currently 1) — same name/shape as `/wcl begin` |
| `/hmg skipcooldown` | Break the post-round auto-cooldown, open a fresh lobby immediately — Hangman-specific, no other game auto-cools-down |
| `/hmg pause` / `/hmg resume` | Freeze / unfreeze the turn timer (via `gameEngine.js`, kernel-backed — see ARCHITECTURE.md §10.1) |
| `/hmg end` / `/hmg stop` | Terminate the session |
| `/hmg status` | Full state dump |
| `/hmg set maxtries [n\|auto]` | Override guess-attempt limit — Hangman-specific, stays here |
| `/hmg addword` / `removeword` / `listwords` / `setwords` / `clearwords` | Manage the word pool |
| `/hmg resetsettings` | Reset Hangman's *own* setting (max tries) only — bot-wide toggles are never touched from here (see §1) |
| `/hmg reset` | Reset word pool + Hangman's own settings, admin identity untouched |
| `/hmg set admin` / `admin` / `approve` / `deny` / `confirm` / `cancel` | **Redirect only** → use `/admin` for identity (see §1) |

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
| `/wcl status` | Lobby/climb state, current rung, turn timer, paused/live indicator |
| `/wcl pause` / `/wcl resume` | Freeze / unfreeze the turn timer (kernel-backed, same contract as Hangman's) |
| `/wcl stop` / `end` | Terminate the session |
| `/wcl reset` | Hard-wipe this chat's Word Climb state |
| `/wcl setturnseconds <10-90>` | Per-turn timer for the *next* match — Word Climb-specific |

**A note on why the two admin command lists still aren't the same
length:** Hangman has word-pool commands Word Climb genuinely has no
equivalent for (fixed dictionary, not a curated pool). Everything
game-agnostic — pause/resume, lobby-open with auto-join, the
`publicVisible`/`publicCanStart`/`autoJoin` toggles — is now shared
between both (the toggles live at `/game`, not duplicated per game; see
§1). What's left different between the two games is genuinely
game-specific surface area, not an abstraction gap.

---

### Guess My Number (`!gmn` / `/gmn `)

Free-for-all, not turn-based — anyone can guess any time. A match is
best of `N` rounds (default 5), each round a fresh secret in a
mode-dependent, lobby-size-scaled range. An autonomous **chaos**
system (one admin dial: `/gmn chaos off|light|full`) can layer in
bounty rounds, a sabotage tax, a hidden cursed number, end-of-match
titles, and a rare whole-match Team Chaos split — the engine decides
which event, on whom, and when, not the admin. See
`GuessMyNumberGame/README.md` "Why a best-of-N match, coarse hints,
and scaling range/cap/timer" and "Chaos system" for the design
reasoning.

**Public:**
| Command | What it does |
|---|---|
| `!gmn` (bare) | Explainer card, never stateful |
| `!gmn start` | Open a lobby |
| `!gmn join` | Join the open lobby |
| `!gmn board` | Live scoreboard — round progress, non-spoiling chaos state, closest guess, standings (or team scores under Team Chaos) |
| `!gmn mode` | Shows current mode + rounds-per-match (read-only) |
| `!gmn chaos` | Shows current chaos intensity (read-only) |
| `!gmn leaderboard` / `lb` | This chat's all-time standings |
| `!gmn help` | Same as bare |
| bare number | No prefix — ANY joined player, no turn order |

**Admin:**
| Command | What it does |
|---|---|
| `/gmn help` | Dashboard (DM only) |
| `/gmn status` | Lobby/round state, range, guess count, timer, current chaos event, standings/team scores |
| `/gmn pause` / `/gmn resume` | Freeze / unfreeze the round timer |
| `/gmn skip` | End the current round unsolved, reveal the number, move on |
| `/gmn stop` / `end` | Terminate the session |
| `/gmn reset` | Hard-wipe this chat's Guess My Number state |
| `/gmn mode <classic\|speedrun\|megagrid>` | Difficulty mode for the *next* match |
| `/gmn setrounds <1-15>` | Rounds per match for the *next* match |
| `/gmn chaos <off\|light\|full>` | Chaos intensity for the *next* match — one dial, the engine autonomously picks the rest |

---

### Roast Game (`!roast` / `/roast `)

No lobby, no round, no live session — every request is a stateless
lookup into `roastData.js`. No `pause`/`resume`/kernel session commands
either, deliberately — see ARCHITECTURE.md §10.1 on not adding those for
symmetry's sake.

**Public:**
| Command | What it does |
|---|---|
| `!roast` (bare) / `!roast help` | Explainer card, never stateful |
| `!roast me` / `!roast me again` | Nice-tier roast, variation A/B — **DM only, enforced in code** |
| `!roast savage` / `!roast savage again` | Savage-tier roast, variation A/B — **DM only, enforced in code** |

Typed inside a group, `me`/`savage` never reach `roastData.js` at all —
the group gets a one-line redirect to DM instead, and no profile lookup
happens. This used to only be a README claim; it's now a real gate in
`publicCommands.js`, checked before anything else in the handler.

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

### Word Chain (`!wch` / `/wch `)

**Public:**
| Command | What it does |
|---|---|
| `!wch` (bare) | Explainer card, never stateful |
| `!wch start` | Open a lobby |
| `!wch join` | Join the open lobby |
| `!wch leaderboard` / `lb` | This chat's cross-match standings, ranked by score |
| `!wch help` | Same as bare |
| live word | No prefix — only the current turn's player is heard; the FIRST word of a match has no letter constraint, every word after must start with the previous word's last letter |
| live steal attempt | No prefix — only usable by someone OTHER than whoever just missed, and only while a steal window is open (see below); a failed attempt is free, no penalty |

**Admin:**
| Command | What it does |
|---|---|
| `/wch help` | Dashboard (DM only) |
| `/wch status` | Lobby/chain state, word count, current sector, live per-player score, turn timer |
| `/wch begin` | Force-start early once `MIN_PLAYERS_TO_BEGIN` joined |
| `/wch pause` / `/wch resume` | Freeze / unfreeze the turn timer (kernel-backed, same contract as Hangman/Word Climb) |
| `/wch stop` / `end` | Terminate the session |
| `/wch reset` | Hard-wipe this chat's Word Chain state, including its sector (back to the first entry in `SECTOR_SEQUENCE`) |
| `/wch setturnseconds <5-60>` | Per-turn timer for the *next* match, replaces the auto shrink-as-the-chain-grows curve |

There is **no manual category command**. The category ("sector") is
fully automatic: every `SECTOR_LENGTH` valid words, the match
announces a big shift and cycles to the next entry in
`SECTOR_SEQUENCE` (`free → animals → fruits → countries → loops`),
always starting a fresh match at the first entry regardless of where
the previous match ended.

Word Chain has no fixed length/letter axis the way Word Climb does —
its difficulty curve runs on total words played this match instead
(`DIFFICULTY_MAX_WORDS`), and the required starting letter is never
picked by the bot at all; it's always just the previous word's last
letter. A rejected word always names the specific reason (too short,
wrong letter, repeat, not in this sector) instead of a generic
"doesn't fit."

Two mechanics unique to this game:
- **Scoring** — every correct word earns a base point plus stacking
  bonuses for a rare starting letter, a long word, answering fast, and
  hitting a streak milestone. Score (not raw word count) is the
  tie-break for who wins a multi-survivor finish, and what the
  leaderboard tracks.
- **Steal window** — a missed turn (wrong word or timeout) doesn't
  just advance to the next player silently. The same required letter
  stays open for `STEAL_WINDOW_SECONDS` for anyone else to grab out of
  turn order for a rescue bonus, before normal rotation resumes.

See `WordChainGame/README.md` for the full sector list and scoring
table.

---

## 4. File structure

### Root — shared, game-agnostic (never import a game module from here)
```
index.js                  — message loop, dispatch to /admin, /game, or active game
permissions.js            — tier resolution (CREATOR/ADMIN/PUBLIC), nameTag(), settings helpers
admin-onboarding.js        — /admin ... (identity: who's admin, for which game(s))
game-switch-commands.js    — /game ... (which game is active, admin's scope, bot-wide toggles)
gameKernel.js               — shared plugin-kernel: buildCard(), pauseTimer()/resumeTimer(), botIdentityLine()
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
