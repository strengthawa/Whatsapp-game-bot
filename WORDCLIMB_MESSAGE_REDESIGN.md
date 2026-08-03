# Word Climb — Message Redesign Plan (research + demo, awaiting go-ahead)

This file exists so the full research + simulated conversations don't flood
the chat. Nothing here has been implemented yet — see "Planned code changes"
at the bottom for the exact diff shape, then say go.

---

## 1. What I researched

**Source A — Terah's bot, live in the ACT Academy WhatsApp export you gave me.**
It ran the exact same idea WordClimbGame already implements (bot gives a
starting letter + a length, players reply in turn, length climbs as the group
progresses) — but the *messages* are radically shorter than ours, and the
*elimination rule* is one-miss-and-out, no strikes:

```
🎲Turn : @Mariam
🙌Next : @The ACTor
🆎Starts with D (at least 3 letters)
🏆Players left : 2/2
⏳ You have *40* seconds to reply
📝Total words : 0
```
→ Mariam replies "Duck" wrong → immediately:
```
Time out @Mariam! You are out! 🚫
```
(there's no "strike 1/3" anywhere in that bot — first miss, done). Correct
answers get **no acknowledgement at all** — the bot just silently posts the
next turn block. End of match:
```
@The ACTor won the game 🏆
Words : *0*
Longest word : * (0)* by @Mariam 📚
Time : *00:00:47* ⏱️
```
Four lines, no dividers, no headers.

**Source B — your own WRG (hangman) bot, same export.** More verbose per
event ("✅ *Correct!*\n{Player} guessed *E* and revealed..."), but still just
2-4 lines per message, never a multi-section report until the very end.

**Source C — general chat-bot UX guidance (web).** Consistent theme across
every source: one idea per message, plain language, no clutter — the same
direction as Sources A/B, just confirms it's the right instinct, not
WhatsApp-specific magic.

**Conclusion:** our current WordClimbGame is correct on *mechanics*
(letter + exact length, length climbs per lap) but over-formats every event
with dividers, headers, and multi-line explanations where Terah's bot used
one line. You explicitly want to **keep the 3-strikes system** (not
Terah's one-miss-out), just with Terah's brevity.

---

## 2. Problem → fix, per message type

| Message | Problem (today) | Fix |
|---|---|---|
| Turn prompt | 5 lines + 2 dividers | 3 lines, no dividers, adds "next up" preview + running word count (like Terah's) |
| Correct guess | 1 line (already fine) | Keep 1 line, trimmed slightly |
| Wrong guess | 1 line but wordy | 1 line, shorter |
| Struck out (wrong) | 1 line but wordy | 1 line, shorter |
| Timeout | 1 line, fine | 1 line, shorter |
| Struck out (timeout) | 1 line, fine | 1 line, shorter |
| Lobby open | 9 lines + 2 dividers | 3-4 lines |
| Lobby countdown tick | Re-posts full roster every 10s | Just the count, not the full name list, every 10s |
| Final board | Header + divider + reason + winner + survivors section + eliminated section + footer tip (~10-14 lines) | One block: result line, then a compact numbered disqualified list — no dividers, no footer tip |

Strike count still shows, just folded into the one-line message instead of
its own section — e.g. `strike 2/3` inline, not a separate paragraph.

---

## 3. New message shapes (exact text)

**Turn prompt:**
```
🎲 @Player's turn — next: @NextPlayer
🆎 {length} letters, starts with "{L}"
⏳ {seconds}s · 🏆 {survivors} left · 📝 {totalWords} words
```

**Correct:**
```
✅ "{word}" — @Player climbs to {length}! 🧗
```

**Wrong (not struck out):**
```
❌ "{word}" doesn't fit — @Player takes strike {n}/3 💢
```

**Wrong (struck out):**
```
❌ "{word}" doesn't fit — @Player is *out* (3/3 strikes) 🚫
```

**Timeout (not struck out):**
```
⏱️ @Player timed out — strike {n}/3 💢
```

**Timeout (struck out):**
```
⏱️ @Player timed out — @Player is *out* (3/3 strikes) 🚫
```

**Lobby open:**
```
🧗 Word Climb starting! Type "!wcl join" — {LOBBY_SECONDS}s to join.
👥 {roster or "no one yet — be first!"}
```

**Lobby tick (every 10s):**
```
⏳ {secondsLeft}s left to join — 👥 {count} joined
```

**Lobby closes / climb starts:**
```
🚀 Climb begins! {count} climber(s) ready.
```
(unchanged — already one line)

**Final board — winner:**
```
🏆 @Winner won the climb! Reached {bestLength}L · {totalWords} words · {mm:ss}
🚫 Disqualified ({n}):
1. @P — out at {L}L
2. @P — out at {L}L
```

**Final board — nobody survived:**
```
🪦 Nobody survived — no winner this climb.
🚫 Disqualified ({n}):
1. @P — out at {L}L
...
```

**Final board — reached the top, multiple survivors:**
```
🏔️ Climb topped out! Ranked by longest word:
1. @P — {L}L 🏆
2. @P — {L}L
🚫 Disqualified ({n}):
1. @P — out at {L}L
```

Pause/resume messages are already one line each — no change needed there.

**Not doing (flag for you, not assuming):** Terah's bot also shrank the turn
timer as length climbed (40s → 35s → 30s → 25s → 20s). That's a nice extra
difficulty knob but you didn't ask for it — leaving `TURN_SECONDS` fixed
unless you want that added too.

---

## 4. Simulated demo — 1 player (Ama)

```
Ama: !wcl start
Bot: 🧗 Word Climb starting! Type "!wcl join" — 45s to join.
     👥 no one yet — be first!

Ama: !wcl join
Bot: ⏳ 35s left to join — 👥 1 joined
Bot: 🚀 Climb begins! 1 climber ready.

Bot: 🎲 @Ama's turn — next: @Ama
     🆎 3 letters, starts with "D"
     ⏳ 30s · 🏆 1 left · 📝 0 words
Ama: Dog
Bot: ✅ "Dog" — @Ama climbs to 3! 🧗

Bot: 🎲 @Ama's turn — next: @Ama
     🆎 4 letters, starts with "F"
     ⏳ 30s · 🏆 1 left · 📝 1 words
Ama: Frog
Bot: ✅ "Frog" — @Ama climbs to 4! 🧗

--- admin pauses here ---
Admin: /wcl pause
Bot (to admin): ⏸️ *Climb paused.* ✅
Bot (to group): ⏸️ *Climb paused by the admin.* Sit tight — we'll be right back! ☕

--- admin resumes ---
Admin: /wcl resume
Bot (to admin): ▶️ *Climb resumed!* ✅
Bot (to group): ▶️ *Climb resumed by the admin!* Fresh timer — keep climbing! 🔥

Bot: 🎲 @Ama's turn — next: @Ama
     🆎 5 letters, starts with "M"
     ⏳ 30s · 🏆 1 left · 📝 2 words
Ama: Mouse
Bot: ✅ "Mouse" — @Ama climbs to 5! 🧗

Bot: 🎲 @Ama's turn — next: @Ama
     🆎 6 letters, starts with "P"
     ⏳ 30s · 🏆 1 left · 📝 3 words
Ama: Potatoo          ← wrong (misspelled)
Bot: ❌ "Potatoo" doesn't fit — @Ama takes strike 1/3 💢

Bot: 🎲 @Ama's turn — next: @Ama
     🆎 6 letters, starts with "R"
     ⏳ 30s · 🏆 1 left · 📝 3 words
(...30s pass, no reply...)
Bot: ⏱️ @Ama timed out — strike 2/3 💢

Bot: 🎲 @Ama's turn — next: @Ama
     🆎 6 letters, starts with "S"
     ⏳ 30s · 🏆 1 left · 📝 3 words
Ama: Squid            ← 5 letters, doesn't fit the required 6
Bot: ❌ "Squid" doesn't fit — @Ama is *out* (3/3 strikes) 🚫

Bot: 🪦 Nobody survived — no winner this climb.
     🚫 Disqualified (1):
     1. @Ama — out at 6L
```

**Alternative ending (not simulated line-by-line):** if Ama instead keeps
answering correctly all the way to `MAX_LENGTH` (12), the match ends
`reached_top` with 1 survivor, and the final board becomes:
```
🏆 @Ama won the climb! Reached 12L · 10 words · 00:04:12
🚫 Disqualified (0):
```

---

## 5. Simulated demo — 4 players (Ama, Bobo, Chi, Dara)

```
Admin: !wcl start
Bot: 🧗 Word Climb starting! Type "!wcl join" — 45s to join.
     👥 no one yet — be first!
(Ama, Bobo, Chi, Dara each type !wcl join)
Bot: ⏳ 15s left to join — 👥 4 joined
Bot: 🚀 Climb begins! 4 climbers ready.

Bot: 🎲 @Ama's turn — next: @Bobo
     🆎 3 letters, starts with "D"
     ⏳ 30s · 🏆 4 left · 📝 0 words
Ama: Dog
Bot: ✅ "Dog" — @Ama climbs to 3! 🧗

Bot: 🎲 @Bobo's turn — next: @Chi
     🆎 3 letters, starts with "E"
     ⏳ 30s · 🏆 4 left · 📝 1 words
(...30s pass, no reply...)
Bot: ⏱️ @Bobo timed out — strike 1/3 💢

Bot: 🎲 @Chi's turn — next: @Dara
     🆎 3 letters, starts with "S"
     ⏳ 30s · 🏆 4 left · 📝 1 words
Chi: Sun
Bot: ✅ "Sun" — @Chi climbs to 3! 🧗

Bot: 🎲 @Dara's turn — next: @Ama
     🆎 3 letters, starts with "T"
     ⏳ 30s · 🏆 4 left · 📝 2 words
Dara: Top
Bot: ✅ "Top" — @Dara climbs to 3! 🧗
                                          ← lap of 4 complete, length climbs

Bot: 🎲 @Ama's turn — next: @Bobo
     🆎 4 letters, starts with "F"
     ⏳ 30s · 🏆 4 left · 📝 3 words
Ama: Frog
Bot: ✅ "Frog" — @Ama climbs to 4! 🧗

Bot: 🎲 @Bobo's turn — next: @Chi
     🆎 4 letters, starts with "K"
     ⏳ 30s · 🏆 4 left · 📝 4 words
Bobo: Kign            ← wrong (typo, not a real word)
Bot: ❌ "Kign" doesn't fit — @Bobo takes strike 2/3 💢

Bot: 🎲 @Chi's turn — next: @Dara
     🆎 4 letters, starts with "M"
     ⏳ 30s · 🏆 4 left · 📝 4 words
Chi: Mice
Bot: ✅ "Mice" — @Chi climbs to 4! 🧗

Bot: 🎲 @Dara's turn — next: @Ama
     🆎 4 letters, starts with "R"
     ⏳ 30s · 🏆 4 left · 📝 5 words
Dara: Rope
Bot: ✅ "Rope" — @Dara climbs to 4! 🧗
                                          ← length climbs to 5

Bot: 🎲 @Ama's turn — next: @Bobo
     🆎 5 letters, starts with "W"
     ⏳ 30s · 🏆 4 left · 📝 6 words
Ama: Water
Bot: ✅ "Water" — @Ama climbs to 5! 🧗

Bot: 🎲 @Bobo's turn — next: @Chi
     🆎 5 letters, starts with "H"
     ⏳ 30s · 🏆 4 left · 📝 7 words
(...30s pass, no reply...)
Bot: ⏱️ @Bobo timed out — @Bobo is *out* (3/3 strikes) 🚫

Bot: 🎲 @Chi's turn — next: @Dara
     🆎 5 letters, starts with "M"
     ⏳ 30s · 🏆 3 left · 📝 7 words
Chi: Mango
Bot: ✅ "Mango" — @Chi climbs to 5! 🧗

... (climb continues — Ama, Chi, Dara all keep answering correctly,
    lap after lap, all the way up through 12 letters) ...

Bot: 🏔️ Climb topped out! Ranked by longest word:
     1. @Chi — 12L 🏆
     2. @Ama — 12L
     3. @Dara — 11L
     🚫 Disqualified (1):
     1. @Bobo — out at 5L
```

(Chi ranks 1st over Ama despite the same 12L because Chi has fewer strikes —
same tie-break rule already in the code today, unchanged.)

---

## 6. Planned code changes (waiting for your go)

- **`WordClimbGame/gameEngine.js`**
  - Add `totalWordsGuessed` counter to `freshState()` / reset it in `startClimb()`, increment it in `submitGuess()` on a correct answer.
  - Rewrite `announceAndArm()`'s turn-prompt text to the 3-line shape above (adds "next up" player, drops both dividers).
  - Rewrite `openFreshLobby()`'s lobby-open text and `startLobbyCountdown()`'s tick text to the trimmed shapes above.
  - Shorten the wrong-guess / struck-out / timeout / struck-out-timeout strings in `submitGuess()` and `handleTimeout()`.
- **`WordClimbGame/matchSummary.js`**
  - Rewrite `renderFinalBoardText()` to the compact single-block shape (no header/divider/footer-tip) for all three end reasons (winner / no survivors / reached top).
  - `buildFinalBoard()` itself (the data shape) barely changes — just needs `totalWordsGuessed` passed through.
- **`WordClimbGame/publicCommands.js`**
  - Update the `!wcl help` explainer text's step list to reflect "next up" preview + word count (cosmetic, 1-2 lines).
- **`WordClimbGame/tests.js`**
  - No existing assertions reference the old wording (checked — they only match on `"Not enough players"` / `"Need at least"`), so this is safe, but I'll add 1-2 new assertions that the new turn-prompt includes the length/letter/next-up fields, and that the final board's disqualified count matches eliminated count.
- Re-run `npm run verify` + `npm test`, then repackage the zip.

Nothing outside `WordClimbGame/` needs to touch this — `games-registry.js` and `scripts/run-tests.js` don't care about message text.

---

**Say the word and I'll implement exactly this.**
