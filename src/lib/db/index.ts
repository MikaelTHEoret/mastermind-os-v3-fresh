import { drizzle } from 'drizzle-orm/neon-http';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import * as schema from './schema';

// Type assertion to handle Neon/Drizzle version compatibility
type DrizzleDB = ReturnType<typeof drizzle>;

// Only connect to database during runtime, not during build
let db: DrizzleDB;

// More defensive database initialization
if (typeof window !== 'undefined') {
  // Client-side: no database connection needed
  db = {} as any;
} else if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  // Production without DATABASE_URL - this is an error
  throw new Error('DATABASE_URL is required in production');
} else if (!process.env.DATABASE_URL) {
  // Development or build time without DATABASE_URL - use mock
  console.warn('DATABASE_URL not set - using mock database');
  db = {} as any;
} else {
  // Normal case: DATABASE_URL is available
  try {
    const sql = neon(process.env.DATABASE_URL) as NeonQueryFunction<boolean, boolean>;
    db = drizzle(sql, { schema }) as DrizzleDB;
  } catch (error) {
    console.warn('Failed to initialize database:', error);
    db = {} as any; // Fallback to mock
  }
}

export { db };
export * from './schema';