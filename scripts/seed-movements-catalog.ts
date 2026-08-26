/**
 * Popula o catálogo global de movimentos (Movement.coachId = null) com os
 * movimentos padrão de CrossFit. Rodar uma única vez:
 * `npx ts-node scripts/seed-movements-catalog.ts` — idempotente, pula
 * nomes que já existem no catálogo global.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MovementSeed {
  name: string;
  category: string;
}

const MOVEMENTS: MovementSeed[] = [
  { name: 'Snatch', category: 'LPO' },
  { name: 'Power Snatch', category: 'LPO' },
  { name: 'Clean', category: 'LPO' },
  { name: 'Power Clean', category: 'LPO' },
  { name: 'Clean & Jerk', category: 'LPO' },
  { name: 'Jerk', category: 'LPO' },
  { name: 'Split Jerk', category: 'LPO' },
  { name: 'Push Jerk', category: 'LPO' },
  { name: 'Back Squat', category: 'Força' },
  { name: 'Front Squat', category: 'Força' },
  { name: 'Overhead Squat', category: 'Força' },
  { name: 'Deadlift', category: 'Força' },
  { name: 'Sumo Deadlift', category: 'Força' },
  { name: 'Bench Press', category: 'Força' },
  { name: 'Strict Press', category: 'Força' },
  { name: 'Push Press', category: 'Força' },
  { name: 'Thruster', category: 'Força' },
  { name: 'Pull-up', category: 'Ginástica' },
  { name: 'Strict Pull-up', category: 'Ginástica' },
  { name: 'Muscle-up', category: 'Ginástica' },
  { name: 'Handstand Push-up', category: 'Ginástica' },
  { name: 'Ring Dip', category: 'Ginástica' },
  { name: 'Toes-to-Bar', category: 'Ginástica' },
];

async function main() {
  const existing = await prisma.movement.findMany({
    where: { coachId: null },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(m => m.name));

  const toCreate = MOVEMENTS.filter(m => !existingNames.has(m.name));

  if (!toCreate.length) {
    console.log('Nada a inserir — todos os movimentos já existem no catálogo global.');
    return;
  }

  await prisma.movement.createMany({
    data: toCreate.map(m => ({ name: m.name, category: m.category, coachId: null })),
  });

  console.log(`Inseridos ${toCreate.length} movimentos no catálogo global.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
