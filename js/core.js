/* ============================================================
 * Simple Flappy Bird — deterministic simulation core (core.js)
 * ------------------------------------------------------------
 * 1) A fixed 120 Hz logic tick, fully decoupled from rendering, fps
 *    and the device refresh rate.
 * 2) The track is generated from a seed, so one track code gives
 *    everybody exactly the same course.
 * 3) Coins — not gates passed — are the score, and their positions are
 *    seed-driven too. Every coin sits on a lane the bird can reach.
 * 4) Two families of obstacles:
 *      gates      static / slider / pulse / stagger / narrow / twin / clamper
 *      mechanisms blade (track saw) / swing (pendulum) / pinwheel /
 *                 orbiter (ring saw), plus the "middle is safe" trio
 *                 clamper (clamp) / twinblade / midswing.
 *    The first family keeps one safe lane above or below the hazard;
 *    the second family flips it — danger on both edges, corridor in
 *    the middle.
 *
 * Every tunable number comes from `config.js` (see that file). This
 * module works in the browser (window.FlappyCore) and in Node
 * (require('./core.js')), so the same numbers drive both.
 * ============================================================ */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const CFG = isNode ? require('./config.js') : root.FlappyConfig;
  const api = factory(CFG);
  if (isNode) module.exports = api;
  else root.FlappyCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CFG) {
  'use strict';

  /* ================= constants ================= */

  const TICK_HZ = CFG.simulation.tickHz; // logic ticks per second
  const DT = 1 / TICK_HZ;

  /* Endless track: the course is laid ahead while you fly. `buildCourse`
   * is "deterministic prefix" — the requested length only decides how far
   * the track is laid, never what the earlier segments look like. So the
   * course can always be swapped for a longer one without breaking a run. */
  const COURSE_CHUNK = CFG.course.initialSegments; // laid at start (not a limit)
  const COURSE_STEP = CFG.course.extendStep; // added per extension
  const COURSE_AHEAD = CFG.course.extendAhead; // extend once fewer than this remain
  const MAX_RUN_TICKS = CFG.simulation.maxRunTicks; // replay safety cap
  const WARMUP_PILLARS = CFG.course.warmupPillars; // first N gates are plain pillars

  const WORLD = { w: CFG.world.width, h: CFG.world.height };
  const FLOOR_Y = WORLD.h - CFG.world.floorOffset; // ground line: touching it kills
  const START_Y_RATIO = 0.4; // spawn height and the first waypoint

  const BIRD = {
    x: CFG.bird.x,
    r: CFG.bird.radius,
    gravity: CFG.bird.gravity,
    flap: CFG.bird.flapVelocity,
    maxFall: CFG.bird.maxFallSpeed
  };

  /* Standard gates (the pillars). */
  const PIPE = {
    w: CFG.pipes.width,
    spacing: CFG.pipes.spacing, // constant => reproducible track
    speedStart: CFG.pipes.speedStart,
    speedMax: CFG.pipes.speedMax,
    speedGain: CFG.pipes.speedGain,
    gapStart: CFG.pipes.gapStart,
    gapShrink: CFG.pipes.gapShrink,
    gapMin: CFG.pipes.gapMin,
    hardFactor: CFG.pipes.hardFactor, // "narrow" gate multiplier
    hardMin: CFG.pipes.hardMin,
    margin: CFG.pipes.margin, // min distance from a gap to ceiling / ground
    maxShift: CFG.pipes.maxShift // max drop between neighbouring gap centres
  };

  const PIPE_PERIOD = { base: CFG.pipes.periodBase, jitter: CFG.pipes.periodJitter };

  const OBS = CFG.obstacles;

  /* Track saw: rides a vertical rail in the middle band, never touching the
   * safe lanes above and below. */
  const BLADE = {
    r: OBS.blade.r,
    band: OBS.blade.band,
    cyMin: OBS.blade.cyMin,
    cyMax: OBS.blade.cyMax,
    laneMargin: OBS.blade.laneMargin,
    ampMin: OBS.blade.ampMin,
    ampSpan: OBS.blade.ampSpan,
    periodBase: OBS.blade.periodBase,
    periodJitter: OBS.blade.periodJitter
  };

  /* Pendulum: a long arm hanging from the ceiling or standing on the floor. */
  const SWING = {
    L: OBS.swing.length,
    amp: OBS.swing.amp,
    ballR: OBS.swing.ballR,
    rodR: OBS.swing.rodR,
    laneY: OBS.swing.laneY,
    anchor: OBS.swing.anchor,
    periodBase: OBS.swing.periodBase,
    periodJitter: OBS.swing.periodJitter
  };

  /* Metal tunnel: solid shell top and bottom, straight corridor between.
   * Only the entrance slab is a deadly wall — everything after it is a
   * "soft" wall that pushes the bird back into the duct. */
  const TUNNEL = {
    firstAt: OBS.tunnel.firstAt,
    firstJitter: OBS.tunnel.firstJitter,
    every: OBS.tunnel.every,
    len: OBS.tunnel.len,
    gap: OBS.tunnel.gap,
    gapMin: OBS.tunnel.gapMin,
    gapTighten: OBS.tunnel.gapTighten,
    flash: OBS.tunnel.flash
  };

  /* Twin gate: one wall with an upper and a lower opening split by a slab. */
  const TWIN = {
    gap: OBS.twin.gap,
    gapMin: OBS.twin.gapMin,
    bar: OBS.twin.bar,
    minClear: OBS.twin.minClear
  };

  /* Pinwheel: four arms spinning around a hub; pass outside the sweep circle. */
  const PINWHEEL = {
    L: OBS.pinwheel.armLength,
    rodR: OBS.pinwheel.rodR,
    hubR: OBS.pinwheel.hubR,
    cyMin: OBS.pinwheel.cyMin,
    cyMax: OBS.pinwheel.cyMax,
    drift: OBS.pinwheel.drift,
    period: OBS.pinwheel.period
  };

  /* Orbiting saw: a blade circling a ring track, safe lanes above / below. */
  const ORBITER = {
    R: OBS.orbiter.ringR,
    sawR: OBS.orbiter.sawR,
    cyMin: OBS.orbiter.cyMin,
    cyMax: OBS.orbiter.cyMax,
    period: OBS.orbiter.period,
    laneMargin: OBS.orbiter.laneMargin
  };

  /* ================= "middle is safe" trio =================
   * The mechanisms above are "one point of danger, pass on the other
   * side". These three flip it: the danger sits on the top and bottom
   * edges while the safe corridor runs down the middle. The corridor
   * centre prefers the vertical middle of the screen (MID_Y) and only
   * falls back to the nearest reachable spot when that does not fit. */
  const MID_Y = FLOOR_Y / 2;

  /* Clamp: two toothed jaws reach in from the ceiling and the ground and
   * squeeze toward the middle while the whole pair drifts up and down. */
  const CLAMPER = {
    gap: OBS.clamper.gap,
    amp: OBS.clamper.amp,
    drift: OBS.clamper.drift,
    driftPeriod: OBS.clamper.driftPeriod,
    period: OBS.clamper.period
  };

  /* Twin blade: two saws oscillate toward each other on vertical rails. */
  const TWINBLADE = {
    half: OBS.twinblade.half,
    halfAmp: OBS.twinblade.halfAmp,
    centerAmp: OBS.twinblade.centerAmp,
    sawR: OBS.twinblade.sawR,
    period: OBS.twinblade.period,
    drift: OBS.twinblade.drift
  };

  /* Twin pendulum: one long arm from the ceiling and one from the ground,
   * sweeping both edges and leaving a straight corridor in the middle. */
  const MIDSWING = {
    L: OBS.midswing.length,
    amp: OBS.midswing.amp,
    ballR: OBS.midswing.ballR,
    rodR: OBS.midswing.rodR,
    pad: OBS.midswing.pad,
    anchor: OBS.midswing.anchor,
    periodBase: OBS.midswing.periodBase,
    periodJitter: OBS.midswing.periodJitter
  };

  /* Biomes: switch once per tunnel passed, colours and difficulty together.
   * `BIOMES` is an ordered list of keys; `theme` in config.js holds colours. */
  const BIOMES = CFG.biomes;

  /* Difficulty ladder: 20 tiers. Each tier unlocks hazards and tightens every
   * gap, and the last one throws everything at you at once. The tier is
   * `biomesEntered + floor(pillarIndex / TIER_STEP)`, so a run keeps climbing
   * roughly every dozen pillars and caps out at tier 20. */
  const TIER_MAX = CFG.difficulty.maxTier;
  const TIER_STEP = CFG.difficulty.tierStep;

  /* Per-hazard unlock tier and full weight. A hazard ramps from 60% to its
   * full weight within two tiers, and plain static pillars decay exponentially
   * (they carry the early game, then almost vanish). The third biome
   * (Snowfield) already brings the first mechanisms. */
  const MIX = CFG.difficulty.mix;

  /* `PHASE[tier]` = the weighted type pool and global gap multiplier. */
  const PHASE = (function () {
    const sw = CFG.difficulty.staticWeight;
    const ramp = CFG.difficulty.weightRamp;
    const gm = CFG.difficulty.gapMul;
    const out = [];
    for (let t = 0; t < TIER_MAX; t++) {
      const types = {
        static: Math.round(Math.max(sw.floor, sw.base * Math.pow(sw.decay, t)) * 1000) / 1000
      };
      for (let k = 0; k < MIX.length; k++) {
        const name = MIX[k][0];
        const from = MIX[k][1];
        const full = MIX[k][2];
        if (t < from) continue;
        const scale = ramp.base + (1 - ramp.base) * Math.min(1, (t - from) / ramp.span);
        types[name] = Math.round(full * scale * 1000) / 1000;
      }
      out.push({
        types: types,
        gapMul: Math.max(gm.floor, Math.round((gm.start - t * gm.step) * 1000) / 1000)
      });
    }
    return out;
  })();

  const AFTER_HAZARD_MIX = CFG.difficulty.afterHazardMix;
  const WARM = CFG.difficulty.warmup;
  const SLIDER = CFG.difficulty.slider;
  const PULSE = CFG.difficulty.pulse;

  const COIN = { r: CFG.coins.radius };
  const COIN_CFG = CFG.coins;

  /* Distance conversion: 40 px = 1 m, so the starting speed is about
   * 4.2 m/s. Which mode scores what is defined in leaderboard.js. */
  const PX_PER_METER = CFG.scoring.pixelsPerMeter;

  function metersOf(distance) {
    return Math.max(0, Math.floor((distance || 0) / PX_PER_METER));
  }

  /* Human flight envelope (deliberately below the physical limit). The
   * vertical budget between two waypoints is derived from the time window
   * between two gates, so faster stretches allow a smaller drop. */
  const ENVELOPE = CFG.flight;

  /* Deterministic PRNG: same seed, same track, on every device. */
  let seedCounter = 0;

  function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /* ---------------- seed helpers ---------------- */
  function todaySeed(date) {
    const d = date ? new Date(date) : new Date();
    return (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) >>> 0;
  }

  function seedFromString(str) {
    return fnv1a(String(str || 'forest')) >>> 0;
  }

  function nextSeed() {
    seedCounter = (seedCounter + 1) % 100000;
    return ((Date.now() & 0x7fffffff) + seedCounter * 7919) >>> 0;
  }

  const PIPE_TYPES = ['static', 'slider', 'pulse', 'stagger', 'narrow', 'twin', 'tunnel', 'clamper'];

  function isPipeType(t) {
    return PIPE_TYPES.indexOf(t) >= 0;
  }

  function phaseAt(tier) {
    return PHASE[Math.min(PHASE.length - 1, Math.max(0, tier | 0))];
  }

  /* Current difficulty tier: tunnels passed plus pillar stretches.
   * (One biome is about 25 pillars, one stretch is 40, so a tier comes
   * up roughly every dozen pillars.) */
  function tierAt(biome, i) {
    return Math.min(TIER_MAX - 1, Math.max(0, (biome | 0) + Math.floor((i | 0) / TIER_STEP)));
  }

  /** Localised display name of a biome index (wraps around the list). */
  function biomeKey(index) {
    const len = BIOMES.length;
    return BIOMES[(((index | 0) % len) + len) % len];
  }

  function weighted(rand, pool) {
    let total = 0;
    for (let k = 0; k < pool.length; k++) total += pool[k][1];
    let r = rand() * total;
    for (let k = 0; k < pool.length; k++) {
      r -= pool[k][1];
      if (r <= 0) return pool[k][0];
    }
    return pool[0][0];
  }

  /* Slider amplitude: tiny at the start, growing pillar by pillar. */
  function sliderAmp(i) {
    if (i < SLIDER.ampFrom) return SLIDER.ampBase;
    return Math.min(SLIDER.ampMax, SLIDER.ampIntercept + i * SLIDER.ampSlope);
  }

  /* ---------------- course generation (pure seed) ---------------- */
  function pickType(rand, i, prevType, tier) {
    if (i < WARMUP_PILLARS) return 'static'; // warm-up: plain pillars only
    // Just after a tunnel give the player an easy one: no spike in difficulty
    // at the very moment the biome changes.
    if (prevType === 'tunnel') return rand() < 0.55 ? 'static' : 'slider';
    // After a narrow gate / pendulum / mechanism, never force another extreme
    // height on the very next gate.
    if (
      prevType === 'narrow' ||
      prevType === 'swing' ||
      prevType === 'blade' ||
      prevType === 'pinwheel' ||
      prevType === 'orbiter' ||
      prevType === 'twinblade' ||
      prevType === 'midswing'
    ) {
      return weighted(rand, AFTER_HAZARD_MIX);
    }
    const w = phaseAt(tier).types;
    const pool = [];
    for (const k in w) pool.push([k, w[k]]);
    return weighted(rand, pool);
  }

  /* One tunnel: a run of segments with walls top and bottom and a flat,
   * straight corridor. Only the entrance segment must be entered cleanly;
   * after that the walls are soft (see `step`), so brushing them is safe
   * and the duct doubles as a place to rest. */
  function pushTunnel(list, i, segs, prevCenter, rand, biome) {
    const gap = Math.max(TUNNEL.gapMin, Math.round(TUNNEL.gap - biome * TUNNEL.gapTighten));
    const cMin = PIPE.margin + gap / 2;
    const cMax = FLOOR_Y - PIPE.margin - gap / 2;
    // The whole corridor has a single height, and the entrance has to be
    // flyable, so the centre still obeys the flight envelope.
    const tau = PIPE.spacing / speedAt(i);
    const up = Math.min(PIPE.maxShift, ENVELOPE.climb * tau);
    const down = Math.min(ENVELOPE.downCap, ENVELOPE.dive * tau);
    const lo = Math.max(cMin, prevCenter - up);
    const hi = Math.min(cMax, prevCenter + down);
    let center = lo <= hi ? lo + rand() * (hi - lo) : (cMin + cMax) / 2;
    center = Math.round(Math.min(Math.max(cMin, center), cMax));
    for (let k = 0; k < segs; k++) {
      list.push({
        i: i + k,
        type: 'tunnel',
        hard: false,
        biome: biome,
        tunnelHead: k === 0,
        tunnelExit: k === segs - 1,
        seg: k,
        segs: segs,
        gap: gap,
        gapY: Math.round(center - gap / 2),
        amp: 0,
        period: 1,
        phase: 0,
        worldX: (i + k + 1) * PIPE.spacing
      });
    }
    return center;
  }

  /**
   * Lay `count` segments of the track. Only the random stream and `seed`
   * decide the content, which is what makes the endless extension safe:
   * a longer `count` never changes the earlier segments.
   */
  function buildCourse(seed, count) {
    const rand = rng(seed >>> 0);
    const list = [];
    let prevCenter = WORLD.h * START_Y_RATIO; // waypoint chain, same as the spawn
    let biome = 0; // tunnels passed = current biome index
    let nextTunnel = TUNNEL.firstAt + Math.round(rand() * TUNNEL.firstJitter);
    let pendingRange = null; // set when the previous gate was a twin gate
    for (let i = 0; i < count; i++) {
      /* ---- Insert a tunnel when due; passing it changes biome and tier ---- */
      if (i >= nextTunnel) {
        const span = TUNNEL.len[1] - TUNNEL.len[0] + 1;
        const segs = TUNNEL.len[0] + Math.floor(rand() * span);
        prevCenter = pushTunnel(list, i, segs, prevCenter, rand, biome);
        nextTunnel = i + segs + TUNNEL.every;
        biome++;
        i += segs - 1; // the tunnel occupies these segments
        continue;
      }

      const tier = tierAt(biome, i);
      let type = pickType(rand, i, list.length ? list[list.length - 1].type : '', tier);
      const worldX = (i + 1) * PIPE.spacing;
      const ph = phaseAt(tier);
      const range = pendingRange; // after a twin gate the centre must stay inside
      pendingRange = null;

      // Time between two gates => allowed vertical travel (asymmetric).
      const tau = PIPE.spacing / speedAt(i);
      const up = Math.min(PIPE.maxShift, ENVELOPE.climb * tau);
      const down = Math.min(ENVELOPE.downCap, ENVELOPE.dive * tau);
      // If the previous gate was a slider, the bird really leaves at
      // +/- amp around its base height, so count that in too.
      const prevMotion = i > 0 && list[i - 1].type === 'slider' ? list[i - 1].amp : 0;
      const reachable = (y) => y >= prevCenter - prevMotion - up - 0.5 && y <= prevCenter + prevMotion + down + 0.5;
      // A twin gate has two exits, so the next centre must reach both.
      const inRange = (y) => !range || (y >= range.lo - 0.5 && y <= range.hi + 0.5);

      /* ---- Mechanism: track saw. Pick a safe lane inside the envelope,
       * falling back to a plain gate when nothing fits. ---- */
      if (type === 'blade') {
        const cy = Math.round(BLADE.cyMin + rand() * (BLADE.cyMax - BLADE.cyMin));
        // Just unlocked: keep the travel short for the first couple of tiers.
        const warm = tier <= WARM.tinyTier ? WARM.tinyScale : tier === WARM.smallTier ? WARM.smallScale : 1;
        const amp = Math.round(BLADE.band * (BLADE.ampMin + rand() * BLADE.ampSpan) * warm);
        const topY = Math.round((cy - amp - BLADE.r) / 2);
        const botY = Math.round((cy + amp + BLADE.r + FLOOR_Y) / 2);
        // A safe lane must clear the edges and stay reachable, or the
        // generator rejects the hazard outright.
        const canTop = topY >= BLADE.laneMargin && reachable(topY) && inRange(topY);
        const canBot = botY <= FLOOR_Y - BLADE.laneMargin && reachable(botY) && inRange(botY);
        if (canTop || canBot) {
          const lane = canTop && canBot ? (rand() < 0.5 ? 0 : 1) : canTop ? 0 : 1;
          list.push({
            i: i,
            type: 'blade',
            hard: false,
            biome: biome,
            cy: cy,
            amp: amp,
            lane: lane,
            laneY: lane === 0 ? topY : botY,
            period: Math.round((BLADE.periodBase + rand() * BLADE.periodJitter) * 100) / 100,
            phase: Math.round(rand() * 628) / 100,
            worldX: worldX
          });
          prevCenter = lane === 0 ? topY : botY;
          continue;
        }
      }

      /* ---- Mechanism: pinwheel (four-armed cross) ----
       * The wheel cannot sit where the bird already flies, and it must not be
       * so far that the player cannot move in time. So it is placed the other
       * way round: keep the waypoint, and put the hub `need` pixels above or
       * below it, where need = arm + rod + bird radius + wiggle room. Whichever
       * side has room is used, which turns the challenge from "a big last-minute
       * move" into "thread the lane just outside the sweep". When the hazard has
       * just unlocked, the arms are shorter and the clearance is wider. */
      if (type === 'pinwheel') {
        const warm = tier <= WARM.tinyTier ? WARM.pinwheelTinyScale : tier === WARM.smallTier ? WARM.smallScale : 1;
        const L = Math.round(PINWHEEL.L * warm);
        const clear = PINWHEEL.drift + (PINWHEEL.L - L); // shorter arms => more clearance
        const need = L + PINWHEEL.rodR + BIRD.r + clear;
        const belowLo = prevCenter + need;
        const belowHi = PINWHEEL.cyMax;
        const aboveLo = PINWHEEL.cyMin;
        const aboveHi = prevCenter - need;
        const belowOK = belowLo <= belowHi;
        const aboveOK = aboveLo <= aboveHi;
        let cy = -1;
        if (belowOK && aboveOK) {
          cy = rand() < 0.5 ? belowLo + rand() * (belowHi - belowLo) : aboveLo + rand() * (aboveHi - aboveLo);
        } else if (belowOK) {
          cy = belowLo + rand() * (belowHi - belowLo);
        } else if (aboveOK) {
          cy = aboveLo + rand() * (aboveHi - aboveLo);
        }
        if (cy >= 0) {
          cy = Math.round(cy);
          const laneY = Math.round(
            Math.min(Math.max(prevCenter, PIPE.margin + BIRD.r + 6), FLOOR_Y - PIPE.margin - BIRD.r - 6)
          );
          if (inRange(laneY) && reachable(laneY)) {
            list.push({
              i: i,
              type: 'pinwheel',
              hard: false,
              biome: biome,
              cy: cy,
              L: L,
              lane: laneY < cy ? 0 : 1,
              laneY: laneY,
              dir: rand() < 0.5 ? 1 : -1,
              period: Math.round((PINWHEEL.period[0] + rand() * (PINWHEEL.period[1] - PINWHEEL.period[0])) * 100) / 100,
              phase: Math.round(rand() * 628) / 100,
              worldX: worldX
            });
            prevCenter = laneY;
            continue;
          }
        }
        // No room: fall through and let the gate logic handle it.
      }

      /* ---- Mechanism: orbiting saw (blade on a ring track) ---- */
      if (type === 'orbiter') {
        const cy = Math.round(ORBITER.cyMin + rand() * (ORBITER.cyMax - ORBITER.cyMin));
        const sweep = ORBITER.R + ORBITER.sawR;
        const topY = Math.round((cy - sweep) / 2);
        const botY = Math.round((cy + sweep + FLOOR_Y) / 2);
        const canTop = topY >= ORBITER.laneMargin && reachable(topY) && inRange(topY);
        const canBot = botY <= FLOOR_Y - ORBITER.laneMargin && reachable(botY) && inRange(botY);
        if (canTop || canBot) {
          const lane = canTop && canBot ? (rand() < 0.5 ? 0 : 1) : canTop ? 0 : 1;
          list.push({
            i: i,
            type: 'orbiter',
            hard: false,
            biome: biome,
            cy: cy,
            lane: lane,
            laneY: lane === 0 ? topY : botY,
            dir: rand() < 0.5 ? 1 : -1,
            period: Math.round((ORBITER.period[0] + rand() * (ORBITER.period[1] - ORBITER.period[0])) * 100) / 100,
            phase: Math.round(rand() * 628) / 100,
            worldX: worldX
          });
          prevCenter = lane === 0 ? topY : botY;
          continue;
        }
      }

      /* ---- Mechanism: pendulum ---- */
      if (type === 'swing') {
        const topY = SWING.laneY; // a floor-hung swing => fly the high lane
        const lowY = FLOOR_Y - SWING.laneY; // a ceiling-hung swing => fly the low lane
        const canTop = reachable(topY) && inRange(topY);
        const canLow = reachable(lowY) && inRange(lowY);
        if (canTop || canLow) {
          const from = canTop && canLow ? (rand() < 0.5 ? 'bottom' : 'top') : canTop ? 'bottom' : 'top';
          list.push({
            i: i,
            type: 'swing',
            hard: false,
            from: from,
            biome: biome,
            amp: SWING.amp,
            laneY: from === 'bottom' ? topY : lowY,
            period: Math.round((SWING.periodBase + rand() * SWING.periodJitter) * 100) / 100,
            phase: Math.round(rand() * 628) / 100,
            worldX: worldX
          });
          prevCenter = from === 'bottom' ? topY : lowY;
          continue;
        }
      }

      /* ---- Twin gate: one wall, two openings, either one works ---- */
      if (type === 'twin') {
        const g1 = Math.max(TWIN.gapMin, Math.round(TWIN.gap * ph.gapMul));
        const spread = g1 + TWIN.bar; // upper opening centre -> lower one
        const loT = Math.max(
          PIPE.margin + TWIN.minClear + g1 / 2, // upper opening off the ceiling
          prevCenter - prevMotion - up, // ...and reachable
          range ? range.lo : -1e9
        );
        const hiT = Math.min(
          FLOOR_Y - PIPE.margin - TWIN.minClear - g1 / 2 - spread, // lower opening off the floor
          prevCenter + prevMotion + down - spread, // ...and reachable too
          range ? range.hi - spread : 1e9
        );
        if (loT <= hiT) {
          const c1 = Math.round(loT + rand() * (hiT - loT));
          const c2 = c1 + spread;
          list.push({
            i: i,
            type: 'twin',
            hard: false,
            biome: biome,
            gap: g1,
            gapY: Math.round(c1 - g1 / 2), // upper opening (coin / waypoint reference)
            gap2: g1,
            gap2Y: Math.round(c2 - g1 / 2), // lower opening
            bar: TWIN.bar,
            amp: 0,
            period: 1,
            phase: 0,
            worldX: worldX
          });
          prevCenter = Math.round((c1 + c2) / 2); // continue from between the two
          // The next centre must reach both openings.
          pendingRange = { lo: c2 - up, hi: c1 + down };
          continue;
        }
        // No room: fall through to a plain gate.
      }

      /* ---- Clamp (middle is safe): drifting pair of jaws ---- */
      if (type === 'clamper') {
        const gap0 = Math.round(CLAMPER.gap * ph.gapMul);
        // The corridor drifts by +/-drift and the jaws eat amp/2, so both are
        // deducted from the placement budget up front.
        const cMin0 = PIPE.margin + gap0 / 2 + CLAMPER.amp / 2 + CLAMPER.drift;
        const cMax0 = FLOOR_Y - PIPE.margin - gap0 / 2 - CLAMPER.amp / 2 - CLAMPER.drift;
        const budget = CLAMPER.amp / 2 + CLAMPER.drift;
        const lo = Math.max(cMin0, prevCenter - prevMotion - Math.max(24, up - budget), range ? range.lo : -1e9);
        const hi = Math.min(cMax0, prevCenter + prevMotion + Math.max(24, down - budget), range ? range.hi : 1e9);
        if (lo <= hi) {
          // Prefer the middle of the screen, else the closest reachable spot.
          const laneY = Math.round(Math.min(Math.max(MID_Y, lo), hi));
          list.push({
            i: i,
            type: 'clamper',
            hard: false,
            biome: biome,
            center: laneY,
            laneY: laneY,
            gap: gap0,
            gapY: Math.round(laneY - gap0 / 2),
            amp: CLAMPER.amp,
            drift: CLAMPER.drift,
            period: Math.round((CLAMPER.period[0] + rand() * (CLAMPER.period[1] - CLAMPER.period[0])) * 100) / 100,
            driftPeriod:
              Math.round((CLAMPER.driftPeriod[0] + rand() * (CLAMPER.driftPeriod[1] - CLAMPER.driftPeriod[0])) * 100) /
              100,
            phase: Math.round(rand() * 628) / 100,
            driftPhase: Math.round(rand() * 628) / 100,
            worldX: worldX
          });
          prevCenter = laneY;
          continue;
        }
        type = 'static'; // no room, fall back to a plain gate
      }

      /* ---- Twin blade (middle is safe): two saws closing in ---- */
      if (type === 'twinblade') {
        const half0 = TWINBLADE.half;
        // Keep both saws on screen: the centre cannot hug the edges.
        const onScreen = half0 + TWINBLADE.halfAmp + TWINBLADE.sawR + 10;
        const lo = Math.max(
          onScreen,
          prevCenter - prevMotion - Math.max(20, up - TWINBLADE.centerAmp),
          range ? range.lo : -1e9
        );
        const hi = Math.min(
          FLOOR_Y - onScreen,
          prevCenter + prevMotion + Math.max(20, down - TWINBLADE.centerAmp),
          range ? range.hi : 1e9
        );
        if (lo <= hi) {
          const laneY = Math.round(Math.min(Math.max(MID_Y, lo), hi));
          const period =
            Math.round((TWINBLADE.period[0] + rand() * (TWINBLADE.period[1] - TWINBLADE.period[0])) * 100) / 100;
          list.push({
            i: i,
            type: 'twinblade',
            hard: false,
            biome: biome,
            cy: laneY,
            laneY: laneY,
            half: half0,
            halfAmp: TWINBLADE.halfAmp,
            centerAmp: TWINBLADE.centerAmp,
            period: period,
            phase: Math.round(rand() * 628) / 100,
            phase2: Math.round(rand() * 628) / 100,
            worldX: worldX
          });
          prevCenter = laneY;
          continue;
        }
        type = 'static';
      }

      /* ---- Twin pendulum (middle is safe): straight middle corridor ---- */
      if (type === 'midswing') {
        // The corridor edges follow the innermost edge of the heavy balls,
        // so no swing phase can ever intrude into the corridor.
        const near = MIDSWING.anchor + MIDSWING.L + MIDSWING.ballR + MIDSWING.pad;
        const gapY0 = Math.round(near);
        const gap0 = Math.round(FLOOR_Y - near) - gapY0;
        const laneY = Math.round(gapY0 + gap0 / 2);
        if (gap0 >= PIPE.gapMin && reachable(laneY) && inRange(laneY)) {
          list.push({
            i: i,
            type: 'midswing',
            hard: false,
            biome: biome,
            gapY: gapY0,
            gap: gap0,
            laneY: laneY,
            amp: MIDSWING.amp,
            period: Math.round((MIDSWING.periodBase + rand() * MIDSWING.periodJitter) * 100) / 100,
            phase: Math.round(rand() * 628) / 100,
            phase2: Math.round(rand() * 628) / 100,
            worldX: worldX
          });
          prevCenter = laneY;
          continue;
        }
        type = 'static';
      }

      /* ---- Plain gate (also the fallback for every rejected hazard) ---- */
      let gap = Math.max(PIPE.gapMin, PIPE.gapStart - PIPE.gapShrink * i);
      if (type === 'narrow') gap = Math.max(PIPE.hardMin, Math.round(gap * PIPE.hardFactor));
      gap = Math.max(PIPE.hardMin, Math.round(gap * ph.gapMul)); // deeper biome => tighter

      const cMin = PIPE.margin + gap / 2;
      const cMax = FLOOR_Y - PIPE.margin - gap / 2;
      // A slider sways +/-amp around its centre, so deduct that first.
      const motion = type === 'slider' ? sliderAmp(i) : 0;
      const lo = Math.max(cMin, prevCenter - prevMotion - Math.max(20, up - motion), range ? range.lo : -1e9);
      const hi = Math.min(cMax, prevCenter + prevMotion + Math.max(20, down - motion), range ? range.hi : 1e9);
      let center;
      if (type === 'stagger') {
        // Gap pinned to the ceiling or the floor; if that is out of reach,
        // fall back to the ordinary band.
        const topLo = lo;
        const topHi = Math.min(hi, cMin + 24);
        const botLo = Math.max(lo, cMax - 24);
        const botHi = hi;
        const wantTop = rand() < 0.5;
        if (wantTop && topLo <= topHi) center = topLo + rand() * (topHi - topLo);
        else if (!wantTop && botLo <= botHi) center = botLo + rand() * (botHi - botLo);
        else center = lo + rand() * Math.max(0, hi - lo);
      } else {
        center = lo + rand() * Math.max(0, hi - lo);
      }
      center = Math.min(Math.max(cMin, center), cMax);
      const gapY = Math.round(center - gap / 2);

      let amp = 0;
      if (type === 'slider') amp = sliderAmp(i);
      else if (type === 'pulse') amp = Math.min(PULSE.ampMax, PULSE.ampBase + i * PULSE.ampSlope);

      list.push({
        i: i,
        biome: biome,
        // Rejected hazards and twin gates that did not fit become plain gates.
        type:
          type === 'blade' ||
          type === 'swing' ||
          type === 'pinwheel' ||
          type === 'orbiter' ||
          type === 'twin' ||
          type === 'clamper' ||
          type === 'twinblade' ||
          type === 'midswing'
            ? 'static'
            : type,
        hard: type === 'narrow' || type === 'stagger',
        gap: gap,
        gapY: gapY,
        amp: Math.round(amp * 10) / 10,
        // A slider's period follows its amplitude: the wider it swings, the
        // slower it moves, keeping the peak speed inside the climb budget.
        period:
          Math.round(
            (type === 'slider'
              ? SLIDER.periodBase + amp * SLIDER.periodPerAmp + rand() * SLIDER.periodJitter
              : PIPE_PERIOD.base + rand() * PIPE_PERIOD.jitter) * 100
          ) / 100,
        phase: Math.round(rand() * 628) / 100,
        worldX: worldX
      });
      prevCenter = center;
    }
    return list;
  }

  /* ---------------- coin generation (always reachable) ----------------
   * Coins always sit on the line the bird was going to fly anyway, but they
   * are sparse and varied:
   *  - gates: about four out of five hold 1-2 coins slanting through the gap
   *    (they move with the gate when it is a slider);
   *  - tunnels: only a little at the entrance and the exit, the middle stays
   *    clear because that is the rest area;
   *  - mechanism gates: 1-2 coins along the lane the hazard never touches;
   *  - roughly half of the neighbouring gate pairs get a curve between them,
   *    one of six shapes: straight / arch / dip / wave / spike / zigzag.
   * A curve never bends more than `trailMaxOffset` px away from the lane, and
   * there is nothing in between, so it is always flyable.
   */
  function buildCoins(course, seed) {
    const coins = [];
    let id = 0;
    const rand = rng(((seed >>> 0) ^ 0x5bf03635) >>> 0);
    const push = (worldX, gi, oy, fixedY) => {
      coins.push({
        id: id++,
        gi: gi,
        oy: Math.round(oy * 10) / 10,
        worldX: worldX,
        y: fixedY == null ? 0 : fixedY,
        got: false
      });
    };
    const pushAt = (worldX, y) => push(worldX, -1, 0, Math.round(y));

    /** Safe centre line of a gate (a mechanism uses its safe lane). */
    function laneY(ob) {
      if (ob.laneY != null) return ob.laneY;
      if (ob.type === 'blade') {
        return ob.lane === 0
          ? Math.round((ob.cy - ob.amp - BLADE.r) / 2)
          : Math.round((ob.cy + ob.amp + BLADE.r + FLOOR_Y) / 2);
      }
      if (ob.type === 'swing') return ob.from === 'top' ? FLOOR_Y - SWING.laneY : SWING.laneY;
      return ob.gapY + ob.gap / 2;
    }

    // Inside a tunnel the walls run on into the next segment, so there is no
    // open space between segments and no trail coin may be placed there.
    const isTunnelBody = (ob) => ob.type === 'tunnel' && !ob.tunnelExit;

    /** A curve of coins between two waypoints. */
    function spanCoins(x0, y0, x1, y1) {
      const kind = Math.floor(rand() * COIN_CFG.trailShapes);
      const n = kind === 0 ? 3 : 4;
      const half = COIN_CFG.trailMaxOffset / 2;
      const bulge = (half + rand() * half) * (rand() < 0.5 ? 1 : -1);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const x = x0 + (x1 - x0) * u;
        const base = y0 + (y1 - y0) * u;
        let off = 0;
        if (kind === 1)
          off = -Math.abs(bulge) * Math.sin(Math.PI * u); // arch
        else if (kind === 2)
          off = Math.abs(bulge) * Math.sin(Math.PI * u); // dip
        else if (kind === 3)
          off = bulge * Math.sin(u * Math.PI * 2) * 0.8; // wave
        else if (kind === 4)
          off = -Math.abs(bulge) * (1 - Math.abs(u - 0.5) * 2); // spike
        else if (kind === 5) off = (k % 2 ? 1 : -1) * Math.abs(bulge) * 0.7; // zigzag
        pushAt(x, base + off);
      }
    }

    for (let i = 0; i < course.length; i++) {
      const ob = course[i];

      if (isPipeType(ob.type)) {
        // Inside the gap: 1-2 coins in a slanted column. The middle of a
        // tunnel stays empty (that is the rest area) and about one gate in
        // five holds nothing at all.
        const tunnelMid = ob.type === 'tunnel' && !ob.tunnelHead && !ob.tunnelExit;
        if (!tunnelMid && rand() >= COIN_CFG.gateEmptyChance) {
          const room = Math.max(22, (ob.gap - 26) / 2 - COIN.r - 6);
          const n = 1 + Math.floor(rand() * COIN_CFG.maxPerGate);
          const sp = Math.min(26, (room * 2) / Math.max(1, n - 1));
          const gx = ob.worldX + PIPE.w / 2;
          for (let k = 0; k < n; k++) {
            const t = k - (n - 1) / 2;
            push(gx + t * 6, i, t * sp, null);
          }
        }
      } else if (
        ob.type === 'blade' ||
        ob.type === 'swing' ||
        ob.type === 'pinwheel' ||
        ob.type === 'orbiter' ||
        ob.type === 'twinblade' ||
        ob.type === 'midswing'
      ) {
        // Mechanism gate: 1-2 coins along the safe lane (for the
        // "middle is safe" family that means the central corridor).
        const cy = laneY(ob);
        const n = 1 + Math.floor(rand() * COIN_CFG.maxPerGate);
        for (let k = 0; k < n; k++) {
          const t = k - (n - 1) / 2;
          pushAt(ob.worldX + t * 26, cy + Math.sin(t * 1.1) * 10);
        }
      }

      // Trail coins between two gates (only when neither wall runs on into
      // the next segment) and only for part of the pairs.
      const next = course[i + 1];
      if (
        next &&
        isPipeType(ob.type) &&
        isPipeType(next.type) &&
        !isTunnelBody(ob) &&
        !isTunnelBody(next) &&
        rand() < COIN_CFG.trailChance
      ) {
        spanCoins(ob.worldX + PIPE.w + 26, laneY(ob), next.worldX - 26, laneY(next));
      }
    }

    coins.sort((a, b) => a.worldX - b.worldX || a.id - b.id);
    return coins;
  }

  function speedAt(passed) {
    return Math.min(PIPE.speedMax, PIPE.speedStart + PIPE.speedGain * passed);
  }

  /** Shape and collision bodies of one gate at a given time. */
  function obstacleShape(ob, distance, time) {
    const x = ob.worldX - distance;

    if (ob.type === 'blade') {
      const cy = ob.cy + ob.amp * Math.sin((2 * Math.PI * time) / ob.period + ob.phase);
      return {
        i: ob.i,
        type: ob.type,
        hard: false,
        x: x,
        cy: cy,
        shapes: [{ k: 'circle', cx: x, cy: cy, r: BLADE.r }]
      };
    }

    if (ob.type === 'swing') {
      const px = x;
      const py = ob.from === 'top' ? SWING.anchor : FLOOR_Y - SWING.anchor;
      const a = ob.amp * Math.sin((2 * Math.PI * time) / ob.period + ob.phase);
      const dir = ob.from === 'top' ? 1 : -1;
      const bx = px + SWING.L * Math.sin(a);
      const by = py + dir * SWING.L * Math.cos(a);
      return {
        i: ob.i,
        type: ob.type,
        hard: false,
        x: x,
        px: px,
        py: py,
        bx: bx,
        by: by,
        angle: a,
        shapes: [
          { k: 'seg', x1: px, y1: py, x2: bx, y2: by, r: SWING.rodR },
          { k: 'circle', cx: bx, cy: by, r: SWING.ballR }
        ]
      };
    }

    if (ob.type === 'pinwheel') {
      const px = x;
      const py = ob.cy;
      const L = ob.L || PINWHEEL.L;
      const a = (ob.dir || 1) * ((2 * Math.PI * time) / ob.period + ob.phase);
      const dx = L * Math.cos(a);
      const dy = L * Math.sin(a);
      // Four arms: the bodies must match all four drawn rods one to one,
      // otherwise "looks like a hit, is not a hit" happens.
      return {
        i: ob.i,
        type: ob.type,
        hard: false,
        x: x,
        px: px,
        py: py,
        R: L,
        angle: a,
        ex: px + dx,
        ey: py + dy,
        shapes: [
          { k: 'seg', x1: px, y1: py, x2: px + dx, y2: py + dy, r: PINWHEEL.rodR },
          { k: 'seg', x1: px, y1: py, x2: px - dx, y2: py - dy, r: PINWHEEL.rodR },
          { k: 'seg', x1: px, y1: py, x2: px - dy, y2: py + dx, r: PINWHEEL.rodR },
          { k: 'seg', x1: px, y1: py, x2: px + dy, y2: py - dx, r: PINWHEEL.rodR },
          { k: 'circle', cx: px, cy: py, r: PINWHEEL.hubR }
        ]
      };
    }

    if (ob.type === 'orbiter') {
      const a = (ob.dir || 1) * ((2 * Math.PI * time) / ob.period + ob.phase);
      const cx = x + ORBITER.R * Math.cos(a);
      const cy = ob.cy + ORBITER.R * Math.sin(a);
      return {
        i: ob.i,
        type: ob.type,
        hard: false,
        x: x,
        px: x,
        py: ob.cy,
        cx: cx,
        cy: cy,
        shapes: [{ k: 'circle', cx: cx, cy: cy, r: ORBITER.sawR }]
      };
    }

    /* Twin blade (middle is safe): two saws on vertical rails, corridor between. */
    if (ob.type === 'twinblade') {
      const w0 = (2 * Math.PI * time) / ob.period;
      const c = ob.cy + ob.centerAmp * Math.sin(w0 + ob.phase);
      const half = ob.half + ob.halfAmp * Math.sin(w0 + ob.phase2);
      const topY = c - half - TWINBLADE.sawR;
      const botY = c + half + TWINBLADE.sawR;
      return {
        i: ob.i,
        type: ob.type,
        hard: false,
        x: x,
        cy: c,
        topY: topY,
        botY: botY,
        half: half,
        spin: time,
        gapY: c - half,
        gap: half * 2,
        shapes: [
          { k: 'circle', cx: x, cy: topY, r: TWINBLADE.sawR },
          { k: 'circle', cx: x, cy: botY, r: TWINBLADE.sawR }
        ]
      };
    }

    /* Twin pendulum (middle is safe): one arm from each edge, straight corridor. */
    if (ob.type === 'midswing') {
      const px = x;
      const pt = MIDSWING.anchor;
      const pb = FLOOR_Y - MIDSWING.anchor;
      const a1 = ob.amp * Math.sin((2 * Math.PI * time) / ob.period + ob.phase);
      const a2 = ob.amp * Math.sin((2 * Math.PI * time) / ob.period + ob.phase2);
      const b1x = px + MIDSWING.L * Math.sin(a1);
      const b1y = pt + MIDSWING.L * Math.cos(a1);
      const b2x = px + MIDSWING.L * Math.sin(a2);
      const b2y = pb - MIDSWING.L * Math.cos(a2);
      return {
        i: ob.i,
        type: ob.type,
        hard: false,
        x: x,
        w: PIPE.w,
        gapY: ob.gapY,
        gap: ob.gap,
        lowerTop: ob.gapY + ob.gap,
        pt: pt,
        pb: pb,
        b1x: b1x,
        b1y: b1y,
        a1: a1,
        b2x: b2x,
        b2y: b2y,
        a2: a2,
        shapes: [
          { k: 'seg', x1: px, y1: pt, x2: b1x, y2: b1y, r: MIDSWING.rodR },
          { k: 'circle', cx: b1x, cy: b1y, r: MIDSWING.ballR },
          { k: 'seg', x1: px, y1: pb, x2: b2x, y2: b2y, r: MIDSWING.rodR },
          { k: 'circle', cx: b2x, cy: b2y, r: MIDSWING.ballR }
        ]
      };
    }

    /* Twin gate: upper opening / middle slab / lower opening, three solid walls. */
    if (ob.type === 'twin') {
      const y1 = ob.gapY;
      const y2 = ob.gap2Y;
      return {
        i: ob.i,
        type: ob.type,
        hard: ob.hard,
        x: x,
        w: PIPE.w,
        gapY: y1,
        gap: ob.gap,
        lowerTop: y1 + ob.gap,
        gap2Y: y2,
        gap2: ob.gap2,
        shapes: [
          { k: 'rect', x: x, y: 0, w: PIPE.w, h: y1 },
          { k: 'rect', x: x, y: y1 + ob.gap, w: PIPE.w, h: Math.max(0, y2 - (y1 + ob.gap)) },
          { k: 'rect', x: x, y: y2 + ob.gap2, w: PIPE.w, h: FLOOR_Y - (y2 + ob.gap2) }
        ]
      };
    }

    // Plain gate / tunnel
    let gapY = ob.gapY;
    let gap = ob.gap;
    if (ob.type === 'slider') {
      gapY += ob.amp * Math.sin((2 * Math.PI * time) / ob.period + ob.phase);
    } else if (ob.type === 'pulse') {
      gap = Math.max(PIPE.hardMin, gap + ob.amp * Math.sin((2 * Math.PI * time) / ob.period + ob.phase));
    } else if (ob.type === 'clamper') {
      // Clamp: the whole pair drifts up and down while the jaws close in.
      // Corridor centre = center + drift * sin(slow period); the clear height
      // breathes between (gap - amp) and gap.
      const dr = ob.drift * Math.sin((2 * Math.PI * time) / ob.driftPeriod + ob.driftPhase);
      gap = Math.max(
        PIPE.hardMin,
        ob.gap - ob.amp * (0.5 + 0.5 * Math.sin((2 * Math.PI * time) / ob.period + ob.phase))
      );
      gapY = ob.center + dr - gap / 2;
    }
    const minY = PIPE.margin;
    const maxY = FLOOR_Y - gap - PIPE.margin;
    gapY = Math.min(Math.max(gapY, minY), Math.max(minY, maxY));
    // Inside a tunnel the shell runs on into the next segment so the duct is
    // continuous; the last segment leaves the exit open.
    const w = ob.type === 'tunnel' && !ob.tunnelExit ? PIPE.spacing : PIPE.w;
    // Only the entrance slab is a hard wall (one gate thickness). From the
    // entrance all the way to the exit the shell is soft: middle and exit
    // segments record hardW = 0 (no deadly body) while the soft wall spans the
    // full segment, so after the entrance there is a continuous soft corridor.
    const hardW = ob.type === 'tunnel' ? (ob.tunnelHead ? PIPE.w : 0) : w;
    return {
      i: ob.i,
      type: ob.type,
      hard: ob.hard,
      x: x,
      w: w,
      hardW: hardW,
      gapY: gapY,
      gap: gap,
      lowerTop: gapY + gap,
      shapes: [
        { k: 'rect', x: x, y: 0, w: hardW, h: gapY },
        { k: 'rect', x: x, y: gapY + gap, w: hardW, h: FLOOR_Y - (gapY + gap) }
      ]
    };
  }

  /** Current position of a coin (coins on a slider gate move with it). */
  function coinPos(coin, course, distance, time) {
    const x = coin.worldX - distance;
    if (coin.gi < 0) return { x: x, y: coin.y };
    const gate = course[coin.gi];
    let center = gate.gapY + gate.gap / 2;
    if (gate.type === 'slider') {
      center += gate.amp * Math.sin((2 * Math.PI * time) / gate.period + gate.phase);
    } else if (gate.type === 'clamper') {
      // The clamp corridor drifts, and the coins inside drift with it
      // (which is also a handy hint of where to go).
      center += gate.drift * Math.sin((2 * Math.PI * time) / gate.driftPeriod + gate.driftPhase);
    }
    return { x: x, y: center + coin.oy };
  }

  /* ---------------- run state ---------------- */
  function createRun(opt) {
    opt = opt || {};
    const seed = opt.seed >>> 0 || todaySeed();
    const course = buildCourse(seed, COURSE_CHUNK);
    return {
      seed: seed,
      course: course,
      coins: buildCoins(course, seed),
      t: 0,
      time: 0,
      distance: 0,
      y: WORLD.h * START_Y_RATIO,
      vy: 0,
      coinsGot: 0, // coin mode scores this (distance mode scores metersOf(distance))
      coinTick: 0,
      passed: 0, // gates passed (only used to ramp the speed up)
      biome: 0, // current biome index = tunnels passed
      tunnelFlash: 0, // seconds left on the "new biome" banner
      god: !!opt.god, // local testing: fly straight through everything
      dead: false,
      deadReason: '',
      deadTick: -1,
      pending: [],
      lastFlapTick: -999,
      nextGate: 0,
      events: [], // for the renderer: {type:'coin', x, y, t}
      recent: []
    };
  }

  /* Endless track: lay another chunk ahead. Both `buildCourse` and
   * `buildCoins` are deterministic prefixes — the requested length only
   * decides how far the track is laid, the earlier content is identical —
   * so the course can simply be swapped for a longer one. Already collected
   * coins are restored by id. */
  function extendRun(s) {
    const course = buildCourse(s.seed, s.course.length + COURSE_STEP);
    const coins = buildCoins(course, s.seed);
    const got = {};
    for (let i = 0; i < s.coins.length; i++) if (s.coins[i].got) got[s.coins[i].id] = 1;
    for (let i = 0; i < coins.length; i++) if (got[coins[i].id]) coins[i].got = true;
    s.course = course;
    s.coins = coins;
  }

  function queueFlap(s) {
    if (s.dead) return false;
    if (s.pending.length && s.pending[s.pending.length - 1] === s.t) return false;
    s.pending.push(s.t);
    return true;
  }

  /** Every death goes through here: god mode swallows it but still keeps the
   * bird on screen (it is clamped, just never killed). */
  function die(s, reason) {
    if (s.god) return;
    s.dead = true;
    s.deadReason = reason;
    s.deadTick = s.t;
  }

  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    if (rw <= 0 || rh <= 0) return false;
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function circleHitsCircle(cx, cy, r, ox, oy, or2) {
    const dx = cx - ox;
    const dy = cy - oy;
    const rr = r + or2;
    return dx * dx + dy * dy < rr * rr;
  }

  function circleHitsSeg(cx, cy, r, a) {
    const vx = a.x2 - a.x1;
    const vy = a.y2 - a.y1;
    const wx = cx - a.x1;
    const wy = cy - a.y1;
    const len2 = vx * vx + vy * vy || 1;
    let u = (wx * vx + wy * vy) / len2;
    u = Math.max(0, Math.min(1, u));
    const px = a.x1 + u * vx;
    const py = a.y1 + u * vy;
    const dx = cx - px;
    const dy = cy - py;
    const rr = r + a.r;
    return dx * dx + dy * dy < rr * rr;
  }

  function hitsShape(bx, by, br, sh) {
    if (sh.k === 'rect') return circleHitsRect(bx, by, br, sh.x, sh.y, sh.w, sh.h);
    if (sh.k === 'circle') return circleHitsCircle(bx, by, br, sh.cx, sh.cy, sh.r);
    if (sh.k === 'seg') return circleHitsSeg(bx, by, br, sh);
    return false;
  }

  /** Advance the simulation by exactly one tick. */
  function step(s) {
    if (s.dead) return s;

    // 1) Consume this tick's input (flaps).
    let flapped = false;
    while (s.pending.length && s.pending[0] === s.t) {
      s.pending.shift();
      flapped = true;
    }
    if (flapped) {
      s.vy = BIRD.flap;
      s.lastFlapTick = s.t;
    }

    // 2) Physics.
    const speed = speedAt(s.passed);
    s.distance += speed * DT;
    s.vy = Math.min(s.vy + BIRD.gravity * DT, BIRD.maxFall);
    s.y += s.vy * DT;
    s.time = s.t * DT;

    // 3) Ground / ceiling.
    if (s.y + BIRD.r >= FLOOR_Y) {
      s.y = FLOOR_Y - BIRD.r;
      die(s, 'floor');
      return s;
    }
    if (s.y - BIRD.r <= 0) {
      s.y = BIRD.r;
      die(s, 'ceiling');
      return s;
    }

    // 4) Collisions (only the gates nearby).
    // Tunnel shells are 300 px wide, so look two gates further back.
    const from = Math.floor((s.distance + BIRD.x - BIRD.r - PIPE.spacing * 2) / PIPE.spacing);
    // A pendulum ball can swing out L*sin(amp) ~ 232 px, so cover one extra
    // gate on both sides of the window.
    const to = Math.floor((s.distance + BIRD.x + BIRD.r + SWING.L) / PIPE.spacing);

    // 4a) Inside a tunnel the shell is soft: touching it does not kill, it
    //     just pushes the bird back into the duct (a short rest). Only the
    //     entrance slab (hardW) is a real wall and must be entered cleanly.
    for (let i = Math.max(0, from); i <= to && i < s.course.length; i++) {
      const ob = s.course[i];
      if (ob.type !== 'tunnel') continue;
      const sh = obstacleShape(ob, s.distance, s.time);
      // The soft wall starts after the entrance slab and runs to the segment end.
      const sx0 = sh.x + sh.hardW;
      const sx1 = sh.x + sh.w;
      if (sx0 > BIRD.x + BIRD.r) continue;
      if (sx1 < BIRD.x - BIRD.r) continue;
      const top = sh.gapY;
      const bot = sh.gapY + sh.gap;
      if (s.y - BIRD.r < top) {
        s.y = top + BIRD.r;
        if (s.vy < 0) s.vy = 0;
      } else if (s.y + BIRD.r > bot) {
        s.y = bot - BIRD.r;
        if (s.vy > 0) s.vy = 0;
      }
    }

    for (let i = Math.max(0, from); i <= to && i < s.course.length; i++) {
      const ob = s.course[i];
      if (ob.type === 'tunnel' && !ob.tunnelHead) continue; // soft walls: handled above
      const sh = obstacleShape(ob, s.distance, s.time);
      if (sh.x > BIRD.x + BIRD.r + SWING.L) continue;
      if (isPipeType(ob.type) && sh.x + sh.w < BIRD.x - BIRD.r) continue;
      let hit = false;
      for (let j = 0; j < sh.shapes.length; j++) {
        if (hitsShape(BIRD.x, s.y, BIRD.r, sh.shapes[j])) {
          hit = true;
          break;
        }
      }
      if (hit) {
        s.deadType = sh.type;
        die(s, 'hazard');
        return s;
      }
    }

    // 5) Gates passed: refresh the biome and track tunnel progress
    //    (used only for the speed ramp and the background).
    while (s.nextGate < s.course.length) {
      const g = s.course[s.nextGate];
      if (g.worldX + PIPE.w >= s.distance + BIRD.x) break;
      // Crossing the exit segment counts as entering the new biome: banner,
      // palette and difficulty all switch on this very tick.
      s.biome = g.tunnelExit ? g.biome + 1 : g.biome;
      if (g.tunnelExit) s.tunnelFlash = TUNNEL.flash;
      s.nextGate++;
    }
    s.passed = s.nextGate;

    // 6) Coin pickup (circle collision).
    for (let i = 0; i < s.coins.length; i++) {
      const coin = s.coins[i];
      if (coin.got) continue;
      if (coin.worldX > s.distance + BIRD.x + COIN.r + BIRD.r) break; // sorted by worldX
      if (coin.worldX < s.distance + BIRD.x - COIN.r - BIRD.r - 4) continue;
      const pos = coinPos(coin, s.course, s.distance, s.time);
      if (circleHitsCircle(BIRD.x, s.y, BIRD.r, pos.x, pos.y, COIN.r)) {
        coin.got = true;
        s.coinsGot++;
        s.coinTick = s.t;
        s.events.push({ type: 'coin', x: pos.x, y: pos.y, t: s.t });
      }
    }

    // 7) Next tick; lay more track when the end comes close (endless, no finish).
    if (s.tunnelFlash > 0) s.tunnelFlash = Math.max(0, s.tunnelFlash - DT);
    s.t++;
    if (s.nextGate > s.course.length - COURSE_AHEAD) extendRun(s);
    return s;
  }

  /** Full replay — used by the Node calibration tools and, later, a server. */
  function simulate(opts) {
    opts = opts || {};
    const s = createRun(opts);
    const inputs = (opts.inputs || []).slice().sort(function (a, b) {
      return a - b;
    });
    const limit = opts.tickLimit != null ? opts.tickLimit : MAX_RUN_TICKS;
    let p = 0;
    while (!s.dead && s.t < limit) {
      while (p < inputs.length && inputs[p] <= s.t) {
        queueFlap(s);
        p++;
      }
      step(s);
    }
    return {
      seed: s.seed,
      coins: s.coinsGot,
      biome: s.biome,
      passed: s.passed,
      ticks: s.t,
      coinTick: s.coinTick,
      dead: s.dead,
      deadReason: s.deadReason,
      distance: Math.round(s.distance)
    };
  }

  function runChecksum(parts) {
    return fnv1a([parts.mode, parts.seed, parts.score, parts.ticks, (parts.inputs || []).join(',')].join('|')).toString(
      16
    );
  }

  return {
    CFG: CFG,
    TICK_HZ: TICK_HZ,
    DT: DT,
    COURSE_CHUNK: COURSE_CHUNK,
    COURSE_STEP: COURSE_STEP,
    COURSE_AHEAD: COURSE_AHEAD,
    WORLD: WORLD,
    FLOOR_Y: FLOOR_Y,
    BIRD: BIRD,
    PIPE: PIPE,
    BLADE: BLADE,
    SWING: SWING,
    TUNNEL: TUNNEL,
    TWIN: TWIN,
    PINWHEEL: PINWHEEL,
    ORBITER: ORBITER,
    MID_Y: MID_Y,
    CLAMPER: CLAMPER,
    TWINBLADE: TWINBLADE,
    MIDSWING: MIDSWING,
    BIOMES: BIOMES,
    COIN: COIN,
    PHASE: PHASE,
    tierAt: tierAt,
    biomeKey: biomeKey,
    TIER_MAX: TIER_MAX,
    TIER_STEP: TIER_STEP,
    PX_PER_METER: PX_PER_METER,
    metersOf: metersOf,
    rng: rng,
    fnv1a: fnv1a,
    todaySeed: todaySeed,
    seedFromString: seedFromString,
    nextSeed: nextSeed,
    isPipeType: isPipeType,
    buildCourse: buildCourse,
    buildCoins: buildCoins,
    speedAt: speedAt,
    obstacleShape: obstacleShape,
    coinPos: coinPos,
    createRun: createRun,
    extendRun: extendRun,
    queueFlap: queueFlap,
    step: step,
    simulate: simulate,
    runChecksum: runChecksum
  };
});
