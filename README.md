# SVARTFROST

A Diablo 1-inspired action RPG with a black metal theme. TypeScript, Vite,
and raw Canvas 2D — no game engine. Geometry, animation, and lighting are
all procedural; a small set of AI-generated stone/ice/leather/skin photos
(`public/textures/`) are affine-warped onto that geometry and downsampled
for a chunky 90s look, rather than being painted on as flat sprites.

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
- Six enemy kinds beyond the plain wretch/draugr: the Völva (a caster that
  keeps its distance and lobs frost bolts), Ratlings (weak but always
  spawn in a pack), the Barrow Brute (telegraphs a slam you can dodge),
  plus depth-gated "rare" unique variants with stat boosts and a spikier,
  tinted silhouette
- Bosses cast a periodic hostile hazard pool and enter an enraged,
  faster/harder-hitting phase below 30% hp
- Itemization: weapon and armor drops can roll magic (1 affix) or rare
  (2-3 affixes) — bonus damage, attack speed, life on hit, bleed chance,
  armor, regen, mana regen, or stride — color-coded blue/gold in the
  satchel, with a hover tooltip for the full stat line
- Loot: weapons, armor, trinkets, and spell tomes across tiers
- Six spells: Frost Nova, Fire Nova, Fireball, Lightning, Plague Bloom
  (lingering poison hazard), and Blood Rite (life-drain burst + bleed)
- A boss every fifth depth, named for the black metal pantheon, each with
  a distinct look
- Procedural WebAudio soundtrack that shifts mood every five depths
- Save/continue with checkpoints at each depth, plus lifetime records

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
| Right click / F | Cast the equipped spell |
| Q or 1 | Drink a potion |
| I | Open the satchel |
| WASD / arrows | Step |
| Esc | Pause / close |
| M | Mute |

## Roadmap

Mobile touch controls, a production-build performance pass, the draugr's
material texture, and a first round of "more content" (new enemy kinds,
boss mechanics, and item affixes) are all done. What's left:

1. **Key rebinding.** There's a volume slider on the pause screen now, but
   controls are still hardcoded — let players remap before this goes in
   front of more people.
2. **Deeper itemization, round two.** The affix system covers weapon and
   armor drops; a second accessory slot or a small set of hand-crafted
   uniques (fixed name + fixed affixes, Diablo 1 style) would give
   end-game loot more to chase beyond bigger numbers.
3. **A stretch enemy or two.** The proposed telegraphed "brute" landed as
   the Barrow Brute; a slower, more dangerous heavy (multiple telegraphed
   attacks, or a shielded variant that punishes careless ranged spam)
   is the natural next step if the roster needs more variety.
