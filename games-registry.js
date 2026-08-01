// ============================================================
//  games-registry.js — Game Bots · Sky Graphics
//  Central registry of pluggable games. Each game lives in its own
//  folder (e.g. /HangmanGame, /WordLadderGame) and exports:
//    config.js          — GAME_KEY, GAME_NAME, PREFIX, ADMIN_PREFIX, ...
//    gameEngine.js       — pure game logic
//    adminCommands.js    — "/" command handler for that game
//
//  Adding a new game = drop its folder in the project root with those
//  three files and it is auto-discovered below. Nothing else in the
//  project needs to change. See README.md for the exact contract.
// ============================================================

const fs   = require('fs')
const path = require('path')

// Folders that are never game folders, even if they happen to sit in the
// project root. Keeps the scan below safe against node_modules, .git, etc.
const IGNORED_FOLDERS = new Set([
    'node_modules', '.git', 'reports', 'scripts', 'auth_info', '.github'
])

/**
 * Every top-level directory in the project root is a CANDIDATE game
 * folder — nothing is hardcoded by name. A candidate only becomes a
 * loaded game if it has a valid config.js + gameEngine.js + adminCommands.js.
 * This is the fix for the historical bug where new game folders were
 * added but silently never discovered because this list was hand-maintained.
 */
function discoverCandidateFolders() {
    return fs.readdirSync(__dirname, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => !IGNORED_FOLDERS.has(name) && !name.startsWith('.'))
}

function tryLoadGame(folderName) {
    const dir        = path.join(__dirname, folderName)
    const configPath = path.join(dir, 'config.js')
    const enginePath = path.join(dir, 'gameEngine.js')
    const adminPath  = path.join(dir, 'adminCommands.js')

    if (!fs.existsSync(configPath) || !fs.existsSync(enginePath) || !fs.existsSync(adminPath)) {
        return null // not a game folder — silently skip, no error, no crash
    }

    try {
        const config        = require(configPath)
        const gameEngine    = require(enginePath)
        const adminCommands = require(adminPath)

        if (!config.GAME_KEY || !config.PREFIX || !config.ADMIN_PREFIX) {
            console.log(`[registry] ⚠️  ${folderName}/config.js is missing GAME_KEY/PREFIX/ADMIN_PREFIX — skipped.`)
            return null
        }
        if (typeof gameEngine.getGameState !== 'function') {
            console.log(`[registry] ⚠️  ${folderName}/gameEngine.js has no getGameState() export — skipped.`)
            return null
        }
        if (typeof adminCommands.handleAdminCommand !== 'function') {
            console.log(`[registry] ⚠️  ${folderName}/adminCommands.js has no handleAdminCommand() export — skipped.`)
            return null
        }
        const hasPublicHandler =
            typeof gameEngine.handlePublicMessage === 'function' ||
            fs.existsSync(path.join(dir, 'publicCommands.js'))
        if (!hasPublicHandler) {
            console.log(`[registry] ⚠️  ${folderName} has no handlePublicMessage (in gameEngine.js or publicCommands.js) — skipped.`)
            return null
        }

        return { folderName, config, gameEngine, adminCommands }
    } catch (err) {
        // A broken game folder (bad syntax, missing npm dependency, etc.)
        // is LOGGED and SKIPPED — it must never take the rest of the bot
        // down with it. This is the core promise of the plugin contract.
        console.log(`[registry] ❌ Could not load game from ${folderName}: ${err.message}`)
        return null
    }
}

const REGISTRY = {}

for (const folder of discoverCandidateFolders()) {
    const game = tryLoadGame(folder)
    if (!game) continue
    if (REGISTRY[game.config.GAME_KEY]) {
        console.log(`[registry] ⚠️  Duplicate GAME_KEY "${game.config.GAME_KEY}" — "${folder}" ignored, keeping "${REGISTRY[game.config.GAME_KEY].folderName}".`)
        continue
    }
    REGISTRY[game.config.GAME_KEY] = game
    console.log(`[registry] ✅ Loaded ${folder} → key "${game.config.GAME_KEY}" (${game.config.PREFIX} / ${game.config.ADMIN_PREFIX.trim()})`)
}

function listGameKeys() {
    return Object.keys(REGISTRY)
}

function getGame(key) {
    return REGISTRY[(key || '').toLowerCase()] || null
}

/**
 * Returns the currently active game module, falling back to hangman
 * (or whatever loaded first) if the configured key isn't available.
 */
function getActiveGame(settings) {
    const key = (settings && settings.activeGame) || 'hangman'
    return REGISTRY[key] || REGISTRY['hangman'] || Object.values(REGISTRY)[0] || null
}

module.exports = { REGISTRY, listGameKeys, getGame, getActiveGame }
