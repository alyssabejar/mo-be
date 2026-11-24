import { describe, expect, it } from "vitest";
import { computeBalance, daysInRange, isSilEligible, validateLeave } from "./leave-rules";
import type { LeaveRequest } from "./staff";

const base = {
  householdId: "h1",
  helperId: "u3",
  status: "approved" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("leave rules (RA 10361)", () => {
  it("counts days inclusively", () => {
    expect(daysInRange("2026-11-24", "2026-11-24")).toBe(1);
    expect(daysInRange("2026-11-24", "2026-11-28")).toBe(5);
    expect(daysInRange("2026-12-30", "2027-01-02")).toBe(4);
  });

  it("gives SIL only after one year of service", () => {
    expect(isSilEligible("2025-11-25", "2026-11-24")).toBe(false);
    expect(isSilEligible("2025-11-24", "2026-11-24")).toBe(true);
  });

  it("caps accumulated rest at 5 and deducts used days", () => {
    const requests: LeaveRequest[] = [
      { ...base, id: "a", type: "accumulated_rest", startDate: "2026-03-02", endDate: "2026-03-03" },
    ];
    const b = computeBalance({ helperId: "u3", hireDate: "2024-06-01", today: "2026-11-24", accumulatedRestEarned: 9, requests });
    expect(b.accumulatedRest).toBe(3);
  });

  it("does not carry SIL over to the next year", () => {
    const requests: LeaveRequest[] = [
      { ...base, id: "a", type: "service_incentive", startDate: "2025-04-01", endDate: "2025-04-05" },
    ];
    const b = computeBalance({ helperId: "u3", hireDate: "2024-06-01", today: "2026-11-24", accumulatedRestEarned: 0, requests });
    expect(b.silRemaining).toBe(5);
  });

  it("rejects SIL beyond the remaining balance", () => {
    const balance = { helperId: "u3", year: 2026, accumulatedRest: 0, silRemaining: 2, silEligible: true };
    const err = validateLeave({
      type: "service_incentive",
      startDate: "2026-12-01",
      endDate: "2026-12-03",
      today: "2026-11-24",
      balance,
      existing: [],
    });
    expect(err).toEqual({ code: "sil_insufficient", remaining: 2, requested: 3 });
  });

  it("rejects overlapping requests but ignores rejected ones", () => {
    const balance = { helperId: "u3", year: 2026, accumulatedRest: 5, silRemaining: 5, silEligible: true };
    const existing: LeaveRequest[] = [
      { ...base, id: "x", type: "unpaid", startDate: "2026-12-02", endDate: "2026-12-02" },
      { ...base, id: "y", status: "rejected", type: "unpaid", startDate: "2026-12-05", endDate: "2026-12-05" },
    ];
    const args = { type: "unpaid" as const, today: "2026-11-24", balance, existing };
    expect(validateLeave({ ...args, startDate: "2026-12-01", endDate: "2026-12-03" })).toEqual({ code: "overlaps", with: "x" });
    expect(validateLeave({ ...args, startDate: "2026-12-05", endDate: "2026-12-05" })).toBeNull();
  });

  it("allows emergency leave starting in the past", () => {
    const balance = { helperId: "u3", year: 2026, accumulatedRest: 0, silRemaining: 0, silEligible: false };
    expect(
      validateLeave({ type: "emergency", startDate: "2026-11-23", endDate: "2026-11-24", today: "2026-11-24", balance, existing: [] }),
    ).toBeNull();
  });
});
