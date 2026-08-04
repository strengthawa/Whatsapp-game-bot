// ============================================================
//  WordChainGame/wordBank.js — Word Chain · Sky Graphics
//  Self-contained word data for this game — deliberately never
//  importing the `word-list` npm package (or any other runtime
//  dependency) the way an earlier draft of this codebase almost did.
//  ARCHITECTURE.md's own incident log (§7) names this exact mistake:
//  mistake: "WordChainGame would have crashed the moment it
//  loaded — it requires the word-list npm package, which was
//  never declared in package.json." Same lesson WordClimbGame's
//  wordBank.js already learned — dictionary-data.json here is a
//  static, offline-generated flat word list, built once from the
//  `an-array-of-english-words` npm package (a plain CJS array,
//  ~275k words), filtered to 3-12 lowercase a-z letters, a short
//  profanity blocklist applied, deduped, and committed as JSON
//  (~241k words across 26 first-letter buckets — no length
//  buckets, since Word Chain only cares that a word is real and
//  starts with the right letter, not how long it is). That npm
//  package is NOT imported at runtime anywhere in this project and
//  is NOT declared in package.json — regenerating this file (e.g.
//  to widen the profanity list) is a one-time offline step, never
//  something that runs in production. This file is also fully
//  self-contained: no cross-game `require()` of WordClimbGame's own
//  (differently-shaped) copy either, per the project rule that no
//  game folder ever knows another one exists.
//
//  Two validation modes:
//    - "free"  — any real English word (dictionary-data.json)
//    - a curated category (animals/fruits/countries) — the word
//      must be in THAT list, not just any real word, so a
//      technically-valid English word outside the category still
//      gets flagged as wrong for that round.
//  Both modes apply the same chain rule (first letter must match
//  the previous word's last letter) and the same no-repeat check
//  — see gameEngine.js's isValidWord() caller.
// ============================================================

const DICTIONARY = require('./dictionary-data.json') // { [letter]: [word, ...] }, pre-lowercased, 3+ letters, deduped

function lettersWithWords() {
    return Object.keys(DICTIONARY)
}

function isRealWord(word) {
    const lw = (word || '').trim().toLowerCase()
    if (lw.length < 3) return false
    const byLetter = DICTIONARY[lw[0]]
    return !!byLetter && byLetter.includes(lw)
}

// ─── Curated categories ───────────────────────────────────────
// Small, hand-picked, offline — no API lookups. Deliberately not
// exhaustive (a "wrong for this category" ruling on a real animal
// that's just missing from the list is an accepted tradeoff of a
// static list, same as any curated-category word game).
const CATEGORY_WORDS = {
    animals: [
        'aardvark', 'albatross', 'alligator', 'alpaca', 'ant', 'anteater', 'antelope', 'ape', 'armadillo', 'baboon',
        'badger', 'bat', 'bear', 'beaver', 'bee', 'beetle', 'bison', 'boar', 'buffalo', 'butterfly',
        'camel', 'capybara', 'caribou', 'cat', 'caterpillar', 'cheetah', 'chicken', 'chimpanzee', 'chinchilla', 'cobra',
        'cockroach', 'cod', 'condor', 'cougar', 'cow', 'coyote', 'crab', 'crane', 'cricket', 'crocodile',
        'crow', 'deer', 'dingo', 'dog', 'dolphin', 'donkey', 'dove', 'dragonfly', 'duck', 'eagle',
        'eel', 'elephant', 'elk', 'emu', 'falcon', 'ferret', 'finch', 'fish', 'flamingo', 'fly',
        'fox', 'frog', 'gazelle', 'gecko', 'giraffe', 'goat', 'goose', 'gorilla', 'grasshopper', 'gull',
        'hamster', 'hare', 'hawk', 'hedgehog', 'heron', 'hippopotamus', 'horse', 'hummingbird', 'hyena', 'ibex',
        'iguana', 'impala', 'jackal', 'jaguar', 'jellyfish', 'kangaroo', 'kingfisher', 'kiwi', 'koala', 'lemur',
        'leopard', 'lion', 'lizard', 'llama', 'lobster', 'lynx', 'macaque', 'magpie', 'mallard', 'mantis',
        'meerkat', 'mole', 'mongoose', 'monkey', 'moose', 'moth', 'mouse', 'mule', 'narwhal', 'newt',
        'nightingale', 'ocelot', 'octopus', 'okapi', 'opossum', 'orangutan', 'ostrich', 'otter', 'owl', 'ox',
        'oyster', 'panda', 'panther', 'parrot', 'peacock', 'pelican', 'penguin', 'pheasant', 'pig', 'pigeon',
        'platypus', 'polecat', 'porcupine', 'porpoise', 'quail', 'rabbit', 'raccoon', 'ram', 'rat', 'raven',
        'reindeer', 'rhinoceros', 'robin', 'rooster', 'salamander', 'salmon', 'scorpion', 'seahorse', 'seal', 'shark',
        'sheep', 'shrew', 'skunk', 'sloth', 'snail', 'snake', 'sparrow', 'spider', 'squid', 'squirrel',
        'stork', 'swan', 'tapir', 'termite', 'tiger', 'toad', 'tortoise', 'toucan', 'trout', 'turkey',
        'turtle', 'urchin', 'vulture', 'wallaby', 'walrus', 'warthog', 'wasp', 'weasel', 'whale', 'wolf',
        'wolverine', 'wombat', 'woodpecker', 'worm', 'yak', 'zebra'
    ],
    fruits: [
        'acai', 'apple', 'apricot', 'avocado', 'banana', 'blackberry', 'blueberry', 'boysenberry', 'breadfruit', 'cantaloupe',
        'cherry', 'clementine', 'coconut', 'cranberry', 'currant', 'date', 'dragonfruit', 'durian', 'elderberry', 'fig', 'gooseberry', 'grape', 'grapefruit', 'guava', 'honeydew', 'jackfruit', 'jujube', 'kiwi', 'kumquat',
        'lemon', 'lime', 'lychee', 'mandarin', 'mango', 'mangosteen', 'melon', 'mulberry', 'nectarine', 'olive',
        'orange', 'papaya', 'passionfruit', 'peach', 'pear', 'persimmon', 'pineapple', 'plum', 'pomegranate', 'pomelo',
        'quince', 'raisin', 'rambutan', 'raspberry', 'redcurrant', 'starfruit', 'strawberry', 'tamarind', 'tangerine', 'watermelon'
    ],
    countries: [
        'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina', 'armenia', 'australia', 'austria', 'azerbaijan',
        'bahamas', 'bahrain', 'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia',
        'botswana', 'brazil', 'brunei', 'bulgaria', 'burundi', 'cambodia', 'cameroon', 'canada', 'chad', 'chile',
        'china', 'colombia', 'comoros', 'congo', 'croatia', 'cuba', 'cyprus', 'denmark', 'djibouti', 'dominica',
        'ecuador', 'egypt', 'eritrea', 'estonia', 'eswatini', 'ethiopia', 'fiji', 'finland', 'france', 'gabon',
        'gambia', 'georgia', 'germany', 'ghana', 'greece', 'grenada', 'guatemala', 'guinea', 'guyana', 'haiti',
        'honduras', 'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'italy',
        'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya', 'kiribati', 'kosovo', 'kuwait', 'laos', 'latvia',
        'lebanon', 'lesotho', 'liberia', 'libya', 'liechtenstein', 'lithuania', 'luxembourg', 'madagascar', 'malawi', 'malaysia',
        'maldives', 'mali', 'malta', 'mexico', 'moldova', 'monaco', 'mongolia', 'montenegro', 'morocco', 'mozambique',
        'myanmar', 'namibia', 'nauru', 'nepal', 'netherlands', 'nicaragua', 'niger', 'nigeria', 'norway', 'oman',
        'pakistan', 'palau', 'panama', 'paraguay', 'peru', 'philippines', 'poland', 'portugal', 'qatar', 'romania',
        'russia', 'rwanda', 'samoa', 'senegal', 'serbia', 'seychelles', 'singapore', 'slovakia', 'slovenia', 'somalia',
        'spain', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria', 'taiwan', 'tajikistan', 'tanzania', 'thailand',
        'togo', 'tonga', 'tunisia', 'turkey', 'tuvalu', 'uganda', 'ukraine', 'uruguay', 'uzbekistan', 'vanuatu',
        'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe'
    ]
}

function isCategoryWord(category, word) {
    const list = CATEGORY_WORDS[category]
    if (!list) return false
    const lw = (word || '').trim().toLowerCase()
    return list.includes(lw)
}

function categoryList(category) {
    return CATEGORY_WORDS[category] || []
}

// The real validation entrypoint — returns WHY a word failed, not
// just yes/no, so the player gets "that's not a fruit" instead of a
// generic "doesn't fit" for every kind of miss. gameEngine.js reads
// `.reason` to pick the right message.
// @param {string}      word            — raw player input
// @param {string|null} requiredLetter  — must match word[0]; null for
//   the opening word of a match (no chain constraint yet)
// @param {string}      category        — 'free' | 'animals' | 'fruits' | 'countries'
// @param {string[]}    usedWords       — already-played words this match, lowercased
// @returns {{valid: boolean, reason: string|null}} reason is one of
//   'too_short' | 'wrong_letter' | 'repeat' | 'not_real' | 'not_in_category' | null (valid)
function validateWord(word, requiredLetter, category, usedWords = []) {
    const lw = (word || '').trim().toLowerCase()
    if (lw.length < 3) return { valid: false, reason: 'too_short' }
    if (requiredLetter && lw[0] !== requiredLetter) return { valid: false, reason: 'wrong_letter' }
    if (usedWords.includes(lw)) return { valid: false, reason: 'repeat' }
    const ok = category === 'free' ? isRealWord(lw) : isCategoryWord(category, lw)
    if (!ok) return { valid: false, reason: category === 'free' ? 'not_real' : 'not_in_category' }
    return { valid: true, reason: null }
}

// Boolean convenience wrapper over validateWord() — kept for anything
// that only needs yes/no (e.g. quick sanity checks in tests).
function isValidWord(word, requiredLetter, category, usedWords = []) {
    return validateWord(word, requiredLetter, category, usedWords).valid
}

module.exports = {
    DICTIONARY,
    CATEGORY_WORDS,
    lettersWithWords,
    isRealWord,
    isCategoryWord,
    categoryList,
    isValidWord,
    validateWord
}
