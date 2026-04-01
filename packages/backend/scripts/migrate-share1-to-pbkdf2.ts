/**
 * Migrate Share 1 encryption from scrypt to PBKDF2.
 *
 * Run: cd packages/backend && npx tsx scripts/migrate-share1-to-pbkdf2.ts
 *
 * Requires: VAULT_ENCRYPTION_KEY and DATABASE_URL env vars.
 *
 * This is a one-time migration. After running, the Worker (which uses PBKDF2)
 * can decrypt Share 1. Share 2 stays as scrypt — the Worker has a legacy fallback.
 */

import { PrismaClient } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  pbkdf2Sync,
} from 'crypto';

const prisma = new PrismaClient();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

function getMasterKey(): Buffer {
  const key = process.env.VAULT_ENCRYPTION_KEY;
  if (!key) {
    console.error('VAULT_ENCRYPTION_KEY not set');
    process.exit(1);
  }
  if (key.length === 64) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
}

// Decrypt with OLD method (scrypt)
function decryptScrypt(data: Buffer, masterKey: Buffer): Buffer {
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Encrypt with NEW method (PBKDF2)
// Note: Web Crypto appends tag to ciphertext, so the format is:
// salt (16) + iv (12) + ciphertext_with_tag (n + 16)
// This matches what the Worker's decrypt() expects.
function encryptPbkdf2(plaintext: Buffer, masterKey: Buffer): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const derivedKey = pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Web Crypto format: salt + iv + (ciphertext + tag)
  return Buffer.concat([salt, iv, encrypted, tag]);
}

async function main() {
  const masterKey = getMasterKey();

  console.log('=== Share 1 Migration: scrypt → PBKDF2 ===\n');

  const keySlots = await prisma.keySlot.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, share1Encrypted: true, provider: true, label: true },
  });

  console.log(`Found ${keySlots.length} active key slots to migrate.\n`);

  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const slot of keySlots) {
    try {
      const data = Buffer.from(slot.share1Encrypted);

      if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
        console.log(`  SKIP ${slot.id} (${slot.provider}/${slot.label}) — data too short`);
        skipped++;
        continue;
      }

      // Decrypt with scrypt
      const plaintext = decryptScrypt(data, masterKey);

      // Re-encrypt with PBKDF2
      const newEncrypted = encryptPbkdf2(plaintext, masterKey);

      // Zero plaintext
      plaintext.fill(0);

      // Update in DB
      await prisma.keySlot.update({
        where: { id: slot.id },
        data: { share1Encrypted: newEncrypted },
      });

      migrated++;
      if (migrated % 10 === 0 || migrated === keySlots.length) {
        console.log(`  Migrated ${migrated}/${keySlots.length}`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED ${slot.id} (${slot.provider}/${slot.label}):`, (err as Error).message);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);

  if (failed > 0) {
    console.log('\nWARNING: Some slots failed. These will not work with the new Worker.');
    console.log('Check the errors above and fix manually if needed.');
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
