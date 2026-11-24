/**
 * Boots all seven services (in-memory bus, real Postgres), seeds the demo
 * household through the gateway and checks what crosses service boundaries.
 *
 *   TEST_DATABASE_URL_BASE=postgres://postgres@localhost:5432 pnpm test:e2e
 */
import { addDays, startOfWeek, todayManila } from "@mamamo/service-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAll } from "../scripts/dev-all";
import { DEMO_LOGINS, seed } from "../scripts/seed";

const base = process.env.TEST_DATABASE_URL_BASE;
const d = describe.skipIf(!base);

d("Mama Mo backend end to end", () => {
  let all: Awaited<ReturnType<typeof startAll>>;
  let api: string;
  let ids: { owner: string; bea: string; lorna: string; joy: string };
  const tokens: Record<string, string> = {};

  const call = async (who: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  beforeAll(async () => {
    all = await startAll({ databaseUrlBase: base!, dbPrefix: "mamamo_e2e", fresh: true, basePort: 0, gatewayPort: 0, env: { SWEEP_INTERVAL_MS: "3600000" } });
    api = all.gatewayUrl;
    const r = await seed(api, () => {});
    if (!r.seeded) throw new Error("seed did not run");
    ids = r.ids;
    await all.settle();
    for (const [who, body] of [
      ["owner", { kind: "email", ...DEMO_LOGINS.owner }],
      ["bea", { kind: "email", ...DEMO_LOGINS.member }],
      ["lorna", { kind: "pin", ...DEMO_LOGINS.helper }],
    ] as const) {
      tokens[who] = (await call(null, "POST", "/identity/auth/login", body)).body.token;
    }
  }, 120_000);

  afterAll(async () => {
    await all?.close();
  });

  it("rejects bad logins, helpers by email, and missing tokens", async () => {
    expect((await call(null, "POST", "/identity/auth/login", { kind: "pin", username: "lorna", pin: "0000" })).status).toBe(401);
    expect((await call(null, "POST", "/identity/auth/login", { kind: "email", email: "lorna@helper.mamamo.invalid", password: "12345678" })).status).toBe(401);
    expect((await call(null, "GET", "/meal/recipes")).status).toBe(401);
  });

  it("enforces roles in every service", async () => {
    expect((await call("lorna", "GET", "/reminder/bills")).status).toBe(403);
    expect((await call("lorna", "PUT", "/meal/meals", { date: todayManila(), slot: "lunch", title: "x" })).status).toBe(403);
    expect((await call("bea", "POST", `/staff/leaves/x/decide`, { decision: "approved" })).status).toBe(403);
    expect((await call("lorna", "GET", "/errand/errands")).body.every((e: { assigneeId: string }) => e.assigneeId === ids.lorna)).toBe(true);
  });

  it("refreshes an access token from the session", async () => {
    const login = await call(null, "POST", "/identity/auth/login", { kind: "email", ...DEMO_LOGINS.member });
    const refreshed = await call(null, "POST", "/identity/auth/refresh", { refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    await call(null, "POST", "/identity/auth/logout", { refreshToken: login.body.refreshToken });
    expect((await call(null, "POST", "/identity/auth/refresh", { refreshToken: login.body.refreshToken })).status).toBe(401);
  });

  it("builds the calendar from other services' events", async () => {
    const today = todayManila();
    const cal = (await call("owner", "GET", `/calendar/calendar?from=${addDays(today, -3)}&to=${addDays(today, 7)}`)).body as { kind: string; title: string; overdue?: boolean }[];
    const kinds = new Set(cal.map((e) => e.kind));
    for (const k of ["meal", "errand", "leave", "restday", "bill"]) expect(kinds.has(k)).toBe(true);
    expect(cal.some((e) => e.overdue && e.title === "Ligpitin ang labahan")).toBe(true);
    const helperCal = (await call("lorna", "GET", `/calendar/calendar?from=${today}&to=${addDays(today, 7)}`)).body as { kind: string }[];
    expect(helperCal.some((e) => e.kind === "bill")).toBe(false);
  });

  it("puts Low and Out supplies on this week's grocery list", async () => {
    const list = (await call("owner", "GET", `/meal/grocery?weekStart=${startOfWeek(todayManila())}`)).body;
    expect(list.items.filter((i: { source: string }) => i.source === "supply").map((i: { name: string }) => i.name).sort()).toEqual(["Cat litter", "LPG"]);
    const mantika = (await call("owner", "GET", "/reminder/supplies")).body.find((s: { name: string }) => s.name === "Mantika");
    await call("lorna", "POST", `/reminder/supplies/${mantika.id}/check`, { status: "out" });
    await all.settle();
    const after = (await call("owner", "GET", `/meal/grocery?weekStart=${startOfWeek(todayManila())}`)).body;
    expect(after.items.some((i: { name: string; source: string }) => i.name === "Mantika" && i.source === "supply")).toBe(true);
  });

  it("delivers reminders once, in each reader's voice", async () => {
    const inbox = (await call("owner", "GET", "/notification/inbox")).body as { kind: string; body: string; level: number }[];
    expect(inbox.some((i) => i.kind === "leave_requested" && i.body.startsWith("Anak, nagpaalam si Lorna"))).toBe(true);
    expect(inbox.some((i) => i.kind === "bill_due" && i.level >= 2)).toBe(true); // PLDT is overdue
    const before = inbox.length;
    expect((await call("owner", "POST", "/reminder/sweep")).body.fired).toBe(0); // already fired once
    await all.settle();
    expect((await call("owner", "GET", "/notification/inbox")).body.length).toBe(before);
    const lornaInbox = (await call("lorna", "GET", "/notification/inbox")).body as { body: string }[];
    expect(lornaInbox.some((i) => i.body.startsWith("Ate Lorna,"))).toBe(true);
  });

  it("marks a nudge read when the chore is done", async () => {
    const overdue = ((await call("lorna", "GET", "/notification/inbox")).body as { kind: string; subject: string; readAt?: string }[]).find((i) => i.kind === "errand_overdue" && !i.readAt);
    expect(overdue).toBeDefined();
    const [, errandId, date] = overdue!.subject.split(":");
    expect((await call("lorna", "PUT", "/errand/occurrences", { errandId, date, status: "done" })).status).toBe(200);
    await all.settle();
    const again = ((await call("lorna", "GET", "/notification/inbox")).body as { subject: string; readAt?: string }[]).find((i) => i.subject === overdue!.subject);
    expect(again?.readAt).toBeDefined();
  });

  it("files, reviews and decides a day-off under the leave rules", async () => {
    const tooMuch = await call("lorna", "POST", "/staff/leaves", { type: "accumulated_rest", startDate: addDays(todayManila(), 20), endDate: addDays(todayManila(), 25) });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe("leave.accumulated_insufficient");
    const [pending] = (await call("owner", "GET", "/staff/leaves/pending")).body;
    const impact = (await call("owner", "GET", `/calendar/leave-impact/${pending.id}`)).body;
    expect(Array.isArray(impact.errands) && Array.isArray(impact.meals)).toBe(true);
    expect((await call("owner", "POST", `/staff/leaves/${pending.id}/decide`, { decision: "approved" })).body.status).toBe("approved");
    expect((await call("owner", "POST", `/staff/leaves/${pending.id}/decide`, { decision: "approved" })).status).toBe(409);
    await all.settle();
    const lorna = (await call("lorna", "GET", "/notification/inbox")).body as { kind: string; title: string }[];
    expect(lorna.some((i) => i.kind === "leave_decided" && i.title === "Approved ang paalam mo")).toBe(true);
  });

  it("unassigns a removed member's errands and meals", async () => {
    expect((await call("owner", "DELETE", `/identity/members/${ids.joy}`)).status).toBe(200);
    await all.settle();
    const errands = (await call("owner", "GET", "/errand/errands")).body as { assigneeId?: string }[];
    expect(errands.some((e) => e.assigneeId === ids.joy)).toBe(false);
    const meals = (await call("owner", "GET", `/meal/meals?weekStart=${startOfWeek(todayManila())}`)).body as { cookId?: string }[];
    expect(meals.some((m) => m.cookId === ids.joy)).toBe(false);
    expect((await call(null, "POST", "/identity/auth/login", { kind: "pin", ...DEMO_LOGINS.helper2 })).status).toBe(401);
  });

  it("streams changes over SSE", async () => {
    const ac = new AbortController();
    const res = await fetch(`${api}/calendar/live?access_token=${tokens.owner}`, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    setTimeout(() => void call("bea", "POST", "/identity/notes", { body: "Nasa ref ang ulam" }), 100);
    let buf = "";
    const started = Date.now();
    while (!buf.includes("event: change") && Date.now() - started < 5000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    ac.abort();
    expect(buf).toContain('"topics":["household"]');
  });
});
