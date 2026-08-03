// ============================================================
//  scripts/run-tests.js — Game Bots · Sky Graphics
//  Auto-discovers and runs every game folder's tests.js in one pass.
//
//  This mirrors games-registry.js's discovery logic on purpose: any
//  top-level folder (minus the same ignore-list) is a candidate, and
//  a candidate only runs if it has a tests.js. Nothing here is
//  hardcoded by game name — drop a new game folder with a tests.js
//  and it is picked up automatically, no wiring required.
//
//  This is the runtime-behavior companion to scripts/verify-games.js
//  (static/structural). Run both before shipping:
//      npm run verify   → structural (wiring, contracts, syntax)
//      npm test          → behavioral (does it actually work)
// ============================================================

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

// Same ignore-list as games-registry.js — kept in sync deliberately.
// If you add a new non-game top-level folder, add it in both places.
const IGNORED_FOLDERS = new Set([
    'node_modules', '.git', 'reports', 'scripts', 'auth_info', '.github'
])

function discoverCandidateFolders() {
    return fs.readdirSync(ROOT, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => !IGNORED_FOLDERS.has(name) && !name.startsWith('.'))
}

function discoverGamesWithTests() {
    const found = []
    const missing = []
    for (const folder of discoverCandidateFolders()) {
        const testsPath = path.join(ROOT, folder, 'tests.js')
        if (fs.existsSync(testsPath)) {
            found.push({ name: folder, path: testsPath })
        } else {
            // A folder can be a candidate without being a real game (see
            // games-registry.js's own config.js/gameEngine.js/adminCommands.js
            // check). We don't know that here without requiring its files,
            // so we warn rather than fail — a genuine game folder missing
            // tests.js should be visible, not silently skipped.
            missing.push(folder)
        }
    }
    return { found, missing }
}

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('  GAME Bot — behavioral test suite')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const { found, missing } = discoverGamesWithTests()

    console.log(`Discovered ${found.length} game(s) with tests.js: ${found.map(g => g.name).join(', ') || '(none)'}`)
    for (const folder of missing) {
        console.log(`⚠️  WARN: ${folder}/tests.js not found — skipped. If ${folder} is a game folder, see NEW_GAME_HANDOFF.md §10.`)
    }
    console.log('')

    let allPassed = true
    for (const game of found) {
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
