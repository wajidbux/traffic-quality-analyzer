import { describe, expect, it } from "vitest";
import { classifyRisk, histogramBin, riskBandLabel, RISK_BAND_ORDER } from "../src/services/riskClassifier.js";

const bands = { elevatedFrom: 0.5, highFrom: 0.75, veryHighFrom: 0.9 };

describe("riskClassifier", () => {
  it("classifies probabilities into the default bands", async () => {
    expect(await classifyRisk(0.0, bands)).toBe("lower");
    expect(await classifyRisk(0.49, bands)).toBe("lower");
    expect(await classifyRisk(0.5, bands)).toBe("elevated");
    expect(await classifyRisk(0.74, bands)).toBe("elevated");
    expect(await classifyRisk(0.75, bands)).toBe("high");
    expect(await classifyRisk(0.89, bands)).toBe("high");
    expect(await classifyRisk(0.9, bands)).toBe("very_high");
    expect(await classifyRisk(1.0, bands)).toBe("very_high");
  });

  it("treats null probability as lower (no score = not flagged)", async () => {
    expect(await classifyRisk(null, bands)).toBe("lower");
  });

  it("respects custom thresholds", async () => {
    const custom = { elevatedFrom: 0.3, highFrom: 0.6, veryHighFrom: 0.8 };
    expect(await classifyRisk(0.4, custom)).toBe("elevated");
    expect(await classifyRisk(0.7, custom)).toBe("high");
    expect(await classifyRisk(0.85, custom)).toBe("very_high");
  });

  it("labels bands clearly as analytical categories", () => {
    expect(riskBandLabel("lower")).toBe("Lower risk");
    expect(riskBandLabel("very_high")).toBe("Very high risk");
    expect(RISK_BAND_ORDER).toEqual(["lower", "elevated", "high", "very_high"]);
  });

  it("maps histogram bins", () => {
    expect(histogramBin(0.05)).toBe(0);
    expect(histogramBin(0.55)).toBe(5);
    expect(histogramBin(0.99)).toBe(9);
    expect(histogramBin(1.0)).toBe(9);
  });
});