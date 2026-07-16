import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';

const rl = readline.createInterface({ input, output });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const sql = postgres({
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_DATABASE || process.env.DB_NAME || 'hausmeister',
  username: process.env.DB_USERNAME || process.env.DB_USER || 'hausmeister_app',
  password: required('DB_PASSWORD'),
  ssl: false,
});

try {
  const companyId = (await rl.question('Company ID [tuhmaz-pro-2026]: ')).trim() || 'tuhmaz-pro-2026';
  const name = (await rl.question('Admin name: ')).trim();
  const email = (await rl.question('Admin email: ')).trim().toLowerCase();
  const password = await rl.question('Admin password (min 12 chars): ');

  if (!name || !email || password.length < 12) {
    throw new Error('Name, email and a password with at least 12 chars are required.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await sql`
    INSERT INTO public.users (
      company_id, name, email, password_hash, role,
      contract_type, hourly_rate, tax_class, kinder, has_church_tax, bundesland
    ) VALUES (
      ${companyId}, ${name}, ${email}, ${passwordHash}, 'ADMIN',
      'VOLLZEIT', 0, 1, 0, false, 'ST'
    )
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = 'ADMIN',
      updated_at = now()
    RETURNING id, email, role
  `;
  console.log(`Admin ready: ${user.email} (${user.id})`);
} finally {
  await sql.end();
  rl.close();
}
