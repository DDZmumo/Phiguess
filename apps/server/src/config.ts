import { resolve } from 'node:path';
import { z } from 'zod';

export function configuration() {
  const env = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url(),
    PUBLIC_ORIGIN: z.string().url().default('http://localhost:3000'),
    ASSET_DIR: z.string().default('./storage/assets'),
    AVATAR_DIR: z.string().default('./storage/avatars'),
    GENERATED_ASSET_DIR: z.string().default('./storage/generated'),
    GENERATED_CACHE_MIB: z.coerce.number().int().min(16).max(4096).default(512),
    TRUST_PROXY: z.enum(['0', '1']).default('0'),
  }).parse(process.env);
  if (env.NODE_ENV === 'production' && env.DATABASE_URL.includes('CHANGE_ME')) {
    throw new Error('Replace example credentials before production startup');
  }
  return { ...env, ASSET_DIR: resolve(env.ASSET_DIR), AVATAR_DIR: resolve(env.AVATAR_DIR), GENERATED_ASSET_DIR:resolve(env.GENERATED_ASSET_DIR) };
}
