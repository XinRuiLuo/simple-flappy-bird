/* ============================================================
 * Simple Flappy Bird — leaderboard (leaderboard.js)
 * ------------------------------------------------------------
 * Two modes, two independent boards:
 *   coin     coin mode — scores the coins collected
 *   distance distance mode — scores the metres flown
 * The track (seed) is the same either way; only what is compared differs,
 * so a board is keyed by seed + mode.
 *
 * The board is local (localStorage) but the interface is shaped like a
 * server one:
 *   FlappyBoard.submit(payload) -> { entry, rank, ... }
 * Flip `remote.enabled` and point it at a real endpoint and no caller has
 * to change.
 *
 * Ordering: score descending -> same score, shorter time first -> first
 * come first served.
 *
 * A player occupies **one row only**: the same nickname keeps just its best
 * run, otherwise twenty sessions would leave twenty rows all called "me".
 *
 * Tunables (storage keys, rival ladder, limits) come from `config.js`;
 * all display text comes from `i18n.js`.
 * ============================================================ */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const CFG = isNode ? require('./config.js') : root.FlappyConfig;
  const I18N = isNode ? require('./i18n.js') : root.FlappyI18n;
  const api = factory(CFG, I18N);
  if (isNode) module.exports = api;
  else root.FlappyBoard = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CFG, I18N) {
  'use strict';

  const LB = CFG.leaderboard;

  // v4: coin and distance became separate modes with separate boards, and the
  // scores are not comparable with v3, hence the new keys.
  const LS_ENTRIES = LB.storageKeys.entries;
  const LS_EXTRAS = LB.storageKeys.extras; // per board: attempts + recent results
  const LS_ME = LB.storageKeys.me;
  const MAX_ENTRIES = LB.maxEntries;
  const MAX_RECENT = LB.maxRecent;
  const MAX_NAME = LB.maxNameLength;
  const DEFAULT_NAME = LB.defaultName;

  // Point this at a real backend once it exists (e.g. '/api/game/flappy').
  const remote = { enabled: !!LB.remote.enabled, base: LB.remote.base };

  /* ---------------- modes ---------------- */
  const MODES = LB.modes;
  const MODE_KEYS = Object.keys(MODES);
  const DEFAULT_MODE = MODE_KEYS[0] || 'coin';

  /** Mode descriptor; the text fields are resolved live so switching the
   * language updates every board without a reload. */
  function modeOf(m) {
    const key = MODES[m] ? m : DEFAULT_MODE;
    const base = MODES[key];
    return {
      key: base.key,
      ladder: base.ladder,
      name: I18N.t('mode.' + base.key + '.name'),
      board: I18N.t('mode.' + base.key + '.board'),
      unit: I18N.t('mode.' + base.key + '.unit'),
      hint: I18N.t('mode.' + base.key + '.hint')
    };
  }

  /* ---------------- local storage ---------------- */
  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_ENTRIES) || '{}');
    } catch (e) {
      return {};
    }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(LS_ENTRIES, JSON.stringify(data));
    } catch (e) {
      /* private mode: nothing to do */
    }
  }

  function readExtras() {
    try {
      return JSON.parse(localStorage.getItem(LS_EXTRAS) || '{}');
    } catch (e) {
      return {};
    }
  }

  function writeExtras(data) {
    try {
      localStorage.setItem(LS_EXTRAS, JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  }

  /** One board = one track x one mode. */
  function boardKey(seed, mode) {
    return 'seed:' + (seed >>> 0) + ':' + modeOf(mode).key;
  }

  function me() {
    try {
      return JSON.parse(localStorage.getItem(LS_ME) || 'null') || { name: DEFAULT_NAME };
    } catch (e) {
      return { name: DEFAULT_NAME };
    }
  }

  function setName(name) {
    const clean =
      String(name || '')
        .trim()
        .slice(0, MAX_NAME) || DEFAULT_NAME;
    try {
      localStorage.setItem(LS_ME, JSON.stringify({ name: clean }));
    } catch (e) {
      /* ignore */
    }
    return clean;
  }

  /* ---------------- ordering ---------------- */
  function compare(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.timeMs || 0) !== (b.timeMs || 0)) return (a.timeMs || 0) - (b.timeMs || 0);
    return (a.at || 0) - (b.at || 0);
  }

  /* ---------------- demo rivals (local board only) ---------------- */
  function rivals(seed, mode) {
    const m = modeOf(mode);
    return m.ladder.map(function (score, i) {
      return {
        id: 'rival:' + (seed >>> 0) + ':' + m.key + ':' + i,
        name: I18N.t('rival.' + i),
        score: score,
        timeMs: Math.round(170000 + i * 8000),
        at: 0,
        seed: seed,
        mode: m.key,
        verified: true,
        demo: true,
        flags: []
      };
    });
  }

  /* ---------------- reading boards ---------------- */
  function entriesOf(seed, mode) {
    const all = readAll();
    const list = all[boardKey(seed, mode)] || [];
    return list.slice().sort(compare);
  }

  function top(seed, mode, limit, withRivals) {
    const list = entriesOf(seed, mode).concat(withRivals === false ? [] : rivals(seed, mode));
    list.sort(compare);
    return list.slice(0, limit || 20).map(function (e, i) {
      const copy = Object.assign({}, e);
      copy.rank = i + 1;
      return copy;
    });
  }

  /* Attempts / recent results are recorded on every run; they have nothing
   * to do with which row ends up on the board. */
  function pushAttempt(seed, mode, score) {
    const all = readExtras();
    const key = boardKey(seed, mode);
    const ex = all[key] || { attempts: 0, recent: [] };
    ex.attempts = (ex.attempts || 0) + 1;
    ex.recent = [score].concat(ex.recent || []).slice(0, MAX_RECENT);
    all[key] = ex;
    writeExtras(all);
    return ex;
  }

  function stats(seed, mode) {
    const mine = entriesOf(seed, mode);
    const all = readExtras();
    const ex = all[boardKey(seed, mode)] || { attempts: 0, recent: [] };
    const best = mine.length ? mine[0] : null;
    return {
      attempts: ex.attempts || 0,
      best: best ? best.score : 0,
      bestEntry: best,
      history: (ex.recent || []).slice(0, MAX_RECENT)
    };
  }

  /* ---------------- submit ----------------
   * payload: { seed, mode, score, coins, distance, ticks, scoreTick }
   * The local demo trusts the client; a real server would verify first and
   * send back its own verdict. */
  function submit(payload) {
    const m = modeOf(payload.mode);
    const seed = payload.seed >>> 0;
    const key = boardKey(seed, m.key);
    const name = me().name || DEFAULT_NAME;

    const mineBefore = entriesOf(seed, m.key).filter(function (e) {
      return e.name === name;
    });
    const prevOwn = mineBefore.length ? mineBefore[0] : null;
    const prevBest = prevOwn ? prevOwn.score : 0;
    const isPB = payload.score > prevBest; // strictly better counts as a record
    const first = !prevOwn; // first time on this board: keep a row even at 0

    const entry = {
      id: 'me:' + Date.now() + ':' + Math.floor(Math.random() * 1e6),
      name: name,
      score: payload.score,
      timeMs: payload.scoreTick != null ? Math.round((payload.scoreTick / CFG.simulation.tickHz) * 1000) : 0,
      at: Date.now(),
      seed: seed,
      mode: m.key,
      verified: true,
      checksum: '',
      flags: []
    };

    // One row per player: a better run replaces the old row, a worse one
    // leaves it alone (the board holds your personal best).
    const all = readAll();
    if (!all[key]) all[key] = [];
    if (first || isPB) {
      all[key] = all[key].filter(function (e) {
        return e.name !== name;
      });
      all[key].push(entry);
      all[key].sort(compare);
      all[key] = all[key].slice(0, MAX_ENTRIES);
    }
    writeAll(all);
    pushAttempt(seed, m.key, payload.score);

    // The rank is the position of the row kept under this name.
    const after = top(seed, m.key, 999, true);
    let idx = -1;
    for (let i = 0; i < after.length; i++) {
      if (!after[i].demo && after[i].name === name) {
        idx = i;
        break;
      }
    }
    const myScore = idx >= 0 ? after[idx].score : payload.score;
    const upper = idx > 0 ? after[idx - 1] : null;
    const lower = idx >= 0 && idx + 1 < after.length ? after[idx + 1] : null;

    return {
      entry: entry,
      accepted: true,
      mode: m.key,
      rank: idx >= 0 ? idx + 1 : -1,
      total: after.length,
      isPB: isPB,
      first: first,
      prevBest: prevBest,
      myScore: myScore,
      diffToPrev: upper ? Math.max(0, upper.score - myScore) : null,
      aheadName: upper ? upper.name : null,
      diffToNext: lower ? Math.max(0, myScore - lower.score) : null,
      behindName: lower ? lower.name : null
    };
  }

  /* ---------------- reserved for a real backend ---------------- */
  function remoteSubmit(payload) {
    if (!remote.enabled) return Promise.resolve(null);
    return fetch(remote.base + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return null;
      });
  }

  function reset() {
    writeAll({});
    writeExtras({});
  }

  return {
    remote: remote,
    MODES: MODES,
    MODE_KEYS: MODE_KEYS,
    modeOf: modeOf,
    me: me,
    setName: setName,
    submit: submit,
    top: top,
    stats: stats,
    entriesOf: entriesOf,
    rivals: rivals,
    compare: compare,
    remoteSubmit: remoteSubmit,
    reset: reset
  };
});
