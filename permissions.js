// ============================================================
//  permissions.js — Game Bots · Sky Graphics
//  Single source of truth for all role/tier logic.
//  Game-agnostic — imported by index.js and every game module's
//  adminCommands.js. Never import a game module from here (no
//  circular deps).
// ============================================================

// ─── Tier constants ───────────────────────────────────────────
const TIERS = {
    CREATOR: 'CREATOR',
    ADMIN:   'ADMIN',
    PUBLIC:  'PUBLIC'
}

// ─── Tier resolution ──────────────────────────────────────────
/**
 * Strip the device suffix from a JID so two JIDs for the same
 * account (e.g. 237xxx@s.whatsapp.net vs 237xxx:15@lid) can be
 * compared without false negatives.
 *   '77705185873989:15@lid'  → '77705185873989@lid'
 *   '237682477421@s.whatsapp.net' → '237682477421@s.whatsapp.net'
 */
function stripDevice(jid) {
    if (!jid) return ''
    const [localpart, domain] = jid.split('@')
    if (!domain) return jid
    const base = localpart.split(':')[0]
    return `${base}@${domain}`
}

/**
 * Resolve the tier of a sender.
 * @param {string} senderNumber  — plain digits, e.g. "237682477421"
 * @param {object} settings      — { adminNumber, adminJid }
 * @param {string} [senderJid]   — optional full JID; used as LID fallback
 * @returns {'CREATOR'|'ADMIN'|'PUBLIC'}
 */
function getTier(senderNumber, settings, senderJid) {
    const clean      = (senderNumber || '').replace(/[^0-9]/g, '')
    const creatorJid = process.env.CREATOR_JID || ''
    const creatorNum = creatorJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')

    // ── CREATOR checks ──────────────────────────────────────────
    if (creatorNum && clean && clean === creatorNum) return TIERS.CREATOR

    if (senderJid && creatorJid) {
        if (stripDevice(senderJid) === stripDevice(creatorJid)) return TIERS.CREATOR
    }

    // ── ADMIN checks ─────────────────────────────────────────────
    const adminNum = (settings.adminNumber || '').replace(/[^0-9]/g, '')

    if (adminNum && clean && clean === adminNum) return TIERS.ADMIN

    const adminJid = settings.adminJid || ''
    if (senderJid && adminJid) {
        if (stripDevice(senderJid) === stripDevice(adminJid)) return TIERS.ADMIN
    }

    return TIERS.PUBLIC
}

function isCreator(senderNumber, settings, senderJid) {
    return getTier(senderNumber, settings, senderJid) === TIERS.CREATOR
}

function isAdmin(senderNumber, settings, senderJid) {
    const tier = getTier(senderNumber, settings, senderJid)
    return tier === TIERS.CREATOR || tier === TIERS.ADMIN
}

function isPublic(senderNumber, settings, senderJid) {
    return getTier(senderNumber, settings, senderJid) === TIERS.PUBLIC
}

// ─── Settings resolution (conflict-safe) ─────────────────────
/**
 * Resolve the effective value for a setting key.
 * Creator overrides always win. Admin settings are the tenant layer.
 */
function resolveSetting(key, settings, defaultValue) {
    if (
        settings.creatorOverrides &&
        settings.creatorOverrides[key] !== undefined
    ) {
        return settings.creatorOverrides[key]
    }
    if (settings[key] !== undefined) return settings[key]
    return defaultValue
}

/**
 * Write a setting. Creator writes to creatorOverrides (global).
 * Admin writes to root settings (tenant-scoped).
 */
function writeSetting(tier, key, value, settings) {
    if (tier === TIERS.CREATOR) {
        if (!settings.creatorOverrides) settings.creatorOverrides = {}
        settings.creatorOverrides[key] = value
    } else {
        settings[key] = value
    }
}

// ─── Game-access scope (list model) ────────────────────────────
/**
 * settings.adminGameAccess is one of:
 *   - undefined / 'all'  → every game
 *   - an array of gamekeys, e.g. ['hangman', 'wordclimb']
 * A bare gamekey string is also accepted for backward compatibility
 * with data written before the list model (treated as a 1-item list).
 *
 * @returns {boolean} true if the current admin may operate `gamekey`
 */
function hasGameAccess(gamekey, settings) {
    const scope = settings && settings.adminGameAccess
    if (!scope || scope === 'all') return true
    if (Array.isArray(scope)) return scope.includes(gamekey)
    return scope === gamekey // legacy single-string value
}

/**
 * Normalizes whatever is currently stored into an array, so callers
 * that need to add/remove a single key never have to branch on the
 * legacy string shape themselves.
 */
function gameAccessList(settings) {
    const scope = settings && settings.adminGameAccess
    if (!scope || scope === 'all') return []
    if (Array.isArray(scope)) return [...scope]
    return [scope]
}

/** Human-readable summary for dashboards/status replies. */
function describeGameAccess(settings) {
    const scope = settings && settings.adminGameAccess
    if (!scope || scope === 'all') return 'ALL games'
    if (Array.isArray(scope)) return scope.length ? scope.join(', ') : 'not stationed on a game yet'
    return scope
}

// ─── Name-only tag helper ─────────────────────────────────────
/**
 * Returns a display tag using the person's name + role badge if applicable.
 * Never shows a number or JID.
 *
 * The (Creator) and (Admin) badges are gated by TWO INDEPENDENT flags —
 * `settings.creatorRoleTag` and `settings.adminRoleTag` — not one shared
 * toggle. Each tier only ever sees or sets its own flag (enforced in
 * "/game roletags", game-switch-commands.js): the creator cannot turn
 * the admin's tag off, and the admin cannot touch the creator's. Both
 * default to true, preserving prior behavior. This lives here, not
 * per-game, because every game module imports this same function; a
 * per-game toggle would need duplicating in every config.js and would
 * inevitably drift out of sync across games.
 */
function nameTag(number, nameCache, settings) {
    const name = (nameCache && nameCache[number]) || 'Player'

    const creatorJid = process.env.CREATOR_JID || ''
    const creatorNum = creatorJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
    const clean      = (number || '').replace(/[^0-9]/g, '')

    if (creatorNum && clean === creatorNum) {
        const showCreatorTag = !settings || settings.creatorRoleTag !== false
        return showCreatorTag ? `${name} (Creator)` : name
    }

    const adminNum = ((settings && settings.adminNumber) || '').replace(/[^0-9]/g, '')
    if (adminNum && clean === adminNum) {
        const showAdminTag = !settings || settings.adminRoleTag !== false
        return showAdminTag ? `${name} (Admin)` : name
    }

    return name
}

module.exports = {
    TIERS,
    stripDevice,
    getTier,
    isCreator,
    isAdmin,
    isPublic,
    resolveSetting,
    writeSetting,
    nameTag,
    hasGameAccess,
    gameAccessList,
    describeGameAccess
}
