import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
export const backupMagic = Buffer.from("HRISBK01");
export const backupHeaderSize = 45;
export type BackupKind = "company" | "operator";
export function backupKey(passphrase: string, salt: Buffer) {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 12 ||
    passphrase.length > 128
  )
    throw Error("Use a backup passphrase of 12–128 characters.");
  return scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
export function backupCipher(kind: BackupKind, passphrase: string) {
  const header = Buffer.alloc(backupHeaderSize);
  backupMagic.copy(header);
  header[8] = kind === "company" ? 1 : 2;
  header.writeBigUInt64BE(BigInt(Date.now()), 9);
  randomBytes(16).copy(header, 17);
  randomBytes(12).copy(header, 33);
  const cipher = createCipheriv(
    "aes-256-gcm",
    backupKey(passphrase, header.subarray(17, 33)),
    header.subarray(33, 45),
  );
  cipher.setAAD(header);
  return { header, cipher };
}
export function readBackupHeader(header: Buffer) {
  if (
    header.length !== backupHeaderSize ||
    !header.subarray(0, 8).equals(backupMagic) ||
    ![1, 2].includes(header[8])
  )
    throw Error("Unsupported HRIS backup format.");
  const timestamp = Number(header.readBigUInt64BE(9));
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > 8640000000000000
  )
    throw Error("Invalid backup timestamp.");
  return {
    kind: (header[8] === 1 ? "company" : "operator") as BackupKind,
    created: new Date(timestamp).toISOString(),
  };
}
export function backupDecipher(
  header: Buffer,
  tag: Buffer,
  passphrase: string,
) {
  readBackupHeader(header);
  if (tag.length !== 16) throw Error("Invalid backup authentication tag.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    backupKey(passphrase, header.subarray(17, 33)),
    header.subarray(33, 45),
  );
  cipher.setAAD(header);
  cipher.setAuthTag(tag);
  return cipher;
}
export function encryptBackup(
  plain: Buffer,
  kind: BackupKind,
  passphrase: string,
) {
  const { header, cipher } = backupCipher(kind, passphrase);
  return Buffer.concat([
    header,
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function decryptBackup(
  bytes: Buffer,
  passphrase: string,
  kind: BackupKind,
) {
  if (bytes.length < backupHeaderSize + 16) throw Error("Invalid backup file.");
  const header = bytes.subarray(0, backupHeaderSize);
  if (readBackupHeader(header).kind !== kind)
    throw Error("This backup type is not supported here.");
  try {
    const cipher = backupDecipher(header, bytes.subarray(-16), passphrase);
    return Buffer.concat([
      cipher.update(bytes.subarray(backupHeaderSize, -16)),
      cipher.final(),
    ]);
  } catch {
    throw Error(
      "Backup authentication failed. Check the passphrase and file integrity.",
    );
  }
}
