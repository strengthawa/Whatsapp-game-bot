# Word Chain (WCH) — Sky Graphics

A live, elimination-style WhatsApp word game. Each word must start with
the **last letter** of the word before it — say it too slow, say a
repeat, or say something that doesn't fit, and you take a strike.

## How a match works

1. An admin (or anyone, if the admin has enabled `publicCanStart`)
   opens a lobby with `!wch start`. Players join with `!wch join`.
2. The **first** player to go opens the chain with **any valid word**
   (3+ letters, matching the current sector — see below). No letter
   constraint on the opener.
3. Every player after that must reply, on their turn, with a real word
   that **starts with the last letter** of the previous word, is at
   least 3 letters, and hasn't been used yet this match. A rejected
   word always says *why* — too short, wrong letter, already used, or
   not in the current sector — never a generic "doesn't fit."
4. The turn timer shrinks as the chain grows (25s → 10s by default,
   over the first 20 words), unless an admin has set a fixed override.
   A "⏳ Xs left" update posts every 5 seconds during a turn, and the
   last few words of the chain show right on the turn prompt.
5. A timeout, a repeat, or an invalid/wrong-sector word costs a
   strike. **3 strikes** and you're eliminated.
6. **Miss a turn and the chain doesn't just move on** — the same
   required letter stays open for a short **steal window**. Anyone
   else can grab it for a rescue bonus before normal rotation resumes.
   The player who missed still takes their strike either way.
7. The match ends when either only one player remains (they win
   outright) or the chain reaches **40 total words** with multiple
   players still standing — ranked by fewest strikes, then highest
   score.
8. The final board always shows every player who joined — winner,
   survivors, and anyone disqualified — plus each player's score, the
   single longest word of the whole match (credited to whoever
   actually said it, even if they didn't win), the last stretch of the
   chain, and each player's own accumulated answer time.

## Scoring

Every correct word earns 1 base point, plus any of these stack on top:

| Bonus | When | Points |
|---|---|---|
| Rare letter | Word starts with Q, X, Z, or J | +2 |
| Long word | 7+ letters | +1 |
| Speed | Answered in the first third of the turn's time | +1 |
| Streak | Every 5th correct answer in a row | +2 |
| Steal | Successfully stole a missed turn | +2 |

Score (not raw word count) decides who wins a multi-survivor finish,
and is what the leaderboard tracks.

## Automatic sectors (no admin toggle)

The word category isn't something an admin sets and everyone forgets
about — it's a **live, timed event** the whole match cycles through on
its own. Every 8 valid words, the chain announces a big **SECTOR
SHIFT** and moves to the next category:

`🔤 Free-for-all → 🐾 Animals → 🍎 Fruits → 🌍 Countries → (loops)`

In a category sector, the chain rule still applies, but a word must
also be **in that category's list**, not just any real word — e.g. in
the Animals sector, "bicycle" is a real English word but still gets
flagged as wrong, since it isn't an animal. Every match always opens
on Free-for-all, regardless of where the previous match ended.

## Steal window

When a player times out or gives an invalid word, the chain doesn't
just quietly move to the next person in rotation. The same required
letter stays open for **8 seconds** — the first correct reply from
**anyone else** (not the player who just missed) steals it, earns a
+2 bonus on top of the word's normal score, and the chain continues
from there. Nobody steals in time? Rotation just continues exactly as
it would have anyway.

## Commands

### Public (`!wch`)

| Command | What it does |
|---|---|
| `!wch` | Bare acronym — explainer card, never touches game state |
| `!wch help` | Same explainer card |
| `!wch start` | Open a lobby (admin-only unless `publicCanStart` is on — see `/game`) |
| `!wch join` | Join the open lobby |
| `!wch leaderboard` / `!wch lb` | This chat's cross-match standings (by score) |
| *(any message during your turn)* | Your word for the chain |
| *(any message during a steal window)* | Your steal attempt — free to try, no penalty for missing |

### Admin (`/wch `)

| Command | What it does |
|---|---|
| `/wch help` | Admin dashboard — live config + full command list |
| `/wch status` | Current lobby/match state, current sector, live scores |
| `/wch begin` | Force-start the open lobby early |
| `/wch pause` / `/wch resume` | Freeze/unfreeze the turn timer |
| `/wch stop` | End the session, post the final board |
| `/wch reset` | Hard reset — wipes this chat's Word Chain state |
| `/wch setturnseconds <5-60>` | Fixed turn-timer override, replaces the auto shrink curve |

There is deliberately **no manual category command** — sectors rotate
on their own. `/wch set public` / `/wch set start` / `/wch set
autojoin` are also **not** commands here — those are bot-wide, via
`/game set ...`.

## Delivery notes

- Admin command replies always go to the admin's own DM
  (`sendSafeMessage` → `senderJid`), never back into the group the
  command was typed in. Any change visible to players also gets a
  separate, group-facing announcement.
- No data leaves this project or hits any external API — the
  dictionary and category lists are static, offline, self-contained
  files (see `wordBank.js`'s header for exactly how the dictionary was
  generated).
