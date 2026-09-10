/** Masking for sensitive identifiers. Never a substitute for access control. */

export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const value = ip.trim();
  if (value.includes(".")) {
    const parts = value.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.xxx.xxx`;
    return "xxx.xxx.xxx.xxx";
  }
  if (value.includes(":")) {
    const head = value.split(":").slice(0, 3).join(":");
    return `${head}:xxxx:xxxx:xxxx:xxxx`;
  }
  return "xxx";
}

export function maskDeviceId(id: string | null | undefined): string | null {
  if (!id) return null;
  const value = id.trim();
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}-••••-••••-${value.slice(-4)}`;
}

export function maskUserAgent(ua: string | null | undefined, max = 80): string | null {
  if (!ua) return null;
  const trimmed = ua.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function maskCountry(country: string | null | undefined): string | null {
  return country ?? null;
}

export interface MaskOptions {
  ip?: boolean;
  deviceId?: boolean;
  userAgent?: boolean;
}

/**
 * Apply masking to a record row. `mask` defaults to all-on; callers (routes)
 * read the `mask_sensitive` setting to decide.
 */
export function maskRecord<T extends Record<string, unknown>>(record: T, options: MaskOptions = { ip: true, deviceId: true, userAgent: true }): T {
  const out = { ...record } as Record<string, unknown>;
  if (options.ip && typeof out.ip === "string") out.ip = maskIp(out.ip);
  if (options.deviceId && typeof out.rida === "string") out.rida = maskDeviceId(out.rida);
  if (options.deviceId && typeof out.device_id === "string") out.device_id = maskDeviceId(out.device_id);
  if (options.userAgent && typeof out.user_agent === "string") out.user_agent = maskUserAgent(out.user_agent);
  return out as T;
}