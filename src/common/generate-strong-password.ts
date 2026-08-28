import * as crypto from 'crypto';

/** Senha forte aleatória — mesmo padrão já usado em scripts/seed-production.ts. */
export function generateStrongPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
