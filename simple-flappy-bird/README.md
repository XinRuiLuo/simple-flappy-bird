# Simple Flappy Bird

A dependency-free, single-page flappy game you can read end to end: **endless gates, 25 biomes, 20 difficulty tiers, two scoring modes and two independent leaderboards** — all in plain HTML/CSS/JavaScript with no build step.

The whole point of this repo is that it stays **hackable**: every tunable lives in one config file, every string lives in one i18n file, and the simulation is a deterministic 120 Hz core you can require from Node.

- [English](#english)
- [中文](#中文)

---

## English

### Features

- **Endless course.** Gates keep coming until you crash — no finish line, no 60-second race.
- **Deterministic tracks.** A run is defined by a track code such as `FLPY-1K7X`. The same code gives everyone the same gates, mechanisms, tunnels and coins, on every device and every refresh rate.
- **25 biomes.** Forest → Desert → Snowfield → … → Crystal → Dawn. Passing a tunnel switches the biome and its colour palette, then wraps around.
- **20 difficulty tiers.** The first 6 gates are plain static pillars. After that every 40 pillars adds a tier and every tunnel adds one more, unlocking sliders, pulsing gaps, extreme gates, twin gates, narrow gaps, saws, clamps, pinwheels, twin blades, pendulums, twin pendulums and orbiting saws until everything shows up at once.
- **Two modes, two boards.** _Coin mode_ scores the coins you collect, _distance mode_ scores the metres you fly. Each track code keeps a separate board per mode.
- **Bilingual UI.** English (default) and Chinese, switched in play by the round button in the **bottom-right corner**; the starting language itself is `i18n.defaultLang` in `js/config.js`. The choice is remembered in `localStorage`.
- **No dependencies, no build.** Four script tags and you are done. Works from a `file://` URL too.

### Quick start

Open `index.html` in a browser, or serve the folder if you prefer a real origin:

```bash
npx --yes serve -l 8765 .
# or
python -m http.server 8765
```

Then visit <http://127.0.0.1:8765/>.

`npm start` runs the `serve` variant for you.

### Controls

| Action          | Input                               |
| --------------- | ----------------------------------- |
| Flap            | `Space` / `W` / `Up` / tap or click |
| Restart         | `R`                                 |
| Pause / resume  | `P` / `Esc`                         |
| Switch language | bottom-right button                 |

There is also a **god switch** in the HUD (local testing only): while a run is going, it turns every collision off so you can fly through anything.

### Configuration

Everything tunable lives in [`js/config.js`](js/config.js) — the game code never hard-codes a number that matters.

| Section       | What it controls                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i18n`        | Language the page starts in (`en` / `zh`). The browser locale is never sniffed, and a player's own choice wins from then on                                                                                    |
| `simulation`  | Logic tick rate (120 Hz) and the replay safety cap                                                                                                                                                             |
| `world`       | Canvas size and the ground line                                                                                                                                                                                |
| `bird`        | Start position, collision radius, gravity, flap impulse, terminal fall speed                                                                                                                                   |
| `course`      | Initial chunk size, extension step, preload-ahead distance, warm-up pillars                                                                                                                                    |
| `pipes`       | Gate width, spacing, speed curve, gap curve, margins, max drop between neighbours                                                                                                                              |
| `flight`      | The guaranteed-reachable envelope (`climb` / `dive` / `downCap`) the generator respects                                                                                                                        |
| `obstacles`   | Per-mechanism geometry and timing: `tunnel`, `twin`, `blade`, `swing`, `pinwheel`, `orbiter`, `clamper`, `twinblade`, `midswing`                                                                               |
| `coins`       | Coin radius, density, per-gate limits and the curved-trail shapes                                                                                                                                              |
| `scoring`     | Pixels per metre                                                                                                                                                                                               |
| `difficulty`  | The `mix` table (which mechanism debuts at which tier and its full weight), the post-hazard mix, the static-pillar weight decay, the per-tier gap tightening, the warm-up scaling, and the slider/pulse curves |
| `biomes`      | The ordered list of biome keys                                                                                                                                                                                 |
| `theme`       | One colour palette per biome (sky, sun, three parallax layers, ground, clouds, scenery)                                                                                                                        |
| `pipeStyles`  | One colour set per gate type                                                                                                                                                                                   |
| `leaderboard` | Storage keys, limits, rival ladder, remote endpoint                                                                                                                                                            |

Text is **not** in the config: all English and Chinese strings live in [`js/i18n.js`](js/i18n.js).

#### Why `config.js` and not `config.json`?

Because it keeps the project openable by double-clicking `index.html`:

- **Comments.** Every value is annotated (why 6 warm-up gates, why the clamp drifts); JSON has no comments, leaving bare numbers.
- **`file://` still works.** A `.json` file can only be read with `fetch()`, which browsers block on `file://` — you would be forced to run a local web server.
- **Expressions instead of magic numbers.** e.g. `maxRunTicks: 120 * 60 * 180`.
- **No async boot.** A JSON config has to be awaited before the game can initialise.
- **`require()` in Node.** The simulation core can be loaded and diffed from Node with no browser involved.

If you only ever want to change numbers, just edit the values inside `js/config.js` — the file is a plain data object with a comment per section, and nothing else in the codebase hard-codes a tunable.

### Project structure

```
simple-flappy-bird/
├── index.html          Markup + data-i18n hooks
├── css/style.css       Layout and colours
├── js/
│   ├── config.js       Every tunable (UMD: window.FlappyConfig / require)
│   ├── i18n.js         Every string, English + Chinese (window.FlappyI18n)
│   ├── core.js         Deterministic 120 Hz simulation (window.FlappyCore)
│   ├── leaderboard.js  Boards, rivals, storage (window.FlappyBoard)
│   └── game.js         Rendering, input, UI flow (window.FlappyGame)
├── LICENSE             MIT
└── package.json
```

### How it works

- **Fixed-step core.** `core.js` advances the world in `1/120 s` steps and is completely decoupled from rendering, so physics is identical on a 60 Hz phone and a 240 Hz monitor. `game.js` simply drains an accumulator and draws the result.
- **Seeded generation.** A single PRNG seeded from the track code builds the course. `buildCourse(seed, count)` has the _deterministic prefix_ property: `count` only decides how far the track is laid out, never what came before — which is what makes the endless course extendable in `300`-gate chunks.
- **Reachability first.** The generator plans obstacle positions inside the `flight` envelope, so a mechanism is never placed somewhere the bird could not physically fly.
- **One row per player.** On a board, the same nickname keeps only its best run; a worse run leaves the board untouched while still counting as an attempt.

### Wiring up a backend

`leaderboard.js` is written as if a server were already there: `FlappyBoard.submit(payload)` returns `{ entry, rank, isPB, diffToPrev, … }` and `remoteSubmit(payload)` is a ready-made hook. Set `leaderboard.remote.enabled = true` and `leaderboard.remote.base` in `js/config.js` and no caller has to change.

Right now scores live in `localStorage` (`flappy.entries.v4`, `flappy.extras.v4`, `flappy.me.v1`, `flappy.lang.v2`) and are never uploaded.

### License

[MIT](LICENSE).

---

## 中文

一个零依赖、单页面、可以一口气读完的 flappy 游戏：**无限柱门、25 个群系、20 档难度、两种计分模式与两套独立排行榜**，纯 HTML/CSS/JavaScript，不需要构建。

这个仓库的目的就是**保持可改**：所有可调参数集中在一个配置文件，所有文案集中在一个 i18n 文件，模拟内核是确定性的 120Hz，可以直接在 Node 里 `require`。

### 特性

- **无限赛道。** 柱子一直铺到撞为止——没有终点，也没有 60 秒竞速。
- **确定性赛道。** 一局由赛道码（例如 `FLPY-1K7X`）决定。同一个码，在任何设备、任何刷新率下，柱门、机关、隧道、金币完全一致。
- **25 个群系。** 森林 → 沙漠 → 雪原 → … → 水晶 → 黎明。穿过一条隧道就换一个群系配色，跑完一轮再循环。
- **20 档难度。** 前 6 根只有静止柱门；之后每 40 根柱子上一个难度档，穿过隧道再跳一档，依次解锁滑动门、呼吸门、极限门、双缺口门、窄缝、飞锯、夹钳、风车、对冲锯、摆锤、对向双摆、回旋锯，最后所有机关一起上。
- **两个模式，两个榜。** *金币模式*比吃到多少枚金币，*距离模式*比飞了多少米。同一条赛道码下两个模式各有一套排行榜。
- **中英双语。** 默认英语，可随时用**右下角**的圆形按钮切换成中文；启动语言本身由 `js/config.js` 的 `i18n.defaultLang` 决定。选择会记在 `localStorage` 里。
- **零依赖、零构建。** 四个 `<script>` 就完事，直接 `file://` 打开也能跑。

### 快速开始

直接用浏览器打开 `index.html`；想用真实 origin 的话，把目录起个静态服务：

```bash
npx --yes serve -l 8765 .
# 或者
python -m http.server 8765
```

然后访问 <http://127.0.0.1:8765/>。也可以直接 `npm start`（内部就是上面那条 `serve`）。

### 操作

| 操作        | 按键                            |
| ----------- | ------------------------------- |
| 拍翅        | `空格` / `W` / `↑` / 点击或触摸 |
| 立刻重开    | `R`                             |
| 暂停 / 继续 | `P` / `Esc`                     |
| 切换语言    | 右下角按钮                      |

HUD 里还有一个**无敌开关**（只用于本地测试）：一局进行中时，打开后撞上任何障碍都不会死，直接穿过去。

### 配置

所有可调参数都在 [`js/config.js`](js/config.js) —— 游戏代码里不再硬编码任何有意义的数值。

| 配置段        | 作用                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `i18n`        | 页面启动时的语言（`en` / `zh`）。不会嗅探浏览器语言，玩家切换过的选择优先                                                |
| `simulation`  | 逻辑帧率（120Hz）与回放安全上限                                                                                          |
| `world`       | 画布尺寸与地面线                                                                                                         |
| `bird`        | 起始位置、碰撞半径、重力、拍翅冲量、最大下落速度                                                                         |
| `course`      | 初始铺设长度、每次扩展长度、提前预载距离、热身柱数                                                                       |
| `pipes`       | 柱宽、间距、速度曲线、缺口曲线、边距、相邻柱门最大落差                                                                   |
| `flight`      | 生成层遵守的"人一定能飞到"包线（`climb` / `dive` / `downCap`）                                                           |
| `obstacles`   | 各机关的形状与时序：`tunnel`、`twin`、`blade`、`swing`、`pinwheel`、`orbiter`、`clamper`、`twinblade`、`midswing`        |
| `coins`       | 金币半径、密度、每个柱门的数量上限、曲线轨迹形态                                                                         |
| `scoring`     | 每米对应多少像素                                                                                                         |
| `difficulty`  | `mix` 表（哪个机关在第几档登场、满配权重）、危险区混搭权重、静止柱门权重衰减、逐档缺口收紧、热身缩放、滑动门与呼吸门曲线 |
| `biomes`      | 群系 key 的有序列表                                                                                                      |
| `theme`       | 每个群系一套配色（天空、太阳、三层视差、地面、云、装饰）                                                                 |
| `pipeStyles`  | 每种柱门一套配色                                                                                                         |
| `leaderboard` | 存储键、上限、陪练梯度、远程接口地址                                                                                     |

文案**不在**配置里：中英所有字符串都在 [`js/i18n.js`](js/i18n.js)。

#### 为什么是 `config.js` 而不是 `config.json`？

因为这样才能双击 `index.html` 直接打开：

- **能写注释。** 每个数值都标了原因（为什么前 6 根是热身、夹钳为什么要漂），JSON 不允许注释，只剩一串裸数字。
- **`file://` 仍可用。** `.json` 只能靠 `fetch()` 读取，而浏览器在 `file://` 下会拦截它——等于强制你必须起一个本地服务器。
- **能写表达式，而不是魔法数。** 例如 `maxRunTicks: 120 * 60 * 180`。
- **启动不需要异步。** JSON 配置必须等 `await` 完成才能初始化游戏。
- **Node 里能 `require()`。** 模拟内核可以脱离浏览器直接加载、比对。

如果你只是想改数值，直接编辑 `js/config.js` 里的数字就行——它本身就是一个纯数据对象，每段都有注释，代码里没有任何其他地方硬编码可调参数。

### 目录结构

```
simple-flappy-bird/
├── index.html          结构 + data-i18n 挂载点
├── css/style.css       布局与配色
├── js/
│   ├── config.js       所有可调参数（UMD：window.FlappyConfig / require）
│   ├── i18n.js         所有文案，中英双语（window.FlappyI18n）
│   ├── core.js         确定性 120Hz 模拟内核（window.FlappyCore）
│   ├── leaderboard.js  榜单、陪练、存储（window.FlappyBoard）
│   └── game.js         渲染、输入、UI 流程（window.FlappyGame）
├── LICENSE             MIT
└── package.json
```

### 实现要点

- **固定步长内核。** `core.js` 以 `1/120 秒` 推进世界，与渲染完全解耦，所以 60Hz 手机和 240Hz 显示器上的物理完全一致；`game.js` 只负责消费时间累加器并把结果画出来。
- **种子化生成。** 由赛道码播种的单一 PRNG 生成整条赛道。`buildCourse(seed, count)` 具备**确定性前缀**性质：`count` 只决定"铺到哪儿"，不会改变前面已经生成的内容——这正是无限赛道可以按 300 根一批向后扩展的前提。
- **可达性优先。** 生成层在 `flight` 包线内安排机关位置，绝不会把机关放到鸟物理上飞不到的地方。
- **一个昵称只占一行。** 榜上同一个昵称只保留最好的一次成绩；本局没超过旧成绩时榜单不变，但尝试次数照常累加。

### 接服务器

`leaderboard.js` 是照着"迟早会有后端"的形状写的：`FlappyBoard.submit(payload)` 返回 `{ entry, rank, isPB, diffToPrev, … }`，并且已经留好 `remoteSubmit(payload)`。只要在 `js/config.js` 里把 `leaderboard.remote.enabled` 打开、填好 `leaderboard.remote.base`，调用方一行都不用改。

目前成绩存在 `localStorage`（`flappy.entries.v4`、`flappy.extras.v4`、`flappy.me.v1`、`flappy.lang.v2`），不会上传。

### 许可

[MIT](LICENSE)。
