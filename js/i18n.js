/* ============================================================
 * Simple Flappy Bird — i18n
 * ------------------------------------------------------------
 * Every piece of user-visible text in one place, in English and
 * Chinese.
 *
 * The starting language is `config.js` -> `i18n.defaultLang` (English out
 * of the box). The browser's own locale is deliberately NOT sniffed: an
 * English-first open-source demo should look the same to everyone until
 * they press the switch themselves. An explicit choice made with that
 * switch is stored in localStorage and wins from then on.
 *
 * Usage
 *   FlappyI18n.t('hud.distance')                  -> "Distance"
 *   FlappyI18n.t('hud.rankOf', { n: 3 })          -> "Rank 3"
 *   FlappyI18n.set('zh')                           -> switch + re-render
 *   FlappyI18n.apply(document)                     -> fill the DOM
 *
 * The DOM is filled through attributes:
 *   data-i18n         textContent
 *   data-i18n-html    innerHTML
 *   data-i18n-list    innerHTML from an array of strings (rendered as <li>)
 *   data-i18n-ph      placeholder
 *   data-i18n-title   title
 *
 * Works in the browser (window.FlappyI18n) and in Node
 * (require('./i18n.js')) so config-independent tooling keeps working.
 * ============================================================ */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const CFG = isNode ? require('./config.js') : root.FlappyConfig;
  const api = factory(CFG);
  if (isNode) module.exports = api;
  else root.FlappyI18n = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CFG) {
  'use strict';

  const LANGS = ['en', 'zh'];
  const CONFIGURED = CFG && CFG.i18n && CFG.i18n.defaultLang;
  const DEFAULT_LANG = LANGS.indexOf(CONFIGURED) >= 0 ? CONFIGURED : 'en';
  // v2: the key used to hold an auto-detected locale as well as an explicit
  // choice, so it is bumped to discard those stale auto-written values.
  const STORAGE_KEY = 'flappy.lang.v2';

  /* ================= English ================= */
  const en = {
    'app.title': 'Simple Flappy Bird',
    'brand.name': 'Simple Flappy Bird',
    'brand.tag': 'One life, endless gates, a new biome after every tunnel',

    'lang.button': '中文',
    'lang.title': 'Switch language',

    /* ---------- HUD ---------- */
    'hud.distance': 'Distance',
    'hud.coins': 'Coins',
    'hud.speed': 'Speed',
    'hud.rank': 'Rank',
    'hud.best': 'Best',
    'hud.restarts': 'Restarts',
    'hud.hint': 'Space / tap to flap · R to restart · P to pause',
    'hud.newArea': 'new area',
    'hud.rankOf': 'Rank {n}',
    'hud.tunnelNone': 'Next tunnel —',
    'hud.tunnelNear': 'Tunnel in {n} gates',
    'hud.tunnelFar': 'Tunnel in {n} gates',
    'god.label': 'God',
    'god.on': 'God on',
    'god.off': 'God off',
    'god.title': 'Local testing only: no collision kills while enabled',
    'toast.godOn': 'God mode on — fly straight through obstacles',
    'toast.godOff': 'God mode off — collisions count again',

    /* ---------- menu ---------- */
    'menu.sub': 'One life, endless gates, a new biome after every tunnel',
    'menu.trackLength': 'Track',
    'menu.trackInfinite': 'Endless (until you crash)',
    'menu.bestHere': 'Best here',
    'menu.attemptsHere': 'Attempts',
    'menu.seedLabel': 'Track code',
    'menu.copy': 'Copy',
    'menu.newSeed': 'New track',
    'menu.seedPlaceholder': 'Paste a track code to fly the very same track',
    'menu.run': 'Fly',
    'menu.top3': 'Top 3 on this track',
    'menu.history': 'Recent runs',
    'menu.emptyHistory': 'No runs in this mode yet — go fly one',
    'menu.start': 'Start (Space)',
    'menu.viewBoard': 'Leaderboard',
    'menu.rival': 'rival',
    'toast.seedCopied': 'Track code copied: {code}',
    'toast.badSeed': 'That track code makes no sense',
    'toast.nameSaved': 'Nickname saved',
    'share.text': 'Come fly this Flappy track: {code} ({what})',
    'share.coin': 'most coins wins',
    'share.distance': 'farthest wins',

    /* ---------- gameplay help ---------- */
    'help.summary': 'How to play / what the coins and mechanisms are',
    'help.items': [
      'Tap to flap. Hitting a gate, a mechanism, the tunnel entrance, the ground or the ceiling ends the run. Inside a tunnel the walls are soft, so brushing them is safe.',
      '<b>Two modes, two boards.</b> Pick one in the <b>main menu</b> before you start: <b>Coin mode</b> scores the coins you collect, <b>Distance mode</b> scores how far you fly (1 m = 40 px, starting speed about 4.2 m/s, one gate is 7.5 m). Each track code keeps a separate board per mode, so ranks never mix. The big number in the HUD is whatever your current mode scores; the line below it tracks distance and coins at the same time.',
      'Gates are <b>endless</b> — there is no finish line, you fly until you crash. A name takes <b>one row</b> on a board: the same nickname keeps only its best run, and a worse run leaves the board untouched (attempts still count).',
      'Coins are sparse and always sit on a route you can actually fly: 1–2 inside a gate gap, 1–2 on a mechanism safe lane, and only about half of the gate pairs get a curved trail (six shapes: straight / arch / dip / wave / spike / zigzag).',
      '<b>Green</b> standard gate · <b>teal</b> slider (moves up and down, more later) · <b>blue</b> pulse (the gap breathes)',
      '<b>Purple</b> extreme gate (gap pinned to the ceiling or the floor — climb or dive early) · <b>red</b> narrow gate (smallest gap, easiest to clip) · <b>slate</b> twin gate (one wall, two openings — take either one)',
      '<b>Metal tunnel</b>: a solid shell top and bottom with a straight corridor. Each biome is only about 24 pillars (the first tunnel arrives sooner), so one run crosses a dozen tunnels and shows you every mechanism. The bore narrows biome by biome. <b>Only the entrance slab is a deadly wall</b> (the blue flange): once inside, the walls are soft — touching one pushes you back into the duct instead of killing you, so you can rest a moment. The exit glows gold; step through it and the biome changes.',
      '<b>Track saw</b>: rides a vertical rail and never touches the safe lanes above and below.',
      '<b>Pendulum</b>: swings from the ceiling or the floor; pass on the opposite lane.',
      '<b>Pinwheel</b>: a four-armed cross spinning around a hub; fly outside its sweep.',
      '<b>Orbiting saw</b>: a blade circling a ring track, again leaving a safe lane above and below.',
      '<b>Orange clamp</b> (mechanism): two toothed jaws reach in from the top and the bottom and squeeze toward the middle, and <b>the whole pair drifts up and down</b> — the corridor is not fixed, so follow the dashed line. Fully closed it is only as wide as a narrow gate.',
      '<b>Twin blade</b> (mechanism): two saws oscillate toward each other along vertical rails with <b>a corridor in between</b> that slowly drifts and breathes. Track the middle of that corridor.',
      '<b>Twin pendulum</b> (mechanism): one long pendulum from the ceiling and one from the floor sweep both edges away, leaving <b>a straight corridor down the middle</b> that is always safe.',
      '<b>Difficulty ramp</b>: the first 6 gates are plain static pillars. After that every 40 pillars adds a tier, and passing a tunnel jumps one more — <b>20 tiers</b> in total (roughly one every dozen pillars). It unlocks from "gates that only move up and down" all the way to twin gates, narrow gaps, saws, clamps, pinwheels, twin blades, pendulums, twin pendulums and orbiting saws, until everything shows up at once — while every gap tightens and the speed rises. Tier 20 is the ceiling; see how long you last. <b>The third biome (Snowfield) already brings the first mechanisms</b>: the track saw and the pinwheel debut there, starting about a quarter short of full travel and arm length and growing later.',
      '<b>25 biomes</b>: Forest → Desert → Snowfield → Volcano → Star Sea → Bamboo Grove → Swamp → Canyon → Glacier → Badland → Coral Reef → Lava → Thunderstorm → Tundra → Dunes → Mist → Nebula → Aurora → Scorched Land → Salt Lake → Abyss → Cloudland → Wasteland → Crystal → Dawn. Each biome is about 24 pillars (the first is shorter, so new mechanisms arrive quickly) and it only wraps around after all 25.'
    ],
    'about.summary': 'About this local demo',
    'about.items': [
      'A pure front-end local demo. Scores live in your browser localStorage and are never uploaded.',
      'The track is decided by the track code: the same code gives everyone the same gates, mechanisms, tunnels and coins.',
      'The simulation core uses a fixed 120 Hz step, so physics is identical on phones, desktops and every refresh rate.',
      'When you wire up a backend, flip <code>remote.enabled</code> in <code>leaderboard.js</code> to switch to a server board.'
    ],

    /* ---------- result screen ---------- */
    'over.restart': 'One more (R)',
    'over.newSeed': 'New track',
    'over.board': 'Leaderboard',
    'over.menu': 'Main menu',
    'over.mode': 'Mode',
    'over.distance': 'Distance',
    'over.coins': 'Coins collected',
    'over.reason': 'Ended by',
    'over.time': 'Run time',
    'over.restarts': 'Restarts',
    'over.badgePB': '🎉 New record!',
    'over.badgeFirst': 'First run on this board: best {best} {unit}',
    'over.badgeClose': 'Only {n} {unit} short of a record!',
    'over.badgeKeep': 'Best here {best} {unit} (this run did not beat it, the old score stays)',
    'over.rankLine': 'Rank {rank} of {total}',
    'over.diffPrev': 'Grab {n} more {unit} to pass "{name}"',
    'over.diffNext': 'Ahead of "{name}" by {n} {unit} — hold it',
    'over.diffFirst': 'You are number one on this board — defend it',

    /* ---------- pause ---------- */
    'pause.title': 'Paused',
    'pause.sub': 'Switching away pauses automatically; come back and keep flying',
    'pause.resume': 'Resume (P)',
    'pause.quit': 'Main menu',

    /* ---------- leaderboard ---------- */
    'board.title': 'Leaderboard',
    'board.namePlaceholder': 'Your nickname',
    'board.save': 'Save',
    'board.back': 'Back',
    'board.stats': '{hint} Attempts: {attempts} · best here: {best} {unit}',
    'board.empty': 'No runs in this mode yet',
    'board.remoteOn': 'Connected to the server board: {base}',
    'board.remoteOff':
      'Local board (localStorage) — scores stay on this device. Once a backend is ready, flip remote.enabled in leaderboard.js to switch to a server board.',

    /* ---------- canvas ---------- */
    'canvas.tunnelEntry': 'TUNNEL',
    'canvas.tunnelAim': 'aim well',
    'canvas.tunnelInside': 'inside · walls are soft',
    'canvas.newBiome': 'Entering · {biome}',
    'canvas.newBiomeSub': 'New biome · difficulty up',

    /* ---------- modes ---------- */
    'mode.coin.name': 'Coin mode',
    'mode.coin.board': 'Coin board',
    'mode.coin.unit': 'coins',
    'mode.coin.hint':
      'Scores the coins you collect. Precision flyers who dare to hug the gap for a coin win here; ploughing ahead and ignoring coins will not get you up this board.',
    'mode.distance.name': 'Distance mode',
    'mode.distance.board': 'Distance board',
    'mode.distance.unit': 'm',
    'mode.distance.hint':
      'Scores how far you fly (1 m = 40 px). Ignore the coins — surviving and holding up against the late-game mechanisms is the skill.',

    /* ---------- rivals (demo entries on the local board) ---------- */
    'rival.0': 'Skylark',
    'rival.1': 'Nightowl',
    'rival.2': 'Pinecone',
    'rival.3': 'Swift',
    'rival.4': 'Moss',
    'rival.5': 'Fawn',

    /* ---------- death reasons ---------- */
    'death.floor': 'Hit the ground',
    'death.ceiling': 'Hit the ceiling',
    'death.blade': 'Hit a track saw',
    'death.swing': 'Clipped by a pendulum',
    'death.pinwheel': 'Clipped by a pinwheel',
    'death.orbiter': 'Sliced by an orbiting saw',
    'death.clamper': 'Caught by a clamp',
    'death.twinblade': 'Hit the twin blade',
    'death.midswing': 'Swept by the twin pendulum',
    'death.twin': 'Hit a twin gate',
    'death.tunnel': 'Hit the tunnel entrance',
    'death.pipe': 'Hit a gate',

    /* ---------- biomes ---------- */
    'biome.forest': 'Forest',
    'biome.desert': 'Desert',
    'biome.snow': 'Snowfield',
    'biome.volcano': 'Volcano',
    'biome.ocean': 'Star Sea',
    'biome.bamboo': 'Bamboo Grove',
    'biome.swamp': 'Swamp',
    'biome.canyon': 'Canyon',
    'biome.glacier': 'Glacier',
    'biome.badland': 'Badland',
    'biome.coral': 'Coral Reef',
    'biome.lava': 'Lava',
    'biome.storm': 'Thunderstorm',
    'biome.tundra': 'Tundra',
    'biome.dune': 'Dunes',
    'biome.mist': 'Mist',
    'biome.nebula': 'Nebula',
    'biome.aurora': 'Aurora',
    'biome.scorched': 'Scorched Land',
    'biome.salt': 'Salt Lake',
    'biome.abyss': 'Abyss',
    'biome.cloud': 'Cloudland',
    'biome.wasteland': 'Wasteland',
    'biome.crystal': 'Crystal',
    'biome.dawn': 'Dawn'
  };

  /* ================= 中文 ================= */
  const zh = {
    'app.title': '简约像素飞鸟',
    'brand.name': '简约像素飞鸟',
    'brand.tag': '一条命跑到撞为止，穿过隧道换群系',

    'lang.button': 'EN',
    'lang.title': '切换语言',

    'hud.distance': '距离',
    'hud.coins': '金币',
    'hud.speed': '速度',
    'hud.rank': '名次',
    'hud.best': '最好',
    'hud.restarts': '重开',
    'hud.hint': '空格 / 点击 拍翅 · R 立刻重开 · P 暂停',
    'hud.newArea': '新区域',
    'hud.rankOf': '第 {n} 名',
    'hud.tunnelNone': '距隧道 —',
    'hud.tunnelNear': '前方隧道 {n} 根',
    'hud.tunnelFar': '距隧道 {n} 根',
    'god.label': '无敌',
    'god.on': '无敌 开',
    'god.off': '无敌 关',
    'god.title': '本地测试用：开启后撞上任何障碍都不会死，直接穿过去',
    'toast.godOn': '无敌已开：撞障碍物直接穿过去',
    'toast.godOff': '无敌已关：恢复判定',

    'menu.sub': '一条命跑到撞为止，穿过隧道换群系，难度逐层加码',
    'menu.trackLength': '赛道长度',
    'menu.trackInfinite': '无限（撞到才结束）',
    'menu.bestHere': '本榜最好',
    'menu.attemptsHere': '本榜尝试',
    'menu.seedLabel': '赛道码',
    'menu.copy': '复制',
    'menu.newSeed': '换一条',
    'menu.seedPlaceholder': '粘贴别人的赛道码，跑同一条赛道',
    'menu.run': '开跑',
    'menu.top3': '本赛道前三',
    'menu.history': '最近成绩',
    'menu.emptyHistory': '这个模式还没有成绩，先跑一局',
    'menu.start': '开始（空格）',
    'menu.viewBoard': '查看排行榜',
    'menu.rival': '陪练',
    'toast.seedCopied': '赛道码已复制：{code}',
    'toast.badSeed': '赛道码不认识',
    'toast.nameSaved': '昵称已保存',
    'share.text': '来跑这条 Flappy 赛道：{code}（{what}）',
    'share.coin': '一条命跑到撞为止，比谁金币多',
    'share.distance': '一条命跑到撞为止，比谁飞得远',

    'help.summary': '怎么玩 / 金币和机关有哪些',
    'help.items': [
      '点一下拍一次翅膀，撞到柱门、机关、隧道入口、地面或顶部就结束（进了隧道内部则碰壁不死）。',
      '<b>两个模式，两个榜</b>：开局前在<b>主菜单</b>里选——<b>金币模式</b>比吃到多少枚金币，<b>距离模式</b>比飞了多少米（1 米 = 40 像素，起始速度约 4.2 m/s，穿过一根柱子是 7.5 米）。同一条赛道码下两个模式<b>各有各的排行榜</b>，名次互不影响。HUD 左上角的大数字就是你当前模式比的东西，下面一行同时记着距离和金币。',
      '柱子是<b>无限</b>的，没有终点，一直飞到撞到为止。榜上<b>一个人只占一行</b>：同一个昵称只留你最好的一次成绩，本局没超过旧成绩时榜单保持不变（尝试次数照样累加）。',
      '金币铺得比较稀，都在你飞得到的路线上：柱门缺口里最多 1~2 枚、机关安全线上 1~2 枚，只有一半左右的柱门之间会拉出一条曲线（直线 / 上拱 / 下拱 / 波浪 / 尖峰 / 锯齿六种形态随机）。',
      '<b>绿色</b> 标准柱门 · <b>青色</b> 滑动门（上下移动，越往后摆得越大） · <b>蓝色</b> 呼吸门（缺口会收放）',
      '<b>紫色</b> 极限门（缺口贴顶或贴地，提前爬升 / 俯冲） · <b>红色</b> 窄缝门（缺口最小，最容易翻车） · <b>蓝灰</b> 双缺口门（一道墙开上下两个口，随便挑一个飞）',
      '<b>金属管道</b>：上下都是管壁、通道笔直，<b>每个群系只有 24 根柱子左右</b>（第一条隧道来得更早），所以一局里能穿过十来条隧道、看遍所有机关。管道内径逐群系收窄。<b>入口只有一小段是硬墙要飞准</b>（蓝色法兰盘），进去之后管壁全是软的——碰上下壁不会死，会被轻轻托回管道里，可以趁机松手滑着歇一小下；出口发金光，跨出去就换群系。',
      '<b>飞锯机关</b>：在竖轨上往返，永远碰不到上下两条安全航线。',
      '<b>摆锤机关</b>：从天花板或地面伸出摆动，从对侧航线通过。',
      '<b>风车机关</b>：四臂绕中心转的十字闸，从它扫不到的上 / 下航线过。',
      '<b>回旋锯机关</b>：锯片沿圆环轨道绕圈，同样留出上下两条安全航线。',
      '<b>橙色夹钳</b>（机关）：上下两片带齿的颚从顶和底伸出来一起往中间夹，<b>整副颚还会上下漂</b>——通道不是钉死的，得跟着那条虚线一起挪；夹到最紧时净高只剩一条窄缝门的宽度。',
      '<b>对冲锯</b>（机关）：上下两把锯沿竖轨相向振荡，<b>中间留一条走廊</b>，走廊会缓缓上下漂、宽窄呼吸，盯着走廊中心走。',
      '<b>对向双摆</b>（机关）：天花板和地面各甩一个长摆，把上下两侧全扫满，<b>中间那条笔直的走廊</b>永远安全。',
      '<b>难度递进</b>：前 6 根只有静止柱门；之后每 40 根柱子上一个难度档，穿过隧道还会再跳一档，一共 <b>20 档</b>（平均十几根柱子就上一档）——从「只会上下动的柱门」一路解锁到双缺口门、窄缝、飞锯、夹钳、风车、对冲锯、摆锤、对向双摆、回旋锯，最后所有道具一起上；同时缺口整体收紧、速度也更快。跑满 20 档后一直封顶，看你能撑多久。<b>第 3 个群系（雪原）就能碰到第一批机关</b>——飞锯和风车都在那里登场（刚出场时锯的行程和风车的臂长都收了 1/4 左右，越往后才越满配）。',
      '<b>群系一共 25 个</b>：森林 → 沙漠 → 雪原 → 火山 → 星海 → 竹林 → 沼泽 → 峡谷 → 冰川 → 荒原 → 珊瑚 → 熔岩 → 雷雨 → 苔原 → 沙丘 → 迷雾 → 星云 → 极光 → 焦土 → 盐湖 → 深海 → 云端 → 废土 → 水晶 → 黎明，每个群系约 24 根柱子（第一个群系更短，所以不用跑很久就能碰到新机关），25 个跑完才会循环回来。'
    ],
    'about.summary': '关于这个本地 Demo',
    'about.items': [
      '纯前端本地 Demo，成绩存在浏览器 localStorage，不上传服务器。',
      '赛道由赛道码决定：同一码，所有人看到的柱门、机关、隧道、金币完全一致。',
      '模拟内核是 120Hz 固定步长，手机、电脑、不同刷新率下物理完全一致。',
      '之后接后端时，把 <code>leaderboard.js</code> 里的 <code>remote.enabled</code> 打开即可切到服务器榜。'
    ],

    'over.restart': '再来一局（R）',
    'over.newSeed': '换个赛道',
    'over.board': '排行榜',
    'over.menu': '主菜单',
    'over.mode': '模式',
    'over.distance': '飞行距离',
    'over.coins': '吃到的金币',
    'over.reason': '结束原因',
    'over.time': '本局用时',
    'over.restarts': '本局重开',
    'over.badgePB': '🎉 新纪录！',
    'over.badgeFirst': '首次上榜：本榜最好 {best} {unit}',
    'over.badgeClose': '就差 {n} {unit}就破纪录了！',
    'over.badgeKeep': '本榜最好 {best} {unit}（本局没超过，榜单保留旧成绩）',
    'over.rankLine': '第 {rank} 名 / 共 {total} 名',
    'over.diffPrev': '再多拿 {n} {unit}，就能超过「{name}」',
    'over.diffNext': '领先「{name}」{n} {unit}，稳住！',
    'over.diffFirst': '你就是这个榜的第一，守住它',

    'pause.title': '已暂停',
    'pause.sub': '切到后台时自动暂停，回来接着跑',
    'pause.resume': '继续（P）',
    'pause.quit': '回主菜单',

    'board.title': '排行榜',
    'board.namePlaceholder': '你的昵称',
    'board.save': '保存',
    'board.back': '返回',
    'board.stats': '{hint}　尝试 {attempts} 次 · 本榜最好 {best} {unit}',
    'board.empty': '这个模式还没有成绩',
    'board.remoteOn': '已连接服务器榜单：{base}',
    'board.remoteOff':
      '当前为本地榜（localStorage），成绩只保存在这台设备上。之后接好后端，把 leaderboard.js 里的 remote.enabled 打开即可切换为服务器榜。',

    'canvas.tunnelEntry': '管道入口',
    'canvas.tunnelAim': '要飞准',
    'canvas.tunnelInside': '管道内 · 碰壁不死',
    'canvas.newBiome': '进入 · {biome}',
    'canvas.newBiomeSub': '新群系 · 难度提升',

    'mode.coin.name': '金币模式',
    'mode.coin.board': '金币榜',
    'mode.coin.unit': '枚',
    'mode.coin.hint': '比吃到的金币数。飞得准、敢贴着缺口去捡币的才是高手；闷头往前飞不管币，这个榜就上不去。',
    'mode.distance.name': '距离模式',
    'mode.distance.board': '距离榜',
    'mode.distance.unit': 'm',
    'mode.distance.hint': '比飞了多远（1 米 = 40 像素）。金币不用管，活得久、扛得住后期机关就是本事。',

    'rival.0': '云雀',
    'rival.1': '夜枭',
    'rival.2': '松果',
    'rival.3': '雨燕',
    'rival.4': '苔藓',
    'rival.5': '小鹿',

    'death.floor': '掉到地上',
    'death.ceiling': '撞到顶部',
    'death.blade': '撞上轨道飞锯',
    'death.swing': '被摆锤扫中',
    'death.pinwheel': '被风车叶片扫中',
    'death.orbiter': '被回旋锯划到',
    'death.clamper': '被夹钳夹住',
    'death.twinblade': '撞上对冲锯',
    'death.midswing': '被对向双摆扫中',
    'death.twin': '撞上双缺口门',
    'death.tunnel': '撞上管道入口',
    'death.pipe': '撞上柱门',

    'biome.forest': '森林',
    'biome.desert': '沙漠',
    'biome.snow': '雪原',
    'biome.volcano': '火山',
    'biome.ocean': '星海',
    'biome.bamboo': '竹林',
    'biome.swamp': '沼泽',
    'biome.canyon': '峡谷',
    'biome.glacier': '冰川',
    'biome.badland': '荒原',
    'biome.coral': '珊瑚',
    'biome.lava': '熔岩',
    'biome.storm': '雷雨',
    'biome.tundra': '苔原',
    'biome.dune': '沙丘',
    'biome.mist': '迷雾',
    'biome.nebula': '星云',
    'biome.aurora': '极光',
    'biome.scorched': '焦土',
    'biome.salt': '盐湖',
    'biome.abyss': '深海',
    'biome.cloud': '云端',
    'biome.wasteland': '废土',
    'biome.crystal': '水晶',
    'biome.dawn': '黎明'
  };

  const DICT = { en: en, zh: zh };
  const listeners = [];

  let lang = DEFAULT_LANG;

  /* ---------------- lookup ---------------- */
  function pick(key) {
    const table = DICT[lang] || DICT[DEFAULT_LANG];
    if (table && table[key] != null) return table[key];
    const fallback = DICT[DEFAULT_LANG][key];
    return fallback != null ? fallback : key;
  }

  /** Translate `key`; `{name}` placeholders are filled from `vars`. */
  function t(key, vars) {
    const raw = pick(key);
    if (typeof raw !== 'string' || !vars) return raw;
    let out = raw;
    for (const k in vars) out = out.split('{' + k + '}').join(vars[k]);
    return out;
  }

  /** Shorthand for i18n keys that are plain arrays (see `data-i18n-list`). */
  function list(key) {
    const raw = pick(key);
    return Array.isArray(raw) ? raw.slice() : [];
  }

  /* ---------------- language state ---------------- */
  function readStored() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return LANGS.indexOf(v) >= 0 ? v : null;
    } catch (e) {
      return null;
    }
  }

  /** Stored choice first, then the configured default. `navigator.language`
   * is intentionally ignored so everyone sees the same English page first. */
  function detect() {
    return readStored() || DEFAULT_LANG;
  }

  function set(next, silent) {
    const value = LANGS.indexOf(next) >= 0 ? next : DEFAULT_LANG;
    const changed = value !== lang;
    lang = value;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      /* private mode: keep the in-memory value only */
    }
    apply(typeof document !== 'undefined' ? document : null);
    if (changed && !silent) listeners.forEach((fn) => fn(lang));
    return lang;
  }

  function toggle() {
    return set(lang === 'en' ? 'zh' : 'en');
  }

  function onChange(fn) {
    listeners.push(fn);
    return fn;
  }

  /* ---------------- DOM binding ---------------- */
  function apply(rootEl) {
    const rootNode = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!rootNode) return;
    const nodes = rootNode.querySelectorAll('[data-i18n]');
    for (let i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));

    const htmlNodes = rootNode.querySelectorAll('[data-i18n-html]');
    for (let i = 0; i < htmlNodes.length; i++) {
      htmlNodes[i].innerHTML = t(htmlNodes[i].getAttribute('data-i18n-html'));
    }

    const lists = rootNode.querySelectorAll('[data-i18n-list]');
    for (let i = 0; i < lists.length; i++) {
      const items = list(lists[i].getAttribute('data-i18n-list'));
      lists[i].innerHTML = items
        .map(function (item) {
          return '<li>' + item + '</li>';
        })
        .join('');
    }

    const holders = rootNode.querySelectorAll('[data-i18n-ph]');
    for (let i = 0; i < holders.length; i++) {
      holders[i].setAttribute('placeholder', t(holders[i].getAttribute('data-i18n-ph')));
    }

    const titles = rootNode.querySelectorAll('[data-i18n-title]');
    for (let i = 0; i < titles.length; i++) {
      titles[i].setAttribute('title', t(titles[i].getAttribute('data-i18n-title')));
    }

    if (typeof document !== 'undefined' && rootNode === document) {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
      document.title = t('app.title');
    }
  }

  lang = DEFAULT_LANG;

  return {
    LANGS: LANGS,
    DEFAULT_LANG: DEFAULT_LANG,
    STORAGE_KEY: STORAGE_KEY,
    DICT: DICT,
    /** Current language code (`en` / `zh`). */
    get: function () {
      return lang;
    },
    set: set,
    toggle: toggle,
    detect: detect,
    t: t,
    list: list,
    apply: apply,
    onChange: onChange,
    /** True while running in Chinese. */
    isZh: function () {
      return lang === 'zh';
    },
    /** Localised name of a biome key, e.g. `biomeName('forest')`. */
    biomeName: function (key) {
      return t('biome.' + key);
    },
    /** Localised name of a mode's score unit (`coins` / `m` / `枚`). */
    unitOf: function (mode) {
      return t('mode.' + (mode === 'distance' ? 'distance' : 'coin') + '.unit');
    }
  };
});
