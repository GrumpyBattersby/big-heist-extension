// Big Heist Extension Backend
//
// What this does:
// 1. Streamer.bot pushes each perp's current inventory/skills here whenever they change
//    (POST /api/push-data, secured with a shared secret only you and Streamer.bot know)
// 2. The Extension panel (running in each viewer's browser on Twitch) asks this server
//    for THEIR OWN data (GET /api/my-data), proving who they are via a signed token
//    that Twitch itself provides - nobody can ask for someone else's data.
//
// REQUIRED ENVIRONMENT VARIABLES (set these in Render's dashboard, never in this file):
//   PUSH_SECRET   - a password you make up, shared between this server and your Streamer.bot script
//   EXT_SECRET    - your Extension's own secret, found in the Twitch Developer Console under
//                   your Extension > Settings > "Secret" (this is base64-encoded already, use it as-is)
//
// Data is stored in memory and backed up to a local JSON file. On Render's free tier this file
// may not survive a restart - that's fine, Streamer.bot will just push fresh data again next time
// something changes, so the store repopulates itself naturally within moments of the stream starting.

const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PUSH_SECRET = process.env.PUSH_SECRET;
const EXT_SECRET = process.env.EXT_SECRET;
const DATA_FILE = './perp-data-store.json';

if (!PUSH_SECRET || !EXT_SECRET) {
    console.error('FATAL: PUSH_SECRET and EXT_SECRET must both be set as environment variables.');
    process.exit(1);
}

// ============================
// LOAD/SAVE the simple JSON-backed store
// ============================
let store = {};
try {
    if (fs.existsSync(DATA_FILE)) {
        store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
} catch (err) {
    console.warn('Could not load existing data file, starting fresh:', err.message);
}

function saveStore() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(store), 'utf8');
    } catch (err) {
        console.warn('Could not save data file:', err.message);
    }
}

// ============================
// HEALTH CHECK - useful for confirming the service is alive, and for uptime pings
// to keep Render's free tier from sleeping if you want to try that
// ============================
app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', perpsStored: Object.keys(store).length });
});

// ============================
// PUSH DATA - called by Streamer.bot whenever a perp's inventory or skills change
// ============================
app.post('/api/push-data', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { userId, name, points, inventory, skills, lastCrime, crimeStatus, cubeReleaseAt, achievements, pendingMugshotPick, candidateHashes, mugshotVersion, mugshotHash, panelOverride, pickpocketedTargets, isTestAccount, pickpocketNotice, shopBannedUntil, offendedBannedUntil, personalHeat, showHeat } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    store[userId] = {
        name: name || userId,
        points: points || 0,
        inventory: inventory || {},
        skills: skills || {},
        lastCrime: lastCrime || '',
        crimeStatus: crimeStatus || 'CITIZEN',
        // Unix seconds, or null if not currently jailed - lets the frontend render a live
        // ticking countdown client-side instead of relying on a frozen crimeStatus string.
        cubeReleaseAt: cubeReleaseAt || null,
        achievements: achievements || [],
        pendingMugshotPick: !!pendingMugshotPick,
        // Ground-truth SHA-256 hashes of each candidate's actual file bytes, computed by
        // Become Perp at upload time - lets the panel verify a fetched image is genuinely
        // correct rather than trusting a bare 200 OK from GitHub Pages, whose CDN can serve
        // stale-but-successful responses for a while after a real upload/delete.
        candidateHashes: candidateHashes || [],
        mugshotVersion: mugshotVersion || '0',
        // Same ground-truth verification, but for the final claimed mugshot - computed by
        // Pick Mugshot at claim time.
        mugshotHash: mugshotHash || '',
        // Temporary panel takeover set by Juan's Emporium (shop browsing, finders-fee/haggle,
        // item info) - the frontend shows this instead of the normal character sheet while it's
        // present; Sync To Extension only ever sends a non-null value if it hasn't expired yet.
        panelOverride: panelOverride || null,
        pickpocketedTargets: pickpocketedTargets || [],
        isTestAccount: !!isTestAccount,
        pickpocketNotice: pickpocketNotice || null,
        shopBannedUntil: shopBannedUntil || 0,
        offendedBannedUntil: offendedBannedUntil || 0,
        personalHeat: personalHeat || 0,
        showHeat: showHeat || 0,
        updatedAt: new Date().toISOString()
    };

    saveStore();

    res.json({ success: true });
});

// ============================
// DELETE DATA - called when a perp's status is reset (e.g. Debug - Remove Perp Status),
// so the panel doesn't keep showing stale data for someone who's no longer a perp
// ============================
app.post('/api/delete-data', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    delete store[userId];
    saveStore();

    res.json({ success: true });
});

// ============================
// MY DATA - called by the Extension frontend, authenticated via Twitch's own signed token.
// Twitch signs a JWT and hands it to the Extension automatically when it loads - we just
// verify it came from Twitch (using our Extension Secret) and trust the userId inside it.
// ============================
app.get('/api/my-data', (req, res) => {
    // This endpoint is per-viewer and personalized - caching it (whether by the browser,
    // Twitch's CDN, or any proxy in between) would serve one viewer's data to another,
    // or stale data after an update. Always disallow caching here.
    res.set('Cache-Control', 'no-store');

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
        decoded = jwt.verify(token, Buffer.from(EXT_SECRET, 'base64'), { algorithms: ['HS256'] });
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // decoded.user_id is only present if the viewer has granted "share your Twitch user ID"
    // permission to the Extension - without it we only get an opaque, per-extension ID that
    // won't match the real Twitch userId Streamer.bot uses, so we have to ask for it explicitly.
    if (!decoded.user_id) {
        return res.status(403).json({
            error: 'identity_not_shared',
            message: 'Please share your Twitch identity with this Extension to see your inventory.'
        });
    }

    const perpData = store[decoded.user_id];

    if (!perpData) {
        return res.json({
            found: false,
            message: "No perp data found yet - have you run !becomeperp on stream?"
        });
    }

    res.json({
        found: true,
        userId: decoded.user_id,
        name: perpData.name,
        points: perpData.points || 0,
        inventory: perpData.inventory,
        skills: perpData.skills,
        lastCrime: perpData.lastCrime,
        crimeStatus: perpData.crimeStatus,
        cubeReleaseAt: perpData.cubeReleaseAt || null,
        achievements: perpData.achievements,
        pendingMugshotPick: perpData.pendingMugshotPick || false,
        candidateHashes: perpData.candidateHashes || [],
        mugshotVersion: perpData.mugshotVersion || '0',
        mugshotHash: perpData.mugshotHash || '',
        panelOverride: perpData.panelOverride || null,
        pickpocketedTargets: perpData.pickpocketedTargets || [],
        isTestAccount: perpData.isTestAccount || false,
        pickpocketNotice: perpData.pickpocketNotice || null,
        shopBannedUntil: perpData.shopBannedUntil || 0,
        offendedBannedUntil: perpData.offendedBannedUntil || 0,
        personalHeat: perpData.personalHeat || 0,
        showHeat: perpData.showHeat || 0,
        presentViewers: presentViewers,
        shopListing: shopListing,
        updatedAt: perpData.updatedAt
    });
});

// ============================
// PANEL ACTION QUEUE - lets the Extension panel trigger real Streamer.bot actions (buying an
// item, clearing the shop view, opening the shop) WITHOUT the player typing a chat command.
// Streamer.bot has no way to be "called into" directly (it runs on the streamer's own PC, not a
// public server), so this works as a queue instead: the panel POSTs an action here, and a new
// Streamer.bot action polls GET /api/pending-actions every few seconds (via a Timer trigger) to
// pick up and actually execute anything queued. This means a few seconds of delay between a
// click and it actually happening, but nothing needs to be exposed to the internet beyond this
// already-trusted backend.
// In-memory only (not persisted to the JSON backup file) - these are meant to be picked up
// within seconds, so surviving a restart isn't a concern the way the main perp store is.
// ============================
let pendingActions = [];
let nextActionId = 1;

// ============================
// PRESENT VIEWERS - pushed periodically by Big Heist - Track Present Viewers (bound to
// Streamer.bot's own Present Viewers trigger), used for things like a Pickpocket target picker
// in the panel - shows everyone actually present in chat right now (including logged-in
// lurkers who haven't typed anything), not just people who've recently spoken.
// ============================
let presentViewers = [];

app.post('/api/push-present-viewers', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { viewers } = req.body;
    presentViewers = Array.isArray(viewers) ? viewers : [];

    res.json({ success: true });
});

// ============================
// SHOP LISTING - pushed passively by Rotation Script whenever the shop restocks (once a stream,
// typically), so the panel can show it INSTANTLY as a client-side toggle - no round-trip needed
// just to browse, since this only changes when a restock happens. Buying still goes through the
// normal action queue, which re-validates everything fresh at the actual moment of purchase -
// this is only ever a display convenience, never trusted for the real transaction.
// ============================
let shopListing = [];

app.post('/api/push-shop-listing', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { items } = req.body;
    shopListing = Array.isArray(items) ? items : [];

    res.json({ success: true });
});

// Called by the PANEL (authenticated the same way as /api/my-data - Twitch's own signed token,
// so nobody can queue an action pretending to be someone else).
app.post('/api/queue-action', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
        decoded = jwt.verify(token, Buffer.from(EXT_SECRET, 'base64'), { algorithms: ['HS256'] });
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!decoded.user_id) {
        return res.status(403).json({
            error: 'identity_not_shared',
            message: 'Please share your Twitch identity with this Extension to do that.'
        });
    }

    const { type, payload } = req.body;
    if (!type) {
        return res.status(400).json({ error: 'type is required' });
    }

    pendingActions.push({
        id: nextActionId++,
        userId: decoded.user_id,
        type: type,
        payload: payload || {},
        queuedAt: new Date().toISOString()
    });

    res.json({ success: true });
});

// Called by Streamer.bot's Timer-triggered poller - authenticated with the same push secret as
// the other Streamer.bot-only endpoints. Pops (returns AND clears) everything queued so far in
// one atomic step, rather than a separate get-then-acknowledge pair - simpler, and avoids any
// risk of the same action being picked up twice if a separate "ack" call ever failed partway.
app.get('/api/pending-actions', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const actions = pendingActions;
    pendingActions = [];

    res.json({ actions: actions });
});

app.listen(PORT, () => {
    console.log('Big Heist Extension backend running on port ' + PORT);
});
