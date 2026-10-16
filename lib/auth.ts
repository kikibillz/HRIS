import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { previewHostname } from "./preview";
export type User = {
  id: number;
  employee_id: number;
  company_id: number;
  email: string;
  name: string;
  access: "admin" | "manager" | "employee";
};
export const cookieName = "hris_session";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const validPassword = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 12 && value.length <= 128;
export function setupAvailable() {
  return (
    process.env.HRIS_ALLOW_SETUP === "1" &&
    !db.prepare("SELECT id FROM accounts LIMIT 1").get()
  );
}
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  return (
    (db
      .prepare(
        `SELECT a.id,a.employee_id,a.email,a.access,e.name,ce.company_id FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE e.status='Active' AND s.token_hash=? AND s.expires>?`,
      )
      .get(digest(token), Date.now()) as User | undefined) || null
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (process.env.HRIS_PUBLIC_ORIGIN)
    return origin === process.env.HRIS_PUBLIC_ORIGIN;
  if (process.env.HRIS_DEPLOYMENT === "production") return false;
  try {
    const parsed = new URL(origin);
    const preview = previewHostname();
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      (parsed.host === request.headers.get("host") ||
        origin === new URL(request.url).origin ||
        (!!preview && origin === `https://${preview}`))
    );
  } catch {
    return false;
  }
}
export async function requireUser(request: Request, admin = false) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (admin && user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  return user;
}
export function sessionFor(accountId: number, request: Request) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
  db.prepare(
    "INSERT INTO sessions(token_hash,account_id,expires) VALUES (?,?,?)",
  ).run(digest(token), accountId, Date.now() + 8 * 60 * 60 * 1000);
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.HRIS_DEPLOYMENT === "production" || (request.headers.get("origin") || request.url).startsWith("https:") ? "; Secure" : ""}`;
}
