// VERSION MARKER - if you open the browser console (F12) and DON'T see this exact line, the
    // panel being served is NOT this build - meaning Twitch's Asset Hosting is still serving an
    // older cached version regardless of re-uploading. This is the simplest way to check that,
    // much easier than digging through the Network tab.
    console.log("BIG HEIST PANEL BUILD: 2026-07-24-youtube-link-flow");

    const BACKEND_URL = "https://big-heist-backend.onrender.com";
    // Mugshots are hosted on GitHub Pages (NOT raw.githubusercontent.com - that gets rate-limited).
    // Format: https://YOUR-USERNAME.github.io/YOUR-REPO/mugshots/{userId}.png
    const MUGSHOT_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/mugshots";
    // Item gallery images live in a separate folder on the same GitHub Pages site - unlike
    // mugshots, these are static once uploaded (no repeated per-user overwrites), so they don't
    // need the retry/hash-verification machinery built for mugshots - a plain <img src> is fine,
    // and deliberately has NO cache-busting query string, since these rarely change and letting
    // the browser cache them normally is actually what we want here.
    const ITEMS_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/items";
    // Getaway escape art (the dramatic finale-style scene per vehicle) lives in its own folder on
    // the same GitHub Pages site, keyed by the vehicle's catalog key EXACTLY as getawayVehicleName
    // carries it (Sync To Extension sets that field to the committed vehicle's baseItemName, e.g.
    // "GetawayCar" -> getaways/GetawayCar.png). Kept separate from items/ because this is bespoke
    // action art, not the static catalog product shot. Like items/, it's remote (NOT bundled in
    // panel.zip), so new/updated getaway art never needs a full panel.zip re-upload. No cache-bust
    // query string, same reasoning as items/.
    const GETAWAY_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/getaways";

    let authToken = null;
    // Set only for the standalone (non-Twitch-Extension) build, once the viewer has typed
    // !link <code> in YouTube chat and Big Heist - YouTube Panel Link has confirmed the claim to
    // the backend. Stands in for authToken everywhere a request needs to prove identity - see
    // getAuthHeaders(). The two are mutually exclusive: a given page load either runs inside the
    // Twitch Extension iframe (authToken) or as the standalone YouTube panel (sessionToken),
    // never both. Persisted to localStorage so a YouTube viewer doesn't have to re-type !link
    // every time they reload the panel tab - this is our own production panel code (not a
    // Claude-generated artifact), so localStorage is fine to use here.
    let sessionToken = null;
    const YT_SESSION_STORAGE_KEY = "bigHeistYtSessionToken";
    let currentUserId = null;
    // Last successfully fetched data, kept around so the Pickpocket picker can re-render
    // instantly on a button click (show/hide the picker, filter the list) without waiting for a
    // fresh network fetch - this whole picker is a client-side-only UI state, not a
    // server-persisted panelOverride, since it's just a quick pick-and-go interaction.
    let lastFetchedData = null;
    let showPickpocketPicker = false;
    let showShopBrowser = false;
    // NEW - true from the moment the shop button is clicked until either the server's heat roll
    // comes back clean (mode "shopReady") or fails (mode "heatDenied"). Per user report: opening
    // the shop instantly and only rejecting a few seconds later ("shop flashes open, then Juan
    // turns you away") read as confusing/broken rather than cinematic - the check now gates entry
    // instead of racing it. See the shop button's click handler and the panelOverride
    // pre-processing block below for how this gets resolved.
    let shopEntryPending = false;
    // Sell view - same pattern as showShopBrowser (pure client-side toggle, no queued action
    // just to browse). Unlike the shop's shopListing, the player's own inventory is already part
    // of every normal poll response, so there's no separate passive-data source needed here.
    let showSellBrowser = false;
    // Lay Low view - same pattern as showSellBrowser (client-side toggle over the player's own
    // inventory, filtered server-side down to just heatReducingItems).
    let showLayLowBrowser = false;
    let showRobberyPicker = false;
    let showBigHeistView = false;
    // Tracks which tasks have a join in flight, keyed by taskKey - survives re-renders (unlike
    // just disabling the clicked button, which gets wiped out if a poll re-renders the task list
    // with fresh HTML before the real confirmation arrives, creating a brand new enabled button
    // and letting a second click slip through as a genuine duplicate join). Cleared once the
    // task's own state actually changes (you're on it, or it's full) or after a timeout safety net.
    let pendingJoinTasks = {};
    // Same reasoning as pendingJoinTasks - once the bagman clicks Honour or Doublecross, a stale
    // poll landing before the server has actually processed and resynced would otherwise revert
    // the acknowledgment screen back to the original buttons, which would be a genuinely
    // confusing thing to see happen to an irrevocable choice.
    let bagmanChoiceMade = null;
    // The bagman result notice has its own server-side expiresAt, but that only gets re-checked
    // the next time Sync To Extension happens to run for this account - which might not happen
    // again for a while, leaving the panel stuck showing "the dust settles" indefinitely. This
    // tracks which notice (by its message text) we've already started a client-side dismiss timer
    // for, so the same notice doesn't get a fresh 20-second timer on every single poll.
    let bagmanNoticeDismissTimerFor = null;
    let bagmanNoticeDismissed = false;
    // Panel-driven replacement for the old !finditem/!haggle chat commands - a text search field,
    // then the quote/haggle conversation (reusing the existing findersFee panelOverride, since
    // the server-side quote logic is unchanged), then back to normal automatically either way.
    let showFinderPage = false;
    // Transient interstitial shown right after clicking an item to buy - we already know the
    // item name and price client-side the instant they click (no need to wait on server
    // confirmation just to show this), and it closes the perceived-delay gap while the real
    // purchase resolves a few seconds later via the queue.
    let purchaseConfirmationMessage = null;
    // Shown instead of purchaseConfirmationMessage when queueAction itself fails - i.e. the
    // buyItem action never actually reached the backend queue, so nothing will happen no matter
    // how long we wait. Distinct from purchaseConfirmationMessage so we never accidentally claim
    // success for a purchase that never got queued in the first place.
    let queueFailureMessage = null;
    // Same optimistic-interstitial pattern as purchaseConfirmationMessage, kept as its own
    // variable rather than reused, so a sell and a buy landing in quick succession can never
    // show the wrong flavor text for the wrong transaction.
    let sellConfirmationMessage = null;
    // Same pattern again for Lay Low - its own variable so it can never collide with a buy/sell
    // confirmation landing at the same moment.
    let layLowConfirmationMessage = null;

    // Twitch Extensions can't run on YouTube at all - the standalone build (panel-standalone.html,
    // same panel.js) is served without the twitch-ext.min.js helper script, so `Twitch` simply
    // doesn't exist there. That absence is the signal to use the YouTube link-code flow instead of
    // waiting on an onAuthorized callback that will never fire.
    if (typeof Twitch !== "undefined" && Twitch.ext && typeof Twitch.ext.onAuthorized === "function") {
        Twitch.ext.onAuthorized(function (auth) {
            authToken = auth.token;
            // Note: auth.userId is an OPAQUE id (prefixed U/A), not the real Twitch userId -
            // the real one only comes back from the backend, which decodes it from the JWT securely
            fetchMyData();
        });
    } else {
        bootstrapYoutubePanel();
    }

    // Gets a fresh short code from the backend and shows it, then polls until the viewer has
    // typed !link <code> in YouTube chat (handled server-side by Big Heist - YouTube Panel Link).
    // Called both on first load with no stored session, and again whenever a stored session turns
    // out to be invalid/expired (see fetchMyData's invalid_session handling below).
    function startYoutubeLinkFlow() {
        fetch(BACKEND_URL + "/api/youtube-link/start", { method: "POST" })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                document.getElementById("content").innerHTML =
                    '<div id="status-message">' +
                    'To link your account, type this in YouTube chat:<br><br>' +
                    '<span style="font-size:22px; font-weight:700; letter-spacing:2px;">!link ' + data.code + '</span>' +
                    '<br><br>Waiting for you to type it...</div>';
                pollYoutubeLinkStatus(data.sessionToken);
            })
            .catch(function (err) {
                console.error("startYoutubeLinkFlow failed:", err);
                document.getElementById("content").innerHTML =
                    '<div id="status-message">Could not reach the server - try reloading.</div>';
            });
    }

    function pollYoutubeLinkStatus(pendingSessionToken) {
        const poll = setInterval(function () {
            fetch(BACKEND_URL + "/api/youtube-link/status?sessionToken=" + encodeURIComponent(pendingSessionToken))
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    if (data.claimed) {
                        clearInterval(poll);
                        sessionToken = pendingSessionToken;
                        try { localStorage.setItem(YT_SESSION_STORAGE_KEY, sessionToken); } catch (e) { /* storage unavailable - session still works for this tab */ }
                        fetchMyData();
                    }
                })
                .catch(function (err) {
                    // A transient network blip here just means we try again next tick - no need
                    // to interrupt the "waiting for you to type it" message over it.
                    console.error("pollYoutubeLinkStatus failed:", err);
                });
        }, 3000);
    }

    // Every request that needs to prove identity uses one of these two headers, whichever
    // credential this build actually has - see the sessionToken/authToken comments above.
    function getAuthHeaders() {
        return sessionToken ? { "X-YT-Session": sessionToken } : { "Authorization": "Bearer " + authToken };
    }

    // Entry point for the standalone build. Tries a previously-linked session first (saves a
    // YouTube viewer from re-linking on every reload); only falls through to the !link <code>
    // prompt if there's no stored session at all. fetchMyData handles the case where a stored
    // session turns out to be stale/expired by calling startYoutubeLinkFlow() itself.
    function bootstrapYoutubePanel() {
        let storedSessionToken = null;
        try { storedSessionToken = localStorage.getItem(YT_SESSION_STORAGE_KEY); } catch (e) { /* storage unavailable */ }
        if (storedSessionToken) {
            sessionToken = storedSessionToken;
            fetchMyData();
        } else {
            startYoutubeLinkFlow();
        }
    }

    let pollTickCount = 0;
    setInterval(function () {
        if (!authToken && !sessionToken) return;
        pollTickCount++;
        // Adaptive cadence: every tick (3s) while a Big Heist is active, since things like the
        // bagman's 30-second Honour/Doublecross window are genuinely time-critical and a fixed
        // 15s baseline risks missing them outright. Falls back to a 15s-equivalent cadence
        // (every 5th tick) the rest of the time, to avoid needless load when nothing urgent is
        // happening.
        const heistActive = lastFetchedData && lastFetchedData.bigHeist;
        if (heistActive || pollTickCount % 5 === 0) fetchMyData();
    }, 3000);

    // Browsers throttle setInterval timers in backgrounded tabs (sometimes stretching a 15s
    // timer out to close to a minute) - this forces an immediate fetch the moment the tab
    // regains focus, so switching back to check the panel after looking away doesn't leave it
    // waiting on a throttled timer that may not fire again for a while.
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible" && (authToken || sessionToken)) fetchMyData();
    });

    // Queues a real action for Streamer.bot's "Process Panel Actions" Timer-triggered poller to
    // pick up (every few seconds) and actually execute - lets clicking something in the panel
    // trigger a genuine Streamer.bot action without the player typing a chat command. There's a
    // short delay (however often that Timer is set to run) before it actually takes effect.
    // Returns a Promise<boolean> - true only if the queue POST actually reached the backend and
    // got a 2xx back. Callers that show an optimistic "this worked!" message (purchase
    // confirmation, etc) MUST gate on this rather than assuming the queue always succeeds - a
    // real bug this fixed: the backend can fail this request (Render free-tier cold start,
    // network blip, stale auth token) and the button would previously still claim success, even
    // though nothing ever reached Process Panel Actions' queue for Streamer.bot to pick up.
    function queueAction(type, payload) {
        return fetch(BACKEND_URL + "/api/queue-action", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, getAuthHeaders()),
            body: JSON.stringify({ type: type, payload: payload || {} })
        }).then(function (res) {
            if (!res.ok) throw new Error("queue-action responded " + res.status);

            // The Streamer.bot Timer that actually processes this only checks its own queue
            // every few seconds (whatever it's set to), so some delay is inherent no matter
            // what - but without this, the PANEL would then also wait for its next full 15s
            // poll on top of that, before ever noticing anything changed. Polling faster for a
            // short window after a click cuts that second wait down substantially, without
            // changing the normal 15s baseline rate the rest of the time. Only starts once we
            // know the action was actually accepted - no point fast-polling for a change that
            // was never queued in the first place.
            let fastPollCount = 0;
            const fastPollInterval = setInterval(function () {
                fastPollCount++;
                if (authToken || sessionToken) fetchMyData();
                if (fastPollCount >= 8) clearInterval(fastPollInterval); // ~16s, then let the normal cycle take back over
            }, 2000);

            return true;
        }).catch(function (err) {
            console.error("queueAction failed:", type, err);
            return false;
        });
    }

    // Guards against a real race: if an EARLIER poll happens to take longer to resolve than a
    // LATER one (network jitter, Render taking a moment longer on one request), its response can
    // arrive after the newer one and silently overwrite fresh, correct state with stale data -
    // exactly what caused "the panel updated, then flipped back to the old state" after joining a
    // task. Every response is tagged with an incrementing id at request time; a response only
    // ever gets applied if its id is newer than whatever was last actually applied, regardless of
    // how many requests have been sent in between.
    let fetchRequestCounter = 0;
    let latestAppliedResponseId = 0;

    function fetchMyData() {
        const thisRequestId = ++fetchRequestCounter;
        fetch(BACKEND_URL + "/api/my-data", {
            headers: getAuthHeaders()
        })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (result) {
            if (thisRequestId <= latestAppliedResponseId) return; // a newer response already landed, this one's stale
            latestAppliedResponseId = thisRequestId;

            if (result.status === 403 && result.data.error === "identity_not_shared") {
                showShareIdentityPrompt();
                return;
            }
            if (result.status === 403 && result.data.error === "invalid_session") {
                // The stored YouTube session was rejected (expired, or the backend restarted and
                // lost its in-memory session table) - clear it and start a fresh !link <code>
                // prompt rather than getting stuck showing a stale error forever.
                sessionToken = null;
                try { localStorage.removeItem(YT_SESSION_STORAGE_KEY); } catch (e) { /* storage unavailable */ }
                startYoutubeLinkFlow();
                return;
            }
            if (result.status === 401) {
                document.getElementById("content").innerHTML =
                    '<div id="status-message">Could not verify your identity - try reloading.</div>';
                return;
            }
            if (!result.data.found) {
                document.getElementById("content").innerHTML =
                    '<div id="status-message">' + result.data.message + '</div>';
                return;
            }
            currentUserId = result.data.userId;
            lastFetchedData = result.data;
            renderPerpSheet(result.data);
        })
        .catch(function (err) {
            // Logged permanently (not just as temporary debugging) - this message alone doesn't
            // distinguish "genuinely can't reach the network" from "a client-side JS bug threw
            // partway through rendering," which cost real time to diagnose once already.
            console.error("fetchMyData failed:", err);
            document.getElementById("content").innerHTML =
                '<div id="status-message">Could not reach the server - try again shortly.</div>';
        });
    }

    function showShareIdentityPrompt() {
        document.getElementById("content").innerHTML =
            '<div id="status-message">Share your Twitch identity to see your file.</div>' +
            '<div style="text-align:center; margin-top:8px;"><button id="share-btn">Share My Identity</button></div>';
        document.getElementById("share-btn").addEventListener("click", function () {
            Twitch.ext.actions.requestIdShare();
        });
    }

    let lastKnownTopRowMode = null; // "pending" | "jailed" | "normal"
    // Robbery's staged cinematic reveal - captured ONCE when a fresh robberyResult override
    // arrives (fingerprinted by its expiresAt, which is always freshly generated server-side per
    // attempt), then played back locally via chained timers against that FIXED captured copy -
    // never re-reading data.panelOverride mid-sequence, so a later poll landing mid-animation
    // can't shift the data out from under an already-running reveal.
    let robberyCinematicKey = null;
    let robberyCinematicStage = 0;
    let robberyCinematicData = null;
    // Set on "Back" - hides the cinematic display immediately without touching
    // robberyCinematicKey. Clearing the key itself was the real bug: if the server hasn't
    // actually processed clearOverride yet (takes a few seconds), the NEXT poll still returns
    // the SAME old override - and with the key wiped, that looked like a brand new result,
    // replaying the whole cinematic again even though nothing was actually re-rolled server-side.
    let robberyResultDismissed = false;
    // Shown the INSTANT a job is picked, before the real robberyResult override has actually
    // arrived (that takes a few seconds via Process Panel Actions' own timer) - without this,
    // the panel would flash back to the normal character sheet in the gap, which is exactly the
    // "goes back to the sheet, then teleports to the cinematic" hiccup that was reported.
    let robberyPending = false;
    let robberyPendingCategory = null;
    // Same freeze-on-transition idea as lastKnownTopRowMode above, but for the bottom content
    // area specifically for the two modes that contain a real text input (findersFee's haggle
    // offer field, the Finder page's search field) - without this, the normal 15s poll (or the
    // 2s fast-poll burst after any queueAction) fully rebuilds rest-of-content's innerHTML every
    // time, which destroys and recreates the <input> element, wiping out whatever the player had
    // typed and stealing focus, at what looks like random intervals from their perspective.
    let lastKnownContentKey = null;
    // Ground-truth hashes for the current pending phase's 3 candidates, from Sync To Extension -
    // set once per transition into pending, read by loadCandidateImage to verify a fetched image
    // is genuinely correct rather than trusting a bare 200 OK.
    let currentCandidateHashes = [];
    // Ground-truth hash for the current final mugshot, from Sync To Extension - set once per
    // transition into "not pending", read by loadFinalMugshotImage to verify a fetched image is
    // genuinely correct rather than trusting a bare 200 OK.
    let currentMugshotHash = "";
    // Tracks the running 1-second countdown ticker so it can be cleared before a new one starts -
    // renderPerpSheet gets called every 15s from the normal poll, so without this a new interval
    // would stack on top of the old one each time, ticking faster and faster.
    let countdownIntervalId = null;

    // Twitch usernames vary a lot in length, and the stenciled name box is a fixed size (it has
    // to stay within the artwork's blue door panel) - with text-align:center + overflow:hidden,
    // a name too long for the box gets silently clipped from BOTH ends (no ellipsis, since
    // ellipsis doesn't reliably work with centered text), which is what was happening with
    // longer names. Scaling the font down for longer names avoids that instead of just hoping
    // names stay short.
    function isoCubeNameFontSize(name) {
        const len = (name || "").length;
        if (len <= 8) return 13;
        if (len <= 12) return 10;
        if (len <= 16) return 10;
        return 6;
    }

    // Shared by both ways of viewing the shop: the chat-triggered !shop command (server
    // panelOverride, data.panelOverride.items) and the panel's own "Visit Juan's Emporium"
    // button (instant client-side toggle, data.shopListing - pushed passively by Rotation
    // Script since it's static data that only changes on a restock). Both need the identical
    // item list + Juan's quote, just with a different Back/Cancel button id and closing note.
    // Always fully interactive - Purchase Script/Sell Item/Finders Fee all re-check the heat/
    // haggle ban directly at the moment of the actual transaction now, so there's no window
    // where a click could slip through before a rejection lands, and no need to freeze anything
    // client-side while a background check is in flight.
    function buildShopHtml(shopItems, backButtonId, closingNote) {
        let out = '<div class="section-title">Juan\'s Emporium</div>';
        if (shopItems.length === 0) {
            out += '<div class="items-text">Juan\'s shelves are bare right now.</div>';
        } else {
            out += '<div class="shop-list">';
            shopItems.forEach(function (item, i) {
                const qtyLabel = (item.quantity && item.quantity > 1) ? (' x' + item.quantity) : '';
                out += '<button class="shop-row shop-row-clickable" id="shop-buy-' + i + '" data-item="' + escapeHtml(item.name) + '"><span class="shop-item-name">' + escapeHtml(humanize(item.name)) + qtyLabel + '</span><span class="shop-row-right"><span class="shop-item-price">' + item.price + ' creds</span><span class="shop-buy-label">Buy</span></span></button>';
            });
            out += '</div>';
        }
        out += '<div class="juan-quote">Juan taps the counter. "If it\'s on the shelf it has a price. If it\'s not on the shelf, I might be persuaded to find one for you, for the right fee of course."</div>';
        out += '<button class="panel-shop-button" id="panel-finder-button">Ask Juan to Find Something</button>';
        out += '<button class="panel-shop-button" id="panel-sell-button">Sell an Item</button>';
        out += '<button class="panel-back-button" id="' + backButtonId + '">&larr; ' + (backButtonId === "panel-shop-cancel" ? "Close" : "Back") + '</button>';
        if (closingNote) out += '<div class="panel-override-expiry">' + closingNote + '</div>';
        return out;
    }

    // Shows the purchase confirmation for a few seconds, then reverts to whichever shop view was
    // showing (client toggle or server override) - by then the fast-poll burst already kicked
    // off by queueAction should have the real, resolved data ready to display.
    function showPurchaseConfirmation(itemName, price, wasServerOverride) {
        purchaseConfirmationMessage = "You cut a deal with Juan, spending " + price + " creds on " + humanize(itemName) + ". You hide your contraband away - let's hope no Judges have you under surveillance...";
        if (lastFetchedData) renderPerpSheet(lastFetchedData);

        setTimeout(function () {
            purchaseConfirmationMessage = null;
            showShopBrowser = false;
            if (wasServerOverride) queueAction("clearOverride", {});
            if (lastFetchedData) renderPerpSheet(lastFetchedData);
        }, 4000);
    }

    // Shown when queueAction itself failed - i.e. the buyItem request never reached the backend,
    // so there's genuinely nothing to wait on. Stays on the shop view (doesn't clear
    // showShopBrowser/queue a clearOverride) since nothing server-side changed - the player can
    // just try the same click again once this clears.
    function showQueueFailure() {
        queueFailureMessage = "Juan didn't hear you over the noise in here - try that again in a moment.";
        if (lastFetchedData) renderPerpSheet(lastFetchedData);

        setTimeout(function () {
            queueFailureMessage = null;
            if (lastFetchedData) renderPerpSheet(lastFetchedData);
        }, 4000);
    }

    // Same optimistic-interstitial pattern as showPurchaseConfirmation, shown once queueAction
    // confirms the sellItem action actually reached the queue - unlike a purchase, the sale price
    // is rolled fresh server-side (Sell Item), so this can't quote an exact amount the way buying
    // can quote its already-known listed price.
    function showSellConfirmation(itemFullKey) {
        sellConfirmationMessage = "You hand over your " + humanizeItemKey(itemFullKey) + ". Juan counts out a stack of creds without much ceremony.";
        if (lastFetchedData) renderPerpSheet(lastFetchedData);

        setTimeout(function () {
            sellConfirmationMessage = null;
            showSellBrowser = false;
            if (lastFetchedData) renderPerpSheet(lastFetchedData);
        }, 4000);
    }

    // Same pattern - shown once queueAction confirms reduceHeat actually reached the queue. Can
    // quote the exact heat reduction, since that's known client-side from heatReducingItems
    // (unlike a sale price, this isn't rolled fresh server-side).
    function showLayLowConfirmation(itemFullKey, reduction) {
        layLowConfirmationMessage = "You use your " + humanizeItemKey(itemFullKey) + " to lay low. Personal heat down by " + reduction + ".";
        if (lastFetchedData) renderPerpSheet(lastFetchedData);

        setTimeout(function () {
            layLowConfirmationMessage = null;
            showLayLowBrowser = false;
            if (lastFetchedData) renderPerpSheet(lastFetchedData);
        }, 4000);
    }

    // Same transient-message pattern, but for toggling laying-low status on/off - stays within
    // the Lay Low view afterward (rather than closing it) since the player might still want to
    // burn an item in the same visit, or immediately toggle back. Longer window than other
    // confirmations (8s, not 3-4s) - the actual server-side toggle only completes once Process
    // Panel Actions' own Timer picks the queued action up (worst case ~5s if the click lands
    // right after a tick, plus another poll cycle to actually fetch it), so a shorter window
    // risked reverting to show the OLD "Start/Stop Laying Low" button text before the real change
    // had actually landed and been picked up by a poll.
    function showLayLowToggleConfirmation(message) {
        layLowConfirmationMessage = message;
        if (lastFetchedData) renderPerpSheet(lastFetchedData);

        setTimeout(function () {
            layLowConfirmationMessage = null;
            if (lastFetchedData) renderPerpSheet(lastFetchedData);
        }, 8000);
    }

    // Shared by both the render and click-binding logic below, which MUST produce the exact
    // same list in the exact same order (they're index-aligned via shared button ids).
    // Matches Robbery - Attempt's own Categories dictionary exactly (key must match what that
    // script expects as rawInput). Two categories (tools, tech) don't have location artwork yet -
    // handled with no thumbnail rather than blocking the whole feature on two missing images.
    // Maps the exact crew name strings used server-side (Big Heist - Select's crewNamePool) to
    // their logo image. All 30 now covered.
    // Maps the heist catalog KEY (e.g. "HighSocietyHeist" - not the display name) to its banner
    // image. Only 7 of the 12 current heists have artwork yet - the other 5 (TheMintJob,
    // FirstMegaCityTrustHeist, CloningVatsHeist, EvidenceLockupHeist, SeanceHeist) just show no
    // banner until art exists for them. 4 additional images were provided (Transit Hub Shutdown,
    // Armoured Car Convoy, Bank Vault, Data Core Extraction) that don't match any of the 12
    // current heist keys at all - not wired in, since guessing which existing heist they might be
    // intended for risks mismatching real artwork to the wrong heist.
    const HEIST_IMAGES = {
        "EasyTestJob": "heist-easytestjob.png",
        "FashionistaVaultHeist": "heist-fashionistavault.png",
        "HighSocietyHeist": "heist-highsociety.png",
        "OrbitalElevatorHeist": "heist-orbitalelevator.png",
        "SkyRailJob": "heist-skyrailjob.png",
        "UnderCitySumpHeist": "heist-undercitysump.png",
        "AutoFactoryHeist": "heist-autofactory.png",
        "CornerStoreHeist": "heist-cornerstore.png",
        "TheMintJob": "heist-themintjob.png",
        "CadetAcademyHeist": "heist-cadetacademy.png",
        "CloningVatsHeist": "heist-cloningvats.png",
        "CryoVaultJobHeist": "heist-cryovaultjob.png",
        "DebtCollectorsHeist": "heist-debtcollectors.png",
        "EvidenceLockupHeist": "heist-evidencelockup.png",
        "InfluencerImplosionHeist": "heist-influencerimplosion.png",
        "KaraokeCasinoHeist": "heist-karaokecasino.png",
        "OrganleggersRowHeist": "heist-organleggersrow.png",
        "PettingZooCaperHeist": "heist-pettingzoocaper.png",
        "RealityShowHeist": "heist-realityshow.png",
        "RoboChefUprisingHeist": "heist-robochefuprising.png",
        "SeanceHeist": "heist-seance.png",
        "SweatshopSectorHeist": "heist-sweatshopsector.png",
        "FirstMegaCityTrustHeist": "heist-firstmegacitytrust.png",
        "TransitHubShutdownHeist": "heist-transithubshutdown.png",
        "ArmouredCarConvoyHeist": "heist-armouredcarconvoy.png",
        "BankVaultHeist": "heist-bankvault.png",
        "DataCoreExtractionHeist": "heist-datacoreextraction.png"
    };

    const CREW_LOGOS = {
        "The Milky Whiskers": "milky-whiskers.png",
        "The Turbo Trousers Syndicate": "turbo-trousers.png",
        "The Chrome-Plated Custard Crew": "custard-crew.png",
        "The Neon Noodle Network": "neon-noodles.png",
        "The Grumpy Glitter Gang": "grumpy-glitter-gang.png",
        "The Atomic Biscuit Brigade": "atomic-biscuit.png",
        "The Velvet Vandal Society": "velvet-vandals.png",
        "The Quantum Quokka Cartel": "quokka-cartel.png",
        "The Soggy Crumpet Collective": "soggy-crumpets.png",
        "The Thunder Muffin Mob": "thunder-muffin-mob.png",
        "The G'lactic Goose Guild": "galactic-goose.png",
        "The Rusty Nacho Regiment": "rusty-nacho.png",
        "The Plasma Pudding Posse": "plasma-pudding-posse.png",
        "The Savage Sock Syndicate": "savage-sock.png",
        "The Cosmic Crayon Cabal": "cosmic-crayon-cabal.png",
        "The Ferocious Flapjack Front": "ferocious-flapjack.png",
        "The Nuclear Nibbler Unit": "nuclear-nibbler.png",
        "The Chrome Chinchilla Crew": "chrome-chinchilla.png",
        "The Rogue Ravioli Ring": "rogue-ravioli.png",
        "The Titanium Teacup Troop": "titanium-teacup.png",
        "The Bionic Bagel Brotherhood": "bionic-bagel.png",
        "The Sinister Scone Squad": "sinister-scone-squad.png",
        "The Turbo Turnip Taskforce": "turbo-turnip.png",
        "The Velvet Varmint Vanguard": "velvet-varmint-vanguard.png",
        "The Hyper Hamster Heist Team": "hyper-hamster.png",
        "The Quantum Quiche Quartet": "quiche-quartet.png",
        "The Iron Iguana Initiative": "iron-iguana-initiative.png",
        "The Savage Sprinkles Syndicate": "savage-sprinkles-syndicate.png",
        "The Plasma Pancake Pack": "plasma-pancake-pack.png",
        "The Chrome-Claw Custodians": "chrome-claw-custodians.png"
    };

    const ROBBERY_CATEGORIES = [
        { key: "cash", label: "The Bank", image: "robbery-bank.png" },
        { key: "tools", label: "Hardware Store", image: "robbery-hardware.png" },
        { key: "tech", label: "Tech Store", image: "robbery-tech.png" },
        { key: "weapons", label: "Black Market Armory", image: "robbery-armory.png" },
        { key: "explosives", label: "Construction Site", image: "robbery-construction.png" },
        { key: "vehicle", label: "Chop Shop", image: "robbery-chopshop.png" },
        { key: "gear", label: "Costume Shop", image: "robbery-costume.png" },
        { key: "consumables", label: "Chemist", image: "robbery-chemist.png" }
    ];

    function getPickpocketCandidates(data) {
        let list = data.presentViewers || [];
        // Twitch's "users in chat" list typically excludes the broadcaster's own account (they
        // aren't really a "viewer" in that sense) - for test accounts specifically, inject self
        // explicitly rather than depending on presentViewers happening to include them, so
        // self-testing doesn't silently show "nobody eligible" just because the platform never
        // reports the broadcaster as present in the first place.
        if (data.isTestAccount && !list.some(function (v) { return v.userId === currentUserId; })) {
            list = list.concat([{ userId: currentUserId, name: data.name }]);
        }
        return list.filter(function (v) {
            // Self-exclusion skipped only when isTestAccount is actually true - matching
            // Pickpocket Attempt's own server-side check exactly, rather than a hardcoded
            // userId, so the panel never shows an option the real attempt would then reject.
            if (v.userId === currentUserId && !data.isTestAccount) return false;
            if ((data.pickpocketedTargets || []).indexOf(v.userId) !== -1) return false; // already tried this one tonight
            if (v.isLayingLow) return false; // keeping a low profile - not an easy mark right now
            return true;
        });
    }

    function renderPerpSheet(data) {
        if (purchaseConfirmationMessage) {
            // Keeps whatever's already showing in the top-row (mugshot/isocube/etc) completely
            // unchanged - only the bottom content swaps to the confirmation message.
            document.getElementById("rest-of-content").innerHTML =
                '<div class="juan-quote">' + purchaseConfirmationMessage + '</div>';
            return;
        }
        if (queueFailureMessage) {
            document.getElementById("rest-of-content").innerHTML =
                '<div class="juan-quote">' + queueFailureMessage + '</div>';
            return;
        }
        if (sellConfirmationMessage) {
            document.getElementById("rest-of-content").innerHTML =
                '<div class="juan-quote">' + sellConfirmationMessage + '</div>';
            return;
        }
        if (layLowConfirmationMessage) {
            document.getElementById("rest-of-content").innerHTML =
                '<div class="juan-quote">' + layLowConfirmationMessage + '</div>';
            return;
        }

        // cubeReleaseAt is a Unix-seconds timestamp (or null) from Sync To Extension - the source
        // of truth for whether a live countdown should show, independent of whatever the
        // crimeStatus string itself happens to say.
        const nowSeconds = Math.floor(Date.now() / 1000);
        const stillJailed = !!data.cubeReleaseAt && data.cubeReleaseAt > nowSeconds;

        const rawStatus = (data.crimeStatus || "CITIZEN").toUpperCase();
        // crimeStatus gets set to "ISOCUBE #N" at arrest time, but nothing ever explicitly
        // updates it back once released - release is purely time-based via cubeReleaseAt, with
        // no separate "release" event to trigger a status change server-side. Detecting the
        // mismatch here (no longer actually jailed, but the stored value still says ISOCUBE) and
        // showing EX-CON instead is simpler than trying to add a real release-time update
        // somewhere server-side for what's ultimately just a display label.
        const status = (!stillJailed && rawStatus.indexOf("ISOCUBE") === 0) ? "EX-CON" : rawStatus;
        const statusClass = status === "CITIZEN" ? "status-citizen"
            : status === "EX-CON" ? "status-isocube"
            : (stillJailed || status.indexOf("ISOCUBE") === 0) ? "status-isocube"
            : "status-wanted";

        // Build the base skeleton (top-row + rest-of-content containers) if it doesn't exist yet -
        // this handles both the very first successful render, and recovery after an error/loading
        // message temporarily replaced the whole content area and wiped these containers out.
        if (!document.getElementById("top-row")) {
            document.getElementById("content").innerHTML =
                '<div class="top-row" id="top-row"></div><div id="rest-of-content"></div>';
            lastKnownTopRowMode = null;
        }

        const isPending = !!data.pendingMugshotPick;

        // The backend only ever re-checks an override's expiresAt when Sync To Extension happens
        // to run again for some OTHER reason (a purchase, a crime, anything) - if nothing else
        // triggers a sync, the 5-minute timer never actually gets re-validated server-side and the
        // override just sits there indefinitely. Checking expiresAt here too, independent of
        // whatever the backend last sent, means the panel reverts on time regardless of whether
        // anything else happens to nudge the backend into re-checking it.
        const overrideMode = (data.panelOverride && data.panelOverride.mode
            && (!data.panelOverride.expiresAt || data.panelOverride.expiresAt > Math.floor(Date.now() / 1000)))
            ? data.panelOverride.mode : null;

        // Detect a FRESH robbery result (fingerprinted by expiresAt, always newly generated per
        // attempt server-side) and kick off the staged cinematic reveal exactly once - a later
        // poll landing mid-animation with the same override must NOT restart the sequence.
        if (overrideMode === "robberyResult" && data.panelOverride.expiresAt !== robberyCinematicKey) {
            robberyCinematicKey = data.panelOverride.expiresAt;
            robberyCinematicData = data.panelOverride;
            robberyCinematicStage = 0;
            robberyResultDismissed = false;
            robberyPending = false;
            robberyPendingCategory = null;
            for (let stage = 1; stage <= 4; stage++) {
                setTimeout(function () {
                    robberyCinematicStage = stage;
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                }, stage * 2000);
            }
        }

        // Any server-driven override taking priority should reset the client-side toggles
        // (shop browser, pickpocket picker) - without this, whichever toggle was active before
        // the override appeared stays true underneath it, and once the override clears (by
        // ANY means - an explicit Back click, or just auto-expiring after its own timer), that
        // stale toggle causes the old view to silently reappear instead of falling back to
        // normal. This is what caused the real "clicked Back after a shop rejection, button was
        // still there, clicked it, ended up straight back in the shop" bug reported.
        if (overrideMode) {
            showShopBrowser = false;
            showPickpocketPicker = false;
            showSellBrowser = false;
            showLayLowBrowser = false;
            showRobberyPicker = false;
            showBigHeistView = false;
        }

        // Resolves the shop-entry heat check (see shopEntryPending above). "shopReady" means the
        // roll came back clean - open the shop now, for real, instead of the earlier instant-open
        // approach. Any OTHER override arriving instead (heatDenied being the expected one, but
        // treated generically here) also resolves the pending state - whatever just arrived is
        // the real answer, matching the toggle-reset above. Runs after that reset block
        // specifically so a "shopReady" arrival can turn showShopBrowser back on afterward.
        if (shopEntryPending) {
            if (overrideMode === "shopReady") {
                shopEntryPending = false;
                showShopBrowser = true;
                // One-shot signal, not a real persistent state - consume it immediately so it
                // doesn't linger and confuse some other part of the override-priority chain.
                queueAction("clearOverride", {});
            } else if (overrideMode) {
                shopEntryPending = false;
            }
        }
        // showFinderPage gets its own, narrower condition - findersFee and offendedDenied are
        // both genuine STEPS of the same finder flow (the quote, then the outcome of a failed
        // haggle), not unrelated interruptions, so they must NOT reset it here. Only a truly
        // unrelated override (an Oi warning, a Judge alert, a heat rejection) appearing while
        // still on the initial search step should bump the player out of the finder flow.
        if (overrideMode && overrideMode !== "findersFee" && overrideMode !== "offendedDenied") {
            showFinderPage = false;
        }

        // Three different top-row modes, each with its own freshness needs:
        // - PENDING (showing 3 candidates): skeleton rebuilds once on the actual transition INTO
        //   pending (not every poll - see the note above the load-attempt block below for why).
        // - JAILED (showing the isocube with a live countdown + stenciled name): also only
        //   rebuilds on transition, since the image/name don't need to reload every poll - only
        //   the H/M/S digits need to tick, which happens via the countdown interval below, not a
        //   full skeleton rebuild.
        // - NORMAL (final mugshot): genuinely never changes once picked (same mugshotVersion
        //   until the next real pick), so this keeps the original freeze-on-transition behavior.
        // Pending takes priority over everything else (a mugshot pick is a blocking action);
        // panelOverride (Juan's Emporium shop/finders-fee/item-info) comes next, ahead of jailed -
        // an active interaction the player just triggered takes priority over the passive jailed
        // state; jailed and normal come after. panelOverride naturally reverts to whichever of
        // jailed/normal applies once it's cleared or expires, since Sync To Extension prunes an
        // expired one before it's ever sent.
        // Bagman's Honour/Doublecross choice takes priority over literally everything else in
        // the panel - a genuine 30-second real-time deadline set by Getaway Success's own
        // CPH.Wait(30000), the tightest time pressure anywhere in this whole panel. Getting
        // buried behind a shop screen or jail countdown would be actively harmful here, not just
        // inconvenient - missing the window forfeits the choice entirely.
        if (data.pendingBagmanChoice) {
            if (bagmanChoiceMade) {
                // Still waiting for the server to actually process and resync - keep showing the
                // acknowledgment rather than the original buttons, even if this particular poll
                // hasn't caught up yet.
                const ackTitle = bagmanChoiceMade === "honour" ? "Heading to the rendezvous." : "Making a run for it.";
                const ackMessage = bagmanChoiceMade === "honour"
                    ? "You're meeting the crew to split the loot. Sit tight."
                    : "You're taking everything and disappearing. Sit tight.";
                document.getElementById("rest-of-content").innerHTML =
                    '<div class="section-title">' + ackTitle + '</div>' +
                    '<div class="juan-quote">' + ackMessage + '</div>';
                return;
            }

            document.getElementById("rest-of-content").innerHTML =
                '<div class="alert-frame-purple alert-takeover-box">' +
                '<div class="section-title">You made it out with the loot.</div>' +
                '<div class="juan-quote">Honour among thieves, or keep it all for yourself? You have 30 seconds.</div>' +
                '<button class="panel-urgent-button" id="panel-bagman-honour">Honour - split with the crew</button>' +
                '<button class="panel-urgent-button" id="panel-bagman-doublecross">Doublecross - keep it all</button>' +
                '</div>';

            const honourBtn = document.getElementById("panel-bagman-honour");
            if (honourBtn) {
                honourBtn.addEventListener("click", function () {
                    bagmanChoiceMade = "honour";
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    queueAction("bagmanHonour", {});
                });
            }
            const doublecrossBtn = document.getElementById("panel-bagman-doublecross");
            if (doublecrossBtn) {
                doublecrossBtn.addEventListener("click", function () {
                    bagmanChoiceMade = "doublecross";
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    queueAction("bagmanDoublecross", {});
                });
            }
            return;
        } else if (bagmanChoiceMade) {
            // Server has confirmed resolution (pendingBagmanChoice is now gone) - clear the flag
            // so a FUTURE bagman choice later in the stream isn't permanently stuck showing this
            // old acknowledgment.
            bagmanChoiceMade = null;
        }

        // The actual outcome of a doublecross attempt (or its "still shows something happened"
        // treatment more generally) - without this, the panel would just silently jump straight
        // from the acknowledgment screen to the normal character sheet the moment
        // pendingBagmanChoice cleared, with no indication of whether it actually paid off.
        if (data.bagmanResultNotice && data.bagmanResultNotice.message && !bagmanNoticeDismissed) {
            const noticeMsg = data.bagmanResultNotice.message;
            if (bagmanNoticeDismissTimerFor !== noticeMsg) {
                // A genuinely new notice (different message than whatever we last saw) - starts a
                // fresh 20-second client-side timer, since the server has no reliable way to tell
                // the panel when to move on from this screen on its own.
                bagmanNoticeDismissTimerFor = noticeMsg;
                setTimeout(function () {
                    bagmanNoticeDismissed = true;
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                }, 20000);
            }
            document.getElementById("rest-of-content").innerHTML =
                '<div class="section-title">The dust settles.</div>' +
                '<div class="juan-quote">' + escapeHtml(noticeMsg) + '</div>';
            return;
        } else if (!data.bagmanResultNotice && (bagmanNoticeDismissTimerFor || bagmanNoticeDismissed)) {
            // Server has confirmed the notice is genuinely gone (its own expiresAt lapsed and a
            // later sync picked that up) - reset so a FUTURE notice later in the stream gets its
            // own fresh timer rather than being permanently suppressed.
            bagmanNoticeDismissTimerFor = null;
            bagmanNoticeDismissed = false;
        }

        // Locks the panel down to just the heist image/title while the OBS finale is actually
        // running - nothing else should be interactive during this window (shop, item commits,
        // etc.), since the cinematic sequence is live and none of that reflects anything real
        // happening in the moment. Bagman choice/result above still take priority over this,
        // since those genuinely need to keep working during this exact window.
        if (data.heistRunning && data.bigHeist) {
            const runningBh = data.bigHeist;
            let runningHtml = '<div class="section-title">The Big Heist</div>';
            if (runningBh.heistKey && HEIST_IMAGES[runningBh.heistKey]) {
                runningHtml += '<div class="heist-banner-frame"><img src="' + HEIST_IMAGES[runningBh.heistKey] + '" alt="' + escapeHtml(runningBh.heistName || '') + '"></div>';
            }
            runningHtml += '<div class="juan-quote">' + escapeHtml(runningBh.heistName || 'The heist') + ' is underway. Sit tight - the crew\'s fate is being decided live.</div>';
            // Getaway ride: show the committed vehicle's escape art in place of the old text-only
            // line. getawayVehicleName is the vehicle's catalog key (e.g. "GetawayCar"), so the
            // image URL is getaways/<key>.png. No vehicle committed = crew's on foot -> OnFoot art.
            // The <img> onerror hides just the frame (not the caption) if that key hasn't been
            // uploaded yet, so a missing image degrades to text rather than a broken-image icon.
            var getawayKey = runningBh.getawayVehicleName ? String(runningBh.getawayVehicleName) : "OnFoot";
            var getawayCaption = runningBh.getawayVehicleName
                ? ("Getaway ride: " + humanize(runningBh.getawayVehicleName))
                : "No wheels this time - the crew's on foot.";
            runningHtml += '<div class="heist-banner-frame"><img src="' + GETAWAY_BASE_URL + '/'
                + encodeURIComponent(getawayKey) + '.png" alt="' + escapeHtml(getawayCaption)
                + '" onerror="this.parentNode.style.display=\'none\'"></div>';
            runningHtml += '<div class="items-text">' + escapeHtml(getawayCaption) + '</div>';
            // Personal escape kit: the auto-applying Personal-scope Escape items this crew member
            // owns (Sync To Extension already computed the list + each item's effective bonus,
            // mirroring Getaway Success's rule, and only sends it for actual crew). Purely
            // informational - these apply with no action needed - so it's a read-only showcase of
            // "what's boosting your escape" while the finale plays out. Item art reuses the items/
            // gallery (ITEMS_BASE_URL + imageFile), same as the shop/item-info views.
            if (runningBh.escapeKit && runningBh.escapeKit.length) {
                var kitTotal = 0;
                var kitHtml = '<div class="section-title">Your Escape Kit</div>';
                kitHtml += '<div class="escape-kit-note">Auto-applied to your personal getaway roll - no action needed.</div>';
                kitHtml += '<div class="escape-kit-grid">';
                for (var ki = 0; ki < runningBh.escapeKit.length; ki++) {
                    var kit = runningBh.escapeKit[ki];
                    var kitBonus = kit.effectiveBonus || 0;
                    kitTotal += kitBonus;
                    var kitName = humanize(kit.baseItemName) + (kit.tier && kit.tier !== "Basic" ? " (" + kit.tier + ")" : "");
                    kitHtml += '<div class="escape-kit-item">';
                    if (kit.imageFile) {
                        kitHtml += '<img class="escape-kit-img" src="' + ITEMS_BASE_URL + '/' + encodeURIComponent(kit.imageFile)
                            + '" alt="' + escapeHtml(kitName) + '" onerror="this.style.display=\'none\'">';
                    }
                    kitHtml += '<div class="escape-kit-name">' + escapeHtml(kitName) + '</div>';
                    kitHtml += '<div class="escape-kit-bonus">+' + kitBonus + '</div>';
                    kitHtml += '</div>';
                }
                kitHtml += '</div>';
                kitHtml += '<div class="escape-kit-total">Total escape bonus: <span>+' + kitTotal + '</span></div>';
                runningHtml += kitHtml;
            }
            document.getElementById("rest-of-content").innerHTML = runningHtml;
            return;
        }

        // Pending item-move confirmation ("your X is already being used for Y, move it to Z?")
        // also takes top-level priority, shown regardless of which screen the panel is currently
        // on - this was the actual cause of "the chat asks to move it, but the panel never shows
        // anything," since this used to only render inside the Big Heist sub-view, so it was
        // invisible unless the player happened to already be looking at that exact screen.
        if (data.pendingItemMove) {
            const pendingMove = data.pendingItemMove;
            const oldDest = pendingMove.oldDestination === "getaway" ? "the Getaway" : humanize(pendingMove.oldDestination || "");
            const newDestParts = [];
            if (pendingMove.newTaskKey) newDestParts.push(humanize(pendingMove.newTaskKey));
            if (pendingMove.newWantsGetaway) newDestParts.push("the Getaway");
            const newDest = newDestParts.length > 0 ? newDestParts.join(" + ") : "somewhere else";

            document.getElementById("rest-of-content").innerHTML =
                '<div class="alert-frame-purple alert-takeover-box">' +
                '<div class="section-title">Item already in use</div>' +
                '<div class="juan-quote">Your ' + escapeHtml(humanize(pendingMove.baseItemName || "")) + ' is already being used for ' + escapeHtml(oldDest) + '. Move it to ' + escapeHtml(newDest) + ' instead?</div>' +
                '<button class="panel-urgent-button" id="panel-moveitem-yes">Yes, move it</button>' +
                '<button class="panel-back-button" id="panel-moveitem-no">No, leave it</button>' +
                '</div>';

            const moveYes = document.getElementById("panel-moveitem-yes");
            if (moveYes) {
                moveYes.addEventListener("click", function () {
                    moveYes.disabled = true;
                    queueAction("moveItemConfirm", { confirm: "yes" });
                });
            }
            const moveNo = document.getElementById("panel-moveitem-no");
            if (moveNo) {
                moveNo.addEventListener("click", function () {
                    moveNo.disabled = true;
                    queueAction("moveItemConfirm", { confirm: "no" });
                });
            }
            return;
        }

        if (isPending) {
            // Only rebuild the candidates skeleton on the actual transition INTO pending, not
            // every 15s poll while still pending - rebuilding every poll would wipe out an
            // already-successfully-loaded image (hiding it again via the blank img/display:none
            // skeleton) since only the first poll schedules a new load attempt below.
            if (lastKnownTopRowMode !== "pending") {
                let topRowHtml = '<div class="pending-pick-box">';
                topRowHtml += '<div class="pending-pick-instruction">Type !pickmugshot 1, 2, or 3 in chat to choose</div>';
                topRowHtml += '<div class="candidates-row">';
                for (let i = 1; i <= 3; i++) {
                    topRowHtml += '<div class="candidate-frame" id="candidate-frame-' + i + '">' +
                        '<div class="candidate-status" id="candidate-status-' + i + '">Preparing...</div>' +
                        '<img id="candidate-img-' + i + '" class="candidate-img-' + i + '" style="display:none">' +
                        '<div class="candidate-number">' + i + '</div></div>';
                }
                topRowHtml += '</div>';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "pending";
                currentCandidateHashes = data.candidateHashes || [];

                // Short wait before the first attempt, just to let Become Perp's delete-then-
                // upload sequence get underway - the actual correctness guarantee comes from
                // hash verification inside loadCandidateImage below, not from this wait. A fetch
                // during the real propagation gap now returns either a genuine 404 (old file
                // deleted, new one not live yet) or, in rare cases, a stale-but-successful 200 -
                // either way, loadCandidateImage only ever displays a candidate once its hash
                // matches the ground-truth hash from Become Perp, so nothing wrong ever shows.
                if (currentUserId) {
                    setTimeout(function () {
                        for (let i = 1; i <= 3; i++) {
                            loadCandidateImage(i, 0);
                        }
                    }, CANDIDATE_INITIAL_WAIT_MS);
                }
            }
        } else if (overrideMode && !(overrideMode === "robberyResult" && robberyResultDismissed)) {
            // Only rebuild on an actual transition, tracked as "override-<mode>" for shop/
            // findersFee (their Juan portraits are static assets that never change, so no reason
            // to reload them) - but for itemInfo specifically, the key ALSO includes the item name
            // and image filename, since the mode can stay "itemInfo" across two different lookups,
            // or the same item's data can newly gain an image (exactly what happened here: a
            // second !iteminfo Lockpick after the catalog got its imageFile field added didn't
            // show the image until a full page reload, because "still itemInfo mode" looked like
            // no change to this check).
            const overrideTopRowKey = overrideMode === "itemInfo"
                ? "override-itemInfo-" + (data.panelOverride.itemName || "") + "-" + (data.panelOverride.imageFile || "")
                : overrideMode === "robberyResult"
                ? "override-robberyResult-" + robberyCinematicKey
                : "override-" + overrideMode;
            if (lastKnownTopRowMode !== overrideTopRowKey) {
                const overrideImages = {
                    shop: "juan-shop.png",
                    findersFee: "juan-findersfee.png"
                    // itemInfo has no fixed Juan portrait - uses the item's own image instead,
                    // built into rest-of-content below since it's item-specific, not static.
                };
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                if (overrideImages[overrideMode]) {
                    topRowHtml += '<div class="juan-frame"><img src="' + overrideImages[overrideMode] + '" alt="Juan\'s Emporium"></div>';
                } else if (overrideMode === "itemInfo") {
                    const itemImg = data.panelOverride.imageFile;
                    topRowHtml += '<div class="juan-frame item-info-frame">';
                    topRowHtml += itemImg
                        ? '<img src="' + ITEMS_BASE_URL + '/' + encodeURIComponent(itemImg) + '" alt="' + escapeHtml(data.panelOverride.itemName || "") + '">'
                        : '<div class="mugshot-placeholder">No image yet</div>';
                    topRowHtml += '</div>';
                } else if (overrideMode === "oiWarning") {
                    topRowHtml += '<div class="juan-frame item-info-frame alert-frame-purple"><img src="pickpocket-alert.png" alt="Pickpocket in progress"></div>';
                } else if (overrideMode === "arrestAlert") {
                    topRowHtml += '<div class="juan-frame item-info-frame alert-frame-purple judge-alert-yellow-border"><img src="judge-icon.png" alt="Judge alert"></div>';
                } else if (overrideMode === "heatDenied" || overrideMode === "offendedDenied") {
                    topRowHtml += '<div class="juan-frame alert-frame-purple"><img src="juan-closed.png" alt="Turned away"></div>';
                } else if (overrideMode === "robberyResult") {
                    // Location image stays up throughout the whole staged reveal, per user's
                    // spec - "clear the panel and add the image of the place up the top."
                    topRowHtml += robberyCinematicData && robberyCinematicData.locationImage
                        ? '<div class="juan-frame robbery-frame"><img src="' + robberyCinematicData.locationImage + '" alt="' + escapeHtml(robberyCinematicData.jobLabel || "") + '"></div>'
                        : '<div class="juan-frame robbery-frame"><div class="mugshot-placeholder">' + escapeHtml((robberyCinematicData && robberyCinematicData.jobLabel) || "") + '</div></div>';
                }
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = overrideTopRowKey;
            }
        } else if (robberyPending) {
            // Shows the same location image the real cinematic will use, straight away - the
            // client already knows which category was picked, even before the server round-trip
            // finishes computing the actual outcome.
            const pendingKey = "robbery-pending-" + (robberyPendingCategory ? robberyPendingCategory.key : "");
            if (lastKnownTopRowMode !== pendingKey) {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += (robberyPendingCategory && robberyPendingCategory.image)
                    ? '<div class="juan-frame robbery-frame"><img src="' + robberyPendingCategory.image + '" alt=""></div>'
                    : '<div class="juan-frame robbery-frame"><div class="mugshot-placeholder">' + escapeHtml((robberyPendingCategory && robberyPendingCategory.label) || "") + '</div></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = pendingKey;
            }
        } else if (showFinderPage) {
            // Same juan-shop.png treatment as the shop browser - this is still a Juan's
            // Emporium interaction, just the search step of the finder flow specifically.
            if (lastKnownTopRowMode !== "client-finder") {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame"><img src="juan-shop.png" alt="Juan\'s Emporium"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "client-finder";
            }
        } else if (shopEntryPending) {
            // Same juan-shop.png treatment as the shop browser itself - visually this IS the
            // "walking in" beat, just before we know whether Juan actually lets them in.
            if (lastKnownTopRowMode !== "client-shop-pending") {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame"><img src="juan-shop.png" alt="Juan\'s Emporium"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "client-shop-pending";
            }
        } else if (showShopBrowser) {
            // Was missing entirely before - the instant client-side shop toggle only ever
            // updated the bottom content, leaving whatever top-row was already showing (usually
            // the normal mugshot/status) untouched. That's exactly the "mix of mugshot and
            // Juan's" bug reported - the bottom said Juan's Emporium while the top still showed
            // the player's own status badge. Matches the same juan-shop.png treatment the
            // server-driven shop override already uses.
            if (lastKnownTopRowMode !== "client-shop") {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame"><img src="juan-shop.png" alt="Juan\'s Emporium"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "client-shop";
            }
        } else if (stillJailed) {
            // Only rebuild on the actual transition INTO jailed - the image and stenciled name
            // don't change while someone's serving time, only the digits need to tick, which the
            // countdown interval below handles directly without touching the rest of this markup.
            if (lastKnownTopRowMode !== "jailed") {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="isocube-frame" id="isocube-frame">';
                topRowHtml += '<img src="isocube.png" alt="ISOCUBE">';
                topRowHtml += '<div class="isocube-name" id="isocube-name" style="font-size:' + isoCubeNameFontSize(data.name) + 'px">' + escapeHtml(data.name) + '</div>';
                topRowHtml += '<div class="isocube-digit isocube-digit-hours" id="isocube-hours">00</div>';
                topRowHtml += '<div class="isocube-digit isocube-digit-minutes" id="isocube-minutes">00</div>';
                topRowHtml += '<div class="isocube-digit isocube-digit-seconds" id="isocube-seconds">00</div>';
                topRowHtml += '</div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "jailed";
            }
        } else if (lastKnownTopRowMode !== "normal") {
            let topRowHtml = '<div class="stacked-panel">';
            topRowHtml += '<div id="name-status-area"></div>';
            topRowHtml += '<div class="mugshot-frame" id="mugshot-frame">';
            if (currentUserId) {
                topRowHtml += '<div class="mugshot-placeholder" id="mugshot-status">Loading...</div>';
                topRowHtml += '<img id="mugshot-img" style="display:none">';
            } else {
                topRowHtml += '<div class="mugshot-placeholder">No Photo</div>';
            }
            topRowHtml += '</div>';
            topRowHtml += '</div>';

            document.getElementById("top-row").innerHTML = topRowHtml;
            lastKnownTopRowMode = "normal";
            currentMugshotHash = data.mugshotHash || "";

            if (currentUserId) {
                loadFinalMugshotImage(data.mugshotVersion || "0", 0);
            }
        }

        // Name and status update every refresh as normal - only the mugshot itself is frozen
        // after first load. While an override is active (shop/findersFee/itemInfo), the crime
        // status badge (WANTED/CITIZEN/UNDER SURVEILLANCE) looks out of place in that context -
        // shows contextual flavor text instead.
        let nameStatusHtml;

        if (overrideMode === "shop") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' arrives at...</div>';
            nameStatusHtml += '<div class="flavor-text">Juan\'s Emporium</div>';
        } else if (overrideMode === "findersFee") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' calls in a favor...</div>';
        } else if (overrideMode === "itemInfo") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' takes a closer look...</div>';
        } else if (overrideMode === "oiWarning") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' feels a hand in their pocket!</div>';
        } else if (overrideMode === "arrestAlert") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ', a crime has been reported...</div>';
        } else if (overrideMode === "heatDenied") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' is turned away at the door...</div>';
        } else if (overrideMode === "offendedDenied") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' has offended Juan...</div>';
        } else if (overrideMode === "robberyResult" && !robberyResultDismissed) {
            // Deliberately static/generic here - this area only rebuilds on a top-row mode
            // transition, not per cinematic stage, so the actual staged narrative text all lives
            // in the content area below instead, which does fully re-render each stage.
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
        } else if (robberyPending) {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
        } else if (showFinderPage) {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' makes a request...</div>';
            nameStatusHtml += '<div class="flavor-text">Juan\'s Emporium</div>';
        } else if (shopEntryPending) {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' walks in to...</div>';
            nameStatusHtml += '<div class="flavor-text">Juan\'s Emporium</div>';
        } else if (showShopBrowser) {
            // Same gap as the top-row fix above - showShopBrowser wasn't part of this chain at
            // all, so the status badge (WANTED/CITIZEN/UNDER SURVEILLANCE) kept showing even
            // while the bottom content said Juan's Emporium.
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' arrives at...</div>';
            nameStatusHtml += '<div class="flavor-text">Juan\'s Emporium</div>';
        } else {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';

            if (stillJailed) {
                // Text gets filled in by updateCountdownBadge() below, ticking live every second -
                // not written here, since this HTML gets rebuilt on every 15s poll and we don't want
                // a stale number sitting there for up to a second before the ticker catches up.
                nameStatusHtml += '<div class="status-badge ' + statusClass + '" id="cube-countdown-badge"></div>';
            } else {
                nameStatusHtml += '<div class="status-badge ' + statusClass + '">' + escapeHtml(status) + '</div>';
            }
        }

        document.getElementById("name-status-area").innerHTML = nameStatusHtml;

        // Stop any previous ticker before possibly starting a new one - see the
        // countdownIntervalId declaration above for why this matters.
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
        }

        if (stillJailed) {
            updateCountdownBadge(data.cubeReleaseAt);
            updateIsoCubeDigits(data.cubeReleaseAt);
            countdownIntervalId = setInterval(function () {
                updateCountdownBadge(data.cubeReleaseAt);
                updateIsoCubeDigits(data.cubeReleaseAt);
            }, 1000);
        }

        // Freeze check for the two input-containing modes - only rebuilds rest-of-content when
        // the underlying mode/data actually changes, not on every single poll. Both
        // findersFee's asking price and showFinderPage itself are effectively static once shown
        // (nothing about them changes while the player is typing an offer or a search term), so
        // there's nothing lost by skipping the rebuild here - the existing DOM, including
        // whatever's currently typed and focused, is left completely untouched.
        // showFinderPage's key also folds in the current pickpocketNotice's expiresAt - without
        // this, a rejection notice (e.g. "never heard of that item") arriving while still on this
        // screen would never actually render (the freeze returns before ever reaching the toast
        // code below), AND the search button - disabled the instant it was clicked - would stay
        // disabled forever, since nothing else was ever changing the key to allow a rebuild.
        const contentFreezeKey = overrideMode === "findersFee"
            ? "findersFee-" + ((data.panelOverride && data.panelOverride.itemName) || "") + "-" + ((data.panelOverride && data.panelOverride.askingPrice) || 0)
            : showFinderPage ? "finderPage-" + ((data.pickpocketNotice && data.pickpocketNotice.expiresAt) || 0) : null;

        if (contentFreezeKey && lastKnownContentKey === contentFreezeKey) {
            return;
        }
        lastKnownContentKey = contentFreezeKey;

        let html = '';

        if (overrideMode === "robberyResult" && !robberyResultDismissed) {
            const rd = robberyCinematicData || {};
            const perpName = escapeHtml(rd.perpName || data.name || "");
            const jobLabel = escapeHtml(rd.jobLabel || "somewhere");
            const isHard = !!rd.isHardJob;
            const outcome = rd.outcome || "fail";
            const succeeded = outcome === "success";

            // Per user's request: each beat stays on screen and the next one appears BELOW it,
            // building a running log of the whole job rather than replacing the previous line.
            const lines = [];
            lines.push(perpName + ' robs ' + jobLabel + '. Will it go well? Will they get what they want?');
            if (robberyCinematicStage >= 1) {
                lines.push(perpName + ' has a skill of ' + (typeof rd.skillValue === "number" ? rd.skillValue : 0) + ' - this looks to be a ' + (isHard ? 'hard' : 'easy') + ' job. "' + (isHard ? 'Not for the faint of heart.' : "Just don't blow it.") + '"');
            }
            if (robberyCinematicStage >= 2) {
                lines.push('Here comes the roll....');
            }
            if (robberyCinematicStage >= 3) {
                lines.push(perpName + ' ' + (succeeded ? 'succeeds' : 'fails') + '! "' + (succeeded ? 'Never in doubt.' : 'Oof, this is gonna hurt - are there any Judges around?') + '"');
            }
            if (robberyCinematicStage >= 4) {
                lines.push(escapeHtml(rd.resultLine || ''));
            }

            lines.forEach(function (line) {
                html += '<div class="juan-quote">' + line + '</div>';
            });

            if (robberyCinematicStage >= 4) {
                html += '<button class="panel-back-button" id="panel-robbery-result-back">&larr; Back</button>';
            }
        } else if (robberyPending) {
            // Immediate transitional screen the instant a job is picked - the real cinematic
            // takes over automatically the moment its override actually arrives (see the
            // detection block near the top of this function).
            html += '<div class="juan-quote">The ' + escapeHtml(((robberyPendingCategory && robberyPendingCategory.label) || 'job').replace(/^The\s+/i, '')) + ' job is underway...</div>';
        } else if (overrideMode === "shop") {
            const shopItems = (data.panelOverride && data.panelOverride.items) || [];
            html += buildShopHtml(shopItems, "panel-back-button", "This view closes automatically in a few minutes, or as soon as you do something else.");
        } else if (overrideMode === "findersFee") {
            const itemName = (data.panelOverride && data.panelOverride.itemName) || "";
            const askingPrice = (data.panelOverride && data.panelOverride.askingPrice) || 0;
            html += '<div class="section-title">Finder\'s Fee</div>';
            html += '<div class="juan-quote">Juan glances around, then leans in close. "I know a guy who knows a guy..."</div>';
            html += '<div class="shop-instruction">He can get his hands on <strong>' + escapeHtml(humanize(itemName)) + '</strong> - for the right price. He wants <span class="creds-text">' + askingPrice + '</span> creds. Your call.</div>';
            html += '<input type="text" class="panel-text-input" id="haggle-offer-input" placeholder="Your offer...">';
            html += '<button class="panel-urgent-button" id="haggle-offer-button">Make Offer</button>';
            html += '<button class="panel-back-button" id="panel-back-button">&larr; Back</button>';
            html += '<div class="panel-override-expiry">This view closes automatically in a few minutes, or once the deal is resolved.</div>';
        } else if (overrideMode === "itemInfo") {
            const ov = data.panelOverride || {};
            const itemName = ov.itemName || "";
            const description = ov.description || "No description on file.";
            html += '<div class="section-title">' + escapeHtml(humanize(itemName)) + '</div>';
            html += '<div class="items-text">' + escapeHtml(description) + '</div>';
            html += '<div class="shop-list">';
            html += '<div class="shop-row"><span class="shop-item-name">Category</span><span class="shop-item-price">' + escapeHtml(ov.category || "Uncategorized") + '</span></div>';
            html += '<div class="shop-row"><span class="shop-item-name">Rarity</span><span class="shop-item-price">' + (ov.rarity != null ? ov.rarity : "?") + '</span></div>';
            html += '<div class="shop-row"><span class="shop-item-name">Price Range</span><span class="shop-item-price">' + (ov.priceMin != null ? ov.priceMin : "?") + ' - ' + (ov.priceMax != null ? ov.priceMax : "?") + ' creds</span></div>';
            html += '</div>';
            if (ov.stealLocations && ov.stealLocations.length > 0) {
                html += '<div class="section-title">Steal Locations</div>';
                html += '<div class="items-text">' + ov.stealLocations.map(escapeHtml).join(', ') + '</div>';
            }
            html += '<button class="panel-back-button" id="panel-back-button">&larr; Back</button>';
            html += '<div class="panel-override-expiry">This view closes automatically in a few minutes, or as soon as you do something else.</div>';
        } else if (overrideMode === "oiWarning") {
            const ov = data.panelOverride || {};
            html += '<div class="section-title">Someone\'s In Your Pocket!</div>';
            html += '<div class="items-text">You feel a hand where it shouldn\'t be. Quick - do something about it before they get away!</div>';
            html += '<button class="panel-urgent-button" id="panel-oi-button">OI!</button>';
        } else if (overrideMode === "arrestAlert") {
            const ov = data.panelOverride || {};
            html += '<div class="section-title">Crime In Progress</div>';
            html += '<div class="items-text">' + escapeHtml(ov.perpName || "Someone") + ' has been spotted mid-' + escapeHtml(ov.crimeType || "crime") + '. Move fast if you want to make the arrest.</div>';
            html += '<button class="panel-urgent-button" id="panel-arrest-button">ARREST</button>';
        } else if (overrideMode === "heatDenied") {
            const heatSource = (data.panelOverride && data.panelOverride.heatSource) || "personal";
            html += '<div class="section-title">Turned Away</div>';
            if (heatSource === "show") {
                html += '<div class="juan-quote">Juan doesn\'t even look up. "Not tonight. Judges are all over this whole area lately - can\'t risk it with anyone right now."</div>';
            } else {
                html += '<div class="juan-quote">Juan doesn\'t even look up. "Not tonight. You specifically are carrying too much heat for my liking - come back when things have cooled off."</div>';
            }
            html += '<button class="panel-back-button" id="panel-back-button">&larr; Back</button>';
        } else if (overrideMode === "offendedDenied") {
            html += '<div class="section-title">Deal\'s Off</div>';
            html += '<div class="juan-quote">Juan\'s face goes cold. "That offer is an insult. Get out of my shop - and don\'t come back until you\'ve learned some manners."</div>';
            html += '<button class="panel-back-button" id="panel-back-button">&larr; Back</button>';
        } else if (showFinderPage) {
            // Panel-driven replacement for !finditem - a text search field. Submitting queues
            // finderSearch, which triggers the same server-side Finders Fee System logic a chat
            // command would have, setting the findersFee panelOverride (which takes over from
            // this view automatically once it arrives, per the normal override-priority chain).
            html += '<div class="section-title">Ask Juan to Find Something</div>';
            html += '<div class="shop-instruction">What are you after? Juan can get almost anything - for the right price.</div>';
            html += '<input type="text" class="panel-text-input" id="finder-search-input" placeholder="Item name...">';
            html += '<button class="panel-urgent-button" id="finder-search-button">Ask Juan</button>';
            html += '<button class="panel-back-button" id="panel-finder-cancel">&larr; Cancel</button>';
        } else if (showPickpocketPicker) {
            // Client-side only - no server panelOverride involved, since this is just a quick
            // pick-and-go UI interaction, not something that needs to persist across polls or
            // page reloads the way the shop/findersFee/itemInfo views do.
            const viewers = getPickpocketCandidates(data);

            html += '<div class="section-title">Pick a Target</div>';
            if (viewers.length === 0) {
                html += '<div class="items-text">Nobody eligible is currently present.</div>';
            } else {
                html += '<div class="shop-list">';
                viewers.forEach(function (v, i) {
                    html += '<button class="panel-shop-button pickpocket-target-button" id="pickpocket-target-' + i + '" data-target="' + escapeHtml(v.userId) + '">' + escapeHtml(v.name) + '</button>';
                });
                html += '</div>';
            }
            html += '<button class="panel-back-button" id="panel-pickpocket-cancel">&larr; Cancel</button>';
        } else if (shopEntryPending) {
            // Waiting on the server's heat roll before deciding whether Juan actually lets them
            // in - see shopEntryPending above. No buttons here on purpose; this resolves itself
            // automatically within a couple of seconds (or via the safety-net timeout).
            html += '<div class="section-title">Walking In...</div>';
            html += '<div class="juan-quote">You head toward Juan\'s place, keeping half an eye on who\'s watching.</div>';
        } else if (showShopBrowser) {
            // Instant, client-side - no queued action or server round-trip needed just to
            // browse, since shopListing is passive data pushed by Rotation Script whenever the
            // shop actually restocks (once a stream, typically). Buying an item still goes
            // through the normal queue below exactly as before.
            html += buildShopHtml(data.shopListing || [], "panel-shop-cancel", "");
        } else if (showSellBrowser) {
            // Client-side only, same reasoning as the Pickpocket picker - the player's own
            // inventory is already part of every normal poll response, so there's no separate
            // passive shop-style listing needed just to browse what you own.
            const sellKeys = Object.keys(data.inventory || {}).filter(function (k) { return data.inventory[k] > 0; });

            html += '<div class="section-title">Sell to Juan</div>';
            if (sellKeys.length === 0) {
                html += '<div class="items-text">You have nothing to sell.</div>';
            } else {
                html += '<div class="shop-list">';
                sellKeys.forEach(function (fullKey, i) {
                    const qty = data.inventory[fullKey];
                    const qtyLabel = qty > 1 ? (' x' + qty) : '';
                    html += '<button class="shop-row shop-row-clickable" id="sell-item-' + i + '" data-item="' + escapeHtml(fullKey) + '"><span class="shop-item-name">' + escapeHtml(humanizeItemKey(fullKey)) + qtyLabel + '</span><span class="shop-row-right"><span class="shop-buy-label">Sell</span></span></button>';
                });
                html += '</div>';
            }
            html += '<div class="juan-quote">Juan looks over your gear. "Forty cents on the value, take it or leave it."</div>';
            html += '<button class="panel-back-button" id="panel-sell-cancel">&larr; Cancel</button>';
        } else if (showLayLowBrowser) {
            // Client-side only, same reasoning as Sell/Pickpocket - the player's own inventory
            // (already filtered server-side down to just heat-reducing items) is already part of
            // every normal poll response.
            const heatItems = data.heatReducingItems || {};
            const heatKeys = Object.keys(heatItems);
            const isLayingLow = !!data.isLayingLow;
            const personalHeatVal = typeof data.personalHeat === "number" ? data.personalHeat : 0;
            const showHeatVal = typeof data.showHeat === "number" ? data.showHeat : 0;

            html += '<div class="section-title">Lay Low</div>';

            // Split display (unlike the combined single number on the normal sheet) - this is
            // specifically the screen where personal heat should visibly be seen coming down,
            // since that's the whole point of laying low or burning an item here.
            html += '<div class="heat-split-row"><span class="heat-split-item"><span class="section-title">Personal</span><span class="creds-text">' + personalHeatVal + '</span></span><span class="heat-split-item"><span class="section-title">Local</span><span class="creds-text">' + showHeatVal + '</span></span></div>';

            if (isLayingLow) {
                if (personalHeatVal <= 0) {
                    html += '<div class="items-text">There\'s no heat on you anymore - no need to keep laying low. Get out there and enjoy Sector 21! 🙂</div>';
                } else {
                    html += '<div class="items-text">You\'re currently laying low - personal heat is draining twice as fast, but no shop trips, robberies, or pickpocketing until you stop.</div>';
                }
                html += '<button class="panel-shop-button" id="panel-laylow-toggle">Stop Laying Low</button>';
            } else {
                if (personalHeatVal <= 0) {
                    html += '<div class="items-text">There\'s no heat on you - you don\'t need to lay low. Get out there and enjoy Sector 21! 🙂</div>';
                } else {
                    html += '<div class="items-text">Keep your head down: personal heat drains twice as fast while laying low, but you can\'t shop, rob, or pickpocket until you stop.</div>';
                }
                html += '<button class="panel-shop-button" id="panel-laylow-toggle">Start Laying Low</button>';
            }

            html += '<div class="section-title">Or Burn Something For A Bigger Hit</div>';
            if (heatKeys.length === 0) {
                html += '<div class="items-text">You don\'t have anything that\'ll help you disappear right now.</div>';
            } else {
                html += '<div class="shop-list">';
                heatKeys.forEach(function (fullKey, i) {
                    const qty = data.inventory && data.inventory[fullKey] ? data.inventory[fullKey] : 1;
                    const qtyLabel = qty > 1 ? (' x' + qty) : '';
                    const reduction = heatItems[fullKey];
                    html += '<button class="shop-row shop-row-clickable" id="laylow-item-' + i + '" data-item="' + escapeHtml(fullKey) + '"><span class="shop-item-name">' + escapeHtml(humanizeItemKey(fullKey)) + qtyLabel + '</span><span class="shop-row-right"><span class="shop-item-price">-' + reduction + ' both</span><span class="shop-buy-label">Use</span></span></button>';
                });
                html += '</div>';
                html += '<div class="juan-quote">Setting one of these off knocks down your personal heat AND the whole city\'s at once - but it\'s gone the moment you use it, no keeping it "just in case."</div>';
            }
            html += '<button class="panel-back-button" id="panel-laylow-cancel">&larr; Cancel</button>';
        } else if (showBigHeistView) {
            const bh = data.bigHeist;

            html += '<div class="section-title">The Big Heist</div>';

            if (bh && bh.heistKey && HEIST_IMAGES[bh.heistKey]) {
                html += '<div class="heist-banner-frame"><img src="' + HEIST_IMAGES[bh.heistKey] + '" alt="' + escapeHtml(bh.heistName || '') + '"></div>';
            }

            if (!bh) {
                html += '<div class="items-text">No Big Heist is currently active.</div>';
                html += '<button class="panel-back-button" id="panel-bigheist-cancel">&larr; Back</button>';
            } else {
                html += '<div class="juan-quote">' + escapeHtml(bh.heistName) + (bh.location ? ' - ' + escapeHtml(bh.location) : '') + '</div>';
                if (bh.description) html += '<div class="items-text">' + escapeHtml(bh.description) + '</div>';
                html += '<div class="items-text">Reward: <span class="creds-text">' + bh.reward + '</span> creds' + (bh.crewTogether ? ' - crew stays together on this one.' : '') + '</div>';

                if (bh.crewName) {
                    const logoFile = CREW_LOGOS[bh.crewName];
                    html += '<div class="section-title" style="text-align:center;">' + escapeHtml(bh.crewName) + '</div>';
                    if (logoFile) {
                        html += '<div class="juan-frame robbery-frame" style="margin:0 auto;"><img src="' + logoFile + '" alt="' + escapeHtml(bh.crewName) + '"></div>';
                    }
                }

                if (!bh.isInCrew) {
                    html += '<div class="items-text">You need to join the crew before you can pick a task.</div>';
                    html += '<button class="panel-urgent-button" id="panel-joincrew-button">Join the Crew</button>';
                    html += '<button class="panel-back-button" id="panel-bigheist-cancel">&larr; Back</button>';
                } else {

                html += '<div class="juan-quote">Once you\'re in, you\'re in. Walking away mid-job means dropping whatever you\'ve picked up and leaving the rest of the crew to cover for you.</div>';
                html += '<button class="panel-back-button" id="panel-quitcrew-button">Quit the Crew</button>';

                html += '<div class="section-title">Tasks</div>';
                (bh.tasks || []).forEach(function (task, i) {
                    const crewLabel = task.crewNeeded === -1 ? (task.crewFilled + '/open') : (task.crewFilled + '/' + task.crewNeeded);

                    // Difficulty framing, personal to the viewer - compares THEIR skill for this
                    // task's role against the task's difficulty number. Assumption flagged: no
                    // formal difficulty-tier formula was given, so the gap (difficulty minus
                    // skill) is bucketed into 4 bands - easy fits within a caster's skill, near
                    // impossible expects skill nobody would realistically have yet. Skill lookup
                    // matches the task's requiredRole directly against data.skills - if that role
                    // isn't a real skill key (e.g. "ANY"), falls back to skill 0.
                    const mySkillForTask = (data.skills && typeof data.skills[task.requiredRole] === "number") ? data.skills[task.requiredRole] : 0;
                    const difficultyGap = task.difficulty - mySkillForTask;
                    let difficultyWord;
                    if (difficultyGap <= 0) difficultyWord = "an easy";
                    else if (difficultyGap <= 10) difficultyWord = "a difficult";
                    else if (difficultyGap <= 20) difficultyWord = "a really hard";
                    else difficultyWord = "a near impossible";
                    const difficultySentence = 'This is going to be ' + difficultyWord + ' task for you ' + task.difficulty + '.';

                    html += '<div class="task-block">';
                    html += '<div class="task-header">' + (i + 1) + ': ' + escapeHtml(humanize(task.taskKey).toUpperCase()) + '</div>';
                    if (task.taskDescription) {
                        html += '<div class="items-text">' + escapeHtml(task.taskDescription) + '</div>';
                    }
                    html += '<div class="items-text">' + escapeHtml(difficultySentence) + '</div>';
                    html += '<div class="task-row"><span>SKILL: ' + escapeHtml(task.requiredRole) + '</span><span id="crew-count-' + i + '">CREW: ' + crewLabel + '</span></div>';

                    let itemCell = '';
                    if (task.requiredItem) {
                        const verb = task.makeOrBreak ? 'MUST HAVE ' : 'NEEDS ';
                        const reqColorClass = task.requiredItemReusable ? 'item-reusable' : 'item-single-use';
                        const reqItemLabel = escapeHtml(humanize(task.requiredItem));
                        itemCell = verb + '<span class="' + reqColorClass + '">' + reqItemLabel + '</span>';
                        if (task.requiredItemFilledByMe) {
                            const removeTooltip = 'You added your ' + escapeHtml(task.requiredItemFilledTier || '') + ' ' + reqItemLabel;
                            itemCell += ' <button class="panel-inline-button" id="takeitem-task-' + i + '" data-task="' + escapeHtml(task.taskKey) + '" title="' + removeTooltip + '">Remove</button>';
                        } else if (task.requiredCanReplace) {
                            const replaceTooltip = 'You can upgrade this ' + escapeHtml(task.requiredItemFilledTier || '') + ' ' + reqItemLabel + ' to your ' + escapeHtml(task.requiredItemBestOwnedTier || '') + ' item';
                            itemCell += ' <button class="panel-inline-button" id="useitem-task-' + i + '" title="' + replaceTooltip + '">Replace</button>';
                        } else if (task.requiredItemFilled) {
                            itemCell += ' (filled)';
                        } else if (task.requiredItemOwned) {
                            const useTooltip = 'You can add your ' + escapeHtml(task.requiredItemBestOwnedTier || '') + ' ' + reqItemLabel;
                            itemCell += ' <button class="panel-inline-button" id="useitem-task-' + i + '" title="' + useTooltip + '">Use</button>';
                        } else {
                            itemCell += ' (you don\'t have one)';
                        }
                    }
                    if (itemCell) html += '<div class="task-row" style="justify-content:center;">' + itemCell + '</div>';

                    // Optional (bonus-eligible) items - only ever shows items the PLAYER actually
                    // owns that would qualify for this task's single bonus slot (matching
                    // bonusRoles against the task's role, same rule Use Item itself applies) -
                    // replaces the separate "Commit an Item" section entirely, since this is a
                    // more direct way to see and act on the same thing per task.
                    (task.optionalItems || []).forEach(function (opt, oi) {
                        const optColorClass = opt.reusable ? 'item-reusable' : 'item-single-use';
                        const optItemLabel = escapeHtml(humanize(opt.baseItemName));
                        let optCell = 'OPTIONAL <span class="' + optColorClass + '">' + optItemLabel + '</span>';
                        if (opt.filledByMe) {
                            const removeTooltip = 'You added your ' + escapeHtml(opt.tier || '') + ' ' + optItemLabel;
                            optCell += ' <button class="panel-inline-button" id="takeoptional-' + i + '-' + oi + '" title="' + removeTooltip + '">Remove</button>';
                        } else if (opt.wouldReplace) {
                            const replaceTooltip = 'You can upgrade this ' + escapeHtml(opt.replacingTier || '') + ' ' + optItemLabel + ' to your ' + escapeHtml(opt.tier || '') + ' item';
                            optCell += ' <button class="panel-inline-button" id="useoptional-' + i + '-' + oi + '" title="' + replaceTooltip + '">Replace</button>';
                        } else {
                            const useTooltip = 'You can add your ' + escapeHtml(opt.tier || '') + ' ' + optItemLabel;
                            optCell += ' <button class="panel-inline-button" id="useoptional-' + i + '-' + oi + '" title="' + useTooltip + '">Use</button>';
                        }
                        html += '<div class="task-row" style="justify-content:center;">' + optCell + '</div>';
                    });

                    html += '<div class="task-join-row">';
                    if (task.isMine) {
                        delete pendingJoinTasks[task.taskKey]; // resolved - confirmed on this task now
                        html += '<button class="panel-inline-button" id="unassigntask-' + i + '">Unassign</button>';
                    } else if (task.taskFull) {
                        delete pendingJoinTasks[task.taskKey]; // resolved - full (whether by this join or someone else's)
                        html += '<span class="items-text">Full</span>';
                    } else if (pendingJoinTasks[task.taskKey]) {
                        html += '<button class="panel-inline-button" disabled>Joining...</button>';
                    } else {
                        html += '<button class="panel-inline-button" id="jointask-' + i + '" data-task="' + escapeHtml(task.taskKey) + '">Join</button>';
                    }
                    html += '</div>';
                    html += '</div>';
                });

                if (bh.requiredVehicle) {
                    const vehicleFilled = bh.getawayVehicleName && bh.getawayVehicleName.toLowerCase() === bh.requiredVehicle.toLowerCase();
                    html += '<div class="items-text">Getaway needs: ' + humanize(bh.requiredVehicle) + (vehicleFilled ? ' (filled)' : ' (MISSING - heist will be cancelled)') + '</div>';
                } else if (bh.getawayVehicleName) {
                    html += '<div class="items-text">Current getaway vehicle: ' + humanize(bh.getawayVehicleName) + '</div>';
                } else {
                    html += '<div class="items-text">No getaway vehicle committed yet - on foot without one.</div>';
                }

                if (bh.crewTogether) {
                    html += '<div class="items-text">This crew stays together on the job. <span class="item-reusable">Green</span> items can cover a task and the getaway at once, since the same item is never somewhere else. <span class="item-single-use">Yellow</span> items are still locked to wherever they\'re given.</div>';
                } else {
                    html += '<div class="items-text">This crew is split up across the job, so every item shown is <span class="item-single-use">single use</span> - once given, it\'s locked to that spot until physically taken back.</div>';
                }

                html += '<button class="panel-back-button" id="panel-bigheist-cancel">&larr; Back</button>';
                }
            }
        } else if (showRobberyPicker) {
            // Client-side only, same reasoning as Sell/Pickpocket/Lay Low - the category list
            // itself is static (defined once in ROBBERY_CATEGORIES), no server round-trip needed
            // just to browse the options.
            html += '<div class="section-title">Pick a Job</div>';
            ROBBERY_CATEGORIES.forEach(function (cat, i) {
                html += '<button class="panel-shop-button" id="robbery-category-' + i + '" data-category="' + escapeHtml(cat.key) + '">' + escapeHtml(cat.label) + '</button>';
            });
            html += '<button class="panel-back-button" id="panel-robbery-cancel">&larr; Cancel</button>';
        } else {
            html += '<div class="section-title">Skills</div>';
            const skillKeys = Object.keys(data.skills || {}).sort();
            if (skillKeys.length === 0) {
                html += '<div class="skills-text">No trained skills yet.</div>';
            } else {
                const skillParts = skillKeys.map(function (s) {
                    return '<span class="skill-name">' + humanize(s) + ':</span> <span class="skill-num">' + data.skills[s] + '</span>';
                });
                html += '<div class="skills-text">' + skillParts.join(', ') + '</div>';
            }

            html += '<div class="section-title">Items</div>';
            const itemKeys = Object.keys(data.inventory || {}).filter(function (k) { return data.inventory[k] > 0; });
            if (itemKeys.length === 0) {
                html += '<div class="items-text">Empty.</div>';
            } else {
                const itemParts = itemKeys.map(function (k) {
                    return humanizeItemKey(k) + ' x' + data.inventory[k];
                });
                html += '<div class="items-text">' + itemParts.join(', ') + '</div>';
            }

            html += '<div class="section-title">Last Crime</div>';
            html += '<div class="last-crime-box">' + (data.lastCrime ? escapeHtml(data.lastCrime) : 'No record on file.') + '</div>';

            if (data.achievements && data.achievements.length > 0) {
                html += '<div class="section-title">Achievements</div>';
                html += '<div class="achievements-row">';
                data.achievements.forEach(function (a) {
                    html += '<div class="achievement-badge">' + escapeHtml(humanize(a)) + '</div>';
                });
                html += '</div>';
            }

            html += '<div class="section-title">Mega-City One Creds</div>';
            html += '<div class="creds-text">' + (typeof data.points === "number" ? data.points.toLocaleString() : "0") + '</div>';

            html += '<div class="section-title">Heat</div>';
            const combinedHeatVal = (typeof data.personalHeat === "number" ? data.personalHeat : 0) + (typeof data.showHeat === "number" ? data.showHeat : 0);
            html += '<div class="creds-text">' + combinedHeatVal + '</div>';

            // Shop button hidden entirely while banned (server-tracked via shopBannedUntil for
            // heat rejections, or offendedBannedUntil for a failed haggle - both use the same
            // random 1-20 minute cooldown mechanic, just different trigger/flavor) - per user's
            // request, this stops spam-clicking from just re-rolling past a rejection immediately.
            const nowSecondsForBan = Math.floor(Date.now() / 1000);
            const effectiveBanUntil = Math.max(data.shopBannedUntil || 0, data.offendedBannedUntil || 0);
            const shopBanned = effectiveBanUntil > nowSecondsForBan;

            // Neither Juan's Emporium nor Pickpocket make sense while actually serving time in
            // the cubes - hide both entirely rather than showing them and letting a click either
            // silently fail or (worse) queue an action that has to be rejected server-side. Uses
            // the same stillJailed check already computed above for the status badge/countdown,
            // so this stays in sync with whatever that's currently showing.
            const isLayingLow = !!data.isLayingLow;
            const personalHeatForShopMsg = typeof data.personalHeat === "number" ? data.personalHeat : 0;
            if (stillJailed) {
                html += '<div class="panel-override-expiry">Can\'t do that from the cubes.</div>';
            } else if (isLayingLow) {
                html += personalHeatForShopMsg <= 0
                    ? '<div class="panel-override-expiry">Heat\'s clear - hit Lay Low below to head back out and visit Juan\'s again.</div>'
                    : '<div class="panel-override-expiry">You\'re laying low - being anywhere near Juan\'s is the last thing you want right now.</div>';
            } else if (shopBanned) {
                html += '<div class="panel-override-expiry">Juan doesn\'t want to see you right now. Try again later.</div>';
                // Test-mode only: shows exactly how long is left on the current ban (regardless
                // of which reason triggered it) and a way to bypass it entirely, since waiting
                // out a real 1-20 minute cooldown isn't practical while actively testing.
                if (data.isTestAccount) {
                    const secondsLeft = effectiveBanUntil - nowSecondsForBan;
                    const minsLeft = Math.floor(secondsLeft / 60);
                    const secsLeft = secondsLeft % 60;
                    html += '<div class="panel-override-expiry">[Test mode] ' + minsLeft + 'm ' + secsLeft + 's until Juan\'s reopens naturally.</div>';
                    html += '<button class="panel-back-button" id="panel-force-open-button">[Test] Force Open Juan\'s</button>';
                }
            } else {
                html += '<button class="panel-shop-button" id="panel-shop-button">Visit Juan\'s Emporium</button>';
            }
            if (!stillJailed && !isLayingLow) {
                html += '<button class="panel-shop-button" id="panel-pickpocket-button">Pickpocket Someone</button>';
                const robberyLeft = typeof data.robberyAttemptsRemaining === "number" ? data.robberyAttemptsRemaining : 999;
                if (robberyLeft > 0) {
                    html += '<button class="panel-shop-button" id="panel-robbery-button">Rob Somewhere</button>';
                } else {
                    html += '<div class="panel-override-expiry">You\'ve pushed your luck enough for one stream - no robberies left tonight.</div>';
                }
            }
            if (!stillJailed) {
                // Always available (not gated on owning an item, and not hidden while laying low
                // itself - that's exactly where you'd go to turn it back off again). Burning an
                // item for a bigger hit is a secondary option inside the same view, shown only if
                // they actually own one.
                html += '<button class="panel-shop-button" id="panel-laylow-button">Lay Low</button>';

                // Assumption flagged: Big Heist participation is NOT blocked by laying low (only
                // jail blocks it) - unlike Shop/Robbery/Pickpocket, joining a heist crew didn't
                // seem like the same category of "drawing attention" activity, but easy to add
                // that gate too if it should behave the same way as the others.
                //
                // Only shown when there's actually an active heist - if one's been selected but
                // the countdown ran and finished it out (or nothing's been picked yet), there's
                // nothing to click into, so showing a dead-end button here would just be
                // confusing rather than useful.
                if (data.bigHeist) {
                    html += '<button class="panel-shop-button" id="panel-bigheist-button">The Big Heist</button>';
                }
            }
        }

        // Toast-style notice (great/good roll outcomes, insufficient-funds) - checked client-side
        // for expiry same as panelOverride, prepended regardless of which view is currently
        // showing since it's about something that just happened to the player, not tied to
        // whatever section they happen to be looking at.
        if (data.pickpocketNotice && data.pickpocketNotice.message
            && (!data.pickpocketNotice.expiresAt || data.pickpocketNotice.expiresAt > Math.floor(Date.now() / 1000))) {
            html = '<div class="juan-quote">' + escapeHtml(data.pickpocketNotice.message) + '</div>' + html;
        }

        document.getElementById("rest-of-content").innerHTML = html;

        // Bound programmatically rather than via inline onclick attributes, since Twitch's CSP
        // blocks inline event handlers the same way it blocks inline <script> (same restriction
        // already worked around for the mugshot's error handler elsewhere in this file).
        const backButton = document.getElementById("panel-back-button");
        if (backButton) {
            backButton.addEventListener("click", function () {
                // Also resets the client-side toggles, not just the server override - without
                // this, clicking Back after a heatDenied rejection (which happens ON TOP OF the
                // client-side shop view that was already open) would clear the rejection but
                // fall right back into showShopBrowser, since nothing had ever set it back to
                // false. That's the real bug behind "clicked Back, shop button was still there,
                // clicked it, ended up back in the shop that just rejected me."
                showShopBrowser = false;
                showPickpocketPicker = false;
                queueAction("clearOverride", {});
            });
        }

        const robberyResultBack = document.getElementById("panel-robbery-result-back");
        if (robberyResultBack) {
            robberyResultBack.addEventListener("click", function () {
                // Sets the dismissed flag (hides the cinematic immediately via re-render below) -
                // deliberately does NOT touch robberyCinematicKey/Stage/Data. Clearing those was
                // the actual bug: clearOverride takes a few seconds to land server-side, and with
                // the fingerprint wiped, the next poll (still showing the SAME not-yet-cleared
                // override) looked like a brand new result and replayed the whole cinematic again
                // - even though nothing was actually re-rolled. A genuinely new future robbery
                // will always have its own fresh expiresAt regardless of whatever this is left at.
                robberyResultDismissed = true;
                queueAction("clearOverride", {});
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const oiButton = document.getElementById("panel-oi-button");
        if (oiButton) {
            oiButton.addEventListener("click", function () {
                // Disabled immediately - a rapid double-click could otherwise queue this twice
                // before the panel gets a chance to revert away from this view.
                oiButton.disabled = true;
                queueAction("oiResponse", {});
                queueAction("clearOverride", {});
            });
        }

        const arrestButton = document.getElementById("panel-arrest-button");
        if (arrestButton) {
            arrestButton.addEventListener("click", function () {
                // Same double-click protection as the Oi button above - this is what caused the
                // real "arrested twice" bug reported.
                arrestButton.disabled = true;
                const ov = data.panelOverride || {};
                queueAction("confirmArrest", { perpId: ov.perpId || "", perpName: ov.perpName || "", severity: ov.severity || "minor" });
                queueAction("clearOverride", {});
            });
        }

        const forceOpenButton = document.getElementById("panel-force-open-button");
        if (forceOpenButton) {
            forceOpenButton.addEventListener("click", function () {
                // Per user's report: opening the shop instantly while the ban clear only
                // happened server-side (a few seconds later via the queue) left a real gap -
                // anything checking the cached ban fields in that window still saw the old,
                // still-banned values. Clearing them here too, on the cached data itself, means
                // opening the shop and removing the ban both take effect at the same instant,
                // not just the visual "shop is showing" part.
                if (lastFetchedData) {
                    lastFetchedData.shopBannedUntil = 0;
                    lastFetchedData.offendedBannedUntil = 0;
                }
                showShopBrowser = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
                queueAction("forceOpenShop", {});
            });
        }

        const shopButton = document.getElementById("panel-shop-button");
        if (shopButton) {
            shopButton.addEventListener("click", function () {
                // CHANGED per user report: this used to open the shop instantly and only reject a
                // few seconds later via panelOverride once the background heat roll came back -
                // "shop flashes open, then Juan turns you away" read as confusing/broken rather
                // than cinematic. Now the check gates entry: show a brief "walking in" state,
                // fire the heat roll, and only open the shop (or show the rejection) once the
                // server's actually answered - see the shopEntryPending resolution block above.
                shopEntryPending = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);

                queueAction("checkShopHeat", {}).then(function (ok) {
                    if (!ok) {
                        // Request never actually reached the server - don't leave them stuck on
                        // "walking in" forever waiting for an answer that was never queued.
                        shopEntryPending = false;
                        showQueueFailure();
                    }
                });

                // Safety net - if the roll result never actually lands (a queued action that
                // silently never got picked up, an unusually slow poll cycle), don't leave the
                // player stuck on "walking in" indefinitely. Fails OPEN (shows the shop) rather
                // than stuck, since that's the rarer edge case, not the common path.
                setTimeout(function () {
                    if (shopEntryPending) {
                        shopEntryPending = false;
                        showShopBrowser = true;
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    }
                }, 10000);
            });
        }

        const shopCancel = document.getElementById("panel-shop-cancel");
        if (shopCancel) {
            shopCancel.addEventListener("click", function () {
                showShopBrowser = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        // Present in both the client-side shop view and the server-driven !shop override, since
        // buildShopHtml is shared between them - transitions from browsing into the finder
        // search page.
        const finderButton = document.getElementById("panel-finder-button");
        if (finderButton) {
            finderButton.addEventListener("click", function () {
                showShopBrowser = false;
                showFinderPage = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const finderCancel = document.getElementById("panel-finder-cancel");
        if (finderCancel) {
            finderCancel.addEventListener("click", function () {
                showFinderPage = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const finderSearchButton = document.getElementById("finder-search-button");
        if (finderSearchButton) {
            finderSearchButton.addEventListener("click", function () {
                const input = document.getElementById("finder-search-input");
                const itemName = input ? input.value.trim() : "";
                if (!itemName) return;
                finderSearchButton.disabled = true;
                queueAction("finderSearch", { itemName: itemName });
            });
        }

        const haggleOfferButton = document.getElementById("haggle-offer-button");
        if (haggleOfferButton) {
            haggleOfferButton.addEventListener("click", function () {
                const input = document.getElementById("haggle-offer-input");
                const amount = input ? input.value.trim() : "";
                if (!amount) return;
                // Disabled immediately - same double-submit protection as the Oi/Arrest buttons.
                haggleOfferButton.disabled = true;
                // Optimistically reset here rather than waiting for the server's response -
                // the next state is always either back to normal (a successful/declined haggle
                // just clears the override) or offendedDenied (a failed one), never back to the
                // search step, so there's nothing to gain by keeping this true any longer.
                showFinderPage = false;
                queueAction("haggleOffer", { amount: amount });
            });
        }

        if (showShopBrowser) {
            const shopItemsForClick = data.shopListing || [];
            shopItemsForClick.forEach(function (item, i) {
                const row = document.getElementById("shop-buy-" + i);
                if (row) {
                    row.addEventListener("click", function () {
                        queueAction("buyItem", { itemName: item.name }).then(function (ok) {
                            if (ok) {
                                showPurchaseConfirmation(item.name, item.price, false);
                            } else {
                                showQueueFailure();
                            }
                        });
                    });
                }
            });
        }

        const pickpocketButton = document.getElementById("panel-pickpocket-button");
        if (pickpocketButton) {
            pickpocketButton.addEventListener("click", function () {
                showPickpocketPicker = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const sellButton = document.getElementById("panel-sell-button");
        if (sellButton) {
            sellButton.addEventListener("click", function () {
                // Lives inside Juan's shop page now (not a standalone top-level button), so it
                // inherits all the same access rules the shop already enforces - heat ban hides
                // the whole page before this button is ever reachable, and Sell Item itself now
                // re-checks the ban directly too. Same transition pattern as the Finder button.
                showShopBrowser = false;
                showSellBrowser = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const sellCancel = document.getElementById("panel-sell-cancel");
        if (sellCancel) {
            sellCancel.addEventListener("click", function () {
                showSellBrowser = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        if (showSellBrowser) {
            const sellKeysForClick = Object.keys(data.inventory || {}).filter(function (k) { return data.inventory[k] > 0; });
            sellKeysForClick.forEach(function (fullKey, i) {
                const row = document.getElementById("sell-item-" + i);
                if (row) {
                    row.addEventListener("click", function () {
                        // Sends the EXACT inventory key (including tier, e.g. "Lockpick
                        // (Quality)") - Sell Item now matches this exactly rather than falling
                        // back to its lowest-tier-first chat behavior, so clicking a specific row
                        // sells precisely that row, not just "some copy of this item."
                        queueAction("sellItem", { itemName: fullKey }).then(function (ok) {
                            if (ok) {
                                showSellConfirmation(fullKey);
                            } else {
                                showQueueFailure();
                            }
                        });
                    });
                }
            });
        }

        const layLowButton = document.getElementById("panel-laylow-button");
        if (layLowButton) {
            layLowButton.addEventListener("click", function () {
                // Standalone button on the normal sheet, not inside the shop page (unlike Sell) -
                // this is about the player's own gear, not a Juan's Emporium interaction, so it
                // isn't gated by shop bans/heat checks.
                showLayLowBrowser = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const layLowCancel = document.getElementById("panel-laylow-cancel");
        if (layLowCancel) {
            layLowCancel.addEventListener("click", function () {
                showLayLowBrowser = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const layLowToggle = document.getElementById("panel-laylow-toggle");
        if (layLowToggle) {
            layLowToggle.addEventListener("click", function () {
                const wasLayingLow = !!data.isLayingLow;
                queueAction("toggleLayLow", {}).then(function (ok) {
                    if (ok) {
                        showLayLowToggleConfirmation(wasLayingLow
                            ? "You're back in the game."
                            : "You keep your head down. No jobs, no shopping - just staying out of sight for a while.");
                    } else {
                        showQueueFailure();
                    }
                });
            });
        }

        const bigHeistButton = document.getElementById("panel-bigheist-button");
        if (bigHeistButton) {
            bigHeistButton.addEventListener("click", function () {
                showBigHeistView = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const bigHeistCancel = document.getElementById("panel-bigheist-cancel");
        if (bigHeistCancel) {
            bigHeistCancel.addEventListener("click", function () {
                showBigHeistView = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const joinCrewButton = document.getElementById("panel-joincrew-button");
        if (joinCrewButton) {
            joinCrewButton.addEventListener("click", function () {
                joinCrewButton.disabled = true;
                queueAction("joinCrew", {});
            });
        }

        const quitCrewButton = document.getElementById("panel-quitcrew-button");
        if (quitCrewButton) {
            quitCrewButton.addEventListener("click", function () {
                quitCrewButton.disabled = true;
                queueAction("quitCrew", {});
            });
        }

        if (showBigHeistView) {
            const bh = data.bigHeist;
            if (bh) {
                (bh.tasks || []).forEach(function (task, i) {
                    const joinBtn = document.getElementById("jointask-" + i);
                    if (joinBtn) {
                        joinBtn.addEventListener("click", function () {
                            // Optimistic feedback for the split-second before any re-render -
                            // pendingJoinTasks below is what actually prevents the duplicate-join
                            // bug (a re-render replacing this exact button before confirmation
                            // arrives), since a freshly-built button wouldn't inherit this
                            // disabled state otherwise.
                            joinBtn.disabled = true;
                            joinBtn.textContent = "Remove";
                            const crewSpan = document.getElementById("crew-count-" + i);
                            if (crewSpan && task.crewNeeded !== -1) {
                                crewSpan.textContent = "CREW: " + (task.crewFilled + 1) + "/" + task.crewNeeded;
                            } else if (crewSpan) {
                                crewSpan.textContent = "CREW: " + (task.crewFilled + 1) + "/open";
                            }

                            pendingJoinTasks[task.taskKey] = true;
                            // Safety net - if the task somehow never resolves to isMine/full (e.g.
                            // rejected for an unrelated reason with the crew count unchanged),
                            // don't leave the button stuck disabled forever.
                            const safetyTimeout = setTimeout(function () {
                                delete pendingJoinTasks[task.taskKey];
                                if (lastFetchedData) renderPerpSheet(lastFetchedData);
                            }, 20000);

                            queueAction("joinTask", { taskKey: task.taskKey }).then(function (ok) {
                                // If the request itself never actually reached the server (a
                                // network blip, Render being slow to wake up, etc.), don't leave
                                // this silently waiting out the full 20s safety net for a revert
                                // that never gets explained - fail fast and say so, so a genuine
                                // connectivity issue doesn't look identical to some other bug.
                                if (!ok) {
                                    clearTimeout(safetyTimeout);
                                    delete pendingJoinTasks[task.taskKey];
                                    showQueueFailure();
                                }
                            });
                        });
                    }
                    const unassignBtn = document.getElementById("unassigntask-" + i);
                    if (unassignBtn) {
                        unassignBtn.addEventListener("click", function () {
                            unassignBtn.disabled = true;
                            queueAction("unassignTask", { taskKey: task.taskKey });
                        });
                    }
                    const useItemBtn = document.getElementById("useitem-task-" + i);
                    if (useItemBtn) {
                        useItemBtn.addEventListener("click", function () {
                            // Commits whatever matching item the player owns straight to this
                            // task's required-item slot - Use Item resolves the best tier they
                            // own automatically, same as the general item-commit section below.
                            // Available regardless of which task (if any) THIS player is
                            // personally assigned to - items are a shared crew resource, not
                            // locked to only your own task.
                            useItemBtn.disabled = true;
                            queueAction("useItem", { itemForDestination: task.requiredItem + " for " + task.taskKey });
                        });
                    }
                    const takeItemBtn = document.getElementById("takeitem-task-" + i);
                    if (takeItemBtn) {
                        takeItemBtn.addEventListener("click", function () {
                            takeItemBtn.disabled = true;
                            queueAction("takeItem", { taskKey: task.taskKey, slotType: "required" });
                        });
                    }

                    (task.optionalItems || []).forEach(function (opt, oi) {
                        const useOptBtn = document.getElementById("useoptional-" + i + "-" + oi);
                        if (useOptBtn) {
                            useOptBtn.addEventListener("click", function () {
                                useOptBtn.disabled = true;
                                queueAction("useItem", { itemForDestination: opt.baseItemName + " for " + task.taskKey });
                            });
                        }
                        const takeOptBtn = document.getElementById("takeoptional-" + i + "-" + oi);
                        if (takeOptBtn) {
                            takeOptBtn.addEventListener("click", function () {
                                takeOptBtn.disabled = true;
                                queueAction("takeItem", { taskKey: task.taskKey, slotType: "bonus" });
                            });
                        }
                    });
                });
            }
        }


        const robberyButton = document.getElementById("panel-robbery-button");
        if (robberyButton) {
            robberyButton.addEventListener("click", function () {
                showRobberyPicker = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const robberyCancel = document.getElementById("panel-robbery-cancel");
        if (robberyCancel) {
            robberyCancel.addEventListener("click", function () {
                showRobberyPicker = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        if (showRobberyPicker) {
            ROBBERY_CATEGORIES.forEach(function (cat, i) {
                const row = document.getElementById("robbery-category-" + i);
                if (row) {
                    row.addEventListener("click", function () {
                        // Disabled immediately - without this, a rapid double-click (or an
                        // accidental double-tap on a touchscreen, very plausible for how most
                        // viewers actually use this panel) could queue the same robbery attempt
                        // twice before the picker view disappears. Same fix already applied to
                        // the OI and Arrest buttons for the identical bug class - this one was
                        // just missed when Robbery was first built.
                        row.disabled = true;
                        queueAction("robberyCategory", { category: cat.key });
                        showRobberyPicker = false;
                        // Show the transitional "job underway" screen immediately, rather than
                        // falling back to the normal character sheet for the few seconds it takes
                        // Process Panel Actions to actually pick this up and compute the real
                        // result - that gap is exactly what caused the reported "flashes back to
                        // the sheet, then teleports into the cinematic" hiccup.
                        robberyPending = true;
                        robberyPendingCategory = cat;
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    });
                }
            });
        }

        if (showLayLowBrowser) {
            const heatItemsForClick = data.heatReducingItems || {};
            const heatKeysForClick = Object.keys(heatItemsForClick);
            heatKeysForClick.forEach(function (fullKey, i) {
                const row = document.getElementById("laylow-item-" + i);
                if (row) {
                    row.addEventListener("click", function () {
                        const reduction = heatItemsForClick[fullKey];
                        queueAction("reduceHeat", { itemName: fullKey }).then(function (ok) {
                            if (ok) {
                                showLayLowConfirmation(fullKey, reduction);
                            } else {
                                showQueueFailure();
                            }
                        });
                    });
                }
            });
        }

        const pickpocketCancel = document.getElementById("panel-pickpocket-cancel");
        if (pickpocketCancel) {
            pickpocketCancel.addEventListener("click", function () {
                showPickpocketPicker = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        if (showPickpocketPicker) {
            const viewersForClick = getPickpocketCandidates(data);
            viewersForClick.forEach(function (v, i) {
                const targetButton = document.getElementById("pickpocket-target-" + i);
                if (targetButton) {
                    targetButton.addEventListener("click", function () {
                        queueAction("pickpocketTarget", { targetId: v.userId });
                        showPickpocketPicker = false;
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    });
                }
            });
        }

        if (overrideMode === "shop") {
            const shopItemsForClick = (data.panelOverride && data.panelOverride.items) || [];
            shopItemsForClick.forEach(function (item, i) {
                const row = document.getElementById("shop-buy-" + i);
                if (row) {
                    row.addEventListener("click", function () {
                        queueAction("buyItem", { itemName: item.name }).then(function (ok) {
                            if (ok) {
                                showPurchaseConfirmation(item.name, item.price, true);
                            } else {
                                showQueueFailure();
                            }
                        });
                    });
                }
            });
        }
    }

    // Keeps re-fetching a candidate image periodically until its hash matches the ground-truth
    // hash from Become Perp (see loadCandidateImage below) - a bare 200 OK is NOT proof of
    // correctness, since GitHub Pages' CDN can serve a stale-but-successful response with old
    // bytes for a while after a real upload/delete. Uses fetch()+blob with cache: "no-store"
    // rather than a plain <img src>, so the raw bytes are available to hash and so the browser's
    // own local HTTP cache is also ruled out as a contributor.
    const CANDIDATE_REFRESH_INTERVAL_MS = 5000;
    const CANDIDATE_REFRESH_MAX_ATTEMPTS = 12; // ~60s of periodic refreshing after the initial wait
    // Short wait before the FIRST load attempt, just long enough to let Become Perp's
    // delete-then-upload sequence get underway - not load-bearing for correctness (the hash
    // check is what actually guarantees that), just avoids a guaranteed-wasted first attempt.
    const CANDIDATE_INITIAL_WAIT_MS = 3000;

    // Computes a SHA-256 hex digest of a Blob's contents, for comparing against the ground-truth
    // hash Become Perp computed at upload time.
    async function hashBlob(blob) {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }

    async function loadCandidateImage(candidateIndex, attempt) {
        const frame = document.getElementById("candidate-frame-" + candidateIndex);
        if (!frame || !currentUserId) return; // panel moved on (no longer pending) - stop refreshing

        const img = document.getElementById("candidate-img-" + candidateIndex);
        if (!img) return;

        const url = MUGSHOT_BASE_URL + "/" + currentUserId + "-candidate" + candidateIndex + ".png?cb=" + Date.now();
        const expectedHash = currentCandidateHashes[candidateIndex - 1];

        let verified = false;

        try {
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
                const blob = await response.blob();

                // A 200 OK alone isn't proof of correctness - GitHub Pages' CDN can serve a
                // stale-but-successful response for a while after a real upload/delete. Verify
                // against the ground-truth hash Become Perp computed at upload time; only treat
                // this as genuinely ready if they match.
                verified = expectedHash ? (await hashBlob(blob)) === expectedHash : true;

                if (verified && document.getElementById("candidate-frame-" + candidateIndex)) {
                    const previousObjectUrl = img.dataset.objectUrl;
                    const objectUrl = URL.createObjectURL(blob);
                    img.src = objectUrl;
                    img.dataset.objectUrl = objectUrl;
                    if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
                    img.style.display = "";

                    const status = document.getElementById("candidate-status-" + candidateIndex);
                    if (status) status.remove();
                }
            }
        } catch (err) {
            // Network/HTTP failure this cycle - leave "Preparing..." showing, the loop below
            // will just try again next cycle regardless.
        }

        if (!verified && attempt < CANDIDATE_REFRESH_MAX_ATTEMPTS && document.getElementById("candidate-frame-" + candidateIndex)) {
            setTimeout(function () { loadCandidateImage(candidateIndex, attempt + 1); }, CANDIDATE_REFRESH_INTERVAL_MS);
        }
    }

    // Same hash-verification approach as loadCandidateImage above, but for the single final
    // mugshot. currentMugshotHash empty (e.g. a perp who picked before this feature existed, so
    // Pick Mugshot never computed one) falls back to trusting a successful fetch, same as the
    // candidate version.
    async function loadFinalMugshotImage(version, attempt) {
        const img = document.getElementById("mugshot-img");
        if (!img || !currentUserId) return;

        const url = MUGSHOT_BASE_URL + "/" + currentUserId + ".png?v=" + version + "&cb=" + Date.now();
        const expectedHash = currentMugshotHash;

        let verified = false;

        try {
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
                const blob = await response.blob();
                verified = expectedHash ? (await hashBlob(blob)) === expectedHash : true;

                if (verified && document.getElementById("mugshot-img")) {
                    const previousObjectUrl = img.dataset.objectUrl;
                    const objectUrl = URL.createObjectURL(blob);
                    img.src = objectUrl;
                    img.dataset.objectUrl = objectUrl;
                    if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
                    img.style.display = "";

                    const status = document.getElementById("mugshot-status");
                    if (status) status.remove();
                }
            }
        } catch (err) {
            // Network/HTTP failure this cycle - leave the loading state showing, retried below
        }

        if (!verified) {
            if (attempt < CANDIDATE_REFRESH_MAX_ATTEMPTS && document.getElementById("mugshot-img")) {
                setTimeout(function () { loadFinalMugshotImage(version, attempt + 1); }, CANDIDATE_REFRESH_INTERVAL_MS);
            } else {
                const frame = document.getElementById("mugshot-frame");
                if (frame) frame.innerHTML = '<div class="mugshot-placeholder">No Photo</div>';
            }
        }
    }

    // Ticks the ISOCUBE countdown badge once per second, computed purely client-side from the
    // release timestamp - no need to re-fetch from the backend just to update a number. Looks the
    // badge up fresh by ID every call rather than caching a reference, since renderPerpSheet
    // rebuilds this element's HTML on every 15s poll.
    function updateCountdownBadge(releaseAt) {
        const badge = document.getElementById("cube-countdown-badge");
        if (!badge) {
            // The badge is gone (e.g. the next poll already confirmed release and re-rendered as
            // CITIZEN) - stop ticking, nothing left to update.
            if (countdownIntervalId) {
                clearInterval(countdownIntervalId);
                countdownIntervalId = null;
            }
            return;
        }

        const secondsLeft = releaseAt - Math.floor(Date.now() / 1000);
        if (secondsLeft <= 0) {
            // Client-side clock says time's up, but the server hasn't confirmed it yet (that only
            // happens on the next 15s poll) - show a holding message rather than guessing CITIZEN.
            badge.textContent = "RELEASE PENDING...";
            if (countdownIntervalId) {
                clearInterval(countdownIntervalId);
                countdownIntervalId = null;
            }
            return;
        }

        const minutes = Math.floor(secondsLeft / 60);
        const seconds = secondsLeft % 60;
        badge.textContent = "ISOCUBE - " + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }

    // Ticks the 3 separate H/M/S digits overlaid on the isocube artwork, same cadence and same
    // release timestamp as updateCountdownBadge above (called from the same interval tick) - a
    // simple no-op if those elements aren't currently on screen (e.g. showing the pending-pick
    // or normal mugshot view instead). Doesn't touch countdownIntervalId itself - that's handled
    // by updateCountdownBadge, which always runs alongside this in the same tick.
    function updateIsoCubeDigits(releaseAt) {
        const hoursEl = document.getElementById("isocube-hours");
        const minutesEl = document.getElementById("isocube-minutes");
        const secondsEl = document.getElementById("isocube-seconds");
        if (!hoursEl || !minutesEl || !secondsEl) return;

        const secondsLeft = releaseAt - Math.floor(Date.now() / 1000);
        if (secondsLeft <= 0) {
            hoursEl.textContent = "00";
            minutesEl.textContent = "00";
            secondsEl.textContent = "00";
            return;
        }

        const hours = Math.floor(secondsLeft / 3600);
        const minutes = Math.floor((secondsLeft % 3600) / 60);
        const seconds = secondsLeft % 60;

        hoursEl.textContent = String(hours).padStart(2, "0");
        minutesEl.textContent = String(minutes).padStart(2, "0");
        secondsEl.textContent = String(seconds).padStart(2, "0");
    }

    function humanize(s) {
        if (!s) return s;
        return s.charAt(0).toUpperCase() + s.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    function humanizeItemKey(fullKey) {
        const parenIndex = fullKey.indexOf(" (");
        if (parenIndex > 0) {
            return humanize(fullKey.substring(0, parenIndex)) + fullKey.substring(parenIndex);
        }
        return humanize(fullKey);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
