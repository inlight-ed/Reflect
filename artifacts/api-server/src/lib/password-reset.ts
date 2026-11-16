/**
 * Password reset by one-time link.
 *
 * The link is sent by email when SMTP_URL is set. Without mail, an administrator creates a link
 * with deploy/reset-password.sh and passes it on. Either way only the sha256 of the token is
 * stored, a link works once and expires after an hour, and using it ends every session.
 * Requests never reveal whether an account exists: the answer is the same for any address.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { AuthError, normalizeEmail, validateCredentials } from "./auth";
import { database, hasDatabase } from "./database";
import { logger } from "./logger";
import { hashPassword, newToken, sha256 } from "./security";

export const RESET_TTL_MS = 60 * 60_000;
/** Unused links one account may hold at once; further requests are quietly ignored. */
const MAX_OPEN_LINKS = 3;

/** Address the links point to. Taken from configuration, never from the request's Host header. */
function publicUrl() {
  const explicit = process.env["PUBLIC_URL"]?.replace(/\/$/, "");
  if (explicit) return explicit;
  const domain = process.env["DOMAIN"];
  return domain ? `https://${domain}` : undefined;
}

export function resetLink(token: string) {
  const base = publicUrl();
  return base ? `${base}/reset-password?token=${token}` : undefined;
}

let transport: Transporter | undefined;
function mailer() {
  const url = process.env["SMTP_URL"];
  if (!url) return undefined;
  transport ??= nodemailer.createTransport(url);
  return transport;
}

const subject = "Reflect: восстановление пароля";
const text = (link: string) => [
  "Здравствуйте!",
  "",
  "Кто-то запросил смену пароля для вашего аккаунта Reflect. Чтобы задать новый пароль, откройте ссылку (она действует 1 час и только один раз):",
  link,
  "",
  "Если это были не вы, просто проигнорируйте письмо: пароль останется прежним.",
].join("\n");

export async function requestPasswordReset(emailInput: string) {
  if (!hasDatabase()) throw new AuthError("ACCOUNTS_UNAVAILABLE");
  const email = normalizeEmail(emailInput);
  const { db, usersTable, passwordResetsTable } = await database();
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) return;
  const open = await db.select({ hash: passwordResetsTable.tokenHash }).from(passwordResetsTable)
    .where(and(eq(passwordResetsTable.userId, user.id), isNull(passwordResetsTable.usedAt), gt(passwordResetsTable.expiresAt, new Date())));
  if (open.length >= MAX_OPEN_LINKS) return;

  const send = mailer();
  const token = newToken();
  const link = resetLink(token);
  if (!send || !link) {
    // No mail configured: the administrator issues links with deploy/reset-password.sh.
    logger.info("Password reset requested, but SMTP_URL or PUBLIC_URL is not set; no email sent");
    return;
  }
  await db.insert(passwordResetsTable).values({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  try {
    await send.sendMail({ from: process.env["MAIL_FROM"] ?? process.env["SMTP_FROM"] ?? "Reflect <no-reply@localhost>", to: user.email, subject, text: text(link) });
  } catch (err) {
    logger.error({ err }, "Password reset email could not be sent");
  }
}

/** Sets a new password from a reset link, ends every session and returns the account. */
export async function resetPassword(token: string, password: string) {
  if (!hasDatabase()) throw new AuthError("ACCOUNTS_UNAVAILABLE");
  validateCredentials("reset@check.kz", password);
  const passwordHash = await hashPassword(password);
  const { db, usersTable, sessionsTable, passwordResetsTable, rateLimitsTable } = await database();
  return db.transaction(async (tx) => {
    // Marking the link used in the same statement that checks it means two tabs cannot both use it.
    const [link] = await tx.update(passwordResetsTable).set({ usedAt: new Date() })
      .where(and(eq(passwordResetsTable.tokenHash, sha256(token)), isNull(passwordResetsTable.usedAt), gt(passwordResetsTable.expiresAt, new Date())))
      .returning({ userId: passwordResetsTable.userId });
    if (!link) throw new AuthError("INVALID_RESET_LINK");
    const [user] = await tx.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, link.userId))
      .returning({ id: usersTable.id, email: usersTable.email, name: usersTable.name });
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, link.userId));
    await tx.delete(passwordResetsTable).where(and(eq(passwordResetsTable.userId, link.userId), isNull(passwordResetsTable.usedAt)));
    await tx.delete(rateLimitsTable).where(eq(rateLimitsTable.key, `login:${sha256(user.email)}`));
    return user;
  });
}
