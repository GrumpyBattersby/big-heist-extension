    // VERSION MARKER - if you open the browser console (F12) and DON'T see this exact line, the
    // panel being served is NOT this build - meaning Twitch's Asset Hosting is still serving an
    // older cached version regardless of re-uploading. This is the simplest way to check that,
    // much easier than digging through the Network tab.
    console.log("BIG HEIST PANEL BUILD: 2026-08-16-glossary-how-to-use");

    // INSTANT CLICK FEEDBACK (added 2026-08-24, per user request - "there's often a delay til the
    // panel updates... change the button at the time of clicking so they know they've clicked.
    // Some buttons have this eg read details but not all do for example the back buttons").
    //
    // Every server-bound button in this panel (results, back buttons, shop buttons, browse
    // letters, flag/vote buttons, etc) lives inside #content, whose innerHTML gets wholesale
    // replaced by every render*() function in this file - a small handful of buttons (the M.A.C.
    // read buttons, mostly) already hand-rolled their own instant feedback by re-rendering
    // locally from cached data before the poll catches up, but most just sat there doing nothing
    // visible until the next poll/action response came back, which is what read as "did that even
    // register?" during the round-trip delay.
    //
    // Rather than hand-add bespoke feedback to every individual button (dozens of them, scattered
    // across many render functions), one delegated click listener on #content dims + disables
    // WHICHEVER button was just clicked, immediately, before anything else runs. The dimmed state
    // needs no manual cleanup: because it's scoped to #content specifically (not the whole
    // document), and because #content's innerHTML is replaced wholesale on essentially every
    // click's resulting render, the old (dimmed) button element is simply discarded the moment
    // fresh content arrives - same lifecycle the existing "voted"/"queued" instant-feedback states
    // already rely on. Deliberately does NOT cover the persistent bottom buttons (Item Glossary,
    // Achievements) or their overlay close buttons - those live OUTSIDE #content specifically so
    // they survive re-renders, and toggling them doesn't hit the network at all, so there's no
    // round-trip delay to mask and disabling them would leave them stuck (nothing ever replaces
    // that specific button to clear the disabled state).
    document.addEventListener("DOMContentLoaded", function () {
        const contentEl = document.getElementById("content");
        if (!contentEl) return;
        contentEl.addEventListener("click", function (e) {
            const btn = e.target.closest("button");
            if (!btn || btn.disabled) return;
            btn.classList.add("panel-button-pressed");
            btn.disabled = true;
        }, true);
    });

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
    // Static UI chrome (Judge alert icon, pickpocket alert, Juan's shop/closed/finders-fee
    // portraits, the ISOCUBE background) - same GitHub Pages hosting as items/mugshots/getaways.
    // These used to be referenced as bare filenames (e.g. "juan-shop.png"), which only resolves if
    // that file sits right next to panel.html wherever it's actually served from - it never did,
    // so all six of these were silently broken images. Hosting them here instead means they also
    // survive every future panel.zip rebuild without needing to be bundled in by hand.
    const UI_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/ui";
    // Robbery category art (bank/hardware/tech/etc backdrop shown during the robbery cinematic) -
    // same GitHub Pages hosting as everything above. Also used to be bare filenames
    // ("robbery-bank.png" etc) that never resolved to anything, same broken-image bug as the six
    // UI chrome images just fixed - they'd never actually been hosted anywhere the panel could see.
    const ROBBERY_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/robberies";
    // Judge character portraits ("<name> Panel Image.png") for the dedicated Judge Home Screen -
    // same GitHub Pages hosting pattern as everything above. Filenames match the short name half
    // of assignedJudgeName exactly (e.g. "Judge Kee" -> "Kee Panel Image.png").
    const JUDGES_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/judges";
    // Perp/crew character portraits - same idea as JUDGES_BASE_URL, for the criminal side of the
    // RPG (Quin, Flink). Filenames match assignedPerpName exactly (e.g. "Quin" -> "Quin Panel
    // Image.png"). Folder deliberately NOT named "perps" - that already means something else
    // (per-userId arrest cube mugshots) elsewhere in this codebase.
    const PERPS_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/crew-characters";
    // Big Heist banner art (one per heistKey) and crew logos - same GitHub Pages hosting pattern
    // as everything above. These were ALSO still bare filenames (e.g. "heist-highsociety.png",
    // "ferocious-flapjack.png") with no base URL prefix - the exact same broken-image bug already
    // fixed for UI_BASE_URL/ROBBERY_BASE_URL above, just never caught here since nobody had
    // reached the Big Heist screen with a live heist/crew until now. NOTE: as of this fix, no
    // actual banner/logo image files exist yet in these folders on GitHub Pages - the HTML now
    // resolves to a real, well-formed URL instead of a broken relative path, but every one of
    // them will still 404 (broken image icon) until real art is uploaded per heist/crew name.
    const HEISTS_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/heists";
    const CREWS_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/crews";
    // Team event poster art for the Sector 21 offline advert screen - one per SHOW_SCHEDULE team
    // color (Red/Gold/Green), sourced from the streamer's "Discord Ep Events" posters. Same
    // GitHub Pages hosting pattern as everything above. Filenames are exactly "<Color> Team Event
    // Poster.png" as uploaded, e.g. "Red Team Event Poster.png".
    const TEAM_POSTERS_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/team-posters";
    // Block War team art ("Wagner Block.png" / "Ezquerra Block.png") - shown in the panel takeover
    // once a viewer's been assigned to a block. Same GitHub Pages hosting pattern as everything
    // above, in a new "blockwar" folder.
    const BLOCKWAR_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/blockwar";
    // M.A.C. record-detail mini images (added 2026-08-23) - square-cropped thumbnails generated
    // from the existing People ASSETS/Places ASSETS character/location art, filenames exactly
    // matching the People Data.json/Places Data.json record name (e.g. "Max Impitus.png"). Same
    // GitHub Pages hosting pattern as everything above. A record with no matching thumbnail (art
    // was never made for it, or a name mismatch) just gets the image hidden via onerror below -
    // this is expected for a small number of records rather than a bug.
    const PEOPLE_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/people";
    const PLACES_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/places";
    // M.A.C. item thumbnails (added 2026-08-28) - the "Items ASSETS"/"Items Data.json" M.A.C.
    // catalog (Mega-Tense, Obalmond, Judge Helmet, etc.) - deliberately separate from
    // ITEMS_BASE_URL above, which serves the Big Heist mechanics gear catalog (Crowbar, Lockpick,
    // etc. from C:\DREDD 2\heist\itemcatalog.json). Filenames match the M.A.C. item's data KEY
    // exactly (e.g. "Mega-Tense.png", "Street Judge Ration Pack.png"), same convention as
    // PEOPLE_BASE_URL/PLACES_BASE_URL above - NOT the record's "imageFile" field, which uses a
    // non-breaking hyphen in several source filenames and doesn't always match the key (e.g.
    // "Street Judge Ration Pack" -> imageFile "Judge Ration Pack.png").
    const MAC_ITEMS_BASE_URL = "https://grumpybattersby.github.io/big-heist-extension/mac-items";

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

    // Per user's request - whether the show is currently "live" from the panel's point of view
    // (real stream-live detection OR a moderator's "!panellive on" override - see server.js'
    // computeEffectiveLive()). Drives the top-level branch in fetchMyData(): true shows the
    // normal character sheet/everything as it's always worked, false shows the Sector 21
    // advert/countdown screen instead. Starts true (not false) so the panel doesn't flash the
    // advert screen for a split second on first load before the very first fetch resolves - a
    // brief "loading" flicker into the advert would be worse than briefly assuming live.
    let isPanelLive = true;
    // The keepalive ticker (see maybeStartKeepalive()/maybeStopKeepalive() near renderStreamAdvert
    // below) - only runs while isPanelLive is true, per user's request ("keeping it alive through
    // the stream until we're done" - not meant to run 24/7, just during the show itself).
    let keepaliveIntervalId = null;
    // Ticks the live countdown on the Sector 21 advert screen once a second while it's on screen.
    // Cleared whenever the advert screen goes away (either the show goes live, or the panel
    // re-renders something else) - see clearStreamAdvertInterval() below.
    let streamAdvertIntervalId = null;
    // Ticks the live countdown on the Big Heist vote picker screen (see renderHeistVotePicker
    // below) - same idiom as streamAdvertIntervalId just above.
    let heistVoteIntervalId = null;

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
    // Graffiti size picker - same pure client-side toggle pattern as showRobberyPicker, but with
    // a static 3-button (small/medium/large) list instead of a Block-dependent category fetch.
    let showGraffitiPicker = false;
    let showBigHeistView = false;
    // Trade flow - client-side wizard (target -> what you're offering -> what you want
    // back) that ends by queueing "proposeTrade". Everything AFTER that point (both
    // parties seeing the offer, accepting/declining) is server-driven via the
    // tradeIncoming/tradeSent panelOverride modes, same pattern as findersFee/shopReady.
    let showTradePicker = false;
    let tradeWizardStep = "target"; // "target" | "offer" | "request"
    let tradeTarget = null;         // { userId, name }
    let tradeOfferCredits = 0;
    let tradeOfferItems = {};       // itemKey -> qty
    let tradeRequestCredits = 0;
    let tradeRequestItems = {};     // itemKey -> qty
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
    // "Skip !becomeperp, pick Male/Female on first load" flow - true from the moment a gender
    // button is clicked until the account actually shows up as found (PerpData created server
    // side). Twitch-authorized viewers only skip the chat command entirely; see the !found
    // branch in fetchMyData for why YouTube viewers still see the old plain message instead.
    let becomePerpPending = false;

    // Optimistic double-click guard for Block War's Attack/Defend buttons - same pattern as
    // becomePerpPending above. Set the instant a choice is clicked (before the server round-trip
    // confirms it via blockWar.votes), cleared once fresh data actually shows this userId as
    // having voted (or once the war itself is no longer active, in case something goes wrong).
    let blockWarVotePending = null; // null | 'attack' | 'defense'

    // Wally Squad's own private state, remembered client-side across polls (their panelOverride
    // payload only carries a fresh taskKey/slot right at the moment an action just landed - see
    // Big Heist - Wally Squad - Join Task / - Replace Item's re-push - so this bridges the gap on
    // every OTHER poll in between).
    let wallySquadDobInPending = null; // null | targetUserId, optimistic guard on the one-shot dob-in button

    // Optimistic guard for the Snitch Line accuse buttons - same pattern as blockWarVotePending
    // above. Once cast, this is permanent for the heist (no revoting), so this only ever needs to
    // bridge the gap between clicking and the next fresh snitchLine.votes fetch confirming it.
    let snitchLineVotePending = null; // null | accusedUserId

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

    // Persistent bottom button - lives outside #content in panel.html, so wiring it here (once,
    // at script load) works regardless of which of the two paths above just ran, and survives
    // every one of renderPerpSheet's many innerHTML rebuilds of #content untouched.
    setupItemGlossary();
    setupAchievementsGallery();

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

            // Show/hide the persistent bottom buttons (Item Glossary, Achievements, ...) per the
            // streamer's current feature flags - applied here, before the live/found branches
            // below, so it takes effect regardless of whether the show is live or the viewer's
            // even a registered perp yet. See setupFeatureFlagButtons() for the missing-flag
            // default (OFF) and Big Heist - Toggle Feature (Streamer.bot) for how these get set.
            applyFeatureFlags(result.data.featureFlags, result.data);

            // Per user's request - the panel is only "active" (character sheet, robbery,
            // pickpocket, everything) while the show is actually live, OR a moderator has forced
            // it live via "!panellive on". Otherwise show the Sector 21 advert with the next
            // show's countdown instead - this replaces the old "No perp data found yet" message
            // too, since that was really just one specific case of "there's nothing to do here
            // right now," which the advert covers far better regardless of found/not-found.
            isPanelLive = !!result.data.live;
            if (!isPanelLive) {
                renderStreamAdvert();
                return;
            }
            clearStreamAdvertInterval();
            maybeStartKeepalive();

            // Wally Squad's own PRIVATE reveal has to win over the Snitch Line's whole-audience
            // takeover below, for Wally Squad specifically - otherwise, since the Snitch Line opens
            // the instant they're assigned and stays open the whole heist, they'd never see their
            // own "YOU ARE WALLY SQUAD" screen at all, it'd be permanently blocked by the Snitch
            // Line screen every viewer (including them) gets shown first. Checked here, ahead of
            // the Snitch Line takeover, rather than relying on renderPerpSheet's own overrideMode
            // check further down - that check is only ever reached for found:true viewers AFTER the
            // Snitch Line takeover has already returned false, which never happens while it's open.
            if (result.data.panelOverride && result.data.panelOverride.mode === "wallySquadReveal") {
                renderWallySquadReveal(result.data);
                return;
            }

            // The Snitch Line takes over the WHOLE panel for EVERY viewer while it's open - checked
            // before the found/not-found branch below (unlike Block War, which only takes over
            // inside renderPerpSheet for found:true participants) so it also works for a viewer
            // who's never run !becomeperp - anyone watching should be able to dob someone in.
            // renderSnitchLineTakeover itself returns false once it's no longer active, falling
            // through to the normal flow below.
            if (renderSnitchLineTakeover(result.data, result.data.userId)) {
                return;
            }

            if (!result.data.found) {
                // Twitch Extension viewers have already granted Identity Link just to see this
                // panel at all (see showShareIdentityPrompt above) - there's no reason to also
                // make them type a chat command afterward when the panel already knows exactly
                // who they are. YouTube viewers reach this same found:false state too (via the
                // link-code session), but keep the old plain message: they still need to type
                // !becomeperp on THEIR path since that's also how they get told the standalone
                // panel URL in the first place (see the walkthrough script) - only the Twitch
                // in-panel command is being skipped here, not the YouTube chat flow.
                if (typeof Twitch !== "undefined" && Twitch.ext) {
                    renderBecomePerpPrompt();
                } else {
                    document.getElementById("content").innerHTML =
                        '<div id="status-message">' + result.data.message + '</div>';
                }
                return;
            }
            // Real data landed - any become-perp click that was in flight has resolved one way
            // or another (either this account now exists, or a stale pending flag needs
            // clearing so a FUTURE first-time viewer doesn't inherit it).
            becomePerpPending = false;
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

    // "Skip !becomeperp" first-load prompt for authorized-but-not-yet-registered Twitch viewers -
    // see the found:false branch in fetchMyData for why this only applies there. Sends the exact
    // same "becomePerp" panel action type Process Panel Actions already handles for the TRY AGAIN
    // button, just with an explicit gender in the payload instead of falling back to whatever's
    // already on file - Heist - Become Perp itself needed zero changes for this to work.
    function renderBecomePerpPrompt() {
        if (becomePerpPending) {
            document.getElementById("content").innerHTML =
                '<div id="status-message">Becoming a perp in Sector 21 - hang tight, this takes a few seconds...</div>';
            return;
        }

        document.getElementById("content").innerHTML =
            '<div id="status-message">Welcome to Sector 21. Pick a look to get started:</div>' +
            '<div style="text-align:center; margin-top:10px;">' +
            '<button class="panel-shop-button" id="become-perp-male-btn" style="margin-right:8px;">Male</button>' +
            '<button class="panel-shop-button" id="become-perp-female-btn">Female</button>' +
            '</div>';

        function pickGender(gender) {
            // Disable both immediately - same double-click protection used everywhere else a
            // panel button kicks off a one-shot server action (Oi, Arrest, mugshot Choose, etc).
            const maleBtn = document.getElementById("become-perp-male-btn");
            const femaleBtn = document.getElementById("become-perp-female-btn");
            if (maleBtn) maleBtn.disabled = true;
            if (femaleBtn) femaleBtn.disabled = true;

            // lastFetchedData is never set at this point - it only gets populated once
            // result.data.found is true, which is precisely the state we don't have yet - so
            // just re-render this same prompt, which now shows the "hang tight" message above.
            becomePerpPending = true;
            renderBecomePerpPrompt();

            queueAction("becomePerp", { gender: gender });
        }

        const maleBtn = document.getElementById("become-perp-male-btn");
        if (maleBtn) maleBtn.addEventListener("click", function () { pickGender("Male"); });
        const femaleBtn = document.getElementById("become-perp-female-btn");
        if (femaleBtn) femaleBtn.addEventListener("click", function () { pickGender("Female"); });
    }

    // ============================
    // SECTOR 21 STREAM ADVERT / COUNTDOWN - shown instead of the character sheet whenever the show
    // isn't live (per isPanelLive in fetchMyData). Three fixed weekly slots, all specified by the
    // user in NZ time - converted here to the viewer's own local time (with a GMT/UTC fallback if
    // that somehow fails) and used to compute a live-ticking countdown to whichever is soonest.
    // ============================

    // weekday uses the JS Date convention: 0=Sunday ... 6=Saturday.
    const SHOW_SCHEDULE = [
        { weekday: 0, hour: 0, minute: 0, team: "Red Perp Team" },
        { weekday: 1, hour: 19, minute: 30, team: "Gold Judge Team" },
        { weekday: 5, hour: 22, minute: 0, team: "Green Judge Team" }
    ];
    const SHOW_TIMEZONE = "Pacific/Auckland";

    // Converts a wall-clock time expressed IN a named IANA timezone into the UTC instant (a real
    // JS Date) it corresponds to. Vanilla JS has no direct "construct a Date from a timezone-local
    // wall clock" function, so this uses iterative convergence instead: start from a naive guess
    // (treating the wall-clock numbers as if they were already UTC), format that guess back out in
    // the target timezone via Intl.DateTimeFormat, measure the gap between what came out and what
    // we actually wanted, and nudge the guess by that gap. A couple of iterations is enough to
    // converge even across a DST transition, since Pacific/Auckland only ever shifts by 1 hour.
    function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
        let guess = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
        for (let i = 0; i < 3; i++) {
            const parts = getZonedParts(guess, timeZone);
            const wantedUtcMs = Date.UTC(year, month, day, hour, minute, 0, 0);
            const gotUtcMs = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, 0);
            const diffMs = wantedUtcMs - gotUtcMs;
            if (diffMs === 0) break;
            guess = new Date(guess.getTime() + diffMs);
        }
        return guess;
    }

    // Reads the wall-clock date/time components of a UTC instant AS SEEN in a given timezone,
    // using the browser's built-in ICU timezone database (handles NZST/NZDT transitions correctly
    // without hardcoding any DST rules).
    function getZonedParts(date, timeZone) {
        const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: timeZone,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false
        });
        const partsArr = fmt.formatToParts(date);
        const lookup = {};
        partsArr.forEach(function (p) { lookup[p.type] = p.value; });
        return {
            year: parseInt(lookup.year, 10),
            month: parseInt(lookup.month, 10) - 1,
            day: parseInt(lookup.day, 10),
            hour: lookup.hour === "24" ? 0 : parseInt(lookup.hour, 10),
            minute: parseInt(lookup.minute, 10)
        };
    }

    // Finds the next upcoming occurrence (as a real UTC Date, always >= now) of every entry in
    // SHOW_SCHEDULE, sorted soonest-first. Walks the next 8 NZ-local calendar days looking for a
    // matching weekday, which comfortably covers every entry regardless of where "now" falls in
    // the week.
    function getUpcomingShows(now) {
        const nzNow = getZonedParts(now, SHOW_TIMEZONE);
        const nzNowDate = new Date(Date.UTC(nzNow.year, nzNow.month, nzNow.day));
        const results = [];
        SHOW_SCHEDULE.forEach(function (show) {
            let found = null;
            for (let offset = 0; offset < 8; offset++) {
                const candidateDay = new Date(nzNowDate.getTime() + offset * 86400000);
                const candidateWeekday = candidateDay.getUTCDay();
                if (candidateWeekday !== show.weekday) continue;
                const candidateUtc = zonedTimeToUtc(
                    candidateDay.getUTCFullYear(), candidateDay.getUTCMonth(), candidateDay.getUTCDate(),
                    show.hour, show.minute, SHOW_TIMEZONE
                );
                if (candidateUtc.getTime() >= now.getTime()) {
                    found = candidateUtc;
                    break;
                }
            }
            if (found) {
                results.push({ team: show.team, utcDate: found });
            }
        });
        results.sort(function (a, b) { return a.utcDate.getTime() - b.utcDate.getTime(); });
        return results;
    }

    // Formats a UTC Date in the viewer's own local timezone (their browser's default, detected
    // automatically) - falls back to a plain GMT/UTC string if local-timezone formatting somehow
    // throws (per user's request: "if not convert it to GMT").
    function formatLocalShowTime(utcDate) {
        try {
            return utcDate.toLocaleString(undefined, {
                weekday: "long", month: "short", day: "numeric",
                hour: "numeric", minute: "2-digit"
            });
        } catch (e) {
            return utcDate.toUTCString().replace(":00 GMT", " GMT");
        }
    }

    // SHOW_SCHEDULE team names are "<Color> Perp Team" / "<Color> Judge Team" - the poster art is
    // filed per COLOR only (one poster represents that whole team regardless of Perp/Judge), so
    // this just pulls the leading word off the team name to build the image URL. Returns null (no
    // <img> rendered) if the team name doesn't start with a recognized color, rather than guessing
    // at a filename that doesn't exist and showing a broken-image icon.
    const TEAM_POSTER_COLORS = ["Red", "Gold", "Green"];
    function teamPosterImageUrl(teamName) {
        const color = TEAM_POSTER_COLORS.find(function (c) { return teamName.indexOf(c) === 0; });
        if (!color) return null;
        return TEAM_POSTERS_BASE_URL + "/" + encodeURIComponent(color + " Team Event Poster.png");
    }

    function clearStreamAdvertInterval() {
        if (streamAdvertIntervalId) {
            clearInterval(streamAdvertIntervalId);
            streamAdvertIntervalId = null;
        }
    }

    // Keeps the backend awake while the show is live (Render's free tier spins a service down
    // after a stretch of inactivity, and the normal poll cadence on a quiet advert screen isn't
    // frequent enough on its own to guarantee that never happens right as a show starts) - per
    // user's request, this should only run DURING the show, not 24/7 off-air.
    function maybeStartKeepalive() {
        if (keepaliveIntervalId) return;
        keepaliveIntervalId = setInterval(function () {
            fetch(BACKEND_URL + "/api/status").catch(function () { /* best-effort, ignore */ });
        }, 4 * 60 * 1000);
    }

    function maybeStopKeepalive() {
        if (keepaliveIntervalId) {
            clearInterval(keepaliveIntervalId);
            keepaliveIntervalId = null;
        }
    }

    function renderStreamAdvert() {
        clearStreamAdvertInterval();
        maybeStopKeepalive();

        const upcoming = getUpcomingShows(new Date());
        const next = upcoming[0];

        let html = '<div class="stream-advert">';
        html += '<div class="stream-advert-title">SECTOR 21 IS QUIET FOR NOW</div>';
        html += '<div class="stream-advert-subtitle">The Big Heist is only active while the show is live. Here\'s when the Judges/perps are back in action:</div>';

        if (next) {
            const posterUrl = teamPosterImageUrl(next.team);
            if (posterUrl) {
                // onerror hides just the frame (not the rest of the advert) if that color's
                // poster hasn't been uploaded yet - same graceful-degradation pattern used for
                // getaway art elsewhere in this file, rather than showing a broken-image icon.
                html += '<div class="stream-advert-poster-frame"><img src="' + posterUrl + '" alt="' + escapeHtml(next.team) + '" onerror="this.parentElement.style.display=\'none\'"></div>';
            }
            html += '<div class="stream-advert-next-label">NEXT UP: ' + next.team + '</div>';
            html += '<div class="stream-advert-countdown" id="stream-advert-countdown">--:--:--:--</div>';
            html += '<div class="stream-advert-next-time">' + formatLocalShowTime(next.utcDate) + ' (your local time)</div>';
        }

        html += '<div class="stream-advert-schedule">';
        upcoming.forEach(function (show) {
            html += '<div class="stream-advert-schedule-row">' +
                '<span class="stream-advert-schedule-team">' + show.team + '</span>' +
                '<span class="stream-advert-schedule-time">' + formatLocalShowTime(show.utcDate) + '</span>' +
                '</div>';
        });
        html += '</div>';

        html += '</div>';

        document.getElementById("content").innerHTML = html;

        if (next) {
            const targetMs = next.utcDate.getTime();
            const tick = function () {
                const el = document.getElementById("stream-advert-countdown");
                if (!el) {
                    // Screen moved on (show went live, or panel re-rendered elsewhere) - stop ticking.
                    clearStreamAdvertInterval();
                    return;
                }
                const secondsLeft = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
                const days = Math.floor(secondsLeft / 86400);
                const hours = Math.floor((secondsLeft % 86400) / 3600);
                const minutes = Math.floor((secondsLeft % 3600) / 60);
                const seconds = secondsLeft % 60;
                el.textContent = days + "d " + (hours < 10 ? "0" : "") + hours + "h " +
                    (minutes < 10 ? "0" : "") + minutes + "m " + (seconds < 10 ? "0" : "") + seconds + "s";
            };
            tick();
            streamAdvertIntervalId = setInterval(tick, 1000);
        }
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
    // Same idea as robberyPending above, for Pickpocket - the panel used to fall straight back to
    // the normal character sheet the instant a target was picked, with nothing visible until the
    // pickpocketNotice toast eventually landed a moment later - exactly the "you don't know it's
    // doing anything" gap the user reported. Shown the INSTANT a target is picked, cleared the
    // same way robberyPending is (a fresh pickpocketNotice arriving, success OR reject, always
    // means the attempt resolved one way or another).
    let pickpocketPending = false;
    let pickpocketPendingTargetName = null;

    // Same idea again, for Graffiti - shown the INSTANT a size is picked, using the same
    // instant-feedback top-row icon treatment as pickpocketPending (Tag icon.png in place of
    // pickpocket-alert.png). Cleared the same way - a fresh pickpocketNotice arriving (the
    // shared toast field every crime action writes to) always means the attempt resolved.
    let graffitiPending = false;

    // Per user's follow-up - the "settling up" greyed-out state on the Rob/Pickpocket buttons
    // should only apply to whichever action was actually just run, not both at once (they share
    // the same underlying pickpocketNotice toast field, so hasFreshNotice alone can't tell them
    // apart). Set the instant the real queueAction fires for either action; read alongside
    // hasFreshNotice at render time so only the matching button greys out.
    let lastCrimeAction = null; // "robbery" | "pickpocket" | "graffiti" | null

    // Per user's request - a toggle on the robbery picker for whether to actually USE a carried
    // Gun on the job, separate from just owning one. Defaults to true (matches the old always-use-
    // if-owned behavior) so nothing changes for a player who never touches the toggle. Only
    // meaningful (and only shown) when inventoryHasGun(data) is true - a player with no Gun has
    // nothing to toggle. Client-side only, re-sent with each robberyCategory queueAction rather
    // than persisted server-side, since it's a per-attempt choice, not standing player state.
    let robberyUseGun = true;

    // Which robbery categories actually exist in the CURRENT Block, and that Block's own
    // difficulty multiplier - fetched fresh each time the robbery picker opens (the Block only
    // changes when the streamer moves it via Streamdeck, so no continuous polling needed). Null
    // until the first fetch resolves, or if the fetch fails - see getAvailableRobberyCategories().
    let currentBlockInfo = null;

    function fetchCurrentBlock() {
        fetch(BACKEND_URL + "/api/current-block")
            .then(function (res) { return res.json(); })
            .then(function (data) {
                currentBlockInfo = data;
                if (showRobberyPicker && lastFetchedData) renderPerpSheet(lastFetchedData);
            })
            .catch(function (err) {
                console.error("current-block fetch failed:", err);
            });
    }

    // Shared by both the render and the click-wiring code below so they always agree on which
    // categories are showing and in what order (the "-i" suffix on each button/row id is an index
    // into whatever this returns, so a mismatch between the two call sites would wire the wrong
    // click handler to the wrong button). Falls back to the full static list with generic labels
    // if the Block data hasn't loaded yet or a category is missing from it - fails open rather
    // than showing nothing, since a robbery attempt with a generic flavour is far better than the
    // whole feature appearing broken while /api/current-block is still in flight.
    function getAvailableRobberyCategories() {
        if (!currentBlockInfo || !currentBlockInfo.locations || Object.keys(currentBlockInfo.locations).length === 0) {
            return ROBBERY_CATEGORIES;
        }
        return ROBBERY_CATEGORIES
            .filter(function (cat) { return !!currentBlockInfo.locations[cat.key]; })
            .map(function (cat) {
                return { key: cat.key, label: currentBlockInfo.locations[cat.key], image: cat.image };
            });
    }
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

    function clearHeistVoteInterval() {
        if (heistVoteIntervalId) {
            clearInterval(heistVoteIntervalId);
            heistVoteIntervalId = null;
        }
    }

    // Renders the Big Heist vote picker - 4 randomly-chosen heist candidates, each shown as a
    // card (title/image/description/crew range/items/reward), with a live-ticking 2-minute
    // countdown and a vote button per card. data.heistVote is GLOBAL state (one round for the
    // whole show, not per-viewer) pushed by Streamer.bot's "Big Heist - Vote Round Start"/"Vote
    // Tick" actions - see backend/server.js's heistVote section for the shape. Called instead of
    // the normal character sheet whenever data.heistVote.active is true (checked in
    // renderPerpSheet, right before the heistRunning takeover - the two are mutually exclusive,
    // since a heist can't be running before its own vote has resolved).
    function renderHeistVotePicker(data) {
        clearHeistVoteInterval();
        const hv = data.heistVote;
        const myVote = hv.votes && currentUserId ? hv.votes[currentUserId] : null;

        const candidateCount = (hv.candidates || []).length;
        let html = '<div class="section-title">Sector 21 - Pick Tonight\'s Big Heist</div>';
        html += '<div class="juan-quote">' + candidateCount + ' job' + (candidateCount === 1 ? '' : 's') + ' on the table. Vote for the one you want to pull tonight - most votes when the clock runs out wins.</div>';
        html += '<div class="heist-vote-countdown" id="heist-vote-countdown">--:--</div>';
        html += '<div class="heist-vote-grid">';

        // Same 4-tier rating as the OBS card's difficulty badge/stroke color - maps to the same
        // CSS classes defined for .heist-vote-difficulty above (falls back to the HARD look if a
        // future rating value shows up that isn't one of the 4 known ones).
        const HEIST_DIFFICULTY_CLASS = {
            'EASY': 'heist-difficulty-easy',
            'MEDIUM': 'heist-difficulty-medium',
            'HARD': 'heist-difficulty-hard',
            'NEAR IMPOSSIBLE': 'heist-difficulty-near-impossible'
        };

        (hv.candidates || []).forEach(function (c) {
            const voteCount = hv.votes ? Object.values(hv.votes).filter(function (v) { return v === c.heistKey; }).length : 0;
            const isMyVote = myVote === c.heistKey;
            const imgFile = HEIST_IMAGES[c.heistKey];

            html += '<div class="heist-vote-card' + (isMyVote ? ' heist-vote-card-mine' : '') + '">';
            if (imgFile) {
                html += '<div class="heist-vote-card-image"><img src="' + HEISTS_BASE_URL + '/' + imgFile + '" alt="' + escapeHtml(c.heistName || '') + '" onerror="this.parentElement.style.display=\'none\';"></div>';
            }
            html += '<div class="heist-vote-votes">' + voteCount + ' VOTE' + (voteCount === 1 ? '' : 'S') + '</div>';
            html += '<div class="heist-vote-title">' + escapeHtml(c.heistName || c.heistKey) + '</div>';
            if (c.rating) {
                const difficultyClass = HEIST_DIFFICULTY_CLASS[c.rating] || 'heist-difficulty-hard';
                html += '<div class="heist-vote-difficulty ' + difficultyClass + '">' + escapeHtml(c.rating) + '</div>';
            }
            html += '<div class="heist-vote-desc">' + escapeHtml(c.description || '') + '</div>';
            html += '<div class="heist-vote-stats">' +
                '<span>MIN CREW <strong>' + (c.minCrew != null ? c.minCrew : '?') + '</strong></span>' +
                '<span>MAX CREW <strong>' + (c.maxCrew != null ? c.maxCrew : '?') + '</strong></span>' +
                '</div>';
            if (c.items && c.items.length) {
                html += '<div class="heist-vote-items">ITEMS: ' + escapeHtml(c.items.join(', ')) + '</div>';
            }
            html += '<div class="heist-vote-amount">' + (typeof c.amountOnOffer === 'number' ? c.amountOnOffer.toLocaleString() : c.amountOnOffer || '?') + ' cr ON OFFER</div>';
            html += '<button type="button" class="heist-vote-button' + (isMyVote ? ' voted' : '') + '" data-heist-key="' + escapeHtml(c.heistKey) + '">' +
                (isMyVote ? 'VOTED' : 'VOTE') + '</button>';
            html += '</div>';
        });

        html += '</div>';

        document.getElementById("content").innerHTML = html;

        document.querySelectorAll(".heist-vote-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const key = btn.getAttribute("data-heist-key");
                document.querySelectorAll(".heist-vote-button").forEach(function (b) { b.disabled = true; });
                queueAction("voteHeist", { heistKey: key });
            });
        });

        const endsAtMs = hv.votingEndsAt ? hv.votingEndsAt * 1000 : null;
        if (endsAtMs) {
            const tick = function () {
                const el = document.getElementById("heist-vote-countdown");
                if (!el) {
                    clearHeistVoteInterval();
                    return;
                }
                const secondsLeft = Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000));
                const minutes = Math.floor(secondsLeft / 60);
                const seconds = secondsLeft % 60;
                el.textContent = "VOTING CLOSES IN " + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
                if (secondsLeft <= 0) {
                    el.textContent = "TALLYING VOTES...";
                    clearHeistVoteInterval();
                }
            };
            tick();
            heistVoteIntervalId = setInterval(tick, 1000);
        }
    }

    // Judge skill stats line, shown under the portrait on the Judge Home Screen (added 2026-08-18,
    // per the user's request - "you have judge skills no? It's used in investigations and
    // arrests?"). data.skills is already computed generically for every account by Sync To
    // Extension (every "skill_<Name>" player var >0, no panel/backend change needed to expose it -
    // it just wasn't being rendered anywhere on the Judge side, only on the plain Perp character
    // sheet's Skills section). The two that actually apply to a Judge: Investigation ("Big Heist -
    // Judge Investigation" - d100 + this vs the heist's investigation difficulty, +1-3 on a 25%
    // chance on success, capped 50) and Capture ("Big Heist - Getaway Fail/Success" - lowers the
    // shared getaway difficulty for the whole crew, +1-3 on a 40% chance on a successful collar,
    // capped 30). Investigation defaults to a real starting value of 10 in the actual game logic
    // (Judge Investigation explicitly treats an unset/0 skill as 10, since a never-set var and a
    // genuine 0 aren't distinguishable) - mirrored here so a Judge who hasn't had an investigation
    // resolve yet still sees their real starting number instead of a misleading blank/zero. Capture
    // has no such floor in the actual game logic (a brand new Judge really does start at a bare 0
    // there), so this shows exactly that.
    function renderJudgeSkillsLine(data) {
        const skills = data.skills || {};
        const investigation = typeof skills.Investigation === "number" ? skills.Investigation : 10;
        const capture = typeof skills.Capture === "number" ? skills.Capture : 0;
        return '<div class="skills-text judge-skills-line">' +
            '<span class="skill-name">Investigation:</span> <span class="skill-num">' + investigation + '</span>' +
            ' &nbsp; ' +
            '<span class="skill-name">Capture:</span> <span class="skill-num">' + capture + '</span>' +
            '</div>';
    }

    // M.A.C. Search results screen - a Judges-only full-panel takeover, shown after a Judge runs
    // a search from their Judge Home Screen (see the mac-search-input/mac-search-button wiring
    // further down). data.panelOverride.results is a flat array of {name, type} written by
    // Streamer.bot's "M.A.C. - Panel Search" action - type is one of "crime"/"person"/"place"/
    // "item", used purely as a label here (the actual record lookup happens server-side once the
    // GM physically presses the matching Stream Deck button on page 2).
    //
    // Clicking a result does NOT disable it and does NOT close this screen - per the user's
    // explicit request results can be picked more than once (e.g. re-flagging the same item after
    // the GM has moved on to something else), so buttons stay live for the whole time this screen
    // is up. A local Set tracks which results have been clicked so far purely for the "queued"
    // visual cue (a class toggle) - this is optimistic/client-side only, it does NOT reflect
    // whether the matching Stream Deck button is actually still purple (the GM could have already
    // pressed it and turned it red, or a later Populate Core run could have cleared it) - it just
    // gives the player immediate feedback that their click registered.
    let macSearchQueuedKeys = new Set();
    // Tracks which records THIS Judge has explicitly pressed "Flag to GM" for this session (added
    // 2026-08-24) - purely a client-side instant-feedback set, same pattern as
    // macSearchQueuedKeys above. Reading a record no longer auto-flags it (see renderMacRecordDetail
    // below) - flagging is now its own deliberate action, separate from reading, per the user's
    // spec: "we're going to move the flagging the GM function to a button on the details page so
    // it's only used when they're sure they want to push it to the GM." The actual GM-facing
    // effect now lands on the iCUE Left Stream Deck board (see M.A.C. - Panel Flag To GM /
    // M.A.C. - Render Flag Board on the Streamer.bot side), not the old S21 page-2 purple lanes.
    let macFlaggedKeys = new Set();

    function macResultKey(r) {
        return (r.type || "") + "::" + (r.name || "");
    }

    // Small list-row thumbnail (added 2026-08-23, Item support added 2026-08-28) - same
    // PEOPLE_BASE_URL/PLACES_BASE_URL/MAC_ITEMS_BASE_URL-backed art as the record detail screen's
    // bigger image, just shown at list-row size here. Person/Place/Item results only - Crime
    // results in a search list have no matching art. A missing file (no source art for that
    // record) just collapses the wrapper via onerror, same graceful fallback as the detail screen.
    function macResultThumbHtml(r) {
        if (r.type !== 'person' && r.type !== 'place' && r.type !== 'item') return '';
        const baseUrl = r.type === 'person' ? PEOPLE_BASE_URL : (r.type === 'place' ? PLACES_BASE_URL : MAC_ITEMS_BASE_URL);
        const url = baseUrl + '/' + encodeURIComponent(r.name || '') + '.png';
        return '<div class="mac-result-thumb"><img src="' + url + '" alt="" onerror="this.parentElement.style.display=\'none\';"></div>';
    }

    function renderMacSearchResults(data) {
        const ov = data.panelOverride || {};
        const results = ov.results || [];

        let html = '<div class="section-title">M.A.C. Search Results</div>';
        html += '<div class="juan-quote">' + results.length + ' match' + (results.length === 1 ? '' : 'es') + ' for &ldquo;' + escapeHtml(ov.query || '') + '&rdquo;. Tap a result to read it - reading it never flags it, there\'s a separate Flag to GM button once you\'re sure.</div>';
        html += '<div class="heist-vote-grid">';

        const MAC_TYPE_LABELS = { crime: 'CRIME', person: 'PERSON', place: 'PLACE', item: 'ITEM' };

        results.forEach(function (r) {
            const key = macResultKey(r);
            const isQueued = macSearchQueuedKeys.has(key);
            html += '<div class="heist-vote-card' + (isQueued ? ' heist-vote-card-mine' : '') + '">';
            html += macResultThumbHtml(r);
            html += '<div class="heist-vote-difficulty">' + (MAC_TYPE_LABELS[r.type] || String(r.type || '').toUpperCase()) + '</div>';
            html += '<div class="heist-vote-title">' + escapeHtml(r.name || '') + '</div>';
            // Deliberately just name/type here, never the record's actual content - reading it
            // (and seeing anything more than that) requires this explicit tap, one record at a
            // time, per the user's spoiler-safety ask ("they'd need to know the actual name and
            // pull it individually"). See renderMacRecordDetail below for what a tap reveals.
            html += '<button type="button" class="heist-vote-button mac-search-result-button' + (isQueued ? ' voted' : '') + '" data-mac-name="' + escapeHtml(r.name || '') + '" data-mac-type="' + escapeHtml(r.type || '') + '">' +
                (isQueued ? 'READ - TAP TO READ AGAIN' : 'READ RECORD') + '</button>';
            html += '</div>';
        });

        html += '</div>';
        html += '<button class="panel-back-button" id="panel-mac-search-back-button">Back</button>';

        document.getElementById("content").innerHTML = html;

        document.querySelectorAll(".mac-search-result-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const name = btn.getAttribute("data-mac-name");
                const type = btn.getAttribute("data-mac-type");
                macSearchQueuedKeys.add(type + "::" + name);
                // "macRecordRead" (added 2026-08-18, no longer auto-flags as of 2026-08-24) fetches
                // the full record for THIS Judge's own panel (see renderMacRecordDetail) only -
                // flagging it to the GM is now a separate deliberate button on that detail screen.
                queueAction("macRecordRead", { name: name, type: type });
                // Re-render immediately from the same data so the "QUEUED" state shows without
                // waiting on the next poll - the same pattern the crime cross-reference and other
                // instant-feedback screens in this file use. The actual detail screen takes over
                // once the next poll brings back the server's macRecordDetail override.
                renderMacSearchResults(data);
            });
        });

        const backButton = document.getElementById("panel-mac-search-back-button");
        if (backButton) {
            backButton.addEventListener("click", function () {
                macSearchQueuedKeys = new Set();
                queueAction("clearOverride", {});
            });
        }
    }

    // A Judge's own read-out of ONE search result's full record - only reachable by tapping a
    // specific named result on the screen above, never shown in bulk (added 2026-08-18, per the
    // user's explicit spoiler-safety ask: "they'd need to know the actual name and pull it
    // individually"). Back returns to the search results list (via "macBackToSearchResults",
    // restored server-side from a cached copy of the last search - see "M.A.C. - Back To Search
    // Results"), not all the way out to the Judge Home Screen.
    function renderMacRecordDetail(data) {
        const ov = data.panelOverride || {};
        const MAC_TYPE_LABELS = { crime: 'CRIME', person: 'PERSON', place: 'PLACE', item: 'ITEM' };

        let html = '<div class="section-title">' + escapeHtml(ov.name || '') + '</div>';

        // Mini image (added 2026-08-23, Item support added 2026-08-28) - Person/Place/Item
        // records only, sourced from a thumbnail named exactly after the record (e.g.
        // "Max Impitus.png", "Mega-Tense.png"). A record with no matching thumbnail just loses
        // the image via onerror - not every record has source art.
        if ((ov.type === 'person' || ov.type === 'place' || ov.type === 'item') && ov.name) {
            const macImageBaseUrl = ov.type === 'person' ? PEOPLE_BASE_URL : (ov.type === 'place' ? PLACES_BASE_URL : MAC_ITEMS_BASE_URL);
            const macImageUrl = macImageBaseUrl + '/' + encodeURIComponent(ov.name) + '.png';
            html += '<div class="mac-record-detail-image"><img src="' + macImageUrl + '" alt="' + escapeHtml(ov.name) + '" onerror="this.parentElement.style.display=\'none\';"></div>';
        }

        html += '<div class="juan-quote">' + (MAC_TYPE_LABELS[ov.type] || String(ov.type || '').toUpperCase()) + '</div>';

        if (ov.subHeading) {
            html += '<div class="skills-text" style="white-space: pre-wrap; margin-bottom: 8px;">' + escapeHtml(ov.subHeading) + '</div>';
        }
        if (ov.details) {
            html += '<div class="juan-quote" style="white-space: pre-wrap;">' + escapeHtml(ov.details) + '</div>';
        }
        if (ov.additionalInfo) {
            html += '<div class="juan-quote" style="white-space: pre-wrap;">' + escapeHtml(ov.additionalInfo) + '</div>';
        }
        if (!ov.subHeading && !ov.details && !ov.additionalInfo) {
            html += '<div class="juan-quote">M.A.C. has nothing else on file for this one.</div>';
        }

        // Flag to GM (added 2026-08-24) - the ONLY way a record now reaches the GM's iCUE Left
        // Stream Deck board. Deliberately separate from reading (see macFlaggedKeys above) - per
        // the user's spec, this only fires when the Judge is sure they want to push it, not on
        // every read. Can be pressed more than once (each press just re-flags/re-inserts it at
        // the front of the GM's board - harmless, matches "you can read/flag the same one again
        // later" from the results screens).
        const macFlagKey = (ov.type || '') + '::' + (ov.name || '');
        const macAlreadyFlagged = macFlaggedKeys.has(macFlagKey);
        // Split across 2 explicit lines at the hyphen (added 2026-08-24, per user feedback -
        // "it'd be good to have 2 lines for the text split where the hyphen is instead of
        // wrapping") rather than letting the button's own text-wrap break it wherever it likes.
        html += '<button type="button" class="panel-urgent-button" id="mac-flag-to-gm-button">' +
            (macAlreadyFlagged ? 'FLAGGED FOR GM<br>TAP TO RE-FLAG' : 'FLAG TO GM') + '</button>';

        html += '<button class="panel-back-button" id="panel-mac-record-detail-back-button">Back to Results</button>';

        document.getElementById("content").innerHTML = html;

        const flagButton = document.getElementById("mac-flag-to-gm-button");
        if (flagButton) {
            flagButton.addEventListener("click", function () {
                macFlaggedKeys.add(macFlagKey);
                queueAction("macFlagToGm", { name: ov.name, type: ov.type });
                renderMacRecordDetail(data);
            });
        }

        const backButton = document.getElementById("panel-mac-record-detail-back-button");
        if (backButton) {
            backButton.addEventListener("click", function () {
                queueAction("macBackToSearchResults", {});
            });
        }
    }

    // Small search field + button shown on the Judge Home Screen (both the playing-Judge and
    // watching-Judge variants) whenever there's no arrestAlert currently taking that space over.
    // Wired up in renderPerpSheet's button-wiring block below (#mac-search-button), since this
    // html is just a fragment folded into the larger Judge Home Screen html - not its own
    // standalone render/flush like renderMacSearchResults above.
    function renderMacSearchBox() {
        // Reuses the same panel-text-input/panel-urgent-button classes as the existing "Ask Juan"
        // finder search (see finder-search-input/finder-search-button above) rather than inventing
        // new CSS classes that would need a separate stylesheet change - both are already styled
        // and already proven to render correctly inside this panel.
        let html = '<input type="text" class="panel-text-input" id="mac-search-input" placeholder="M.A.C. Search - name, crime, item...">';
        html += '<button type="button" class="panel-urgent-button" id="mac-search-button">Judge M.A.C. Search</button>';
        return html;
    }

    // Two buttons under the search box (added 2026-08-18) - a spelling-proof alternative for
    // Person/Place records specifically: "the person might not be able to spell the name
    // correctly" was the user's own reasoning for building this. Deliberately not offered for
    // Crimes/Items, per the user's explicit ask. Wired up in renderPerpSheet's button-wiring
    // block below (#mac-browse-people-button/#mac-browse-places-button), same fragment pattern
    // as renderMacSearchBox above.
    function renderMacBrowseButtons() {
        let html = '<button type="button" class="panel-shop-button" id="mac-browse-people-button">Browse People (A-Z)</button>';
        html += '<button type="button" class="panel-shop-button" id="mac-browse-places-button">Browse Places (A-Z)</button>';
        return html;
    }

    // Step 1 of the browse-by-letter flow (added 2026-08-18) - a small alphabet grid, tapped from
    // the Judge Home Screen's "Browse People/Places" button. Letters with no matching record
    // (ov.availableLetters, computed server-side in "M.A.C. - Panel Browse Alphabet") are shown
    // disabled/dimmed rather than omitted, so the grid keeps the same shape for People and Places
    // alike. "#" (if present) covers any name that doesn't start with a letter at all.
    const MAC_BROWSE_CATEGORY_LABELS = { person: 'People', place: 'Places' };

    function renderMacBrowseAlphabet(data) {
        const ov = data.panelOverride || {};
        const category = ov.category || 'person';
        const available = new Set(ov.availableLetters || []);
        const categoryLabel = MAC_BROWSE_CATEGORY_LABELS[category] || 'Records';

        let html = '<div class="section-title">Browse ' + escapeHtml(categoryLabel) + '</div>';
        html += '<div class="juan-quote">Tap a letter to see every ' + (category === 'place' ? 'place' : 'person') + ' whose name starts with it.</div>';
        html += '<div class="mac-letter-grid">';

        const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['#']);
        ALPHABET.forEach(function (letter) {
            const isAvailable = available.has(letter);
            html += '<button type="button" class="mac-letter-button mac-browse-letter-button" data-mac-letter="' + escapeHtml(letter) + '"' + (isAvailable ? '' : ' disabled') + '>' + escapeHtml(letter) + '</button>';
        });

        html += '</div>';
        html += '<button class="panel-back-button" id="panel-mac-browse-alphabet-back-button">Back</button>';

        document.getElementById("content").innerHTML = html;

        document.querySelectorAll(".mac-browse-letter-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const letter = btn.getAttribute("data-mac-letter");
                queueAction("macBrowseLetter", { category: category, letter: letter });
            });
        });

        const backButton = document.getElementById("panel-mac-browse-alphabet-back-button");
        if (backButton) {
            backButton.addEventListener("click", function () {
                queueAction("clearOverride", {});
            });
        }
    }

    // Step 2 of the browse-by-letter flow (added 2026-08-18) - every Person/Place starting with
    // the tapped letter, as a clickable list. Same "READ + FLAG FOR GM" tap behavior and the same
    // spoiler-safety rule as a free-text search result (see renderMacSearchResults above and
    // renderMacRecordDetail below) - this list only ever shows bare names, a tap is required to
    // read anything. Unlike a free-text search, browsing itself never touches the physical Stream
    // Deck or plays the GM alert sound - only the tap does (see "M.A.C. - Panel Browse Item
    // Selected" in Streamer.bot), and that tap also wipes out whatever was previously flagged
    // there rather than adding to it, per the user's explicit "it wipes the last search" spec.
    // Back returns to the alphabet grid for the same category, not all the way to Judge Home.
    function renderMacBrowseResults(data) {
        const ov = data.panelOverride || {};
        const category = ov.category || 'person';
        const results = ov.results || [];
        const categoryLabel = MAC_BROWSE_CATEGORY_LABELS[category] || 'Records';
        const MAC_TYPE_LABELS = { crime: 'CRIME', person: 'PERSON', place: 'PLACE', item: 'ITEM' };

        let html = '<div class="section-title">' + escapeHtml(categoryLabel) + ' - "' + escapeHtml(ov.letter || '') + '"</div>';
        html += '<div class="juan-quote">' + results.length + ' match' + (results.length === 1 ? '' : 'es') + '. Tap a result to read it - reading it never flags it, there\'s a separate Flag to GM button once you\'re sure.</div>';
        html += '<div class="heist-vote-grid">';

        results.forEach(function (r) {
            const key = macResultKey(r);
            const isQueued = macSearchQueuedKeys.has(key);
            html += '<div class="heist-vote-card' + (isQueued ? ' heist-vote-card-mine' : '') + '">';
            html += macResultThumbHtml(r);
            html += '<div class="heist-vote-difficulty">' + (MAC_TYPE_LABELS[r.type] || String(r.type || '').toUpperCase()) + '</div>';
            html += '<div class="heist-vote-title">' + escapeHtml(r.name || '') + '</div>';
            html += '<button type="button" class="heist-vote-button mac-browse-result-button' + (isQueued ? ' voted' : '') + '" data-mac-name="' + escapeHtml(r.name || '') + '" data-mac-type="' + escapeHtml(r.type || '') + '">' +
                (isQueued ? 'READ - TAP TO READ AGAIN' : 'READ RECORD') + '</button>';
            html += '</div>';
        });

        html += '</div>';
        html += '<button class="panel-back-button" id="panel-mac-browse-results-back-button">Back</button>';

        document.getElementById("content").innerHTML = html;

        document.querySelectorAll(".mac-browse-result-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const name = btn.getAttribute("data-mac-name");
                const type = btn.getAttribute("data-mac-type");
                macSearchQueuedKeys.add(type + "::" + name);
                queueAction("macBrowseItemSelected", { name: name, type: type });
                renderMacBrowseResults(data);
            });
        });

        const backButton = document.getElementById("panel-mac-browse-results-back-button");
        if (backButton) {
            backButton.addEventListener("click", function () {
                macSearchQueuedKeys = new Set();
                queueAction("macBrowseAlphabet", { category: category });
            });
        }
    }

    const ROBBERY_CATEGORIES = [
        { key: "cash", label: "The Bank", image: ROBBERY_BASE_URL + "/robbery-bank.png" },
        { key: "tools", label: "Hardware Store", image: ROBBERY_BASE_URL + "/robbery-hardware.png" },
        { key: "tech", label: "Tech Store", image: ROBBERY_BASE_URL + "/robbery-tech.png" },
        { key: "weapons", label: "Black Market Armory", image: ROBBERY_BASE_URL + "/robbery-armory.png" },
        { key: "explosives", label: "Construction Site", image: ROBBERY_BASE_URL + "/robbery-construction.png" },
        { key: "vehicle", label: "Chop Shop", image: ROBBERY_BASE_URL + "/robbery-chopshop.png" },
        { key: "gear", label: "Costume Shop", image: ROBBERY_BASE_URL + "/robbery-costume.png" },
        { key: "consumables", label: "Chemist", image: ROBBERY_BASE_URL + "/robbery-chemist.png" }
    ];

    // Mirrors Robbery - Attempt's own CategoryBaseDifficulty table exactly (a direct d100
    // threshold per category, scaled by the current Block's own multiplier on top) - duplicated
    // here purely for the picker's difficulty PREVIEW, same "no shared imports between actions"
    // reason the server-side comment gives for its own copy. If the server-side table ever
    // changes, this one needs updating to match or the preview will drift from the real odds.
    const ROBBERY_CATEGORY_BASE_DIFFICULTY = {
        cash: 80, tools: 40, tech: 45, weapons: 65,
        explosives: 55, vehicle: 60, gear: 25, consumables: 50
    };

    // Same 7-tier classification used everywhere the panel/OBS talks about odds (robbery result
    // cinematic, task assignment, the Big Heist finale) - based on the raw d100 roll actually
    // needed to clear a threshold AFTER skill/gun bonuses are subtracted out, not the raw
    // threshold alone. Exact bands per user's spec.
    function classifyDifficulty(neededRoll) {
        if (neededRoll <= 20) return "Easy";
        if (neededRoll <= 30) return "Routine";
        if (neededRoll <= 45) return "50:50";
        if (neededRoll <= 55) return "Hard";
        if (neededRoll <= 70) return "Difficult";
        if (neededRoll <= 87) return "Herculean";
        return "Near Impossible";
    }

    // CSS tag class + cinematic flavor line for each tier - single source of truth so the picker
    // tag and the result cinematic never drift out of sync with each other.
    const DIFFICULTY_TIER_META = {
        "Easy":            { cssClass: "difficulty-easy",       flavor: "Should be no trouble at all." },
        "Routine":         { cssClass: "difficulty-routine",    flavor: "Nothing to worry about here." },
        "50:50":           { cssClass: "difficulty-5050",       flavor: "Could genuinely go either way." },
        "Hard":            { cssClass: "difficulty-hard",       flavor: "Not for the faint of heart." },
        "Difficult":       { cssClass: "difficulty-difficult",  flavor: "This is going to take real skill." },
        "Herculean":       { cssClass: "difficulty-herculean",  flavor: "Frankly, a miracle would help." },
        "Near Impossible": { cssClass: "difficulty-impossible", flavor: "Whatever happens here is coming down to blind luck." }
    };

    // baseName-strip logic matches Robbery - Attempt's own hasGun check exactly (inventory keys
    // can carry a "(variant)" suffix, e.g. "Gun (Compact)" - only the part before that matters).
    function inventoryHasGun(data) {
        const inv = data.inventory || {};
        for (const key in inv) {
            if (!inv.hasOwnProperty(key) || inv[key] <= 0) continue;
            const parenIndex = key.indexOf(" (");
            const baseName = (parenIndex > 0 && key.endsWith(")")) ? key.substring(0, parenIndex) : key;
            if (baseName.toLowerCase() === "gun") return true;
        }
        return false;
    }

    // Preview-only estimate of a robbery category's odds, for the job-picker screen - mirrors
    // Robbery - Attempt's own failThreshold/rawRollNeeded math (this category's own base
    // difficulty scaled by the current Block's multiplier, then skill + a flat +20 gun bonus
    // subtracted off) so what the panel tells the player before they commit matches what the
    // real roll does moments later. Returns null if the current Block's own multiplier hasn't
    // loaded yet.
    // effectiveHasGun defaults to "owns one AND the robberyUseGun toggle is on" - passed
    // explicitly (rather than read from the module var directly in here) so callers previewing a
    // hypothetical toggle state (e.g. re-rendering right after a toggle click) don't have to wait
    // for a full data refresh first.
    function estimateRobberyDifficulty(data, categoryKey, effectiveHasGun) {
        if (!currentBlockInfo || typeof currentBlockInfo.difficultyMultiplier !== "number") return null;
        const baseDifficulty = ROBBERY_CATEGORY_BASE_DIFFICULTY.hasOwnProperty(categoryKey) ? ROBBERY_CATEGORY_BASE_DIFFICULTY[categoryKey] : 50;
        const failThreshold = Math.round(baseDifficulty * currentBlockInfo.difficultyMultiplier);
        const skillBonus = (data.skills && data.skills.Robbery) || 0;
        const gunBonus = effectiveHasGun ? 20 : 0;
        const neededRoll = failThreshold - skillBonus - gunBonus;
        return {
            tier: classifyDifficulty(neededRoll),
            skillBonus: skillBonus,
            hasGun: effectiveHasGun
        };
    }

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

    // Same present-viewers source as Pickpocket, but no "already tried"/"laying low"
    // exclusions - there's no reason those should block a trade.
    function getTradeCandidates(data) {
        let list = data.presentViewers || [];
        if (data.isTestAccount && !list.some(function (v) { return v.userId === currentUserId; })) {
            list = list.concat([{ userId: currentUserId, name: data.name }]);
        }
        return list.filter(function (v) {
            return v.userId !== currentUserId || !!data.isTestAccount;
        });
    }

    // ============================
    // BLOCK WAR - full-panel takeover for anyone Streamer.bot assigned to a team (checked by
    // userId membership in data.blockWar.teams.Wagner / .Ezquerra - team assignment happens once,
    // at war start, off everyone present in chat at that moment; someone who joins chat after the
    // war has already started simply isn't a participant and never sees this). Three states:
    //   1. phase "voting", not yet voted - show which block they're on and the Attack/Defend
    //      buttons plus a live countdown.
    //   2. phase "voting", already voted - buttons gone, just the block + "hang tight" message,
    //      per the user's spec ("the options disappear... they're just left with the block war
    //      image").
    //   3. phase "combat" or "ended" - the fight itself plays out on stream (OBS cinematic text +
    //      stroke filters), so the panel just shows a simple "watch the stream" holding message;
    //      once phase is "ended" it also shows the final win/loss line for their own block.
    // ============================
    function renderBlockWarTakeover(data, myUserId) {
        const bw = data.blockWar;
        const onWagner = bw.teams && Array.isArray(bw.teams.Wagner) && bw.teams.Wagner.indexOf(myUserId) !== -1;
        const onEzquerra = bw.teams && Array.isArray(bw.teams.Ezquerra) && bw.teams.Ezquerra.indexOf(myUserId) !== -1;
        if (!onWagner && !onEzquerra) return false; // not a participant in this war - fall through to the normal sheet

        const myTeamKey = onWagner ? "Wagner" : "Ezquerra";
        const teamDisplayName = onWagner ? "Wagner Block" : "Ezquerra Block";
        const teamClass = onWagner ? "blockwar-team-wagner" : "blockwar-team-ezquerra";

        const myVote = bw.votes ? bw.votes[myUserId] : null;
        // blockWarVotePending covers the gap between clicking and the vote actually landing in a
        // fresh blockWar.votes fetch - once it does, clear the optimistic flag so a stale pending
        // state can never outlive the real confirmation.
        if (myVote && blockWarVotePending) blockWarVotePending = null;
        const effectiveVote = myVote || blockWarVotePending;

        // Teams are auto-assigned, not chosen - the image just confirms which block this viewer
        // already belongs to; the actual choice (further below) is Attack vs Defend, never which
        // side to fight for.
        const teamImageUrl = BLOCKWAR_BASE_URL + "/" + encodeURIComponent(teamDisplayName + ".png");

        let html = '<div class="blockwar-title">BLOCK WAR</div>' +
            '<img class="blockwar-team-image" src="' + teamImageUrl + '" alt="' + teamDisplayName + '" />' +
            '<div class="blockwar-team-name ' + teamClass + '">You are defending ' + teamDisplayName + '</div>';

        if (bw.phase === "voting") {
            if (effectiveVote) {
                html += '<div class="blockwar-status-line">You chose to <strong>' + effectiveVote.toUpperCase() + '</strong>. Hang tight - the vote closes soon and the war plays out on stream.</div>';
                document.getElementById("content").innerHTML = html;
                return true;
            }

            const secondsLeft = bw.votingEndsAt ? Math.max(0, bw.votingEndsAt - Math.floor(Date.now() / 1000)) : 0;
            html += '<div class="blockwar-countdown">VOTE NOW - ' + secondsLeft + 's left</div>' +
                '<div class="blockwar-buttons">' +
                '<button class="panel-shop-button" id="blockwar-attack-btn">ATTACK</button>' +
                '<button class="panel-shop-button" id="blockwar-defend-btn">DEFEND</button>' +
                '</div>' +
                '<div class="blockwar-status-line">Attack adds to ' + teamDisplayName + '\'s Attack score. Defend adds to its Defense score. One vote each - choose wisely.</div>';

            document.getElementById("content").innerHTML = html;

            function castVote(choice) {
                const attackBtn = document.getElementById("blockwar-attack-btn");
                const defendBtn = document.getElementById("blockwar-defend-btn");
                if (attackBtn) attackBtn.disabled = true;
                if (defendBtn) defendBtn.disabled = true;
                blockWarVotePending = choice;
                renderBlockWarTakeover(data, myUserId);
                queueAction("blockWarVote", { choice: choice });
            }

            const attackBtn = document.getElementById("blockwar-attack-btn");
            if (attackBtn) attackBtn.addEventListener("click", function () { castVote("attack"); });
            const defendBtn = document.getElementById("blockwar-defend-btn");
            if (defendBtn) defendBtn.addEventListener("click", function () { castVote("defense"); });

            return true;
        }

        if (bw.phase === "combat") {
            html += '<div class="blockwar-status-line">The battle is underway - watch the stream to see how ' + teamDisplayName + ' holds up!</div>';
            document.getElementById("content").innerHTML = html;
            return true;
        }

        if (bw.phase === "ended") {
            let resultLine;
            if (bw.winner === "brokenup") {
                resultLine = "The Judges broke up the war before it was settled. Everyone involved lost 20 Kudos.";
            } else if (bw.winner === myTeamKey) {
                resultLine = teamDisplayName + " WON the Block War! Everyone on this block earned 50 Kudos.";
            } else if (bw.winner) {
                resultLine = teamDisplayName + " lost the Block War.";
            } else {
                resultLine = "The Block War has ended.";
            }
            html += '<div class="blockwar-status-line">' + resultLine + '</div>';
            document.getElementById("content").innerHTML = html;
            return true;
        }

        return false;
    }

    // ============================
    // WALLY SQUAD - private reveal, only ever reaches the ONE viewer Big Heist - Wally Squad -
    // Assign secretly picked (delivered via the normal per-user panelOverride mechanism, mode
    // "wallySquadReveal" - nobody else's panel ever receives this). Uses the SAME live task list
    // (data.bigHeist.tasks) the normal Big Heist crew view already renders from, so there's no
    // separate data source to keep in sync. Two pieces, both optional/independent:
    //   1. Blend in - join/leave a task exactly like any ordinary perp (same joinTask/unassignTask
    //      actions everyone uses). Every join stacks +20 hidden difficulty onto that task; staying
    //      on it through to the roll auto-succeeds it, no roll, nobody the wiser; leaving early
    //      forfeits the guarantee and leaves the stacked difficulty behind for real. Repeatable,
    //      any task, any number of times - this IS the infiltrate mechanic now, there's no
    //      separate one-shot covert join any more.
    //   2. Replace an already-placed item with a dud - available on any task, any number of times
    //      (the backend action itself silently no-ops if that slot has nothing real placed yet).
    // Dob someone in appears separately, once panelOverride.dobInAvailable is true (set at the end
    // of the heist, win or lose - see Big Heist - Getaway Success/Fail).
    // ============================
    function renderWallySquadReveal(data) {
        const ov = data.panelOverride || {};

        const bh = data.bigHeist;
        const tasks = (bh && Array.isArray(bh.tasks)) ? bh.tasks : [];

        let html = '<img class="wally-badge" src="' + UI_BASE_URL + '/informant-badge.png" alt="Informant">' +
            '<div class="wally-title">YOU ARE WALLY SQUAD</div>' +
            '<div class="wally-status-line">Shuuush... Nobody else can see this screen. Today, you\'re secretly trying to sink tonight\'s Big Heist from the inside - infiltrate a task, or quietly swap a placed item for a dud. If the crew accuses you correctly before the finale, it all gets undone and you lose Kudos and a few Creds.</div>' +
            '<div class="wally-status-line">But... stay hidden and you bank a Judge reward instead! Who wouldn\'t want the Judges owing you a favour? Even if you don\'t manage to break up the heist, you\'ll get a chance to snitch on one of the others - you\'re looking for the one with the highest Kudos, the Judges pay well for netting the worst of the perps.</div>';

        if (ov.dobInAvailable) {
            const dobInCrew = Array.isArray(ov.dobInCrew) ? ov.dobInCrew : [];
            html += '<div class="wally-section-title">You got away clean with the loot. One last move - dob someone in to the Judges?</div><div class="wally-buttons">';
            dobInCrew.forEach(function (member) {
                const disabled = wallySquadDobInPending ? ' disabled' : '';
                html += '<button class="wally-action-button wally-dobin-button" data-dobin-target="' + escapeHtml(member.userId) +
                    '" data-dobin-platform="' + escapeHtml(member.platform || "twitch") + '"' + disabled + '>Dob in ' + escapeHtml(member.userName) + '</button>';
            });
            html += '</div>';
        }

        if (tasks.length === 0) {
            html += '<div class="wally-status-line">No active heist tasks right now. Keep an eye here to foil a Heist when it starts.</div>' +
                '<div class="wally-status-line">Note, you can\'t do any illegal activities while being a Judge informant (for the period of this stream).</div>';
            document.getElementById("content").innerHTML = html;
            return;
        }

        // Blend in requires being in the crew first, same as any ordinary perp (Big Heist - Task
        // Assignment rejects a join otherwise) - Wally Squad's covert Infiltrate/Replace tools
        // above don't need this, but this one rides the real joinTask/unassignTask actions, so
        // it's subject to the same crew-membership gate. Uses the same bh.isInCrew flag/button
        // pattern as the normal crew panel's own "Join the Crew" prompt.
        if (!bh.isInCrew) {
            html += '<div class="wally-section-title">Blend in - join a task like any other perp, then leave to quietly ☠️sabotage it (stacks each time):</div>';
            html += '<div class="wally-status-line">You need to join the crew first before you can pick a task this way.</div>';
            html += '<div class="wally-buttons"><button class="wally-action-button" id="wally-blend-joincrew-button">Join the Crew</button></div>';
        } else {
            html += '<div class="wally-section-title">Blend in - join a task like any other perp, then leave to quietly ☠️sabotage it (stacks each time):</div><div class="wally-buttons">';
            tasks.forEach(function (task) {
                // Sabotage stack indicator (2026-08-15, per user request - replaces the raw
                // difficulty number originally shown here) - only Wally's own poll response ever
                // carries wallyEffectiveDifficulty (see Big Heist - Sync To Extension), so this is
                // naturally absent/null for everyone else's panel. Each +20 stacked onto a task
                // (Big Heist - Task Assignment adds one +20 per Wally join) becomes one skull, so
                // "how sabotaged is this task right now" reads at a glance without a number.
                let diffSuffix = "";
                if (task.wallyEffectiveDifficulty !== undefined && task.wallyEffectiveDifficulty !== null) {
                    const stackCount = Math.max(0, Math.round((task.wallyEffectiveDifficulty - task.difficulty) / 20));
                    if (stackCount > 0) diffSuffix = ' <span class="wally-sabotage-skulls">' + "☠️".repeat(stackCount) + '</span>';
                }
                if (task.isMine) {
                    html += '<button class="wally-action-button wally-blend-button" data-wally-blend-leave="' + escapeHtml(task.taskKey) + '">Leave ' + escapeHtml(task.taskName || humanize(task.taskKey)) + diffSuffix + '</button>';
                } else if (task.taskFull) {
                    html += '<button class="wally-action-button" disabled>' + escapeHtml(task.taskName || humanize(task.taskKey)) + diffSuffix + ' (full)</button>';
                } else {
                    html += '<button class="wally-action-button wally-blend-button" data-wally-blend-join="' + escapeHtml(task.taskKey) + '">Join ' + escapeHtml(task.taskName || humanize(task.taskKey)) + diffSuffix + '</button>';
                }
            });
            // Same real quitCrew action the normal crew panel's own "Quit the Crew" button uses -
            // drops any task they're currently on too (Big Heist - Quit Crew already handles that),
            // so this also works as a quick way out of a task if they'd rather not use the specific
            // task's Leave button above. Symmetric with the "Join the Crew" prompt shown when not
            // yet in the crew.
            html += '<button class="wally-action-button" id="wally-blend-quitcrew-button">Leave the Crew</button>';
            html += '</div>';
        }

        // Hidden until they've joined the crew (same bh.isInCrew gate as Blend In above) - showing
        // a "replace item" option before they're even in the crew doesn't make narrative sense and
        // was a real tell (the button existing at all when nothing about them looks like a perp yet).
        if (bh.isInCrew) {
            html += '<div class="wally-section-title">Replace a placed item with a dud (only works if something real is already there):</div><div class="wally-buttons">';
            tasks.forEach(function (task) {
                html += '<button class="wally-action-button wally-replace-button" data-wally-replace-task="' + escapeHtml(task.taskKey) + '" data-wally-replace-slot="required">Required item - ' + escapeHtml(task.taskName || humanize(task.taskKey)) + '</button>';
                html += '<button class="wally-action-button wally-replace-button" data-wally-replace-task="' + escapeHtml(task.taskKey) + '" data-wally-replace-slot="bonus">Bonus item - ' + escapeHtml(task.taskName || humanize(task.taskKey)) + '</button>';
            });
            html += '</div>';
        }

        document.getElementById("content").innerHTML = html;

        const wallyBlendJoinCrewButton = document.getElementById("wally-blend-joincrew-button");
        if (wallyBlendJoinCrewButton) {
            wallyBlendJoinCrewButton.addEventListener("click", function () {
                wallyBlendJoinCrewButton.disabled = true;
                queueAction("joinCrew", {});
            });
        }
        const wallyBlendQuitCrewButton = document.getElementById("wally-blend-quitcrew-button");
        if (wallyBlendQuitCrewButton) {
            wallyBlendQuitCrewButton.addEventListener("click", function () {
                wallyBlendQuitCrewButton.disabled = true;
                queueAction("quitCrew", {});
            });
        }
        document.querySelectorAll("[data-wally-blend-join]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const taskKey = btn.getAttribute("data-wally-blend-join");
                btn.disabled = true;
                queueAction("joinTask", { taskKey: taskKey });
            });
        });
        document.querySelectorAll("[data-wally-blend-leave]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const taskKey = btn.getAttribute("data-wally-blend-leave");
                btn.disabled = true;
                queueAction("unassignTask", { taskKey: taskKey });
            });
        });
        document.querySelectorAll(".wally-replace-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                btn.disabled = true;
                queueAction("wallySquadReplaceItem", {
                    taskKey: btn.getAttribute("data-wally-replace-task"),
                    slotType: btn.getAttribute("data-wally-replace-slot")
                });
            });
        });
        document.querySelectorAll(".wally-dobin-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const targetUserId = btn.getAttribute("data-dobin-target");
                const targetPlatform = btn.getAttribute("data-dobin-platform");
                document.querySelectorAll(".wally-dobin-button").forEach(function (b) { b.disabled = true; });
                wallySquadDobInPending = targetUserId;
                queueAction("wallySquadDobIn", { targetUserId: targetUserId, targetPlatform: targetPlatform });
            });
        });
    }

    // ============================
    // SNITCH LINE - full-panel takeover shown to EVERY viewer (whole-audience, not gated to crew
    // like Block War) for the WHOLE heist once Wally Squad is assigned - not a fixed vote window
    // like the retired Investigate Vote. See Big Heist - Wally Squad - Snitch Line - Cast for the
    // real rules; this view only ever needs to handle the ORDINARY-perp case (one live pick, freely
    // changeable) since Wally Squad's own multi-vote ability is only ever exercised by them, and
    // they never see this screen at all - their private reveal (renderWallySquadReveal) wins first,
    // checked in fetchMyData ahead of this takeover.
    //
    // You can change who you're accusing as many times as you like, right up until the person
    // you're CURRENTLY accusing hits 5 accusations and gets resolved - at that point you're locked
    // in for the rest of the heist (Cast rejects anything more from you). Candidates are the live
    // heist crew (data.snitchLine.candidates, refreshed on every vote), minus anyone already
    // resolved (data.snitchLine.resolvedTargets) - once a call's been made on someone, further
    // accusations against them can't do anything, so they're dropped from the list entirely.
    // ============================
    function renderSnitchLineTakeover(data, myUserId) {
        const sl = data.snitchLine;
        if (!sl || !sl.active) return false;

        const myVoteList = sl.votes ? sl.votes[myUserId] : null;
        const myVote = myVoteList && myVoteList.length > 0 ? myVoteList[0] : null;
        if (myVote && snitchLineVotePending) snitchLineVotePending = null;
        const effectiveVote = myVote || snitchLineVotePending;

        const resolvedTargets = sl.resolvedTargets || {};

        let html = '<div class="wally-vote-title">SNITCH LINE</div>' +
            '<div class="wally-vote-status-line">Think someone in tonight\'s crew is Wally Squad, working against the job? Dob them in to the Judges. You can change your mind any time - but the moment your pick hits 5 accusations and a call is made, you\'re locked in for the rest of the heist.</div>';

        if (effectiveVote && resolvedTargets[effectiveVote]) {
            // Their pick already got resolved - they're locked in, no more voting for them.
            const accused = (sl.candidates || []).find(function (c) { return c.userId === effectiveVote; });
            html += '<div class="wally-vote-status-line">You called it on <strong>' + escapeHtml(accused ? accused.userName : effectiveVote) + '</strong> - the Judges have already acted on that. You\'re locked in for the rest of this heist.</div>';
            document.getElementById("content").innerHTML = html;
            return true;
        }

        const openCandidates = (sl.candidates || []).filter(function (c) { return !resolvedTargets[c.userId]; });

        if (effectiveVote) {
            const accused = openCandidates.find(function (c) { return c.userId === effectiveVote; });
            html += '<div class="wally-vote-status-line">Currently accusing <strong>' + escapeHtml(accused ? accused.userName : effectiveVote) + '</strong>. Click a different name below to change your mind.</div>';
        }

        html += '<div class="wally-vote-buttons">';
        openCandidates.forEach(function (c) {
            const isCurrent = c.userId === effectiveVote;
            html += '<button class="wally-vote-button' + (isCurrent ? ' wally-vote-button-current' : '') + '" data-suspect="' + escapeHtml(c.userId) + '"' + (isCurrent ? ' disabled' : '') + '>' + escapeHtml(c.userName) + (isCurrent ? ' (current)' : '') + '</button>';
        });
        html += '</div>';

        document.getElementById("content").innerHTML = html;

        document.querySelectorAll(".wally-vote-button").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const targetUserId = btn.getAttribute("data-suspect");
                snitchLineVotePending = targetUserId;
                renderSnitchLineTakeover(data, myUserId);
                queueAction("wallySquadSnitchLine", { targetUserId: targetUserId });
            });
        });

        return true;
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

        // Block War takes over the WHOLE panel (not just rest-of-content) for anyone assigned to
        // a team - checked first, before any of the normal character-sheet rendering below, and
        // returns early on a hit. renderBlockWarTakeover itself returns false (falls through to
        // the normal sheet) for a non-participant or once blockWar.active is false.
        if (data.blockWar && data.blockWar.active && renderBlockWarTakeover(data, data.userId)) {
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

        // Toast-style notice (great/good roll outcomes, insufficient-funds) - checked client-side
        // for expiry same as panelOverride, prepended regardless of which view is currently
        // showing since it's about something that just happened to the player, not tied to
        // whatever section they happen to be looking at. Hoisted up here (used to be declared much
        // further down, right before its own rendering block) so the Rob/Pickpocket button section
        // below can also read it - per user's request, those buttons should come back the instant
        // the summary text (this notice, or the robbery result cinematic) actually disappears,
        // rather than on some separate fixed timer that could drift out of sync with it.
        var hasFreshNotice = data.pickpocketNotice && data.pickpocketNotice.message
            && (!data.pickpocketNotice.expiresAt || data.pickpocketNotice.expiresAt > nowSeconds);

        // Real bug reported: panel stuck forever on "The X job is underway..." after Robbery -
        // Attempt REJECTED the job server-side (block/category mismatch, laying low, per-stream
        // cap, a busy-lock retry, etc.) rather than resolving it - those reject paths post a
        // notice via this same pickpocketNotice field instead of a robberyResult override, and
        // robberyPending was previously only ever cleared by that override arriving. A notice
        // landing while still "pending" can only mean the attempt was rejected, never a real
        // in-progress job, so it's always safe to clear the pending screen here.
        if (hasFreshNotice && robberyPending) {
            robberyPending = false;
            robberyPendingCategory = null;
        }

        // Same reasoning as robberyPending above - Pickpocket - Attempt's own notice (success,
        // "not enough creds", a judge spot-check overwrite, whatever) is the ONLY signal the
        // client gets that the attempt actually resolved, since there's no separate cinematic
        // override for pickpocketing. Any fresh notice arriving always means it's done.
        if (hasFreshNotice && pickpocketPending) {
            pickpocketPending = false;
            pickpocketPendingTargetName = null;
        }

        // Same reasoning again for Graffiti - Crime - Graffiti Attempt's own notice (success,
        // capped out, laying low, wrong size, whatever) is the only signal the client gets that
        // the attempt actually resolved.
        if (hasFreshNotice && graffitiPending) {
            graffitiPending = false;
        }

        // Build the base skeleton (top-row + rest-of-content containers) if it doesn't exist yet -
        // this handles both the very first successful render, and recovery after an error/loading
        // message temporarily replaced the whole content area and wiped these containers out.
        if (!document.getElementById("top-row")) {
            document.getElementById("content").innerHTML =
                '<div class="top-row" id="top-row"></div><div id="rest-of-content"></div>';
            lastKnownTopRowMode = null;
            // Also drop the rest-of-content freeze key (added 2026-08-18) - without this, a full
            // panel takeover that replaces content.innerHTML wholesale (M.A.C. Search results,
            // Wally Squad reveal, etc) leaves lastKnownContentKey holding whatever freeze key was
            // computed BEFORE the takeover. Once the takeover ends and this skeleton gets rebuilt
            // fresh and empty, the very next contentFreezeKey computed below can coincidentally
            // match that stale value (nothing about the Judge Home Screen necessarily changed) and
            // the freeze check short-circuits before rest-of-content is ever populated again -
            // reported as "click Back after searching, goes back to the judge screen but the
            // search box is gone." Forcing a null here guarantees the very next render always
            // actually (re)populates rest-of-content instead of trusting a key that predates a
            // full wipe.
            lastKnownContentKey = null;
        }

        const isPending = !!data.pendingMugshotPick;

        // Dedicated Judge Home Screen - shown instead of the normal crime-game sheet whenever this
        // account is assigned to a Judge character (via the streamer's Stream Deck Assign Judge
        // flow) AND that character is currently on screen (Sync To Extension checks OBS visibility
        // the same way Judge selection already does elsewhere). Stops applying the instant either
        // condition goes away - unassigned, or their character steps out of the scene - reverting
        // them to their normal own character sheet with no special handling needed.
        const isPlayingJudgeScreen = !!(data.assignedJudgeName && data.judgeIsPlaying);
        // A registered Judges-group member who ISN'T the one currently playing still gets the
        // Judge-styled panel (per the user's explicit request - "should look like the Judge
        // panel") rather than their own personal mugshot. Always false while isPlayingJudgeScreen
        // is true (Sync To Extension guarantees the two are mutually exclusive server-side).
        const isWatchingJudgeScreen = !!data.isWatchingJudge;
        // Same idea, for the criminal side of the RPG - a playing Quin/Flink gets their own
        // portrait+name screen too, per the user's "similar panel" request.
        const isPlayingPerpScreen = !!(data.assignedPerpName && data.perpIsPlaying);
        // A perp assigned to a specific crew character (Quin/Flink) who ISN'T the one currently
        // playing - per the user's explicit request, still shows THEIR OWN character portrait
        // (unlike a watching Judge, which shows a generic badge - Perps only has 2 named
        // characters, so "watching as Quin" is meaningful in a way "watching as some Judge" isn't
        // for a pool of 9). Always false while isPlayingPerpScreen is true (Sync To Extension
        // guarantees the two are mutually exclusive server-side, same as the Judge pair above).
        // Deliberately only affects the top-row portrait, not the name/status area or the content
        // below - unlike a watching Judge, a watching Perp isn't in any special restricted mode,
        // they still see their normal crime-economy panel (shop/heat/inventory/etc).
        const isWatchingPerpScreen = !!(data.assignedPerpName && !data.perpIsPlaying);

        // The backend only ever re-checks an override's expiresAt when Sync To Extension happens
        // to run again for some OTHER reason (a purchase, a crime, anything) - if nothing else
        // triggers a sync, the 5-minute timer never actually gets re-validated server-side and the
        // override just sits there indefinitely. Checking expiresAt here too, independent of
        // whatever the backend last sent, means the panel reverts on time regardless of whether
        // anything else happens to nudge the backend into re-checking it.
        const overrideMode = (data.panelOverride && data.panelOverride.mode
            && (!data.panelOverride.expiresAt || data.panelOverride.expiresAt > Math.floor(Date.now() / 1000)))
            ? data.panelOverride.mode : null;

        // WALLY SQUAD's private reveal takes over the WHOLE panel, same early-return treatment as
        // Block War above - completely separate from the rest of this function's normal
        // character-sheet priority chain (top-row name/status area, findersFee/shop/etc) rather
        // than threaded through it, since this is a one-person-only alert with its own dedicated
        // buttons, not a variant of the normal sheet. See renderWallySquadReveal below.
        if (overrideMode === "wallySquadReveal") {
            renderWallySquadReveal(data);
            return;
        }

        // M.A.C. Search results - a Judges-only search takeover, same early-return treatment as
        // Wally Squad above. Only ever set on the panelOverride of the Judge who actually ran the
        // search (see "M.A.C. - Panel Search" in Streamer.bot), so no other viewer's panel is
        // affected. See renderMacSearchResults below.
        if (overrideMode === "macSearchResults") {
            renderMacSearchResults(data);
            return;
        }

        // M.A.C. Browse (People/Places, added 2026-08-18) - a spelling-proof alternative to the
        // free-text search above, for when a Judge knows roughly who/where they mean but not the
        // exact spelling. Two screens: pick a letter (macBrowseAlphabet), then pick a result
        // starting with that letter (macBrowseResults) - same early-return treatment as
        // macSearchResults. See renderMacBrowseAlphabet/renderMacBrowseResults below.
        if (overrideMode === "macBrowseAlphabet") {
            renderMacBrowseAlphabet(data);
            return;
        }
        if (overrideMode === "macBrowseResults") {
            renderMacBrowseResults(data);
            return;
        }

        // A Judge's own read-out of ONE search (or browse) result's full record (added
        // 2026-08-18) - same early-return treatment as macSearchResults above, only ever reached
        // by explicitly tapping a named result. See renderMacRecordDetail below.
        if (overrideMode === "macRecordDetail") {
            renderMacRecordDetail(data);
            return;
        }

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
            showTradePicker = false;

            // Same belt-and-braces reset for the two *Pending placeholders, EXCEPT when the
            // arriving override is robberyResult - that one clears robberyPending itself, a
            // couple lines up, fingerprinted by expiresAt so the staged cinematic can tell a
            // fresh result from a still-mid-animation one; clearing it unconditionally here too
            // would race harmlessly with that, but there's no reason to duplicate it. Any OTHER
            // override (oiWarning, arrestAlert, a shop rejection, etc) arriving is real proof the
            // pending state is stale/done, so drop it immediately rather than only on the next
            // pickpocketNotice/robberyResult - this is what stops a pending flag that somehow
            // never got its own clearing signal from silently blocking every future override's
            // content forever (the root cause behind "pressed Arrest/Oi and nothing happened").
            if (overrideMode !== "robberyResult") {
                robberyPending = false;
                robberyPendingCategory = null;
            }
            pickpocketPending = false;
            pickpocketPendingTargetName = null;
            graffitiPending = false;
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

        // Lost the mugshot claim race - someone else's File.Move won first. Become Perp's own
        // registration guard used to make "!becomeperp again" a dead end for this exact user (see
        // isRetryPick in Heist - Become Perp), so this used to require a manual chat retype with
        // no real guarantee it would even work. Now it's just a button: TRY AGAIN re-runs
        // becomePerp server-side, which redraws 3 fresh candidates and clears this notice itself
        // (Become Perp sets mugshotPickError back to "" as part of the retry path) - no client-side
        // dismiss timer needed, the notice just disappears on the next successful poll.
        if (data.mugshotPickError && data.mugshotPickError.message) {
            document.getElementById("rest-of-content").innerHTML =
                '<div class="alert-frame-purple alert-takeover-box">' +
                '<div class="section-title">That mugshot\'s taken.</div>' +
                '<div class="juan-quote">' + escapeHtml(data.mugshotPickError.message) + '</div>' +
                '<button class="panel-urgent-button" id="panel-mugshot-try-again">Try Again</button>' +
                '</div>';

            const tryAgainBtn = document.getElementById("panel-mugshot-try-again");
            if (tryAgainBtn) {
                tryAgainBtn.addEventListener("click", function () {
                    tryAgainBtn.disabled = true;
                    queueAction("becomePerp", {});
                });
            }
            return;
        }

        // Big Heist vote round - takes over the whole panel the same way the running-heist
        // cinematic below does, since there's nothing else useful to show while 4 candidates are
        // up for a vote. Bagman choice/result above still take priority (same reasoning as the
        // heistRunning takeover just below - those need to keep working regardless). Mutually
        // exclusive with heistRunning: a heist can't be running before its own vote has resolved.
        if (data.heistVote && data.heistVote.active) {
            renderHeistVotePicker(data);
            return;
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
                // Was a bare relative filename ("heist-bankvault.png") with no BASE_URL prefix -
                // the ONLY reason panel.zip still had to bundle every heist banner image locally.
                // On Twitch, a relative src resolves against Twitch's own Asset Hosting origin, so
                // this "worked" only because those exact files sat next to panel.html in the zip;
                // on the standalone/YouTube build it was silently broken the whole time (relative
                // to grumpybattersby.github.io/big-heist-extension/panelfiles/, where no such file
                // exists). Matches the already-correct prefixed usage at the vote-winner reveal.
                runningHtml += '<div class="heist-banner-frame"><img src="' + HEISTS_BASE_URL + '/' + HEIST_IMAGES[runningBh.heistKey] + '" alt="' + escapeHtml(runningBh.heistName || '') + '"></div>';
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

        // Any dedicated gameplay screen that should take priority over a playing/watching RPG
        // Perp's static portrait - jail/isocube, robbery (pending or the result cinematic),
        // pickpocket-pending, and now EVERY Juan's Emporium-related state (shop browser, finder,
        // item info, oi-warning, heat/offended denial, trade, shop entry pending) - covers the
        // exact same reported bug ("Juan's images don't show up, it sticks on the RPG perp
        // image") that was already fixed once for robbery/jail/pickpocket but missed the Juan's
        // flows entirely, since they all route through the generic overrideMode branch further
        // down. Deliberately EXCLUDES arrestAlert/distractAlert - the own-portrait-always-wins
        // rule established for Judges applies here too (a playing Perp being targeted by the
        // perp-game ARREST-vs-DISTRACT race still shows their own portrait with the button
        // underneath, not a generic alert graphic).
        const perpPortraitYieldsToOtherScreen = stillJailed || robberyPending || pickpocketPending
            || graffitiPending || showFinderPage || shopEntryPending || showShopBrowser
            || (overrideMode && overrideMode !== "arrestAlert" && overrideMode !== "distractAlert");

        if (isPlayingJudgeScreen) {
            // Own portrait always wins over the generic judge-icon.png alert graphic - a playing
            // Judge sees THEIR OWN character even while an arrest alert is live for them, per the
            // user's exact request ("The arrest button would come under that [picture+name]").
            const judgeTopKey = "judge-screen-" + data.assignedJudgeName;
            if (lastKnownTopRowMode !== judgeTopKey) {
                const judgeShortName = data.assignedJudgeName.replace(/^Judge\s+/i, '');
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame judge-portrait-frame"><img src="' + JUDGES_BASE_URL + '/' + encodeURIComponent(judgeShortName + ' Panel Image.png') + '" alt="' + escapeHtml(data.assignedJudgeName) + '"></div>';
                topRowHtml += '<div class="judge-name-title">' + escapeHtml(data.assignedJudgeName) + '</div>';
                topRowHtml += renderJudgeSkillsLine(data);
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = judgeTopKey;
            }
        } else if (isWatchingJudgeScreen) {
            // Most real watching Judges have no assignedJudgeName (the real Assign Judge clear
            // flow removes the character assignment but keeps group membership, per earlier
            // design) - for those, fall back to a generic Judge badge, same judge-icon.png the
            // arrest alert used to show. But when a specific character IS assigned (e.g. the
            // !mimic WatchingJudge flow, which - per the user's explicit request, symmetric with
            // WatchingPerp/Quin-Flink - assigns one of the 9 named Judges without the
            // debugForcePlaying bypass), show THEIR OWN portrait instead of the generic badge.
            const watchTopKey = "judge-watching-" + (data.assignedJudgeName || data.name);
            if (lastKnownTopRowMode !== watchTopKey) {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                if (data.assignedJudgeName) {
                    const watchingJudgeShortName = data.assignedJudgeName.replace(/^Judge\s+/i, '');
                    topRowHtml += '<div class="juan-frame judge-portrait-frame"><img src="' + JUDGES_BASE_URL + '/' + encodeURIComponent(watchingJudgeShortName + ' Panel Image.png') + '" alt="' + escapeHtml(data.assignedJudgeName) + '"></div>';
                    topRowHtml += '<div class="judge-name-title">' + escapeHtml(data.assignedJudgeName) + '</div>';
                } else {
                    topRowHtml += '<div class="juan-frame judge-portrait-frame judge-alert-yellow-border"><img src="' + UI_BASE_URL + '/judge-icon.png" alt="Judge"></div>';
                    topRowHtml += '<div class="judge-name-title">JUDGE ' + escapeHtml(data.name).toUpperCase() + '</div>';
                }
                topRowHtml += renderJudgeSkillsLine(data);
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = watchTopKey;
            }
        } else if (isPlayingPerpScreen && !perpPortraitYieldsToOtherScreen) {
            // Deliberately yields to the robbery cinematic/pending screens and the jail/isocube
            // screen below - those are dedicated gameplay visuals, not a generic alert graphic
            // like arrestAlert/distractAlert (where the own-portrait-always-wins rule from the
            // Judge branch above is correct). Without these exclusions a playing RPG Perp's own
            // portrait would sit there frozen through an entire robbery or jail stint, which is
            // exactly the bug the user reported ("the RPGPerp image just stays there all the
            // time" / cube screen never showing).
            const perpTopKey = "perp-screen-" + data.assignedPerpName;
            if (lastKnownTopRowMode !== perpTopKey) {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame judge-portrait-frame"><img src="' + PERPS_BASE_URL + '/' + encodeURIComponent(data.assignedPerpName + ' Panel Image.png') + '" alt="' + escapeHtml(data.assignedPerpName) + '"></div>';
                topRowHtml += '<div class="judge-name-title">' + escapeHtml(data.assignedPerpName) + '</div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = perpTopKey;
            }
        } else if (isWatchingPerpScreen && !perpPortraitYieldsToOtherScreen) {
            // Same portrait as the playing-perp branch above - just not currently "on" (no OBS
            // bypass in play), so no ON-DUTY-style framing needed here, the normal WANTED/CITIZEN
            // status badge below still applies as usual. Same robbery/jail exclusions as above,
            // for the same reason.
            const watchPerpTopKey = "perp-watching-" + data.assignedPerpName;
            if (lastKnownTopRowMode !== watchPerpTopKey) {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame judge-portrait-frame"><img src="' + PERPS_BASE_URL + '/' + encodeURIComponent(data.assignedPerpName + ' Panel Image.png') + '" alt="' + escapeHtml(data.assignedPerpName) + '"></div>';
                topRowHtml += '<div class="judge-name-title">' + escapeHtml(data.assignedPerpName) + '</div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = watchPerpTopKey;
            }
        } else if (isPending) {
            // Only rebuild the candidates skeleton on the actual transition INTO pending, not
            // every 15s poll while still pending - rebuilding every poll would wipe out an
            // already-successfully-loaded image (hiding it again via the blank img/display:none
            // skeleton) since only the first poll schedules a new load attempt below.
            if (lastKnownTopRowMode !== "pending") {
                let topRowHtml = '<div class="pending-pick-box">';
                topRowHtml += '<div class="pending-pick-instruction">Choose your mugshot:</div>';
                topRowHtml += '<div class="candidates-row">';
                for (let i = 1; i <= 3; i++) {
                    topRowHtml += '<div class="candidate-frame" id="candidate-frame-' + i + '">' +
                        '<div class="candidate-status" id="candidate-status-' + i + '">Preparing...</div>' +
                        '<img id="candidate-img-' + i + '" class="candidate-img-' + i + '" style="display:none">' +
                        '<div class="candidate-number">' + i + '</div>' +
                        '<button class="panel-shop-button candidate-choose-button" id="candidate-choose-' + i + '">Choose</button>' +
                        '</div>';
                }
                topRowHtml += '</div>';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "pending";
                currentCandidateHashes = data.candidateHashes || [];

                // Click-to-pick replacement for typing "!pickmugshot 1/2/3" in chat - sends the
                // exact same rawInput (a bare "1"/"2"/"3") that Heist - Pick Mugshot's chat
                // command parser already expects, via the new pickMugshot panel action type, so
                // Pick Mugshot itself needed zero changes. All 3 buttons disable immediately on
                // click (not just the clicked one) to prevent a second click on a different
                // candidate while the server-side pick is still in flight.
                for (let i = 1; i <= 3; i++) {
                    const chooseBtn = document.getElementById("candidate-choose-" + i);
                    if (chooseBtn) {
                        chooseBtn.addEventListener("click", function () {
                            for (let j = 1; j <= 3; j++) {
                                const otherBtn = document.getElementById("candidate-choose-" + j);
                                if (otherBtn) otherBtn.disabled = true;
                            }
                            queueAction("pickMugshot", { choice: String(i) });
                        });
                    }
                }

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
        } else if (overrideMode && overrideMode !== "arrestAlert" && overrideMode !== "distractAlert" && !(overrideMode === "robberyResult" && robberyResultDismissed)) {
            // arrestAlert/distractAlert are deliberately excluded from this generic override-art
            // top-row (falls through to the normal mugshot/status branch further down instead) -
            // per the user's explicit request: a watching Judge/perp should still see THEIR OWN
            // character up top even while the alert is live, exactly like a playing Judge already
            // does (see the "Own portrait always wins" comment above) - only the description and
            // button underneath change. Previously this showed a generic judge-icon.png/DISTRACT
            // placeholder instead, replacing their own mugshot entirely.
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
                // Includes the stage now (not just robberyCinematicKey) - the stolen-item popup
                // only shows once the reveal reaches its final stage, so the top row needs a
                // rebuild at that transition too, not just once at the very start of the job.
                ? "override-robberyResult-" + robberyCinematicKey + "-" + robberyCinematicStage
                : "override-" + overrideMode;
            if (lastKnownTopRowMode !== overrideTopRowKey) {
                const overrideImages = {
                    shop: UI_BASE_URL + "/juan-shop.png",
                    findersFee: UI_BASE_URL + "/juan-findersfee.png"
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
                    topRowHtml += '<div class="juan-frame item-info-frame alert-frame-purple"><img src="' + UI_BASE_URL + '/pickpocket-alert.png" alt="Pickpocket in progress"></div>';
                } else if (overrideMode === "heatDenied") {
                    // "show" = local/citywide heat too high (Sector Chief Judge Stohl's domain) -
                    // shows Stohl instead of the generic "shop closed" graphic, matching the OBS
                    // Heat Overflow cinematic. "personal" heat denial keeps the plain closed-shop
                    // image, since that's just Juan being cautious, not a Judge crackdown.
                    const heatSourceForTopRow = (data.panelOverride && data.panelOverride.heatSource) || "personal";
                    if (heatSourceForTopRow === "show") {
                        topRowHtml += '<div class="juan-frame alert-frame-purple"><img src="' + JUDGES_BASE_URL + '/' + encodeURIComponent("Stohl Mad.png") + '" alt="Judges are all over the area"></div>';
                    } else {
                        topRowHtml += '<div class="juan-frame alert-frame-purple"><img src="' + UI_BASE_URL + '/juan-closed.png" alt="Turned away"></div>';
                    }
                } else if (overrideMode === "offendedDenied") {
                    topRowHtml += '<div class="juan-frame alert-frame-purple"><img src="' + UI_BASE_URL + '/juan-closed.png" alt="Turned away"></div>';
                } else if (overrideMode === "robberyResult") {
                    // Location image stays up for the first part of the staged reveal, per user's
                    // original spec - "clear the panel and add the image of the place up the top."
                    // Streamer.bot's Robbery - Attempt sends locationImage as a bare filename
                    // (e.g. "robbery-bank.png"), same as ROBBERY_CATEGORIES used to - resolve it
                    // against ROBBERY_BASE_URL here rather than needing a server-side redeploy.
                    //
                    // Once the reveal reaches its final stage (loot is known), swap to a popup of
                    // the actual item stolen - per user's follow-up request. Robbery - Attempt only
                    // sets stolenItemImage on an item haul, not a cash-only job, so cash jobs keep
                    // showing the location image throughout (no picturable "item" to pop up there).
                    var rdForImage = robberyCinematicData || {};
                    var showStolenItem = robberyCinematicStage >= 4 && rdForImage.stolenItemImage;
                    var resolvedLocationImage = rdForImage.locationImage
                        ? (/^https?:\/\//i.test(rdForImage.locationImage) ? rdForImage.locationImage : ROBBERY_BASE_URL + "/" + rdForImage.locationImage)
                        : null;

                    if (showStolenItem) {
                        topRowHtml += '<div class="juan-frame item-info-frame robbery-frame"><img src="' + ITEMS_BASE_URL + '/' + encodeURIComponent(rdForImage.stolenItemImage) + '" alt="Stolen: ' + escapeHtml(rdForImage.jobLabel || "") + '"></div>';
                    } else {
                        topRowHtml += resolvedLocationImage
                            ? '<div class="juan-frame robbery-frame"><img src="' + resolvedLocationImage + '" alt="' + escapeHtml(rdForImage.jobLabel || "") + '"></div>'
                            : '<div class="juan-frame robbery-frame"><div class="mugshot-placeholder">' + escapeHtml(rdForImage.jobLabel || "") + '</div></div>';
                    }
                } else if (overrideMode === "tradeIncoming" || overrideMode === "tradeSent") {
                    // No dedicated art for this one - a plain placeholder frame is enough, same
                    // treatment as the "no image yet" itemInfo fallback.
                    topRowHtml += '<div class="juan-frame alert-frame-purple"><div class="mugshot-placeholder">TRADE</div></div>';
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
        } else if (pickpocketPending) {
            // Same idea as robberyPending above - instant feedback the instant a target is
            // picked, using the same pickpocket-alert.png art already used for the OTHER
            // direction (oiWarning, when someone else is pickpocketing YOU).
            const pickpocketPendingKey = "pickpocket-pending-" + (pickpocketPendingTargetName || "");
            if (lastKnownTopRowMode !== pickpocketPendingKey) {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame item-info-frame alert-frame-purple"><img src="' + UI_BASE_URL + '/pickpocket-alert.png" alt="Pickpocket in progress"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = pickpocketPendingKey;
            }
        } else if (graffitiPending) {
            // Same instant-feedback treatment as pickpocketPending above, using Tag icon.png in
            // place of pickpocket-alert.png. No target/category to fingerprint the key on (a size
            // pick is enough to know it's pending), so a single static key is enough here.
            if (lastKnownTopRowMode !== "graffiti-pending") {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame item-info-frame alert-frame-purple"><img src="' + UI_BASE_URL + '/tag-icon.png" alt="Graffiti in progress"></div>';
                topRowHtml += '</div>';

                document.getElementById("top-row").innerHTML = topRowHtml;
                lastKnownTopRowMode = "graffiti-pending";
            }
        } else if (showFinderPage) {
            // Same juan-shop.png treatment as the shop browser - this is still a Juan's
            // Emporium interaction, just the search step of the finder flow specifically.
            if (lastKnownTopRowMode !== "client-finder") {
                let topRowHtml = '<div class="stacked-panel">';
                topRowHtml += '<div id="name-status-area"></div>';
                topRowHtml += '<div class="juan-frame"><img src="' + UI_BASE_URL + '/juan-shop.png" alt="Juan\'s Emporium"></div>';
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
                topRowHtml += '<div class="juan-frame"><img src="' + UI_BASE_URL + '/juan-shop.png" alt="Juan\'s Emporium"></div>';
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
                topRowHtml += '<div class="juan-frame"><img src="' + UI_BASE_URL + '/juan-shop.png" alt="Juan\'s Emporium"></div>';
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
                topRowHtml += '<img src="' + UI_BASE_URL + '/isocube.png" alt="ISOCUBE">';
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

        if (isPlayingJudgeScreen) {
            // Real account name + an ON DUTY badge instead of the crime-game WANTED/CITIZEN status
            // badge, which has no meaning for a Judge - the RPG character name itself already sits
            // under the portrait above, built into the top-row markup.
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
            nameStatusHtml += '<div class="status-badge status-judge-duty">ON DUTY</div>';
        } else if (isWatchingJudgeScreen) {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
            nameStatusHtml += '<div class="status-badge status-judge-duty">WATCHING</div>';
        } else if (overrideMode === "shop") {
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
        } else if (overrideMode === "distractAlert") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' spots a chance to help...</div>';
        } else if (overrideMode === "heatDenied") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' is turned away at the door...</div>';
        } else if (overrideMode === "offendedDenied") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' has offended Juan...</div>';
        } else if (overrideMode === "tradeIncoming") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' has an offer waiting...</div>';
        } else if (overrideMode === "tradeSent") {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + ' is waiting on a reply...</div>';
        } else if (overrideMode === "robberyResult" && !robberyResultDismissed) {
            // Deliberately static/generic here - this area only rebuilds on a top-row mode
            // transition, not per cinematic stage, so the actual staged narrative text all lives
            // in the content area below instead, which does fully re-render each stage.
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
        } else if (robberyPending) {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
        } else if (pickpocketPending) {
            nameStatusHtml = '<div class="name-row">' + escapeHtml(data.name) + '</div>';
        } else if (graffitiPending) {
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
        //
        // The Judge Home Screen (added 2026-08-18, fixed same day) needs the exact same freeze -
        // its new M.A.C. Search box is another text input, and without a freeze key this branch
        // was rebuilding on every single poll (a plain Judge Home Screen has no other freeze
        // condition covering it), which recreated the <input> from scratch each time and threw
        // away whatever the Judge had typed plus their cursor focus - reported as "loses focus
        // all the time and doesn't submit properly." Frozen while on the plain judge-home view
        // (not mid-arrestAlert, which still needs to interrupt immediately), and - same reasoning
        // as showFinderPage above - folds in pickpocketNotice's expiresAt so a fresh "no results"
        // toast from a search can still break through and render.
        const judgeHomeNoticeKey = (data.pickpocketNotice && data.pickpocketNotice.expiresAt) || 0;
        // Folds in the macSearch feature flag too (added 2026-08-18) - without this, toggling the
        // Judge Search flag off/on while a Judge is already sitting on the plain Judge Home Screen
        // wouldn't actually show/hide the search box until some OTHER freeze-breaking event (a
        // fresh notice, an arrestAlert) happened to come along and force a rebuild.
        const judgeHomeFlagKey = featureOn(data, "macSearch") ? "1" : "0";
        const contentFreezeKey = overrideMode === "findersFee"
            ? "findersFee-" + ((data.panelOverride && data.panelOverride.itemName) || "") + "-" + ((data.panelOverride && data.panelOverride.askingPrice) || 0)
            : showFinderPage ? "finderPage-" + ((data.pickpocketNotice && data.pickpocketNotice.expiresAt) || 0)
            : (isPlayingJudgeScreen && overrideMode !== "arrestAlert") ? "judgeHome-playing-" + judgeHomeNoticeKey + "-" + judgeHomeFlagKey
            : (isWatchingJudgeScreen && overrideMode !== "arrestAlert") ? "judgeHome-watching-" + judgeHomeNoticeKey + "-" + judgeHomeFlagKey
            : null;

        if (contentFreezeKey && lastKnownContentKey === contentFreezeKey) {
            return;
        }
        lastKnownContentKey = contentFreezeKey;

        let html = '';

        if (isPlayingJudgeScreen) {
            // Takes over the whole bottom content area too, same as every other dedicated screen
            // in this function - a playing Judge never sees the normal crime-economy sections
            // (shop/heat/inventory/etc), only their own duty status and, when relevant, the arrest
            // button for whatever's currently been flagged to them.
            if (overrideMode === "arrestAlert") {
                const ov = data.panelOverride || {};
                html += '<div class="section-title">Crime In Progress</div>';
                html += '<div class="items-text">' + escapeHtml(ov.perpName || "Someone") + ' has been spotted mid-' + escapeHtml(ov.crimeType || "crime") + '. Move fast if you want to make the arrest.</div>';
                html += '<button class="panel-urgent-button" id="panel-arrest-button">ARREST</button>';
            } else {
                html += '<div class="items-text">On duty and watching the scene. You\'ll get first shot at any arrest while you\'re in view.</div>';
                if (featureOn(data, "macSearch")) {
                    html += renderMacSearchBox();
                    html += renderMacBrowseButtons();
                }
            }
        } else if (isWatchingJudgeScreen) {
            // Same ARREST mechanic as the playing-Judge branch above, just different flavor text
            // underneath. Deliberately avoids "steal" language - a watching Judge isn't taking an
            // arrest away from a Judge who already made it, they're just getting their own shot
            // at it once the RPG Judge's 10-second head start runs out without a result.
            if (overrideMode === "arrestAlert") {
                const ov = data.panelOverride || {};
                html += '<div class="section-title">Crime In Progress</div>';
                html += '<div class="items-text">' + escapeHtml(ov.perpName || "Someone") + ' has been spotted mid-' + escapeHtml(ov.crimeType || "crime") + '. Move fast if you want to make the arrest.</div>';
                html += '<button class="panel-urgent-button" id="panel-arrest-button">ARREST</button>';
            } else {
                html += '<div class="items-text">Watching the scene from elsewhere. If the Judge on the case hasn\'t made the arrest within the first 10 seconds, you\'ll get your own shot at it.</div>';
                if (featureOn(data, "macSearch")) {
                    html += renderMacSearchBox();
                    html += renderMacBrowseButtons();
                }
            }
        } else if (overrideMode === "robberyResult" && !robberyResultDismissed) {
            const rd = robberyCinematicData || {};
            const perpName = escapeHtml(rd.perpName || data.name || "");
            const jobLabel = escapeHtml(rd.jobLabel || "somewhere");
            // difficultyTier is the new 7-tier field (Easy/Routine/50:50/Hard/Difficult/
            // Herculean/Near Impossible); isHardJob is the older binary field, kept as a fallback
            // so this still reads sensibly against a Robbery - Attempt version from before the
            // tier field existed.
            const tier = rd.difficultyTier || (rd.isHardJob ? "Hard" : "Easy");
            const outcome = rd.outcome || "fail";
            const succeeded = outcome === "success";
            const tierFlavor = (DIFFICULTY_TIER_META[tier] || DIFFICULTY_TIER_META["Hard"]).flavor;

            // Per user's request: each beat stays on screen and the next one appears BELOW it,
            // building a running log of the whole job rather than replacing the previous line.
            const lines = [];
            lines.push(perpName + ' robs ' + jobLabel + '. Will it go well? Will they get what they want?');
            if (robberyCinematicStage >= 1) {
                // Per user's request - no raw skill/roll number here, just the tier word and
                // whether a gun is in play.
                lines.push(perpName + (rd.hasGun ? ' is going in armed' : ' sizes up the job') +
                    ' - rated ' + escapeHtml(tier) + '. "' + tierFlavor + '"');
            }
            if (robberyCinematicStage >= 2) {
                lines.push('Here comes the roll....');
            }
            if (robberyCinematicStage >= 3) {
                lines.push(perpName + ' ' + (succeeded ? 'succeeds' : 'fails') + '! "' + (succeeded ? 'Never in doubt.' : 'Oof, this is gonna hurt - are there any Judges around?') + '"');
            }
            lines.forEach(function (line) {
                html += '<div class="juan-quote">' + line + '</div>';
            });

            if (robberyCinematicStage >= 4) {
                // Judge-portrait-on-arrest treatment (added 2026-08-13) - same showJudgeIcon/
                // judgeName pair and "<short name> Panel Image.png" naming convention as
                // pickpocketNotice's inline judge icon elsewhere in this file. judgeName known ->
                // that specific Judge's own portrait; showJudgeIcon true with judgeName null ->
                // the generic judge-icon.png badge (a watching-pool judge, or the perp-game race,
                // where there's no single fixed identity); showJudgeIcon false -> no image at all
                // (a clean, unnoticed success). Rendered as its own line here rather than folded
                // into the lines.forEach() above, since only this last beat ever needs an image.
                if (rd.showJudgeIcon) {
                    var robberyJudgeImgHtml;
                    if (rd.judgeName) {
                        var robberyJudgeShortName = rd.judgeName.replace(/^Judge\s+/i, '');
                        robberyJudgeImgHtml = '<img class="notice-inline-img" src="' + JUDGES_BASE_URL + '/' + encodeURIComponent(robberyJudgeShortName + ' Panel Image.png') + '" alt="' + escapeHtml(rd.judgeName) + '">';
                    } else {
                        robberyJudgeImgHtml = '<img class="notice-inline-img" src="' + UI_BASE_URL + '/judge-icon.png" alt="Judge">';
                    }
                    html += '<div class="juan-quote notice-with-image">' + robberyJudgeImgHtml + '<span>' + escapeHtml(rd.resultLine || '') + '</span></div>';
                } else {
                    html += '<div class="juan-quote">' + escapeHtml(rd.resultLine || '') + '</div>';
                }
            }

            if (robberyCinematicStage >= 4) {
                html += '<button class="panel-back-button" id="panel-robbery-result-back">&larr; Back</button>';
            }
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
        } else if (overrideMode === "distractAlert") {
            const ov = data.panelOverride || {};
            html += '<div class="section-title">Judges Closing In</div>';
            html += '<div class="items-text">' + escapeHtml(ov.perpName || "Someone") + ' is about to get nabbed. Create a diversion?</div>';
            html += '<button class="panel-urgent-button" id="panel-distract-button">DISTRACT</button>';
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
        } else if (overrideMode === "tradeIncoming") {
            const ov = data.panelOverride || {};
            const trade = ov.trade || {};
            html += '<div class="section-title">Trade Offer From ' + escapeHtml(trade.fromUserName || "Someone") + '</div>';
            html += '<div class="shop-list">';
            html += '<div class="shop-row"><span class="shop-item-name">They\'re offering</span></div>';
            if (trade.offerCredits > 0) {
                html += '<div class="shop-row"><span class="shop-item-name">Creds</span><span class="shop-item-price">' + trade.offerCredits + '</span></div>';
            }
            (trade.offerItems || []).forEach(function (line) {
                html += '<div class="shop-row"><span class="shop-item-name">' + escapeHtml(humanizeItemKey(line.itemKey)) + '</span><span class="shop-item-price">x' + line.qty + '</span></div>';
            });
            if (trade.offerCredits <= 0 && (!trade.offerItems || trade.offerItems.length === 0)) {
                html += '<div class="shop-row"><span class="shop-item-name">Nothing</span></div>';
            }
            html += '</div>';
            html += '<div class="shop-list">';
            html += '<div class="shop-row"><span class="shop-item-name">They want back</span></div>';
            if (trade.requestCredits > 0) {
                html += '<div class="shop-row"><span class="shop-item-name">Creds</span><span class="shop-item-price">' + trade.requestCredits + '</span></div>';
            }
            (trade.requestItems || []).forEach(function (line) {
                html += '<div class="shop-row"><span class="shop-item-name">' + escapeHtml(humanizeItemKey(line.itemKey)) + '</span><span class="shop-item-price">x' + line.qty + '</span></div>';
            });
            if (trade.requestCredits <= 0 && (!trade.requestItems || trade.requestItems.length === 0)) {
                html += '<div class="shop-row"><span class="shop-item-name">Nothing</span></div>';
            }
            html += '</div>';
            html += '<button class="panel-urgent-button" id="panel-trade-accept-button">Accept</button>';
            html += '<button class="panel-back-button" id="panel-trade-decline-button">Decline</button>';
            html += '<div class="panel-override-expiry">This offer expires in a few minutes if you don\'t respond.</div>';
        } else if (overrideMode === "tradeSent") {
            const ov = data.panelOverride || {};
            const trade = ov.trade || {};
            html += '<div class="section-title">Trade Offer Sent</div>';
            html += '<div class="juan-quote">Waiting on ' + escapeHtml(trade.toUserName || "them") + ' to respond...</div>';
            html += '<button class="panel-back-button" id="panel-trade-cancel-button">Cancel Offer</button>';
            html += '<div class="panel-override-expiry">This expires automatically in a few minutes if they don\'t respond.</div>';
        } else if (showTradePicker && tradeWizardStep === "target") {
            const tradeCandidates = getTradeCandidates(data);
            html += '<div class="section-title">Trade With Who?</div>';
            if (tradeCandidates.length === 0) {
                html += '<div class="items-text">Nobody eligible is currently present.</div>';
            } else {
                html += '<div class="shop-list">';
                tradeCandidates.forEach(function (v, i) {
                    html += '<button class="panel-shop-button" id="trade-target-' + i + '" data-target="' + escapeHtml(v.userId) + '">' + escapeHtml(v.name) + '</button>';
                });
                html += '</div>';
            }
            html += '<button class="panel-back-button" id="panel-trade-cancel-wizard">&larr; Cancel</button>';
        } else if (showTradePicker && tradeWizardStep === "offer") {
            const ownItemKeysForTrade = Object.keys(data.inventory || {}).filter(function (k) { return data.inventory[k] > 0; });
            const ownPointsForTrade = typeof data.points === "number" ? data.points : 0;
            html += '<div class="section-title">What Are You Offering ' + escapeHtml(tradeTarget ? tradeTarget.name : "") + '?</div>';
            html += '<div class="shop-instruction">Creds you have: ' + ownPointsForTrade + '</div>';
            html += '<input type="number" min="0" max="' + ownPointsForTrade + '" class="panel-text-input" id="trade-offer-credits-input" value="' + tradeOfferCredits + '" placeholder="Creds to offer">';
            if (ownItemKeysForTrade.length === 0) {
                html += '<div class="items-text">You don\'t have any items to offer.</div>';
            } else {
                html += '<div class="shop-list">';
                ownItemKeysForTrade.forEach(function (fullKey, i) {
                    const owned = data.inventory[fullKey];
                    const current = tradeOfferItems[fullKey] || 0;
                    html += '<div class="shop-row"><span class="shop-item-name">' + escapeHtml(humanizeItemKey(fullKey)) + ' (own ' + owned + ')</span><input type="number" min="0" max="' + owned + '" class="panel-text-input" id="trade-offer-qty-' + i + '" value="' + current + '"></div>';
                });
                html += '</div>';
            }
            html += '<button class="panel-shop-button" id="panel-trade-offer-next">Next: What Do You Want Back?</button>';
            html += '<button class="panel-back-button" id="panel-trade-offer-back">&larr; Back</button>';
        } else if (showTradePicker && tradeWizardStep === "request") {
            html += '<div class="section-title">What Do You Want Back?</div>';
            html += '<input type="number" min="0" class="panel-text-input" id="trade-request-credits-input" value="' + tradeRequestCredits + '" placeholder="Creds to request">';
            const catalogKeysForTrade = itemGlossaryCache ? Object.keys(itemGlossaryCache).sort() : [];
            if (!itemGlossaryCache) {
                html += '<div class="items-text">Loading item list...</div>';
            } else if (catalogKeysForTrade.length === 0) {
                html += '<div class="items-text">No catalog items available.</div>';
            } else {
                html += '<div class="shop-list">';
                catalogKeysForTrade.forEach(function (fullKey, i) {
                    const current = tradeRequestItems[fullKey] || 0;
                    html += '<div class="shop-row"><span class="shop-item-name">' + escapeHtml(humanizeItemKey(fullKey)) + '</span><input type="number" min="0" class="panel-text-input" id="trade-request-qty-' + i + '" value="' + current + '"></div>';
                });
                html += '</div>';
            }
            html += '<button class="panel-urgent-button" id="panel-trade-send-button">Send Trade Offer</button>';
            html += '<button class="panel-back-button" id="panel-trade-request-back">&larr; Back</button>';
        } else if (robberyPending) {
            // Immediate transitional screen the instant a job is picked - the real cinematic
            // takes over automatically the moment its override actually arrives (see the
            // detection block near the top of this function).
            //
            // Deliberately checked AFTER the full overrideMode chain, same reasoning as
            // pickpocketPending just below - this used to be checked BEFORE shop/findersFee/
            // itemInfo/oiWarning/arrestAlert/distractAlert/heatDenied/offendedDenied/tradeIncoming/
            // tradeSent, which meant a robberyPending flag that never got cleared (e.g. no
            // robberyResult override ever actually arrived to clear it - a real risk since it's
            // the ONLY thing that resets robberyPending) would silently swallow every other
            // server-driven override's content forever, including a live arrestAlert. That's the
            // likely explanation for "pressed the arrest button and nothing happened, the window
            // expired" - the ARREST button never rendered in the content area at all because a
            // stale robberyPending was still blocking it, even though the top-row/name-status
            // sections (which already checked overrideMode first) may have shown the alert fine.
            html += '<div class="juan-quote">The ' + escapeHtml(((robberyPendingCategory && robberyPendingCategory.label) || 'job').replace(/^The\s+/i, '')) + ' job is underway...</div>';
        } else if (pickpocketPending) {
            // Same idea as robberyPending above - Pickpocket - Attempt resolves the whole
            // thing (roll, judge spot-check, theft) in one synchronous action, so there's no
            // multi-stage cinematic to reveal here the way robbery has - just enough to make it
            // clear something is actually happening, until the real pickpocketNotice toast lands
            // a moment later and this pending screen clears itself (see the hasFreshNotice check
            // further down).
            //
            // Deliberately checked AFTER the full overrideMode chain above (shop/findersFee/
            // itemInfo/oiWarning/arrestAlert/etc), not before it like the earlier version of this
            // branch was. The client sets pickpocketPending the instant a target is clicked and
            // only clears it once a fresh pickpocketNotice toast lands - but for a self-pickpocket
            // (thiefId === targetId, the test-account exception in Pickpocket - Attempt), the SAME
            // account's panel also receives the real oiWarning panelOverride mid-attempt. With
            // pickpocketPending checked first, that oiWarning override was getting completely
            // masked - the panel stayed stuck on "Working ...'s pockets..." with no OI button,
            // since content never got a chance to render the override. Checking it last here means
            // any genuine server-driven override (oiWarning included) always wins over the
            // client-side placeholder, exactly like the top-row and name-status chains already do.
            html += '<div class="juan-quote">Working ' + escapeHtml(pickpocketPendingTargetName || "someone") + '\'s pockets...</div>';
        } else if (graffitiPending) {
            // Same idea as pickpocketPending above - Crime - Graffiti Attempt also resolves
            // synchronously in one action (roll, judge spot-check, kudos, OBS effect kickoff all
            // happen inline), so there's no separate cinematic override to wait for - just this
            // placeholder until the real pickpocketNotice toast lands and clears it (see the
            // hasFreshNotice check further up). Checked last in the chain for the same reason
            // pickpocketPending is - any genuine server-driven override (an arrest alert catching
            // the tagger mid-spray, say) must still win over this client-side placeholder.
            html += '<div class="juan-quote">Spraying your tag...</div>';
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
                // No heist banner art actually exists on GitHub Pages yet as of this fix - until
                // it does, every one of these 404s. onerror hides the whole frame instead of
                // showing the browser's broken-image icon, so it degrades to "no banner" rather
                // than "visibly broken" in the meantime.
                html += '<div class="heist-banner-frame"><img src="' + HEISTS_BASE_URL + '/' + HEIST_IMAGES[bh.heistKey] + '" alt="' + escapeHtml(bh.heistName || '') + '" onerror="this.parentElement.style.display=\'none\';"></div>';
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
                        // Same "no crew logo art exists yet" situation as the heist banner above -
                        // onerror hides the frame instead of showing a broken-image icon.
                        html += '<div class="juan-frame robbery-frame" style="margin:0 auto;"><img src="' + CREWS_BASE_URL + '/' + logoFile + '" alt="' + escapeHtml(bh.crewName) + '" onerror="this.parentElement.style.display=\'none\';"></div>';
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
                    const statusInfo = taskStatusIcon(task);
                    html += '<div class="task-header"><span>' + (i + 1) + ': ' + escapeHtml(humanize(task.taskKey).toUpperCase()) + '</span>'
                        + '<span class="task-status-icon ' + statusInfo.cls + '" title="' + escapeHtml(statusInfo.tooltip) + '">' + statusInfo.icon + '</span></div>';
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

                html += '<div class="section-title">Getaway</div>';
                if (bh.requiredVehicle) {
                    const vehicleFilled = bh.getawayVehicleName && bh.getawayVehicleName.toLowerCase() === bh.requiredVehicle.toLowerCase();
                    html += '<div class="items-text">Getaway needs: ' + humanize(bh.requiredVehicle) + (vehicleFilled ? ' (filled)' : ' (MISSING - heist will be cancelled)') + '</div>';
                } else if (bh.getawayVehicleName) {
                    html += '<div class="items-text">Current getaway vehicle: ' + humanize(bh.getawayVehicleName) + '</div>';
                } else {
                    html += '<div class="items-text">No getaway vehicle committed yet - on foot without one.</div>';
                }

                // Getaway item options - same single-shared-slot pattern as a task's OPTIONAL bonus
                // item, just heist-scoped instead of task-scoped. Any owned item with bonusRoles
                // including "Escape" (or "ANY") qualifies here - bh.getawayOptions is computed
                // server-side by Sync To Extension using that exact same rule, so what's offered
                // here always matches what "!use <item> for getaway" would actually accept.
                (bh.getawayOptions || []).forEach(function (opt, oi) {
                    const optColorClass = opt.reusable ? 'item-reusable' : 'item-single-use';
                    const optItemLabel = escapeHtml(humanize(opt.baseItemName));
                    let optCell = '<span class="' + optColorClass + '">' + optItemLabel + '</span>';
                    if (opt.filledByMe) {
                        const removeTooltip = 'You added your ' + escapeHtml(opt.tier || '') + ' ' + optItemLabel;
                        optCell += ' <button class="panel-inline-button" id="takegetaway-' + oi + '" title="' + removeTooltip + '">Remove</button>';
                    } else if (opt.wouldReplace) {
                        const replaceTooltip = 'You can upgrade this ' + escapeHtml(opt.replacingTier || '') + ' ' + optItemLabel + ' to your ' + escapeHtml(opt.tier || '') + ' item';
                        optCell += ' <button class="panel-inline-button" id="usegetaway-' + oi + '" title="' + replaceTooltip + '">Replace</button>';
                    } else {
                        const useTooltip = 'You can add your ' + escapeHtml(opt.tier || '') + ' ' + optItemLabel;
                        optCell += ' <button class="panel-inline-button" id="usegetaway-' + oi + '" title="' + useTooltip + '">Use</button>';
                    }
                    html += '<div class="task-row" style="justify-content:center;">' + optCell + '</div>';
                });

                if (bh.crewTogether) {
                    html += '<div class="items-text">This crew stays together on the job. <span class="item-reusable">Green</span> items can cover a task and the getaway at once, since the same item is never somewhere else. <span class="item-single-use">Yellow</span> items are still locked to wherever they\'re given.</div>';
                } else {
                    html += '<div class="items-text">This crew is split up across the job, so every item shown is <span class="item-single-use">single use</span> - once given, it\'s locked to that spot until physically taken back.</div>';
                }

                html += '<button class="panel-back-button" id="panel-bigheist-cancel">&larr; Back</button>';
                }
            }
        } else if (showRobberyPicker) {
            // The category LIST is static (ROBBERY_CATEGORIES), but which ones are actually
            // available - and what to call them - depends on the current Block, fetched via
            // getAvailableRobberyCategories()/fetchCurrentBlock() below. A job whose Block doesn't
            // have a location for it simply doesn't show a button, same as it's rejected
            // server-side in Robbery - Attempt if somehow triggered anyway.
            html += '<div class="section-title">Pick a Job</div>';
            // Per the user's request - shows which Block the player is currently in, so a
            // WatchingPerp/mimicked viewer can confirm their panel is actually linked to the same
            // RPG Perp/Block they're watching on stream, rather than a stale or mismatched one.
            // currentBlockInfo.block is already fetched (fetchCurrentBlock()) for the category
            // list/labels above - this just also surfaces it visibly instead of using it silently.
            if (currentBlockInfo && currentBlockInfo.block) {
                html += '<div class="items-text current-block-label">Block: <span class="creds-text">' + escapeHtml(currentBlockInfo.block) + '</span></div>';
            }
            const availableRobberyCategories = getAvailableRobberyCategories();
            if (availableRobberyCategories.length === 0) {
                html += '<div class="items-text">Nothing worth robbing in this Block right now - try again once the team moves on.</div>';
            }
            // Per the user's request - show how hard each job actually is BEFORE they commit to
            // it, not just after the roll's already happened - but WITHOUT the raw roll/skill
            // number itself, just the tier word and whether a Gun is helping. Estimate is null
            // (falls back to no suffix at all) until currentBlockInfo has actually loaded.
            // effectiveGun folds in the toggle below - only actually "using" the gun (for both the
            // difficulty preview AND the real attempt) when they own one AND the toggle is on.
            const robberyOwnsGun = inventoryHasGun(data);
            const robberyEffectiveGun = robberyOwnsGun && robberyUseGun;
            availableRobberyCategories.forEach(function (cat, i) {
                const estimate = estimateRobberyDifficulty(data, cat.key, robberyEffectiveGun);
                let label = escapeHtml(cat.label);
                if (estimate) {
                    const tierClass = (DIFFICULTY_TIER_META[estimate.tier] || DIFFICULTY_TIER_META["Hard"]).cssClass;
                    label += ' <span class="robbery-difficulty-tag ' + tierClass + '">' +
                        escapeHtml(estimate.tier) + (estimate.hasGun ? ' + Gun' : '') + '</span>';
                }
                html += '<button class="panel-shop-button" id="robbery-category-' + i + '" data-category="' + escapeHtml(cat.key) + '">' + label + '</button>';
            });
            // Per user's follow-up request - a toggle for whether to actually carry the Gun on
            // this job, right where the explanation about it already was. Only shown at all if
            // they own one - nothing to toggle otherwise, so the note just states the tradeoff in
            // the abstract (matches the previous copy for a player with no Gun).
            if (robberyOwnsGun) {
                html += '<div class="items-text robbery-gun-note">' +
                    (robberyUseGun
                        ? 'Carrying a Gun raises your odds on every job above - but if you\'re caught, the odds a Judge gets called go up too, and a Gun used on the job is guaranteed to be seized if you\'re arrested for it.'
                        : 'Gun left at home for this job - odds above are unarmed.') +
                    '</div>';
                // Rendered as an actual toggle switch (track + sliding knob, via CSS) rather than
                // a plain button, so it visually reads as ON/OFF state rather than just another
                // action to tap - per user's follow-up request to make it clearer what it means.
                html += '<div class="gun-toggle-row">' +
                    '<span class="gun-toggle-label">Bring Gun</span>' +
                    '<button type="button" class="gun-toggle-switch' + (robberyUseGun ? ' on' : '') + '" id="robbery-gun-toggle" role="switch" aria-checked="' + (robberyUseGun ? 'true' : 'false') + '" title="' + (robberyUseGun ? 'Gun: ON - tap to leave it behind' : 'Gun: OFF - tap to bring it') + '">' +
                    '<span class="gun-toggle-knob"></span>' +
                    '</button>' +
                    '<span class="gun-toggle-state">' + (robberyUseGun ? 'ON' : 'OFF') + '</span>' +
                    '</div>';
            } else {
                html += '<div class="items-text robbery-gun-note">Carrying a Gun raises your odds on a job, at the cost of a much higher chance of getting a Judge called on you if it goes wrong - and a Gun used on the job is guaranteed to be seized if you\'re arrested for it.</div>';
            }
            html += '<button class="panel-back-button" id="panel-robbery-cancel">&larr; Cancel</button>';
        } else if (showGraffitiPicker) {
            // Deliberately minimal compared to the Robbery picker - just 3 fixed size buttons, no
            // Block-dependent availability fetch, no difficulty preview, no gun toggle. The actual
            // result (success/fail, Kudos gained) comes back as the normal pickpocketNotice toast,
            // same as Pickpocket, rather than a full-screen cinematic like Robbery gets.
            html += '<div class="section-title">Pick a Tag Size</div>';
            html += '<div class="items-text">Bigger tags are worth more Kudos, but are harder to pull off clean.</div>';
            const GRAFFITI_SIZES = [
                { key: "small", label: "Small" },
                { key: "medium", label: "Medium" },
                { key: "large", label: "Large" }
            ];
            GRAFFITI_SIZES.forEach(function (size, i) {
                html += '<button class="panel-shop-button" id="graffiti-size-' + i + '" data-size="' + size.key + '">' + size.label + '</button>';
            });
            html += '<button class="panel-back-button" id="panel-graffiti-cancel">&larr; Cancel</button>';
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

            // Kudos - reputation earned from Robbery/Big Heist/Graffiti (deliberately NOT
            // Pickpocket - see Crime - Graffiti Attempt for why), docked 2x on arrest. Shown right
            // under Creds per the user's request ("near the top of the character sheet").
            html += '<div class="section-title">Kudos</div>';
            html += '<div class="creds-text">' + (typeof data.kudos === "number" ? data.kudos.toLocaleString() : "0") + '</div>';

            // "Heat" title line (now with the combined total on the right of that same line) + its
            // own underline (from .section-title's border-bottom) acts as the divider row, then
            // PERSONAL/LOCAL sit on one inline text line beneath it - per user's exact 2-line
            // layout request (HEAT + total / divider / PERSONAL & LOCAL).
            const mainPersonalHeatVal = typeof data.personalHeat === "number" ? data.personalHeat : 0;
            const mainShowHeatVal = typeof data.showHeat === "number" ? data.showHeat : 0;
            const mainTotalHeatVal = mainPersonalHeatVal + mainShowHeatVal;
            html += '<div class="section-title heat-title-row"><span>Heat</span><span>' + mainTotalHeatVal + '</span></div>';
            html += '<div class="heat-inline-row"><span>PERSONAL: ' + mainPersonalHeatVal + '</span><span>LOCAL:' + mainShowHeatVal + '</span></div>';

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
            // Feature-flag gated (see applyFeatureFlags/featureOn) - when a feature's been turned
            // off, its entry point disappears entirely rather than showing a disabled/greyed
            // state, same "just isn't there" treatment as the Item Glossary/Achievements buttons.
            if (featureOn(data, "juansEmporium")) {
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
            }
            if (!stillJailed && !isLayingLow) {
                // Per user's request (revised twice now): grey a Rob/Pickpocket button out while
                // that SPECIFIC action's own summary text is still on screen, and bring it back the
                // instant that text disappears - not a separate clock, and not both buttons at
                // once. Pickpocket - Attempt's result toast and Robbery - Attempt's reject-path
                // toast both write to the same shared data.pickpocketNotice field, so hasFreshNotice
                // alone can't tell which action actually produced it - lastCrimeAction (set at the
                // exact moment each action's real queueAction fires) disambiguates that. A genuine
                // robbery SUCCESS/FAIL result doesn't need this at all - that's the full-screen
                // robberyResult cinematic, an entirely different branch earlier in this chain, so
                // this button section isn't even reachable while that's showing.
                const pickpocketSettling = hasFreshNotice && lastCrimeAction === "pickpocket";
                const robberySettling = hasFreshNotice && lastCrimeAction === "robbery";
                const graffitiSettling = hasFreshNotice && lastCrimeAction === "graffiti";
                if (featureOn(data, "pickpocket")) {
                    html += '<button class="panel-shop-button" id="panel-pickpocket-button"' + (pickpocketSettling ? ' disabled' : '') + '>' +
                        (pickpocketSettling ? 'Pickpocket Someone (settling up...)' : 'Pickpocket Someone') + '</button>';
                }
                if (featureOn(data, "robbery")) {
                    const robberyLeft = typeof data.robberyAttemptsRemaining === "number" ? data.robberyAttemptsRemaining : 999;
                    if (robberyLeft > 0) {
                        html += '<button class="panel-shop-button" id="panel-robbery-button"' + (robberySettling ? ' disabled' : '') + '>' +
                            (robberySettling ? 'Rob Somewhere (settling up...)' : 'Rob Somewhere') + '</button>';
                    } else {
                        html += '<div class="panel-override-expiry">You\'ve pushed your luck enough for one stream - no robberies left tonight.</div>';
                    }
                }
                // Graffiti - 2-per-stream cap mirrors Robbery's, tracked server-side via
                // GraffitiAttemptCounts (Crime - Graffiti Attempt rejects past the cap even if this
                // somehow got clicked anyway) - no separate remaining-count field is surfaced yet,
                // so this just always shows the button and lets the server-side rejection produce
                // the normal toast if they're already out of attempts.
                if (featureOn(data, "graffiti")) {
                    html += '<button class="panel-shop-button" id="panel-graffiti-button"' + (graffitiSettling ? ' disabled' : '') + '>' +
                        (graffitiSettling ? 'Spray Some Graffiti (settling up...)' : 'Spray Some Graffiti') + '</button>';
                }
                if (featureOn(data, "trade")) {
                    html += '<button class="panel-shop-button" id="panel-trade-button">Trade</button>';
                }
            }
            if (!stillJailed) {
                // Always available (not gated on owning an item, and not hidden while laying low
                // itself - that's exactly where you'd go to turn it back off again). Burning an
                // item for a bigger hit is a secondary option inside the same view, shown only if
                // they actually own one.
                if (featureOn(data, "layLow")) {
                    html += '<button class="panel-shop-button" id="panel-laylow-button">Lay Low</button>';
                }

                // Assumption flagged: Big Heist participation is NOT blocked by laying low (only
                // jail blocks it) - unlike Shop/Robbery/Pickpocket, joining a heist crew didn't
                // seem like the same category of "drawing attention" activity, but easy to add
                // that gate too if it should behave the same way as the others.
                //
                // Only shown when there's actually an active heist - if one's been selected but
                // the countdown ran and finished it out (or nothing's been picked yet), there's
                // nothing to click into, so showing a dead-end button here would just be
                // confusing rather than useful.
                if (data.bigHeist && featureOn(data, "bigHeist")) {
                    html += '<button class="panel-shop-button" id="panel-bigheist-button">The Big Heist</button>';
                }
            }
        }

        // hasFreshNotice and the two pending-clearing blocks now live much earlier in this
        // function (right after stillJailed/statusClass are computed) - moved there so the
        // Rob/Pickpocket button section could also read hasFreshNotice for its own cooldown-until-
        // the-summary-clears logic. Left this comment as a breadcrumb for anyone grepping for it.
        if (hasFreshNotice) {
            // Small icon shown inline next to the notice text (not a big standalone frame above
            // it) - same idea as Robbery - Attempt's stolen-item popup, but pickpocketing only
            // ever nets cash (no physical item), so this always shows the same generic creds art
            // (robbery-bank.png - confirmed by user to be generic "creds" art, not a literal
            // bank), only set server-side on an actual successful theft.
            //
            // showJudgeIcon/judgeName are a separate pair from imageFile (server-side never sets
            // both at once) - used on the "a Judge might have noticed..." style fail notices.
            // judgeName known -> that specific Judge's own portrait (same naming convention as
            // the top-row Judge portraits elsewhere in this file: "<short name> Panel Image.png"
            // at JUDGES_BASE_URL). judgeName not known (a watching-pool judge, or none at all
            // registered) -> the generic judge-icon.png badge at UI_BASE_URL instead.
            var noticeImgHtml;
            var noticeHasImg;
            if (data.pickpocketNotice.showJudgeIcon) {
                if (data.pickpocketNotice.judgeName) {
                    var noticeJudgeShortName = data.pickpocketNotice.judgeName.replace(/^Judge\s+/i, '');
                    noticeImgHtml = '<img class="notice-inline-img" src="' + JUDGES_BASE_URL + '/' + encodeURIComponent(noticeJudgeShortName + ' Panel Image.png') + '" alt="' + escapeHtml(data.pickpocketNotice.judgeName) + '">';
                } else {
                    noticeImgHtml = '<img class="notice-inline-img" src="' + UI_BASE_URL + '/judge-icon.png" alt="Judge">';
                }
                noticeHasImg = true;
            } else if (data.pickpocketNotice.imageFile) {
                noticeImgHtml = '<img class="notice-inline-img" src="' + ROBBERY_BASE_URL + '/' + encodeURIComponent(data.pickpocketNotice.imageFile) + '" alt="Stolen creds">';
                noticeHasImg = true;
            } else {
                noticeImgHtml = '';
                noticeHasImg = false;
            }
            var noticeRowClass = noticeHasImg ? 'juan-quote notice-with-image' : 'juan-quote';
            html = '<div class="' + noticeRowClass + '">' + noticeImgHtml + '<span>' + escapeHtml(data.pickpocketNotice.message) + '</span></div>' + html;
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

        const macSearchButton = document.getElementById("mac-search-button");
        const macSearchInput = document.getElementById("mac-search-input");
        let macSearchPressedTimeout = null;
        const runMacSearch = function () {
            const query = macSearchInput ? macSearchInput.value.trim() : "";
            if (!query) return;
            // Not disabled on click, unlike most other action buttons in this file - a Judge
            // may want to fire off several searches in quick succession while investigating,
            // and the search itself is cheap/idempotent server-side, so there's no real risk
            // in leaving it live.
            //
            // Visual "depress" cue (added 2026-08-18) so it's obvious the click actually
            // registered - the search box lives on the deliberately-frozen Judge Home Screen
            // (see contentFreezeKey above), which means nothing else visibly changes the instant
            // you click, and that silence read as "doesn't submit properly." Resets itself
            // automatically the moment the freeze next breaks for real (a fresh notice rebuilds
            // this button from scratch, or a successful search replaces the whole screen), or
            // after 6s as a safety net if neither ever happens (e.g. a dropped queueAction).
            if (macSearchButton) {
                macSearchButton.classList.add("is-pressed");
                macSearchButton.textContent = "Searching...";
                if (macSearchPressedTimeout) clearTimeout(macSearchPressedTimeout);
                macSearchPressedTimeout = setTimeout(function () {
                    if (macSearchButton) {
                        macSearchButton.classList.remove("is-pressed");
                        macSearchButton.textContent = "Judge M.A.C. Search";
                    }
                }, 6000);
            }
            queueAction("macSearch", { query: query });
        };
        if (macSearchButton) {
            macSearchButton.addEventListener("click", runMacSearch);
        }
        if (macSearchInput) {
            // Enter-to-search, same as any normal search box - without this, pressing Enter did
            // nothing (no surrounding <form>, so there's no default submit behavior to rely on),
            // which read as the box "not submitting properly" even though the click button itself
            // always worked fine.
            macSearchInput.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    runMacSearch();
                }
            });
        }

        // Browse People/Places buttons (added 2026-08-18) - straight into the alphabet grid for
        // that category, no input to type. See renderMacBrowseAlphabet/renderMacBrowseButtons.
        const macBrowsePeopleButton = document.getElementById("mac-browse-people-button");
        if (macBrowsePeopleButton) {
            macBrowsePeopleButton.addEventListener("click", function () {
                queueAction("macBrowseAlphabet", { category: "person" });
            });
        }
        const macBrowsePlacesButton = document.getElementById("mac-browse-places-button");
        if (macBrowsePlacesButton) {
            macBrowsePlacesButton.addEventListener("click", function () {
                queueAction("macBrowseAlphabet", { category: "place" });
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
                queueAction("confirmArrest", { perpId: ov.perpId || "", perpName: ov.perpName || "", severity: ov.severity || "minor", kudosPenalty: ov.kudosPenalty || 0 });
                queueAction("clearOverride", {});
            });
        }

        const distractButton = document.getElementById("panel-distract-button");
        if (distractButton) {
            distractButton.addEventListener("click", function () {
                distractButton.disabled = true;
                const ov = data.panelOverride || {};
                queueAction("confirmDistract", { perpId: ov.perpId || "", perpName: ov.perpName || "" });
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

                (bh.getawayOptions || []).forEach(function (opt, oi) {
                    const useGetawayBtn = document.getElementById("usegetaway-" + oi);
                    if (useGetawayBtn) {
                        useGetawayBtn.addEventListener("click", function () {
                            useGetawayBtn.disabled = true;
                            queueAction("useItem", { itemForDestination: opt.baseItemName + " for getaway" });
                        });
                    }
                    const takeGetawayBtn = document.getElementById("takegetaway-" + oi);
                    if (takeGetawayBtn) {
                        takeGetawayBtn.addEventListener("click", function () {
                            takeGetawayBtn.disabled = true;
                            queueAction("takeItem", { taskKey: "getaway", slotType: "getaway" });
                        });
                    }
                });
            }
        }


        const robberyButton = document.getElementById("panel-robbery-button");
        if (robberyButton) {
            robberyButton.addEventListener("click", function () {
                showRobberyPicker = true;
                // Always refetch on open rather than trusting a stale cache - the streamer can
                // move the team to a new Block between panel opens, and this is cheap/rare enough
                // (one fetch per picker-open, not polled) that freshness is worth it.
                fetchCurrentBlock();
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const graffitiButton = document.getElementById("panel-graffiti-button");
        if (graffitiButton) {
            graffitiButton.addEventListener("click", function () {
                showGraffitiPicker = true;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        // ============================
        // TRADE - open button, accept/decline/cancel on a live tradeIncoming/tradeSent
        // override, and the full 3-step propose wizard (target -> offer -> request).
        // ============================
        const tradeButton = document.getElementById("panel-trade-button");
        if (tradeButton) {
            tradeButton.addEventListener("click", function () {
                showTradePicker = true;
                tradeWizardStep = "target";
                tradeTarget = null;
                tradeOfferCredits = 0;
                tradeOfferItems = {};
                tradeRequestCredits = 0;
                tradeRequestItems = {};
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const tradeAcceptBtn = document.getElementById("panel-trade-accept-button");
        if (tradeAcceptBtn) {
            tradeAcceptBtn.addEventListener("click", function () {
                tradeAcceptBtn.disabled = true;
                const tid = (data.panelOverride && data.panelOverride.trade && data.panelOverride.trade.tradeId) || "";
                queueAction("acceptTrade", { tradeId: tid });
            });
        }
        const tradeDeclineBtn = document.getElementById("panel-trade-decline-button");
        if (tradeDeclineBtn) {
            tradeDeclineBtn.addEventListener("click", function () {
                tradeDeclineBtn.disabled = true;
                const tid = (data.panelOverride && data.panelOverride.trade && data.panelOverride.trade.tradeId) || "";
                queueAction("declineTrade", { tradeId: tid });
            });
        }
        const tradeCancelBtn = document.getElementById("panel-trade-cancel-button");
        if (tradeCancelBtn) {
            tradeCancelBtn.addEventListener("click", function () {
                tradeCancelBtn.disabled = true;
                const tid = (data.panelOverride && data.panelOverride.trade && data.panelOverride.trade.tradeId) || "";
                queueAction("cancelTrade", { tradeId: tid });
            });
        }

        if (showTradePicker && tradeWizardStep === "target") {
            getTradeCandidates(data).forEach(function (v, i) {
                const btn = document.getElementById("trade-target-" + i);
                if (btn) {
                    btn.addEventListener("click", function () {
                        tradeTarget = { userId: v.userId, name: v.name };
                        tradeWizardStep = "offer";
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    });
                }
            });
            const cancelWizardBtn = document.getElementById("panel-trade-cancel-wizard");
            if (cancelWizardBtn) {
                cancelWizardBtn.addEventListener("click", function () {
                    showTradePicker = false;
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                });
            }
        }

        if (showTradePicker && tradeWizardStep === "offer") {
            const offerBackBtn = document.getElementById("panel-trade-offer-back");
            if (offerBackBtn) {
                offerBackBtn.addEventListener("click", function () {
                    tradeWizardStep = "target";
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                });
            }
            const offerNextBtn = document.getElementById("panel-trade-offer-next");
            if (offerNextBtn) {
                offerNextBtn.addEventListener("click", function () {
                    const creditsInput = document.getElementById("trade-offer-credits-input");
                    const maxPoints = typeof data.points === "number" ? data.points : 0;
                    let credits = creditsInput ? parseInt(creditsInput.value, 10) || 0 : 0;
                    if (credits < 0) credits = 0;
                    if (credits > maxPoints) credits = maxPoints;
                    tradeOfferCredits = credits;

                    const items = {};
                    const ownItemKeysForTrade = Object.keys(data.inventory || {}).filter(function (k) { return data.inventory[k] > 0; });
                    ownItemKeysForTrade.forEach(function (fullKey, i) {
                        const input = document.getElementById("trade-offer-qty-" + i);
                        if (!input) return;
                        const owned = data.inventory[fullKey];
                        let qty = parseInt(input.value, 10) || 0;
                        if (qty < 0) qty = 0;
                        if (qty > owned) qty = owned;
                        if (qty > 0) items[fullKey] = qty;
                    });
                    tradeOfferItems = items;

                    tradeWizardStep = "request";
                    // Item catalog is large/static - reuse the glossary cache if it's already
                    // been loaded once this session (e.g. from opening the glossary via the
                    // book icon), otherwise fetch it here for the first time. Same endpoint
                    // setupItemGlossary already uses.
                    if (itemGlossaryCache) {
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    } else {
                        if (lastFetchedData) renderPerpSheet(lastFetchedData); // shows "Loading item list..." immediately
                        fetch(BACKEND_URL + "/api/item-catalog")
                            .then(function (res) { return res.json(); })
                            .then(function (catalogData) {
                                itemGlossaryCache = (catalogData && catalogData.catalog) ? catalogData.catalog : {};
                                if (lastFetchedData) renderPerpSheet(lastFetchedData);
                            })
                            .catch(function (err) {
                                console.error("item-catalog fetch failed:", err);
                                itemGlossaryCache = {};
                                if (lastFetchedData) renderPerpSheet(lastFetchedData);
                            });
                    }
                });
            }
        }

        if (showTradePicker && tradeWizardStep === "request") {
            const requestBackBtn = document.getElementById("panel-trade-request-back");
            if (requestBackBtn) {
                requestBackBtn.addEventListener("click", function () {
                    tradeWizardStep = "offer";
                    if (lastFetchedData) renderPerpSheet(lastFetchedData);
                });
            }
            const sendBtn = document.getElementById("panel-trade-send-button");
            if (sendBtn) {
                sendBtn.addEventListener("click", function () {
                    sendBtn.disabled = true;

                    const creditsInput = document.getElementById("trade-request-credits-input");
                    let requestCredits = creditsInput ? parseInt(creditsInput.value, 10) || 0 : 0;
                    if (requestCredits < 0) requestCredits = 0;
                    tradeRequestCredits = requestCredits;

                    const requestItems = {};
                    const catalogKeysForTrade = itemGlossaryCache ? Object.keys(itemGlossaryCache).sort() : [];
                    catalogKeysForTrade.forEach(function (fullKey, i) {
                        const input = document.getElementById("trade-request-qty-" + i);
                        if (!input) return;
                        let qty = parseInt(input.value, 10) || 0;
                        if (qty < 0) qty = 0;
                        if (qty > 0) requestItems[fullKey] = qty;
                    });
                    tradeRequestItems = requestItems;

                    const offerItemLines = Object.keys(tradeOfferItems).map(function (k) { return { itemKey: k, qty: tradeOfferItems[k] }; });
                    const requestItemLines = Object.keys(tradeRequestItems).map(function (k) { return { itemKey: k, qty: tradeRequestItems[k] }; });

                    queueAction("proposeTrade", {
                        targetUserId: tradeTarget ? tradeTarget.userId : "",
                        offerCredits: tradeOfferCredits,
                        offerItems: offerItemLines,
                        requestCredits: tradeRequestCredits,
                        requestItems: requestItemLines
                    }).then(function (ok) {
                        showTradePicker = false;
                        if (!ok) showQueueFailure();
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    });
                });
            }
        }

        const robberyCancel = document.getElementById("panel-robbery-cancel");
        if (robberyCancel) {
            robberyCancel.addEventListener("click", function () {
                showRobberyPicker = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        const robberyGunToggle = document.getElementById("robbery-gun-toggle");
        if (robberyGunToggle) {
            robberyGunToggle.addEventListener("click", function () {
                robberyUseGun = !robberyUseGun;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        if (showRobberyPicker) {
            const robberyOwnsGunForClick = inventoryHasGun(data);
            getAvailableRobberyCategories().forEach(function (cat, i) {
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
                        queueAction("robberyCategory", { category: cat.key, useGun: robberyOwnsGunForClick && robberyUseGun });
                        showRobberyPicker = false;
                        // Show the transitional "job underway" screen immediately, rather than
                        // falling back to the normal character sheet for the few seconds it takes
                        // Process Panel Actions to actually pick this up and compute the real
                        // result - that gap is exactly what caused the reported "flashes back to
                        // the sheet, then teleports into the cinematic" hiccup.
                        robberyPending = true;
                        robberyPendingCategory = cat;
                        lastCrimeAction = "robbery";
                        if (lastFetchedData) renderPerpSheet(lastFetchedData);
                    });
                }
            });
        }

        const graffitiCancel = document.getElementById("panel-graffiti-cancel");
        if (graffitiCancel) {
            graffitiCancel.addEventListener("click", function () {
                showGraffitiPicker = false;
                if (lastFetchedData) renderPerpSheet(lastFetchedData);
            });
        }

        if (showGraffitiPicker) {
            const GRAFFITI_SIZES_FOR_CLICK = ["small", "medium", "large"];
            GRAFFITI_SIZES_FOR_CLICK.forEach(function (sizeKey, i) {
                const row = document.getElementById("graffiti-size-" + i);
                if (row) {
                    row.addEventListener("click", function () {
                        // Same double-click protection as robbery-category above.
                        row.disabled = true;
                        queueAction("graffitiAttempt", { size: sizeKey });
                        showGraffitiPicker = false;
                        lastCrimeAction = "graffiti";
                        graffitiPending = true;
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
                        pickpocketPending = true;
                        pickpocketPendingTargetName = v.name;
                        lastCrimeAction = "pickpocket";
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

    // Green tick / amber dot / red cross for a task's header, mirroring the exact fill rule the
    // server itself uses to color the Task Flow boxes on stream (Big Heist - Update Task Flow
    // Colors: green = crew AND item both covered, red = a make-or-break task with NEITHER crew
    // nor item at all, amber = everything else incomplete). Unlike that OBS display, this isn't
    // gated behind "revealed" - a player checking their own panel should always see the real
    // status, not wait for the on-stream reveal moment.
    function taskStatusIcon(task) {
        const hasPerson = (task.crewFilled || 0) > 0;
        const needsItem = !!task.requiredItem;
        const hasItem = needsItem && !!task.requiredItemFilled;
        const itemLegSatisfied = !needsItem || hasItem;

        if (hasPerson && itemLegSatisfied) {
            return { cls: 'task-status-green', icon: '✓', tooltip: 'Complete - this task has everything it needs.' };
        }
        if (task.makeOrBreak && !hasPerson && !hasItem) {
            return { cls: 'task-status-red', icon: '✗', tooltip: 'Make-or-break task with nobody on it - the heist will fail unless someone takes it before the deadline.' };
        }
        if (task.makeOrBreak) {
            return { cls: 'task-status-amber', icon: '●', tooltip: 'Make-or-break task, partially covered - still missing something, but it won\'t auto-fail the heist as long as it isn\'t left completely empty.' };
        }
        return { cls: 'task-status-amber', icon: '●', tooltip: 'Optional task - incomplete, but it won\'t cause the heist to fail.' };
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

    // ============================
    // FEATURE FLAGS - lets the streamer hold a panel feature back after it's already been coded
    // and deployed, then reveal it on stream whenever they're ready, rather than it just appearing
    // for every viewer the moment new panel code ships. Covers two different kinds of UI:
    //
    //   1. Persistent bottom buttons (Item Glossary, Achievements) - toggled via applyFeatureFlags
    //      below, which directly shows/hides the actual DOM button. These live OUTSIDE #content
    //      and survive every renderPerpSheet rebuild untouched, so they need their own dedicated
    //      show/hide call (from fetchMyData, once per poll) rather than being re-evaluated as part
    //      of the normal render.
    //   2. Action entry points inside the character sheet itself (Rob Somewhere, Pickpocket
    //      Someone, Visit Juan's Emporium, The Big Heist) - these get rebuilt from scratch on
    //      every renderPerpSheet call, so they're gated inline with the featureOn(data, key) check
    //      right where each button gets added to the HTML string, rather than a separate function.
    //
    // Both start/default to hidden if their flag is missing from the response entirely (network
    // hiccup, a flag the backend doesn't know about yet, etc) - never assume a feature should be
    // visible just because its flag wasn't found. In normal operation the flag is always present
    // (see backend/server.js's featureFlags default object), so this only matters as a fail-safe.
    // ============================
    function applyFeatureFlags(flags, data) {
        const f = flags || {};
        // Judges don't need the Item Glossary (added 2026-08-24, per user's explicit request -
        // "remove the item glossary from the Judges panel, they don't need it") - it's a
        // perp-only shopping reference, not something a Judge/GM has any use for. Hidden here
        // regardless of the global itemGlossary flag, for BOTH a playing Judge and a
        // watching-Judges-group member (same pair of checks used elsewhere for "is this viewer
        // a Judge" - see isPlayingJudgeScreen/isWatchingJudgeScreen in renderPerpSheet). The
        // Achievements button is untouched - only the glossary was called out.
        const isJudgeViewer = !!(data && ((data.assignedJudgeName && data.judgeIsPlaying) || data.isWatchingJudge));
        const glossaryBtn = document.getElementById("glossary-open-button");
        const achievementsBtn = document.getElementById("achievements-open-button");
        if (glossaryBtn) glossaryBtn.style.display = (f.itemGlossary && !isJudgeViewer) ? "" : "none";
        if (achievementsBtn) achievementsBtn.style.display = f.achievements ? "" : "none";
    }

    // Used inline inside renderPerpSheet for the action buttons that live inside the character
    // sheet itself (Robbery/Pickpocket/Big Heist/Juan's) - see the block comment above.
    function featureOn(data, key) {
        return !!(data && data.featureFlags && data.featureFlags[key]);
    }

    // ============================
    // ACHIEVEMENT GALLERY - a full catalog of every achievement in the game (not just Block War),
    // so perps can browse everything there is to earn, a bit like the Item Glossary below. Purely
    // a client-side static list (unlike the item glossary there's no backend catalog endpoint for
    // this - achievement definitions don't change at runtime), cross-referenced against the
    // current viewer's own unlocked list (data.achievements, already included in every regular
    // poll - see renderPerpSheet's achievements-row). A handful are "shadowed" (shadowed: true) -
    // until unlocked they show as a "???" mystery card with the real name/description withheld,
    // so what they actually require stays a surprise. Any achievement key a player has unlocked
    // that ISN'T in this catalog (e.g. a per-heist "Completed: X" grant) still shows up, appended
    // under "Other Achievements", so nothing already earned ever goes missing from view.
    // ============================
    const ACHIEVEMENT_CATALOG = [
        { key: "Rich", name: "Rich", desc: "Stack up 100,000 Creds.", shadowed: false },
        { key: "First Failure", name: "First Failure", desc: "Get busted on a job for the first time. Every legend has a rap sheet.", shadowed: false },
        { key: "Pickpocket Pro", name: "Pickpocket Pro", desc: "Land 10 successful pickpockets.", shadowed: false },
        { key: "Pickpocket Veteran", name: "Pickpocket Veteran", desc: "Land 100 successful pickpockets.", shadowed: false },
        { key: "First Big Heist", name: "First Big Heist", desc: "Take part in your first Big Heist.", shadowed: false },
        { key: "Born Unlucky", name: "Born Unlucky", desc: "Get arrested 5 times.", shadowed: false },
        { key: "Cube Yoyo", name: "Cube Yoyo", desc: "Get arrested 20 times. The Isocubes know you by name now.", shadowed: false },
        { key: "Busted!", name: "Busted!", desc: "Get arrested for the very first time.", shadowed: false },
        { key: "Robbery Pro", name: "Robbery Pro", desc: "Pull off 10 successful robberies.", shadowed: false },
        { key: "Robber Veteran", name: "Robber Veteran", desc: "Pull off 100 successful robberies.", shadowed: false },
        { key: "Clean Getaway", name: "Clean Getaway", desc: "Escape a Big Heist without getting caught.", shadowed: false },
        { key: "Smooth Criminal", name: "Smooth Criminal", desc: "Complete 5 Big Heists, regardless of which ones.", shadowed: false },
        { key: "Street Cred", name: "Street Cred", desc: "Reach 100 Kudos.", shadowed: false },
        { key: "Known Face", name: "Known Face", desc: "Reach 500 Kudos.", shadowed: false },
        { key: "Local Legend", name: "Local Legend", desc: "Reach 2,000 Kudos.", shadowed: false },
        { key: "In the Red", name: "In the Red", desc: "Let your Kudos balance drop below zero.", shadowed: true },
        { key: "Enlisted", name: "Enlisted", desc: "Take part in your first Block War.", shadowed: false },
        { key: "First Blood", name: "First Blood", desc: "Win your first Block War.", shadowed: false },
        { key: "Block Captain", name: "Block Captain", desc: "Win 5 Block Wars.", shadowed: false },
        { key: "Block Warlord", name: "Block Warlord", desc: "Win 10 Block Wars.", shadowed: false },
        { key: "Last Block Standing", name: "Last Block Standing", desc: "Win 25 Block Wars. A living legend of the concrete jungle.", shadowed: false },
        { key: "Survivor", name: "Survivor", desc: "See a Block War through to the end without fleeing.", shadowed: false },
        { key: "Coward's Way Out", name: "Coward's Way Out", desc: "Flee from a Block War by not voting before the panel timer runs out.", shadowed: true },
        { key: "Too Hot for the Judges", name: "Too Hot for the Judges", desc: "Be part of a Block War that gets broken up by the Judges before either side wins.", shadowed: true },
        { key: "Glutton for Punishment", name: "Glutton for Punishment", desc: "Lose 5 Block Wars.", shadowed: true },
        { key: "Turncoat", name: "Turncoat", desc: "Fight for both Wagner Block and Ezquerra Block across different wars.", shadowed: true },
        // WALLY SQUAD (2026-08-15) - all four unlock silently (see Achievements - Unlock's
        // "silent" argument), never announced in chat, so nobody's identity leaks mid-heist.
        // Not shadowed - the Wally Squad mechanic itself is already public knowledge (the Snitch
        // Line takeover tells the whole audience it's in play the moment someone's assigned), so
        // naming these openly doesn't spoil anything about WHO currently holds the role.
        { key: "Undercover", name: "Undercover", desc: "Get assigned as the Wally Squad for the first time.", shadowed: false },
        { key: "Inside Job", name: "Inside Job", desc: "As Wally Squad, sabotage a task that goes on to actually fail - and sink the heist.", shadowed: false },
        { key: "Ghost", name: "Ghost", desc: "See a Big Heist through to the end as Wally Squad without ever getting caught.", shadowed: false },
        { key: "Backstabber", name: "Backstabber", desc: "Use Dob In to send a crewmate to the cubes on your way out as Wally Squad.", shadowed: false }
    ];

    function setupAchievementsGallery() {
        const openBtn = document.getElementById("achievements-open-button");
        if (!openBtn) return;

        openBtn.addEventListener("click", function () {
            const terminal = document.querySelector(".terminal");
            const overlay = document.getElementById("achievements-overlay");
            if (!terminal || !overlay) return;

            terminal.classList.add("achievements-active");
            overlay.classList.add("achievements-visible");
            renderAchievementsGallery();
        });
    }

    function wireAchievementsCloseButton() {
        const closeBtn = document.getElementById("achievements-close-button");
        if (closeBtn) {
            closeBtn.addEventListener("click", function () {
                const terminal = document.querySelector(".terminal");
                const overlay = document.getElementById("achievements-overlay");
                if (terminal) terminal.classList.remove("achievements-active");
                if (overlay) overlay.classList.remove("achievements-visible");
            });
        }
    }

    function renderAchievementsGallery() {
        const overlay = document.getElementById("achievements-overlay");
        if (!overlay) return;

        const unlocked = (lastFetchedData && Array.isArray(lastFetchedData.achievements)) ? lastFetchedData.achievements : [];
        const unlockedSet = {};
        unlocked.forEach(function (a) { unlockedSet[a] = true; });

        const catalogKeys = {};
        ACHIEVEMENT_CATALOG.forEach(function (a) { catalogKeys[a.key] = true; });
        const otherUnlocked = unlocked.filter(function (a) { return !catalogKeys[a]; });

        let html = '<div class="section-title">Achievements</div>';
        html += '<div class="items-text">' + unlocked.length + ' of ' + ACHIEVEMENT_CATALOG.length + ' unlocked'
            + (otherUnlocked.length > 0 ? ' (plus ' + otherUnlocked.length + ' more)' : '') + '.</div>';
        html += '<div id="achievements-list">';

        ACHIEVEMENT_CATALOG.forEach(function (a) {
            const isUnlocked = !!unlockedSet[a.key];
            const isMystery = a.shadowed && !isUnlocked;
            let cls = "achievement-card " + (isUnlocked ? "achievement-unlocked" : "achievement-locked");
            if (isMystery) cls += " achievement-mystery";
            html += '<div class="' + cls + '">';
            html += '<div class="achievement-card-name">' + (isMystery ? '???' : escapeHtml(a.name)) + '</div>';
            html += '<div class="achievement-card-desc">' + (isMystery ? 'A mystery achievement - keep playing to find out what it takes.' : escapeHtml(a.desc)) + '</div>';
            html += '<div class="achievement-card-status">' + (isUnlocked ? 'Unlocked' : 'Locked') + '</div>';
            html += '</div>';
        });

        if (otherUnlocked.length > 0) {
            html += '<div class="section-title">Other Achievements</div>';
            otherUnlocked.forEach(function (a) {
                html += '<div class="achievement-card achievement-unlocked">';
                html += '<div class="achievement-card-name">' + escapeHtml(humanize(a)) + '</div>';
                html += '<div class="achievement-card-status">Unlocked</div>';
                html += '</div>';
            });
        }

        html += '</div>';
        html += '<button class="panel-back-button" id="achievements-close-button">&larr; Close</button>';

        overlay.innerHTML = html;
        wireAchievementsCloseButton();
    }

    // ============================
    // ITEM GLOSSARY - replaces !itemcatalog/!iteminfo/!itemsearch with a click-to-browse list,
    // fetched once from a dedicated endpoint (not embedded in the regular 15s poll payload,
    // since the catalog is large and effectively static - only changes when the Item Catalog
    // Loader re-runs on the Streamer.bot side) and cached client-side for the rest of the
    // session. Lives entirely in its own overlay (#glossary-overlay, a sibling of #content in
    // panel.html) rather than hooking into renderPerpSheet's mode branching, so it can never be
    // wiped out by a poll landing mid-browse, and touching it carries zero risk of breaking any
    // of the existing mugshot/shop/heist render paths.
    // ============================
    let itemGlossaryCache = null;
    let itemGlossaryFilter = "";

    function setupItemGlossary() {
        const openBtn = document.getElementById("glossary-open-button");
        if (!openBtn) return;

        openBtn.addEventListener("click", function () {
            const terminal = document.querySelector(".terminal");
            const overlay = document.getElementById("glossary-overlay");
            if (!terminal || !overlay) return;

            terminal.classList.add("glossary-active");
            overlay.classList.add("glossary-visible");

            if (itemGlossaryCache) {
                renderItemGlossary();
                return;
            }

            overlay.innerHTML = '<div class="items-text">Loading catalog...</div>';
            fetch(BACKEND_URL + "/api/item-catalog")
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    itemGlossaryCache = (data && data.catalog) ? data.catalog : {};
                    renderItemGlossary();
                })
                .catch(function (err) {
                    console.error("item-catalog fetch failed:", err);
                    overlay.innerHTML =
                        '<div class="items-text">Could not load the item catalog - try again later.</div>' +
                        '<button class="panel-back-button" id="glossary-close-button">&larr; Close</button>';
                    wireGlossaryCloseButton();
                });
        });
    }

    function wireGlossaryCloseButton() {
        const closeBtn = document.getElementById("glossary-close-button");
        if (closeBtn) {
            closeBtn.addEventListener("click", function () {
                const terminal = document.querySelector(".terminal");
                const overlay = document.getElementById("glossary-overlay");
                if (terminal) terminal.classList.remove("glossary-active");
                if (overlay) overlay.classList.remove("glossary-visible");
            });
        }
    }

    function renderItemGlossary() {
        const overlay = document.getElementById("glossary-overlay");
        if (!overlay || !itemGlossaryCache) return;

        const allKeys = Object.keys(itemGlossaryCache).sort();

        let html = '<div class="section-title">Item Glossary</div>';
        html += '<input type="text" class="glossary-search" id="glossary-search-input" placeholder="Search items..." value="' + escapeHtml(itemGlossaryFilter) + '">';
        html += '<div id="glossary-list">' + buildGlossaryListHtml(allKeys) + '</div>';
        html += '<button class="panel-back-button" id="glossary-close-button">&larr; Close</button>';

        overlay.innerHTML = html;
        wireGlossaryCloseButton();

        const searchInput = document.getElementById("glossary-search-input");
        if (searchInput) {
            // Focus it immediately so typing works right after opening without an extra click -
            // cursor lands at the end of any already-typed filter text rather than the start.
            searchInput.focus();
            const existingLength = searchInput.value.length;
            searchInput.setSelectionRange(existingLength, existingLength);

            searchInput.addEventListener("input", function () {
                itemGlossaryFilter = searchInput.value;
                const listEl = document.getElementById("glossary-list");
                if (listEl) listEl.innerHTML = buildGlossaryListHtml(allKeys);
            });
        }
    }

    // ============================
    // "How to use" line (added 2026-08-16, per user request) - the glossary previously only ever
    // showed what an item IS (description) and where to get it (cost/rob-from), not how it
    // actually gets used in play. Rather than hand-writing a usage blurb per item (32 of them,
    // and easy to let drift out of sync with the real mechanics), this is generated straight from
    // the same bonusRoles/bonusValue/scope/heatReduction fields the server itself reads to apply
    // the item's actual effect - see "Big Heist - Use Item" (Group-scope items, committed to a
    // task's Use Item button) and "Pickpocket - Attempt" (Personal-scope items, applied
    // automatically off inventory, no explicit "use" needed) for the mechanics this mirrors.
    // Robbery's own skill-bonus math doesn't read these same fields directly, so the Personal
    // wording below is deliberately scoped to "personal jobs" rather than naming Robbery
    // specifically - Pickpocket is the one confirmed consumer.
    function buildHowToUseText(def) {
        const bonusRoles = Array.isArray(def.bonusRoles) ? def.bonusRoles : [];
        const bonusValue = def.bonusValue || 0;
        const scope = (def.scope || "Group").toLowerCase();
        const heatReduction = def.heatReduction;

        const hasAnyRole = bonusRoles.some(function (r) { return r.toUpperCase() === "ANY"; });
        const roleText = bonusRoles.length === 0
            ? null
            : (hasAnyRole ? "any task" : bonusRoles.map(humanize).join(" or "));

        const parts = [];
        if (roleText && bonusValue > 0) {
            if (scope === "personal") {
                parts.push("Sits in your inventory and automatically adds +" + bonusValue + " to your own roll on a personal job (like Pickpocket) that calls for " + roleText + " - no need to \"use\" it, just have it on you.");
            } else {
                parts.push("Commit it to a Big Heist task that needs " + roleText + " (via that task's Use Item button) to add +" + bonusValue + " for the whole crew on that task.");
            }
        }
        if (heatReduction) {
            parts.push("Also usable from the Lay Low screen to cut your personal heat by " + heatReduction + ".");
        }

        return parts.length > 0 ? parts.join(" ") : null;
    }

    function buildGlossaryListHtml(allKeys) {
        const filterLower = itemGlossaryFilter.trim().toLowerCase();
        const keys = filterLower
            ? allKeys.filter(function (k) { return k.toLowerCase().indexOf(filterLower) !== -1; })
            : allKeys;

        if (keys.length === 0) {
            return '<div class="items-text">No items match "' + escapeHtml(itemGlossaryFilter) + '".</div>';
        }

        let html = "";
        keys.forEach(function (key) {
            const def = itemGlossaryCache[key] || {};
            const imageFile = def.imageFile;
            const description = def.description || "No description on file yet.";
            const category = def.category || "Uncategorized";
            const priceMin = def.priceMin;
            const priceMax = def.priceMax;
            const shopWeight = def.shopWeight || 0;
            const stealLocations = Array.isArray(def.stealLocations) ? def.stealLocations : [];

            // Cost line only shows when Juan can actually stock it (shopWeight > 0) - just the
            // number range now, no "Juan's Emporium" wording per the updated template.
            const costText = (shopWeight > 0 && (priceMin || priceMax))
                ? "Cost: " + (priceMin || 0) + "-" + (priceMax || 0) + " creds"
                : null;
            const robText = stealLocations.length > 0
                ? "Rob From: " + stealLocations.map(humanize).join(", ")
                : null;
            const howToUseText = buildHowToUseText(def);

            html += '<div class="glossary-item">';
            html += '<div class="glossary-item-card">';
            html += '<div class="glossary-item-name">' + escapeHtml(humanize(key)) + '</div>';
            html += '<div class="glossary-item-img-frame">';
            html += imageFile
                ? '<img src="' + ITEMS_BASE_URL + '/' + encodeURIComponent(imageFile) + '" alt="' + escapeHtml(humanize(key)) + '">'
                : '<div class="mugshot-placeholder">No image</div>';
            html += '</div>';
            html += '<div class="glossary-item-type">' + escapeHtml(category) + '</div>';
            html += '</div>';
            html += '<div class="glossary-item-body">';
            html += '<div class="glossary-item-desc">' + escapeHtml(description) + '</div>';
            if (howToUseText) html += '<div class="glossary-item-how">' + escapeHtml(howToUseText) + '</div>';
            if (costText) html += '<div class="glossary-item-cost">' + escapeHtml(costText) + '</div>';
            if (robText) html += '<div class="glossary-item-where">' + escapeHtml(robText) + '</div>';
            if (!costText && !robText) html += '<div class="glossary-item-where">Not currently obtainable</div>';
            html += '</div>';
            html += '</div>';
        });

        return html;
    }
