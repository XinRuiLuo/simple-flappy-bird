/* ============================================================
 * Simple Flappy Bird — rendering / input / flow (game.js)
 * ------------------------------------------------------------
 * The simulation runs at a fixed 120 Hz step inside the core; this
 * file only owns the picture, the input and the UI.
 *
 * Gameplay: one life, fly until you crash, every tunnel you pass
 * switches the biome and the difficulty keeps climbing.
 *
 * Local demo: no anti-cheat, scores go straight to the local board.
 *
 * Everything user-visible comes from `i18n.js`; every tunable comes
 * from `config.js` (through `FlappyCore.CFG`).
 * ============================================================ */
(function () {
  'use strict';

  const C = window.FlappyCore;
  const B = window.FlappyBoard;
  const I18N = window.FlappyI18n;

  const W = C.WORLD.w;
  const H = C.WORLD.h;
  const FLOOR_Y = C.FLOOR_Y;
  const MAX_FRAME = 0.25; // per-frame cap, so returning from a background tab never fast-forwards

  const $ = (id) => document.getElementById(id);
  const cvs = $('game');
  const ctx = cvs.getContext('2d');

  /* ---------------- view ----------------
   * Landscape or portrait: scale uniformly and letterbox with black bars. */
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const stage = cvs.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(stage.width / W, stage.height / H);
    view.scale = scale;
    view.dpr = dpr;
    view.ox = (stage.width - W * scale) / 2;
    view.oy = (stage.height - H * scale) / 2;
    cvs.width = Math.max(1, Math.round(stage.width * dpr));
    cvs.height = Math.max(1, Math.round(stage.height * dpr));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  /* ---------------- state ---------------- */
  const S = {
    scene: 'menu', // menu | playing | dying | over | board | paused
    seed: C.todaySeed(),
    mode: 'coin', // mode picked in the menu: coin / distance (decides what the next run scores)
    runMode: 'coin', // frozen at the moment a run starts, so switching mid-run cannot change it
    god: false, // local testing only: fly straight through everything
    run: null,
    acc: 0,
    last: 0,
    restarts: 0,
    particles: [],
    shake: 0,
    flash: 0,
    goFlash: 0,
    flapAnim: 0,
    eventIdx: 0, // number of coin effects already consumed
    lastResult: null,
    hudScore: -1,
    hudDist: -1,
    hudCoins: -1,
    hudBiome: '',
    hudTunnel: ''
  };

  const speedLabel = (passed) => 'x' + (C.speedAt(passed) / C.PIPE.speedStart).toFixed(2);

  // Each mode scores one raw number — there is no "combined score" any more:
  //   coin mode     coins collected (count)      distance mode   whole metres flown (m)
  function scoreOf(mode, run) {
    return mode === 'distance' ? C.metersOf(run.distance) : run.coinsGot;
  }
  const unitOf = (mode) => B.modeOf(mode).unit;
  const modeNameOf = (mode) => B.modeOf(mode).name;

  // Current biome key (one per tunnel passed; wraps around after all 25)
  function biomeOf(run) {
    return C.biomeKey(run ? run.biome : 0);
  }
  const palOf = (run) => C.CFG.theme[biomeOf(run)] || C.CFG.theme[C.biomeKey(0)];

  // How many gates are left before the next tunnel
  function tunnelLeft(run) {
    for (let i = run.nextGate; i < run.course.length; i++) {
      if (run.course[i].tunnelHead) return i - run.nextGate;
    }
    return -1;
  }

  /* ---------------- start / restart ---------------- */
  function startRun(seed) {
    S.seed = seed >>> 0 || C.todaySeed();
    S.runMode = S.mode; // the mode is locked in right here
    S.run = C.createRun({ seed: S.seed, god: S.god });
    S.acc = 0;
    S.particles = [];
    S.shake = 0;
    S.flash = 0;
    S.goFlash = 0.75;
    S.hudScore = -1;
    S.hudDist = -1;
    S.hudCoins = -1;
    S.hudBiome = '';
    S.hudTunnel = '';
    S.eventIdx = 0;
    S.scene = 'playing';
    hide('menu');
    hide('over');
    hide('board');
    hide('pause');
    $('hud').classList.add('live');
    updateHud(true);
  }

  function restart() {
    S.restarts++;
    startRun(S.seed); // same track again; to change it use "New track"
  }

  function toMenu() {
    S.scene = 'menu';
    S.run = null;
    S.lastResult = null;
    hide('over');
    hide('board');
    hide('pause');
    $('hud').classList.remove('live');
    renderMenu();
    show('menu');
  }

  /* ---------------- god mode (local testing only) ----------------
   * While enabled, hitting a gate, a mechanism, the tunnel entrance or the
   * ground/ceiling does not kill — you fly straight through.
   * The switch is global: it applies to the current run immediately and stays
   * on for the following ones.
   * Note: with god mode on you can never die, so the run never ends by itself
   * — press R to restart or P to pause. */
  function setGod(on) {
    S.god = !!on;
    if (S.run) S.run.god = S.god;
    syncGodBtn();
    toast(I18N.t(S.god ? 'toast.godOn' : 'toast.godOff'));
  }

  function syncGodBtn() {
    const b = $('btnGod');
    b.textContent = I18N.t(S.god ? 'god.on' : 'god.off');
    b.classList.toggle('on', S.god);
  }

  function endRun() {
    const run = S.run;
    const mode = S.runMode;
    const payload = {
      seed: run.seed,
      mode: mode,
      score: scoreOf(mode, run), // coin mode counts coins, distance mode counts metres
      coins: run.coinsGot,
      distance: Math.round(run.distance),
      ticks: run.t,
      scoreTick: run.coinTick
    };
    const res = B.submit(payload);
    if (B.remote.enabled) {
      B.remoteSubmit(payload).then((r) => {
        if (r && typeof r.rank === 'number') {
          res.rank = r.rank;
          renderOver();
        }
      });
    }
    S.lastResult = { payload: payload, res: res };
    S.scene = 'over';
    $('hud').classList.remove('live');
    renderOver();
    show('over');
  }

  /* ---------------- main loop ---------------- */
  function loop(now) {
    requestAnimationFrame(loop);
    if (!S.last) S.last = now;
    let dt = (now - S.last) / 1000;
    S.last = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    if (dt < 0) dt = 0;

    if (S.scene === 'playing' && S.run) {
      S.acc += dt;
      let steps = 0;
      while (S.acc >= C.DT && steps < 64) {
        C.step(S.run);
        S.acc -= C.DT;
        steps++;
        if (S.run.dead) break;
      }
      if (S.run.dead) onDeath();
      else updateHud(false);
    }

    // Coin effects: turn new core events into golden particles
    if (S.run) {
      while (S.eventIdx < S.run.events.length) {
        const ev = S.run.events[S.eventIdx++];
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 40 + Math.random() * 150;
          S.particles.push({
            x: ev.x,
            y: ev.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 40,
            life: 0.35 + Math.random() * 0.3,
            size: 1.6 + Math.random() * 2.2,
            color: i % 2 ? '#ffe27a' : '#fff3bf'
          });
        }
      }
    }

    // Effect decay
    S.shake = Math.max(0, S.shake - dt * 3.2);
    S.flash = Math.max(0, S.flash - dt * 3.6);
    S.goFlash = Math.max(0, S.goFlash - dt * 1.8);
    S.flapAnim = Math.max(0, S.flapAnim - dt * 4.5);
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 320 * dt;
      p.life -= dt;
      if (p.life <= 0) S.particles.splice(i, 1);
    }

    render();
  }

  function onDeath() {
    S.shake = 1;
    S.flash = 0.9;
    const run = S.run;
    for (let i = 0; i < 26; i++) {
      S.particles.push({
        x: C.BIRD.x,
        y: run.y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.7) * 260,
        life: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 3,
        color: i % 3 === 0 ? '#f2d24b' : i % 3 === 1 ? '#cdeccd' : '#8fbf6a'
      });
    }
    setTimeout(endRun, 420); // let the impact play out before the result screen
    S.scene = 'dying';
  }

  /* ---------------- input ---------------- */
  function flap() {
    if (S.scene !== 'playing' || !S.run) return;
    if (C.queueFlap(S.run)) {
      S.flapAnim = 1;
      S.particles.push({
        x: C.BIRD.x - 12,
        y: S.run.y + 6,
        vx: -90 - Math.random() * 60,
        vy: 40 + Math.random() * 60,
        life: 0.32,
        size: 2.4,
        color: 'rgba(230,245,220,.9)'
      });
    }
  }

  cvs.addEventListener(
    'pointerdown',
    (e) => {
      e.preventDefault();
      if (S.scene === 'playing') flap();
      else if (S.scene === 'over') restart();
      else if (S.scene === 'paused') resume();
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    const k = e.code;
    if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') {
      e.preventDefault();
      if (S.scene === 'playing') flap();
      else if (S.scene === 'over') restart();
      else if (S.scene === 'menu') {
        const b = $('btnStart');
        if (b) b.click();
      } else if (S.scene === 'paused') resume();
    } else if (k === 'KeyR') {
      if (S.scene === 'over' || S.scene === 'playing' || S.scene === 'paused') restart();
    } else if (k === 'Escape') {
      if (S.scene === 'playing') pause();
      else if (S.scene === 'board') {
        hide('board');
        S.scene = S.lastResult ? 'over' : 'menu';
        if (S.scene === 'menu') {
          show('menu');
          renderMenu();
        }
      } else if (S.scene === 'paused') resume();
    } else if (k === 'KeyP') {
      if (S.scene === 'playing') pause();
      else if (S.scene === 'paused') resume();
    }
  });

  function pause() {
    S.scene = 'paused';
    show('pause');
  }

  function resume() {
    S.scene = 'playing';
    hide('pause');
    S.acc = 0;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.scene === 'playing') pause();
  });

  function show(id) {
    $(id).classList.remove('hidden');
  }

  function hide(id) {
    $(id).classList.add('hidden');
  }

  /* ---------------- HUD ---------------- */
  let hudSideT = -1; // last time the right-hand column was refreshed, used to throttle

  function updateHud(force) {
    const run = S.run;
    if (!run) return;
    const mode = S.runMode;

    // The big number follows the mode: coins in coin mode, metres in distance mode
    const sc = scoreOf(mode, run);
    const dm = C.metersOf(run.distance);
    if (sc !== S.hudScore) {
      S.hudScore = sc;
      $('hudScore').textContent = sc;
    }
    if (dm !== S.hudDist) {
      S.hudDist = dm;
      $('hudDist').textContent = dm + ' m';
    }
    if (force) {
      $('hudUnit').textContent = unitOf(mode);
      $('hudMode').textContent = modeNameOf(mode);
    }

    // Speed / rank / best read from the local board, so do not touch it every
    // frame: refresh when a coin is collected, plus a 0.4 s safety tick.
    const now = window.performance && performance.now ? performance.now() : Date.now();
    if (force || run.coinsGot !== S.hudCoins || now - hudSideT > 400) {
      hudSideT = now;
      S.hudCoins = run.coinsGot;
      $('hudCoins').textContent = run.coinsGot;
      $('hudSpeed').textContent = speedLabel(run.passed);
      const st = B.stats(S.seed, mode);
      $('hudPB').textContent = st.best || 0;
      const list = B.top(S.seed, mode, 999, true);
      const mine = list.filter((e) => e.score > sc).length;
      $('hudRank').textContent = I18N.t('hud.rankOf', { n: mine + 1 });
    }

    // Biome and tunnel progress can change on any frame: compare the text first
    const b = biomeOf(run);
    const bt = I18N.biomeName(b) + (run.tunnelFlash > 0 ? ' · ' + I18N.t('hud.newArea') : '');
    if (bt !== S.hudBiome) {
      S.hudBiome = bt;
      $('hudBiome').textContent = bt;
    }
    const left = tunnelLeft(run);
    const tt =
      left < 0 ? I18N.t('hud.tunnelNone') : I18N.t(left <= 6 ? 'hud.tunnelNear' : 'hud.tunnelFar', { n: left });
    if (tt !== S.hudTunnel) {
      S.hudTunnel = tt;
      $('hudTunnel').textContent = tt;
    }
    $('hudRestarts').textContent = S.restarts;
  }

  /* ---------------- drawing ---------------- */
  const PIPE_STYLE = C.CFG.pipeStyles;

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function hillLine(baseY, amp, freq, offset, color) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const wx = x + offset;
      const y = baseY - amp * (Math.sin(wx * freq) * 0.6 + Math.sin(wx * freq * 2.7 + 1.3) * 0.4);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawTree(x, y, s, color) {
    ctx.fillStyle = '#2a1d12';
    ctx.fillRect(x - 2 * s, y - 10 * s, 4 * s, 12 * s);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - 34 * s);
    ctx.lineTo(x + 11 * s, y - 8 * s);
    ctx.lineTo(x - 11 * s, y - 8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - 46 * s);
    ctx.lineTo(x + 8 * s, y - 24 * s);
    ctx.lineTo(x - 8 * s, y - 24 * s);
    ctx.closePath();
    ctx.fill();
  }

  /* Mid-ground scenery: the shape follows the biome (tree / cactus / pine / rock / star) */
  function drawDeco(x, y, s, kind, color) {
    if (kind === 'cactus') {
      ctx.fillStyle = color;
      roundRect(x - 3 * s, y - 26 * s, 6 * s, 26 * s, 3 * s);
      ctx.fill();
      roundRect(x - 11 * s, y - 20 * s, 9 * s, 5 * s, 2.5 * s);
      ctx.fill();
      roundRect(x - 11 * s, y - 20 * s, 5 * s, 12 * s, 2.5 * s);
      ctx.fill();
      return;
    }
    if (kind === 'pine') {
      ctx.fillStyle = '#4a3a2c';
      ctx.fillRect(x - 1.6 * s, y - 9 * s, 3.2 * s, 10 * s);
      ctx.fillStyle = color;
      for (let k = 0; k < 3; k++) {
        const w = (13 - k * 3) * s;
        const base = y - 8 * s - k * 11 * s;
        ctx.beginPath();
        ctx.moveTo(x, base - 15 * s);
        ctx.lineTo(x + w, base);
        ctx.lineTo(x - w, base);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    if (kind === 'rock') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 14 * s, y);
      ctx.lineTo(x - 5 * s, y - 16 * s);
      ctx.lineTo(x + 4 * s, y - 9 * s);
      ctx.lineTo(x + 13 * s, y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (kind === 'star') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y - 22 * s, 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x + 7 * s, y - 34 * s, 1.7 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    drawTree(x, y, s, color);
  }

  function drawWorld() {
    const p = palOf(S.run);
    const dist = S.run ? S.run.distance : 0;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, FLOOR_Y);

    // Sun / moon
    const sunY = 130 + Math.sin(Date.now() / 4200) * 6;
    ctx.beginPath();
    ctx.arc(W - 92, sunY, 36, 0, Math.PI * 2);
    ctx.fillStyle = p.sun;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Clouds
    ctx.fillStyle = p.cloud;
    for (let i = 0; i < 5; i++) {
      const cx = ((((i * 137 - dist * 0.06) % (W + 120)) + W + 120) % (W + 120)) - 60;
      const cy = 70 + ((i * 53) % 130);
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.arc(cx + 20, cy + 4, 15, 0, Math.PI * 2);
      ctx.arc(cx - 20, cy + 5, 13, 0, Math.PI * 2);
      ctx.fill();
    }

    // Three parallax hill layers + biome scenery
    hillLine(FLOOR_Y - 66, 26, 0.0085, dist * 0.1, p.far);
    for (let i = 0; i < 14; i++) {
      const x = ((((i * 82 - dist * 0.1) % (W + 160)) + W + 160) % (W + 160)) - 80;
      drawDeco(x, FLOOR_Y - 58, 0.5, p.deco, p.decoColor);
    }
    hillLine(FLOOR_Y - 40, 20, 0.0122, dist * 0.22, p.mid);
    for (let i = 0; i < 12; i++) {
      const x = ((((i * 96 - dist * 0.22) % (W + 180)) + W + 180) % (W + 180)) - 90;
      drawDeco(x, FLOOR_Y - 30, 0.68, p.deco, p.decoColor);
    }
    hillLine(FLOOR_Y - 16, 14, 0.016, dist * 0.42, p.near);
    for (let i = 0; i < 10; i++) {
      const x = ((((i * 118 - dist * 0.42) % (W + 200)) + W + 200) % (W + 200)) - 100;
      drawDeco(x, FLOOR_Y - 6, 0.9, p.deco, p.decoDark);
    }
  }

  /* Pipe tunnel: a shell top and bottom with a straight duct in between.
   * Only a short slab at the entrance is a hard wall (you must fly it
   * precisely); inside, the walls are soft — resting against one is safe. */
  function drawTunnel(ob, sh) {
    const x = sh.x;
    const w = sh.w;
    const top = sh.gapY;
    const bot = sh.lowerTop;
    // The whole pipe shares one origin so the reinforcement rings line up section by section
    const base = x - (ob.seg || 0) * C.PIPE.spacing;

    function shell(y0, y1, innerAtBottom) {
      const h = y1 - y0;
      if (h <= 0) return;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      if (innerAtBottom) {
        g.addColorStop(0, '#191d24');
        g.addColorStop(0.6, '#2f3743');
        g.addColorStop(1, '#5a6778');
      } else {
        g.addColorStop(0, '#5a6778');
        g.addColorStop(0.4, '#2f3743');
        g.addColorStop(1, '#191d24');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y0, w, h);

      // Reinforcement rings every 46 px from the pipe origin, continuous across sections
      const k0 = Math.ceil((x - base) / 46);
      for (let k = k0; ; k++) {
        const rx = base + k * 46;
        if (rx >= x + w - 8) break;
        if (rx < x) continue;
        ctx.fillStyle = 'rgba(255,255,255,.075)';
        ctx.fillRect(rx, y0, 10, h);
        ctx.fillStyle = 'rgba(0,0,0,.32)';
        ctx.fillRect(rx + 10, y0, 2, h);
        // Bolts on the ring
        const by = innerAtBottom ? y1 - 14 : y0 + 14;
        ctx.beginPath();
        ctx.arc(rx + 5, by, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = '#9fadc0';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rx + 5.8, by + 0.8, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.fill();
      }

      // Bright lip on the duct side plus a dark groove — the highlight of a metal bore
      ctx.fillStyle = '#8e9cb0';
      ctx.fillRect(x, innerAtBottom ? y1 - 4 : y0, w, 4);
      ctx.fillStyle = 'rgba(0,0,0,.34)';
      ctx.fillRect(x, innerAtBottom ? y1 - 6 : y0 + 4, w, 2);
    }

    shell(0, top, true);
    shell(bot, FLOOR_Y, false);

    // Entrance / exit flanges: blue at the entrance (fly it precisely), gold at
    // the exit (step through and the biome changes)
    function flange(bx, y0, y1, innerAtBottom, tint) {
      const h = y1 - y0;
      if (h <= 0) return;
      const g = ctx.createLinearGradient(bx, 0, bx + 22, 0);
      g.addColorStop(0, '#6f7d90');
      g.addColorStop(0.45, '#c6d0df');
      g.addColorStop(1, '#65717f');
      ctx.fillStyle = g;
      ctx.fillRect(bx, y0, 22, h);
      ctx.strokeStyle = 'rgba(16,20,28,.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, y0 + 1, 20, h - 2);
      ctx.fillStyle = tint;
      ctx.fillRect(bx, innerAtBottom ? y1 - 5 : y0, 22, 5);
    }
    if (ob.tunnelHead || ob.tunnelExit) {
      const tint = ob.tunnelExit ? 'rgba(255,220,140,.9)' : 'rgba(180,225,255,.9)';
      flange(x, 0, top, true, tint);
      flange(x, bot, FLOOR_Y, false, tint);
    }

    // Duct outline: entrance / exit glow, the middle is soft wall and drawn softer
    const bright = ob.tunnelHead || ob.tunnelExit;
    ctx.strokeStyle = ob.tunnelExit
      ? 'rgba(255,220,140,.8)'
      : ob.tunnelHead
        ? 'rgba(180,225,255,.8)'
        : 'rgba(150,180,215,.22)';
    ctx.lineWidth = bright ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(x, sh.gapY);
    ctx.lineTo(x + w, sh.gapY);
    ctx.moveTo(x, sh.lowerTop);
    ctx.lineTo(x + w, sh.lowerTop);
    ctx.stroke();

    // Caption: the entrance must be flown precisely, inside the walls are soft
    const midY = sh.gapY + sh.gap / 2 + 4;
    ctx.textAlign = 'center';
    if (ob.tunnelHead) {
      ctx.fillStyle = 'rgba(255,240,190,.9)';
      ctx.font = 'bold 12px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(I18N.t('canvas.tunnelEntry'), x + C.PIPE.w / 2, midY - 14);
      ctx.fillStyle = 'rgba(215,235,255,.75)';
      ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(I18N.t('canvas.tunnelAim'), x + C.PIPE.w / 2, midY + 2);
    } else if (!ob.tunnelExit) {
      ctx.fillStyle = 'rgba(215,235,255,.34)';
      ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(I18N.t('canvas.tunnelInside'), x + w / 2, midY);
    }
    ctx.textAlign = 'left';
  }

  /* Twin gate: one wall with two openings and a slab in between — take either one */
  function drawTwin(ob, sh) {
    const st = PIPE_STYLE.twin;
    const x = sh.x;
    const w = C.PIPE.w;
    const y1 = sh.gapY;
    const y2 = sh.gap2Y;
    const slabs = [
      [0, y1],
      [y1 + sh.gap, y2],
      [y2 + sh.gap2, FLOOR_Y]
    ];
    for (let k = 0; k < slabs.length; k++) {
      const h = slabs[k][1] - slabs[k][0];
      if (h <= 0) continue;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, st.dark);
      g.addColorStop(0.26, st.body);
      g.addColorStop(0.64, st.body);
      g.addColorStop(1, st.dark);
      ctx.fillStyle = g;
      ctx.fillRect(x + 4, slabs[k][0], w - 8, h);
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.fillRect(x + 12, slabs[k][0], 6, h);
      // Bright lip on every opening (one above and one below each)
      for (const edge of [slabs[k][0], slabs[k][1]]) {
        ctx.fillStyle = st.cap;
        ctx.fillRect(x, edge - 4, w, 8);
      }
    }
    // An inward arrow on each opening: both lanes are open
    ctx.strokeStyle = 'rgba(230,240,255,.55)';
    ctx.lineWidth = 2;
    for (const lane of [y1 + sh.gap / 2, y2 + sh.gap2 / 2]) {
      ctx.beginPath();
      ctx.moveTo(x - 14, lane - 6);
      ctx.lineTo(x - 6, lane);
      ctx.lineTo(x - 14, lane + 6);
      ctx.stroke();
    }
  }

  /* Saw blade (shared by the track saw and the orbiting saw): tooth radius = collision radius */
  function drawSaw(cx, cy, r, spin) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.fillStyle = '#c8ccc9';
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 9), Math.sin(a) * (r - 9));
      ctx.lineTo(Math.cos(a + 0.16) * r, Math.sin(a + 0.16) * r);
      ctx.lineTo(Math.cos(a + 0.32) * (r - 9), Math.sin(a + 0.32) * (r - 9));
      ctx.closePath();
      ctx.fill();
    }
    const g = ctx.createRadialGradient(-6, -6, 4, 0, 0, r - 4);
    g.addColorStop(0, '#e07a5f');
    g.addColorStop(1, '#b14a35');
    ctx.beginPath();
    ctx.arc(0, 0, r - 5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#7c2f22';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#5c5c5c';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /* Mechanism: pinwheel (a four-armed cross spinning around a hub; fly the safe lanes above / below) */
  function drawPinwheel(ob, sh) {
    const px = sh.px;
    const py = sh.py;
    const R = sh.R || C.PINWHEEL.L;

    // Sweep range (dashed danger circle)
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(px, py, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(sh.angle);
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.rotate((k / 4) * Math.PI * 2);
      const g = ctx.createLinearGradient(0, -C.PINWHEEL.rodR, 0, C.PINWHEEL.rodR);
      g.addColorStop(0, '#8b96a6');
      g.addColorStop(0.5, '#e4eaf3');
      g.addColorStop(1, '#6e7887');
      roundRect(0, -C.PINWHEEL.rodR, R, C.PINWHEEL.rodR * 2, C.PINWHEEL.rodR);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#39424f';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(R - 7, 0, C.PINWHEEL.rodR + 4, 0, Math.PI * 2);
      ctx.fillStyle = '#59616e';
      ctx.fill();
      ctx.strokeStyle = '#2f353e';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Hub
    ctx.beginPath();
    ctx.arc(px, py, C.PINWHEEL.hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#4b5563';
    ctx.fill();
    ctx.strokeStyle = '#262b33';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c9d2de';
    ctx.fill();
  }

  /* Mechanism: orbiting saw (the blade circles a ring track) */
  function drawOrbiter(ob, sh) {
    const px = sh.px;
    const py = sh.py;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.arc(px, py, C.ORBITER.R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,220,255,.26)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    // Pivot + arm
    ctx.strokeStyle = 'rgba(180,200,230,.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(sh.cx, sh.cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#4b5563';
    ctx.fill();
    ctx.strokeStyle = '#262b33';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Blade
    drawSaw(sh.cx, sh.cy, C.ORBITER.sawR, (S.run ? S.run.time : 0) * 11);
  }

  function drawPipe(ob, sh) {
    const st = PIPE_STYLE[ob.type] || PIPE_STYLE.static;
    const x = sh.x;
    const w = C.PIPE.w;
    const capH = 24;

    function stalk(y0, y1, flip) {
      const h = y1 - y0;
      if (h <= 0) return;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, st.dark);
      g.addColorStop(0.28, st.body);
      g.addColorStop(0.62, st.body);
      g.addColorStop(1, st.dark);
      ctx.fillStyle = g;
      ctx.fillRect(x + 5, y0, w - 10, h);
      // Bamboo-style joints
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.lineWidth = 2;
      for (let yy = y0 + 34; yy < y1 - 8; yy += 42) {
        ctx.beginPath();
        ctx.moveTo(x + 5, yy);
        ctx.lineTo(x + w - 5, yy);
        ctx.stroke();
      }
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(x + 12, y0, 6, h);
      // Cap
      const cy = flip ? y1 - capH : y0;
      roundRect(x, cy, w, capH, 7);
      ctx.fillStyle = st.cap;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(x + 6, cy + 4, w - 12, 4);
    }

    stalk(0, sh.gapY, false);
    stalk(sh.lowerTop, FLOOR_Y, true);

    // Type marker
    if (ob.type === 'narrow') {
      ctx.fillStyle = '#5c2626';
      for (let i = 0; i < 6; i++) {
        const tx = x + 6 + i * 11;
        ctx.beginPath();
        ctx.moveTo(tx, sh.gapY);
        ctx.lineTo(tx + 6, sh.gapY);
        ctx.lineTo(tx + 3, sh.gapY + 9);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tx, sh.lowerTop);
        ctx.lineTo(tx + 6, sh.lowerTop);
        ctx.lineTo(tx + 3, sh.lowerTop - 9);
        ctx.closePath();
        ctx.fill();
      }
    } else if (ob.type === 'slider' || ob.type === 'pulse') {
      const midY = sh.gapY + sh.gap / 2;
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 2;
      const dir = ob.type === 'slider' ? (Math.cos((2 * Math.PI * S.run.time) / ob.period + ob.phase) > 0 ? 1 : -1) : 1;
      ctx.beginPath();
      if (ob.type === 'slider') {
        ctx.moveTo(x - 16, midY - 7 * dir);
        ctx.lineTo(x - 16, midY + 7 * dir);
        ctx.lineTo(x - 21, midY + 7 * dir);
        ctx.moveTo(x - 16, midY + 7 * dir);
        ctx.lineTo(x - 11, midY + 7 * dir);
      } else {
        ctx.arc(x + w / 2, midY, sh.gap * 0.44, 0, Math.PI * 2);
      }
      ctx.stroke();
    } else if (ob.type === 'stagger') {
      // Extreme-gate marker: a diamond pointing at the gap
      const midY = sh.gapY + sh.gap / 2;
      ctx.fillStyle = '#e6d7ff';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, midY - 10);
      ctx.lineTo(x + w / 2 + 9, midY - 1);
      ctx.lineTo(x + w / 2, midY + 8);
      ctx.lineTo(x + w / 2 - 9, midY - 1);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* Mechanism 1: track saw (shuttles along a vertical rail, safe lanes above and below) */
  function drawBlade(ob, sh) {
    const x = sh.x;
    const top = ob.cy - ob.amp;
    const bot = ob.cy + ob.amp;

    // Vertical rail
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,40,30,.5)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Mounts at both ends of the rail
    ctx.fillStyle = '#3d4a3d';
    roundRect(x - 9, top - 15, 18, 10, 3);
    ctx.fill();
    roundRect(x - 9, bot + 5, 18, 10, 3);
    ctx.fill();

    // Blade (tooth radius = collision radius, disc slightly smaller)
    drawSaw(x, sh.cy, C.BLADE.r, (S.run ? S.run.time : 0) * 9);
  }

  /* Mechanism 2: pendulum (swings in from the ceiling or the floor; pass on the other lane) */
  function drawSwing(ob, sh) {
    const px = sh.px;
    const py = sh.py;
    const bx = sh.bx;
    const by = sh.by;

    // Anchor
    ctx.fillStyle = '#3d4a3d';
    if (ob.from === 'top') roundRect(px - 16, py - 13, 32, 10, 4);
    else roundRect(px - 16, py + 3, 32, 10, 4);
    ctx.fill();

    // Rod
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a7f7a';
    ctx.lineWidth = C.SWING.rodR * 2 - 4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Weight (radius = collision radius)
    const r = C.SWING.ballR;
    const g = ctx.createRadialGradient(bx - 8, by - 8, 4, bx, by, r);
    g.addColorStop(0, '#9aa2a8');
    g.addColorStop(0.55, '#616a70');
    g.addColorStop(1, '#3c4348');
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#2c3236';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#2c3236';
    ctx.fill();
  }

  /* Mechanism: clamp (safe in the middle) — two toothed jaws reach in from the
   * ceiling and the floor and squeeze toward the middle */
  function drawClamper(ob, sh) {
    const st = PIPE_STYLE.clamper;
    const x = sh.x;
    const w = sh.w || C.PIPE.w;
    const topY = sh.gapY; // lower edge of the upper jaw (= top of the corridor)
    const botY = sh.lowerTop; // upper edge of the lower jaw (= bottom of the corridor)

    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, st.dark);
    g.addColorStop(0.3, st.body);
    g.addColorStop(0.7, st.body);
    g.addColorStop(1, st.dark);
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, Math.max(0, topY));
    ctx.fillRect(x, botY, w, Math.max(0, FLOOR_Y - botY));

    // Teeth on the inner edge: they bite exactly where the jaws close
    ctx.fillStyle = st.cap;
    const n = 6;
    const tw = w / n;
    for (let k = 0; k < n; k++) {
      const tx = x + k * tw;
      ctx.beginPath();
      ctx.moveTo(tx, topY - 13);
      ctx.lineTo(tx + tw / 2, topY);
      ctx.lineTo(tx + tw, topY - 13);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx, botY + 13);
      ctx.lineTo(tx + tw / 2, botY);
      ctx.lineTo(tx + tw, botY + 13);
      ctx.closePath();
      ctx.fill();
    }

    // The safe corridor in the middle: one dashed line + two opposing arrows
    const mid = (topY + botY) / 2;
    ctx.setLineDash([8, 9]);
    ctx.strokeStyle = 'rgba(255,235,190,.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 26, mid);
    ctx.lineTo(x + w + 26, mid);
    ctx.stroke();
    ctx.setLineDash([]);

    const cx = x - 30;
    ctx.strokeStyle = 'rgba(255,235,190,.6)';
    ctx.lineWidth = 2.4;
    for (const dir of [-1, 1]) {
      const ay = mid + dir * 30;
      ctx.beginPath();
      ctx.moveTo(cx - 7, ay - dir * 7);
      ctx.lineTo(cx, ay);
      ctx.lineTo(cx + 7, ay - dir * 7);
      ctx.stroke();
    }
  }

  /* Mechanism: twin blade (safe in the middle) — two saws oscillate toward each
   * other along vertical rails with a corridor in between */
  function drawTwinBlade(ob, sh) {
    const x = sh.x;
    const R = C.TWINBLADE.sawR;
    const spin = (S.run ? S.run.time : 0) * 9;
    const top = sh.cy - ob.half - ob.centerAmp - R - 18;
    const bot = sh.cy + ob.half + ob.centerAmp + R + 18;

    // Vertical rail
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,36,34,.45)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#3d4a42';
    roundRect(x - 9, top - 14, 18, 10, 3);
    ctx.fill();
    roundRect(x - 9, bot + 4, 18, 10, 3);
    ctx.fill();

    // Corridor (the safe belt between the inner edges of the two saws)
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(x - 30, sh.gapY, 60, sh.gap);
    ctx.setLineDash([8, 9]);
    ctx.strokeStyle = 'rgba(255,235,190,.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 42, sh.gapY);
    ctx.lineTo(x + 42, sh.gapY);
    ctx.moveTo(x - 42, sh.gapY + sh.gap);
    ctx.lineTo(x + 42, sh.gapY + sh.gap);
    ctx.stroke();
    ctx.setLineDash([]);

    // The two saws spin against each other
    drawSaw(x, sh.topY, R, spin);
    drawSaw(x, sh.botY, R, -spin);
  }

  /* Mechanism: twin pendulum (safe in the middle) — one long pendulum from the
   * ceiling and one from the floor, leaving a straight corridor down the middle */
  function drawMidSwing(ob, sh) {
    const x = sh.x;

    // Two anchors
    ctx.fillStyle = '#3d4a3d';
    roundRect(x - 17, sh.pt - 12, 34, 10, 4);
    ctx.fill();
    roundRect(x - 17, sh.pb + 2, 34, 10, 4);
    ctx.fill();

    // Corridor (a fixed safe belt)
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(x - 34, sh.gapY, 68, sh.gap);
    ctx.setLineDash([8, 9]);
    ctx.strokeStyle = 'rgba(255,235,190,.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 46, sh.gapY);
    ctx.lineTo(x + 46, sh.gapY);
    ctx.moveTo(x - 46, sh.lowerTop);
    ctx.lineTo(x + 46, sh.lowerTop);
    ctx.stroke();
    ctx.setLineDash([]);

    // Two rods + two weights (radius = collision radius)
    const rod = (py, bx, by) => {
      ctx.strokeStyle = '#7a7f7a';
      ctx.lineWidth = C.MIDSWING.rodR * 2 - 4;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    const ball = (bx, by) => {
      const r = C.MIDSWING.ballR;
      const g = ctx.createRadialGradient(bx - 8, by - 8, 4, bx, by, r);
      g.addColorStop(0, '#9aa2a8');
      g.addColorStop(0.55, '#616a70');
      g.addColorStop(1, '#3c4348');
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#2c3236';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#2c3236';
      ctx.fill();
    };
    ctx.lineCap = 'round';
    rod(sh.pt, sh.b1x, sh.b1y);
    rod(sh.pb, sh.b2x, sh.b2y);
    ctx.lineCap = 'butt';
    ball(sh.b1x, sh.b1y);
    ball(sh.b2x, sh.b2y);
  }

  /* Coins */
  function drawCoins() {
    const run = S.run;
    if (!run) return;
    for (let i = 0; i < run.coins.length; i++) {
      const c = run.coins[i];
      if (c.got) continue;
      const x = c.worldX - run.distance;
      if (x > W + 30) break; // coins are sorted by worldX
      if (x < -30) continue;
      const pos = C.coinPos(c, run.course, run.distance, run.time);
      const bob = Math.sin(run.time * 3 + c.id * 1.7) * 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + bob, C.COIN.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f2c94c';
      ctx.fill();
      ctx.strokeStyle = '#a97b16';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + bob, C.COIN.r - 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(138,95,16,.75)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Spinning highlight
      const a = run.time * 2.2 + c.id;
      ctx.beginPath();
      ctx.arc(pos.x + Math.cos(a) * 4.5, pos.y + bob + Math.sin(a) * 4.5, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,250,220,.95)';
      ctx.fill();
    }
  }

  function drawBird() {
    const run = S.run;
    const y = run ? run.y : H * 0.4;
    const vy = run ? run.vy : 0;
    const x = C.BIRD.x;
    const rot = Math.max(-0.52, Math.min(0.95, Math.atan2(vy, 340) * 0.7));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    // Body
    const g = ctx.createLinearGradient(-14, -14, 12, 16);
    g.addColorStop(0, '#ffe27a');
    g.addColorStop(0.55, '#f2d24b');
    g.addColorStop(1, '#d99a25');
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 12.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,10,.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Wing
    const wing = Math.sin((1 - S.flapAnim) * Math.PI) * 0.9;
    ctx.save();
    ctx.translate(-3, 1);
    ctx.rotate(-wing * 0.9 - 0.15);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9.5, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e0a92c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,10,.3)';
    ctx.stroke();
    ctx.restore();

    // Eye
    ctx.beginPath();
    ctx.arc(6.5, -4.2, 4.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7.8, -4.2, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = '#20260f';
    ctx.fill();

    // Beak
    ctx.beginPath();
    ctx.moveTo(12, 0.5);
    ctx.lineTo(21, 3.4);
    ctx.lineTo(12, 6.6);
    ctx.closePath();
    ctx.fillStyle = '#ef7d2a';
    ctx.fill();

    ctx.restore();
  }

  function drawGround() {
    const p = palOf(S.run);
    const dist = S.run ? S.run.distance : 0;
    const g = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    g.addColorStop(0, p.grass1);
    g.addColorStop(1, p.grass2);
    ctx.fillStyle = g;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(0, FLOOR_Y, W, 5);
    // Grass tufts
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = ((((i * 23 - dist) % (W + 40)) + W + 40) % (W + 40)) - 20;
      const y = FLOOR_Y + 18 + ((i * 37) % 46);
      ctx.beginPath();
      ctx.moveTo(x, y + 8);
      ctx.lineTo(x + 3, y);
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (let i = 0; i < S.particles.length; i++) {
      const p = S.particles[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07130d';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    if (S.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 9 * S.shake, (Math.random() - 0.5) * 9 * S.shake);
    }

    drawWorld();

    if (S.run) {
      const run = S.run;
      // Tunnel walls run all the way to the next section, so preload one extra
      // gate backwards to keep the bore from flickering empty
      const from = Math.max(0, run.nextGate - 2);
      for (let i = from; i < run.course.length; i++) {
        const ob = run.course[i];
        if (ob.worldX - run.distance > W + 320) break; // pendulums reach far, preload one more gate
        const sh = C.obstacleShape(ob, run.distance, run.time);
        if (ob.type === 'swing') {
          if (sh.px + C.SWING.L < -60) continue;
        } else if (ob.type === 'blade') {
          if (sh.x + C.BLADE.r < -40) continue;
        } else if (ob.type === 'pinwheel') {
          if (sh.x + (sh.R || C.PINWHEEL.L) + 30 < -40) continue;
        } else if (ob.type === 'orbiter') {
          if (sh.x + C.ORBITER.R + C.ORBITER.sawR < -40) continue;
        } else if (ob.type === 'twinblade') {
          if (sh.x + C.TWINBLADE.sawR < -40) continue;
        } else if (ob.type === 'midswing') {
          if (sh.x + 8 + C.MIDSWING.L + C.MIDSWING.ballR < -40) continue;
        } else if (sh.x + sh.w < -40) continue;

        if (ob.type === 'blade') drawBlade(ob, sh);
        else if (ob.type === 'swing') drawSwing(ob, sh);
        else if (ob.type === 'pinwheel') drawPinwheel(ob, sh);
        else if (ob.type === 'orbiter') drawOrbiter(ob, sh);
        else if (ob.type === 'twin') drawTwin(ob, sh);
        else if (ob.type === 'tunnel') drawTunnel(ob, sh);
        else if (ob.type === 'clamper') drawClamper(ob, sh);
        else if (ob.type === 'twinblade') drawTwinBlade(ob, sh);
        else if (ob.type === 'midswing') drawMidSwing(ob, sh);
        else drawPipe(ob, sh);
      }
      drawCoins();
      drawGround();
      drawBird();
    } else {
      drawGround();
      // Let the bird hover in the menu
      const t = Date.now() / 620;
      ctx.save();
      ctx.translate(0, Math.sin(t) * 9);
      drawBirdAt(C.BIRD.x, H * 0.42, Math.cos(t) * 60);
      ctx.restore();
    }

    drawParticles();

    if (S.goFlash > 0) {
      ctx.globalAlpha = Math.min(1, S.goFlash * 1.6);
      ctx.fillStyle = '#ffeaa0';
      ctx.font = 'bold 54px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FLY!', W / 2, H * 0.42);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    // Passed a tunnel -> biome banner
    if (S.run && S.run.tunnelFlash > 0) {
      const total = C.TUNNEL.flash;
      const fadeIn = Math.min(1, (total - S.run.tunnelFlash) / 0.35);
      const fadeOut = Math.min(1, S.run.tunnelFlash / 0.7);
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,20,14,.55)';
      roundRect(W / 2 - 132, H * 0.24 - 40, 264, 64, 14);
      ctx.fill();
      ctx.fillStyle = '#ffeaa0';
      ctx.font = 'bold 30px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(I18N.t('canvas.newBiome', { biome: I18N.biomeName(biomeOf(S.run)) }), W / 2, H * 0.24);
      ctx.fillStyle = 'rgba(235,245,225,.8)';
      ctx.font = '13px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(I18N.t('canvas.newBiomeSub'), W / 2, H * 0.24 + 20);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    if (S.flash > 0) {
      ctx.fillStyle = 'rgba(255,90,90,' + S.flash * 0.42 + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  // Decorative bird in the menu (does not touch the simulation)
  function drawBirdAt(x, y, vy) {
    const keep = S.run;
    S.run = { y: y, vy: vy };
    drawBird();
    S.run = keep;
  }

  /* ---------------- menu ---------------- */
  function seedCode(seed) {
    return 'FLPY-' + (seed >>> 0).toString(36).toUpperCase();
  }

  function parseSeed(text) {
    const s = String(text || '').trim();
    if (!s) return 0;
    const m = s.toUpperCase().match(/^FLPY-([0-9A-Z]+)$/);
    if (m) return parseInt(m[1], 36) >>> 0;
    if (/^\d{5,10}$/.test(s)) return Number(s) >>> 0;
    return C.seedFromString(s);
  }

  function renderMenu() {
    const mode = S.mode;
    const unit = unitOf(mode);
    const st = B.stats(S.seed, mode);
    $('seedLabel').textContent = seedCode(S.seed);
    $('menuBest').textContent = (st.best || 0) + ' ' + unit;
    $('menuAttempts').textContent = st.attempts;
    $('modeHint').textContent = B.modeOf(mode).hint;
    syncModeButtons();
    const h = st.history.slice(0, 8).reverse();
    $('menuHistory').innerHTML = h.length
      ? h.map((v) => `<span class="chip">${v} ${unit}</span>`).join('')
      : '<span class="dim">' + I18N.t('menu.emptyHistory') + '</span>';
    const list = B.top(S.seed, mode, 3, true);
    $('menuTop3').innerHTML = list
      .map(
        (e) =>
          `<li><b>${e.rank}</b><span>${e.name}${
            e.demo ? ' <i class="tag">' + I18N.t('menu.rival') + '</i>' : ''
          }</span><em>${e.score} ${unit}</em></li>`
      )
      .join('');
  }

  // Mode switching: in the menu it picks "what the next run scores", on the
  // leaderboard it picks "which board to look at"
  function setMode(m) {
    S.mode = B.modeOf(m).key;
    syncModeButtons();
    if (S.scene === 'board') renderBoard();
    if (!S.run) renderMenu();
  }

  function syncModeButtons() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === S.mode);
    });
  }

  /* ---------------- result screen ---------------- */
  function deathText() {
    const run = S.run;
    if (!run) return '—';
    if (run.deadReason === 'floor') return I18N.t('death.floor');
    if (run.deadReason === 'ceiling') return I18N.t('death.ceiling');
    if (run.deadType === 'blade') return I18N.t('death.blade');
    if (run.deadType === 'swing') return I18N.t('death.swing');
    if (run.deadType === 'pinwheel') return I18N.t('death.pinwheel');
    if (run.deadType === 'orbiter') return I18N.t('death.orbiter');
    if (run.deadType === 'clamper') return I18N.t('death.clamper');
    if (run.deadType === 'twinblade') return I18N.t('death.twinblade');
    if (run.deadType === 'midswing') return I18N.t('death.midswing');
    if (run.deadType === 'twin') return I18N.t('death.twin');
    if (run.deadType === 'tunnel') return I18N.t('death.tunnel');
    return I18N.t('death.pipe');
  }

  function renderOver() {
    const r = S.lastResult;
    if (!r) return;
    const payload = r.payload;
    const res = r.res;
    const mode = payload.mode;
    const unit = unitOf(mode);

    $('overScore').textContent = payload.score;
    $('overUnit').textContent = unit;
    $('overMode').textContent = modeNameOf(mode) + ' · ' + B.modeOf(mode).board;

    const dm = C.metersOf(payload.distance);
    const coins = payload.coins || 0;
    $('overDist').textContent = dm + ' m';
    $('overCoins').textContent = coins + ' ' + I18N.t('mode.coin.unit');

    const badge = $('overBadge');
    if (res.isPB) {
      badge.textContent = I18N.t('over.badgePB');
      badge.className = 'badge gold';
    } else if (res.first) {
      badge.textContent = I18N.t('over.badgeFirst', { best: res.myScore || 0, unit: unit });
      badge.className = 'badge hot';
    } else if (res.prevBest && res.prevBest > payload.score && res.prevBest - payload.score <= 2) {
      badge.textContent = I18N.t('over.badgeClose', { n: res.prevBest - payload.score, unit: unit });
      badge.className = 'badge hot';
    } else {
      badge.textContent = I18N.t('over.badgeKeep', { best: res.prevBest || 0, unit: unit });
      badge.className = 'badge';
    }

    $('overRank').textContent = I18N.t('over.rankLine', {
      rank: Math.max(1, res.rank),
      total: res.total
    });
    const diff = $('overDiff');
    if (res.diffToPrev !== null && res.diffToPrev > 0) {
      diff.textContent = I18N.t('over.diffPrev', { n: res.diffToPrev, unit: unit, name: res.aheadName });
      diff.className = 'diff';
    } else if (res.diffToNext !== null && res.diffToNext > 0) {
      diff.textContent = I18N.t('over.diffNext', { n: res.diffToNext, unit: unit, name: res.behindName });
      diff.className = 'diff ok';
    } else {
      diff.textContent = I18N.t('over.diffFirst');
      diff.className = 'diff ok';
    }

    $('overReason').textContent = deathText();
    $('overTime').textContent = (payload.ticks / C.TICK_HZ).toFixed(1) + 's';
    $('overRestarts').textContent = S.restarts;
  }

  /* ---------------- leaderboard panel ---------------- */
  function renderBoard() {
    const mode = S.mode;
    const m = B.modeOf(mode);
    $('boardTitle').textContent = m.board + ' · ' + seedCode(S.seed);
    syncModeButtons();
    const st = B.stats(S.seed, mode);
    $('boardStats').textContent = I18N.t('board.stats', {
      hint: m.hint,
      attempts: st.attempts,
      best: st.best || 0,
      unit: m.unit
    });
    const list = B.top(S.seed, mode, 20, true);
    $('boardList').innerHTML =
      list
        .map(
          (e) =>
            '<li class="' +
            (!e.demo ? 'mine' : '') +
            '">' +
            '<span class="rk">' +
            e.rank +
            '</span>' +
            '<span class="nm">' +
            e.name +
            (e.demo ? ' <i class="tag">' + I18N.t('menu.rival') + '</i>' : '') +
            '</span>' +
            '<span class="sc">' +
            e.score +
            ' ' +
            m.unit +
            '</span>' +
            '<span class="tm">' +
            ((e.timeMs || 0) / 1000).toFixed(1) +
            's</span>' +
            '</li>'
        )
        .join('') || '<li class="dim">' + I18N.t('board.empty') + '</li>';
    $('boardRemote').textContent = B.remote.enabled
      ? I18N.t('board.remoteOn', { base: B.remote.base })
      : I18N.t('board.remoteOff');
    $('boardName').value = B.me().name;
  }

  /* ---------------- event binding ---------------- */
  function bind() {
    $('btnStart').addEventListener('click', () => {
      startRun(S.seed);
      S.restarts = 0;
    });
    $('btnNewSeed').addEventListener('click', () => {
      startRun(C.nextSeed());
      S.restarts = 0;
    });
    $('btnNewSeed2').addEventListener('click', () => {
      startRun(C.nextSeed());
      S.restarts = 0;
    });
    $('btnCopySeed').addEventListener('click', () => {
      const code = seedCode(S.seed);
      const text = I18N.t('share.text', {
        code: code,
        what: I18N.t(S.mode === 'distance' ? 'share.distance' : 'share.coin')
      });
      if (navigator.clipboard)
        navigator.clipboard
          .writeText(text)
          .then(() => toast(I18N.t('toast.seedCopied', { code: code })))
          .catch(() => toast(code));
      else toast(code);
    });
    $('btnUseSeed').addEventListener('click', () => {
      const seed = parseSeed($('seedInput').value);
      if (!seed) {
        toast(I18N.t('toast.badSeed'));
        return;
      }
      startRun(seed);
      S.restarts = 0;
    });
    $('btnBoardMenu').addEventListener('click', () => {
      S.scene = 'board';
      renderBoard();
      show('board');
    });
    $('btnBoardOver').addEventListener('click', () => {
      S.mode = S.runMode; // coming from the result screen, show the mode you just flew
      S.scene = 'board';
      renderBoard();
      show('board');
    });
    $('btnBoardClose').addEventListener('click', () => {
      hide('board');
      if (S.lastResult) {
        S.scene = 'over';
        show('over');
      } else toMenu();
    });
    $('btnNameSave').addEventListener('click', () => {
      B.setName($('boardName').value);
      toast(I18N.t('toast.nameSaved'));
      renderBoard();
    });
    $('btnRestart').addEventListener('click', restart);
    $('btnMenu').addEventListener('click', toMenu);
    $('btnResume').addEventListener('click', resume);
    $('btnQuit').addEventListener('click', toMenu);
    // Mode buttons (one set in the menu, one on the leaderboard panel)
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    // God switch (local testing only); blur it afterwards so a later Space does not toggle it back
    $('btnGod').addEventListener('click', () => {
      setGod(!S.god);
      $('btnGod').blur();
    });
    // Language switch: the static markup is refilled by i18n, the dynamic
    // strings are refreshed by the onChange listener below
    $('langBtn').addEventListener('click', () => {
      I18N.toggle();
      $('langBtn').blur();
    });
    I18N.onChange(() => {
      S.hudScore = -1;
      S.hudDist = -1;
      S.hudCoins = -1;
      S.hudBiome = '';
      S.hudTunnel = '';
      syncGodBtn();
      if (S.scene === 'playing') updateHud(true);
      else if (S.scene === 'menu') renderMenu();
      else if (S.scene === 'over') renderOver();
      else if (S.scene === 'board') renderBoard();
    });
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------------- boot ---------------- */
  I18N.set(I18N.detect(), true); // restore the stored language (English by default) without notifying
  resize();
  bind();
  syncGodBtn();
  renderMenu();
  show('menu');
  requestAnimationFrame(loop);

  // Exposed for the console, for debugging and for wiring up a backend later
  window.FlappyGame = {
    start: startRun,
    restart: restart,
    state: S,
    seedCode: seedCode,
    parseSeed: parseSeed
  };
})();
