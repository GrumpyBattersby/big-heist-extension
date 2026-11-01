// ============================
// CRIME BOARD - the players' shared investigation board (cards, arrows, team notes).
//
// Mounted from server.js with:
//     require('./crimeboard')(app, { resolveIdentity, getPerp, queueAction, PUSH_SECRET, EXT_SECRET });
//
// TWO BOARDS (2026-11-01)
//   This file runs two separate boards with the same code:
//     Crime Board            /api/crimeboard    the Judges' board (blue), saved under crimeboard/
//     Crime Board (Perps)    /api/blockmarket   the Perps' own board (dark red), saved under blockmarket/
//                            (shown to players as "Crime Board" too; "blockmarket" is just its old name)
//   Each has its own cards, teams, scenarios and players; neither side can see the other's board.
//   They share one M.A.C. list (people/places/items), which Streamer.bot pushes to
//   /api/crimeboard/catalog and is saved as crimeboard/catalog.json. The broadcaster is GM on both.
//
// HIDDEN CARDS AND CRIME FAMILIES (2026-11-01)
//   The GM can add a card hidden ("hidden": true): players don't see it, its arrows or its notes
//   until the GM reveals it. Crime families are org charts (Boss down to Associates) kept ONCE for
//   both boards in crimeboard/families.json; only the GM edits them, and every person in a family
//   is revealed per board (Judges, Perps, or both). Players only ever receive what's been revealed
//   to their board - hidden things never leave the server for them.
//
// WHO CAN USE IT
//   Crime Board: a Judges-group member or anyone with a Judge character assigned.
//   Perps' Crime Board: anyone with a Perp character assigned.
//   (The rest of this header describes either board; "crimeboard" paths have "blockmarket" twins.)
//   Players: as above
//   (assignedJudgeName/assignedPerpName, pushed by Sync To Extension). Once someone has opened the
//   board they stay registered, so access survives between sessions. The GM can remove a player,
//   which also stops them re-registering until the GM lets them back in.
//   GM: the broadcaster of YOUR channel (Twitch JWT role + channel ID check), plus anyone listed
//   in CRIMEBOARD_GM_IDS.
//
// TEAMS
//   The GM creates, renames, recolours and deletes teams, picks each team's scenario, and lists
//   each team's members by character name ("Judge Kee", "Quin") or Twitch name. A player is on
//   whichever team lists their character (or their Twitch name).
//
// CARDS
//   Streamer.bot pushes People/Places/Items Data.json to POST /api/crimeboard/catalog. Record cards
//   always show the CURRENT record text and picture. Players can pin people/places/items that
//   aren't in M.A.C. yet ("new leads"); a later catalog push with the same name turns the lead
//   into the real case file, keeping the player's description as a note.
//
// STORAGE AND BACKUPS
//   In memory, a local file, and (with GITHUB_TOKEN) crimeboard/board.json + catalog.json on a
//   separate "crimeboard-data" branch of the GitHub repo - every save is a commit, so GitHub's
//   history is a full undo log. Once a day a dated copy also goes to crimeboard/backups/. A
//   Streamer.bot action pulls copies to the PC (GET /api/crimeboard/backup) and can put one back
//   (POST /api/crimeboard/restore); a restore snapshots the board it replaces first.
//
// ON STREAM (OBS)
//   GET /api/crimeboard/obs?key=CRIMEBOARD_OBS_KEY is a read-only feed for the OBS browser source
//   page. The GM ("Show on stream" in the board) or Streamer.bot (POST /api/crimeboard/obs-focus)
//   choose what it zooms to.
//
// SECURITY
//   Nothing the panel sends is trusted: identity comes from the signed Twitch JWT (or YouTube link
//   session), every change is checked here, sizes are capped, image uploads must be real
//   JPEG/PNG/WebP data, and every route is rate limited.
//
// ENVIRONMENT VARIABLES (Render dashboard)
//   GITHUB_TOKEN          fine-grained token, Contents: Read and write, on the repo below (needed
//                         for the board to survive Render restarts)
//   TWITCH_CHANNEL_ID     your channel's numeric ID - only that channel's broadcaster gets GM tools
//   CRIMEBOARD_OBS_KEY    long random string; goes in the OBS browser source URL
//   CRIMEBOARD_GM_IDS     optional, comma-separated user IDs of co-GMs
//   CRIMEBOARD_REPO       default "GrumpyBattersby/big-heist-extension"
//   CRIMEBOARD_BRANCH     default "crimeboard-data" (created automatically from main)
// ============================

const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const express = require('express');
const { secretOk, rateLimit, counter } = require('./guard');

const CARD_TYPES = ['Person', 'Robot', 'Location', 'Evidence', 'Group', 'Crime', 'Event'];
// Flags a player can put on a person (or robot) card. Cubed and dead end an APB; dead and cubed
// rule each other out. Added 2026-11-01.
const FLAGS = { investigate: 'under investigation', apb: 'APB', cubed: 'cubed', dead: 'dead' };
const FLAG_CLEARS = { cubed: ['apb', 'dead'], dead: ['apb', 'cubed', 'investigate'] };
const FLAGGABLE = ['Person', 'Robot'];
const KIND_TYPE = { person: 'Person', robot: 'Robot', place: 'Location', item: 'Evidence' };
const IMG_BASE = process.env.CRIMEBOARD_IMG_BASE || 'https://grumpybattersby.github.io/big-heist-extension';
const IMG_FOLDER = { person: 'people', robot: 'people', place: 'places', item: 'mac-items' };

// The two boards. Everything that differs between them lives here.
const BOARDS = {
    crime: {
        key: 'crime', name: 'Crime Board', base: '/api/crimeboard', dir: 'crimeboard',
        boardFile: './crimeboard-store.json', ownsCatalog: true, showAction: 'crimeBoardShow',
        teams: [
            { name: 'Gold Judge Team', color: '#c97400', members: [] },
            { name: 'Green Judge Team', color: '#0f9a49', members: [] }
        ],
        v1Codes: ['GOLD', 'GREEN'],
        character: p => p.assignedJudgeName,
        eligible: p => !!(p.assignedJudgeName || p.isWatchingJudge),
        // Perps were on this board until 2026-11-01; anyone who is now only a Perp is kept out.
        excluded: p => !!(p.assignedPerpName && !p.assignedJudgeName && !p.isWatchingJudge),
        notPlayer: 'The Crime Board is for the Judges playing in the RPG.'
    },
    market: {
        key: 'market', name: 'Crime Board', log: 'Crime Board (Perps)', base: '/api/blockmarket', dir: 'blockmarket',
        boardFile: './blockmarket-store.json', ownsCatalog: false, showAction: 'blockMarketShow',
        teams: [
            { name: 'Red Perp Team', color: '#d42a2a', members: ['Quin', 'Flink'] }
        ],
        v1Codes: [],
        // With only one crew on the Perps' board, every Perp is on it without the GM listing them.
        soloTeam: true,
        character: p => p.assignedPerpName,
        eligible: p => !!p.assignedPerpName,
        excluded: p => !p.assignedPerpName && !!(p.assignedJudgeName || p.isWatchingJudge),
        notPlayer: 'This Crime Board is for the Perps playing in the RPG.'
    }
};

// The M.A.C. list both boards draw from. The Crime Board loads, saves and receives it.
const shared = { catalog: { version: 0, updatedAt: null, records: [] }, recIndex: new Map(), boards: [],
    families: { v: 1, families: [] } };

// Crime family ranks, top to bottom.
const RANKS = ['Boss', 'Underboss', 'Consigliere', 'Capo', 'Soldier', 'Associate'];
const FAM_LIMITS = { families: 30, people: 80, name: 60, details: 2000 };
const FAMILIES_FILE = './crimeboard-families.json';

function normalizeFamilies(f) {
    const out = { v: 1, families: [] };
    if (!f || !Array.isArray(f.families)) return out;
    out.families = f.families.filter(x => x && x.id).map(x => ({
        id: String(x.id), name: clip(x.name, FAM_LIMITS.name) || 'Unnamed family', color: isColor(x.color) ? x.color : '#b8862b',
        people: (Array.isArray(x.people) ? x.people : []).filter(p => p && p.id).map(p => ({
            id: String(p.id), name: clip(p.name, FAM_LIMITS.name) || 'Unknown', rank: RANKS.includes(p.rank) ? p.rank : 'Associate',
            reportsTo: p.reportsTo ? String(p.reportsTo) : null, details: clip(p.details, FAM_LIMITS.details),
            show: { crime: !!(p.show && p.show.crime), market: !!(p.show && p.show.market) }
        }))
    }));
    return out;
}

// What one board's players may see: only revealed people, and "reports to" skips over anyone
// still hidden (it points at the nearest revealed boss above them, or nobody).
function familiesFor(key, isGM) {
    const all = shared.families.families;
    if (isGM) return all;
    return all.map(f => {
        const byId = new Map(f.people.map(p => [p.id, p]));
        const seen = p => p.show[key];
        const people = f.people.filter(seen).map(p => {
            let up = p.reportsTo, guard = 0;
            while (up && byId.has(up) && !seen(byId.get(up)) && guard++ < 100) up = byId.get(up).reportsTo;
            return { id: p.id, name: p.name, rank: p.rank, details: p.details, reportsTo: up && byId.has(up) ? up : null };
        });
        return people.length ? { id: f.id, name: f.name, color: f.color, people } : null;
    }).filter(Boolean);
}

const LIMITS = { name: 60, details: 3000, note: 1500, label: 40, caseName: 60, teamName: 40, member: 60, members: 40, teams: 12,
    cases: 40, img: 220000, items: 800, links: 2000, notes: 5000, events: 30, players: 200 };

const CATALOG_FILE = './crimeboard-catalog.json';
const GH = {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.CRIMEBOARD_REPO || 'GrumpyBattersby/big-heist-extension',
    branch: process.env.CRIMEBOARD_BRANCH || 'crimeboard-data',
    api: process.env.CRIMEBOARD_GITHUB_API || 'https://api.github.com'
};
const CHANNEL_ID = String(process.env.TWITCH_CHANNEL_ID || '').trim();
const OBS_KEY = String(process.env.CRIMEBOARD_OBS_KEY || '').trim();
const GM_IDS = String(process.env.CRIMEBOARD_GM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

// ---------- helpers ----------

const nameKey = n => String(n || '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
// Trims, removes control characters and caps the length of any text a player sends.
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n).trim();
const newId = p => p + crypto.randomBytes(5).toString('hex');
const isNum = v => typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e6;
const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const today = () => new Date().toISOString().slice(0, 10);

// A clue picture must be a small base64 JPEG/PNG/WebP whose first bytes really are that format.
function cleanImg(v) {
    if (typeof v !== 'string' || v.length > LIMITS.img) return undefined;
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
    if (!m) return undefined;
    const head = Buffer.from(m[2].slice(0, 24), 'base64');
    const ok = (m[1] === 'jpeg' && head[0] === 0xff && head[1] === 0xd8)
        || (m[1] === 'png' && head.slice(0, 4).toString('hex') === '89504e47')
        || (m[1] === 'webp' && head.slice(0, 4).toString() === 'RIFF' && head.slice(8, 12).toString() === 'WEBP');
    return ok ? v : undefined;
}

function emptyBoard(cfg) {
    const b = {
        v: 2, rev: 1, perpsMoved: true,
        cases: [{ id: 'c1', name: 'First scenario' }],
        teams: [], retiredTeams: {},
        players: {}, blocked: {},
        items: [], links: [], notes: [], events: [],
        obsFocus: { seq: 0, kind: 'all', id: null, label: 'Whole board' }
    };
    cfg.teams.forEach(t => b.teams.push(Object.assign({ id: newId('t'), caseId: 'c1' }, JSON.parse(JSON.stringify(t)))));
    return b;
}

// Fills in anything missing (older saves, hand-edited backups) so the rest of the code can rely on it.
function normalize(b, cfg) {
    if (!b || typeof b !== 'object') return emptyBoard(cfg);
    const out = Object.assign(emptyBoard(cfg), b);
    ['items', 'links', 'notes', 'events', 'cases'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
    if (!out.cases.length) out.cases = [{ id: 'c1', name: 'First scenario' }];
    ['players', 'blocked', 'retiredTeams'].forEach(k => { if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = {}; });
    if (!Array.isArray(b.teams)) {
        // v1 boards kept teams as { GOLD: caseId, ... } - turn them into full teams.
        const old = (b.teams && typeof b.teams === 'object') ? b.teams : {};
        const codes = cfg.v1Codes;
        out.teams = cfg.teams.map((t, i) => Object.assign({ id: codes[i] || newId('t'), caseId: old[codes[i]] || out.cases[0].id }, JSON.parse(JSON.stringify(t))));
    }
    // 2026-11-01: the Perps got their own board, so the Crime Board's Perp team is retired once.
    // Anything it pinned keeps its name and colour.
    if (cfg.key === 'crime' && !b.perpsMoved) {
        out.teams.filter(t => /perp/i.test(t.name) || t.id === 'RED').forEach(t => { out.retiredTeams[t.id] = { name: t.name, color: t.color }; });
        out.teams = out.teams.filter(t => !(/perp/i.test(t.name) || t.id === 'RED'));
        out.perpsMoved = true;
    }
    out.teams.forEach(t => { if (!Array.isArray(t.members)) t.members = []; if (!isColor(t.color)) t.color = '#8a93a6'; });
    if (!out.obsFocus) out.obsFocus = { seq: 0, kind: 'all', id: null, label: 'Whole board' };
    out.v = 2;
    return out;
}

// Turns the three M.A.C. data files into one list of records. Records marked "active": false are
// left out, the same way M.A.C. itself hides them.
function buildCatalog(people, places, items) {
    const out = [];
    const each = (obj, fn) => {
        if (!obj || typeof obj !== 'object') return;
        const entries = Array.isArray(obj) ? obj.map(r => [r && r.name, r]) : Object.entries(obj);
        entries.slice(0, 5000).forEach(([name, r]) => { if (name && r && typeof r === 'object' && r.active !== false) fn(clip(name, 100), r); });
    };
    const text = (...parts) => clip(parts.map(p => Array.isArray(p) ? p.filter(x => typeof x === 'string').join('\n\n') : (typeof p === 'string' ? p : ''))
        .map(s => s.trim()).filter(Boolean).join('\n\n'), 20000);
    const facts = (...parts) => parts.map(s => String(s == null ? '' : s).trim()).filter(s => s && !/^(none|n\/a|unknown|-)$/i.test(s)).join(' · ').slice(0, 300);
    const imgUrl = (kind, file) => IMG_BASE + '/' + IMG_FOLDER[kind] + '/' + encodeURIComponent(file) + '.png';

    each(people, (name, r) => {
        const kind = String(r.type || '').toLowerCase() === 'robot' ? 'robot' : 'person';
        out.push({ key: nameKey(name), kind, name,
            sub: kind === 'robot' ? facts(r.robotType, r.manufacturer) : facts(r.occupation, r.age ? 'Age ' + r.age : ''),
            details: text(r.description, r.details), img: imgUrl(kind, name) });
    });
    each(places, (name, r) => {
        out.push({ key: nameKey(name), kind: 'place', name,
            sub: facts(r.sector ? 'Sector ' + r.sector : '', r.block, r.owner ? 'Owner: ' + r.owner : '', r.floors ? r.floors + ' floors' : ''),
            details: text(r.motto ? '"' + r.motto + '"' : '', r.details), img: imgUrl('place', name) });
    });
    each(items, (name, r) => {
        out.push({ key: nameKey(name), kind: 'item', name, sub: facts(r.category),
            details: text(r.description, r.details), img: imgUrl('item', name) });
    });
    const seen = new Set();
    return out.filter(r => r.key && !seen.has(r.key) && seen.add(r.key)).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- module ----------

module.exports = function mountBoards(app, deps) {
    mountBoard(app, deps, BOARDS.crime);
    mountBoard(app, deps, BOARDS.market);
    // When Render stops the service on purpose (redeploy, restart, free-plan sleep) it sends SIGTERM
    // and waits up to 30 seconds. Use that time to send anything not yet saved to GitHub, instead of
    // losing up to 15 seconds of changes. Added 2026-11-01.
    process.on('SIGTERM', () => stopSafely('SIGTERM'));
    process.on('SIGINT', () => stopSafely('SIGINT'));
};

async function stopSafely(signal) {
    if (shared.stopping) return;
    shared.stopping = true;   // the boards refuse new changes from here on, so nothing arrives after the save
    console.log('Crime Board: ' + signal + ' - saving both boards to GitHub before stopping');
    const giveUp = setTimeout(() => { console.warn('Crime Board: save before stopping took too long - stopping anyway'); process.exit(0); }, 20000);
    try {
        await Promise.all(shared.boards.map(b => b.saveNow()));
        console.log('Crime Board: saved, stopping');
    } catch (e) {
        console.warn('Crime Board: save before stopping failed - ' + e.message);
    }
    clearTimeout(giveUp);
    process.exit(0);
}

function mountBoard(app, deps, cfg) {
    const { resolveIdentity, getPerp, queueAction, PUSH_SECRET, EXT_SECRET } = deps;
    const NAME = cfg.name, LOG = cfg.log || cfg.name, BASE = cfg.base, DIR = cfg.dir, BOARD_FILE = cfg.boardFile;

    let board = null;
    let loadState = 'loading';           // loading | ready | failed
    let ghBoardSha = null, ghCatalogSha = null, ghFamiliesSha = null;
    let lastSnapshotDay = null, lastSavedAt = null, freshEmpty = false;
    let loggedChannel = false;

    const reindex = () => { shared.recIndex = new Map(shared.catalog.records.map(r => [r.key, r])); };

    if (cfg.ownsCatalog) {
        if (!CHANNEL_ID) console.warn('Crime Board: TWITCH_CHANNEL_ID not set - any channel\'s broadcaster role would count as GM. Set it.');
        if (!GH.token) console.warn('Crime Board: GITHUB_TOKEN not set - the boards are only kept until Render restarts.');
    }

    // ---------- persistence ----------

    function readLocal(file) {
        try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.warn(LOG + ': could not read ' + file + ': ' + e.message); }
        return null;
    }
    function writeLocal(file, data) {
        try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); } catch (e) { console.warn(LOG + ': could not write ' + file + ': ' + e.message); }
    }

    function gh(path, opts) {
        return fetch(GH.api + '/repos/' + GH.repo + path, Object.assign({}, opts, {
            headers: Object.assign({
                'Authorization': 'Bearer ' + GH.token,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'big-heist-crimeboard'
            }, opts && opts.body ? { 'Content-Type': 'application/json' } : {}, (opts && opts.headers) || {})
        }));
    }
    async function ghRead(file) {
        const res = await gh('/contents/' + file + '?ref=' + encodeURIComponent(GH.branch));
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('GitHub read ' + file + ' failed: ' + res.status);
        const meta = await res.json();
        let text;
        if (meta.content) text = Buffer.from(meta.content, 'base64').toString('utf8');
        else {
            const raw = await gh('/contents/' + file + '?ref=' + encodeURIComponent(GH.branch), { headers: { 'Accept': 'application/vnd.github.raw' } });
            if (!raw.ok) throw new Error('GitHub raw read ' + file + ' failed: ' + raw.status);
            text = await raw.text();
        }
        return { sha: meta.sha, data: JSON.parse(text) };
    }
    async function ensureBranch() {
        const b = await gh('/branches/' + encodeURIComponent(GH.branch));
        if (b.ok) return;
        if (b.status !== 404) throw new Error('GitHub branch check failed: ' + b.status);
        const repo = await (await gh('')).json();
        const base = await gh('/git/ref/heads/' + encodeURIComponent(repo.default_branch || 'main'));
        if (!base.ok) throw new Error('GitHub base branch lookup failed: ' + base.status);
        const sha = (await base.json()).object.sha;
        const made = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + GH.branch, sha }) });
        if (!made.ok && made.status !== 422) throw new Error('GitHub branch create failed: ' + made.status);
    }
    async function ghWrite(file, data, sha, message) {
        const body = { message, branch: GH.branch, content: Buffer.from(JSON.stringify(data)).toString('base64') };
        if (sha) body.sha = sha;
        let res = await gh('/contents/' + file, { method: 'PUT', body: JSON.stringify(body) });
        if (res.status === 404) { await ensureBranch(); res = await gh('/contents/' + file, { method: 'PUT', body: JSON.stringify(body) }); }
        if (res.status === 409 || res.status === 422) {
            const cur = await ghRead(file).catch(() => null);
            body.sha = cur ? cur.sha : undefined;
            res = await gh('/contents/' + file, { method: 'PUT', body: JSON.stringify(body) });
        }
        if (!res.ok) throw new Error('GitHub write ' + file + ' failed: ' + res.status);
        return (await res.json()).content.sha;
    }

    async function load() {
        if (GH.token) {
            try {
                const [b, c, fm] = await Promise.all([ghRead(DIR + '/board.json'), cfg.ownsCatalog ? ghRead('crimeboard/catalog.json') : null,
                    cfg.ownsCatalog ? ghRead('crimeboard/families.json') : null]);
                if (cfg.ownsCatalog) { if (fm) { shared.families = normalizeFamilies(fm.data); ghFamiliesSha = fm.sha; } else shared.families = normalizeFamilies(readLocal(FAMILIES_FILE)); }
                if (b) { board = normalize(b.data, cfg); ghBoardSha = b.sha; }
                else { const local = readLocal(BOARD_FILE); board = local ? normalize(local, cfg) : emptyBoard(cfg); freshEmpty = !local; }
                if (cfg.ownsCatalog) { if (c) { shared.catalog = c.data; ghCatalogSha = c.sha; } else shared.catalog = readLocal(CATALOG_FILE) || shared.catalog; }
                loadState = 'ready';
                console.log(LOG + ': loaded from GitHub (' + board.items.length + ' cards, ' + shared.catalog.records.length + ' M.A.C. records)');
            } catch (e) {
                // Never fall back to an empty board here: saving it would overwrite the real one on GitHub.
                loadState = 'failed';
                console.warn(LOG + ': GitHub load failed, retrying in 30s - ' + e.message);
                setTimeout(load, 30000);
                return;
            }
        } else {
            const local = readLocal(BOARD_FILE);
            board = local ? normalize(local, cfg) : emptyBoard(cfg);
            freshEmpty = !local;
            if (cfg.ownsCatalog) { shared.catalog = readLocal(CATALOG_FILE) || shared.catalog; shared.families = normalizeFamilies(readLocal(FAMILIES_FILE)); }
            loadState = 'ready';
        }
        if (cfg.ownsCatalog) { reindex(); shared.boards.forEach(x => x.syncLeads()); } else syncLeads();
    }

    // Saves are batched: at most one GitHub write per 15 seconds, always of the latest board.
    let saveTimer = null, saving = false, dirtyBoard = false, dirtyCatalog = false, dirtyFamilies = false;
    function scheduleSave(what) {
        if (what === 'catalog') { dirtyCatalog = true; writeLocal(CATALOG_FILE, shared.catalog); }
        else if (what === 'families') { dirtyFamilies = true; writeLocal(FAMILIES_FILE, shared.families); }
        else { dirtyBoard = true; writeLocal(BOARD_FILE, board); }
        if (!GH.token || saveTimer) return;
        saveTimer = setTimeout(flush, 15000);
    }
    async function flush() {
        saveTimer = null;
        if (saving) { saveTimer = setTimeout(flush, 5000); return; }
        saving = true;
        try {
            if (dirtyBoard) {
                dirtyBoard = false;
                const snap = JSON.parse(JSON.stringify(board));
                ghBoardSha = await ghWrite(DIR + '/board.json', snap, ghBoardSha, LOG + ' save (rev ' + snap.rev + ')');
                lastSavedAt = new Date().toISOString();
                if (lastSnapshotDay !== today()) {
                    // One dated copy per day, never overwritten.
                    const day = today();
                    const existing = await ghRead(DIR + '/backups/board-' + day + '.json').catch(() => null);
                    if (!existing) await ghWrite(DIR + '/backups/board-' + day + '.json', snap, null, LOG + ' daily backup ' + day);
                    lastSnapshotDay = day;
                }
            }
            if (dirtyCatalog) { dirtyCatalog = false; ghCatalogSha = await ghWrite('crimeboard/catalog.json', shared.catalog, ghCatalogSha, 'M.A.C. catalog v' + shared.catalog.version); }
            if (dirtyFamilies) { dirtyFamilies = false; ghFamiliesSha = await ghWrite('crimeboard/families.json', shared.families, ghFamiliesSha, 'Crime families save'); }
        } catch (e) {
            console.warn(LOG + ': GitHub save failed, will retry - ' + e.message);
            dirtyBoard = true;
            if (cfg.ownsCatalog) dirtyFamilies = true;
            saveTimer = setTimeout(flush, 30000);
        } finally { saving = false; }
    }

    // Saves straight away (used when the service is stopping). Waits for a save already under way.
    async function saveNow() {
        if (!GH.token || !board) return;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        for (let i = 0; i < 40 && saving; i++) await new Promise(r => setTimeout(r, 250));
        if (dirtyBoard || dirtyCatalog || dirtyFamilies) await flush();
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (dirtyBoard || dirtyCatalog || dirtyFamilies) throw new Error(LOG + ' could not reach GitHub');
    }

    const changed = () => { board.rev = (board.rev || 0) + 1; freshEmpty = false; scheduleSave('board'); };

    function event(text) {
        board.events.push({ id: newId('e'), at: Date.now(), text });
        if (board.events.length > LIMITS.events) board.events = board.events.slice(-LIMITS.events);
    }

    function syncLeads() {
        if (!board) return;
        const recIndex = shared.recIndex;
        const linked = [];
        let hiddenLinked = false;
        board.items.forEach(i => {
            if (i.src !== 'pending') return;
            const r = recIndex.get(nameKey(i.name));
            if (!r) return;
            if (i.details) board.notes.push({ id: newId('n'), itemId: i.id, team: i.team, by: i.editedBy || 'Player', at: i.editedAt || Date.now(),
                text: 'Our description before the case file arrived: ' + i.details });
            i.src = 'record'; i.name = r.name; i.type = KIND_TYPE[r.kind]; i.details = ''; delete i.img;
            if (!i.hidden) linked.push(r.name); else hiddenLinked = true;
        });
        if (hiddenLinked && !linked.length) changed();
        if (linked.length) {
            event('The GM added ' + (linked.length === 1 ? 'a case file' : linked.length + ' case files') + ' for ' + linked.join(', ') + '. The board has updated.');
            changed();
        }
    }

    // ---------- identity and teams ----------

    const displayName = p => (p.character || p.name || 'Player');
    const teamById = id => board.teams.find(t => t.id === id);
    function teamOf(p) {
        const keys = [p.character, p.name].filter(Boolean).map(nameKey);
        const t = board.teams.find(t => t.members.some(m => keys.includes(nameKey(m))));
        if (!t && cfg.soloTeam && board.teams.length === 1) return board.teams[0].id;
        return t ? t.id : null;
    }

    function verifyJwt(req) {
        const auth = req.headers['authorization'];
        if (!auth || !auth.startsWith('Bearer ')) return null;
        try { return jwt.verify(auth.substring(7), Buffer.from(EXT_SECRET, 'base64'), { algorithms: ['HS256'] }); } catch (e) { return null; }
    }

    function whoIs(req) {
        const identity = resolveIdentity(req);
        if (identity.error) return identity;
        const userId = String(identity.userId);
        const decoded = verifyJwt(req);
        const isBroadcaster = !!(decoded && decoded.role === 'broadcaster' && (!CHANNEL_ID || String(decoded.channel_id) === CHANNEL_ID));
        if (decoded && decoded.role === 'broadcaster' && !CHANNEL_ID && !loggedChannel) {
            loggedChannel = true;
            console.log(LOG + ': the broadcaster opened the board from channel ' + decoded.channel_id + ' - set TWITCH_CHANNEL_ID=' + decoded.channel_id + ' on Render.');
        }
        const isGM = isBroadcaster || GM_IDS.includes(userId);
        if (board.blocked[userId] && !isGM) return { userId, isGM: false, player: null, blocked: true };
        const perp = getPerp(userId) || null;
        const character = perp ? clip(cfg.character(perp) || '', LIMITS.member) || null : null;
        const eligible = !!(perp && cfg.eligible(perp));
        // Someone who now belongs on the other board is kept off this one (and dropped from its list).
        if (perp && !isGM && cfg.excluded(perp)) {
            if (board.players[userId]) { delete board.players[userId]; changed(); }
            return { userId, isGM: false, player: null };
        }
        let player = board.players[userId];
        if (!player && eligible && Object.keys(board.players).length < LIMITS.players) {
            player = board.players[userId] = { name: clip(perp.name, LIMITS.member) || 'Player', character, since: Date.now() };
            changed();
        }
        if (!player && isGM) return { userId, isGM, player: { name: perp ? clip(perp.name, LIMITS.member) : 'GM', character: null }, team: null };
        if (player) {
            const nextName = perp ? clip(perp.name, LIMITS.member) : player.name;
            if (character && player.character !== character) { player.character = character; changed(); }
            if (nextName && player.name !== nextName) { player.name = nextName; changed(); }
        }
        return { userId, isGM, player, team: player ? teamOf(player) : null };
    }

    function deny(res, id) {
        if (id.error) {
            const status = id.error === 'identity_not_shared' || id.error === 'invalid_session' ? 403 : 401;
            return res.status(status).json({ error: id.error, message: id.message });
        }
        if (id.blocked) return res.status(403).json({ error: 'not_a_player', message: 'The GM has removed you from the ' + NAME + '.' });
        return res.status(403).json({ error: 'not_a_player', message: cfg.notPlayer });
    }

    // What the panel sees. Player IDs and the blocked list stay on the server.
    // Players never receive hidden cards, or the arrows and notes on them; the GM gets everything.
    function publicBoard(isGM) {
        const players = Object.values(board.players).map(p => ({ name: displayName(p), team: teamOf(p) }));
        const out = Object.assign({}, board, { players, families: familiesFor(cfg.key, !!isGM) });
        delete out.blocked;
        if (!isGM) {
            const hidden = new Set(board.items.filter(i => i.hidden).map(i => i.id));
            out.items = board.items.filter(i => !hidden.has(i.id));
            out.links = board.links.filter(l => !l.hidden && !hidden.has(l.from) && !hidden.has(l.to));
            out.notes = board.notes.filter(n => !n.hidden && !hidden.has(n.itemId));
        }
        return out;
    }
    function gmView() {
        return {
            players: Object.entries(board.players).map(([uid, p]) => ({ uid, name: p.name, character: p.character, team: teamOf(p) })),
            blocked: Object.entries(board.blocked).map(([uid, b]) => ({ uid, name: b.name })),
            saving: { persistent: !!GH.token, lastSavedAt, obs: !!OBS_KEY, channelLocked: !!CHANNEL_ID }
        };
    }

    // Accepts a team ID, a team name, or the first word of one ("gold").
    function findTeam(v) {
        const k = nameKey(v);
        return board.teams.find(t => t.id === v) || board.teams.find(t => nameKey(t.name) === k) || board.teams.find(t => nameKey(t.name).split(' ')[0] === k);
    }
    function setFocus(kind, id, label) {
        board.obsFocus = { seq: (board.obsFocus.seq || 0) + 1, kind, id: id || null, label: clip(label, 80), at: Date.now() };
    }
    function resolveFocus(target) {
        const t = String(target || 'all');
        const [kind, ...rest] = t.split(':');
        const what = rest.join(':').trim();
        if (kind === 'all' || !what) return { kind: 'all', id: null, label: 'Whole board' };
        if (kind === 'team') { const tm = findTeam(what); return tm ? { kind: 'team', id: tm.id, label: tm.name } : null; }
        if (kind === 'case' || kind === 'scenario') { const c = board.cases.find(c => c.id === what || nameKey(c.name) === nameKey(what)); return c ? { kind: 'case', id: c.id, label: c.name } : null; }
        if (kind === 'card') { const i = board.items.find(i => i.id === what) || board.items.find(i => nameKey(i.name) === nameKey(what)); return i ? { kind: 'card', id: i.id, label: i.name } : null; }
        return null;
    }

    // ---------- guards ----------

    const ipKey = req => req.ip;
    const viewerLimit = rateLimit({ name: cfg.key + '-get', max: 40, windowMs: 10000, key: ipKey });
    const opLimit = rateLimit({ name: cfg.key + '-op', max: 60, windowMs: 10000, key: ipKey });
    const userOver = counter({ max: 25, windowMs: 10000 });
    const obsLimit = rateLimit({ name: cfg.key + '-obs', max: 30, windowMs: 10000, key: ipKey });
    const pushOnly = (req, res, next) => secretOk(req.headers['x-push-secret'], PUSH_SECRET) ? next() : res.status(401).json({ error: 'Invalid push secret' });
    // Bodies are parsed here (server.js skips /api/crimeboard and /api/blockmarket), with a size cap per route.
    const smallJson = express.json({ limit: '300kb' });
    const bigJson = express.json({ limit: '3mb' });
    const ready = (req, res, next) => shared.stopping ? res.status(503).json({ error: 'loading', message: 'The ' + NAME + ' is restarting. Trying again shortly.' })
        : loadState === 'ready' ? next() : res.status(503).json({ error: 'loading', message: 'The ' + NAME + ' is starting up. Trying again shortly.' });

    // ---------- Streamer.bot routes (push secret) ----------

    // One M.A.C. list for both boards, so only the Crime Board takes the push.
    if (cfg.ownsCatalog) app.post('/api/crimeboard/catalog', pushOnly, bigJson, ready, (req, res) => {
        const { people, places, items } = req.body || {};
        const records = buildCatalog(people, places, items);
        if (!records.length) return res.status(400).json({ error: 'No active people, places or items found in that push.' });
        const sig = crypto.createHash('sha1').update(JSON.stringify(records)).digest('hex');
        if (sig !== shared.catalog.sig) {
            shared.catalog = { version: (shared.catalog.version || 0) + 1, sig, updatedAt: new Date().toISOString(), records };
            reindex();
            scheduleSave('catalog');
            shared.boards.forEach(x => x.syncLeads());
        }
        res.json({ success: true, records: records.length, version: shared.catalog.version });
    });

    // The whole board including private parts, for the PC backup copy.
    app.get(BASE + '/backup', pushOnly, ready, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ persistent: !!GH.token, freshEmpty, rev: board.rev, items: board.items.length, savedAt: new Date().toISOString(), board,
            families: cfg.ownsCatalog ? shared.families : undefined });
    });

    // Puts a backup back. The board being replaced is saved to GitHub's backups folder first.
    app.post(BASE + '/restore', pushOnly, bigJson, ready, async (req, res) => {
        const incoming = req.body && req.body.board;
        if (!incoming || !Array.isArray(incoming.items) || !Array.isArray(incoming.cases)) return res.status(400).json({ error: 'That file doesn\'t look like a ' + NAME + ' backup.' });
        if (GH.token) {
            try { await ghWrite(DIR + '/backups/before-restore-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json', board, null, LOG + ': copy of the board replaced by a restore'); }
            catch (e) { return res.status(502).json({ error: 'Couldn\'t save a copy of the current board to GitHub first, so nothing was restored. ' + e.message }); }
        }
        const rev = board.rev;
        board = normalize(incoming, cfg);
        board.rev = Math.max(rev, board.rev || 0);
        event('The GM restored the board from a backup.');
        changed();
        syncLeads();
        res.json({ success: true, items: board.items.length, rev: board.rev });
    });

    // What the OBS view zooms to: target = "all", "team:Gold", "case:<scenario>", "card:<card name>".
    app.post(BASE + '/obs-focus', pushOnly, smallJson, ready, (req, res) => {
        const f = resolveFocus(req.body && req.body.target);
        if (!f) return res.status(404).json({ error: 'Nothing on the board matches ' + clip(req.body && req.body.target, 80) });
        setFocus(f.kind, f.id, f.label);
        changed();
        res.json({ success: true, focus: board.obsFocus });
    });

    // ---------- OBS browser source (key in the URL) ----------

    app.get(BASE + '/obs', obsLimit, ready, (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!OBS_KEY || !secretOk(String(req.query.key || ''), OBS_KEY)) return res.status(401).json({ error: 'bad_key', message: 'Check the key in the OBS browser source URL.' });
        const out = { rev: board.rev, cat: shared.catalog.version, focus: board.obsFocus };
        if (String(req.query.rev) !== String(board.rev)) out.board = publicBoard(false);
        if (String(req.query.cat) !== String(shared.catalog.version)) out.catalog = shared.catalog.records;
        res.json(out);
    });

    // ---------- panel routes (Twitch JWT / YouTube session) ----------

    app.get(BASE, viewerLimit, ready, (req, res) => {
        res.set('Cache-Control', 'no-store');
        const id = whoIs(req);
        if (id.error || !id.player) return deny(res, id);
        const team = id.team ? teamById(id.team) : null;
        const out = {
            me: { name: displayName(id.player), team: id.team, teamName: team ? team.name : null, isGM: id.isGM },
            types: CARD_TYPES,
            rev: board.rev,
            cat: shared.catalog.version
        };
        if (String(req.query.rev) !== String(board.rev)) out.board = publicBoard(id.isGM);
        if (String(req.query.cat) !== String(shared.catalog.version)) out.catalog = shared.catalog.records;
        if (id.isGM) out.gm = gmView();
        res.json(out);
    });

    app.post(BASE + '/op', opLimit, smallJson, ready, (req, res) => {
        res.set('Cache-Control', 'no-store');
        const id = whoIs(req);
        if (id.error || !id.player) return deny(res, id);
        if (userOver(id.userId)) return res.status(429).json({ error: 'rate_limited', message: 'Slow down a little and try again in a moment.' });
        const me = id.player, by = displayName(me);
        const team = id.team || (id.isGM ? 'GM' : null);
        const b = req.body || {};
        const op = String(b.op || '');
        const fail = (msg, code) => res.status(code || 400).json({ error: 'rejected', message: msg });
        // Hidden cards don't exist as far as players are concerned.
        const item = iid => board.items.find(i => i.id === iid && (id.isGM || !i.hidden));
        const recIndex = shared.recIndex;
        const caseExists = cid => board.cases.some(c => c.id === cid);
        const teamLabel = tid => (teamById(tid) || board.retiredTeams[tid] || { name: tid === 'GM' ? 'GM' : 'that team' }).name;
        if (!team && !op.startsWith('gm')) return fail('The GM needs to put you on a team first.');

        switch (op) {
            case 'addCard': {
                if (board.items.length >= LIMITS.items) return fail('The board is full.');
                if (!caseExists(b.caseId)) return fail('That scenario no longer exists.');
                let card;
                if (b.src === 'record') {
                    const r = recIndex.get(nameKey(b.name));
                    if (!r) return fail('M.A.C. has no record called ' + clip(b.name, 60) + '.');
                    if (board.items.some(i => i.caseId === b.caseId && i.src !== 'player' && nameKey(i.name) === r.key)) return fail(r.name + ' is already in that scenario.');
                    card = { src: 'record', name: r.name, type: KIND_TYPE[r.kind], details: '' };
                } else if (b.src === 'pending') {
                    const name = clip(b.name, LIMITS.name);
                    if (!name) return fail('Give the new lead a name.');
                    const kind = ['person', 'robot', 'place', 'item'].includes(b.kind) ? b.kind : 'item';
                    if (recIndex.has(nameKey(name))) return fail(name + ' is already in M.A.C. - pick it from the list.');
                    card = { src: 'pending', name, type: KIND_TYPE[kind], details: clip(b.details, LIMITS.details), editedBy: by, editedAt: Date.now() };
                } else {
                    const name = clip(b.name, LIMITS.name);
                    if (!name) return fail('Give the clue a name.');
                    card = { src: 'player', name, type: CARD_TYPES.includes(b.type) ? b.type : 'Evidence', details: clip(b.details, LIMITS.details), editedBy: by, editedAt: Date.now() };
                    const img = cleanImg(b.img); if (img) card.img = img;
                }
                if (id.isGM && b.hidden === true) card.hidden = true;
                Object.assign(card, { id: newId('i'), caseId: b.caseId, team, by, x: isNum(b.x) ? Math.round(b.x) : 0, y: isNum(b.y) ? Math.round(b.y) : 0 });
                board.items.push(card);
                const note = clip(b.note, LIMITS.note);
                if (note) board.notes.push({ id: newId('n'), itemId: card.id, team, by, at: Date.now(), text: note });  // shows when the card does
                changed();
                return res.json({ ok: true, id: card.id, rev: board.rev, board: publicBoard(id.isGM) });
            }
            case 'editCard': {
                const i = item(b.id);
                if (!i) return fail('That card has gone.');
                if (i.src === 'record') return fail('Case files are kept up to date by the GM.');
                const name = clip(b.name, LIMITS.name);
                // Renaming a new lead to a name that IS in M.A.C. (fixing a typo) turns it into that
                // case file straight away (syncLeads below), keeping its arrows and notes.
                if (name) i.name = name;
                if (typeof b.details === 'string') i.details = clip(b.details, LIMITS.details);
                if (i.src === 'player') {
                    if (CARD_TYPES.includes(b.type)) i.type = b.type;
                    const img = cleanImg(b.img); if (img) i.img = img;
                    if (b.removeImg === true) delete i.img;
                }
                i.editedBy = by; i.editedAt = Date.now();
                syncLeads();
                changed();
                break;
            }
            case 'move': {
                const moves = Array.isArray(b.moves) ? b.moves.slice(0, 400) : [];
                let n = 0;
                moves.forEach(m => { const i = item(m && m.id); if (i && isNum(m.x) && isNum(m.y)) { i.x = Math.round(m.x); i.y = Math.round(m.y); n++; } });
                if (n) changed();
                break;
            }
            case 'deleteCard': {
                const i = item(b.id);
                if (!i) break;
                if (!id.isGM && i.team !== team) return fail('Only the ' + teamLabel(i.team) + ' or the GM can take this card down.');
                board.items = board.items.filter(x => x.id !== i.id);
                board.links = board.links.filter(l => l.from !== i.id && l.to !== i.id);
                board.notes = board.notes.filter(n => n.itemId !== i.id);
                changed();
                break;
            }
            case 'addLink': {
                if (board.links.length >= LIMITS.links) return fail('The board has too many arrows.');
                if (!item(b.from) || !item(b.to) || b.from === b.to) return fail('Pick two different cards.');
                board.links.push(Object.assign({ id: newId('l'), from: b.from, to: b.to, label: clip(b.label, LIMITS.label), team, by, at: Date.now() },
                    id.isGM && b.hidden === true ? { hidden: true } : {}));
                changed();
                break;
            }
            case 'deleteLink': {
                const l = board.links.find(x => x.id === b.id && (id.isGM || !x.hidden));
                if (!l) break;
                if (!id.isGM && l.team !== team) return fail('Only the ' + teamLabel(l.team) + ' or the GM can remove this arrow.');
                board.links = board.links.filter(x => x.id !== l.id);
                changed();
                break;
            }
            case 'addNote': {
                if (board.notes.length >= LIMITS.notes) return fail('The board has too many notes.');
                const text = clip(b.text, LIMITS.note);
                if (!item(b.itemId) || !text) return fail('Write something first.');
                board.notes.push(Object.assign({ id: newId('n'), itemId: b.itemId, team, by, at: Date.now(), text },
                    id.isGM && b.hidden === true ? { hidden: true } : {}));
                changed();
                break;
            }
            case 'setFlag': {
                const i = item(b.id);
                if (!i) return fail('That card has gone.');
                if (!FLAGGABLE.includes(i.type)) return fail('Only people and robots can be flagged.');
                const flag = String(b.flag || '');
                if (!FLAGS[flag]) return fail('Unknown flag.');
                const on = b.on === true;
                // The same person pinned in several scenarios is one person: flag every copy.
                const all = i.src === 'record' ? board.items.filter(x => x.src === 'record' && nameKey(x.name) === nameKey(i.name)) : [i];
                all.forEach(x => {
                    const cur = Array.isArray(x.flags) ? x.flags.filter(f => FLAGS[f]) : [];
                    let next = cur.filter(f => f !== flag);
                    if (on) { next = next.filter(f => !(FLAG_CLEARS[flag] || []).includes(f)); next.push(flag); }
                    x.flags = next;
                    x.flagBy = Object.assign({}, x.flagBy);
                    if (on) x.flagBy[flag] = { by, at: Date.now() }; else delete x.flagBy[flag];
                });
                if (on && !i.hidden) event(by + ' flagged ' + i.name + (flag === 'apb' ? ': APB out.' : flag === 'investigate' ? ' for investigation.' : ' as ' + FLAGS[flag] + '.'));
                changed();
                break;
            }
            case 'deleteNote': {
                const n = board.notes.find(x => x.id === b.id && (id.isGM || !x.hidden));
                if (!n) break;
                if (!id.isGM && n.by !== by) return fail('Only ' + n.by + ' or the GM can delete this note.');
                board.notes = board.notes.filter(x => x.id !== n.id);
                changed();
                break;
            }
            default: {
                if (!op.startsWith('gm')) return fail('Unknown change.');
                if (!id.isGM) return fail('Only the GM can do that.', 403);
                const err = gmOp(b, id);
                if (err) return fail(err);
                changed();
            }
        }
        res.json({ ok: true, rev: board.rev, board: publicBoard(id.isGM), gm: id.isGM ? gmView() : undefined });
    });

    // Crime family changes. Returns an error message, or nothing when the change was made.
    function famOp(b) {
        const fams = shared.families.families;
        const fam = () => fams.find(f => f.id === b.familyId);
        const person = f => f && f.people.find(p => p.id === b.personId);
        const boards = b.board === 'both' ? ['crime', 'market'] : ['crime', 'market'].includes(b.board) ? [b.board] : null;
        switch (b.op) {
            case 'gmFamAdd': {
                const name = clip(b.name, FAM_LIMITS.name); if (!name) return 'Name the family.';
                if (fams.length >= FAM_LIMITS.families) return 'That\'s a lot of families - delete an old one first.';
                fams.push({ id: newId('f'), name, color: isColor(b.color) ? b.color : '#b8862b', people: [] });
                return;
            }
            case 'gmFamEdit': {
                const f = fam(); if (!f) return 'That family has gone.';
                const name = clip(b.name, FAM_LIMITS.name); if (name) f.name = name;
                if (isColor(b.color)) f.color = b.color;
                return;
            }
            case 'gmFamDelete': {
                const i = fams.findIndex(f => f.id === b.familyId); if (i < 0) return;
                fams.splice(i, 1); return;
            }
            case 'gmFamAddPerson': {
                const f = fam(); if (!f) return 'That family has gone.';
                const name = clip(b.name, FAM_LIMITS.name); if (!name) return 'Type a name.';
                if (f.people.length >= FAM_LIMITS.people) return 'That family is full.';
                const rec = shared.recIndex.get(nameKey(name));
                const boss = f.people.find(p => p.id === b.reportsTo);
                // New people start hidden from everyone.
                f.people.push({ id: newId('m'), name: rec ? rec.name : name, rank: RANKS.includes(b.rank) ? b.rank : 'Soldier',
                    reportsTo: boss ? boss.id : null, details: clip(b.details, FAM_LIMITS.details), show: { crime: false, market: false } });
                return;
            }
            case 'gmFamEditPerson': {
                const f = fam(), p = person(f); if (!p) return 'That person has gone.';
                const name = clip(b.name, FAM_LIMITS.name);
                if (name) { const rec = shared.recIndex.get(nameKey(name)); p.name = rec ? rec.name : name; }
                if (RANKS.includes(b.rank)) p.rank = b.rank;
                if (typeof b.details === 'string') p.details = clip(b.details, FAM_LIMITS.details);
                if (b.reportsTo !== undefined) {
                    if (!b.reportsTo) p.reportsTo = null;
                    else {
                        if (!f.people.some(x => x.id === b.reportsTo)) return 'Pick someone in the family.';
                        // No loops: they can't report to themselves or to anyone under them.
                        let up = b.reportsTo, guard = 0;
                        while (up && guard++ < 200) { if (up === p.id) return 'That would make them their own boss.'; const x = f.people.find(y => y.id === up); up = x ? x.reportsTo : null; }
                        p.reportsTo = b.reportsTo;
                    }
                }
                return;
            }
            case 'gmFamRemovePerson': {
                const f = fam(), p = person(f); if (!p) return;
                f.people.forEach(x => { if (x.reportsTo === p.id) x.reportsTo = p.reportsTo; });   // their people move up to their boss
                f.people = f.people.filter(x => x.id !== p.id);
                return;
            }
            case 'gmFamShow': {
                const f = fam(); if (!f) return 'That family has gone.';
                if (!boards) return 'Pick the Judges, the Perps or both.';
                // People are revealed one at a time (the GM's choice, 2026-11-01). The panel sends board: 'both'.
                if (!b.personId) return 'Reveal people one at a time.';
                const who = [person(f)].filter(Boolean);
                if (!who.length) return 'That person has gone.';
                const on = b.on === true;
                boards.forEach(k => {
                    const newly = who.filter(p => on && !p.show[k]);
                    who.forEach(p => { p.show[k] = on; });
                    if (newly.length) shared.boards.filter(x => x.key === k).forEach(x => x.announce(newly.length === 1
                        ? 'New intel on the ' + f.name + ' family: ' + newly[0].name + ' (' + newly[0].rank + ').'
                        : 'New intel: the ' + f.name + ' family (' + newly.length + ' people).'));
                });
                return;
            }
        }
        return 'Unknown change.';
    }
    // Families belong to both boards, so a change bumps both (players poll by board revision).
    function scheduleFamilies() {
        const owner = shared.boards.find(x => x.key === 'crime');
        if (owner) owner.saveFamilies();
        shared.boards.forEach(x => x.touch());
    }

    // GM tools. Returns an error message, or nothing when the change was made.
    function gmOp(b, id) {
        const team = () => teamById(b.teamId);
        const removeMember = name => board.teams.forEach(t => { t.members = t.members.filter(m => nameKey(m) !== nameKey(name)); });
        switch (b.op) {
            case 'gmAddCase': {
                const name = clip(b.name, LIMITS.caseName);
                if (!name) return 'Name the scenario.';
                if (board.cases.length >= LIMITS.cases) return 'That\'s a lot of scenarios - delete an old one first.';
                board.cases.push({ id: newId('c'), name });
                return;
            }
            case 'gmRenameCase': {
                const c = board.cases.find(x => x.id === b.id), name = clip(b.name, LIMITS.caseName);
                if (!c || !name) return 'Name the scenario.';
                c.name = name; return;
            }
            case 'gmDeleteCase': {
                if (board.items.some(i => i.caseId === b.id)) return 'Move or remove the cards in that scenario first.';
                if (board.cases.length <= 1) return 'The board needs at least one scenario.';
                board.cases = board.cases.filter(c => c.id !== b.id);
                board.teams.forEach(t => { if (t.caseId === b.id) t.caseId = board.cases[0].id; });
                return;
            }
            case 'gmAddTeam': {
                const name = clip(b.name, LIMITS.teamName);
                if (!name) return 'Name the team.';
                if (board.teams.length >= LIMITS.teams) return 'That\'s the most teams the board can show.';
                if (board.teams.some(t => nameKey(t.name) === nameKey(name))) return 'There\'s already a team called ' + name + '.';
                board.teams.push({ id: newId('t'), name, color: isColor(b.color) ? b.color : '#1f63ff', caseId: board.cases.some(c => c.id === b.caseId) ? b.caseId : board.cases[0].id, members: [] });
                return;
            }
            case 'gmEditTeam': {
                const t = team(); if (!t) return 'That team has gone.';
                const name = clip(b.name, LIMITS.teamName);
                if (name) t.name = name;
                if (isColor(b.color)) t.color = b.color;
                if (b.caseId !== undefined) { if (!board.cases.some(c => c.id === b.caseId)) return 'Pick a scenario.'; t.caseId = b.caseId; }
                return;
            }
            case 'gmDeleteTeam': {
                const t = team(); if (!t) return;
                // Cards, arrows and notes the team made keep its name and colour.
                board.retiredTeams[t.id] = { name: t.name, color: t.color };
                board.teams = board.teams.filter(x => x.id !== t.id);
                return;
            }
            case 'gmAddMember': {
                const t = team(); const name = clip(b.name, LIMITS.member);
                if (!t || !name) return 'Type the Judge\'s character name or Twitch name.';
                if (t.members.length >= LIMITS.members) return 'That team is full.';
                removeMember(name);
                t.members.push(name);
                return;
            }
            case 'gmRemoveMember': { removeMember(clip(b.name, LIMITS.member)); return; }
            case 'gmRemovePlayer': {
                const p = board.players[b.uid]; if (!p) return 'That player has gone.';
                board.blocked[b.uid] = { name: displayName(p), at: Date.now() };
                delete board.players[b.uid];
                return;
            }
            case 'gmAllowPlayer': { delete board.blocked[b.uid]; return; }

            // ----- hidden cards -----
            // Show or hide anything on the board: a card, an arrow or a note (kind: card | link | note).
            case 'gmCardShow': case 'gmShowThing': {
                const kind = b.op === 'gmCardShow' ? 'card' : String(b.kind || '');
                const list = { card: board.items, link: board.links, note: board.notes }[kind];
                if (!list) return 'Unknown thing to show.';
                const x = list.find(y => y.id === b.id); if (!x) return 'That has gone.';
                if (b.on !== true) { x.hidden = true; return; }
                if (!x.hidden) return;
                delete x.hidden;
                const nm = iid => { const i = board.items.find(y => y.id === iid); return i ? i.name : '?'; };
                if (kind === 'card') event('New on the board: ' + x.name + '.');
                if (kind === 'link') event('New connection: ' + nm(x.from) + ' → ' + nm(x.to) + (x.label ? ' (' + x.label + ')' : '') + '.');
                if (kind === 'note') event('New note on ' + nm(x.itemId) + '.');
                return;
            }

            // ----- crime families (shared by both boards) -----
            case 'gmFamAdd': case 'gmFamEdit': case 'gmFamDelete': case 'gmFamAddPerson': case 'gmFamEditPerson':
            case 'gmFamRemovePerson': case 'gmFamShow': {
                const err = famOp(b);
                if (err) return err;
                scheduleFamilies();
                return;
            }
            case 'gmShow': {
                const f = resolveFocus(b.target);
                if (!f) return 'Nothing on the board matches that.';
                setFocus(f.kind, f.id, f.label);
                // Lets Streamer.bot switch OBS to the board too (see the Process Panel Actions snippet).
                if (b.switchScene && queueAction) queueAction(id.userId, cfg.showAction, { target: String(b.target || 'all').slice(0, 120), board: cfg.key });
                return;
            }
            default: return 'Unknown change.';
        }
    }

    shared.boards.push({ key: cfg.key, syncLeads, saveNow,
        touch: () => { if (board) changed(); },
        announce: text => { if (board) event(text); },
        saveFamilies: () => scheduleSave('families') });
    load();
}

module.exports.buildCatalog = buildCatalog;
module.exports.nameKey = nameKey;
module.exports.cleanImg = cleanImg;
