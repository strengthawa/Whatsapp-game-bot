#Memory — Game Bots / Sky Graphics WhatsApp Game Platform

## Who I am, how I work

- I go by **Sky Graphics**. This is a real product I'm building and
  hosting (Railway originally, now also run locally), not a toy.
- I push back **directly and specifically** when something's wrong —
  expect that, don't get defensive, and update your position honestly
  when I'm right rather than half-conceding.
- I want **concise, point-by-point summaries** of work completed. Not
  narrative prose recaps.
- If something wasn't fully implemented, **say so plainly**. Don't
  overclaim, don't bury a gap in a footnote, don't wait for me to catch
  it. I will catch it, and I'd rather you got there first.
- A session with me typically covers **critique → implementation →
  refactor → documentation**, in that order, in one sitting. Don't
  treat these as separate requests needing separate sign-off — if I'm
  clearly still in build-mode, keep going.
- When I say "do X and that's it," I mean scope the work to exactly
  that — don't pad it with unrelated extras, but also don't drop a
  genuinely pending question just because a new request arrived.
- I will explicitly ask you to audit your own prior work ("what else
  did you miss") — take that seriously and actually re-derive the
  answer from the code, don't recite what you already claimed.

## Non-negotiable architecture principles

1. **Plugin/registry architecture.** Each game is a self-contained
   folder (`config.js`, `gameEngine.js`, `publicCommands.js`,
   `adminCommands.js`, `matchSummary.js` optional, `README.md`).
   `games-registry.js` auto-discovers folders — adding a game means
   adding a folder, never editing shared files for game-specific
   reasons.
2. **Bot-wide concerns live in bot-wide files, never inside a game
   folder** — this was violated twice already and both times required
   real surgery to fix:
   - Admin **identity** (who is CREATOR/ADMIN, which game(s) they're
     scoped to) → `admin-onboarding.js`, fixed `/admin` prefix.
   - Which **game is active**, admin's scope → `game-switch-commands.js`,
     fixed `/game` prefix.
   - Tier resolution, settings resolution, name tags → `permissions.js`.
   - **Rule of thumb: if a setting or flow would break just because a
     different game became active, it doesn't belong in that game's
     folder.**
3. **State isolation.** Every game's state is keyed
   `${GAME_KEY}:${chatId}` in the shared `games` object. Never touch
   another game's state slice.
4. **Tier gate first.** Every `adminCommands.js` checks
   `senderTier` (CREATOR/ADMIN/PUBLIC) before anything else. Non-admins
   get total silence, not an error message.
5. **Bare-acronym rule.** Typing just the bare prefix (`!hmg`, `!wcl`)
   ALWAYS shows the explainer card and NEVER starts/joins/mutates
   anything, regardless of game state.
6. **`forceStopActiveSession(chatId, ctx)`** is required per game —
   used by admin `stop`/`reset` and by game-switching.
7. **The admin ctx shape and the public ctx shape are different** —
   admin ctx has `sender` (chat) + `senderJid` (DM target) +
   `sendSafeMessage`; public ctx has `from` directly. Getting this
   backwards is a real, silent bug (happened once) — verify against
   `index.js`'s actual `cmdCtx`/`msgCtx` construction, don't assume.
8. **`ARCHITECTURE.md`** is the authoritative contract for what a new
   game folder must implement, and why. Read it before building a new
   game. **`COMMAND_REFERENCE.md`** is the consolidated day-to-day
   reference: every command (universal + per-game), the message-shape
   conventions, the file layout. Keep both current as the project
   grows — don't let either go stale like the root README once did.

## Message design conventions (apply identically across every game)

Two shapes only:

- **Card** (big moments: lobby open, final board, onboarding): divider
  top and bottom, emoji + title header, body, divider, italic
  attribution footer.
- **Transactional** (status, confirmations, errors): bold title line +
  optional blank line + body.
  Shared emoji vocabulary (✅ ⚠️ ❌ 🛑 📊 ⏱️ 👥 🎮, plus 🔐/🗝️/👑 for admin
  identity flows) is reused across games, not reinvented per game. Each
  game only adds its OWN flavor emoji for states unique to it (Hangman's
  stick-figure card, Word Climb's 🧗💢🚫) — the shape and shared
  vocabulary don't change.

**Admin reply pattern:** every admin command reply goes **privately to
the sender's own DM** (`senderJid`), never back into the group the
command was typed in. If the action changes something visible in a
*live* session, ALSO post a separately-worded announcement to the
actual game chat (`activeGameChatRef.value`).

## Documentation philosophy

- Each doc must serve a **distinct audience/purpose** or it shouldn't
  exist. I will ask "why not use one file" and expect a real answer,
  not a defense of the status quo.
- Consolidate aggressively when overlap is found — I had you delete
  `BOT_STYLE_GUIDE.md` entirely once its content was fully absorbed
  into `COMMAND_REFERENCE.md`.
- Every game gets its own `README.md` for parity (rules + its own
  command list) — even if a game folder existed before this
  convention was set (Hangman didn't have one; fix gaps like this
  proactively when noticed, don't wait to be asked).
- Docs must reflect **current reality**, not history. A doc referencing
  deleted games/files/folders is a bug, not a style issue — audit
  against the actual filesystem before trusting a doc's claims,
  including docs you wrote yourself in an earlier turn.

## What makes a WhatsApp game good or bad (apply this filter to any

## new game idea before building it)

WhatsApp is text-first, async, low-attention — people are half-reading
a group chat, not giving it sustained focus. Judge games on:

- **Low ramp-up cost.** Can someone jump in having only read the last
  message? (Hangman, Word Climb: yes. Word Ladder/BFS puzzles: no —
  cut for good reason.)
- **Spectator effect.** Does the drama play out visibly in the group,
  or does it retreat into private DMs with the bot? (Momentum's
  two-way DM symbol-picking killed it despite clever game-theory
  design — correctly cut.)
- **Validation brittleness.** If a game validates against an offline
  dictionary/word list, a real word getting rejected because it's not
  in the list feels arbitrary and kills momentum — this is a genuine,
  underweighted cost of Word Chain, not just a nitpick.
- **Group-size flexibility vs. turn-based stakes** are a real tradeoff,
  not a strict hierarchy — simultaneous games (Word Chain) have more
  raw energy; turn-based games (Hangman, Word Climb) have clearer
  escalating stakes and a visible bracket. Neither is automatically
  better; match the mechanic to what the game is trying to create.
- **Math/arithmetic race modes are a mismatch** for casual group chat
  — correctly cut (Target Numbers, 24 Game).
- Five games were audited from git history and rejected on these
  grounds already: WordLadder, WordChain, TargetNumbers, TwentyFourGame,
  Momentum. Don't re-litigate these without new information — but do
  take real pushback on the *reasoning* seriously (I successfully
  argued Word Chain's rigidity was underweighted; that's the standard
  of pushback that should update your view).

## Games built so far

- **Hangman (`hangman`, `!hmg`/`/hmg`)** — kept from the original six.
  Adaptive word-length difficulty, 2-min auto-cooldown into a fresh
  lobby, per-player stick-figure elimination card **posted live in the
  group** (not a DM — this was a real factual error that existed in
  multiple docs and even a stale code comment; verify against actual
  `sock.sendMessage` call sites, not comments).
- **Word Climb (`wordclimb`, `!wcl`/`/wcl`)** — built this project.
  Turn-based elimination; required word length escalates a rung (3→12
  letters, widened from 8) every full lap of the rotation; 3 cumulative
  strikes = out; winner is last-standing or highest length reached at
  the top (ties broken by fewest strikes). Word bank is now a real
  offline dictionary (234k+ words filtered/deduped/profanity-checked,
  static `dictionary-data.json`, not a live `word-list` require — that
  package's current version is ESM-only and would conflict with this
  project's CommonJS setup). Early-start (`begin`) moved from a public,
  any-joined-player command to admin-only (`/wcl begin`), floor dropped
  from a hardcoded 2 players to `config.MIN_PLAYERS_TO_BEGIN` (1) — a
  solo climb is allowed and resolves cleanly via the normal
  "reached_top" win path.
- **Roast Game (`roast`, `!roast`/`/roast`)** — stateless, no lobby or
  round: every request is a direct lookup into `roastData.js`. Was
  missing from this list even though it shipped and is fully documented
  in `COMMAND_REFERENCE.md` — a stale-doc bug in this file itself,
  caught during the kernel-extraction pass. Its one real bug (privacy
  guarantee unenforced in code — `!roast me` in a group leaked into the
  group) is now fixed: a DM/group check gates delivery before any
  profile lookup runs.

## Environment / ops

- `CREATOR_JID` env var — full WhatsApp JID format
  (`number@s.whatsapp.net`), not a bare number. Lives in `.env` at
  project root, loaded via `dotenv`. Referenced in `permissions.js`,
  `admin-onboarding.js`, `index.js`, `HangmanGame/*`.
- Originally hosted on Railway; now also run locally. `.env` is a
  local-only concern — Railway used environment variable UI instead.
- Runtime files not shipped in any zip: `settings.json`, `words.json`,
  `games.json`, `names.json`, `lidcache.json`, `auth_info/`.

## Known open items (do not silently drop these — surface them again

## if a new session starts without them being resolved)

- Minor: `index.js`/`games-registry.js` still hardcode `'hangman'` as
  a fallback default active game key. Low-risk but not fully
  game-agnostic in spirit — flagged, not yet fixed.
- Verify `.env` is actually present and correctly formatted on the
  local machine now that hosting moved from Railway to local — this
  was mid-investigation when the topic changed.
- `/admin clear [gamekey]` on a currently-unrestricted (`'all'`) admin
  materializes "every other loaded game" as a one-time snapshot list,
  since the model has no way to store a standing "all except X" rule.
  If a new game folder is added later, it will NOT automatically be
  excluded for that admin too — re-run the clear command if that
  matters. Documented in `admin-onboarding.js` at the point it happens;
  noting here so it isn't rediscovered as a surprise.

## Resolved this session (previously open, now fixed — kept here
## briefly as a record, not because they need re-surfacing)

- Admin game-access scoping (`settings.adminGameAccess`) was only ever
  enforced in `HangmanGame`'s admin handler — `WordClimbGame` and
  `RoastGame` never checked it, so a scoped-out admin had full run of
  both. Fixed via `permissions.hasGameAccess()`, folded into `isAdmin`
  in all three games (see `ARCHITECTURE.md` §5).
- `adminGameAccess` moved from a single string to a `'all' | string[]`
  list model. `/admin set` is now additive, `/admin clear [gamekey|all]`
  is the new subtractive mirror (both go through the same confirm/
  cancel step; auto-demotes if a clear empties the scope).
- `!wcl begin` moved from a public, any-joined-player command with a
  hardcoded 2-player floor to admin-only `/wcl begin`, floor now
  `config.MIN_PLAYERS_TO_BEGIN` (set to 1).
- `WordClimbGame`'s word bank moved from a hand-typed 3–8 letter array
  to a real, offline-generated 3–12 letter dictionary (static JSON, no
  runtime dependency — see `wordBank.js`).
