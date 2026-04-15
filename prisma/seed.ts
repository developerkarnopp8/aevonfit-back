import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding AevonFit database...');

  // ── Users ────────────────────────────────────────────────────────────────
  const coachPassword = await bcrypt.hash('coach123', 10);
  const athletePassword = await bcrypt.hash('athlete123', 10);

  const coach = await prisma.user.upsert({
    where: { email: 'luan@aevonfit.com' },
    update: {},
    create: {
      name: 'Luan Silveira',
      email: 'luan@aevonfit.com',
      passwordHash: coachPassword,
      role: 'coach',
    },
  });

  const athleteUser = await prisma.user.upsert({
    where: { email: 'gustavo@aevonfit.com' },
    update: {},
    create: {
      name: 'Gustavo Karnopp',
      email: 'gustavo@aevonfit.com',
      passwordHash: athletePassword,
      role: 'athlete',
    },
  });

  console.log(`✅ Users: ${coach.name}, ${athleteUser.name}`);

  // ── Student ──────────────────────────────────────────────────────────────
  const student = await prisma.student.upsert({
    where: { userId: athleteUser.id },
    update: {},
    create: {
      userId: athleteUser.id,
      coachId: coach.id,
      goal: 'Competição CrossFit',
      currentMonth: 1,
      currentWeek: 1,
      completionPercent: 68,
    },
  });

  console.log(`✅ Student: ${athleteUser.name}`);

  // ── Training Plan ────────────────────────────────────────────────────────
  const existingPlan = await prisma.trainingPlan.findFirst({
    where: { studentId: student.id, month: 1 },
  });

  if (existingPlan) {
    console.log('⏭️  Plan already seeded, skipping...');
    return;
  }

  const plan = await prisma.trainingPlan.create({
    data: {
      studentId: student.id,
      coachId: coach.id,
      month: 1,
      title: 'Mês 1 — Programação Gustavo',
      published: true,
    },
  });

  // ── Week 1 ───────────────────────────────────────────────────────────────
  const week1 = await prisma.week.create({
    data: { planId: plan.id, weekNumber: 1 },
  });

  // Terça — Mobilidade + LPO + Força Lower
  const terca = await prisma.trainingDay.create({
    data: { weekId: week1.id, dayOfWeek: 'Terça', dayIndex: 2 },
  });

  const mobSession = await prisma.session.create({
    data: { dayId: terca.id, name: 'Mobilidade', type: 'Mobility', order: 1 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: mobSession.id, name: 'Prayer Stretch', sets: 4, duration: '45 segundos', restSeconds: 60, coachNotes: '4x a cada 60" — 45" de trabalho', order: 1 },
      { sessionId: mobSession.id, name: '90/90 On The Box', sets: 4, duration: '45 segundos', restSeconds: 60, coachNotes: '4x a cada 60" — 45" de trabalho', order: 2 },
      { sessionId: mobSession.id, name: 'Banded Hip Flexor', sets: 3, duration: '60 segundos', restSeconds: 45, coachNotes: '3x cada lado', order: 3 },
    ],
  });

  const lpoSession = await prisma.session.create({
    data: { dayId: terca.id, name: 'Sessão 1 — LPO (Snatch)', type: 'LPO', order: 2 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: lpoSession.id, name: 'Snatch Complex', sets: 6, reps: '2 Hang Snatch + 1 Power Snatch + 1 Squat Snatch', restSeconds: 90, coachNotes: '6 sets — Rest 1\'30"', order: 1 },
      { sessionId: lpoSession.id, name: 'Snatch Pull', sets: 5, reps: '3 reps', restSeconds: 90, loadPercent: 100, coachNotes: '5x3 @ 100% do Snatch', order: 2 },
      { sessionId: lpoSession.id, name: 'Overhead Squat', sets: 4, reps: '4 reps', restSeconds: 120, loadPercent: 70, coachNotes: '4x4 @ 70% — foco em profundidade', order: 3 },
    ],
  });

  const forcaLowerSession = await prisma.session.create({
    data: { dayId: terca.id, name: 'Sessão 2 — Força Lower', type: 'Strength', order: 3 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: forcaLowerSession.id, name: 'Back Squat', sets: 5, reps: '3 reps', restSeconds: 180, loadPercent: 85, coachNotes: '5x3 @ 85% — explode na subida', order: 1 },
      { sessionId: forcaLowerSession.id, name: 'Romanian Deadlift', sets: 4, reps: '6 reps', restSeconds: 120, loadPercent: 65, coachNotes: '4x6 @ 65% — controle excêntrico', order: 2 },
      { sessionId: forcaLowerSession.id, name: 'Box Jump', sets: 5, reps: '5 reps', restSeconds: 90, coachNotes: '5x5 — caixa 60cm', order: 3 },
    ],
  });

  // Quarta — Ginástico + Core
  const quarta = await prisma.trainingDay.create({
    data: { weekId: week1.id, dayOfWeek: 'Quarta', dayIndex: 3 },
  });

  const ginSession = await prisma.session.create({
    data: { dayId: quarta.id, name: 'Sessão 1 — Ginástico', type: 'Gymnastics', order: 1 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: ginSession.id, name: 'Strict Pull-Up', sets: 5, reps: '5 reps', restSeconds: 90, coachNotes: '5x5 — sem kipping', order: 1 },
      { sessionId: ginSession.id, name: 'Ring Dip', sets: 4, reps: '8 reps', restSeconds: 90, coachNotes: '4x8 — foco na descida controlada', order: 2 },
      { sessionId: ginSession.id, name: 'Handstand Hold', sets: 5, duration: '30 segundos', restSeconds: 60, coachNotes: '5x30" contra parede', order: 3 },
      { sessionId: ginSession.id, name: 'Toes-to-Bar', sets: 4, reps: '10 reps', restSeconds: 75, coachNotes: '4x10 — ritmo controlado', order: 4 },
    ],
  });

  const coreSession = await prisma.session.create({
    data: { dayId: quarta.id, name: 'Sessão 2 — Core', type: 'Core', order: 2 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: coreSession.id, name: 'GHD Sit-Up', sets: 4, reps: '15 reps', restSeconds: 60, coachNotes: '4x15 — amplitude total', order: 1 },
      { sessionId: coreSession.id, name: 'Hollow Body Hold', sets: 4, duration: '30 segundos', restSeconds: 45, coachNotes: '4x30" — lombar no chão', order: 2 },
      { sessionId: coreSession.id, name: 'Russian Twist', sets: 3, reps: '20 reps', restSeconds: 60, coachNotes: '3x20 com anilha 10kg', order: 3 },
    ],
  });

  // Quinta — Clean & Jerk + Força Upper
  const quinta = await prisma.trainingDay.create({
    data: { weekId: week1.id, dayOfWeek: 'Quinta', dayIndex: 4 },
  });

  const cleanSession = await prisma.session.create({
    data: { dayId: quinta.id, name: 'Sessão 1 — LPO (Clean & Jerk)', type: 'LPO', order: 1 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: cleanSession.id, name: 'Clean & Jerk', sets: 6, reps: '1+1 reps', restSeconds: 120, loadPercent: 85, coachNotes: '6x(1 Clean + 1 Jerk) @ 85%', order: 1 },
      { sessionId: cleanSession.id, name: 'Front Squat', sets: 4, reps: '3 reps', restSeconds: 150, loadPercent: 80, coachNotes: '4x3 @ 80% — pausa 2" no fundo', order: 2 },
    ],
  });

  const upperSession = await prisma.session.create({
    data: { dayId: quinta.id, name: 'Sessão 2 — Força Upper', type: 'Strength', order: 2 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: upperSession.id, name: 'Strict Press', sets: 5, reps: '5 reps', restSeconds: 120, loadPercent: 75, coachNotes: '5x5 @ 75%', order: 1 },
      { sessionId: upperSession.id, name: 'Pendlay Row', sets: 4, reps: '6 reps', restSeconds: 90, loadPercent: 70, coachNotes: '4x6 — costas paralelas ao chão', order: 2 },
      { sessionId: upperSession.id, name: 'Dumbbell Bench Press', sets: 3, reps: '10 reps', restSeconds: 75, coachNotes: '3x10 — amplitude máxima', order: 3 },
    ],
  });

  // Sexta — Metcon
  const sexta = await prisma.trainingDay.create({
    data: { weekId: week1.id, dayOfWeek: 'Sexta', dayIndex: 5 },
  });

  const metconSession = await prisma.session.create({
    data: { dayId: sexta.id, name: 'Metcon — "FRAN"', type: 'Metcon', order: 1 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: metconSession.id, name: 'Thrusters 42kg', sets: 1, reps: '21-15-9', restSeconds: 0, coachNotes: 'For Time — sem descanso programado', order: 1 },
      { sessionId: metconSession.id, name: 'Pull-Up', sets: 1, reps: '21-15-9', restSeconds: 0, coachNotes: 'Kipping permitido', order: 2 },
    ],
  });

  // Sábado — Endurance
  const sabado = await prisma.trainingDay.create({
    data: { weekId: week1.id, dayOfWeek: 'Sábado', dayIndex: 6 },
  });

  const endSession = await prisma.session.create({
    data: { dayId: sabado.id, name: 'Endurance — Remo + Run', type: 'Endurance', order: 1 },
  });
  await prisma.exercise.createMany({
    data: [
      { sessionId: endSession.id, name: 'Remo Ergométrico', sets: 4, duration: '500m', restSeconds: 90, coachNotes: '4x500m — pace 2:05/500m', order: 1 },
      { sessionId: endSession.id, name: 'Run 400m', sets: 4, duration: '400m', restSeconds: 90, coachNotes: '4x400m — pace 1:50/400m', order: 2 },
    ],
  });

  console.log(`✅ Plan: "${plan.title}" with Week 1 (5 days, multiple sessions)`);
  console.log('');
  console.log('🎉 Seed complete!');
  console.log('   Coach:   luan@aevonfit.com     / coach123');
  console.log('   Athlete: gustavo@aevonfit.com  / athlete123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
