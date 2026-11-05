import { describe, expect, it } from "vitest";
import { pipDecimals, sanitizeHistory, parseLiveTick } from "../ticks";

describe("precision formats", () => {
  it("accepts pip step sizes", () => {
    expect(pipDecimals(0.01)).toBe(2);
    expect(pipDecimals(0.001)).toBe(3);
    expect(pipDecimals(0.1)).toBe(1);
    expect(pipDecimals(0.0001)).toBe(4);
  });
  it("accepts decimal-place counts", () => {
    expect(pipDecimals(2)).toBe(2);
    expect(pipDecimals(3)).toBe(3);
    expect(pipDecimals(5)).toBe(5);
  });
  it("rejects invalid and unsupported precision values", () => {
    for (const v of [undefined, null, 0, -2, 1.5, 11, NaN, Infinity, "2", {}]) {
      expect(pipDecimals(v)).toBeNull();
    }
  });
});

describe("digit extraction with valid precision", () => {
  it("extracts the last digit, preserving trailing zeros", () => {
    expect(sanitizeHistory([513.2, 513.25, 513.27], [1, 2, 3], 2).map((t) => t.digit)).toEqual([0, 5, 7]);
    expect(sanitizeHistory([1.234], [1], 3)[0].digit).toBe(4);
    expect(parseLiveTick({ quote: 99.9, epoch: 5 }, 1)!.digit).toBe(9);
  });
});

describe("invalid precision rejects data instead of guessing", () => {
  it("history with null precision yields no ticks", () => {
    expect(sanitizeHistory([513.2, 513.25], [1, 2], null)).toEqual([]);
  });
  it("live tick with null precision is dropped", () => {
    expect(parseLiveTick({ quote: 513.25, epoch: 1 }, null)).toBeNull();
  });
  it("valid precision still parses the same data", () => {
    expect(sanitizeHistory([513.2, 513.25], [1, 2], 2).length).toBe(2);
    expect(parseLiveTick({ quote: 513.25, epoch: 1 }, 2)).not.toBeNull();
  });
});
