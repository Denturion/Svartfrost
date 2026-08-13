export const SPELLS = {
  frostnova: { name: 'Frost Nova', cost: 15 },
  firenova: { name: 'Fire Nova', cost: 20 },
  fireball: { name: 'Fireball', cost: 12 },
  lightning: { name: 'Lightning', cost: 10 },
  blight: { name: 'Plague Bloom', cost: 18 },
  blood: { name: 'Blood Rite', cost: 16 },
} as const;

export type SpellId = keyof typeof SPELLS;
