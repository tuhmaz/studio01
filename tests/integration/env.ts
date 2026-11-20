import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appRole, testDb } from './db-config';

// The app's db pool (src/lib/db.ts) reads these on first import.
process.env.DB_HOST = testDb.host;
process.env.DB_PORT = String(testDb.port);
process.env.DB_USERNAME = appRole.username;
process.env.DB_PASSWORD = appRole.password;
process.env.DB_DATABASE = testDb.database;
process.env.JWT_SECRET = 'integration-test-secret-at-least-32-characters';

// Uploaded media go to a throwaway directory.
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = join(tmpdir(), 'hausmeister-test-storage');
