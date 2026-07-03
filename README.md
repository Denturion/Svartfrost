# SVARTFROST

A Diablo 1-inspired action RPG with a black metal theme. TypeScript, Vite,
and raw Canvas 2D — no game engine, no art assets; everything is drawn and
synthesized procedurally.

**Play it:** https://denturion.github.io/Svartfrost/

## Features

- Isometric dungeon crawling with A* click/hold-to-move
- Procedurally generated dungeons, seeded and reproducible per run
- Dynamic lighting: cold player light, warm torchlight, Diablo-style
  see-through fade for walls that hide the player
- Loot: weapons, armor, trinkets, and spell tomes across tiers
- Four spells: Frost Nova, Fire Nova, Fireball, Lightning
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
