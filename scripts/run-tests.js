// ============================================================
//  scripts/run-tests.js — Game Bots · Sky Graphics
//  Runs every game's behavioral test file (HangmanGame/tests.js,
//  WordClimbGame/tests.js, RoastGame/tests.js) in one pass.
//
//  This is the runtime-behavior companion to scripts/verify-games.js
//  (static/structural). Run both before shipping:
//      npm run verify   → structural (wiring, contracts, syntax)
//      npm test          → behavioral (does it actually work)
// ============================================================

const games = [
    { name: 'HangmanGame',   path: '../HangmanGame/tests.js' },
    { name: 'WordClimbGame', path: '../WordClimbGame/tests.js' },
    { name: 'RoastGame',     path: '../RoastGame/tests.js' }
]

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('  GAME Bot — behavioral test suite')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    let allPassed = true
    for (const game of games) {
        const mod = require(game.path)
        const ok = await mod.main()
        if (!ok) allPassed = false
        console.log('')
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    if (allPassed) {
        console.log('✅ All behavioral tests passed.')
    } else {
        console.log('❌ Some behavioral tests FAILED — see above.')
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    process.exit(allPassed ? 0 : 1)
}

main()
