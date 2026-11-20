/**
 * Connection settings for the integration-test database.
 * Locally: point TEST_DB_HOST at your Postgres (a socket dir works too).
 * In CI: the Postgres service container on localhost.
 */
export const testDb = {
  host: process.env.TEST_DB_HOST ?? 'localhost',
  port: Number(process.env.TEST_DB_PORT ?? 5432),
  username: process.env.TEST_DB_USER ?? 'postgres',
  password: process.env.TEST_DB_PASSWORD ?? 'postgres',
  database: process.env.TEST_DB_NAME ?? 'hausmeister_test',
};

/** Non-superuser role the application connects as during tests. */
export const appRole = {
  username: 'hm_app_test',
  password: 'hm_app_test',
};
