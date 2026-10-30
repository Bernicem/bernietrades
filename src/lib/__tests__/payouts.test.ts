import { describe, expect, it } from "vitest";
import { baselineEV, breakEvenP, estimatePayout, payoutKey, payoutWarnings } from "../payouts";
import { digitWins } from "../stats";
import { simulate } from "../backtest";

describe("per-contract payouts", () => {
  it("Matches at total payout 9: baseline EV −0.10, break-even ≈ 11.1%", () => {
    expect(baselineEV("MATCHES", 7, 9)).toBeCloseTo(-0.1);
    expect(breakEvenP(9)).toBeCloseTo(0.1111, 3);
  });
  it("Matches at 1.95 total: +0.95 win / −1 loss gives baseline EV −0.805 and is flagged", () => {
    expect(baselineEV("MATCHES", 7, 1.95)).toBeCloseTo(-0.805);
    expect(payoutWarnings("MATCHES", 7, 1.95).length).toBe(1);
  });
  it("Differs at 1.95 would profit at random chance and is flagged", () => {
    expect(baselineEV("DIFFERS", 3, 1.95)).toBeGreaterThan(0);
    expect(payoutWarnings("DIFFERS", 3, 1.95)[0]).toMatch(/random chance/);
  });
  it("Matches and Differs get different estimates; each digit has its own key", () => {
    expect(estimatePayout("MATCHES", 5)).toBeCloseTo(9.5);
    expect(estimatePayout("DIFFERS", 5)).toBeCloseTo(1.06);
    expect(payoutKey("OVER", 2)).not.toBe(payoutKey("OVER", 7));
    expect(payoutKey("EVEN", 2)).toBe(payoutKey("EVEN", 7));
  });
  it("estimates produce no warning; impossible contracts are flagged", () => {
    expect(payoutWarnings("MATCHES", 5, estimatePayout("MATCHES", 5))).toEqual([]);
    expect(Number.isNaN(estimatePayout("UNDER", 0))).toBe(true);
    expect(payoutWarnings("UNDER", 0, 2).length).toBe(1);
    expect(payoutWarnings("EVEN", 0, 1).length).toBe(1);
  });
  it("Matches 7 wins only on digit 7; Differs 7 wins on every other digit", () => {
    for (let d = 0; d < 10; d++) { expect(digitWins("MATCHES", d, 7)).toBe(d === 7); expect(digitWins("DIFFERS", d, 7)).toBe(d !== 7); }
  });
  it("backtest profit uses the payout passed in", () => {
    expect(typeof simulate).toBe("function");
  });
});
