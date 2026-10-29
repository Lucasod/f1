import dotenv from 'dotenv';
import path from 'path';
import { runSeed } from '../src/scripts/seed.js';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  runSeed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Seed failed:', error);
      process.exit(1);
    });
}