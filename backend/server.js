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

    const { userId, name, points, inventory, skills, lastCrime, crimeStatus, cubeReleaseAt, achievements, pendingMugshotPick, candidateHashes, mugshotVersion, mugshotHash } = req.body;

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
        updatedAt: perpData.updatedAt
    });
});

app.listen(PORT, () => {
    console.log('Big Heist Extension backend running on port ' + PORT);
});
