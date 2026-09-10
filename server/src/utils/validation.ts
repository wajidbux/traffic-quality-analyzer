/**
 * Signal validation.
 *
 * These are best-effort sanity checks — a record is never rejected for a
 * missing signal, only for an *invalid* one. The analyzer decides which
 * signals are actually submitted to Pixalate.
 */

const IPv4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const IPv6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d)\.){3}(25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d)\.){3}(25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d))$/;

export function isValidIp(ip: string | null | undefined): boolean {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  if (trimmed.includes(",")) return false; // no comma-separated lists
  return IPv4_RE.test(trimmed) || IPv6_RE.test(trimmed);
}

/**
 * Roku RIDA values are UUIDs (e.g. 331319d2-4cc2-51ac-de21-aa62f1e143c1 per
 * Pixalate's docs). Pixalate accepts ADID, IDFA, IDFV, WAID, MSAI, GAID (36
 * chars), MD5 (32 hex), SHA1 (40 hex), RIDA (36 chars) — all UUID-shaped or
 * hex tokens. This is a sanity check, not an entitlement check, so the version
 * and variant nibbles are not enforced strictly (real RIDAs are not always
 * RFC 4122-conformant).
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_TOKEN_RE = /^[0-9a-fA-F]{8,64}$/;

export function isValidDeviceId(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 128) return false;
  if (/[^0-9a-zA-Z\-_=.]/.test(trimmed)) return false;
  return UUID_RE.test(trimmed) || HEX_TOKEN_RE.test(trimmed);
}

/** A user agent just needs to be a non-trivial string (<= 512 chars). */
export function isValidUserAgent(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 512) return false;
  // UA strings are printable ASCII in practice; reject control chars.
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(trimmed);
}

export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeDeviceId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeUserAgent(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export interface ValidatedSignals {
  ip: string | null;
  deviceId: string | null;
  useragent: string | null;
}

/**
 * Validate a record's signals. Returns valid signals only, plus which signals
 * were dropped and why (surfaced to the user, never fatal).
 */
export function validateSignals(record: {
  ip?: string | null;
  rida?: string | null;
  device_id?: string | null;
  user_agent?: string | null;
}): { valid: ValidatedSignals; dropped: Array<{ signal: string; reason: string }> } {
  const dropped: Array<{ signal: string; reason: string }> = [];
  const deviceId = normalizeDeviceId(record.rida) ?? normalizeDeviceId(record.device_id);
  const ip = normalizeIp(record.ip);
  const ua = normalizeUserAgent(record.user_agent);

  const validIp = ip && isValidIp(ip) ? ip : null;
  const validDevice = deviceId && isValidDeviceId(deviceId) ? deviceId : null;
  const validUa = ua && isValidUserAgent(ua) ? ua : null;

  if (ip && !validIp) dropped.push({ signal: "ip", reason: "not a valid IPv4/IPv6 address" });
  if (deviceId && !validDevice) dropped.push({ signal: "device", reason: "not a plausible device/RIDA identifier" });
  if (ua && !validUa) dropped.push({ signal: "user_agent", reason: "user agent string too short or contains control characters" });

  return { valid: { ip: validIp, deviceId: validDevice, useragent: validUa }, dropped };
}