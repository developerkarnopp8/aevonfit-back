/**
 * Popula a Biblioteca de Exercícios do coach com os exercícios reais já
 * usados no plano do atleta (Mesociclo 6) — a Biblioteca é um catálogo
 * separado (ExerciseLibrary), os exercícios do plano nunca são salvos lá
 * automaticamente. Rodar uma única vez:
 * `npx ts-node scripts/seed-exercise-library-from-plan.ts`
 *
 * Reportado pelo usuário testando local: Biblioteca aparecia vazia mesmo
 * com um mesociclo inteiro de exercícios reais já cadastrado no plano.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Item {
  name: string;
  category: string;
  loadPercent?: number;
  reps?: string;
  duration?: string;
  restSeconds?: number;
  sets?: number;
}

const ITEMS: Item[] = [
  { name: '400m Run', category: 'Metcon', duration: '400m', restSeconds: undefined, sets: 5 },
  { name: '90/90 On The Box', category: 'Mobilidade', duration: '45 segundos', restSeconds: 60, sets: 4 },
  { name: 'Back Extension', category: 'Core', reps: '12 reps', sets: 3 },
  { name: 'Back Squat', category: 'Força', loadPercent: 85, reps: '3 reps', restSeconds: 180, sets: 5 },
  { name: 'Banded Hip Flexor', category: 'Mobilidade', duration: '60 segundos', restSeconds: 45, sets: 3 },
  { name: 'Bar Muscle-Up', category: 'Ginástica', reps: '5 reps', sets: 5 },
  { name: 'Bella Complex', category: 'LPO', restSeconds: 90, sets: 6 },
  { name: 'Bike Zona 2', category: 'Resistência', duration: '10 minutos' },
  { name: 'Box Jump', category: 'Ginástica', reps: '5 reps', restSeconds: 90, sets: 5 },
  { name: 'Box Jump Over', category: 'Metcon', reps: '12 reps', sets: 5 },
  { name: 'Bulgarian Split Squat', category: 'Força', reps: '6 reps cada lado', restSeconds: 90, sets: 4 },
  { name: 'Chest-to-Bar', category: 'Ginástica', reps: '8 reps', sets: 5 },
  { name: 'Circuito de Aquecimento', category: 'Outro', sets: 3 },
  { name: 'Clean & Jerk', category: 'LPO', loadPercent: 85, reps: '1+1 reps', restSeconds: 120, sets: 6 },
  { name: 'Clean + Front Squat + Jerk', category: 'LPO' },
  { name: 'Clean @ 45kg', category: 'LPO', reps: '6 reps', sets: 3 },
  { name: 'Clean Pull', category: 'LPO', loadPercent: 110, reps: '2 reps', sets: 4 },
  { name: 'Complexo de Aquecimento', category: 'Outro', sets: 2 },
  { name: 'Corrida Zona 2', category: 'Resistência', duration: '10 minutos' },
  { name: 'Double Under', category: 'Metcon', reps: '40 reps', sets: 5 },
  { name: 'Dumbbell Bench Press', category: 'Força', reps: '10 reps', restSeconds: 75, sets: 3 },
  { name: 'Front Squat', category: 'Força', loadPercent: 80, reps: '3 reps', restSeconds: 150, sets: 4 },
  { name: 'GHD Sit-Up', category: 'Core', reps: '15 reps', restSeconds: 60, sets: 4 },
  { name: 'HSPU', category: 'Ginástica', reps: '8 reps', restSeconds: 75, sets: 3 },
  { name: 'Handstand Hold', category: 'Ginástica', duration: '30 segundos', restSeconds: 60, sets: 5 },
  { name: 'Hollow Body Hold', category: 'Core', duration: '30 segundos', restSeconds: 45, sets: 4 },
  { name: 'Hollow Hold', category: 'Core', duration: '30 segundos', sets: 3 },
  { name: 'Overhead Squat', category: 'LPO', loadPercent: 70, reps: '4 reps', restSeconds: 120, sets: 4 },
  { name: 'Pendlay Row', category: 'Força', loadPercent: 70, reps: '6 reps', restSeconds: 90, sets: 4 },
  { name: 'Power Snatch', category: 'LPO', reps: '3 reps', restSeconds: 120, sets: 6 },
  { name: 'Power Snatch 25kg', category: 'LPO', reps: '8 reps', sets: 1 },
  { name: 'Power Snatch 35kg', category: 'LPO', reps: '8 reps', sets: 3 },
  { name: 'Power Snatch @ 35kg', category: 'LPO', reps: '8 reps', restSeconds: 90, sets: 6 },
  { name: 'Power Snatch Complex', category: 'LPO', restSeconds: 75, sets: 7 },
  { name: 'Prayer Stretch', category: 'Mobilidade', duration: '45 segundos', restSeconds: 60, sets: 4 },
  { name: 'Pull-Up', category: 'Ginástica', reps: '21-15-9', restSeconds: 0, sets: 1 },
  { name: 'Push Jerk', category: 'LPO', loadPercent: 75, reps: '3 reps', sets: 4 },
  { name: 'Remo Ergométrico', category: 'Metcon', duration: '500m', restSeconds: 90, sets: 4 },
  { name: 'Remo Zona 2', category: 'Resistência', duration: '10 minutos' },
  { name: 'Ring Dip', category: 'Ginástica', reps: '8 reps', restSeconds: 90, sets: 4 },
  { name: 'Romanian Deadlift', category: 'Força', loadPercent: 65, reps: '6 reps', restSeconds: 120, sets: 4 },
  { name: 'Rope Climb', category: 'Ginástica', reps: '2 reps', sets: 3 },
  { name: 'Run 400m', category: 'Metcon', duration: '400m', restSeconds: 90, sets: 4 },
  { name: 'Running Low Intensity', category: 'Resistência', duration: '30 minutos' },
  { name: 'Russian Twist', category: 'Core', reps: '20 reps', restSeconds: 60, sets: 3 },
  { name: 'Shuttle Run 40m', category: 'Metcon', reps: '1 vez', sets: 5 },
  { name: 'Shuttle Run 40m (5m)', category: 'Metcon', reps: '1 vez', sets: 1 },
  { name: 'Side Plank', category: 'Core', duration: '30 segundos', sets: 3 },
  { name: 'Snatch Complex', category: 'LPO', reps: '2 Hang Snatch + 1 Power Snatch + 1 Squat Snatch', restSeconds: 90, sets: 6 },
  { name: 'Snatch Pull', category: 'LPO', loadPercent: 100, reps: '3 reps', restSeconds: 90, sets: 5 },
  { name: 'Split Jerk', category: 'LPO', loadPercent: 80, reps: '2 reps', restSeconds: 90, sets: 5 },
  { name: 'Strict Press', category: 'Força', loadPercent: 75, reps: '5 reps', restSeconds: 120, sets: 5 },
  { name: 'Strict Pull-Up', category: 'Ginástica', reps: '5 reps', restSeconds: 90, sets: 5 },
  { name: 'Thrusters 42kg', category: 'Metcon', reps: '21-15-9', restSeconds: 0, sets: 1 },
  { name: 'Toes-to-Bar', category: 'Ginástica', reps: '10 reps', restSeconds: 75, sets: 4 },
  { name: 'Wall Ball 6kg', category: 'Metcon', reps: '12 reps', sets: 3 },
  { name: 'Wall Walk', category: 'Ginástica', reps: '3 reps', restSeconds: 60, sets: 5 },
];

async function main() {
  const coach = await prisma.user.findUnique({ where: { email: 'luan@aevonfit.com' } });
  if (!coach) throw new Error('Coach luan@aevonfit.com não encontrado');

  const existing = await prisma.exerciseLibrary.findMany({
    where: { coachId: coach.id },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(e => e.name));

  const toCreate = ITEMS.filter(i => !existingNames.has(i.name));

  if (!toCreate.length) {
    console.log('Nada a inserir — todos os itens já existem na biblioteca.');
    return;
  }

  await prisma.exerciseLibrary.createMany({
    data: toCreate.map(i => ({ ...i, coachId: coach.id })),
  });

  console.log(`Inseridos ${toCreate.length} exercícios na biblioteca do coach ${coach.email}.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
