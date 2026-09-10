import { describe, expect, it } from "vitest";
import { isValidIp, isValidDeviceId, isValidUserAgent, validateSignals } from "../src/utils/validation.js";

describe("validation", () => {
  it("accepts valid IPv4 and IPv6", () => {
    expect(isValidIp("198.51.100.7")).toBe(true);
    expect(isValidIp("203.0.113.255")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("::1")).toBe(true);
  });

  it("rejects invalid IPs", () => {
    expect(isValidIp("999.1.1.1")).toBe(false);
    expect(isValidIp("1.2.3")).toBe(false);
    expect(isValidIp("1.2.3.4.5")).toBe(false);
    expect(isValidIp("1.2.3.4,5.6.7.8")).toBe(false);
    expect(isValidIp("not-an-ip")).toBe(false);
    expect(isValidIp("")).toBe(false);
    expect(isValidIp(null)).toBe(false);
  });

  it("accepts UUID-style RIDA (incl. Pixalate's documented example) and rejects garbage", () => {
    expect(isValidDeviceId("11111111-1111-4111-8111-111111111111")).toBe(true);
    // RIDA example straight from the Pixalate Fraud API spec (variant nibble 'd' is not RFC-strict)
    expect(isValidDeviceId("331319d2-4cc2-51ac-de21-aa62f1e143c1")).toBe(true);
    // ADID / MD5 / SHA1 examples from the spec
    expect(isValidDeviceId("FF67345D-BF11-7823-1111-FFED421776FC")).toBe(true);
    expect(isValidDeviceId("d9527b5207097c5770ca448322489426")).toBe(true);
    expect(isValidDeviceId("2971074629cc8f33146c5eb08b39f157da5ce356")).toBe(true);
    expect(isValidDeviceId("abcdef0123456789abcdef0123456789")).toBe(true);
    expect(isValidDeviceId("abc")).toBe(false);
    expect(isValidDeviceId("!!not a device!!")).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
  });

  it("accepts plausible user agents and rejects control chars / empty", () => {
    expect(isValidUserAgent("Roku/DVP-10.5 (Roku Ultra; 4K; A1B2C3D4)")).toBe(true);
    expect(isValidUserAgent("short")).toBe(false);
    expect(isValidUserAgent("bad\u0007ua")).toBe(false);
    expect(isValidUserAgent("")).toBe(false);
  });

  it("validates signal combos without rejecting records for missing signals", () => {
    const full = validateSignals({ ip: "198.51.100.7", rida: "11111111-1111-4111-8111-111111111111", user_agent: "Roku/DVP-10 (Roku Ultra)" });
    expect(full.valid.ip).toBe("198.51.100.7");
    expect(full.valid.deviceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(full.valid.useragent).toBe("Roku/DVP-10 (Roku Ultra)");
    expect(full.dropped).toHaveLength(0);

    const ipOnly = validateSignals({ ip: "198.51.100.7" });
    expect(ipOnly.valid.deviceId).toBeNull();
    expect(ipOnly.valid.useragent).toBeNull();
    expect(ipOnly.dropped).toHaveLength(0);

    const invalid = validateSignals({ ip: "999.999.999.999", rida: "11111111-1111-4111-8111-111111111111" });
    expect(invalid.valid.ip).toBeNull();
    expect(invalid.dropped.map((d) => d.signal)).toContain("ip");
    expect(invalid.valid.deviceId).toBe("11111111-1111-4111-8111-111111111111");
  });
});