import { createHash } from "node:crypto";
import { currentUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/tenant";
import {
  companyArchive,
  compareCompanyArchive,
  companyBackupLimit,
} from "@/lib/company-backup";
import { encryptBackup, decryptBackup } from "@/lib/backup-format";
const requestLimit = 140 * 1024 * 1024;
async function bodyLimited(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > requestLimit) {
        await reader.cancel();
        throw Error("Backup request exceeds 140 MiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  return Response.json(
    {
      format: "hris-company-v1",
      scope:
        "Current company only; authentication hashes, sessions and account tokens excluded.",
      encrypted: true,
      restore:
        "Read-only company comparison; full recovery via operator CLI into a new directory.",
      max_plaintext_mib: 96,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await bodyLimited(request);
    if (b.action === "create") {
      if (b.confirmed !== true)
        throw Error(
          "Confirm you will store the encrypted archive and passphrase securely.",
        );
      // Validate passphrase before any archive work.
      if (
        typeof b.passphrase !== "string" ||
        b.passphrase.length < 12 ||
        b.passphrase.length > 128
      )
        throw Error("Use a backup passphrase of 12–128 characters.");
      const archive = companyArchive(user.company_id),
        plain = Buffer.from(JSON.stringify(archive));
      if (plain.length > companyBackupLimit)
        throw Error(
          "Company archive exceeds 96 MiB; use an operator database backup.",
        );
      const encrypted = encryptBackup(plain, "company", b.passphrase),
        sha256 = createHash("sha256").update(encrypted).digest("hex");
      audit(
        user,
        "Encrypted company archive generated",
        `${plain.length} bytes; ${sha256}`,
      );
      return new Response(new Uint8Array(encrypted), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename=hris-company-${user.company_id}-${new Date().toISOString().slice(0, 10)}.hrisbackup`,
          "Cache-Control": "no-store",
          "X-Backup-SHA256": sha256,
        },
      });
    }
    if (b.action === "preview") {
      if (
        typeof b.archive !== "string" ||
        b.archive.length > requestLimit ||
        !/^[-A-Za-z0-9+/=]+$/.test(b.archive)
      )
        throw Error("Provide a supported encrypted company archive.");
      const plain = decryptBackup(
        Buffer.from(b.archive, "base64"),
        b.passphrase,
        "company",
      );
      if (plain.length > companyBackupLimit)
        throw Error("Company archive exceeds 96 MiB.");
      return Response.json(
        compareCompanyArchive(
          JSON.parse(plain.toString("utf8")),
          user.company_id,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    throw Error("Invalid backup action.");
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Backup failed." },
      { status: 400 },
    );
  }
}
