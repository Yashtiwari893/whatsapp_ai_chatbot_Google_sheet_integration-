import crypto from "crypto";

export function hashRow(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
