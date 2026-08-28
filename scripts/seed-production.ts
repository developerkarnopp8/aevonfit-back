/**
 * Popula o banco de PRODUÇÃO com as duas contas reais (coach Luan, atleta
 * Gustavo) e nada mais — sem plano de demonstração, sem dado fake. Gera uma
 * senha forte aleatória pra cada conta e imprime uma única vez no final;
 * anote antes de fechar o terminal, não fica salva em nenhum outro lugar.
 *
 * Rodar uma única vez, contra o banco de produção:
 *   npx ts-node scripts/seed-production.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateStrongPassword } from '../src/common/generate-strong-password';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findFirst({
    where: { email: { in: ['luan@aevonfit.com', 'gustavo@aevonfit.com'] } },
  });
  if (existing) {
    console.log('⏭️  Já existe conta com um desses e-mails — nada foi criado (evita sobrescrever senha em produção).');
    return;
  }

  const coachPassword = generateStrongPassword();
  const athletePassword = generateStrongPassword();

  const coach = await prisma.user.create({
    data: {
      name: 'Luan Silveira',
      email: 'luan@aevonfit.com',
      passwordHash: await bcrypt.hash(coachPassword, 10),
      role: 'coach',
    },
  });

  const athleteUser = await prisma.user.create({
    data: {
      name: 'Gustavo Karnopp',
      email: 'gustavo@aevonfit.com',
      passwordHash: await bcrypt.hash(athletePassword, 10),
      role: 'athlete',
    },
  });

  await prisma.student.create({
    data: {
      userId: athleteUser.id,
      coachId: coach.id,
      goal: 'Competição CrossFit',
    },
  });

  console.log('🎉 Contas de produção criadas.');
  console.log('');
  console.log('   Coach:   luan@aevonfit.com     /', coachPassword);
  console.log('   Athlete: gustavo@aevonfit.com  /', athletePassword);
  console.log('');
  console.log('Anote as senhas agora — não ficam salvas em nenhum log nem arquivo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
