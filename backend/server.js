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
// to keep Render's free tier from sleeping. The panel itself now hits this on a timer
// whenever it considers the show "live" (see computeEffectiveLive() below) - see the
// STREAM LIVE STATUS section just below for how "live" is decided.
// ============================
app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', perpsStored: Object.keys(store).length });
});

// ============================
// STREAM LIVE STATUS - lets the panel show a "next show" advert screen (with a countdown)
// instead of the normal character sheet whenever the show's off-air, and switch back to normal
// automatically the moment it's live. Two independent inputs combine into one effective value:
//   - rawLive: set automatically by Streamer.bot - true the instant Stream Online fires, false
//     the instant Stream Offline fires, and re-asserted true every ~1-2 min by Big Heist - Track
//     Present Viewers while actually live (that action already only fires during a live stream,
//     so piggybacking on it here means this self-heals within a couple minutes even if this
//     backend restarts mid-show and loses its in-memory state).
//   - overrideMode: 'auto' (default) trusts rawLive; 'on'/'off' force it either way regardless
//     of rawLive, set via a moderator-only "!panellive on/off/auto" chat command in Streamer.bot
//     (permission enforced by Streamer.bot's own trigger settings, not by this backend).
// Both are pushed here the same way /api/push-data already works - a shared secret, not a viewer
// identity, since only Streamer.bot (running on the streamer's own PC) ever calls this.
// ============================
let streamStatus = { rawLive: false, overrideMode: 'auto' }; // overrideMode: 'auto' | 'on' | 'off'

function computeEffectiveLive() {
    if (streamStatus.overrideMode === 'on') return true;
    if (streamStatus.overrideMode === 'off') return false;
    return !!streamStatus.rawLive;
}

app.post('/api/push-stream-status', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }
    const { rawLive, overrideMode } = req.body;
    if (typeof rawLive === 'boolean') streamStatus.rawLive = rawLive;
    if (overrideMode === 'auto' || overrideMode === 'on' || overrideMode === 'off') streamStatus.overrideMode = overrideMode;
    res.json({ ok: true, effectiveLive: computeEffectiveLive(), streamStatus });
});

// Not currently polled by the panel (my-data already carries `live` on every response - see
// below), but kept as a standalone endpoint since it's a cheap, obvious thing to check by hand
// (e.g. curl) while setting the Stream Online/Offline/override actions up in Streamer.bot.
app.get('/api/stream-status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ live: computeEffectiveLive(), overrideMode: streamStatus.overrideMode });
});

// ============================
// BIG HEIST VOTE - the pre-show "pick 4 heists, vote for 2 minutes" round. This is GLOBAL state
// (one vote round for the whole show, not per-viewer), so it's pushed/read the same way
// streamStatus is above - a dedicated object, not folded into the per-user store, and included on
// every /api/my-data response regardless of found/not-found so even a brand new viewer sees the
// vote in progress. Streamer.bot owns the source of truth (ActiveHeistVote global var) and pushes
// its full current snapshot here every time it changes (round start, each vote, and the final
// tally) - simplest to reason about than incremental patches, and the payload is tiny (4
// candidates + a handful of votes).
// ============================
let heistVote = {
    active: false,
    candidates: [],       // [{ heistKey, heistName, description, minCrew, maxCrew, items, amountOnOffer }]
    votingEndsAt: null,   // Unix seconds
    votes: {},             // userId -> heistKey
    resolvedWinnerKey: null,
    resolvedAt: null
};

app.post('/api/push-heist-vote', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }
    const { active, candidates, votingEndsAt, votes, resolvedWinnerKey, resolvedAt } = req.body;
    heistVote = {
        active: !!active,
        candidates: Array.isArray(candidates) ? candidates : [],
        votingEndsAt: votingEndsAt || null,
        votes: votes && typeof votes === 'object' ? votes : {},
        resolvedWinnerKey: resolvedWinnerKey || null,
        resolvedAt: resolvedAt || null
    };
    res.json({ ok: true, heistVote });
});

// ============================
// BLOCK WAR - two chat-formed teams (Wagner Block vs Ezquerra Block) vote Attack/Defend, then
// Streamer.bot resolves the fight in rounds. Same GLOBAL-state pattern as heistVote above (one
// war for the whole show, not per-viewer) - Streamer.bot owns the source of truth
// (BlockWarState global var) and pushes its full current snapshot here on every change (team
// assignment, each vote, each combat round, and the final result).
// ============================
let blockWar = {
    active: false,
    phase: 'idle',          // 'voting' | 'combat' | 'ended'
    teams: {},               // { Wagner: [userId, ...], Ezquerra: [userId, ...] }
    names: {},                // userId -> display name
    votes: {},                // userId -> 'attack' | 'defense'
    attackScore: {},           // { Wagner: number, Ezquerra: number }
    defenseScore: {},           // { Wagner: number, Ezquerra: number }
    votingEndsAt: null,          // Unix seconds
    round: 0,
    winner: null                // 'Wagner' | 'Ezquerra' | 'brokenup' | null
};

app.post('/api/push-block-war', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }
    const { active, phase, teams, names, votes, attackScore, defenseScore, votingEndsAt, round, winner } = req.body;
    blockWar = {
        active: !!active,
        phase: phase || 'idle',
        teams: (teams && typeof teams === 'object') ? teams : {},
        names: (names && typeof names === 'object') ? names : {},
        votes: (votes && typeof votes === 'object') ? votes : {},
        attackScore: (attackScore && typeof attackScore === 'object') ? attackScore : {},
        defenseScore: (defenseScore && typeof defenseScore === 'object') ? defenseScore : {},
        votingEndsAt: votingEndsAt || null,
        round: typeof round === 'number' ? round : 0,
        winner: winner || null
    };
    res.json({ ok: true, blockWar });
});

// ============================
// SNITCH LINE - the whole-audience "dob a crew member in" mechanism for the Wally Squad
// social-deduction game. Same GLOBAL-state pattern as heistVote/blockWar above (one shared tally,
// not per-viewer). Unlike the retired Investigate Vote (single 120s window, majority wins), this
// is open for the WHOLE heist once Wally Squad is assigned - each viewer gets ONE accusation ever
// for that heist, and the moment any one target's accusation count hits 5, Streamer.bot resolves
// it immediately (see Big Heist - Wally Squad - Snitch Line - Cast) - there's no separate polling
// Tick and no fixed close time here. resolvedTargets only ever records WHO the crowd's calls
// landed on and whether that call was correct - who Wally Squad actually is never sits in this
// payload while they're still uncaught.
// ============================
let snitchLine = {
    active: false,
    candidates: [],   // [{ userId, userName }, ...] - live heist crew, refreshed on every vote
    votes: {},           // voterUserId -> accusedUserId (one per voter, locked in for the heist)
    resolvedTargets: {}    // accusedUserId -> "caught" | "innocent", once they hit 5 accusations
};

app.post('/api/push-snitch-line', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }
    const { active, candidates, votes, resolvedTargets } = req.body;
    snitchLine = {
        active: !!active,
        candidates: Array.isArray(candidates) ? candidates : [],
        votes: (votes && typeof votes === 'object') ? votes : {},
        resolvedTargets: (resolvedTargets && typeof resolvedTargets === 'object') ? resolvedTargets : {}
    };
    res.json({ ok: true, snitchLine });
});

// ============================
// FEATURE FLAGS - lets the streamer hold a panel feature back after it's already been coded and
// deployed, then reveal it on stream whenever they're actually ready, instead of it just
// appearing for every viewer the moment new panel code goes live. Same GLOBAL-state pattern as
// blockWar/heistVote above (one shared set of flags, not per-viewer). Toggled from Streamer.bot
// via "Big Heist - Toggle Feature" (one Stream Deck button per feature, each bound with its own
// preset "feature" argument) - that action reads the CURRENT flags from the GET endpoint below
// before flipping, so it can never drift out of sync with what's actually live here.
//
// Defaults reflect what's already been live for a while (itemGlossary, robbery, pickpocket,
// bigHeist, juansEmporium - all default ON, preserving existing behavior) vs what's brand new
// (achievements - defaults OFF until deliberately turned on). A missing/unknown key defaults to
// OFF everywhere it's checked, both here and on the panel side, so a future feature added without
// updating this default object still starts hidden rather than accidentally-on. Toggle any of
// these off (e.g. at the start of a fresh season) to hold that crime/feature back until you're
// ready to introduce it on stream, same mechanism either way.
// ============================
let featureFlags = {
    itemGlossary: true,
    achievements: false,
    robbery: true,
    pickpocket: true,
    bigHeist: true,
    juansEmporium: true,
    graffiti: true,
    trade: true,
    layLow: true,
    // Wally Squad (the Big Heist informant/social-deduction game) - defaults OFF, per the
    // streamer's request, until there's a big enough crowd watching to make it worth running.
    // Toggle via Big Heist - Toggle Feature same as every other flag here.
    wallySquad: false,
    // The Judge M.A.C. Search box on the Judge Home Screen - defaults ON since it's already live
    // and working. Added 2026-08-18 per the user's ask to gate it with "the usual switch
    // function" - toggle via Big Heist - Toggle Feature same as every other flag here.
    macSearch: true
};

app.post('/api/push-feature-flags', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }
    const { flags } = req.body;
    if (flags && typeof flags === 'object') {
        featureFlags = Object.assign({}, featureFlags, flags);
    }
    res.json({ success: true, featureFlags });
});

app.get('/api/feature-flags', (req, res) => {
    // Public, no auth needed - same "display-only reference data" trust level as item-catalog.
    // Also read by Big Heist - Toggle Feature itself, to fetch the current live value right
    // before flipping it (rather than trusting a possibly-stale local copy).
    res.set('Cache-Control', 'no-store');
    res.json({ featureFlags });
});

// ============================
// PUSH DATA - called by Streamer.bot whenever a perp's inventory or skills change
// ============================
app.post('/api/push-data', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { userId, name, points, kudos, inventory, skills, lastCrime, crimeStatus, cubeReleaseAt, achievements, pendingMugshotPick, candidateHashes, mugshotVersion, mugshotHash, panelOverride, pickpocketedTargets, isTestAccount, pickpocketNotice, shopBannedUntil, offendedBannedUntil, personalHeat, showHeat, isLayingLow, heatReducingItems, robberyAttemptsRemaining, bigHeist, pendingItemMove, pendingBagmanChoice, bagmanResultNotice, mugshotPickError, heistRunning, assignedJudgeName, judgeIsPlaying, isWatchingJudge, assignedPerpName, perpIsPlaying } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    store[userId] = {
        name: name || userId,
        points: points || 0,
        // Reputation earned from Robbery/Big Heist/Graffiti - see Big Heist - Sync To Extension
        // for where this is read from the player's persisted var and pushed here. This field was
        // missing from both the push-data destructure above and the my-data response below when
        // the Kudos feature was first built, which is why it always showed 0 on the panel
        // regardless of what Streamer.bot actually had recorded server-side.
        kudos: kudos || 0,
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
        mugshotPickError: mugshotPickError || null,
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
        // Dedicated Judge Home Screen fields - assignedJudgeName is null unless the streamer has
        // linked this account to a Judge character (Big Heist - Assign Judge flow); judgeIsPlaying
        // is only ever true when that character's OBS source is currently visible, computed fresh
        // by Sync To Extension on every push.
        assignedJudgeName: assignedJudgeName || null,
        judgeIsPlaying: !!judgeIsPlaying,
        // True for a registered Judges-group member who ISN'T the one currently playing - still
        // gets the Judge-styled panel, just not a specific character's portrait.
        isWatchingJudge: !!isWatchingJudge,
        // Same idea, for the criminal side of the RPG (Quin, Flink).
        assignedPerpName: assignedPerpName || null,
        perpIsPlaying: !!perpIsPlaying,
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
    // 6 digits (bumped from 4, 2026-07-31) - still short enough to type in a chat message under
    // pressure, but a million-code space instead of ten thousand makes a leaked/visible code far
    // harder for anyone else to blind-guess within the TTL window. Re-rolled below if it collides
    // with another still-pending (unclaimed) code, so two viewers loading the panel around the
    // same moment can never end up with the same code live at once - whoever typed !link first
    // would otherwise risk claiming the wrong person's session.
    const pendingCodes = new Set(
        Object.values(youtubeLinkSessions).filter(s => !s.claimed).map(s => s.code)
    );
    let code = String(crypto.randomInt(100000, 1000000));
    let rerolls = 0;
    while (pendingCodes.has(code) && rerolls < 20) {
        code = String(crypto.randomInt(100000, 1000000));
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
    // Included on EVERY /api/my-data response (found or not) - the panel checks this before
    // anything else and shows the Sector 21 advert/countdown screen whenever it's false,
    // regardless of found/not-found. See computeEffectiveLive() above.
    const live = computeEffectiveLive();

    if (!perpData) {
        return res.json({
            found: false,
            live: live,
            heistVote: heistVote,
            blockWar: blockWar,
            featureFlags: featureFlags,
            snitchLine: snitchLine,
            // Added so full-panel global-state takeovers (anything that needs to key off "am I
            // already accounted for") work for a viewer who hasn't run !becomeperp yet -
            // resolveIdentity() above already resolves a real userId regardless of found/not-found,
            // this just wasn't being surfaced in this branch before.
            userId: identity.userId,
            message: "No perp data found yet - have you run !becomeperp on stream?"
        });
    }

    res.json({
        found: true,
        live: live,
        heistVote: heistVote,
        blockWar: blockWar,
        featureFlags: featureFlags,
        snitchLine: snitchLine,
        userId: identity.userId,
        name: perpData.name,
        points: perpData.points || 0,
        kudos: perpData.kudos || 0,
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
        mugshotPickError: perpData.mugshotPickError || null,
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
        assignedJudgeName: perpData.assignedJudgeName || null,
        judgeIsPlaying: !!perpData.judgeIsPlaying,
        isWatchingJudge: !!perpData.isWatchingJudge,
        assignedPerpName: perpData.assignedPerpName || null,
        perpIsPlaying: !!perpData.perpIsPlaying,
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

// ============================
// ITEM CATALOG - pushed by Big Heist - Push Item Catalog (called at the end of Big Heist - Item
// Catalog Loader), so the panel's Item Glossary button can fetch the whole item database once,
// cache it client-side, and render it as a searchable list with pictures, descriptions, and
// where-to-find info - covers !iteminfo / !itemcatalog / !itemsearch without needing chat typing.
// Same trusted-push pattern as shop listing above - display only, never used for transactions.
// ============================
let itemCatalog = {};

app.post('/api/item-catalog', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { catalog } = req.body;
    itemCatalog = (catalog && typeof catalog === 'object') ? catalog : {};

    res.json({ success: true });
});

app.get('/api/item-catalog', (req, res) => {
    // Public, no auth needed - this is a static reference catalog, not per-viewer data.
    res.set('Cache-Control', 'no-store');
    res.json({ catalog: itemCatalog });
});

// ============================
// CURRENT BLOCK - pushed by Big Heist - Push Current Block, itself called from the end of
// Big Heist - Item Catalog Loader (startup) and now also from PLACE Setup (whenever a Streamdeck
// button moves the team to a new Block). Tells the panel which robbery categories actually exist
// in the current Block, so it can hide the ones that don't - "PLACE Setup" is the ONLY thing that
// actually decides the current Block (there's no auto/random selection), so this always reflects
// exactly what's on screen in the Investigation/Battlemap OBS scenes.
// ============================
let currentBlockData = { block: null, locations: {}, difficultyMultiplier: 1.0 };

app.post('/api/current-block', (req, res) => {
    const providedSecret = req.headers['x-push-secret'];
    if (providedSecret !== PUSH_SECRET) {
        return res.status(401).json({ error: 'Invalid push secret' });
    }

    const { block, locations, difficultyMultiplier } = req.body;
    currentBlockData = {
        block: typeof block === 'string' ? block : null,
        locations: (locations && typeof locations === 'object') ? locations : {},
        difficultyMultiplier: typeof difficultyMultiplier === 'number' ? difficultyMultiplier : 1.0
    };

    res.json({ success: true });
});

app.get('/api/current-block', (req, res) => {
    // Public, no auth needed - which Block is currently active isn't sensitive per-viewer data.
    res.set('Cache-Control', 'no-store');
    res.json(currentBlockData);
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
