/**
 * Load the demo household (the same one mo-ui's mock shows) through the real API,
 * so every event, projection and reminder is produced the way production would.
 *
 *   API_URL=http://localhost:8080/api pnpm seed
 */
import type { Ingredient, User } from "@mamamo/contracts";
import { addDays, expandRule, startOfWeek, todayManila, toUtcDate, weekDates } from "@mamamo/service-kit";

export const DEMO_LOGINS = {
  owner: { email: "archimedes@mamamo.app", password: "mamamo123" },
  member: { email: "bea@mamamo.app", password: "mamamo123" },
  helper: { username: "lorna", pin: "1234" },
  helper2: { username: "joy", pin: "5678" },
};

const P = (pesos: number) => Math.round(pesos * 100);
const ing = (name: string, qty: number, unit?: string, pesos?: number): Ingredient => ({
  name,
  qty,
  ...(unit ? { unit } : {}),
  ...(pesos !== undefined ? { estPrice: P(pesos) } : {}),
});

class Client {
  token?: string;
  constructor(private base: string) {}
  async call<T = any>(method: string, path: string, body?: unknown, ok: number[] = []): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok && !ok.includes(res.status)) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return data as T;
  }
  async login(body: object) {
    const r = await this.call<{ token: string; user: User }>("POST", "/identity/auth/login", body);
    this.token = r.token;
    return r.user;
  }
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, tries = 50): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export async function seed(base: string, log: (m: string) => void = console.log) {
  const today = todayManila();
  const weekStart = startOfWeek(today);
  const owner = new Client(base);

  const boot = await owner.call("POST", "/identity/households/bootstrap", {
    householdName: "SKMC House",
    weeklyGroceryBudget: P(7500),
    owner: { displayName: "Archimedes", email: DEMO_LOGINS.owner.email, password: DEMO_LOGINS.owner.password, mamaCallsMe: "Anak", locale: "tl" },
  }, [409]);
  if (boot?.code === "already_bootstrapped") {
    log("Already seeded; nothing to do. Start from fresh databases to seed again.");
    return { seeded: false as const };
  }
  const ownerUser = await owner.login({ kind: "email", ...DEMO_LOGINS.owner });
  await owner.call("PATCH", "/identity/profile", { channels: { inApp: true, webPush: true, slack: true } });
  log("household + owner");

  const bea = await owner.call<User>("POST", "/identity/members", { displayName: "Bea", ...DEMO_LOGINS.member, mamaCallsMe: "Anak", locale: "en" });
  const lorna = await owner.call<User>("POST", "/identity/members/helpers", {
    displayName: "Lorna", username: "lorna", pin: "1234", mamaCallsMe: "Ate Lorna", locale: "tl", hireDate: "2024-06-01", birthDate: "1979-08-15",
  });
  const joyHire = `${Number(today.slice(0, 4)) - (today.slice(5) < "03-01" ? 1 : 0)}-03-01`;
  const joy = await owner.call<User>("POST", "/identity/members/helpers", {
    displayName: "Joy", username: "joy", pin: "5678", mamaCallsMe: "Ate Joy", locale: "tl", hireDate: joyHire, birthDate: "2002-03-09",
  });
  await waitFor("helper profiles", async () => {
    const ps = await owner.call<any[]>("GET", "/staff/profiles");
    return ps.length >= 2 ? ps : undefined;
  });
  await owner.call("PATCH", `/staff/profiles/${joy.id}`, { restDay: "SA", accumulatedRestEarned: 1 });
  await owner.call("PATCH", `/staff/profiles/${lorna.id}`, { accumulatedRestEarned: 3 });
  log("members: Bea, Lorna, Joy");

  const recipeDefs: [string, string, string[], Ingredient[], string?][] = [
    ["adobo", "Adobong Manok", ["ulam", "manok"], [ing("Manok", 1, "kg", 220), ing("Toyo", 0.25, "L", 20), ing("Suka", 0.25, "L", 15), ing("Bawang", 1, "ulo", 15), ing("Dahon ng laurel", 1, "pack", 10)], "Huwag haluin hanggang kumulo ang suka."],
    ["sinigang", "Sinigang na Baboy", ["ulam", "baboy", "sabaw"], [ing("Baboy liempo", 1, "kg", 380), ing("Sampalok mix", 1, "pack", 25), ing("Kangkong", 1, "tali", 20), ing("Labanos", 1, "pc", 20), ing("Sitaw", 1, "tali", 20), ing("Kamatis", 4, "pcs", 20), ing("Sibuyas", 1, "pc", 10)]],
    ["tinola", "Tinolang Manok", ["ulam", "manok", "sabaw"], [ing("Manok", 1, "kg", 220), ing("Sayote", 2, "pcs", 30), ing("Dahon ng sili", 1, "tali", 15), ing("Luya", 1, "pc", 10)]],
    ["monggo", "Ginisang Monggo", ["ulam", "gulay", "biyernes"], [ing("Monggo", 0.5, "kg", 60), ing("Dahon ng ampalaya", 1, "tali", 15), ing("Chicharon", 1, "pack", 30), ing("Kamatis", 2, "pcs", 10), ing("Bawang", 1, "ulo", 15)]],
    ["champorado", "Champorado", ["almusal", "matamis"], [ing("Malagkit", 0.5, "kg", 45), ing("Tablea", 1, "pack", 60), ing("Evaporated milk", 1, "lata", 45)]],
    ["tapsilog", "Tapsilog", ["almusal"], [ing("Tapa", 0.5, "kg", 180), ing("Itlog", 6, "pcs", 54)]],
    ["pandesal", "Pandesal at Itlog", ["almusal"], [ing("Pandesal", 10, "pcs", 50), ing("Itlog", 4, "pcs", 36)]],
    ["canton", "Pancit Canton", ["merienda", "noodles"], [ing("Canton noodles", 1, "pack", 60), ing("Repolyo", 0.5, "ulo", 30), ing("Carrots", 2, "pcs", 20), ing("Baboy", 0.25, "kg", 90)]],
    ["turon", "Turon", ["merienda", "matamis"], [ing("Saging na saba", 6, "pcs", 36), ing("Lumpia wrapper", 1, "pack", 35), ing("Brown sugar", 0.25, "kg", 20)]],
    ["bananacue", "Banana Cue", ["merienda", "matamis"], [ing("Saging na saba", 8, "pcs", 48), ing("Brown sugar", 0.5, "kg", 40)]],
    ["shanghai", "Lumpiang Shanghai", ["ulam", "baboy"], [ing("Giniling na baboy", 0.5, "kg", 160), ing("Lumpia wrapper", 1, "pack", 35), ing("Carrots", 1, "pc", 10), ing("Sibuyas", 1, "pc", 10)]],
    ["karekare", "Kare-Kare", ["ulam", "baka", "linggo"], [ing("Buntot ng baka", 1, "kg", 450), ing("Peanut butter", 1, "jar", 90), ing("Sitaw", 1, "tali", 20), ing("Talong", 3, "pcs", 30), ing("Pechay", 1, "tali", 25), ing("Bagoong", 1, "jar", 70)]],
    ["paksiw", "Paksiw na Bangus", ["ulam", "isda"], [ing("Bangus", 1, "pc", 180), ing("Suka", 0.25, "L", 15), ing("Talong", 2, "pcs", 20), ing("Ampalaya", 1, "pc", 25)]],
    ["arrozcaldo", "Arroz Caldo", ["almusal", "sabaw"], [ing("Malagkit", 0.5, "kg", 45), ing("Manok", 0.5, "kg", 110), ing("Luya", 1, "pc", 10), ing("Itlog", 3, "pcs", 27)]],
  ];
  const recipe = new Map<string, { id: string; name: string }>();
  for (const [key, name, tags, ingredients, notes] of recipeDefs) {
    const r = await owner.call("POST", "/meal/recipes", { name, language: "tl", tags, ingredients, ...(notes ? { notes } : {}) });
    recipe.set(key, r);
  }
  log(`${recipe.size} recipes`);

  // [breakfast, lunch, merienda, dinner]; null = not planned yet.
  const plan: (string | null)[][] = [
    ["pandesal", "adobo", "turon", "tinola"],
    ["champorado", "sinigang", null, "shanghai"],
    ["tapsilog", "paksiw", "canton", "adobo"],
    ["arrozcaldo", "tinola", "bananacue", "sinigang"],
    ["pandesal", "monggo", "turon", "paksiw"],
    ["tapsilog", "shanghai", null, null],
    ["champorado", "karekare", "canton", null],
  ];
  const slots = ["breakfast", "lunch", "merienda", "dinner"] as const;
  let mealCount = 0;
  for (const [d, date] of weekDates(weekStart).entries()) {
    for (const [s, key] of plan[d]!.entries()) {
      if (!key) continue;
      const slot = slots[s]!;
      const cookId = d === 6 && slot === "lunch" ? bea.id : slot === "breakfast" || slot === "merienda" ? joy.id : lorna.id;
      const r = recipe.get(key)!;
      await owner.call("PUT", "/meal/meals", { date, slot, recipeId: r.id, title: r.name, cookId });
      mealCount++;
    }
  }
  for (const [d, date] of weekDates(addDays(weekStart, -7)).entries()) {
    const key = plan[(d + 3) % 7]![1];
    if (!key) continue;
    const r = recipe.get(key)!;
    await owner.call("PUT", "/meal/meals", { date, slot: "lunch", recipeId: r.id, title: r.name, cookId: lorna.id });
    mealCount++;
  }
  log(`${mealCount} meals`);

  const supplyDefs: [string, "pet" | "food" | "household", string, number, string, number, "ok" | "low"][] = [
    ["Cat food", "pet", "FREQ=WEEKLY;BYDAY=MO,TH", 1, "bag (3 kg)", 650, "ok"],
    ["Cat litter", "pet", "FREQ=WEEKLY;BYDAY=MO,TH", 1, "bag (10 L)", 380, "low"],
    ["Bigas", "food", "FREQ=WEEKLY;BYDAY=SA", 1, "sako (25 kg)", 1350, "ok"],
    ["Mantika", "food", "FREQ=WEEKLY;BYDAY=WE", 1, "L", 120, "ok"],
    ["Toyo at suka", "food", "FREQ=WEEKLY;BYDAY=WE", 1, "set", 70, "ok"],
    ["LPG", "household", "FREQ=WEEKLY;BYDAY=FR", 1, "tank (11 kg)", 1050, "low"],
    ["Sabon panlaba", "household", "FREQ=WEEKLY;BYDAY=SA", 1, "pack", 180, "ok"],
  ];
  const helperLorna = new Client(base);
  await helperLorna.login({ kind: "pin", ...DEMO_LOGINS.helper });
  for (const [name, category, checkRule, restockQty, restockUnit, price, status] of supplyDefs) {
    const s = await owner.call("POST", "/reminder/supplies", { name, category, checkRule, checkStartDate: addDays(today, -56), assigneeId: lorna.id, restockQty, restockUnit, estPrice: P(price) });
    await helperLorna.call("POST", `/reminder/supplies/${s.id}/check`, { status });
  }
  log(`${supplyDefs.length} supplies`);

  const errStart = addDays(today, -21);
  const errandDefs = [
    { key: "labahan", title: "Labahan", category: "laundry", priority: "normal", assigneeId: lorna.id, time: "08:00", rrule: "FREQ=WEEKLY;BYDAY=MO,TH" },
    { key: "ligpit", title: "Ligpitin ang labahan", category: "laundry", priority: "normal", assigneeId: lorna.id, time: "16:00", rrule: "FREQ=WEEKLY;BYDAY=TU,FR" },
    { key: "cr", title: "Linisin ang CR", category: "cleaning", priority: "normal", assigneeId: lorna.id, time: "10:00", rrule: "FREQ=WEEKLY;BYDAY=WE,SA" },
    { key: "halaman", title: "Diligan ang halaman", category: "garden", priority: "low", assigneeId: joy.id, time: "06:30", rrule: "FREQ=DAILY" },
    { key: "litter", title: "Linisin ang litter box", category: "pets", priority: "normal", assigneeId: joy.id, time: "07:30", rrule: "FREQ=DAILY" },
    { key: "palengke", title: "Palengke", category: "shopping", priority: "high", assigneeId: bea.id, time: "07:00", rrule: "FREQ=WEEKLY;BYDAY=SA" },
  ];
  let doneCount = 0;
  for (const def of errandDefs) {
    const { key, ...body } = def;
    const e = await owner.call("POST", "/errand/errands", { ...body, startDate: errStart });
    const past = expandRule(e.rrule, e.startDate, errStart, addDays(today, -1));
    for (const [i, date] of past.entries()) {
      if (key === "ligpit" && i === past.length - 1) continue; // leave one overdue for the Sermon
      await owner.call("PUT", "/errand/occurrences", { errandId: e.id, date, status: key === "halaman" && i % 9 === 4 ? "skipped" : "done" });
      doneCount++;
    }
  }
  await owner.call("POST", "/errand/errands", { title: "Pa-cleaning ang aircon", notes: "Tawagan si Mang Ben, 0917 000 0000", category: "other", priority: "high", assigneeId: ownerUser.id, startDate: addDays(today, 3), time: "14:00" });
  await owner.call("POST", "/errand/errands", { title: "Punasan ang mga bintana", category: "cleaning", priority: "low", startDate: addDays(today, 1) });
  log(`${errandDefs.length + 2} errands, ${doneCount} past occurrences marked`);

  // Meralco falls due tomorrow, PLDT is two days overdue.
  const dayOf = (d: string) => toUtcDate(d).getUTCDate();
  const twoDaysAgo = addDays(today, -2);
  const billDefs = [
    { name: "Meralco", kind: "electricity", provider: "Meralco", accountNumber: "•••• 4821", dueDay: dayOf(addDays(today, 1)), remindDaysBefore: 3, assigneeId: ownerUser.id, typicalAmount: P(3200) },
    { name: "Maynilad", kind: "water", provider: "Maynilad", accountNumber: "•••• 1190", dueDay: 20, remindDaysBefore: 3, assigneeId: bea.id, typicalAmount: P(650) },
    { name: "PLDT Fibr", kind: "internet", provider: "PLDT", accountNumber: "•••• 7765", dueDay: dayOf(twoDaysAgo), remindDaysBefore: 2, assigneeId: ownerUser.id, typicalAmount: P(1699) },
  ];
  for (const b of billDefs) await owner.call("POST", "/reminder/bills", b);
  const billList = await owner.call<any[]>("GET", "/reminder/bills");
  for (const b of billList) {
    for (const c of b.cycles) {
      const overdueDemo = b.name === "PLDT Fibr" && c.dueDate === twoDaysAgo;
      if (c.dueDate < today && !overdueDemo) await owner.call("POST", "/reminder/bills/pay", { cycleId: c.id, amount: b.typicalAmount + ((c.dueDate.charCodeAt(9) % 7) - 3) * 3500 });
    }
  }
  log(`${billDefs.length} bills`);

  const catTree = await owner.call("POST", "/reminder/parcels", { trackingNumber: "SPXPH0498812733", courier: "SPX", description: "Cat tree (Shopee)", codAmount: P(1299) });
  await owner.call("POST", `/reminder/parcels/${catTree.id}/refresh`);
  await owner.call("POST", `/reminder/parcels/${catTree.id}/refresh`);
  const bea2 = new Client(base);
  await bea2.login({ kind: "email", ...DEMO_LOGINS.member });
  const pot = await bea2.call("POST", "/reminder/parcels", { trackingNumber: "JT7720014598", courier: "J&T", description: "Rice cooker inner pot (Lazada)" });
  await bea2.call("POST", `/reminder/parcels/${pot.id}/refresh`);
  const books = await owner.call("POST", "/reminder/parcels", { trackingNumber: "LBC1188204411", courier: "LBC", description: "Books from Tita Cora" });
  await helperLorna.call("POST", `/reminder/parcels/${books.id}/received`, { by: "Lorna" });
  log("3 parcels");

  await helperLorna.call("POST", "/staff/leaves", {
    type: "rest_day_swap",
    startDate: addDays(weekStart, 9), // Wednesday next week
    endDate: addDays(weekStart, 9),
    swapFrom: addDays(weekStart, 13), // instead of Sunday
    reason: "May lakad sa Quiapo",
  });
  log("1 pending day-off");

  await helperLorna.call("POST", "/identity/notes", { body: "Paubos na ang LPG, mga 2 araw pa siguro." });
  const guest = await owner.call("POST", "/identity/notes", { body: "May bisita sa Sabado, 6 kami sa hapunan." });
  await owner.call("POST", `/identity/notes/${guest.id}/pin`);
  log("2 notes");

  await owner.call("POST", "/reminder/sweep");
  log("reminder sweep run");
  return { seeded: true as const, ids: { owner: ownerUser.id, bea: bea.id, lorna: lorna.id, joy: joy.id } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.API_URL ?? "http://localhost:8080/api";
  const r = await seed(base);
  if (r.seeded) {
    console.log("\nDemo logins:");
    console.log(`  owner   ${DEMO_LOGINS.owner.email} / ${DEMO_LOGINS.owner.password}`);
    console.log(`  member  ${DEMO_LOGINS.member.email} / ${DEMO_LOGINS.member.password}`);
    console.log(`  helper  ${DEMO_LOGINS.helper.username} / PIN ${DEMO_LOGINS.helper.pin}`);
    console.log(`  helper  ${DEMO_LOGINS.helper2.username} / PIN ${DEMO_LOGINS.helper2.pin}`);
  }
}
