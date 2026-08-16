# SVARTFROST

A Diablo 1-inspired action RPG with a black metal theme. TypeScript, Vite,
and raw Canvas 2D — no game engine. Geometry, animation, and lighting are
all procedural for the dungeon and every enemy. A small set of
AI-generated stone/ice/leather/skin photos (`public/textures/`) are
affine-warped onto the dungeon geometry and downsampled for a chunky 90s
look, rather than being painted on as flat sprites. The player character
is the one exception: it's a layered sprite (`public/isometric_hero/`) —
see "Entities" under Rendering & performance below.

**Play it:** [https://svartfrost.vercel.app/]

## Features

- Isometric dungeon crawling with A* click/hold-to-move, camera zoomed in
  around the player, and touch controls (landscape-only, installable as a
  PWA) for mobile
- Procedurally generated dungeons, seeded and reproducible per run —
  depth 5+ can roll an all-frost level, ice-clad from wall to wall
- Dynamic lighting: cold player light, warm torchlight, Diablo-style
  see-through fade for walls that hide the player
- Photo-textured stone, ice, leather, and skin, warped onto the iso
  tile/wall/monster geometry and cached per tile so lighting stays fully
  dynamic
- Six enemy kinds beyond the plain wretch/draugr: the Lich (a caster that
  keeps its distance and lobs frost bolts), Ratlings (weak but always
  spawn in a pack), the Barrow Brute (telegraphs a slam you can dodge),
  plus depth-gated "rare" unique variants with stat boosts and a spikier,
  tinted silhouette
- Bosses cast a periodic hostile hazard pool and enter an enraged,
  faster/harder-hitting phase below 30% hp; a pitch-shifting tremolo riff
  plays for the whole fight and cuts to a scream on death
- Itemization: weapon, armor, and trinket drops can roll magic (1 affix)
  or rare (2-3 affixes) — bonus damage, attack speed, life on hit, bleed
  chance, armor, regen, mana regen, stride, or (trinkets only) spell
  damage/cooldown — color-coded blue/gold in the satchel, with a hover
  tooltip showing a +/- stat comparison against whatever's equipped.
  Past floor 10, gray (unenchanted) drops stop appearing entirely.
  Bosses and rare mobs can also drop **Legendary** items past floor 10 —
  rare, hand-crafted uniques (red name, fixed identity, rolled bonus
  stats starting above what Rare can reach for that same stat)
- Loot: weapons, armor, and trinkets across tiers, plus spell tomes —
  picking one up teaches that spell permanently for the run instead of
  sitting in the satchel as gear, so duplicates never pile up
- Six spells: Frost Nova, Fire Nova, Fireball, Lightning, Plague Bloom
  (lingering poison hazard), and Blood Rite (life-drain burst + bleed).
  Right-click (or long-press, touch) the mana orb to pick which spell
  you've learned is active
- A boss every fifth depth, named for the black metal pantheon, each with
  a distinct look
- Procedural WebAudio soundtrack that shifts mood every five depths, with
  rare, distant ambient melodies drifting in at low volume
- Wall and floor surface variety — carved rune/pentagram sigils, water
  stains, dried blood, dirt — baked once per tile, so it's free at runtime
- Save/continue with checkpoints at each depth, plus lifetime records

## Rendering & performance

An audit of how the renderer works, kept up to date as the basis for future
optimization work rather than re-discovering it every time. References:
[web.dev canvas performance](https://web.dev/articles/canvas-performance),
[MDN: optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas),
[MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame).

- **Loop:** a single `requestAnimationFrame` loop in `main.ts` drives
  `input.update` → `game.update(dt)` → `render(ctx, game, view, dt)`, with
  `dt` clamped to 0.05s. No fixed-timestep/accumulator — one update and one
  render per rAF tick, so simulation rate is tied to display rate.
- **Canvas setup:** one 2D context, `alpha: false`. `devicePixelRatio` is
  capped at 2 and applied via `ctx.setTransform`, so canvas backing size can
  be up to 4x the CSS pixel area on a high-DPR phone.
- **World transform:** the whole scene is scaled about the screen center
  each frame (`ctx.scale(VIEW_ZOOM, VIEW_ZOOM)`, 1.4 desktop / 1.15 touch);
  `screenToWorldTile()` inverts the same math for hit-testing.
- **Explored-but-dark tiles:** baked once onto a persistent offscreen
  `staticCanvas` sized to the whole dungeon, blitted with a single
  `drawImage` every frame. Newly explored tiles are appended incrementally
  (tracked via a `Uint8Array` "already baked" mask) and only re-baked at
  most every 500ms, not every frame.
- **Torchlit tiles near the player** (a 27x27 tile window, `DYNAMIC_RANGE
  = 13`, Chebyshev distance) are where almost all of the per-frame cost
  used to live, and where the current optimization pass focused:
  - Every visible floor and wall tile's **entire static look** — the
    photo-texture warp, masonry variant bands, mortar joints, carved
    runes, bone niches, water stains, ambient occlusion wedges, cracks,
    rubble, frost rime/icicles, a torch sconce's glow + bracket — is baked
    **once** into a small offscreen canvas per tile (`floorTexCache` /
    `wallTexCache`, keyed by `x,y`) at a reference brightness. The only
    thing that changes frame to frame (light level, from torch flicker and
    the player's own glow) is applied live as a *single* combined
    multiply-tint fill over the tile's blitted silhouette
    (`wallShapePath` + `tintPath`), instead of the ~10-20 separate
    `beginPath`/`fill`/`stroke` calls that used to run per tile, per
    frame. The one thing that's genuinely live per-frame is a torch's
    flickering flame (`drawSconceFlame`, two cheap path fills, no
    gradient) and the stairwell's pulse ring — everything else is a blit.
  - **Measured effect:** a synthetic stress scene (34 enemies clustered
    around the player, forcing a full dynamic-range redraw every frame)
    went from **87.7ms/frame to 42.9ms/frame** for `render()` alone — roughly
    a 2x speedup — measured by diffing against the pre-optimization code
    via `git stash` in the same running page. A more realistic 6-enemy
    scene renders in ~22ms.
- **Depth-sorted draw list:** walls, enemies, and the player used to be
  pushed into a fresh array of ~100-200 arrow-function closures every
  frame just to defer drawing until after a depth sort. That's now a
  reused pool of plain tagged slots (`drawPool` in `render.ts`) filled in
  place each frame, sorted with a manual insertion sort over just the
  live prefix (the list arrives already close to depth order — walls are
  pushed in roughly that order from the tile scan — which is insertion
  sort's best case, and it avoids slicing a fresh array the way
  `Array#sort` on a sub-range would require).
- **Entities — player:** a layered sprite (`sprites.ts`) — separate armor,
  weapon, and head spritesheets from `public/isometric_hero/` composited
  per frame, 128x128px cells, 32 animation columns x 8 screen-space
  direction rows. Facing comes from the movement vector (or, idle, the
  last attack's aim); the animation frame is picked from `Math.floor(game.time
  * fps) % segmentLength` — elapsed time, never a per-render counter, so
  playback speed can't drift with frame rate. Torch/player light is
  applied as a direct per-pixel RGB multiply via `getImageData`/
  `putImageData` rather than a canvas composite-mode blend — the
  multiply-then-`destination-in`-mask trick tiles use (see below) left a
  faint ghost of the sprite's own silhouette bleeding into its transparent
  margin here, and per-pixel math can't bleed by construction. Falls back
  to the original procedural vector `drawPlayer()` until the sheets finish
  loading. Confirmed cost-neutral via an A/B test (same page, same
  session, code toggled and reloaded): no measurable FPS difference
  on or off.
- **Entities — enemies/bosses:** still no sprites — every body is a
  hand-drawn vector silhouette (`beginPath` + `lineTo`/`quadraticCurveTo`
  chains) rebuilt from scratch every frame for every visible entity, with
  cloth/skin/steel rendered as a repeating `CanvasPattern` from a photo
  swatch, multiply-tinted to match torchlight. Pattern fills are disabled
  entirely on touch devices (`isTouchDevice`) as a mobile perf mitigation
  landed earlier. **Not yet optimized** — tile rendering was the dominant
  cost (hundreds of tiles vs. a handful of entities on screen at once), so
  this was left as documented future work rather than tackled now. The
  `isometric_hero` pack is a single humanoid hero — nothing in it fits a
  draugr/wretch/boss silhouette, so sprite-vs-vector is currently decided
  per entity *kind*, and every kind but the player still resolves to vector.
- **Gradients:** the torch sconce's glow is now baked (see above). The
  remaining `createRadialGradient` call sites (ground-item glow, hazard
  wash, eye glow, projectile glow, player cloak shading) are still built
  fresh every frame — deliberately left alone, since their position or
  pulsing size/alpha changes every frame anyway, so caching the gradient
  object wouldn't avoid rebuilding it, and their on-screen count is low
  (a handful at once) compared to tile counts. The vignette is baked once
  per canvas size and reused; film grain regenerates on a 90ms throttle
  (not every frame) via `putImageData` onto a small tile, then
  pattern-repeated.
- **No `shadowBlur` usage anywhere** in the codebase (already avoided).
- **Integer blit coordinates:** the three hottest `drawImage` calls
  (static-world blit, per-tile floor/wall cache blits) round their
  destination coordinates to avoid forcing sub-pixel antialiasing on a
  plain sprite blit.
- **No dirty-rect tracking, no layered canvases, no worker/offscreen
  rendering** — one canvas, one context.

## Development

```sh
npm install
npm run dev    # dev server at http://localhost:5173
npm run build  # type-check + production build to dist/
```

## Controls

| Input | Action |
| --- | --- |
| Left click / hold | Move (attack when on an enemy) |
| Right click / F | Cast the active spell |
| Right click the mana orb (long-press, touch) | Pick which learned spell is active |
| Q or 1 | Drink a potion |
| I | Open the satchel |
| WASD / arrows | Step |
| Esc | Pause / close |
| M | Mute |

## Roadmap

Mobile touch controls, a production-build performance pass, the draugr's
material texture, a first round of "more content" (new enemy kinds, boss
mechanics, and item affixes), hand-crafted Legendary uniques, gray-item
gating past floor 10, the learn-a-spell-once rework, and a first pass at
sprite-rendering the player are all done. What's left:

1. **Key rebinding.** There's a volume slider on the pause screen now, but
   controls are still hardcoded — let players remap before this goes in
   front of more people.
2. **Sprite art for enemies.** Only the player uses the layered sprite
   pack today (see Rendering & performance); every enemy kind, including
   the Barrow Brute already in the game, is still the hand-drawn vector
   look. Closing that gap needs sprite sheets that fit each kind.
3. **A stretch enemy or two.** The Barrow Brute (telegraphed slam,
   already in the game) covered the first heavy-hitter idea; a slower,
   more dangerous heavy (multiple telegraphed attacks, or a shielded
   variant that punishes careless ranged spam) is the natural next step
   if the roster needs more variety.