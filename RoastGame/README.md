# Roast Game (`!roast` / `/roast `)

Private, DM-delivered roasts built from the ACT Academy group's own
chat history. No live AI call, no lobby, no round — every roast is a
pre-written lookup.

## Public commands

| Command | Where | What it does |
|---|---|---|
| `!roast` (bare) | Group or DM | Explainer card. Never stateful. |
| `!roast help` | Group or DM | Same as bare |
| `!roast me` | DM | Nice-tier roast, variation A |
| `!roast me again` | DM | Nice-tier roast, variation B |
| `!roast savage` | DM | Savage-tier roast, variation A |
| `!roast savage again` | DM | Savage-tier roast, variation B |

Bare `!roast` in the group never reveals anything — it only tells the
person how to get their own, privately, in DM.

## Admin commands

| Command | Tier | What it does |
|---|---|---|
| `/roast help` | Creator/Admin | Dashboard (DM only) |
| `/roast list` | Creator/Admin | Who currently has a roast profile, and how many variations each has |

**There is no `/roast rebuild`.** Content lives in `roastData.js` and
is edited by hand, offline. See that file's header for the content
rules to follow when adding or updating a person (no fabricated
events, savage escalates delivery not target category, no sensitive
categories, no minors).

## Why some people aren't in it

- Anyone identified as under 18 in the chat is permanently excluded —
  not a data gap, a hard rule.
- The group's own host/quiz account was excluded — it's not a person
  opting into being roasted by peers.
- Bare-phone-number senders (no saved contact name in the export)
  were left out — no reliable way to match them to a live sender by
  name, and not enough identity to roast without inventing one.
- A few low-volume named senders were left out for the same reason as
  above: not enough real material to write an honest anchor from.

## How matching works

The chat export only has saved *display names* for named senders, not
phone numbers — so `roastData.js` keys off a normalized name, not
`senderNumber`. When someone DMs `!roast me`, the bot looks up the
WhatsApp display name cached for their number (falling back to their
current `pushName`) and matches it against `roastData.js`'s alias
list.

Matching in `findProfile()` tries, in order:
1. **Exact match** — normalized candidate name equals an alias string
   verbatim.
2. **Token-overlap match** — if no exact hit, the candidate and every
   alias are split into words. An alias matches if its words are all
   present in the candidate's words, or vice versa (handles a dropped
   middle name, extra word, or different order). If more than one
   *different person's* alias satisfies this, it's treated as no
   match rather than guessed — a wrong roast delivered to the wrong
   person is worse than "no roast yet."

If someone's live name shares no real overlap with anything in
`aliases`, they still get the "no roast on file" message — check the
console for `[roast] No profile match for number=... candidates=...`
and add the missing spelling to `aliases` in `roastData.js` to fix it
going forward.
