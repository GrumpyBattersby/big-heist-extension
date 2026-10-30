// ============================
// GUARD - small shared protections for the backend (added 2026-10-30).
//
// Everything a viewer's browser runs (panel.js, crimeboard.js) can be read and changed by that
// viewer, so nothing in the panel is trusted: these helpers are what stop a viewer who opens the
// developer tools from flooding the server or guessing a secret.
// ============================
const crypto = require('crypto');

// Compares a provided secret with the real one in constant time, so response timing can't leak
// how many leading characters were right.
function secretOk(provided, real) {
    if (typeof provided !== 'string' || typeof real !== 'string' || !real) return false;
    const a = crypto.createHash('sha256').update(provided).digest();
    const b = crypto.createHash('sha256').update(real).digest();
    return crypto.timingSafeEqual(a, b);
}

// Fixed-window rate limiter kept in memory. key(req) picks who is being counted (a user ID, or
// the caller's IP). Over the limit -> 429 and the request goes no further.
function rateLimit({ name, max, windowMs, key }) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }, Math.max(windowMs, 30000)).unref();
    return function (req, res, next) {
        const k = key(req) || req.ip || 'unknown';
        const now = Date.now();
        let h = hits.get(k);
        if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
        h.n++;
        if (h.n > max) {
            res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
            return res.status(429).json({ error: 'rate_limited', message: 'Slow down a little and try again in a moment.' });
        }
        next();
    };
}

// Same, but for use inside a handler after the caller's identity is known.
function counter({ max, windowMs }) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }, Math.max(windowMs, 30000)).unref();
    return function over(k) {
        const now = Date.now();
        let h = hits.get(k);
        if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
        h.n++;
        return h.n > max;
    };
}

module.exports = { secretOk, rateLimit, counter };
