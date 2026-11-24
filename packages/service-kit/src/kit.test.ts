import type { Errand, ErrandOccurrence } from "@mamamo/contracts";
import { describe, expect, it } from "vitest";
import { envelope, memoryBus, subjectMatches } from "./bus";
import { addDays, billDueDate, expandRule, inQuietHours, startOfWeek, todayManila } from "./dates";
import { errandInstances } from "./errands";
import { liveTopicsFor } from "./subjects";

describe("subjectMatches", () => {
  it("handles * and >", () => {
    expect(subjectMatches("errand.*", "errand.upserted")).toBe(true);
    expect(subjectMatches("errand.*", "errand.occurrence.completed")).toBe(false);
    expect(subjectMatches("errand.>", "errand.occurrence.completed")).toBe(true);
    expect(subjectMatches("staff.leave.requested", "staff.leave.requested")).toBe(true);
    expect(subjectMatches("staff.leave.*", "staff.profile.upserted")).toBe(false);
    expect(subjectMatches(">", "anything.at.all")).toBe(true);
  });
});

describe("memoryBus", () => {
  it("delivers in order, replays history to new durables, and dedupes by id", async () => {
    const bus = memoryBus();
    const seen: string[] = [];
    const e1 = envelope("errand.upserted", "hh", { n: 1 });
    await bus.publish(e1);
    await bus.subscribe("a", ["errand.>"], async (e) => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(`${e.subject}:${(e.data as { n: number }).n}`);
    });
    await bus.publish(envelope("errand.archived", "hh", { n: 2 }));
    await bus.publish(e1); // duplicate id: ignored
    await bus.publish(envelope("meal.slot.upserted", "hh", { n: 3 })); // not subscribed
    await bus.idle();
    expect(seen).toEqual(["errand.upserted:1", "errand.archived:2"]);
  });

  it("retries a failing handler", async () => {
    const bus = memoryBus();
    let calls = 0;
    await bus.subscribe("a", ["x.>"], async () => {
      calls++;
      if (calls < 3) throw new Error("flaky");
    });
    await bus.publish(envelope("x.y" as never, "hh", {}));
    await bus.idle();
    expect(calls).toBe(3);
  });
});

describe("dates", () => {
  it("does day arithmetic on plain dates", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23"); // Sunday → Monday before
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23");
  });

  it("uses Asia/Manila for today", () => {
    expect(todayManila(new Date("2026-11-24T16:30:00Z"))).toBe("2026-11-25");
  });

  it("expands RRULEs between two dates", () => {
    expect(expandRule("FREQ=WEEKLY;BYDAY=MO,TH", "2026-11-02", "2026-11-09", "2026-11-15")).toEqual(["2026-11-09", "2026-11-12"]);
    expect(expandRule(undefined, "2026-11-10", "2026-11-09", "2026-11-15")).toEqual(["2026-11-10"]);
  });

  it("clamps bill due days to the month", () => {
    expect(billDueDate(2026, 1, 31)).toBe("2026-02-28");
  });

  it("handles quiet hours across midnight", () => {
    expect(inQuietHours("23:00", "22:00", "06:00")).toBe(true);
    expect(inQuietHours("05:59", "22:00", "06:00")).toBe(true);
    expect(inQuietHours("12:00", "22:00", "06:00")).toBe(false);
  });
});

describe("errandInstances", () => {
  const base: Errand = {
    id: "e1",
    householdId: "hh",
    title: "Labahan",
    category: "laundry",
    priority: "normal",
    assigneeId: "helper",
    startDate: "2026-11-02",
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    createdBy: "owner",
    createdAt: "2026-11-01T00:00:00.000Z",
    archived: false,
  };

  it("applies done and rescheduled exceptions and flags overdue", () => {
    const occ: ErrandOccurrence[] = [
      { errandId: "e1", date: "2026-11-09", status: "done" },
      { errandId: "e1", date: "2026-11-16", status: "rescheduled", rescheduledTo: "2026-11-18" },
    ];
    const out = errandInstances({ errands: [base], occurrences: occ, from: "2026-11-09", to: "2026-11-24", today: "2026-11-24" });
    expect(out.map((i) => [i.date, i.dueDate, i.overdue])).toEqual([
      ["2026-11-09", "2026-11-09", false],
      ["2026-11-18", "2026-11-16", true],
      ["2026-11-23", "2026-11-23", true],
    ]);
  });

  it("shows helpers only their own errands", () => {
    const other = { ...base, id: "e2", assigneeId: "someone-else" };
    const out = errandInstances({ errands: [base, other], occurrences: [], from: "2026-11-09", to: "2026-11-09", today: "2026-11-01", viewer: { id: "helper", role: "helper" } });
    expect(out.map((i) => i.errand.id)).toEqual(["e1"]);
  });
});

describe("liveTopicsFor", () => {
  it("maps subjects to browser query families", () => {
    expect(liveTopicsFor("supply.checked")).toEqual(["supplies", "grocery"]);
    expect(liveTopicsFor("identity.note.changed")).toEqual(["household"]);
    expect(liveTopicsFor("identity.user.updated")).toEqual(["members"]);
    expect(liveTopicsFor("reminder.due")).toEqual([]);
  });
});
