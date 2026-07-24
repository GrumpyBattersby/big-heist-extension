// Big Heist Extension Backend
//
// What this does:
// 1. Streamer.bot pushes each perp's current inventory/skills here whenever they change
//    (POST /api/push-data, secured with a shared secret only you and Streamer.bot know)
// 2. The Extension panel (running in each viewer's browser on Twitch) asks this server
//    for THEIR OWN data (GET /api/my-data), proving who they are via a signed token
//    that Twitch itself provides - nobody can ask for someone else's data.
// 3. YouTube viewers use the standalone panel page instead of the Twitch Extension iframe,
//    so they have no Twitch-signed token to prove identity with. Instead they go through a
//    one-time "link code" flow: the panel generates a code, they type "!link <code>" in
//    YouTube chat, Streamer.bot (which already knows their real YouTube identity from that
//    chat message) confirms the claim here, and the panel exchanges that for a session token
//    it can use on every future request - no Google Sign-In needed anywhere in this flow.
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
const crypto = require('crypto');

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

    const { userId, name, points, inventory, skills, lastCrime, crimeStatus, cubeReleaseAt, achievements, pendingMugshotPick, candidateHashes, mugshotVersion, mugshotHash, panelOverride, pickpocketedTargets, isTestAccount, pickpocketNotice, shopBannedUntil, offendedBannedUntil, personalHeat, showHeat, isLayingLow, heatReducingItems, robberyAttemptsRemaining, bigHeist, pendingItemMove, pendingBagmanChoice, bagmanResultNotice, heistRunning } = req.body;

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
        bagmanResultNotice: bagmanResultNotice || null,
        heistRunning: !!heistRunning,
        shopBannedUntil: shopBannedUntil || 0,
        offendedBannedUntil: offendedBannedUntil || 0,
        personalHeat: personalHeat || 0,
        showHeat: showHeat || 0,
        isLayingLow: !!isLayingLow,
        robberyAttemptsRemaining: typeof robberyAttemptsRemaining === 'number' ? robberyAttemptsRemaining : 999,
        bigHeist: bigHeist || null,
        pendingItemMove: pendingItemMove || null,
        pendingBagmanChoice: pendingBagmanChoice || null,
        // Map of owned inventory key -> heat reduction amount, for items that can be burned for
        // a personal+show-wide heat drop (Disguise/EMP/SmokeBomb) - computed server-side by Sync
        // To Extension so the panel doesn't need the full item catalog just to show this list.
        heatReducingItems: heatReducingItems || {},
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
// YOUTUBE PANEL LINK - one-time code flow, no Google Sign-In needed. The standalone panel
// (opened outside Twitch, since Extensions can't run on YouTube) has no automatic identity
// the way the Twitch Extension iframe gets one for free. Instead: the panel asks for a code,
// the viewer types "!link <code>" in YouTube chat, and Streamer.bot - which already knows
// their real YouTube identity because that's how chat messages arrive - confirms the claim
// here. The panel then holds a session token proving it's genuinely that viewer, same end
// result as Twitch's JWT handoff, just carried over chat instead of an iframe.
// ============================
const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes to actually type the code in chat
let youtubeLinkSessions = {}; // sessionToken -> { code, claimed, userId, name, createdAt }

function pruneExpiredLinkSessions() {
    const now = Date.now();
    for (const token of Object.keys(youtubeLinkSessions)) {
        const session = youtubeLinkSessions[token];
        // Keep claimed sessions around indefinitely (they back the panel's ongoing identity,
        // same as a Twitch JWT would for as long as that tab stays open) - only prune ones that
        // never got claimed within the window, so a stale code can't be claimed later.
        if (!session.claimed && (now - session.createdAt) > LINK_CODE_TTL_MS) {
            delete youtubeLinkSessions[token];
        }
    }
}

// Called by the standalone panel on first load (or whenever it has no stored session yet) -
// no auth needed here, this just hands out a fresh code to display. Worst case if abused is a
// pile of harmless unclaimed codes - nothing sensitive is exposed by generating one.
app.post('/api/youtube-link/start', (req, res) => {
    pruneExpiredLinkSessions();

    const sessionToken = crypto.randomBytes(24).toString('hex');
    // Short, easy to type in a chat message under pressure - 4 digits is plenty since codes
    // are single-use and expire quickly. Re-rolled below if it collides with another still-
    // pending (unclaimed) code, so two viewers loading the panel around the same moment can
    // never end up with the same code live at once - whoever typed !link first would otherwise
    // risk claiming the wrong person's session.
    const pendingCodes = new Set(
        Object.values(youtubeLinkSessions).filter(s => !s.claimed).map(s => s.code)
    );
    let code = String(crypto.randomInt(1000, 10000));
    let rerolls = 0;
    while (pendingCodes.has(code) && rerolls < 20) {
        code = String(crypto.randomInt(1000, 10000));
        rerolls++;
    }

    youtubeLinkSessions[sessionToken] = {
        code,
        claimed: false,
        userId: null,
        name: null,
        createdAt: Date.now()
    };

    res.json({ sessionToken, code, expiresInSeconds: LINK_CODE_TTL_MS / 1000 });
});

// Called by Streamer.bot's new "Big Heist - YouTube Panel Link" action, bound to the
// "!link <code>" YouTube chat command - authenticated with the same push secret as every
// other Streamer.bot-only endpoint, since only Streamer.bot can vouch for a real YouTube
// chat identity.
app.post('/api/youtube-link/claim', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { code, youtubeUserId, youtubeUserName } = req.body;
    if (!code || !youtubeUserId) {
        return res.status(400).json({ error: 'code and youtubeUserId are required' });
    }

    pruneExpiredLinkSessions();

    const match = Object.values(youtubeLinkSessions).find(s => s.code === code && !s.claimed);
    if (!match) {
        return res.status(404).json({ error: 'No pending link request with that code (it may have expired - refresh the panel page for a new one)' });
    }

    match.claimed = true;
    match.userId = youtubeUserId;
    match.name = youtubeUserName || youtubeUserId;

    res.json({ success: true });
});

// Called by the standalone panel, polling every couple of seconds after it shows a code,
// until this comes back claimed - at which point the panel stores the sessionToken and
// starts using it for every subsequent request, same role a Twitch JWT plays.
app.get('/api/youtube-link/status', (req, res) => {
    res.set('Cache-Control', 'no-store');

    const sessionToken = req.query.sessionToken;
    const session = sessionToken ? youtubeLinkSessions[sessionToken] : null;

    if (!session) {
        return res.status(404).json({ error: 'Unknown or expired session - request a new code' });
    }

    if (!session.claimed) {
        return res.json({ claimed: false });
    }

    res.json({ claimed: true, userId: session.userId, name: session.name });
});

// ============================
// IDENTITY RESOLUTION - shared by /api/my-data and /api/queue-action. Twitch viewers prove
// identity via the signed JWT the Extension SDK hands them automatically. YouTube viewers
// (no Extension, no JWT) instead prove it via the link-code session token from the flow
// above. Either one resolves to a real userId that Streamer.bot also uses when pushing data,
// so downstream code never needs to care which path got it there.
// ============================
function resolveIdentity(req) {
    const ytSessionToken = req.headers['x-yt-session'];
    if (ytSessionToken) {
        const session = youtubeLinkSessions[ytSessionToken];
        if (!session || !session.claimed) {
            return { error: 'invalid_session', message: 'YouTube panel session not linked yet - type !link <code> in chat.' };
        }
        return { userId: session.userId };
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { error: 'missing_auth', message: 'Missing authorization token' };
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
        decoded = jwt.verify(token, Buffer.from(EXT_SECRET, 'base64'), { algorithms: ['HS256'] });
    } catch (err) {
        return { error: 'invalid_token', message: 'Invalid or expired token' };
    }

    // decoded.user_id is only present if the viewer has granted "share your Twitch user ID"
    // permission to the Extension - without it we only get an opaque, per-extension ID that
    // won't match the real Twitch userId Streamer.bot uses, so we have to ask for it explicitly.
    if (!decoded.user_id) {
        return { error: 'identity_not_shared', message: 'Please share your Twitch identity with this Extension to see your inventory.' };
    }

    return { userId: decoded.user_id };
}

// ============================
// MY DATA - called by the Extension frontend (Twitch JWT) or the standalone YouTube panel
// (link-code session token) - see resolveIdentity() above for how either path is verified.
// ============================
app.get('/api/my-data', (req, res) => {
    // This endpoint is per-viewer and personalized - caching it (whether by the browser,
    // Twitch's CDN, or any proxy in between) would serve one viewer's data to another,
    // or stale data after an update. Always disallow caching here.
    res.set('Cache-Control', 'no-store');

    const identity = resolveIdentity(req);
    if (identity.error) {
        const status = identity.error === 'identity_not_shared' || identity.error === 'invalid_session' ? 403 : 401;
        return res.status(status).json({ error: identity.error, message: identity.message });
    }

    const perpData = store[identity.userId];

    if (!perpData) {
        return res.json({
            found: false,
            message: "No perp data found yet - have you run !becomeperp on stream?"
        });
    }

    res.json({
        found: true,
        userId: identity.userId,
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
        bagmanResultNotice: perpData.bagmanResultNotice || null,
        heistRunning: !!perpData.heistRunning,
        shopBannedUntil: perpData.shopBannedUntil || 0,
        offendedBannedUntil: perpData.offendedBannedUntil || 0,
        personalHeat: perpData.personalHeat || 0,
        showHeat: perpData.showHeat || 0,
        isLayingLow: perpData.isLayingLow || false,
        robberyAttemptsRemaining: typeof perpData.robberyAttemptsRemaining === 'number' ? perpData.robberyAttemptsRemaining : 999,
        bigHeist: perpData.bigHeist || null,
        pendingItemMove: perpData.pendingItemMove || null,
        pendingBagmanChoice: perpData.pendingBagmanChoice || null,
        heatReducingItems: perpData.heatReducingItems || {},
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

// Called by the PANEL (authenticated the same way as /api/my-data - Twitch JWT or YouTube
// link-code session, so nobody can queue an action pretending to be someone else). Now stamps
// the queued action with the caller's resolved platform, so Process Panel Actions can dispatch
// it against the right game logic instead of assuming Twitch.
app.post('/api/queue-action', (req, res) => {
    const identity = resolveIdentity(req);
    if (identity.error) {
        const status = identity.error === 'identity_not_shared' || identity.error === 'invalid_session' ? 403 : 401;
        return res.status(status).json({ error: identity.error, message: identity.message });
    }

    const { type, payload } = req.body;
    if (!type) {
        return res.status(400).json({ error: 'type is required' });
    }

    pendingActions.push({
        id: nextActionId++,
        userId: identity.userId,
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
