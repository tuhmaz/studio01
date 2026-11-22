/**
 * Einmal-Links für Einladung, Passwort vergessen und E-Mail-Bestätigung.
 *
 *  - 32 zufällige Bytes (base64url) im Link, in der Datenbank nur SHA-256.
 *  - Ein neuer Link derselben Art macht ältere ungültig.
 *  - Einlösen ist atomar (FOR UPDATE + used_at): ein Link funktioniert genau einmal.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import sql, { type Db } from '@/lib/db';

export type TokenPurpose = 'verify' | 'reset' | 'invite';

export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  reset: 60,
  verify: 48 * 60,
  invite: 7 * 24 * 60,
};

export const MIN_PASSWORD_LENGTH = 12;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class TokenError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function issueToken(
  input: { companyId: string; userId: string; purpose: TokenPurpose; createdBy?: string | null },
  db: Db = sql,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db`DELETE FROM auth_tokens WHERE user_id = ${input.userId} AND purpose = ${input.purpose} AND used_at IS NULL`;
  await db`
    INSERT INTO auth_tokens (id, company_id, user_id, purpose, token_hash, expires_at, created_by)
    VALUES (${`tok-${randomUUID()}`}, ${input.companyId}, ${input.userId}, ${input.purpose}, ${hash(token)},
            NOW() + make_interval(mins => ${TOKEN_TTL_MINUTES[input.purpose]}), ${input.createdBy ?? null})
  `;
  return token;
}

export interface TokenUser {
  userId: string;
  companyId: string;
  companyName: string;
  name: string;
  email: string;
  role: string;
}

function validFormat(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

/** Link prüfen, ohne ihn einzulösen (Anzeige der Seite). */
export async function peekToken(token: unknown, purposes: TokenPurpose[]): Promise<TokenUser & { purpose: TokenPurpose }> {
  if (!validFormat(token)) throw new TokenError('Der Link ist ungültig.', 404);
  const [row] = await sql`
    SELECT t.purpose, t.expires_at < NOW() AS expired, t.used_at IS NOT NULL AS used,
           u.id::text AS user_id, u.company_id, u.name, u.email, u.role, c.name AS company_name
      FROM auth_tokens t
      JOIN users u ON u.id = t.user_id
      JOIN companies c ON c.id = u.company_id
     WHERE t.token_hash = ${hash(token)} AND t.purpose IN ${sql(purposes)}
  `;
  if (!row) throw new TokenError('Der Link ist ungültig oder wurde durch einen neueren ersetzt.', 404);
  if (row.used) throw new TokenError('Dieser Link wurde bereits verwendet.', 410);
  if (row.expired) throw new TokenError('Dieser Link ist abgelaufen. Bitte einen neuen anfordern.', 410);
  return {
    purpose: row.purpose, userId: row.user_id, companyId: row.company_id, companyName: row.company_name,
    name: row.name, email: row.email, role: row.role,
  };
}

/** Link einlösen und in derselben Transaktion `apply` ausführen. */
async function consume<T>(token: unknown, purposes: TokenPurpose[], apply: (db: Db, user: TokenUser) => Promise<T>): Promise<T> {
  if (!validFormat(token)) throw new TokenError('Der Link ist ungültig.', 404);
  return sql.begin(async tx => {
    const db = tx as unknown as Db;
    const [row] = await db`
      SELECT t.id, t.expires_at < NOW() AS expired, t.used_at IS NOT NULL AS used,
             u.id::text AS user_id, u.company_id, u.name, u.email, u.role, c.name AS company_name
        FROM auth_tokens t
        JOIN users u ON u.id = t.user_id
        JOIN companies c ON c.id = u.company_id
       WHERE t.token_hash = ${hash(token)} AND t.purpose IN ${db(purposes)}
       FOR UPDATE OF t
    `;
    if (!row) throw new TokenError('Der Link ist ungültig oder wurde durch einen neueren ersetzt.', 404);
    if (row.used) throw new TokenError('Dieser Link wurde bereits verwendet.', 410);
    if (row.expired) throw new TokenError('Dieser Link ist abgelaufen. Bitte einen neuen anfordern.', 410);
    await db`UPDATE auth_tokens SET used_at = NOW() WHERE id = ${row.id}`;
    return apply(db, {
      userId: row.user_id, companyId: row.company_id, companyName: row.company_name,
      name: row.name, email: row.email, role: row.role,
    });
  }) as Promise<T>;
}

export function checkNewPassword(password: unknown): string {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_PASSWORD_LENGTH) throw new TokenError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`);
  if (value.length > 200) throw new TokenError('Das Passwort ist zu lang.');
  return value;
}

/**
 * Passwort über Einladung oder „Passwort vergessen“ setzen. Die Adresse gilt
 * damit als bestätigt; alle bestehenden Sitzungen werden ungültig.
 */
export async function setPasswordWithToken(token: unknown, password: unknown): Promise<TokenUser> {
  const value = checkNewPassword(password);
  const passwordHash = await bcrypt.hash(value, 12);
  return consume(token, ['reset', 'invite'], async (db, user) => {
    await db`
      UPDATE users
         SET password_hash = ${passwordHash},
             password_changed_at = date_trunc('second', NOW()),
             email_verified_at = COALESCE(email_verified_at, NOW()),
             can_login_with_password = TRUE
       WHERE id = ${user.userId}
    `;
    // Andere offene Links dieser Person sind damit erledigt.
    await db`DELETE FROM auth_tokens WHERE user_id = ${user.userId} AND purpose IN ('reset', 'invite') AND used_at IS NULL`;
    return user;
  });
}

export async function verifyEmailWithToken(token: unknown): Promise<TokenUser> {
  return consume(token, ['verify'], async (db, user) => {
    await db`UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ${user.userId}`;
    return user;
  });
}
