/**
 * Popula PRODUÇÃO com o "Mesociclo 6" (planilha PDF do coach Luan) como
 * TrainingPlan real do aluno Gustavo, com TODOS os 10 dias marcados como
 * executados/concluídos (WorkoutLog por exercício) + métricas de tempo de
 * execução (WorkoutSession por bloco + durationSeconds por log).
 *
 * Rodar UMA vez, apontando DATABASE_URL pro banco de produção (via túnel SSH):
 *   DATABASE_URL="postgresql://postgres:<senha>@127.0.0.1:15438/aevonfit" \
 *     npx ts-node scripts/import-mesociclo-gustavo-prod.ts
 *
 * Idempotente: aborta se já existir um plano "Mesociclo 6" pro aluno.
 *
 * Semana 1 = semana de 2026-08-17 (Seg) a 2026-08-21 (Sex).
 * Semana 2 = semana de 2026-08-24 (Seg) a 2026-08-28 (Sex).
 * Ambas 100% no passado em relação a hoje (2026-08-29).
 *
 * As durações de treino são FABRICADAS (o Gustavo não cronometrou de verdade
 * essas semanas) — plausíveis por tipo de bloco, determinísticas.
 */
import { PrismaClient, SessionType, WorkoutSessionStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface ExerciseInput {
  name: string;
  sets?: number;
  reps?: string;
  duration?: string;
  restSeconds?: number;
  loadPercent?: number;
  coachNotes?: string;
}

interface SessionInput {
  name: string;
  type: SessionType;
  exercises: ExerciseInput[];
}

interface DayInput {
  dayOfWeek: string;
  dayIndex: number;
  date: string; // YYYY-MM-DD
  sessions: SessionInput[];
}

interface WeekInput {
  weekNumber: number;
  days: DayInput[];
}

const semana1: DayInput[] = [
  {
    dayOfWeek: 'Segunda', dayIndex: 1, date: '2026-08-17',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Complexo de Aquecimento', sets: 2, coachNotes: 'Movimentos: 5 Clean Deadlift + 5 Hang Muscle Clean + 5 Front Squat + 5 Push Press + 5 Split Jerk. Bella Complex (Segredo) + Força — objetivo: construção de força específica para a prova de PR. 2 rounds.' },
        ],
      },
      {
        name: 'Bella Complex — Técnica', type: 'LPO',
        exercises: [
          { name: 'Bella Complex', sets: 6, restSeconds: 90, coachNotes: 'Movimentos: 1 Clean + 1 Shoulder-to-Overhead + 1 Front Squat + 1 Shoulder-to-Overhead — sem soltar a barra. Every 1\'30" x6 — 60%, 65%, 70%, 75%, 78%, 80% do Clean & Jerk.' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Front Squat', sets: 5, reps: '3 reps', loadPercent: 82, restSeconds: 90, coachNotes: '5x3 @ 82–85%' },
          { name: 'Split Jerk', sets: 5, reps: '2 reps', loadPercent: 80, restSeconds: 90, coachNotes: '5x2 @ 80%' },
        ],
      },
      {
        name: 'Conditioning', type: 'Metcon',
        exercises: [
          { name: '400m Run', sets: 5, duration: '400m', coachNotes: '5 rounds — not for time' },
          { name: 'Toes-to-Bar', sets: 5, reps: '10 reps' },
          { name: 'Box Jump Over', sets: 5, reps: '12 reps' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Terça', dayIndex: 2, date: '2026-08-18',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Circuito de Aquecimento', sets: 3, coachNotes: 'Movimentos: 8 Push-Up + 8 Scap Pull-Up + 8 Power Snatch + 10 Air Squat + 20" Handstand Hold. 3 rounds.' },
        ],
      },
      {
        name: 'Wallwalk Capacity', type: 'Gymnastics',
        exercises: [
          { name: 'Wall Walk', sets: 5, reps: '3 reps', restSeconds: 60, coachNotes: 'Every 1\' x5' },
        ],
      },
      {
        name: 'Power Snatch', type: 'LPO',
        exercises: [
          { name: 'Power Snatch @ 35kg', sets: 6, reps: '8 reps', restSeconds: 90, coachNotes: 'Every 90" x6. Testar estratégias: rounds 1–2 8 unbroken; rounds 3–4: 4+4; rounds 5–6: singles rápidos — descobrir qual estratégia custa menos.' },
        ],
      },
      {
        name: 'Prova 1 — Intervalos', type: 'Metcon',
        exercises: [
          { name: 'HSPU', sets: 3, reps: '8 reps', restSeconds: 75, coachNotes: '3 sets de 2 rounds. Rest 1\'15" entre blocos. Não é prova ainda — objetivo: descobrir onde o ritmo começa a cair.' },
          { name: 'Power Snatch 35kg', sets: 3, reps: '8 reps' },
          { name: 'Wall Ball 6kg', sets: 3, reps: '12 reps' },
          { name: 'Rope Climb', sets: 3, reps: '2 reps' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Quarta', dayIndex: 3, date: '2026-08-19',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Circuito de Aquecimento', sets: 3, coachNotes: 'Movimentos: 15 Ring Row + 12 Kipping Swing + 100m Running. 3 rounds.' },
        ],
      },
      {
        name: 'Gymnastic Skill', type: 'Gymnastics',
        exercises: [
          { name: 'Bar Muscle-Up', sets: 5, reps: '5 reps', coachNotes: 'EMOM 15\' — bloco 1 de 3: 5 BMU. Sem chegar próximo da falha.' },
          { name: 'Toes-to-Bar', sets: 5, reps: '10 reps', coachNotes: 'EMOM 15\' — bloco 2 de 3: 10 Toes-to-Bar. Me dar feedback dos Toes-to-Bar e Chest-to-Bar.' },
          { name: 'Double Under', sets: 5, reps: '40 reps', coachNotes: 'EMOM 15\' — bloco 3 de 3: 40 Double Under.' },
        ],
      },
      {
        name: 'Core', type: 'Core',
        exercises: [
          { name: 'GHD Sit-Up', sets: 3, reps: '12 reps' },
          { name: 'Back Extension', sets: 3, reps: '12 reps' },
          { name: 'Hollow Hold', sets: 3, duration: '30 segundos' },
          { name: 'Side Plank', sets: 3, duration: '30 segundos', coachNotes: '30" cada lado' },
        ],
      },
      {
        name: 'Endurance', type: 'Endurance',
        exercises: [
          { name: 'Running Low Intensity', duration: '30 minutos', coachNotes: '30\' contínuo, intensidade baixa' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Quinta', dayIndex: 4, date: '2026-08-20',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Complexo de Aquecimento', sets: 2, coachNotes: 'Movimentos: 5 Snatch Deadlift + 5 High Pull + 5 Muscle Snatch.' },
        ],
      },
      {
        name: 'Power Snatch', type: 'LPO',
        exercises: [
          { name: 'Power Snatch Complex', sets: 7, restSeconds: 75, coachNotes: 'Movimentos: 1 Hang Power Snatch + 1 Squat Snatch. Every 1\'15" x7 — 65%, 70%, 75%, 78%, 80%, 82%, 85%' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Snatch Pull', sets: 4, reps: '3 reps', loadPercent: 105, coachNotes: '4x3 @ 105–110%' },
          { name: 'Back Squat', sets: 5, reps: '3 reps', loadPercent: 85, restSeconds: 90, coachNotes: '5x3 @ 85%' },
        ],
      },
      {
        name: 'Skill Circuit', type: 'Gymnastics',
        exercises: [
          { name: 'Wall Walk', sets: 1, reps: '2 reps', coachNotes: 'AMRAP 15\' — PSE 6' },
          { name: 'Power Snatch 25kg', sets: 1, reps: '8 reps' },
          { name: 'Box Jump Over', sets: 1, reps: '10 reps' },
          { name: 'Shuttle Run 40m (5m)', sets: 1, reps: '1 vez' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Sexta', dayIndex: 5, date: '2026-08-21',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Clean + Front Squat + Jerk', coachNotes: 'Preparação progressiva, aumentar carga até 70%' },
        ],
      },
      {
        name: 'Bella Complex', type: 'LPO',
        exercises: [
          { name: 'Bella Complex', sets: 5, restSeconds: 90, coachNotes: 'Every 1\'30" x5 — 70%, 75%, 80%, 83%, 85% do Clean & Jerk. Se 85% estiver muito confortável: 87%. Mas sem falhar — não quero PR ainda.' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Clean Pull', sets: 4, reps: '2 reps', loadPercent: 110, coachNotes: '4x2 @ 110–115%' },
          { name: 'Push Jerk', sets: 4, reps: '3 reps', loadPercent: 75, coachNotes: '4x3 @ 75–80%' },
        ],
      },
      {
        name: 'Competition Conditioning', type: 'Metcon',
        exercises: [
          { name: 'Clean @ 45kg', sets: 3, reps: '6 reps', coachNotes: '3 rounds — AMRAP 3\': 6 Clean + 8 HSPU + 10 Toes-to-Bar + máx. shuttle run no tempo restante. Rest 3\' entre rounds, velocidade máxima, recomeçar do clean.' },
          { name: 'HSPU', sets: 3, reps: '8 reps' },
          { name: 'Toes-to-Bar', sets: 3, reps: '10 reps' },
        ],
      },
    ],
  },
];

const semana2: DayInput[] = [
  {
    dayOfWeek: 'Segunda', dayIndex: 1, date: '2026-08-24',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Complexo de Aquecimento', sets: 2, coachNotes: 'Movimentos: 5 Clean Deadlift + 5 Hang Muscle Clean + 5 Front Squat + 5 Push Press + 5 Split Jerk. Bella Complex + Força — objetivo: subir a intensidade do complexo sem buscar PR e identificar o limitante.' },
        ],
      },
      {
        name: 'Bella Complex', type: 'LPO',
        exercises: [
          { name: 'Bella Complex', sets: 6, restSeconds: 150, coachNotes: 'Every 2\'30" x6 — 70%, 75%, 80%, 83%, 86%, 88% do Clean & Jerk. PSE máx. 8,5. Sem falha.' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Front Squat', sets: 5, reps: '3 reps', loadPercent: 85, restSeconds: 150, coachNotes: '5x3 @ 85%' },
          { name: 'Clean Pull', sets: 4, reps: '3 reps', loadPercent: 110, restSeconds: 120, coachNotes: '4x3 @ 110%' },
        ],
      },
      {
        name: 'Conditioning', type: 'Metcon',
        exercises: [
          { name: '400m Run', sets: 4, duration: '400m', coachNotes: '4 rounds not for time — objetivo: movimento contínuo e recuperação. PSE 6/7.' },
          { name: 'Toes-to-Bar', sets: 4, reps: '10 reps' },
          { name: 'Box Jump Over', sets: 4, reps: '12 reps' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Terça', dayIndex: 2, date: '2026-08-25',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Circuito de Aquecimento', sets: 3, coachNotes: 'Movimentos: 8 Push-Up + 8 Scap Pull-Up + 6 Power Snatch com Barra + 8 Air Squat + 20" Handstand Hold. 3 rounds.' },
        ],
      },
      {
        name: 'HSPU Capacity', type: 'Gymnastics',
        exercises: [
          { name: 'HSPU', sets: 5, reps: '8 reps', restSeconds: 90, coachNotes: 'Every 90" x5. Meta: todas as séries com tempo semelhante e 1–2 reps de reserva.' },
        ],
      },
      {
        name: 'Power Snatch', type: 'LPO',
        exercises: [
          { name: 'Power Snatch @ 35kg', sets: 5, reps: '8 reps', restSeconds: 60, coachNotes: 'Every 1\' x5. Rounds 1–2: 8 UB; rounds 3–4: 4+4; round 5: estratégia escolhida.' },
        ],
      },
      {
        name: 'Rope Climb', type: 'Gymnastics',
        exercises: [
          { name: 'Rope Climb', sets: 4, reps: '2 reps', restSeconds: 60, coachNotes: 'Every 1\' x4' },
        ],
      },
      {
        name: 'Prova 1 — Intervalos', type: 'Metcon',
        exercises: [
          { name: 'HSPU', sets: 4, reps: '8 reps', restSeconds: 120, coachNotes: '4 rounds, rest 2\'. PSE 8. Registrar tempo de cada set. Objetivo: diferença menor que 10% entre o melhor e o pior set.' },
          { name: 'Power Snatch 35kg', sets: 4, reps: '8 reps' },
          { name: 'Wall Ball 6kg', sets: 4, reps: '12 reps' },
          { name: 'Rope Climb', sets: 4, reps: '2 reps' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Quarta', dayIndex: 3, date: '2026-08-26',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Circuito de Aquecimento', sets: 3, coachNotes: 'Movimentos: 8 Goblet Squat + 8 Romanian Deadlift Leve + 10 Alternated Reverse Lunge + 200m Bike Leve. Lower Body + Recovery — objetivo: continuar construindo força sem aumentar fadiga de ombro.' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Back Squat', sets: 5, reps: '4 reps', loadPercent: 82, restSeconds: 150, coachNotes: '5x4 @ 82%' },
          { name: 'Bulgarian Split Squat', sets: 4, reps: '6 reps cada lado', restSeconds: 90, coachNotes: '4x6/6 — PSE 8' },
          { name: 'Romanian Deadlift', sets: 4, reps: '6 reps', loadPercent: 75, restSeconds: 120, coachNotes: '4x6 @ 75%' },
        ],
      },
      {
        name: 'Core', type: 'Core',
        exercises: [
          { name: 'GHD Sit-Up', sets: 3, reps: '12 reps' },
          { name: 'Back Extension', sets: 3, reps: '12 reps' },
          { name: 'Hollow Hold', sets: 3, duration: '30 segundos' },
          { name: 'Side Plank', sets: 3, duration: '30 segundos', coachNotes: '30" cada lado' },
        ],
      },
      {
        name: 'Endurance', type: 'Endurance',
        exercises: [
          { name: 'Bike Zona 2', duration: '10 minutos', coachNotes: '30\' zona 2 total — 10\' bike + 10\' remo + 10\' corrida. PSE 5/6.' },
          { name: 'Remo Zona 2', duration: '10 minutos' },
          { name: 'Corrida Zona 2', duration: '10 minutos' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Quinta', dayIndex: 4, date: '2026-08-27',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Complexo de Aquecimento', sets: 2, coachNotes: 'Movimentos: 5 Snatch Deadlift + 5 Snatch High Pull + 5 Muscle Snatch + 5 Overhead Squat.' },
        ],
      },
      {
        name: 'Power Snatch', type: 'LPO',
        exercises: [
          { name: 'Power Snatch', sets: 6, reps: '3 reps', restSeconds: 120, coachNotes: 'Every 2\' x6 — 65%, 68%, 70%, 72%, 75%, 75%' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Snatch Pull', sets: 4, reps: '3 reps', loadPercent: 105, restSeconds: 120, coachNotes: '4x3 @ 105%' },
        ],
      },
      {
        name: 'Skill', type: 'Gymnastics',
        exercises: [
          { name: 'Wall Walk', sets: 5, reps: '3 reps', restSeconds: 90, coachNotes: 'Every 90" x5 — foco: passos curtos, tronco rígido e retorno econômico.' },
          { name: 'Chest-to-Bar', sets: 5, reps: '8 reps', coachNotes: 'EMOM 15\' — bloco 1 de 3. Sem falha. PSE 7.' },
          { name: 'Toes-to-Bar', sets: 5, reps: '10 reps', coachNotes: 'EMOM 15\' — bloco 2 de 3' },
          { name: 'Shuttle Run 40m (5m)', sets: 5, reps: '1 vez', coachNotes: 'EMOM 15\' — bloco 3 de 3' },
        ],
      },
      {
        name: 'For Time', type: 'Metcon',
        exercises: [
          { name: 'Box Jump Over', sets: 3, reps: '10 reps', restSeconds: 60, coachNotes: '3 rounds for time, rest 60". Objetivo: transições rápidas sem transformar em teste.' },
          { name: 'Wall Ball 6kg', sets: 3, reps: '12 reps' },
        ],
      },
    ],
  },
  {
    dayOfWeek: 'Sexta', dayIndex: 5, date: '2026-08-28',
    sessions: [
      {
        name: 'Aquecimento', type: 'Mobility',
        exercises: [
          { name: 'Complexo de Aquecimento', sets: 2, coachNotes: 'Movimentos: 4 Muscle Clean + 4 Front Squat + 4 Push Press + 4 Split Jerk. Bella Complex + Competition Pacing — objetivo: segunda exposição semanal ao Bella e capacidade competitiva sem repetir a Prova 1. Progredir até 65%.' },
        ],
      },
      {
        name: 'Bella Complex', type: 'LPO',
        exercises: [
          { name: 'Bella Complex', sets: 5, restSeconds: 180, coachNotes: 'Every 3\' x5 — 75%, 80%, 84%, 87%, 90% do Clean & Jerk. Só fazer 90% se 87% estiver tecnicamente sólido. Sem PR.' },
        ],
      },
      {
        name: 'Força', type: 'Strength',
        exercises: [
          { name: 'Push Jerk', sets: 4, reps: '2 reps', loadPercent: 82, restSeconds: 120, coachNotes: '4x2 @ 82%' },
        ],
      },
      {
        name: 'Competition Conditioning', type: 'Metcon',
        exercises: [
          { name: 'Clean @ 45kg', sets: 5, reps: '10 reps', restSeconds: 300, coachNotes: 'Every 5\' x5 — descansar o restante do tempo.' },
          { name: 'Chest-to-Bar', sets: 5, reps: '8 reps' },
          { name: 'Shuttle Run 40m', sets: 5, reps: '1 vez' },
          { name: 'Box Jump Over', sets: 5, reps: '10 reps' },
        ],
      },
    ],
  },
];

const weeks: WeekInput[] = [
  { weekNumber: 1, days: semana1 },
  { weekNumber: 2, days: semana2 },
];

// ── Métricas de tempo FABRICADAS por tipo de bloco (minutos de elapsed) ──────
const ELAPSED_MIN_BY_TYPE: Record<SessionType, number> = {
  Mobility: 10,
  LPO: 22,
  Strength: 18,
  Gymnastics: 15,
  Metcon: 16,
  Endurance: 32,
  Core: 10,
};

async function main() {
  console.log('Populando PRODUCAO — Mesociclo 6 — Gustavo Karnopp...');

  const coach = await prisma.user.findUniqueOrThrow({ where: { email: 'luan@aevonfit.com' } });
  const athleteUser = await prisma.user.findUniqueOrThrow({ where: { email: 'gustavo@aevonfit.com' } });
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: athleteUser.id } });

  const existing = await prisma.trainingPlan.findFirst({
    where: { studentId: student.id, title: 'Mesociclo 6' },
  });
  if (existing) {
    console.log('SKIP: "Mesociclo 6" ja existe pro aluno — nada criado (idempotente).');
    return;
  }

  const plan = await prisma.trainingPlan.create({
    data: {
      studentId: student.id,
      coachId: coach.id,
      month: 6,
      startDate: new Date('2026-08-17T00:00:00Z'),
      title: 'Mesociclo 6',
      published: true,
    },
  });

  let totalExercises = 0;
  let totalLogs = 0;
  let totalWorkoutSessions = 0;

  for (const weekInput of weeks) {
    const week = await prisma.week.create({
      data: { planId: plan.id, weekNumber: weekInput.weekNumber },
    });

    for (const dayInput of weekInput.days) {
      const day = await prisma.trainingDay.create({
        data: { weekId: week.id, dayOfWeek: dayInput.dayOfWeek, dayIndex: dayInput.dayIndex },
      });

      let cursor = new Date(`${dayInput.date}T06:00:00Z`);

      let sessionOrder = 1;
      for (const sessionInput of dayInput.sessions) {
        const session = await prisma.session.create({
          data: {
            dayId: day.id,
            name: sessionInput.name,
            type: sessionInput.type,
            order: sessionOrder++,
          },
        });

        const elapsedSeconds = ELAPSED_MIN_BY_TYPE[sessionInput.type] * 60;
        const activeSeconds = Math.round(elapsedSeconds * 0.82);
        const startedAt = new Date(cursor);
        const finishedAt = new Date(startedAt.getTime() + elapsedSeconds * 1000);
        cursor = new Date(finishedAt.getTime() + 5 * 60 * 1000);

        await prisma.workoutSession.create({
          data: {
            sessionId: session.id,
            athleteId: athleteUser.id,
            startedAt,
            finishedAt,
            elapsedSeconds,
            activeSeconds,
            status: WorkoutSessionStatus.Completed,
          },
        });
        totalWorkoutSessions++;

        const perExerciseDuration = Math.max(
          30,
          Math.floor(activeSeconds / Math.max(1, sessionInput.exercises.length)),
        );

        let exOrder = 1;
        for (const ex of sessionInput.exercises) {
          const exercise = await prisma.exercise.create({
            data: {
              sessionId: session.id,
              name: ex.name,
              sets: ex.sets,
              reps: ex.reps,
              duration: ex.duration,
              restSeconds: ex.restSeconds,
              loadPercent: ex.loadPercent,
              coachNotes: ex.coachNotes,
              order: exOrder++,
            },
          });
          totalExercises++;

          await prisma.workoutLog.create({
            data: {
              exerciseId: exercise.id,
              athleteId: athleteUser.id,
              completedAt: finishedAt,
              setsCompleted: ex.sets ?? 1,
              durationSeconds: perExerciseDuration,
            },
          });
          totalLogs++;
        }
      }
    }
  }

  await prisma.student.update({
    where: { id: student.id },
    data: { currentMonth: 6, currentWeek: 2 },
  });

  console.log(`OK: Plano "${plan.title}" — 2 semanas, 10 dias, ${totalExercises} exercicios.`);
  console.log(`OK: ${totalLogs} WorkoutLog (todos os exercicios executados).`);
  console.log(`OK: ${totalWorkoutSessions} WorkoutSession (metricas de tempo fabricadas).`);
  console.log(`OK: Student.currentMonth=6, currentWeek=2.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
