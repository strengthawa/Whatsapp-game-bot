// ============================================================
//  RoastGame/roastData.js — Roast Game · Sky Graphics
//
//  Curated ONCE, offline, by hand — reading the ACT Academy chat
//  export directly and writing floor + variation text per person.
//  There is no "/roast rebuild" command and no live pipeline that
//  re-reads the export at runtime: this file IS the content.
//
//  To add/update a person: edit `profiles` below (and `aliases`
//  if they go by more than one name/spelling in the group), then
//  restart the bot. That's the entire "rebuild" process now.
//
//  Content rules followed while writing this file (do not relax
//  these when adding new entries):
//    - Every anchor is a paraphrased, non-verbatim reference to a
//      real recurring behavior or moment in the group — never a
//      fabricated event.
//    - "Savage" only escalates DELIVERY (bluntness, exaggeration),
//      never TARGET CATEGORY. No appearance, health, family,
//      finances, or anything that reads as a private struggle
//      rather than an observed group-chat behavior.
//    - Anyone under-18 in the chat, or anyone whose "personality"
//      in the group is too thin to roast without inventing
//      material, is deliberately left out — see the exclusion
//      note at the bottom of this file.
// ============================================================

// Normalize whatever name the bot has cached for a sender (or the
// name they roast-request under) so lookups are forgiving of case,
// spacing, and the emoji/decoration people add to their own names.
function normalizeName(name) {
    return (name || '')
        .normalize('NFKD')                  // decompose styled/mathematical letters
        .toLowerCase()                      // THEN lowercase — order matters: toLowerCase()
                                             // doesn't recognize mathematical bold/italic
                                             // "letters" as cased until they're decomposed
                                             // to plain Latin letters first
        .replace(/[\u0300-\u036f]/g, '')   // strip accents
        .replace(/[^\w\s]/g, '')            // strip emoji/punctuation
        .replace(/\s+/g, ' ')
        .trim()
}

// alias (normalized name variant) → profile key
const aliases = {
    'strength awa':               'strength_awa',
    'mariam a':                   'mariam_a',
    'tende stacy angwi':          'tende_stacy_angwi',
    'tende stacy':                'tende_stacy_angwi',
    'ktn':                        'ktn',
    'terah jam t':                'terah_jam_t',
    'terah jam':                  'terah_jam_t',
    'dr might awa':               'dr_might_awa',
    'might awa':                  'dr_might_awa',
    'calisprite lovebeauty act acad': 'calisprite_lovebeauty',
    'calisprite lovebeauty':      'calisprite_lovebeauty',
    'hamed corneille':            'hamed_corneille',
    'brice jervis dr proph j':    'brice_jervis',
    'brice jervis':               'brice_jervis',
    'helma bongui bery horiking': 'helma_bongui',
    'helma bongui':               'helma_bongui',
    'malialia celine bride':      'malialia_celine',
    'malialia celine':            'malialia_celine',
    'lactio clarence act':        'lactio_clarence',
    'lactio clarence':            'lactio_clarence',
    'tebo claire':                'tebo_claire',
    'calvin ravvle tc':           'calvin_ravvle',
    'calvin ravvle':              'calvin_ravvle',
    'patience dzekem':            'patience_dzekem',
    'the actor':                  'the_actor',
    'mr dieudonne abanji':        'dieudonne_abanji',
    'dieudonne abanji':           'dieudonne_abanji'
}

// profile key → content. `tier` just documents how much real material
// existed to work with — it doesn't change bot behavior, `nice`/`savage`
// array length does that (1 entry = "again" repeats it with a note,
// 2 entries = "again" serves the second one).
const profiles = {
    strength_awa: {
        displayName: 'Strength Awa',
        tier: 'full',
        floor: 'The one with a comeback loaded before anyone else has finished reading the message — usually funnier than whatever was actually asked.',
        nice: [
            'When KTN teased "big news" for ten minutes straight, you skipped past every guess and went straight to negotiating your cut — offering up a kidney like it was a completely reasonable shopping-trip fee. Nobody else in that thread had jokes that fast.',
            'Your default reaction to group suspense isn\'t patience, it\'s an instant, fully-formed bit — half the energy of that chat exists because you refuse to just wait quietly for news like everyone else.'
        ],
        savage: [
            'You\'ve built an entire personality around replying before the message finishes loading — confidence running about four seconds ahead of the actual information.',
            'Every "big announcement" in that group turns into your open mic slot before anyone even finds out what the announcement was.'
        ]
    },

    mariam_a: {
        displayName: 'Mariam A.',
        tier: 'full',
        floor: 'First hand up for literally anything, and the human embodiment of "ate, then slept" as a complete life update.',
        nice: [
            'The second anything good gets offered in that group, you\'re already typing "please begin with me" before the offer\'s even finished — a genuine talent for calling dibs.',
            'Asked how your day went, you kept it refreshingly simple: ate a lot, slept. No further updates needed, no notes.'
        ],
        savage: [
            'You have one setting — first in line — and it fires before you even know what the line is for.',
            'Your entire life update strategy is "ate, slept" and somehow it\'s more consistent reporting than anyone else in that chat manages.'
        ]
    },

    tende_stacy_angwi: {
        displayName: 'Tende Stacy Angwi',
        tier: 'full',
        floor: 'Solves a multi-step logic puzzle in one dry line while simultaneously announcing the network is trying to kill her.',
        nice: [
            'While everyone else was still re-reading the puzzle about who finished the race before who, you\'d already worked out the full finishing order in one message — casually correct, no show of work needed.',
            'You somehow deliver sharp answers AND a running network-complaint commentary in the same breath, and both threads stay equally entertaining.'
        ],
        savage: [
            'You solve harder puzzles than most people attempt, then immediately undercut it by blaming the network for something that was never the network\'s fault.',
            'The network gets blamed more in your messages than actual bad luck ever could justify.'
        ]
    },

    ktn: {
        displayName: 'KTN',
        tier: 'full',
        floor: 'The group\'s professional teaser — never once delivered news on the first try, always made you beg for it in installments.',
        nice: [
            'That "I have great news" post sat there dangling for a good twenty messages while you fed everyone hints and giggling emojis instead of just saying it — pure hype-man instinct.',
            'You opened with "beautiful ladies and handsome gentlemen" like you were hosting a gala, then spent the next hour building suspense over a Monday online session. Showmanship, unnecessary but appreciated.'
        ],
        savage: [
            'You\'ve never delivered a single piece of news in one message when it could instead be stretched into a ten-message guessing game nobody asked to play.',
            'Half your messages exist purely to delay the other half of your messages.'
        ]
    },

    terah_jam_t: {
        displayName: 'Terah JAM T',
        tier: 'full',
        floor: 'Fastest, most confident quiz answer in the group — followed, suspiciously often, by an edit.',
        nice: [
            'You rattled off Aguero, Zidane, and Neymar by country like it was nothing, then still went back and quietly edited the message anyway — precision as a personality trait.',
            'Even your wrong-ish guesses come with actual reasoning shown ("we add 1 to the sum of the two adjacent numbers...") — you show up to trivia like it\'s a real exam.'
        ],
        savage: [
            'You post the answer with total confidence and then edit it twice, which is a very specific kind of "sure, but not that sure."',
            'Nobody in that group has ever been faster to answer AND faster to quietly go back and fix it than you.'
        ]
    },

    dr_might_awa: {
        displayName: 'Dr. Might Awa',
        tier: 'full',
        floor: 'Turns an ordinary group chat into a set of formal action items with names attached, and got caught asking an AI tool to show his face on camera.',
        nice: [
            'You\'re the only person who\'ll drop an actual "Action items ✅" list with names and follow-ups into a casual WhatsApp group — genuinely useful, completely unprompted, very "someone has to run this meeting."',
            'The AI-recording-tool-showing-your-face moment got called out by name in the group and you just let it ride — good sport about it.'
        ],
        savage: [
            'You minuted a casual group chat like it was a board meeting, then got publicly clocked trying to get an AI to show your face on camera.',
            'Nobody asked for action items in a WhatsApp group and yet here you were, assigning them anyway.'
        ]
    },

    calisprite_lovebeauty: {
        displayName: 'Calisprite Lovebeauty',
        tier: 'full',
        floor: 'Opens more mornings than anyone else with "good morning geniuses" and a wellness tip nobody requested but somehow needed.',
        nice: [
            'You\'re the reason that group has any structure to its mornings at all — greeting, positivity, and an apple-a-day tip, delivered like clockwork.',
            'Even your typos read as encouraging — "Trust God, you\'re just fine" hit different mixed in with a fruit fact.'
        ],
        savage: [
            'You greet that group like you\'re running a wellness retreat nobody signed up for, apple facts included whether they\'re relevant or not.',
            '"Good morning geniuses" is doing a LOT of unearned optimism at 7am for a group that\'s mostly arguing about trivia answers by 7:05.'
        ]
    },

    hamed_corneille: {
        displayName: 'Hamed Corneille',
        tier: 'full',
        floor: 'Communicates almost exclusively in short, dry one-liners — riddle answers delivered with zero unnecessary words.',
        nice: [
            '"Tomorrow." "The dark." "A mirror." — three riddle answers, six words total, all correct. Efficient in a way most of that group could learn from.',
            'You said there\'d be popcorn after one cryptic KTN tease and somehow that was funnier than a paragraph would\'ve been.'
        ],
        savage: [
            'Your text messages have fewer words in them than most people\'s punctuation.',
            'You\'ve mastered saying the least possible while still technically answering the question — impressive, mildly unsettling.'
        ]
    },

    brice_jervis: {
        displayName: 'Brice Jervis',
        tier: 'full',
        floor: 'Shows up specifically to tell the group the question itself was wrong, receipts included.',
        nice: [
            'You corrected a "the sun is burning" question with actual mass-defect physics, unprompted — genuinely educational, and nobody argued back because you were right.',
            'Random pope trivia, physics corrections, whatever the topic — you always arrive with the actual, sourced answer instead of a guess.'
        ],
        savage: [
            'You don\'t answer questions so much as put them on trial, and half the time the question loses.',
            'Nobody asks you a question expecting a quick answer anymore — they know a small physics lecture is coming with it.'
        ]
    },

    helma_bongui: {
        displayName: 'Helma Bongui',
        tier: 'full',
        floor: 'Runs the group\'s debates like an actual moderator, clipboard energy included, "genius" greeting mandatory.',
        nice: [
            'You built a whole For/Against sign-up structure for a Past-Questions debate out of nothing but group-chat willpower — that takes real organizing energy.',
            'You open with "good evening genius" often enough that it\'s basically your signature now, and somehow it never gets old.'
        ],
        savage: [
            'You showed up to a WhatsApp group chat and tried to run Robert\'s Rules of Order on it.',
            'Nobody asked for a formal debate structure in a chat that was arguing about crocodile risk a few messages earlier, but you gave them one anyway.'
        ]
    },

    malialia_celine: {
        displayName: 'Malialia Celine',
        tier: 'light',
        floor: 'Shows up to open debates, wish birthdays, and drop a group link — the group\'s unofficial events committee.',
        nice: [
            'Between the birthday wishes and the debate sign-ups, you\'re quietly the one keeping that group\'s calendar of Nice Things running.'
        ],
        savage: [
            'You\'ve dropped more links and sign-up sheets into that group than actual jokes.'
        ]
    },

    lactio_clarence: {
        displayName: 'Lactio Clarence',
        tier: 'light',
        floor: 'Reappears after long silence purely to land one dry, sarcastic line, then vanishes again.',
        nice: [
            '"It\'s been ages, hasn\'t it" — you resurface like a plot twist and it\'s always a little funnier because of the wait.'
        ],
        savage: [
            'You treat that group chat like a part-time job you only clock into for the punchlines.'
        ]
    },

    tebo_claire: {
        displayName: 'Tebo Claire',
        tier: 'light',
        floor: 'Answers with an actual formula and the phrase "mathematically speaking" like it settles the argument on the spot.',
        nice: [
            'You showed your work with real trial-and-error reasoning on a tricky X/Y puzzle when everyone else just guessed — actual math, unprompted.'
        ],
        savage: [
            '"Mathematically speaking" is doing a lot of heavy lifting to make a WhatsApp guess sound like a peer-reviewed proof.'
        ]
    },

    calvin_ravvle: {
        displayName: 'Calvin RAVVLE',
        tier: 'light',
        floor: 'Drops a photo or video with zero caption, then announces a completely unrelated life plan out of nowhere.',
        nice: [
            'Mid random-media-drop, you casually mentioned joining the US Navy after the semester — absolutely no lead-up, maximum plot twist.'
        ],
        savage: [
            'Your messages alternate between total silence and one-line life announcements with no warning label.'
        ]
    },

    patience_dzekem: {
        displayName: 'Patience Dzekem',
        tier: 'light',
        floor: 'Answers everything in the fewest words possible — right up until money comes up, then suddenly it\'s a full paragraph.',
        nice: [
            'One thread got a run of one-word answers out of you — "C", "7", "Dolphin", done — then the second money got mentioned you were suddenly typing "Financial Independence is my passion" with about six 💯 emojis behind it.'
        ],
        savage: [
            'You\'ll answer a whole quiz in single words, but bring up money and suddenly you\'ve got a full essay loaded and ready to go.'
        ]
    },

    the_actor: {
        displayName: 'The ACTor',
        tier: 'full',
        floor: 'Solo-runs nearly every quiz, debate, and poll that group has ever had — and still has spare time to tease whoever\'s gone quiet, by name.',
        nice: [
            'You warned people they "won\'t see it tomorrow" even if they answered the quiz, threatened a whole thread with being "massacred tomorrow," and still had people lining up to play anyway — pure hype-man-with-a-whistle energy.',
            'Half your messages are just checking in on people by name — "are you here, please," "welcome to," pinging whoever\'s gone quiet — you\'re basically running attendance for a group that never signed up to take it.'
        ],
        savage: [
            'You appointed yourself host, judge, and hype-man of that entire group, nobody elected you, and nobody\'s stopped you either.',
            'Every quiz comes with a threat ("massacred tomorrow," "won\'t see it") like the trivia has stakes — it\'s a WhatsApp group, not a courtroom.'
        ]
    },

    dieudonne_abanji: {
        displayName: 'Mr. Dieudonné Abanji',
        tier: 'light',
        floor: 'Turns a casual group debate into a formally argued position paper, addressed to a chat full of first names as "Boss" and "sir."',
        nice: [
            'The public-vs-private-school debate got a real structured counter-argument out of you — premise, evidence, rebuttal — addressed to "Engr." and "Boss" like it was a committee, not a WhatsApp thread.'
        ],
        savage: [
            'Nobody asked for a formally reasoned position paper on private schools in a group chat, but you delivered one anyway, honorifics included.'
        ]
    }
}

// ── Deliberate exclusions — do not add these back without re-reading
// the safety rules at the top of this file ────────────────────────
//
// - "Ekanje Hadassah" self-identified as a high school student in the
//   chat. No roast content — nice or savage — was written about her,
//   and none should be added later. This isn't a data gap, it's a
//   hard rule.
// - "The ACTor" was previously excluded here as a host/quiz account
//   rather than a peer opting into being roasted. That call has been
//   reversed at the request of the person behind the account, who
//   wants in — a profile was added below built from actual recurring
//   behavior (running the quizzes/debates/polls, teasing quiet
//   members by name), not from fabricated material.
// - Volume bar for this pass: ~14 messages, down from the earlier
//   ~20+. Below that, there usually isn't enough real material to
//   avoid inventing a personality.
// - At the lower bar, Mr. Dieudonné Abanji cleared it — his handful
//   of messages are substantive (a real structured debate argument,
//   formal "Boss"/"sir" address) and were added below.
// - Also reviewed at the lower bar and still left out: Élodie M and
//   DJEUTA TANG ALDJIM KONE — their messages are quiz/riddle answers
//   indistinguishable from material already covered by Terah JAM T /
//   Hamed Corneille / Brice Jervis, not a distinct bit of their own.
//   Christine Choundong was also reviewed — her one genuinely
//   distinct recurring moment (dodging a birthday money request with
//   a running "my account will be blocked" excuse) is finance-based,
//   which this file's own rules treat as an off-limits target
//   category, so it wasn't usable and nothing else about her rose
//   above generic quiz participation.
// - Senders who only ever appear as a bare phone number (no saved
//   contact name in the export) were left out — there isn't enough
//   of an identity to roast without inventing one, and no reliable
//   way to match them to a live WhatsApp sender by name.
// - Several lower-volume named senders were left out for the same
//   reason: too little real material to write an honest anchor from
//   without fabricating an event that didn't happen.

// Tries an exact alias match first. If that fails, falls back to a
// token-overlap match: splits the candidate and every alias into
// words and checks if one is a superset/subset of the other (handles
// a dropped middle name, an extra word, or different word order —
// the common ways a live pushName drifts from the exact spelling
// written into `aliases`). Only returns a fallback match if exactly
// one PERSON's aliases qualify — if two different people's aliases
// both overlap, that's ambiguous, so it returns no match rather than
// guess (a wrong roast delivered to the wrong person is worse than
// "no roast yet").
function findProfile(candidateNames) {
    for (const raw of candidateNames) {
        const norm = normalizeName(raw)
        if (!norm) continue

        // 1) exact match — unchanged fast path
        const exactKey = aliases[norm]
        if (exactKey && profiles[exactKey]) return profiles[exactKey]

        // 2) token-overlap fallback
        const candidateTokens = norm.split(' ').filter(Boolean)
        if (candidateTokens.length === 0) continue

        const matchedKeys = new Set()
        for (const aliasStr in aliases) {
            const aliasTokens = aliasStr.split(' ').filter(Boolean)
            if (aliasTokens.length === 0) continue

            const aliasSubsetOfCandidate = aliasTokens.every(t => candidateTokens.includes(t))
            const candidateSubsetOfAlias = candidateTokens.every(t => aliasTokens.includes(t))

            if (aliasSubsetOfCandidate || candidateSubsetOfAlias) {
                matchedKeys.add(aliases[aliasStr])
            }
        }

        if (matchedKeys.size === 1) {
            const [onlyKey] = matchedKeys
            if (profiles[onlyKey]) return profiles[onlyKey]
        }
        // matchedKeys.size === 0 → no overlap at all, try next candidate
        // matchedKeys.size > 1  → ambiguous across different people, don't guess
    }
    return null
}

module.exports = { profiles, aliases, normalizeName, findProfile }
