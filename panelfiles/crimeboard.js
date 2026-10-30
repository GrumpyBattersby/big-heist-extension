// ============================
// CRIME BOARD (panel side) - the players' shared investigation board.
//
// Opened from the "Crime Board" button under the panel (players and the GM only - panel.js calls
// CrimeBoard.setAccess() from applyFeatureFlags). It covers the whole extension frame:
//   - in the normal 318px panel it's a searchable list of every card, with notes and details;
//   - popped out and widened past 640px it becomes the full board: cards in scenario areas,
//     arrows between them, drag to rearrange, notes in a side drawer.
//
// Talks to backend/crimeboard.js:
//   GET  /api/crimeboard?rev=&cat=   polled every 4s while open; only sends what changed
//   POST /api/crimeboard/op          one change (add card, note, arrow, move...); returns the board
//
// Needs cytoscape.min.js loaded first, and panel.js's window.BigHeistPanel bridge for the backend
// URL and auth headers. Everything is drawn into <div id="cb"> in panel.html.
// ============================
(function () {
  'use strict';

  const POLL_MS = 4000;
  // Set by crimeboard-obs.html (the OBS browser source page): read-only, no login, a key instead.
  const OBS = window.CRIMEBOARD_OBS || null;
  const GM_TEAM = { name: 'GM', color: '#2bb9c9' };
  const NO_TEAM = { name: 'No team', color: '#8a93a6' };
  const TYPES = {
    Person:   { color: '#566a8f', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/>' },
    Robot:    { color: '#6d5a94', icon: '<rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 3v4M9 12h.01M15 12h.01M9 15h6"/>' },
    Location: { color: '#3a7076', icon: '<path d="M4 21V8l6-4v17M10 21V10h10v11M14 13h2M14 16h2M6 10h2M6 13h2"/>' },
    Evidence: { color: '#8d6a37', icon: '<circle cx="10" cy="10" r="5"/><path d="M14 14l6 6"/>' },
    Group:    { color: '#7c4555', icon: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c1-4 3-5 6-5s5 1 6 5M12 20c.5-3 2-5 4-5 3 0 5 1 6 5"/>' },
    Crime:    { color: '#8e3a3a', icon: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>' },
    Event:    { color: '#4b7848', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>' }
  };
  const KIND_TYPE = { person: 'Person', robot: 'Robot', place: 'Location', item: 'Evidence' };
  const KIND_GROUP = { person: 'People', robot: 'People', place: 'Places', item: 'Items' };
  const isTall = type => type === 'Person' || type === 'Robot';
  const typeOf = t => TYPES[t] ? t : 'Evidence';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nameKey = n => String(n || '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  // Teams are made by the GM, so their names and colours come from the board.
  const teamInfo = id => (state.teams || []).find(t => t.id === id) || (state.retiredTeams || {})[id] || (id === 'GM' ? GM_TEAM : NO_TEAM);
  const tColor = id => teamInfo(id).color;
  const tName = id => teamInfo(id).name;
  // A lighter version of a team colour, for text on the dark holographic glass.
  const tText = id => { const c = tColor(id).slice(1); const ch = k => Math.round(parseInt(c.substr(k, 2), 16) * 0.55 + 255 * 0.45).toString(16).padStart(2, '0'); return '#' + ch(0) + ch(2) + ch(4); };
  // Arrows are beams of light: the team colour pushed toward white.
  const tBeam = id => { const c = tColor(id).slice(1); const ch = k => Math.round(parseInt(c.substr(k, 2), 16) * 0.7 + 255 * 0.3).toString(16).padStart(2, '0'); return '#' + ch(0) + ch(2) + ch(4); };
  const dot = (id, title) => `<span class="team-dot" style="background:${tColor(id)}"${title ? ` title="${esc(title)}"` : ''}></span>`;
  const teamWord = id => `<span style="color:${tText(id)}">${esc(tName(id))}</span>`;

  // ---------- stand-in pictures (cards with no art yet) ----------
  // Drawn at the same proportions as the real artwork: people/robots tall, everything else square.
  const picCache = {};
  function standInPicture(type, name) {
    const key = type + '|' + name;
    if (picCache[key]) return picCache[key];
    const seed = [...String(name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = k => ((seed * (k + 3) * 2654435761) >>> 0) % 1000 / 1000;
    const ink = '#050608', dark = '#1d2330', blue = '#0b2a86', yellow = '#ffd21f', red = '#e8322a', cyan = '#66fbfd';
    const tall = isTall(type);
    const W = 160, H = tall ? 308 : 160;
    let b = '';
    if (tall) {
      b += `<rect width="${W}" height="${H}" fill="#c9ced6"/>`;
      for (let k = 0; k <= 10; k++) {
        const y = 18 + k * 26;
        b += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#8a92a1" stroke-width="${k % 2 ? 1 : 2}"/>` +
             `<text x="5" y="${y - 4}" font-size="9" font-family="monospace" fill="#5c6372">${(7 - k * 0.5).toFixed(1)}</text>`;
      }
      const sh = 0.92 + rnd(1) * 0.12;
      const top = 270 - 236 * sh;
      if (type === 'Robot') {
        b += `<g fill="${dark}">
          <rect x="56" y="${top + 6}" width="48" height="40" rx="6"/><rect x="77" y="${top - 12}" width="6" height="18"/>
          <rect x="44" y="${top + 52}" width="72" height="88" rx="8"/><rect x="26" y="${top + 58}" width="14" height="78" rx="6"/><rect x="120" y="${top + 58}" width="14" height="78" rx="6"/>
          <rect x="54" y="${top + 144}" width="20" height="${270 - top - 144}" rx="5"/><rect x="86" y="${top + 144}" width="20" height="${270 - top - 144}" rx="5"/></g>
          <circle cx="80" cy="${top - 14}" r="6" fill="${red}"/>
          <rect x="64" y="${top + 20}" width="11" height="8" fill="${cyan}"/><rect x="85" y="${top + 20}" width="11" height="8" fill="${cyan}"/>
          <rect x="60" y="${top + 72}" width="40" height="22" rx="3" fill="#2f3a52"/><circle cx="70" cy="${top + 83}" r="4" fill="${yellow}"/>`;
      } else {
        b += `<g fill="${dark}">
          <circle cx="80" cy="${top + 26}" r="${22 + rnd(2) * 4}"/>
          <path d="M80 ${top + 54}c-26 0-40 8-44 26l-10 74c-1 8 10 10 13 3l11-52 2 ${270 - top - 132}h20l6-${Math.round((270 - top - 140) * 0.6)} 6 ${Math.round((270 - top - 140) * 0.6)}h20l2-${270 - top - 132} 11 52c3 7 14 5 13-3l-10-74c-4-18-18-26-44-26z"/></g>`;
      }
      b += `<rect x="0" y="270" width="${W}" height="38" fill="${ink}"/>
        <text x="80" y="294" text-anchor="middle" font-size="13" font-family="monospace" fill="${yellow}">MC1-${10000 + seed % 89999}</text>`;
    } else if (type === 'Location') {
      b = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a1f"/><stop offset="1" stop-color="${yellow}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#g)"/>`;
      let x = -6;
      for (let k = 0; x < W; k++) {
        const w = 22 + rnd(k) * 22, h = 60 + rnd(k + 9) * 80;
        b += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" fill="${k % 2 ? dark : blue}" stroke="${ink}" stroke-width="2"/>`;
        for (let wy = H - h + 8; wy < H - 6; wy += 11) for (let wx = x + 5; wx < x + w - 5; wx += 8)
          if (rnd(wx + wy) > .45) b += `<rect x="${wx}" y="${wy}" width="3" height="5" fill="#ffe14a"/>`;
        x += w - 2;
      }
    } else if (type === 'Evidence') {
      b = `<rect width="${W}" height="${H}" fill="#b9b2a0"/>
        <rect x="22" y="14" width="116" height="132" rx="8" fill="#eef1f3" fill-opacity=".9" stroke="${ink}" stroke-width="3"/>
        <rect x="22" y="14" width="116" height="26" fill="${red}" stroke="${ink}" stroke-width="3"/>
        <text x="80" y="33" text-anchor="middle" font-size="14" font-weight="700" font-family="Impact, Arial Black, sans-serif" fill="#fff">EVIDENCE</text>
        <line x1="30" x2="130" y1="48" y2="48" stroke="#7f8796" stroke-width="2" stroke-dasharray="4 3"/>
        <g transform="translate(52 56) scale(2.3)" fill="none" stroke="${blue}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TYPES.Evidence.icon}</g>
        <text x="80" y="136" text-anchor="middle" font-size="10" font-family="monospace" fill="#3d4452">ITEM #${1000 + seed % 8999}</text>`;
    } else if (type === 'Group') {
      b = `<rect width="${W}" height="${H}" fill="#9aa3b4"/>` +
        [[42, 1], [118, 1], [80, 0]].map(([cx, back]) => { const c = back ? '#3a4150' : dark, y = back ? 62 : 74;
          return `<circle cx="${cx}" cy="${y}" r="20" fill="${c}"/><path d="M${cx - 38} ${H}c3-36 18-${H - y - 28} 38-${H - y - 28}s35 ${H - y - 64} 38 ${H - y - 28}z" fill="${c}"/>`; }).join('');
    } else if (type === 'Crime') {
      b = `<defs><pattern id="h" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="16" fill="${ink}" fill-opacity=".15"/></pattern></defs>
        <rect width="${W}" height="${H}" fill="${red}"/><rect width="${W}" height="${H}" fill="url(#h)"/>
        <path d="M80 22l60 108H20z" fill="${yellow}" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
        <rect x="75" y="58" width="10" height="40" fill="${ink}"/><rect x="75" y="106" width="10" height="10" fill="${ink}"/>`;
    } else {
      b = `<rect width="${W}" height="${H}" fill="${blue}"/><circle cx="80" cy="80" r="56" fill="${yellow}" stroke="${ink}" stroke-width="5"/>
        <path d="M80 44v38l24 16" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>`;
    }
    return picCache[key] = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${b}</svg>`);
  }

  // Record pictures live on GitHub Pages. A missing one (a name that doesn't match its file) is
  // swapped for a stand-in once the browser reports it can't load, and the board redraws.
  const imgState = {};
  function probe(url) {
    if (imgState[url]) return;
    imgState[url] = 'loading';
    const im = new Image();
    im.onload = () => { imgState[url] = 'ok'; };
    im.onerror = () => { imgState[url] = 'bad'; scheduleRender(); };
    im.src = url;
  }
  function imgFor(i) {
    const r = recordFor(i);
    if (r && r.img && i.src === 'record') { probe(r.img); if (imgState[r.img] !== 'bad') return r.img; }
    if (typeof i.img === 'string' && i.img.startsWith('data:image/')) return i.img;
    if (r && r.img) { probe(r.img); if (imgState[r.img] !== 'bad') return r.img; }
    return standInPicture(typeOf(i.type), i.name);
  }
  // A card's type colour mixed toward hologram cyan, so frames still differ by type.
  const holoFrame = c => { const h = c.slice(1), m = (k, t) => Math.round(parseInt(h.substr(k, 2), 16) * 0.45 + t * 0.55).toString(16).padStart(2, '0'); return '#' + m(0, 120) + m(2, 245) + m(4, 255); };
  const thumb = (i, big) => `<span class="ico${big ? ' big' : ''}${isTall(i.type) ? ' tall' : ''}" style="border-color:${TYPES[typeOf(i.type)].color}"><img src="${esc(imgFor(i))}" alt=""></span>`;

  // Shrinks an uploaded picture so a card stays small enough to save.
  function readPicture(input) {
    return new Promise(res => {
      const f = input && input.files && input.files[0];
      if (!f) return res(null);
      const r = new FileReader();
      r.onerror = () => res(null);
      r.onload = () => {
        const im = new Image();
        im.onerror = () => res(null);
        im.onload = () => {
          const k = Math.min(1, 320 / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.8));
        };
        im.src = r.result;
      };
      r.readAsDataURL(f);
    });
  }

  // ---------- state from the backend ----------
  let state = { cases: [], teams: {}, players: [], items: [], links: [], notes: [], events: [] };
  let RECORDS = [], REC_INDEX = new Map();
  let me = { name: '', team: null, isGM: false };
  let CARD_TYPES = Object.keys(TYPES), gm = null;
  let rev = '', cat = '', loaded = false, online = true;
  let lastEventAt = null;

  const reindex = () => { REC_INDEX = new Map(RECORDS.map(r => [nameKey(r.name), r])); };
  const recordFor = i => (i.src === 'record' || i.src === 'pending') ? REC_INDEX.get(nameKey(i.name)) : null;
  const item = id => state.items.find(i => i.id === id);
  const caseOf = id => state.cases.find(c => c.id === id) || { id, name: 'Unknown scenario' };
  const notesFor = id => state.notes.filter(n => n.itemId === id).sort((a, b) => a.at - b.at);
  const myScenario = () => { const t = (state.teams || []).find(x => x.id === me.team); return (t && t.caseId) || (state.cases[0] && state.cases[0].id); };
  const copiesOf = i => i.src === 'record' ? state.items.filter(x => x.id !== i.id && x.src === 'record' && nameKey(x.name) === nameKey(i.name)) : [];
  const allNotesFor = i => [i, ...copiesOf(i)].flatMap(c => notesFor(c.id).map(n => Object.assign({ where: c.caseId }, n))).sort((a, b) => a.at - b.at);
  const linksFor = id => state.links.filter(l => l.from === id || l.to === id);
  const teamsOn = id => [...new Set([item(id).team, ...notesFor(id).map(n => n.team), ...linksFor(id).map(l => l.team)])];
  const myTeam = () => me.team || (me.isGM ? 'GM' : null);
  const canChange = obj => me.isGM || (obj.team && obj.team === me.team);
  const scenarioOptions = sel => state.cases.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}${c.id === myScenario() ? ' (your scenario)' : ''}</option>`).join('');
  const detailsOf = i => { const r = i.src === 'record' ? recordFor(i) : null; return r ? r.details : i.details; };

  function api(path, opts) {
    if (OBS) return fetch(OBS.backendUrl + path, { cache: 'no-store' }).then(res => res.json().catch(() => ({})).then(data => ({ status: res.status, data })));
    const bridge = window.BigHeistPanel;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, bridge ? bridge.getAuthHeaders() : {});
    return fetch((bridge ? bridge.backendUrl : '') + path, Object.assign({}, opts, { headers }))
      .then(res => res.json().catch(() => ({})).then(data => ({ status: res.status, data })));
  }

  function applyBoard(b) {
    if (!b) return;
    state = b;
    // New announcements (e.g. "the GM added a case file") pop up once, never the old ones.
    const evs = b.events || [];
    const newest = evs.length ? Math.max(...evs.map(e => e.at)) : 0;
    if (lastEventAt === null) lastEventAt = newest;
    else { evs.filter(e => e.at > lastEventAt).forEach(e => announce(e.text)); lastEventAt = Math.max(lastEventAt, newest); }
  }

  let pollTimer = null, polling = false;
  function poll() {
    if (polling || !isOpen) return;
    polling = true;
    api((OBS ? '/api/crimeboard/obs?key=' + encodeURIComponent(OBS.key) + '&' : '/api/crimeboard?') + 'rev=' + encodeURIComponent(rev) + '&cat=' + encodeURIComponent(cat))
      .then(({ status, data }) => {
        setOnline(true);
        if (status !== 200) { showGate(data && data.error, data && data.message, status); return; }
        hideGate();
        const meChanged = JSON.stringify(me) !== JSON.stringify(data.me);
        if (!OBS) { me = data.me; CARD_TYPES = data.types || CARD_TYPES; }
        let changed = meChanged || !loaded;
        if (data.catalog) { RECORDS = data.catalog; reindex(); cat = data.cat; changed = true; }
        if (data.board) { applyBoard(data.board); changed = true; }
        if (data.gm && JSON.stringify(data.gm) !== JSON.stringify(gm)) { gm = data.gm; changed = true; }
        rev = data.rev;
        if (!loaded) { loaded = true; applyView(true); }
        if (changed) renderAll();
        if (OBS && data.focus && data.focus.seq !== obsSeq) { obsSeq = data.focus.seq; setTimeout(() => obsFocus(data.focus), changed ? 250 : 0); }
      })
      .catch(() => { setOnline(false); if (!loaded) showGate('offline'); })
      .finally(() => { polling = false; });
  }

  function op(body) {
    return api('/api/crimeboard/op', { method: 'POST', body: JSON.stringify(body) })
      .then(({ status, data }) => {
        setOnline(true);
        if (status !== 200 || !data.ok) { announce((data && data.message) || 'That didn\'t save. Try again.'); return null; }
        applyBoard(data.board); rev = data.rev;
        if (data.gm) gm = data.gm;
        renderAll();
        return data;
      })
      .catch(() => { setOnline(false); announce('Can\'t reach M.A.C. right now. Try again in a moment.'); return null; });
  }

  // ---------- open / close ----------
  let root = null, isOpen = false, built = false, access = false;

  function setAccess(allowed) {
    access = !!allowed;
    const btn = document.getElementById('crimeboard-open-button');
    if (btn) btn.style.display = access ? '' : 'none';
    if (!access && isOpen) close();
  }
  function openBoard() {
    root = document.getElementById('cb');
    if (!root) return;
    if (!built) build();
    root.hidden = false;
    isOpen = true;
    applyView(true);
    poll();
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
    clearInterval(clockTimer);
    clockTimer = setInterval(updateFoot, 30000);
  }
  function close() {
    isOpen = false;
    clearInterval(pollTimer); clearInterval(clockTimer);
    if (root) root.hidden = true;
    endArrow && endArrow();
  }
  let clockTimer = null;

  // ---------- markup ----------
  function build() {
    built = true;
    root.innerHTML = `
  <div class="toast" id="cbToast" role="status" hidden></div>
  <div class="stage" id="cbStage">
    <div class="gate" id="cbGate"><div class="gate-card"><h1 class="logo">CRIME BOARD</h1><p id="cbGateMsg">Connecting to M.A.C.…</p><button class="x-close" data-close>Back to terminal</button></div></div>

    <div class="panel-wrap fill" id="panelWrap" hidden>
      <div class="panel-frame">
        <div class="p-head">
          <div class="p-title">
            <h1 class="logo">CRIME BOARD</h1>
            <span class="head-tools"><button class="x-close gm" id="pGm" hidden>GM</button><button class="x-close" data-close>Close</button></span>
            <span class="me" id="pMe"></span>
          </div>
          <input class="field" id="pSearch" type="search" placeholder="Search people, places, evidence" autocomplete="off">
          <div style="display:flex;gap:8px"><button class="btn primary" id="pAdd" style="flex:1;justify-content:center">Add a card</button></div>
          <div class="popout-hint">For the full board with arrows, pop this panel out and widen the window.</div>
        </div>
        <div class="p-body" id="pBody"></div>
      </div>
    </div>

    <div class="board" id="board" hidden>
      <div class="b-bar">
        <h1 class="logo">CRIME BOARD</h1>
        <div class="sub"><span class="readout">M.A.C. // Sector 21 case files</span><span class="kicker">Shared by every team</span></div>
        <div class="search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="5"/><path d="M11 11l4 4"/></svg>
          <input class="field" id="bSearch" type="search" placeholder="Find a card" list="cbNames" autocomplete="off">
          <datalist id="cbNames"></datalist>
        </div>
        <button class="btn" id="arrowBtn" title="Shortcut: A">Draw arrow</button>
        <button class="btn" id="pinBtn">Add a card</button>
        <button class="btn" id="mineBtn">My scenario</button>
        <button class="btn" id="fitBtn">Fit board</button>
        <span class="grow"></span>
        <span class="me" id="bMe"></span>
        <span class="head-tools"><button class="x-close gm" id="bGm" hidden>GM tools</button><button class="x-close" data-close>Close</button></span>
      </div>
      <div class="canvas-wrap">
        <div id="cy" aria-label="Investigation board"></div>
        <div class="holo-floor" aria-hidden="true"></div>
        <div class="holo-sweep" aria-hidden="true"></div>
        <div class="overlay-left">
          <span class="caption">Show arrows</span>
          <div id="teamToggles" style="display:grid;gap:8px"></div>
          <span class="caption" style="margin-top:6px">Frame colour</span>
          <div class="legend" id="legend"></div>
        </div>
        <div class="status" id="status" hidden></div>
        <div class="obs-caption" id="obsCaption" hidden></div>
        <form class="popover" id="arrowForm" hidden>
          <span class="caption">New arrow</span><span class="readout" id="arrowFormTitle"></span>
          <input class="field" id="arrowLabel" placeholder="What connects them? e.g. paid off, seen at" maxlength="40" autocomplete="off">
          <div class="row"><button type="button" class="btn small" id="arrowCancel">Cancel</button><button class="btn small primary">Draw arrow</button></div>
        </form>
        <form class="popover" id="pinForm" hidden>
          <span class="caption">Add to the board</span>
          <div class="seg" role="group" aria-label="Where the card comes from">
            <button type="button" id="srcLaw" aria-pressed="true">From M.A.C.</button>
            <button type="button" id="srcNew" aria-pressed="false">New clue</button>
          </div>
          <div id="lawFields" style="display:grid;gap:8px"><div class="combo" id="pinCombo"></div></div>
          <div id="newFields" style="display:grid;gap:8px" hidden>
            <input class="field" id="pinName" placeholder="Name, e.g. Torn betting slip" maxlength="60" autocomplete="off">
            <select class="field" id="pinType"></select>
            <textarea class="field" id="pinDetails" placeholder="What is it? Where was it found? Any player can edit this later."></textarea>
            <label class="picfield" for="pinImg"><span class="kicker">Picture (optional)</span><input type="file" id="pinImg" accept="image/*"></label>
          </div>
          <label class="picfield" for="pinCase"><span class="kicker">Scenario</span><select class="field" id="pinCase"></select></label>
          <textarea class="field" id="pinNote" placeholder="Your team's first note (optional)"></textarea>
          <div class="row"><button type="button" class="btn small" id="pinCancel">Cancel</button><button class="btn small primary">Pin to board</button></div>
        </form>
        <aside class="drawer" id="drawer" hidden></aside>
      </div>
      <div class="b-foot" aria-label="Terminal status">
        <span><span class="led on" id="fLed"></span><span id="fLink">Link online</span></span>
        <span>Cards <b id="fCards">0</b></span>
        <span>Arrows <b id="fArrows">0</b></span>
        <span>Scenarios <b id="fCases">0</b></span>
        <span class="grow"></span>
        <span>M.A.C. terminal 21-07</span>
        <span id="fClock"></span>
        <span class="vents" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
    </div>
  </div>`;
    root.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    wirePanel();
    wireBoard();
  }

  const $ = id => document.getElementById(id);

  function setOnline(on) {
    if (online === on) return;
    online = on;
    const led = $('fLed'), txt = $('fLink');
    if (led) led.className = 'led ' + (on ? 'on' : 'off');
    if (txt) txt.textContent = on ? 'Link online' : 'Link down · retrying';
  }

  function showGate(error, message, status) {
    const gate = $('cbGate');
    if (!gate) return;
    // Once the board has loaded, a hiccup shouldn't hide it; the footer LED shows the link is down.
    if (loaded && (error === 'loading' || error === 'offline' || status >= 500)) return;
    let text = message || 'Connecting to M.A.C.…';
    if (error === 'not_a_player') text = 'The Crime Board is for the Judges and Perps playing in the RPG. If that\'s you, ask the GM to link your character.';
    if (error === 'identity_not_shared') text = 'Share your Twitch identity with this extension to open the Crime Board.';
    if (error === 'offline') text = 'Can\'t reach M.A.C. right now. Trying again…';
    if (error === 'bad_key') text = 'This OBS view needs the right key at the end of its address (…?key=). Check CRIMEBOARD_OBS_KEY on Render.';
    $('cbGateMsg').textContent = text;
    gate.hidden = false;
    $('panelWrap').hidden = true; $('board').hidden = true;
    if (error === 'not_a_player') loaded = false;
  }
  function hideGate() { const g = $('cbGate'); if (g) g.hidden = true; }

  let announceTimer;
  function announce(text) {
    const el = $('cbToast');
    if (!el) return;
    el.textContent = text; el.hidden = false;
    clearTimeout(announceTimer); announceTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // ---------- view: list in the panel, full board when popped out ----------
  let mode = null;
  function applyView(force) {
    if (!isOpen || !loaded) return;
    hideGate();
    const w = $('cbStage').clientWidth;
    const next = (OBS || w >= 640) ? 'board' : 'panel';
    if (next === mode && !force) { if (mode === 'board' && cy) cy.resize(); return; }
    const first = mode !== next;
    mode = next;
    $('panelWrap').hidden = mode !== 'panel';
    $('board').hidden = mode !== 'board';
    if (mode === 'board') {
      initCy(); cy.resize();
      if (first) { cy.fit(undefined, 40); setTimeout(goMine, 150); }
    }
    renderAll();
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => applyView()).observe(document.documentElement);
  } else {
    window.addEventListener('resize', () => applyView());
  }

  function renderMe() {
    const t = myTeam();
    const sc = myScenario();
    const teamLabel = t && tName(t) !== me.name ? ' · ' + teamWord(t) : '';
    const html = `${dot(t || 'none')}${esc(me.name)}${teamLabel}${sc && me.team ? ' · ' + esc(caseOf(sc).name) : ''}`;
    $('pMe').innerHTML = html;
    $('bMe').innerHTML = html;
    $('pGm').hidden = !me.isGM;
    $('bGm').hidden = !me.isGM;
  }
  const noTeamHtml = () => (!me.team && !me.isGM) ? '<p class="no-team">You can read the board, but you need a team to add things. Ask the GM to put you on one.</p>' : '';

  // Re-rendering a form throws away what's been typed. While someone is typing in a panel or
  // drawer, a background update waits until they click away, and typed text is carried over.
  let renderPending = false;
  let renderTimer = null;
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => { if (isOpen) renderAll(); }, 300); }
  function busyIn(container) {
    const a = document.activeElement;
    return !!(container && a && container.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName));
  }
  function keepTyping(container, fn) {
    const vals = {};
    container.querySelectorAll('input[id]:not([type=file]), textarea[id], select[id]').forEach(el => { vals[el.id] = el.value; });
    fn();
    Object.entries(vals).forEach(([id, v]) => { const el = $(id); if (el && container.contains(el) && v && !el.value) el.value = v; });
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (renderPending && isOpen) { renderPending = false; renderAll(); } }, 150));

  function renderAll() {
    if (!isOpen || !loaded) return;
    renderMe();
    if (mode === 'panel') {
      if (busyIn($('pBody'))) { renderPending = true; return; }
      keepTyping($('pBody'), renderPanel);
    }
    if (mode === 'board') {
      refreshCy();
      if (busyIn($('drawer'))) { renderPending = true; return; }
      keepTyping($('drawer'), renderDrawer);
    }
  }

  // ---------- shared pieces (panel and drawer) ----------
  function connectionsHtml(i) {
    const ls = linksFor(i.id);
    if (!ls.length) return '<p class="empty">No arrows to or from this card yet.</p>';
    return ls.map(l => {
      const out = l.from === i.id, other = item(out ? l.to : l.from);
      if (!other) return '';
      return `<div class="conn">${dot(l.team, tName(l.team) + ' · ' + l.by)}
        <span class="arrow">${out ? '→' : '←'}</span>
        <span style="min-width:0"><button class="go" data-go="${other.id}">${esc(other.name)}</button>${other.caseId !== i.caseId ? ` <span class="kicker">in ${esc(caseOf(other.caseId).name)}</span>` : ''}
        <span class="sub" style="color:var(--muted);font-size:12px"> ${esc(l.label || '')}</span></span></div>`;
    }).join('');
  }
  function notesHtml(i) {
    const ns = allNotesFor(i);
    if (!ns.length) return '<p class="empty">No notes yet. Be the first team to add one.</p>';
    return ns.map(n => `<div class="note" style="--tc:${tColor(n.team)}"><span class="who"><span class="chip" style="background:${tColor(n.team)}">${esc(tName(n.team))}</span>${esc(n.by)} · ${ago(n.at)}${n.where !== i.caseId ? ` · in ${esc(caseOf(n.where).name)}` : ''}${(me.isGM || n.by === me.name) ? `<button class="del" data-delnote="${n.id}">Delete</button>` : ''}</span><p>${esc(n.text)}</p></div>`).join('');
  }
  function alsoHtml(i) {
    const cs = copiesOf(i);
    if (!cs.length) return '';
    return `<section class="also"><span class="caption">Also on the board in</span>${cs.map(c =>
      `<div class="conn"><span class="arrow">⇄</span><button class="go" data-go="${c.id}">${esc(caseOf(c.caseId).name)}</button><span class="kicker">pinned by ${teamWord(c.team)}</span></div>`).join('')}
      <p class="sub" style="margin:0;font-size:12px;color:var(--muted)">Notes from every copy are shown together below.</p></section>`;
  }
  let editing = null;
  function detailsHtml(i, prefix) {
    const law = i.src === 'record';
    const rec = recordFor(i);
    if (editing === i.id && !law) {
      return `<form class="details" id="${prefix}EditForm">
        <span class="kicker">Edit details</span>
        <input class="field" id="${prefix}EditName" value="${esc(i.name)}" maxlength="60" required>
        ${i.src === 'player' ? `<select class="field" id="${prefix}EditType">${CARD_TYPES.map(t => `<option${t === i.type ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ''}
        <textarea class="field" id="${prefix}EditText" rows="5">${esc(i.details || '')}</textarea>
        ${i.src === 'player' ? `<label class="picfield" for="${prefix}EditImg"><span class="kicker">Change picture</span><input type="file" id="${prefix}EditImg" accept="image/*"></label>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn small" id="${prefix}EditCancel">Cancel</button><button class="btn small primary">Save</button></div>
      </form>`;
    }
    const edited = i.editedBy ? 'Edited by ' + esc(i.editedBy) + ' · ' + ago(i.editedAt) : '';
    const meta = law ? (rec ? `<span class="src">Case file</span><span>${esc(rec.sub || 'From M.A.C. · kept up to date')}</span>`
                            : '<span class="src gone">Case file</span><span>No longer in M.A.C.</span>')
      : i.src === 'pending' ? `<span class="src lead">New lead</span><span>Waiting for the GM to add it${edited ? ' · ' + edited : ''}</span>`
      : `<span class="src player">Player clue</span><span>${edited}</span>`;
    const text = detailsOf(i);
    return `<div class="details${i.src === 'pending' ? ' lead' : ''}"><div class="meta">${meta}</div>
      <p>${text ? esc(text) : '<span class="empty">No details yet.</span>'}</p>
      ${law ? '' : `<button class="btn small" id="${prefix}Edit" style="justify-self:start">Edit details</button>`}</div>`;
  }
  function wireDetails(i, prefix) {
    const eb = $(prefix + 'Edit');
    if (eb) eb.onclick = () => { editing = i.id; renderAll(); const t = $(prefix + 'EditText'); if (t) t.focus(); };
    const f = $(prefix + 'EditForm');
    if (f) {
      $(prefix + 'EditCancel').onclick = () => { editing = null; renderAll(); };
      f.onsubmit = async e => {
        e.preventDefault();
        const pic = await readPicture($(prefix + 'EditImg'));
        const body = { op: 'editCard', id: i.id, name: $(prefix + 'EditName').value.trim(), details: $(prefix + 'EditText').value.trim() };
        if ($(prefix + 'EditType')) body.type = $(prefix + 'EditType').value;
        if (pic) body.img = pic;
        const ok = await op(body);
        if (ok) { editing = null; renderAll(); }
      };
    }
  }
  function cardToolsHtml(i, prefix) {
    if (!canChange(i)) return '';
    return `<div class="card-tools">${me.isGM ? `<button class="btn small" id="${prefix}ShowCard">Show on stream</button>` : ''}<button class="btn small danger" id="${prefix}DelCard">Take this card down</button></div>`;
  }
  function wireCardTools(i, prefix, after) {
    const sh = $(prefix + 'ShowCard');
    if (sh) sh.onclick = () => showOnStream('card:' + i.id);
    const b = $(prefix + 'DelCard');
    if (!b) return;
    b.onclick = async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Click again to remove it, its arrows and notes'; return; }
      const ok = await op({ op: 'deleteCard', id: i.id });
      if (ok && after) after();
    };
  }
  function addNoteForm(prefix) {
    if (!myTeam()) return '';
    return `<form class="addnote" id="${prefix}NoteForm">
      <textarea class="field" id="${prefix}NoteText" placeholder="Add a note for ${esc(tName(myTeam()))}" required></textarea>
      <button class="btn primary" style="justify-self:end">Add note</button></form>`;
  }
  function wireNoteForm(prefix, itemId, container) {
    const f = $(prefix + 'NoteForm');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const ta = $(prefix + 'NoteText');
      const t = ta.value.trim();
      if (!t) return;
      ta.blur();
      const ok = await op({ op: 'addNote', itemId, text: t });
      if (ok) { const again = $(prefix + 'NoteText'); if (again) again.value = ''; }
    };
    container.querySelectorAll('[data-delnote]').forEach(b => b.onclick = () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Sure?'; return; }
      op({ op: 'deleteNote', id: b.dataset.delnote });
    });
  }

  // New cards fill the first empty spot on a grid inside their scenario, so they never spill
  // into a neighbouring scenario's area.
  function freeSpot(caseId) {
    const sib = state.items.filter(x => x.caseId === caseId);
    if (!sib.length) {
      // An empty scenario goes to the right of everything else on the board.
      const maxX = state.items.length ? Math.max(...state.items.map(s => s.x)) : 0;
      return { x: state.items.length ? maxX + 400 : 200, y: 200 };
    }
    const left = Math.min(...sib.map(s => s.x)), top = Math.min(...sib.map(s => s.y));
    const cols = Math.max(4, Math.round((Math.max(...sib.map(s => s.x)) - left) / 150) + 1);
    const free = (px, py) => !sib.some(s => Math.abs(s.x - px) < 110 && Math.abs(s.y - py) < 150);
    let x = left, y = top;
    for (let n = 0; n < 400; n++) { x = left + (n % cols) * 150; y = top + Math.floor(n / cols) * 170; if (free(x, y)) break; }
    return { x, y };
  }
  async function createCard(card) {
    const spot = freeSpot(card.caseId);
    const res = await op(Object.assign({ op: 'addCard' }, card, spot));
    return res ? res.id : null;
  }

  // ---------- type-ahead over every M.A.C. record ----------
  let comboSeq = 0;
  function makeCombo(rootEl, getCaseId) {
    const uid = 'cbcombo' + (++comboSeq);
    rootEl.innerHTML = `<div class="combo-box">
        <input class="field" id="${uid}" role="combobox" aria-expanded="false" aria-controls="${uid}-list" aria-autocomplete="list"
          placeholder="Type a name, or open the list" autocomplete="off">
        <button type="button" class="combo-toggle" aria-label="Show everything" tabindex="-1">▾</button>
      </div>
      <ul class="combo-list" id="${uid}-list" role="listbox" hidden></ul>`;
    const input = rootEl.querySelector('input'), list = rootEl.querySelector('ul'), toggle = rootEl.querySelector('.combo-toggle');
    let picked = -1, active = -1;
    const whereIs = r => state.items.filter(x => x.src !== 'player' && nameKey(x.name) === nameKey(r.name));
    function render() {
      const q = input.value.trim().toLowerCase();
      const caseId = getCaseId();
      const score = r => { const n = r.name.toLowerCase(); return !q ? 1 : n.startsWith(q) ? 4 : n.split(/\s+/).some(w => w.startsWith(q)) ? 3 : n.includes(q) ? 2 : (r.details || '').toLowerCase().includes(q) ? 1 : 0; };
      const shown = RECORDS.map((r, k) => ({ r, k, sc: score(r) })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc || a.r.name.localeCompare(b.r.name));
      let html = `<li class="combo-count" role="presentation">${shown.length} of ${RECORDS.length} in M.A.C.</li>`;
      const best = g => Math.max(0, ...shown.filter(({ r }) => KIND_GROUP[r.kind] === g).map(x => x.sc));
      ['People', 'Places', 'Items'].sort((a, b) => best(b) - best(a)).forEach(g => {
        const rows = shown.filter(({ r }) => KIND_GROUP[r.kind] === g);
        if (!rows.length) return;
        html += `<li class="combo-group" role="presentation">${g}</li>`;
        rows.forEach(({ r, k }) => {
          const where = whereIs(r), here = where.some(x => x.caseId === caseId);
          const status = here ? 'Already in this scenario' : where.length ? 'Also in ' + [...new Set(where.map(x => caseOf(x.caseId).name))].join(', ') : (r.sub || '');
          const t = KIND_TYPE[r.kind];
          html += `<li role="option" id="${uid}-o${k}" data-k="${k}" aria-disabled="${here}" class="${here ? 'off' : ''}">
            <span class="ico${isTall(t) ? ' tall' : ''}"><img src="${esc(imgState[r.img] === 'bad' || !r.img ? standInPicture(t, r.name) : r.img)}" data-fallback="${esc(t)}|${esc(r.name)}" data-url="${esc(r.img || '')}" alt="" loading="lazy"></span>
            <span class="txt"><b>${esc(r.name)}</b><small>${t}${status ? ' · ' + esc(status) : ''}</small></span></li>`;
        });
      });
      if (!shown.length) html += `<li class="combo-empty" role="presentation">Nothing in M.A.C. matches “${esc(input.value)}”.</li>`;
      const typed = input.value.trim();
      if (typed && !REC_INDEX.has(nameKey(typed))) {
        html += `<li class="combo-group" role="presentation">Not in M.A.C. yet?</li>`;
        [['person', 'Add as a new person'], ['place', 'Add as a new place'], ['item', 'Add as a new item']].forEach(([kind, label]) => {
          html += `<li role="option" class="new" id="${uid}-n${kind}" data-new="${kind}">
            <span class="ico${kind === 'person' ? ' tall' : ''} plus">+</span>
            <span class="txt"><b>${label}: “${esc(typed)}”</b><small>A new lead until the GM adds the case file</small></span></li>`;
        });
      }
      list.innerHTML = html;
      list.querySelectorAll('img[data-fallback]').forEach(im => im.onerror = () => {
        const [t, n] = im.dataset.fallback.split('|');
        if (im.dataset.url) imgState[im.dataset.url] = 'bad';
        im.onerror = null; im.src = standInPicture(t, n);
      });
      list.querySelectorAll('[role=option]').forEach(li => li.onmousedown = e => { e.preventDefault(); if (li.classList.contains('off')) return; pickOption(li); });
      active = -1;
    }
    const options = () => [...list.querySelectorAll('[role=option]:not(.off)')];
    function setActive(n) {
      const os = options(); if (!os.length) return;
      active = (n + os.length) % os.length;
      os.forEach((o, i) => o.classList.toggle('act', i === active));
      os[active].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', os[active].id);
    }
    function open() { render(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function choose(k) { picked = { name: RECORDS[k].name }; input.value = RECORDS[k].name; rootEl.classList.add('picked'); rootEl.classList.remove('newlead'); close(); }
    function pickOption(li) {
      if (li.dataset.new) { picked = { newKind: li.dataset.new, name: input.value.trim() }; rootEl.classList.add('picked', 'newlead'); close(); }
      else choose(+li.dataset.k);
    }
    input.onfocus = open;
    input.oninput = () => { picked = -1; rootEl.classList.remove('picked', 'need', 'newlead'); open(); };
    input.onblur = () => setTimeout(close, 120);
    toggle.onmousedown = e => { e.preventDefault(); if (list.hidden) { input.focus(); open(); } else close(); };
    input.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter' && !list.hidden) { e.preventDefault(); const os = options(); if (active >= 0 && os[active]) pickOption(os[active]); else if (os.length === 1) pickOption(os[0]); }
      else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); }
    };
    return {
      // -1 nothing picked, a record (by name), or { newKind, name } for a new lead
      value: () => picked,
      reset() { picked = -1; input.value = ''; rootEl.classList.remove('picked', 'need', 'newlead'); close(); },
      refresh() { if (picked !== -1 && !picked.newKind && whereIs(picked).some(x => x.caseId === getCaseId())) this.reset(); if (!list.hidden) render(); },
      flag() { rootEl.classList.add('need'); input.focus(); }
    };
  }
  function cardFromCombo(v, caseId, note) {
    if (v.newKind) return { src: 'pending', name: v.name, kind: v.newKind, caseId, note };
    return { src: 'record', name: v.name, caseId, note };
  }

  // ---------- GM tools ----------
  // Teams (name, colour, scenario, members), scenarios, players, what's on stream, and whether the
  // board is being saved. Every change goes through op() and is checked again on the server.
  const memberValue = p => p.character || p.name;
  function gmHtml() {
    if (!gm) return '<p class="empty">Loading GM tools…</p>';
    const caseOpts = sel => state.cases.map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    const known = [...new Set(gm.players.map(memberValue).concat(gm.players.map(p => p.name)))].sort();
    const teams = (state.teams || []).map(t => `
      <div class="gm-team" style="--tc:${t.color}">
        <form class="gm-row team-head" data-editteam="${t.id}">
          <input class="field" name="name" value="${esc(t.name)}" maxlength="40" aria-label="Team name">
          <input type="color" name="color" value="${esc(t.color)}" aria-label="Team colour">
          <button class="btn small">Save</button>
        </form>
        <label class="picfield"><span class="kicker">Playing</span><select class="field" data-teamcase="${t.id}">${caseOpts(t.caseId)}</select></label>
        <div class="members">${t.members.length ? t.members.map(m => `<span class="member">${esc(m)}<button type="button" aria-label="Take ${esc(m)} off the team" data-unmember="${esc(m)}">×</button></span>`).join('') : '<span class="empty">No Judges yet</span>'}</div>
        <form class="gm-row" data-addmember="${t.id}"><input class="field" name="name" list="cbKnown" placeholder="Add a Judge (character or Twitch name)" maxlength="60" autocomplete="off"><button class="btn small primary">Add</button></form>
        <div class="card-tools"><button type="button" class="btn small" data-show="team:${t.id}">Show on stream</button><button type="button" class="btn small danger" data-delteam="${t.id}">Delete team</button></div>
      </div>`).join('');
    const cases = state.cases.map(c => {
      const used = state.items.filter(i => i.caseId === c.id).length;
      return `<form class="gm-row three" data-rename="${c.id}"><input class="field" value="${esc(c.name)}" maxlength="60" aria-label="Scenario name">
        <span class="kicker">${used} card${used === 1 ? '' : 's'}</span>
        <span style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small">Rename</button><button type="button" class="btn small" data-show="case:${c.id}">Show</button>${used ? '' : `<button type="button" class="btn small danger" data-delcase="${c.id}">Delete</button>`}</span></form>`;
    }).join('');
    const players = gm.players.length ? gm.players.map(p => `<div class="gm-row three"><span class="who"><b>${esc(p.character || p.name)}</b><small>${esc(p.name)} · ${p.team ? teamWord(p.team) : 'no team'}</small></span>
        <select class="field" data-moveplayer="${esc(memberValue(p))}" aria-label="Team for ${esc(memberValue(p))}"><option value="">No team</option>${(state.teams || []).map(t => `<option value="${t.id}"${p.team === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <button class="btn small" data-removeplayer="${esc(p.uid)}">Remove</button></div>`).join('')
      : '<p class="empty">Players appear here the first time they open the board.</p>';
    const blocked = gm.blocked.length ? `<section><span class="caption">Removed from the board</span><div class="gm-list">${gm.blocked.map(b => `<div class="gm-row"><span class="who"><b>${esc(b.name)}</b></span><button class="btn small" data-allow="${esc(b.uid)}">Let back in</button></div>`).join('')}</div></section>` : '';
    const sv = gm.saving || {};
    const status = [
      sv.persistent ? `Saved to GitHub${sv.lastSavedAt ? ' · last save ' + ago(Date.parse(sv.lastSavedAt)) : ''} · daily backups on` : '<b>Not saved between restarts</b> - add GITHUB_TOKEN on Render',
      sv.channelLocked ? 'GM locked to your channel' : '<b>Set TWITCH_CHANNEL_ID on Render</b>',
      sv.obs ? 'OBS view on' : 'OBS view off - set CRIMEBOARD_OBS_KEY on Render'
    ].map(x => `<li>${x}</li>`).join('');
    return `<datalist id="cbKnown">${known.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      <section><span class="caption">On stream</span>
        <div class="card-tools"><button type="button" class="btn small primary" data-show="all">Show whole board</button></div>
        <label class="toggle"><input type="checkbox" id="gmSwitch"${gmSwitchScene ? ' checked' : ''}>Also switch OBS to the board</label>
        <p class="sub hint">“Show on stream” buttons on cards, teams and scenarios move the OBS view there.</p></section>
      <section><span class="caption">Teams</span><div class="gm-list">${teams}</div>
        <form class="gm-row" id="gmAddTeam"><input class="field" name="name" placeholder="New team, e.g. Blue Judge Team" maxlength="40"><input type="color" name="color" value="#1f63ff" aria-label="New team colour"><button class="btn small primary">Add</button></form></section>
      <section><span class="caption">Scenarios</span><div class="gm-list">${cases}</div>
        <form class="gm-row" id="gmAddCase"><input class="field" id="gmNewCase" placeholder="New scenario, e.g. The Good Cheat" maxlength="60"><button class="btn small primary">Add</button></form></section>
      <section><span class="caption">Players</span><div class="gm-list">${players}</div></section>
      ${blocked}
      <section><span class="caption">Saving</span><ul class="gm-status">${status}</ul></section>`;
  }
  let gmSwitchScene = true;
  const showOnStream = target => op({ op: 'gmShow', target, switchScene: gmSwitchScene }).then(ok => { if (ok) announce('On stream now: ' + (target === 'all' ? 'the whole board' : 'your pick') + '.'); });
  function armed(b, text) { if (b.dataset.armed === '1') return true; b.dataset.armed = '1'; b.textContent = text; return false; }
  function wireGm(container) {
    const sw = container.querySelector('#gmSwitch');
    if (sw) sw.onchange = () => { gmSwitchScene = sw.checked; };
    container.querySelectorAll('[data-show]').forEach(b => b.onclick = () => showOnStream(b.dataset.show));
    container.querySelectorAll('[data-editteam]').forEach(f => f.onsubmit = e => { e.preventDefault(); f.querySelector('input').blur();
      op({ op: 'gmEditTeam', teamId: f.dataset.editteam, name: f.elements.name.value, color: f.elements.color.value }); });
    container.querySelectorAll('[data-teamcase]').forEach(s => s.onchange = () => { s.blur(); op({ op: 'gmEditTeam', teamId: s.dataset.teamcase, caseId: s.value }); });
    container.querySelectorAll('[data-unmember]').forEach(b => b.onclick = () => op({ op: 'gmRemoveMember', name: b.dataset.unmember }));
    container.querySelectorAll('[data-addmember]').forEach(f => f.onsubmit = async e => { e.preventDefault();
      const v = f.elements.name.value.trim(); if (!v) return; f.elements.name.blur();
      const ok = await op({ op: 'gmAddMember', teamId: f.dataset.addmember, name: v }); if (ok) f.elements.name.value = ''; });
    container.querySelectorAll('[data-delteam]').forEach(b => b.onclick = () => { if (armed(b, 'Click again to delete the team')) op({ op: 'gmDeleteTeam', teamId: b.dataset.delteam }); });
    container.querySelectorAll('[data-rename]').forEach(f => f.onsubmit = e => { e.preventDefault(); f.querySelector('input').blur(); op({ op: 'gmRenameCase', id: f.dataset.rename, name: f.querySelector('input').value }); });
    container.querySelectorAll('[data-delcase]').forEach(b => b.onclick = () => op({ op: 'gmDeleteCase', id: b.dataset.delcase }));
    container.querySelectorAll('[data-moveplayer]').forEach(s => s.onchange = () => { s.blur();
      op(s.value ? { op: 'gmAddMember', teamId: s.value, name: s.dataset.moveplayer } : { op: 'gmRemoveMember', name: s.dataset.moveplayer }); });
    container.querySelectorAll('[data-removeplayer]').forEach(b => b.onclick = () => { if (armed(b, 'Sure?')) op({ op: 'gmRemovePlayer', uid: b.dataset.removeplayer }); });
    container.querySelectorAll('[data-allow]').forEach(b => b.onclick = () => op({ op: 'gmAllowPlayer', uid: b.dataset.allow }));
    const addTeam = container.querySelector('#gmAddTeam');
    if (addTeam) addTeam.onsubmit = async e => { e.preventDefault(); const v = addTeam.elements.name.value.trim(); if (!v) return; addTeam.elements.name.blur();
      const ok = await op({ op: 'gmAddTeam', name: v, color: addTeam.elements.color.value, caseId: state.cases[0] && state.cases[0].id }); if (ok) addTeam.elements.name.value = ''; };
    const add = container.querySelector('#gmAddCase');
    if (add) add.onsubmit = async e => { e.preventDefault(); const v = $('gmNewCase').value.trim(); if (!v) return; $('gmNewCase').blur(); const ok = await op({ op: 'gmAddCase', name: v }); if (ok) $('gmNewCase').value = ''; };
  }

  // ---------- PANEL (318px list) ----------
  let pView = null; // item id, 'add', 'gm' or null
  let pAddSrc = 'record', pAddCase = null;
  function wirePanel() {
    $('pSearch').oninput = () => { pView = null; renderPanel(); };
    $('pAdd').onclick = () => { pView = 'add'; renderPanel(); };
    $('pGm').onclick = () => { pView = pView === 'gm' ? null : 'gm'; renderPanel(); };
  }
  function renderPanel() {
    if (mode !== 'panel') return;
    const pBody = $('pBody');
    if (pView === 'add') return renderPanelAdd();
    if (pView === 'gm' && me.isGM) {
      pBody.innerHTML = `<div class="p-detail"><button class="back" id="pBack">← All cards</button><h3>GM tools</h3>${gmHtml()}</div>`;
      $('pBack').onclick = () => { pView = null; renderPanel(); };
      wireGm(pBody);
      return;
    }
    if (pView && item(pView)) return renderPanelDetail(item(pView));
    const q = $('pSearch').value.trim().toLowerCase();
    let html = noTeamHtml();
    const order = [...state.cases].sort((a, b) => (b.id === myScenario()) - (a.id === myScenario()));
    order.forEach(c => {
      const rows = state.items.filter(i => i.caseId === c.id && (!q || i.name.toLowerCase().includes(q) || String(detailsOf(i) || '').toLowerCase().includes(q)));
      if (!rows.length) return;
      const teams = (state.teams || []).filter(t => t.caseId === c.id).map(t => t.id);
      html += `<div class="p-case"><span class="kicker">${me.team && c.id === myScenario() ? 'Your scenario' : 'Scenario'} · ${teams.map(teamWord).join(' · ') || 'no team'}</span><h2 class="caption">${esc(c.name)}</h2>`;
      rows.forEach(i => {
        const n = allNotesFor(i).length, l = linksFor(i.id).length, also = copiesOf(i).length;
        html += `<button class="p-row" data-id="${i.id}">${thumb(i)}
          <span><div class="name">${esc(i.name)}</div><div class="sub">${esc(i.type)} · ${n} note${n === 1 ? '' : 's'} · ${l} link${l === 1 ? '' : 's'}${also ? ' · also in another scenario' : ''}${i.src === 'pending' ? ' · new lead' : ''}</div></span>
          <span class="dots">${teamsOn(i.id).map(t => dot(t, tName(t))).join('')}</span></button>`;
      });
      html += '</div>';
    });
    if (!state.items.length) html += '<p class="empty" style="margin-top:14px">The board is empty. Add the first card.</p>';
    else if (q && html === noTeamHtml()) html += `<p class="empty">Nothing on the board matches “${esc(q)}”.</p>`;
    pBody.innerHTML = html;
    pBody.querySelectorAll('.p-row').forEach(b => b.onclick = () => { pView = b.dataset.id; renderPanel(); pBody.scrollTop = 0; });
  }
  function renderPanelAdd() {
    const pBody = $('pBody');
    if (!myTeam()) { pView = null; pBody.innerHTML = noTeamHtml(); return; }
    pBody.innerHTML = `<form class="p-detail" id="pAddForm">
      <button type="button" class="back" id="pBack">← All cards</button>
      <h3>Add a card</h3>
      <div class="seg" role="group" aria-label="Where the card comes from">
        <button type="button" id="pSrcLaw" aria-pressed="${pAddSrc === 'record'}">From M.A.C.</button>
        <button type="button" id="pSrcNew" aria-pressed="${pAddSrc === 'player'}">New clue</button>
      </div>
      ${pAddSrc === 'record'
        ? `<div class="combo" id="pCombo"></div>`
        : `<input class="field" id="pName" placeholder="Name, e.g. Torn betting slip" maxlength="60" required autocomplete="off">
           <select class="field" id="pType" aria-label="Card type">${CARD_TYPES.map(t => `<option${t === 'Evidence' ? ' selected' : ''}>${t}</option>`).join('')}</select>
           <textarea class="field" id="pDetails" placeholder="What is it? Where was it found? Any player can edit this later."></textarea>
           <label class="picfield" for="pImg"><span class="kicker">Picture (optional)</span><input type="file" id="pImg" accept="image/*"></label>`}
      <label class="picfield" for="pCase"><span class="kicker">Scenario</span><select class="field" id="pCase">${scenarioOptions(pAddCase || myScenario())}</select></label>
      <textarea class="field" id="pNote" placeholder="Your team's first note (optional)"></textarea>
      <button class="btn primary" style="justify-self:end">Add to board</button>
    </form>`;
    $('pBack').onclick = () => { pView = null; pAddCase = null; renderPanel(); };
    const pCombo = pAddSrc === 'record' ? makeCombo($('pCombo'), () => $('pCase').value) : null;
    $('pCase').onchange = e => { pAddCase = e.target.value; if (pCombo) pCombo.refresh(); };
    $('pSrcNew').onclick = () => { pAddSrc = 'player'; renderPanelAdd(); };
    $('pSrcLaw').onclick = () => { pAddSrc = 'record'; renderPanelAdd(); };
    $('pAddForm').onsubmit = async e => {
      e.preventDefault();
      const caseId = $('pCase').value, note = $('pNote').value.trim();
      let card;
      if (pAddSrc === 'record') {
        const v = pCombo.value();
        if (v === -1) return pCombo.flag();
        card = cardFromCombo(v, caseId, note);
      } else {
        const img = await readPicture($('pImg'));
        card = { src: 'player', name: $('pName').value.trim(), type: $('pType').value, details: $('pDetails').value.trim(), caseId, note };
        if (img) card.img = img;
      }
      if (document.activeElement) document.activeElement.blur();
      const id = await createCard(card);
      if (id) { pView = id; pAddCase = null; renderPanel(); $('pBody').scrollTop = 0; }
    };
  }
  function renderPanelDetail(i) {
    const pBody = $('pBody');
    pBody.innerHTML = `<div class="p-detail">
      <button class="back" id="pBack">← All cards</button>
      <div style="display:flex;gap:12px;align-items:center">${thumb(i, true)}
        <div style="min-width:0"><h3>${esc(i.name)}</h3><span class="kicker">${esc(i.type)} · ${esc(caseOf(i.caseId).name)}</span></div></div>
      ${detailsHtml(i, 'p')}
      ${alsoHtml(i)}
      <section><span class="caption">Connections</span>${connectionsHtml(i)}</section>
      <section style="display:grid;gap:8px"><span class="caption">Team notes</span>${notesHtml(i)}</section>
      ${addNoteForm('p')}
      ${cardToolsHtml(i, 'p')}
      <p class="sub" style="color:var(--muted);font-size:12px;margin:0">Arrows are drawn on the full board (pop the panel out).</p>
    </div>`;
    $('pBack').onclick = () => { pView = null; renderPanel(); };
    pBody.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { pView = b.dataset.go; renderPanel(); pBody.scrollTop = 0; });
    wireNoteForm('p', i.id, pBody);
    wireDetails(i, 'p');
    wireCardTools(i, 'p', () => { pView = null; renderPanel(); });
  }

  // ---------- BOARD (popped out) ----------
  let cy = null, selected = null; // { kind: 'item' | 'link' | 'gm', id }
  const shown = {};
  let dragging = false;

  function elements() {
    const els = [];
    // Each scenario is framed in the colour of the team investigating it (a second team adds an
    // outer frame in its colour), and its title says who's on it.
    state.cases.forEach(c => {
      const teams = (state.teams || []).filter(t => t.caseId === c.id);
      const c1 = teams[0] ? teams[0].color : '#66fbfd', c2 = teams[1] ? teams[1].color : c1;
      const who = teams.map(t => t.name.toUpperCase()).join('  ·  ');
      els.push({ group: 'nodes', data: { id: c.id, label: c.name.toUpperCase() + (who ? '\n' + who : ''), isCase: 1,
        tc: c1, tc2: c2, ow: teams.length > 1 ? 3 : 0, bw: teams.length ? 3 : 1 } });
    });
    state.items.forEach(i => els.push({ group: 'nodes',
      data: { id: i.id, label: i.name, parent: i.caseId, color: TYPES[typeOf(i.type)].color, frame: holoFrame(TYPES[typeOf(i.type)].color), img: imgFor(i), tall: isTall(i.type) ? 1 : 0, lead: i.src === 'pending' ? 1 : 0 },
      position: { x: i.x, y: i.y } }));
    state.links.forEach(l => { if (item(l.from) && item(l.to)) els.push({ group: 'edges',
      data: { id: l.id, source: l.from, target: l.to, label: l.label || '', color: tBeam(l.team), team: l.team } }); });
    const done = new Set();
    state.items.forEach(i => copiesOf(i).forEach(c => {
      const key = [i.id, c.id].sort().join('|');
      if (done.has(key)) return; done.add(key);
      els.push({ group: 'edges', data: { id: 'same:' + key, source: i.id, target: c.id, label: 'SAME', same: 1, color: '#050608' } });
    }));
    return els;
  }

  function initCy() {
    if (cy) return;
    const cyEl = $('cy');
    cyEl.style.backgroundImage = (OBS && OBS.clear) ? 'none' : 'radial-gradient(ellipse 70% 45% at 50% 100%, rgba(40, 200, 255, .22), transparent 70%), linear-gradient(180deg, rgba(1, 6, 20, .72), rgba(1, 8, 26, .9)), url("cb-bg.webp")';
    if (OBS && OBS.clear) cyEl.style.backgroundColor = 'transparent';
    cyEl.style.backgroundSize = 'cover, cover';
    cyEl.style.backgroundPosition = 'center, center';
    cyEl.style.backgroundRepeat = 'no-repeat, no-repeat';
    const ink = '#050608', yellow = '#ffd21f', captionInk = '#ffe14a', blue = '#0b2a86', readout = '#66fbfd';
    cy = cytoscape({
      container: cyEl,
      elements: elements(),
      layout: { name: 'preset' },
      minZoom: 0.2, maxZoom: 2.5,
      autoungrabify: !!OBS, userPanningEnabled: !OBS, userZoomingEnabled: !OBS, boxSelectionEnabled: false, autounselectify: !!OBS,
      style: [
        // Everything on the board is projected light: see-through hologram pictures in thin glowing
        // frames, glowing labels with no solid boxes, glowing team-coloured beams between cards.
        { selector: 'node', style: {
          'background-color': '#0a5a8a', 'background-opacity': 0.12, 'shape': 'round-rectangle', 'width': 96, 'height': 96,
          'background-image': 'data(img)', 'background-fit': 'cover', 'background-clip': 'node', 'background-image-crossorigin': 'null',
          // The original artwork, just slightly see-through so the city glows through it.
          'background-image-opacity': 0.8,
          'border-width': 2, 'border-color': 'data(frame)', 'border-opacity': 0.95,
          'outline-width': 1, 'outline-color': readout, 'outline-opacity': 0.45, 'outline-offset': 4,
          'underlay-color': readout, 'underlay-opacity': 0.14, 'underlay-padding': 16, 'underlay-shape': 'round-rectangle',
          'label': 'data(label)', 'color': '#c9fbff', 'font-family': 'Teko, Arial Narrow, sans-serif', 'text-transform': 'uppercase',
          'font-size': 19, 'font-weight': 600, 'text-valign': 'bottom', 'text-margin-y': 10,
          'text-wrap': 'wrap', 'text-max-width': 150,
          'text-background-color': '#03213d', 'text-background-opacity': 0.35, 'text-background-padding': 4, 'text-background-shape': 'round-rectangle',
          'text-border-width': 1, 'text-border-color': readout, 'text-border-opacity': 0.5,
          'transition-property': 'opacity, underlay-opacity', 'transition-duration': '200ms' } },
        { selector: 'node[?tall]', style: { 'width': 62, 'height': 119, 'background-position-y': '0%' } },
        { selector: 'node[?lead]', style: { 'border-style': 'dashed', 'border-color': yellow, 'outline-color': yellow, 'underlay-color': yellow, 'underlay-opacity': 0.12 } },
        { selector: 'node[?isCase]', style: {
          'background-color': '#0a6ea8', 'background-opacity': 0.07, 'background-image': 'none',
          'shape': 'round-rectangle', 'border-width': 'data(bw)', 'border-style': 'solid', 'border-color': 'data(tc)', 'border-opacity': 0.9,
          'outline-width': 'data(ow)', 'outline-color': 'data(tc2)', 'outline-opacity': 0.85, 'outline-offset': 5,
          'underlay-color': 'data(tc)', 'underlay-opacity': 0.1, 'underlay-padding': 12,
          'label': 'data(label)', 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -18,
          'color': '#effeff', 'font-family': '"Black Ops One", Impact, sans-serif', 'font-size': 24, 'font-weight': 400, 'text-transform': 'none',
          'line-height': 1.35, 'text-justification': 'center',
          'text-background-color': '#03182e', 'text-background-opacity': 0.82, 'text-background-padding': 10, 'text-background-shape': 'round-rectangle',
          'text-border-width': 2, 'text-border-color': 'data(tc)', 'text-border-opacity': 1,
          'text-wrap': 'wrap', 'text-max-width': 2000, 'padding': 44 } },
        { selector: 'edge', style: {
          'width': 2, 'line-color': 'data(color)', 'line-opacity': 0.95, 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle',
          'arrow-scale': 1.2, 'curve-style': 'bezier', 'control-point-step-size': 50,
          'underlay-color': 'data(color)', 'underlay-opacity': 0.25, 'underlay-padding': 4,
          'label': 'data(label)', 'font-size': 12, 'color': '#d8fdff', 'font-family': 'Share Tech Mono, monospace', 'text-transform': 'uppercase',
          'text-rotation': 'autorotate', 'text-background-color': '#03182e', 'text-background-opacity': 0.55, 'text-background-padding': 4, 'text-background-shape': 'round-rectangle',
          'text-border-width': 1, 'text-border-color': 'data(color)', 'text-border-opacity': 0.9, 'line-cap': 'round',
          'transition-property': 'opacity', 'transition-duration': '200ms' } },
        { selector: 'edge[?same]', style: { 'line-color': readout, 'line-opacity': 0.5, 'line-style': 'dashed', 'line-dash-pattern': [8, 8], 'width': 1.5,
          'underlay-opacity': 0, 'target-arrow-shape': 'none', 'color': '#aef8ff', 'text-background-opacity': 0.3, 'text-border-color': readout, 'font-size': 11 } },
        { selector: '.hiddenTeam', style: { 'display': 'none' } },
        { selector: '.faded', style: { 'opacity': 0.08 } },
        { selector: 'node.sel', style: { 'border-color': '#e9ffff', 'border-width': 3, 'outline-width': 2, 'outline-opacity': 1, 'underlay-opacity': 0.4, 'underlay-padding': 22 } },
        { selector: 'edge.sel', style: { 'width': 4, 'underlay-opacity': 0.6 } },
        { selector: 'node.source', style: { 'border-color': '#e9ffff', 'border-width': 5, 'border-style': 'double', 'underlay-opacity': 0.45 } }
      ]
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (cy) cy.style().update(); });
    // Canvas text is drawn once; redraw when late fonts arrive (some browsers resolve fonts.ready early).
    // Cytoscape caches each label's picture, so nudge every label (an invisible style change) to redraw it.
    // (Only a font-size change clears that cache, so each label gets a tiny one, then it's put back.)
    const redrawText = () => {
      if (!cy) return;
      cy.batch(() => cy.elements().forEach(e => e.style('font-size', parseFloat(e.style('font-size')) + 0.01)));
      setTimeout(() => { if (cy) cy.batch(() => cy.elements().removeStyle('font-size')); }, 60);
    };
    [800, 2500].forEach(t => setTimeout(redrawText, t));
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redrawText);

    cy.on('tap', 'node', e => {
      const n = e.target;
      if (n.data('isCase')) return;
      if (arrowMode) return pickForArrow(n.id());
      select({ kind: 'item', id: n.id() });
    });
    cy.on('tap', 'edge', e => { if (arrowMode) return; if (e.target.data('same')) return flyTo(e.target.target().id()); select({ kind: 'link', id: e.target.id() }); });
    cy.on('tap', e => { if (e.target === cy) { if (arrowMode) return; select(null); } });
    cy.on('grab', 'node', () => { dragging = true; });
    cy.on('free', 'node', () => { dragging = false; });
    cy.on('dragfree', 'node', e => {
      const moved = e.target.isParent() ? e.target.children() : e.target;
      const moves = [];
      moved.forEach(n => { const i = item(n.id()); if (i) { const p = n.position(); i.x = Math.round(p.x); i.y = Math.round(p.y); moves.push({ id: i.id, x: i.x, y: i.y }); } });
      if (moves.length) op({ op: 'move', moves });
    });
    applyTeamFilter();
  }

  function updateFoot() {
    if (!$('fCards')) return;
    $('fCards').textContent = state.items.length;
    $('fArrows').textContent = state.links.length;
    $('fCases').textContent = state.cases.length;
    const d = new Date();
    $('fClock').textContent = '2099-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + d.toTimeString().slice(0, 5);
  }

  function renderTeamToggles() {
    const box = $('teamToggles');
    const teams = (state.teams || []).map(t => t.id).concat(['GM']);
    const key = teams.join() + '|' + (state.teams || []).map(t => t.name + t.color).join();
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = teams.map(t => { if (!(t in shown)) shown[t] = true;
      return `<label class="toggle"><input type="checkbox" data-team="${t}"${shown[t] ? ' checked' : ''}>${dot(t)}${esc(tName(t))}</label>`; }).join('');
    box.querySelectorAll('input').forEach(c => c.onchange = () => { shown[c.dataset.team] = c.checked; if (cy) { applyTeamFilter(); applyFocus(); } });
  }

  function refreshCy() {
    if (!cy) return;
    updateFoot();
    renderTeamToggles();
    if (dragging) return; // never yank a card out from under someone's mouse
    cy.json({ elements: elements() });
    cy.elements().removeClass('faded sel source');
    if (arrowMode && arrowFrom) cy.getElementById(arrowFrom).addClass('source');
    applyTeamFilter();
    applyFocus();
    $('cbNames').innerHTML = state.items.map(i => `<option value="${esc(i.name)}">`).join('');
  }

  function applyTeamFilter() {
    cy.edges().forEach(e => e.toggleClass('hiddenTeam', !e.data('same') && shown[e.data('team')] === false));
  }
  function applyFocus() {
    if (!cy) return;
    cy.elements().removeClass('faded sel');
    if (!selected || selected.kind === 'gm') return;
    const el = cy.getElementById(selected.id);
    if (!el.length) return;
    el.addClass('sel');
    const keep = selected.kind === 'item'
      ? el.closedNeighborhood().filter(x => !x.hasClass('hiddenTeam')).union(el.closedNeighborhood().nodes().parents())
      : el.union(el.connectedNodes()).union(el.connectedNodes().parents());
    cy.elements().not(keep).addClass('faded');
  }
  function select(sel) { selected = sel; editing = null; applyFocus(); renderDrawer(); }

  function renderDrawer() {
    if (mode !== 'board') return;
    const drawer = $('drawer');
    if (!selected) { drawer.hidden = true; return; }
    drawer.hidden = false;
    if (selected.kind === 'gm') {
      drawer.innerHTML = `<header><button class="x" id="dClose" aria-label="Close">×</button><span class="kicker">Only you can see this</span><h2>GM tools</h2></header>
        <div class="scroll">${gmHtml()}</div>`;
      wireGm(drawer);
    } else if (selected.kind === 'item') {
      const i = item(selected.id);
      if (!i) { drawer.hidden = true; selected = null; return; }
      drawer.innerHTML = `<header>
          <button class="x" id="dClose" aria-label="Close">×</button>
          <span class="kicker">${esc(i.type)} · pinned by <span style="color:${tText(i.team)}">${esc(i.by || tName(i.team))}</span></span>
          <h2>${esc(i.name)}</h2>
          <span class="kicker">${esc(caseOf(i.caseId).name)}</span>
        </header>
        <div class="scroll">
          ${detailsHtml(i, 'd')}
          ${alsoHtml(i)}
          <section><span class="caption">Connections</span>${connectionsHtml(i)}
            ${myTeam() ? '<button class="btn small" id="dArrow" style="justify-self:start;margin-top:4px">Draw arrow from here</button>' : ''}</section>
          <section style="gap:8px"><span class="caption">Team notes</span>${notesHtml(i)}</section>
          ${addNoteForm('d')}
          ${noTeamHtml()}
          ${cardToolsHtml(i, 'd')}
        </div>`;
      drawer.querySelectorAll('[data-go]').forEach(b => b.onclick = () => flyTo(b.dataset.go));
      if ($('dArrow')) $('dArrow').onclick = () => { startArrow(); pickForArrow(i.id); };
      wireNoteForm('d', i.id, drawer);
      wireDetails(i, 'd');
      wireCardTools(i, 'd', () => select(null));
    } else {
      const l = state.links.find(x => x.id === selected.id);
      if (!l || !item(l.from) || !item(l.to)) { drawer.hidden = true; selected = null; return; }
      drawer.innerHTML = `<header>
          <button class="x" id="dClose" aria-label="Close">×</button>
          <span class="kicker">Arrow · ${teamWord(l.team)} · ${esc(l.by)}</span>
          <h2>${esc(item(l.from).name)} → ${esc(item(l.to).name)}</h2>
        </header>
        <div class="scroll">
          <section><span class="kicker">Label</span><p style="margin:0">${esc(l.label || 'No label')}</p></section>
          <section><span class="kicker">Ends</span>
            <div class="conn"><span class="arrow">from</span><button class="go" data-go="${l.from}">${esc(item(l.from).name)}</button></div>
            <div class="conn"><span class="arrow">to</span><button class="go" data-go="${l.to}">${esc(item(l.to).name)}</button></div></section>
          ${canChange(l) ? '<button class="btn danger" id="dDel" style="justify-self:start">Remove this arrow</button>'
                 : `<p class="empty" style="margin:0">Only ${esc(tName(l.team))} or the GM can remove this arrow.</p>`}
        </div>`;
      drawer.querySelectorAll('[data-go]').forEach(b => b.onclick = () => flyTo(b.dataset.go));
      if ($('dDel')) $('dDel').onclick = async () => { const ok = await op({ op: 'deleteLink', id: l.id }); if (ok) select(null); };
    }
    $('dClose').onclick = () => select(null);
  }

  function flyTo(id) {
    const n = cy.getElementById(id);
    if (!n.length) return;
    select({ kind: 'item', id });
    cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1) }, { duration: 350 });
  }
  function goMine() {
    if (!cy) return;
    const area = cy.getElementById(myScenario());
    if (area.length && area.children().length) cy.animate({ fit: { eles: area, padding: 70 } }, { duration: 350 });
    else cy.animate({ fit: { padding: 40 } }, { duration: 300 });
  }

  // ---- drawing arrows ----
  let arrowMode = false, arrowFrom = null, arrowTo = null;
  function setStatus(text) {
    const status = $('status');
    status.hidden = !text;
    if (text) { status.innerHTML = `<span>${text}</span><button class="btn small" id="sCancel">Cancel</button>`; $('sCancel').onclick = endArrow; }
  }
  function startArrow() {
    if (!myTeam()) { announce('You need a team before you can draw arrows. Ask the GM.'); return; }
    arrowMode = true; arrowFrom = arrowTo = null;
    $('arrowBtn').classList.add('on'); $('arrowForm').hidden = true; $('pinForm').hidden = true;
    setStatus('Click the card the arrow starts from');
  }
  function endArrow() {
    if (!built) return;
    arrowMode = false; arrowFrom = arrowTo = null;
    $('arrowBtn').classList.remove('on'); $('arrowForm').hidden = true; setStatus('');
    if (cy) cy.nodes().removeClass('source');
  }
  function pickForArrow(id) {
    if (!arrowMode) return;
    if (!arrowFrom) { arrowFrom = id; cy.getElementById(id).addClass('source'); setStatus(`From <b>${esc(item(id).name)}</b>. Now click where it points`); return; }
    if (id === arrowFrom) return;
    arrowTo = id;
    setStatus('');
    $('arrowFormTitle').textContent = `${item(arrowFrom).name} → ${item(arrowTo).name}`;
    $('arrowForm').hidden = false;
    $('arrowLabel').value = '';
    $('arrowLabel').focus();
  }

  function wireBoard() {
    $('legend').innerHTML = Object.entries(TYPES).map(([k, v]) => `<span><i style="background:${v.color}"></i>${k}</span>`).join('');
    const bSearch = $('bSearch');
    bSearch.onchange = bSearch.onkeydown = e => {
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      const q = bSearch.value.trim().toLowerCase();
      if (!q) return;
      const hit = state.items.find(i => i.name.toLowerCase() === q) || state.items.find(i => i.name.toLowerCase().includes(q));
      if (hit) flyTo(hit.id); else announce('No card called “' + bSearch.value.trim() + '” on the board.');
    };
    $('fitBtn').onclick = () => cy.animate({ fit: { padding: 40 } }, { duration: 300 });
    $('mineBtn').onclick = goMine;
    $('bGm').onclick = () => select(selected && selected.kind === 'gm' ? null : { kind: 'gm' });
    $('arrowBtn').onclick = () => arrowMode ? endArrow() : startArrow();
    $('arrowCancel').onclick = endArrow;
    $('arrowForm').onsubmit = async e => {
      e.preventDefault();
      const from = arrowFrom, to = arrowTo, label = $('arrowLabel').value.trim();
      $('arrowLabel').blur();
      endArrow();
      const res = await op({ op: 'addLink', from, to, label });
      if (res) { const l = res.board.links[res.board.links.length - 1]; if (l) select({ kind: 'link', id: l.id }); }
    };

    // ---- adding a card ----
    const pinForm = $('pinForm'), pinType = $('pinType'), pinCase = $('pinCase');
    const pinCombo = makeCombo($('pinCombo'), () => pinCase.value);
    let pinSrc = 'record';
    function setPinSrc(src) {
      pinSrc = src;
      $('srcLaw').setAttribute('aria-pressed', String(src === 'record'));
      $('srcNew').setAttribute('aria-pressed', String(src === 'player'));
      $('lawFields').hidden = src !== 'record';
      $('newFields').hidden = src !== 'player';
      $('pinName').required = src === 'player';
    }
    $('srcLaw').onclick = () => setPinSrc('record');
    $('srcNew').onclick = () => { setPinSrc('player'); $('pinName').focus(); };
    $('pinBtn').onclick = () => {
      if (!myTeam()) { announce('You need a team before you can add cards. Ask the GM.'); return; }
      endArrow();
      pinForm.hidden = !pinForm.hidden;
      if (!pinForm.hidden) {
        pinForm.reset();
        pinType.innerHTML = CARD_TYPES.map(t => `<option${t === 'Evidence' ? ' selected' : ''}>${t}</option>`).join('');
        pinCase.innerHTML = scenarioOptions(myScenario());
        pinCombo.reset(); setPinSrc('record');
      }
    };
    pinCase.onchange = () => pinCombo.refresh();
    $('pinCancel').onclick = () => { pinForm.hidden = true; };
    pinForm.onsubmit = async e => {
      e.preventDefault();
      const caseId = pinCase.value, note = $('pinNote').value.trim();
      let card;
      if (pinSrc === 'record') {
        const v = pinCombo.value();
        if (v === -1) return pinCombo.flag();
        card = cardFromCombo(v, caseId, note);
      } else {
        const img = await readPicture($('pinImg'));
        card = { src: 'player', name: $('pinName').value.trim(), type: pinType.value, details: $('pinDetails').value.trim(), caseId, note };
        if (img) card.img = img;
      }
      if (document.activeElement) document.activeElement.blur();
      const id = await createCard(card);
      if (id) { pinForm.hidden = true; flyTo(id); }
    };

    document.addEventListener('keydown', e => {
      if (!isOpen || mode !== 'board' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'a' || e.key === 'A') arrowMode ? endArrow() : startArrow();
      if (e.key === 'Escape') { endArrow(); $('pinForm').hidden = true; select(null); }
    });
  }

  // ---------- the scan sweep: once at random, roughly every minute ----------
  function scheduleSweep() {
    setTimeout(() => {
      const el = document.querySelector('#cb .holo-sweep');
      if (el && isOpen && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
      }
      scheduleSweep();
    }, 40000 + Math.random() * 40000);
  }
  scheduleSweep();

  // ---------- OBS: zoom to what the GM or Streamer.bot picked ----------
  let obsSeq = null, obsCaptionTimer = null;
  function obsFocus(f) {
    if (!cy) return;
    let target = null;
    if (f.kind === 'case') target = cy.getElementById(f.id);
    if (f.kind === 'team') { const t = (state.teams || []).find(x => x.id === f.id); if (t) target = cy.getElementById(t.caseId); }
    if (f.kind === 'card') {
      const n = cy.getElementById(f.id);
      if (n.length) {
        selected = { kind: 'item', id: f.id }; applyFocus();
        cy.animate({ center: { eles: n }, zoom: 1.35 }, { duration: 900, easing: 'ease-in-out-cubic' });
      }
    } else {
      selected = null; applyFocus();
      const eles = target && target.length && target.children().length ? target : cy.elements();
      cy.animate({ fit: { eles, padding: 70 } }, { duration: 900, easing: 'ease-in-out-cubic' });
    }
    const cap = $('obsCaption');
    cap.textContent = f.kind === 'all' ? 'Live case files · whole board' : f.label;
    cap.hidden = false;
    cap.classList.remove('flash'); void cap.offsetWidth; cap.classList.add('flash');
  }

  // ---------- hook-up ----------
  window.CrimeBoard = { setAccess, open: openBoard, close };
  document.addEventListener('DOMContentLoaded', () => {
    if (OBS) {
      const el = document.getElementById('cb');
      el.classList.add('obs');
      if (OBS.clear) el.classList.add('clear');
      openBoard();
      return;
    }
    const btn = document.getElementById('crimeboard-open-button');
    if (btn) btn.addEventListener('click', openBoard);
    setAccess(access);
  });
})();
