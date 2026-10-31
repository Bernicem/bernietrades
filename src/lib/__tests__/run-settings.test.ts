import { describe, expect, it } from "vitest";
import { runLabel, runSettings, settingsChanged } from "../payouts";

describe("backtest run settings", () => {
  const ran = runSettings("MATCHES", 6, 1.95);
  it("keeps the contract, digit and payout used for the run", () => {
    expect(ran).toEqual({ contract: "MATCHES", barrier: 6, payout: 1.95 });
    expect(runLabel(ran)).toBe("MATCHES 6");
    expect(runLabel(runSettings("EVEN", 6, 1.95))).toBe("EVEN");
  });
  it("marks results outdated when contract, digit or payout changes", () => {
    expect(settingsChanged(ran, runSettings("DIFFERS", 6, 1.95))).toBe(true);
    expect(settingsChanged(ran, runSettings("MATCHES", 7, 1.95))).toBe(true);
    expect(settingsChanged(ran, runSettings("MATCHES", 6, 9.5))).toBe(true);
  });
  it("running again with current settings clears the outdated state", () => {
    const now = runSettings("MATCHES", 7, 9.5);
    expect(settingsChanged(now, runSettings("MATCHES", 7, 9.5))).toBe(false);
    expect(settingsChanged(runSettings("EVEN", 3, 1.95), runSettings("EVEN", 8, 1.95))).toBe(false); // digit irrelevant for EVEN
  });
});
