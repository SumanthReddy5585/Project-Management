import argon2 from 'argon2';
import { z } from 'zod';

// OWASP-recommended argon2id baseline (m=19 MiB, t=2, p=1).
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw) => argon2.hash(pw, OPTS);
export const verifyPassword = async (hash, pw) => { try { return await argon2.verify(hash, pw); } catch { return false; } };
// Constant-ish work for unknown users so login timing does not reveal account existence.
let dummy;
export async function burnHash(pw) { dummy ??= await hashPassword('timing-equalizer-not-a-real-password'); await verifyPassword(dummy, pw); }

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200)
  .refine((s) => /[a-zA-Z]/.test(s) && /\d/.test(s), 'Include at least one letter and one number');
