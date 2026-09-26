/* ============================================================
 * Simple Flappy Bird — configuration
 * ------------------------------------------------------------
 * Every tunable number of the game lives in this single file.
 * Edit a value, save, reload the page — no build step required.
 *
 * Layout
 *   simulation      fixed-step clock
 *   world           canvas size and ground line
 *   bird            player physics
 *   course          endless-track streaming
 *   pipes           standard gates (the pillars)
 *   flight          human flight envelope used by the generator
 *   obstacles       all hazards / mechanisms
 *   coins           pickups
 *   scoring         distance units
 *   difficulty      tier ladder, unlock table, gap tightening
 *   biomes          per-biome names (index order matters!)
 *   theme           per-biome colour palettes (keyed by biome key)
 *   pipeStyles      per-gate colour palettes (keyed by gate type)
 *   leaderboard     game modes, demo rivals, storage keys
 *
 * Two rules for keeping the generator honest when you tweak numbers:
 *   1) The course is deterministic: `buildCourse(seed, n)` only decides
 *      how far to lay track, never what the earlier segments look like.
 *      So you can always extend a track without breaking replays.
 *   2) Every safe lane must stay inside the flight envelope (see
 *      `flight`). If you widen a hazard's reach, re-check that a bird
 *      can still cross it — otherwise raise the generator margins too.
 *
 * Works in the browser (window.FlappyConfig) and in Node
 * (require('./config.js')), so the same numbers drive both.
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlappyConfig = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  return {
    /* ================= i18n =================
     * Language the page starts in, before the player touches the switch in
     * the bottom-right corner. One of: 'en' | 'zh'. The browser's locale is
     * never sniffed, so an English-first demo looks the same everywhere.
     * A player's explicit choice is remembered in localStorage and wins. */
    i18n: {
      defaultLang: 'en'
    },

    /* ================= simulation ================= */
    simulation: {
      tickHz: 120, // fixed logic ticks per second (never tied to render fps)
      maxRunTicks: 120 * 60 * 180 // replay safety cap: three hours
    },

    /* ================= world ================= */
    world: {
      width: 432,
      height: 768,
      floorOffset: 96 // ground line = height - floorOffset; touching it kills the bird
    },

    /* ================= bird ================= */
    bird: {
      x: 118, // fixed horizontal position (the world scrolls instead)
      radius: 13,
      gravity: 1850, // px/s^2
      flapVelocity: -470, // px/s applied on flap
      maxFallSpeed: 950
    },

    /* ================= endless course ================= */
    course: {
      initialSegments: 300, // segments laid at start (not a limit)
      extendStep: 300, // segments added per extension
      extendAhead: 120, // extend once fewer than this many remain
      warmupPillars: 6 // first N gates are plain static pillars
    },

    /* ================= standard gates (pipes) ================= */
    pipes: {
      width: 74,
      spacing: 300, // world-space distance between gates (constant => reproducible)
      speedStart: 168, // starting scroll speed, px/s
      speedMax: 322,
      speedGain: 3.2, // extra px/s per gate passed
      gapStart: 214, // starting gap height
      gapShrink: 1.35, // gap loss per pillar
      gapMin: 172,
      hardFactor: 0.86, // gap multiplier for the "narrow" gate
      hardMin: 156, // absolute floor for any gap (also caps the clamper squeeze)
      margin: 56, // minimum distance from a gap to the ceiling / ground
      maxShift: 235, // max vertical offset between two neighbouring gap centres
      /* Oscillation period of the plain gates (static / pulse / stagger ramps
       * are driven purely by `amp`; the period only animates the visuals). */
      periodBase: 1.8,
      periodJitter: 0.9
    },

    /* ================= human flight envelope =================
     * The generator only places lanes a human can actually reach.
     * Measured limits are higher (~330 px/s climbing); the values below
     * deliberately keep headroom. Lower them to make the game stricter. */
    flight: {
      climb: 175, // px/s the player is assumed able to climb
      dive: 285, // px/s the player is assumed able to dive
      downCap: 265 // hard cap on a single downward hop, px
    },

    /* ================= obstacles / mechanisms ================= */
    obstacles: {
      /* Metal tunnel: solid shell top and bottom, straight corridor between.
       * Only the entrance slab is a deadly wall; everything after it is a
       * "soft" wall that simply pushes the bird back into the corridor. */
      tunnel: {
        firstAt: 10, // segment index of the very first tunnel
        firstJitter: 6, // the first tunnel is pushed back by up to this many pillars
        every: 20, // one tunnel every N pillars afterwards (~24 pillars/biome)
        len: [4, 6], // min/max number of segments a tunnel spans
        gap: 178, // corridor height
        gapMin: 150,
        gapTighten: 3, // corridor shrinks this much per biome entered
        flash: 2.2 // seconds the "new biome" banner stays up
      },

      /* Twin-gap wall: one wall, two openings (top and bottom) split by a slab. */
      twin: {
        gap: 158, // clear height of each opening
        gapMin: 146,
        bar: 54, // slab thickness between the two openings
        minClear: 46 // minimum distance from the whole group to ceiling / ground
      },

      /* Track saw: rides a vertical rail, safe lanes above and below. */
      blade: {
        r: 37, // disc radius (collision radius); spikes reach exactly this far
        band: 138, // max travel away from the rail centre
        cyMin: 290, // rail centre range (raised floor so the top lane clears the ceiling)
        cyMax: 400,
        laneMargin: 46, // minimum clearance of a safe lane from ceiling / ground
        ampMin: 0.82, // travel is (ampMin .. ampMin + ampSpan) x band
        ampSpan: 0.18,
        periodBase: 2.6, // seconds per round trip
        periodJitter: 1.0
      },

      /* Pendulum: swings down from the ceiling or up from the ground. */
      swing: {
        length: 285, // rod length
        amp: 0.95, // swing amplitude, radians (~54 deg)
        ballR: 26,
        rodR: 8,
        laneY: 92, // safe lane of a bottom-hung swing (mirrored for a top one)
        anchor: 8, // distance of the pivot from the ceiling / ground
        periodBase: 2.8,
        periodJitter: 0.9
      },

      /* Pinwheel: four arms spinning around a hub; pass outside the sweep. */
      pinwheel: {
        armLength: 126, // arm length = sweep radius
        rodR: 9,
        hubR: 15,
        cyMin: 158, // hub travel range (keeps the wheel on screen)
        cyMax: 522,
        drift: 36, // clearance left between the lane and the sweep circle
        period: [2.9, 3.9] // seconds per revolution
      },

      /* Orbiting saw: blade circling on a ring track, safe lanes above / below. */
      orbiter: {
        ringR: 94,
        sawR: 26,
        cyMin: 282,
        cyMax: 396,
        period: [2.7, 3.7],
        laneMargin: 46
      },

      /* Clamper: two toothed jaws squeeze toward the middle from both sides.
       * Danger is top and bottom, the corridor is in between. */
      clamper: {
        gap: 224, // clear height between the jaws before squeezing
        amp: 58, // both jaws close in by this much => tightest gap = gap - amp
        drift: 52, // the whole pair drifts up and down, so the lane is not fixed
        driftPeriod: [3.6, 4.8],
        period: [2.0, 2.8]
      },

      /* Twin blade: two saws on rails moving toward each other, corridor between. */
      twinblade: {
        half: 82, // corridor half-height (saw centre distance minus saw radius)
        halfAmp: 20, // the two saws close in / open up by this much
        centerAmp: 34, // corridor centre drifts up and down
        sawR: 30,
        period: [2.6, 3.8],
        drift: 14 // clearance required when the player does not follow the drift
      },

      /* Mid swing: one pendulum from the ceiling and one from the ground.
       * They sweep both sides, leaving one straight corridor in the middle. */
      midswing: {
        length: 206, // rod length (longer => narrower corridor)
        amp: 0.95,
        ballR: 26,
        rodR: 8,
        pad: 6, // clearance between the corridor edge and the closest ball position
        anchor: 8, // distance of each pivot from the ceiling / ground
        periodBase: 2.8,
        periodJitter: 0.8
      }
    },

    /* ================= coins ================= */
    coins: {
      radius: 12,
      gateEmptyChance: 0.22, // chance a gate holds no coin at all
      maxPerGate: 2, // 1..maxPerGate coins per gap
      trailChance: 0.55, // chance of drawing a curved coin trail between two gates
      trailMaxOffset: 52, // how far a trail may bend away from the lane, px
      trailShapes: 6 // number of trail silhouettes (see buildCoins)
    },

    /* ================= scoring ================= */
    scoring: {
      pixelsPerMeter: 40 // 1 m = 40 px; starting speed is about 4.2 m/s
    },

    /* ================= difficulty =================
     * Tier = biomesEntered + floor(pillarIndex / tierStep), capped at maxTier.
     * Each tier unlocks more hazards and tightens every gap a little. */
    difficulty: {
      maxTier: 20,
      tierStep: 40, // pillars per extra tier (biomes push it further)

      /* Unlock table: [type, firstTier, fullWeight].
       * Weight ramps from 60% to 100% of `fullWeight` within two tiers,
       * static pillars fade out exponentially. Types already listed here
       * are what the generator may pick; add a name to introduce a hazard. */
      mix: [
        ['slider', 0, 0.13],
        ['pulse', 1, 0.13],
        ['stagger', 1, 0.12],
        ['blade', 2, 0.1],
        ['pinwheel', 2, 0.09],
        ['twin', 3, 0.13],
        ['narrow', 4, 0.11],
        ['clamper', 4, 0.08],
        ['swing', 5, 0.06],
        ['twinblade', 5, 0.06],
        ['midswing', 6, 0.06],
        ['orbiter', 6, 0.05]
      ],

      staticWeight: { base: 0.6, decay: 0.87, floor: 0.07 }, // plain pillar weight curve
      weightRamp: { base: 0.6, span: 2 }, // 60% -> 100% over `span` tiers
      gapMul: { start: 1, step: 0.008, floor: 0.84 }, // per-tier global gap tightening

      /* The gate right after a narrow gate / pendulum / mechanism is always
       * drawn from this pool, so a brutal gate is followed by a fair one. */
      afterHazardMix: [
        ['static', 0.42],
        ['slider', 0.3],
        ['pulse', 0.28]
      ],

      /* "Warm-up" scaling: a hazard that just unlocked is scaled down so its
       * first appearance is readable. Below `tinyTier` use `tinyScale`,
       * at `smallTier` use `smallScale`, afterwards full size. */
      warmup: {
        tinyTier: 2,
        tinyScale: 0.72,
        smallTier: 3,
        smallScale: 0.86,
        pinwheelTinyScale: 0.74 // pinwheel arms grow a touch slower than the saw
      },

      /* Gate oscillation grows with pillar index, so early gates barely move. */
      slider: {
        ampFrom: 8, // below this pillar index the gate does not move at all
        ampBase: 26, // ...and it uses this amplitude instead
        ampIntercept: 30, // amplitude above `ampFrom` is intercept + slope * index
        ampSlope: 2.6,
        ampMax: 108,
        periodBase: 2.6, // slower gates for larger amplitudes
        periodPerAmp: 0.026,
        periodJitter: 0.5
      },
      pulse: { ampBase: 10, ampSlope: 0.7, ampMax: 26 }
    },

    /* ================= biomes =================
     * Ordered list of biome keys — one biome per tunnel passed, cycling
     * back to the first after the last one. Display names live in
     * `i18n.js` (key `biome.<key>`); colours live in `theme` below.
     * The order must line up with the `theme` entries. */
    biomes: [
      'forest',
      'desert',
      'snow',
      'volcano',
      'ocean',
      'bamboo',
      'swamp',
      'canyon',
      'glacier',
      'badland',
      'coral',
      'lava',
      'storm',
      'tundra',
      'dune',
      'mist',
      'nebula',
      'aurora',
      'scorched',
      'salt',
      'abyss',
      'cloud',
      'wasteland',
      'crystal',
      'dawn'
    ],

    /* ================= theme =================
     * Colour palette per biome, keyed by the biome key above.
     *   skyTop / skyBot  sky gradient
     *   sun              sun or moon disc
     *   far / mid / near three parallax hill layers
     *   grass1 / grass2  ground gradient
     *   cloud            cloud colour
     *   deco / decoColor / decoDark   mid-ground scenery
     * `deco` is one of: tree | cactus | pine | rock | star */
    theme: {
      forest: {
        skyTop: '#6ec6e8',
        skyBot: '#cdeccd',
        sun: '#fff3bf',
        far: '#7fae87',
        mid: '#4f8a5c',
        near: '#2f6b3f',
        grass1: '#3f8a4a',
        grass2: '#1d4526',
        cloud: 'rgba(255,255,255,.35)',
        deco: 'tree',
        decoColor: '#5d9468',
        decoDark: '#2f6339'
      },
      desert: {
        skyTop: '#f9c96a',
        skyBot: '#f6e2b4',
        sun: '#fff4cf',
        far: '#dcb684',
        mid: '#c69b66',
        near: '#a87f4c',
        grass1: '#dcbb84',
        grass2: '#8a6a3c',
        cloud: 'rgba(255,255,255,.28)',
        deco: 'cactus',
        decoColor: '#6f9a5c',
        decoDark: '#4f7340'
      },
      snow: {
        skyTop: '#93bcdc',
        skyBot: '#e9f3fb',
        sun: '#ffffff',
        far: '#c3d4e2',
        mid: '#a3b9cd',
        near: '#8098b0',
        grass1: '#e9f3fb',
        grass2: '#9fb4c7',
        cloud: 'rgba(255,255,255,.6)',
        deco: 'pine',
        decoColor: '#5f8f7a',
        decoDark: '#3d6b58'
      },
      volcano: {
        skyTop: '#3a1f2b',
        skyBot: '#c9553a',
        sun: '#ffb066',
        far: '#5c3040',
        mid: '#432331',
        near: '#2b1620',
        grass1: '#5c2a26',
        grass2: '#22100f',
        cloud: 'rgba(90,45,45,.45)',
        deco: 'rock',
        decoColor: '#4a2a33',
        decoDark: '#2c171d'
      },
      ocean: {
        skyTop: '#0d1b3e',
        skyBot: '#2b4a8f',
        sun: '#cfe3ff',
        far: '#26356b',
        mid: '#1a2650',
        near: '#0f1738',
        grass1: '#1e3a63',
        grass2: '#0a1430',
        cloud: 'rgba(180,210,255,.22)',
        deco: 'star',
        decoColor: '#6f8ce0',
        decoDark: '#3d4f9c'
      },
      bamboo: {
        skyTop: '#a8d8c0',
        skyBot: '#e3f3d6',
        sun: '#fdffd9',
        far: '#8cbf95',
        mid: '#6aa87a',
        near: '#4a8a5e',
        grass1: '#5ea86c',
        grass2: '#26663c',
        cloud: 'rgba(255,255,255,.4)',
        deco: 'pine',
        decoColor: '#4e9a68',
        decoDark: '#2f6b46'
      },
      swamp: {
        skyTop: '#5d7550',
        skyBot: '#b9c48d',
        sun: '#e8f0b0',
        far: '#6d7f4e',
        mid: '#556440',
        near: '#3d4a2f',
        grass1: '#4a5a32',
        grass2: '#232b18',
        cloud: 'rgba(200,210,160,.3)',
        deco: 'tree',
        decoColor: '#5c6b3c',
        decoDark: '#333d20'
      },
      canyon: {
        skyTop: '#8fb4d8',
        skyBot: '#efd7b4',
        sun: '#fff0cf',
        far: '#c78a5e',
        mid: '#a96a44',
        near: '#7d4b2e',
        grass1: '#a5683f',
        grass2: '#5c3520',
        cloud: 'rgba(255,255,255,.25)',
        deco: 'rock',
        decoColor: '#a06a45',
        decoDark: '#6b3f26'
      },
      glacier: {
        skyTop: '#bcd9ee',
        skyBot: '#f2fbff',
        sun: '#ffffff',
        far: '#a9c8de',
        mid: '#88abcd',
        near: '#6b8fb4',
        grass1: '#dff1fb',
        grass2: '#8fadc4',
        cloud: 'rgba(255,255,255,.65)',
        deco: 'rock',
        decoColor: '#9fc0da',
        decoDark: '#6d8dab'
      },
      badland: {
        skyTop: '#c9a86a',
        skyBot: '#e8d5a6',
        sun: '#ffeec2',
        far: '#b08a52',
        mid: '#8f6c3d',
        near: '#6b4f2b',
        grass1: '#8f7040',
        grass2: '#4d3a1f',
        cloud: 'rgba(255,240,210,.28)',
        deco: 'rock',
        decoColor: '#8c6b40',
        decoDark: '#5b4227'
      },
      coral: {
        skyTop: '#f7b7c4',
        skyBot: '#ffe3dc',
        sun: '#fff6ee',
        far: '#e08aa0',
        mid: '#c46a86',
        near: '#9b4b66',
        grass1: '#e3919e',
        grass2: '#8a4257',
        cloud: 'rgba(255,255,255,.4)',
        deco: 'star',
        decoColor: '#ff9fb4',
        decoDark: '#c9657f'
      },
      lava: {
        skyTop: '#2a1420',
        skyBot: '#b03a1e',
        sun: '#ff8a3c',
        far: '#5a2020',
        mid: '#3d1616',
        near: '#250d0d',
        grass1: '#4d1c14',
        grass2: '#1c0908',
        cloud: 'rgba(120,40,20,.45)',
        deco: 'rock',
        decoColor: '#581f16',
        decoDark: '#31100a'
      },
      storm: {
        skyTop: '#2b3448',
        skyBot: '#6a7488',
        sun: '#dfe6f2',
        far: '#3d465e',
        mid: '#2c3448',
        near: '#1d2333',
        grass1: '#2b3244',
        grass2: '#141a26',
        cloud: 'rgba(200,210,230,.22)',
        deco: 'pine',
        decoColor: '#33405a',
        decoDark: '#1e2738'
      },
      tundra: {
        skyTop: '#9fb6c4',
        skyBot: '#dfe9e4',
        sun: '#f4f8f2',
        far: '#93a89c',
        mid: '#77897f',
        near: '#5c6b62',
        grass1: '#8a9c86',
        grass2: '#48544a',
        cloud: 'rgba(255,255,255,.5)',
        deco: 'pine',
        decoColor: '#5f7a66',
        decoDark: '#3d5344'
      },
      dune: {
        skyTop: '#ffd89a',
        skyBot: '#fdead0',
        sun: '#fff7dd',
        far: '#e8c182',
        mid: '#d1a45f',
        near: '#b3853f',
        grass1: '#e2c58c',
        grass2: '#96703a',
        cloud: 'rgba(255,255,255,.24)',
        deco: 'cactus',
        decoColor: '#8fa458',
        decoDark: '#6b7a3c'
      },
      mist: {
        skyTop: '#8f93a8',
        skyBot: '#d8dae4',
        sun: '#f2f3f8',
        far: '#9397ab',
        mid: '#7b7f93',
        near: '#646879',
        grass1: '#82868f',
        grass2: '#454956',
        cloud: 'rgba(255,255,255,.45)',
        deco: 'tree',
        decoColor: '#7c8290',
        decoDark: '#4a4f5c'
      },
      nebula: {
        skyTop: '#150b2e',
        skyBot: '#4a2a6e',
        sun: '#e3ccff',
        far: '#3b2360',
        mid: '#2a1848',
        near: '#180e2c',
        grass1: '#31204f',
        grass2: '#0d0719',
        cloud: 'rgba(190,160,255,.22)',
        deco: 'star',
        decoColor: '#b48cff',
        decoDark: '#6f4fb0'
      },
      aurora: {
        skyTop: '#071c2a',
        skyBot: '#14504a',
        sun: '#b6ffe4',
        far: '#12564f',
        mid: '#0c3b38',
        near: '#072524',
        grass1: '#12504a',
        grass2: '#04191b',
        cloud: 'rgba(150,255,220,.22)',
        deco: 'pine',
        decoColor: '#3fae96',
        decoDark: '#1d6b60'
      },
      scorched: {
        skyTop: '#2b2118',
        skyBot: '#7a4a22',
        sun: '#ffb457',
        far: '#4a3524',
        mid: '#33241a',
        near: '#221711',
        grass1: '#3b2a1c',
        grass2: '#150e09',
        cloud: 'rgba(120,90,60,.4)',
        deco: 'rock',
        decoColor: '#463327',
        decoDark: '#26180f'
      },
      salt: {
        skyTop: '#cfe6ec',
        skyBot: '#f7fbfc',
        sun: '#ffffff',
        far: '#c2d9dd',
        mid: '#a7c2c8',
        near: '#8ba8b0',
        grass1: '#eaf4f5',
        grass2: '#9db6ba',
        cloud: 'rgba(255,255,255,.7)',
        deco: 'rock',
        decoColor: '#c6dbdd',
        decoDark: '#93aeb0'
      },
      abyss: {
        skyTop: '#03122e',
        skyBot: '#0d3560',
        sun: '#8fd3ff',
        far: '#0c2c50',
        mid: '#081f39',
        near: '#04121f',
        grass1: '#0a2647',
        grass2: '#02080f',
        cloud: 'rgba(120,200,255,.18)',
        deco: 'star',
        decoColor: '#4fb3e8',
        decoDark: '#1f6b9c'
      },
      cloud: {
        skyTop: '#79c4f2',
        skyBot: '#eaf7ff',
        sun: '#fffdf0',
        far: '#ffffff',
        mid: '#d9ecf9',
        near: '#b6d8ee',
        grass1: '#f2fbff',
        grass2: '#a9cbe0',
        cloud: 'rgba(255,255,255,.8)',
        deco: 'star',
        decoColor: '#ffffff',
        decoDark: '#c6dff0'
      },
      wasteland: {
        skyTop: '#6b6152',
        skyBot: '#bdb29b',
        sun: '#f0e6c8',
        far: '#7a6f5c',
        mid: '#615748',
        near: '#484034',
        grass1: '#6b6152',
        grass2: '#2f2a22',
        cloud: 'rgba(220,210,180,.25)',
        deco: 'rock',
        decoColor: '#7d725f',
        decoDark: '#4a4235'
      },
      crystal: {
        skyTop: '#2a1b46',
        skyBot: '#8a5fb0',
        sun: '#ffe6ff',
        far: '#5b3a86',
        mid: '#432a68',
        near: '#2d1a49',
        grass1: '#4d3175',
        grass2: '#1c1030',
        cloud: 'rgba(255,210,255,.24)',
        deco: 'star',
        decoColor: '#e6a8ff',
        decoDark: '#9a5fc4'
      },
      dawn: {
        skyTop: '#ffb27a',
        skyBot: '#ffe9c9',
        sun: '#fff2c8',
        far: '#c98a86',
        mid: '#a96a6e',
        near: '#8a4f57',
        grass1: '#b98577',
        grass2: '#6b423f',
        cloud: 'rgba(255,240,220,.34)',
        deco: 'tree',
        decoColor: '#a8776a',
        decoDark: '#6d4a45'
      }
    },

    /* ================= gate styles =================
     * Colour palette per gate type, keyed by the type name used in core.js:
     * static | slider | pulse | stagger | narrow | twin | clamper */
    pipeStyles: {
      static: { body: '#3f8f4f', dark: '#2c6b39', cap: '#57b266' },
      slider: { body: '#2f8f8a', dark: '#1f6b67', cap: '#46b3ac' },
      pulse: { body: '#3a6fb0', dark: '#2a5387', cap: '#5a90d4' },
      narrow: { body: '#8f3f3f', dark: '#6b2c2c', cap: '#b35757' },
      stagger: { body: '#6f4b9e', dark: '#52377a', cap: '#8f68c4' },
      twin: { body: '#4a5f86', dark: '#2f3f5e', cap: '#7b93c0' },
      clamper: { body: '#a4622f', dark: '#7a441c', cap: '#e0954f' }
    },

    /* ================= leaderboard ================= */
    leaderboard: {
      storageKeys: {
        entries: 'flappy.entries.v4',
        extras: 'flappy.extras.v4',
        me: 'flappy.me.v1'
      },
      remote: { enabled: false, base: '/api/game/flappy' },
      maxEntries: 100, // local board keeps this many rows per mode
      maxRecent: 8, // recent results shown in the menu
      maxNameLength: 12,
      defaultName: 'Player', // used until the player picks a nickname

      /* Rivals are the demo entries pre-filled into every local board so an
       * empty leaderboard still looks alive. `ladder` is one score per rival,
       * calibrated against a scripted bot: the middle of the board sits near
       * "average human", the top near "a near-perfect run".
       * Names live in `i18n.js` under `rival.0` .. `rival.5`. */
      modes: {
        coin: { key: 'coin', ladder: [130, 95, 70, 50, 30, 15] },
        distance: { key: 'distance', ladder: [1000, 700, 450, 280, 150, 50] }
      }
    }
  };
});
