// rate-limit.js
// -----------------------------------------------------------------------------
// A small rate limiter: "each visitor may try this at most N times per window".
//
// Without one, someone can run a script that tries thousands of passwords a
// minute against the login form ("brute forcing"), or hammers sign-up trying
// invite codes. bcrypt already makes each guess slow, and invite codes are far
// too long to guess, but limiting attempts is a cheap extra layer, and it
// stops one visitor from keeping the server busy hashing all day.
//
// How it works ("fixed window" counting):
//   - Each visitor is identified by their IP address (req.ip).
//   - We keep a count of their requests and when their window started.
//   - When the window is over, the count starts again from zero.
//   - Over the limit? We answer 429 Too Many Requests and skip the route.
//
// The counts live in a Map in memory. That's fine for one server process; a
// restart simply resets everyone. A site running several servers would keep
// the counts somewhere shared (like Redis), and most projects use the
// `express-rate-limit` package, which does the same thing as this file with
// more options.
// -----------------------------------------------------------------------------

function rateLimit({ windowMs, max, message }) {
  // ip -> { count, windowStart }. Each call to rateLimit() gets its own Map,
  // so login and sign-up are counted separately.
  const hits = new Map();

  // Forget visitors whose window has ended, so the Map doesn't grow forever.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (now - entry.windowStart >= windowMs) hits.delete(ip);
    }
  }, windowMs).unref();

  // This is the middleware itself: a function shaped (req, res, next).
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    let entry = hits.get(req.ip);

    // First visit, or their old window has run out: start a fresh one.
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      hits.set(req.ip, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      // Retry-After is a standard header telling the client how many seconds
      // to wait before trying again.
      const secondsLeft = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(secondsLeft));
      return res.status(429).send(message(Math.ceil(secondsLeft / 60)));
    }

    next();
  };
}

module.exports = rateLimit;
