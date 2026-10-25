import { describe, expect, it } from "vitest";
import { chiSquarePValue, digitWins, expectedValue, lastDigit, theoreticalP } from "../stats";
describe("contract rules", () => {
  it("Over 5 wins only on 6-9", () => { expect(digitWins("OVER", 5, 5)).toBe(false); expect(digitWins("OVER", 6, 5)).toBe(true); expect(theoreticalP("OVER", 5)).toBeCloseTo(0.4); });
  it("Under 5 wins only on 0-4", () => { expect(digitWins("UNDER", 5, 5)).toBe(false); expect(theoreticalP("UNDER", 5)).toBeCloseTo(0.5); });
  it("total payout subtracts stake", () => { const r = expectedValue({ stake: 10, payout: 19.5, payoutIsTotal: true, pWin: 0.5 }); expect(r.profit).toBeCloseTo(9.5); expect(r.ev).toBeCloseTo(-0.25); });
  it("keeps trailing zero digit", () => { expect(lastDigit(1234.5, 2)).toBe(0); });
  it("chi-square p-value df9 at 16.919 ≈ 0.05", () => { expect(chiSquarePValue(16.919, 9)).toBeCloseTo(0.05, 2); });
});
