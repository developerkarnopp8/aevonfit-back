/**
 * Cria a primeira conta admin do sistema — problema do ovo e da galinha
 * (o painel de admin só existe depois de logar como admin). Rodar uma
 * única vez, local ou em produção:
 *   npx ts-node scripts/create-first-admin.ts "Nome Completo" "email@exemplo.com"
 *
 * Idempotente por e-mail — se já existir conta com esse e-mail, não faz
 * nada (evita sobrescrever senha de uma conta admin já em uso).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generateStrongPassword } from '../src/common/generate-strong-password';

const prisma = new PrismaClient();

async function main() {
  const [name, email] = process.argv.slice(2);
  if (!name || !email) {
    console.error('Uso: npx ts-node scripts/create-first-admin.ts "Nome Completo" "email@exemplo.com"');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`⏭️  Já existe conta com o e-mail ${email} — nada foi criado.`);
    return;
  }

  const password = generateStrongPassword();
  const admin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'admin',
    },
  });

  console.log('🎉 Conta admin criada.');
  console.log('');
  console.log(`   ${admin.email}  /  ${password}`);
  console.log('');
  console.log('Anote a senha agora — não fica salva em nenhum log nem arquivo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
