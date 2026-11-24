/**
 * Notification templates. Ported from mo-ui's mock (which mirrors this file);
 * keep the two in step when wording changes.
 *
 * One mama voice for everyone; only {{tawag}} (users.mama_calls_me) changes.
 * Levels 2 and 3 are the Sermon: overdue nudges that escalate in tone.
 * Plain mode drops the voice entirely.
 */
import type { User } from "@mamamo/contracts";
import { fill, type TemplateKey } from "@mamamo/service-kit";

type Variant = { title: string; body: string };
type Levels = { 1: Variant; 2?: Variant; 3?: Variant };
type Voice = { mama: Levels; plain: Variant };

const T: Record<TemplateKey, Record<"en" | "tl", Voice>> = {
  bill_due: {
    tl: {
      mama: {
        1: { title: "{{bill}} due {{when}}", body: "{{tawag}}, {{bill}} due na {{when}}. Bayaran mo na." },
        2: { title: "Lampas na: {{bill}}", body: "{{tawag}}, lampas na sa due ang {{bill}}. Huwag mo nang hintayin na putulan tayo." },
        3: { title: "{{bill}}! Ngayon na!", body: "Ilang beses ko bang sasabihin? Bayaran mo na ang {{bill}}, {{tawag}}. {{amount}} lang 'yan." },
      },
      plain: { title: "{{bill}} due {{when}}", body: "Due ang {{bill}} {{when}} ({{amount}})." },
    },
    en: {
      mama: {
        1: { title: "{{bill}} is due {{when}}", body: "{{tawag}}, {{bill}} is due {{when}}. Pay it na, ha." },
        2: { title: "Overdue: {{bill}}", body: "{{tawag}}, {{bill}} is past due. Don't wait for them to cut us off." },
        3: { title: "{{bill}}! Now na!", body: "How many times do I have to tell you? Pay {{bill}} now, {{tawag}}. It's only {{amount}}." },
      },
      plain: { title: "{{bill}} due {{when}}", body: "{{bill}} is due {{when}} ({{amount}})." },
    },
  },
  supply_check: {
    tl: {
      mama: {
        1: { title: "Check: {{item}}", body: "{{tawag}}, check mo nga ang {{item}}. Baka ubos na." },
        2: { title: "Hindi pa na-check: {{item}}", body: "{{tawag}}, hindi mo pa nache-check ang {{item}}. Sige na, saglit lang." },
        3: { title: "{{item}}!", body: "Ilang beses ko bang sasabihin? Tingnan mo na ang {{item}}, {{tawag}}." },
      },
      plain: { title: "Supply check: {{item}}", body: "Oras nang i-check ang {{item}}." },
    },
    en: {
      mama: {
        1: { title: "Check: {{item}}", body: "{{tawag}}, check the {{item}} nga. It might be running out." },
        2: { title: "Still unchecked: {{item}}", body: "{{tawag}}, you haven't checked the {{item}} yet. It'll take a minute." },
        3: { title: "{{item}}!", body: "How many times do I have to tell you? Check the {{item}}, {{tawag}}." },
      },
      plain: { title: "Supply check: {{item}}", body: "Time to check {{item}}." },
    },
  },
  errand_due: {
    tl: {
      mama: { 1: { title: "{{errand}} ngayon", body: "{{tawag}}, {{errand}} ngayon ha. Huwag kalimutan." } },
      plain: { title: "{{errand}} ngayon", body: "Naka-schedule ngayon: {{errand}}." },
    },
    en: {
      mama: { 1: { title: "{{errand}} today", body: "{{tawag}}, {{errand}} today ha. Don't forget." } },
      plain: { title: "{{errand}} today", body: "Due today: {{errand}}." },
    },
  },
  errand_overdue: {
    tl: {
      mama: {
        1: { title: "Hindi pa tapos: {{errand}}", body: "{{tawag}}, hindi pa tapos ang {{errand}}. Gawin mo na." },
        2: { title: "{{errand}}, {{days}} araw na", body: "{{tawag}}, {{days}} araw na 'yang {{errand}}. Ano ba." },
        3: { title: "{{errand}}!!", body: "Ilang beses ko bang sasabihin? {{errand}} na, {{tawag}}." },
      },
      plain: { title: "Overdue: {{errand}}", body: "{{errand}} ay {{days}} araw nang overdue." },
    },
    en: {
      mama: {
        1: { title: "Not done yet: {{errand}}", body: "{{tawag}}, {{errand}} isn't done yet. Gawin mo na." },
        2: { title: "{{errand}}, {{days}} days now", body: "{{tawag}}, it's been {{days}} days for {{errand}}. Ano ba." },
        3: { title: "{{errand}}!!", body: "How many times do I have to tell you? {{errand}} now, {{tawag}}." },
      },
      plain: { title: "Overdue: {{errand}}", body: "{{errand}} is {{days}} days overdue." },
    },
  },
  leave_requested: {
    tl: {
      mama: { 1: { title: "Paalam ni {{helper}}", body: "{{tawag}}, nagpaalam si {{helper}}: {{type}}, {{dates}}. Pakitingnan." } },
      plain: { title: "Bagong paalam", body: "{{helper}}: {{type}}, {{dates}}." },
    },
    en: {
      mama: { 1: { title: "{{helper}} asked for leave", body: "{{tawag}}, {{helper}} filed {{type}} for {{dates}}. Please take a look." } },
      plain: { title: "New leave request", body: "{{helper}} filed {{type}} for {{dates}}." },
    },
  },
  leave_approved: {
    tl: {
      mama: { 1: { title: "Approved ang paalam mo", body: "{{tawag}}, approved ang paalam mo ({{dates}}). Ingat ka, ha." } },
      plain: { title: "Approved ang paalam", body: "Approved: {{type}}, {{dates}}." },
    },
    en: {
      mama: { 1: { title: "Your leave is approved", body: "{{tawag}}, your leave for {{dates}} is approved. Ingat ka, ha." } },
      plain: { title: "Leave approved", body: "Approved: {{type}}, {{dates}}." },
    },
  },
  leave_rejected: {
    tl: {
      mama: { 1: { title: "Hindi muna pwede", body: "{{tawag}}, hindi muna pwede ang paalam mo ({{dates}}). Usap tayo. {{note}}" } },
      plain: { title: "Hindi na-approve ang paalam", body: "Hindi approved: {{type}}, {{dates}}. {{note}}" },
    },
    en: {
      mama: { 1: { title: "Not this time", body: "{{tawag}}, your leave for {{dates}} can't be approved. Let's talk. {{note}}" } },
      plain: { title: "Leave not approved", body: "Not approved: {{type}}, {{dates}}. {{note}}" },
    },
  },
  parcel_update: {
    tl: {
      mama: { 1: { title: "May dumating mamaya!", body: "{{tawag}}, darating ngayon ang {{item}} ({{courier}}). {{cod}}" } },
      plain: { title: "Out for delivery", body: "{{item}} ({{courier}}) out for delivery. {{cod}}" },
    },
    en: {
      mama: { 1: { title: "Something's arriving today!", body: "{{tawag}}, {{item}} is out for delivery ({{courier}}). {{cod}}" } },
      plain: { title: "Out for delivery", body: "{{item}} ({{courier}}) is out for delivery. {{cod}}" },
    },
  },
  parcel_delivered: {
    tl: {
      mama: { 1: { title: "Dumating na", body: "{{tawag}}, dumating na ang {{item}}. Natanggap ni {{by}}." } },
      plain: { title: "Delivered", body: "{{item}} delivered. Natanggap ni {{by}}." },
    },
    en: {
      mama: { 1: { title: "It's here", body: "{{tawag}}, {{item}} has arrived. {{by}} received it." } },
      plain: { title: "Delivered", body: "{{item}} delivered. Received by {{by}}." },
    },
  },
  meal_cook: {
    tl: {
      mama: { 1: { title: "Ikaw ang magluluto", body: "{{tawag}}, ikaw ang magluluto ng {{meal}} para sa {{slot}}. Kain na!" } },
      plain: { title: "Lulutuin: {{meal}}", body: "{{slot}}: {{meal}}." },
    },
    en: {
      mama: { 1: { title: "You're cooking", body: "{{tawag}}, you're cooking {{meal}} for {{slot}}. Kain na!" } },
      plain: { title: "Cooking: {{meal}}", body: "{{slot}}: {{meal}}." },
    },
  },
};

/**
 * Taglish, and Halo-halo: English with Batangueño ("ala eh", "ga", "ika")
 * and Bikol ("ngunyan" today, "sa aga" tomorrow, "aldaw" day, "harong"
 * house, "bayadan" pay, "gibohon" to do, "Dios mabalos" thank you).
 * Halo-halo is for fun; have a native speaker review before relying on it.
 */
const MIX: Record<TemplateKey, Record<"taglish" | "halo", Voice>> = {
  bill_due: {
    taglish: {
      mama: {
        1: { title: "{{bill}} due {{when}}", body: "{{tawag}}, due na ang {{bill}} {{when}}. Bayaran mo na, ha." },
        2: { title: "Late na: {{bill}}", body: "{{tawag}}, late na yung {{bill}}. Wag mo nang hintayin na putulan tayo." },
        3: { title: "{{bill}}! Now na!", body: "Ilang beses ko bang sasabihin? Bayaran mo na yung {{bill}}, {{tawag}}. {{amount}} lang 'yan." },
      },
      plain: { title: "{{bill}} due {{when}}", body: "Due ang {{bill}} {{when}} ({{amount}})." },
    },
    halo: {
      mama: {
        1: { title: "{{bill}} due {{when}}", body: "{{tawag}}, {{bill}} due {{when}}, ala eh. Bayadan mo na ga." },
        2: { title: "Late na: {{bill}}", body: "{{tawag}}, late na an {{bill}}. Aba, bayadan mo na ga bago kita putulan." },
        3: { title: "{{bill}}! Ngunyan na!", body: "Ilang beses ko ga sasabihin? Bayadan mo na an {{bill}}, {{tawag}}. {{amount}} lang ini." },
      },
      plain: { title: "{{bill}} due {{when}}", body: "{{bill}} is due {{when}} ({{amount}})." },
    },
  },
  supply_check: {
    taglish: {
      mama: {
        1: { title: "Check: {{item}}", body: "{{tawag}}, pa-check naman ng {{item}}. Baka paubos na." },
        2: { title: "Hindi pa checked: {{item}}", body: "{{tawag}}, hindi mo pa nache-check yung {{item}}. Saglit lang 'to." },
        3: { title: "{{item}}!", body: "Ilang beses ko bang sasabihin? Check mo na yung {{item}}, {{tawag}}." },
      },
      plain: { title: "Supply check: {{item}}", body: "Time to check {{item}}." },
    },
    halo: {
      mama: {
        1: { title: "Check: {{item}}", body: "{{tawag}}, pakitingnan mo nga ga an {{item}}. Baka ubos na, ala eh." },
        2: { title: "Dai pa na-check: {{item}}", body: "{{tawag}}, dai mo pa na-check an {{item}}. Sadit na bagay lang ini." },
        3: { title: "{{item}}!", body: "Ilang beses ko ga sasabihin? I-check mo na an {{item}}, {{tawag}}!" },
      },
      plain: { title: "Supply check: {{item}}", body: "Time to check {{item}}." },
    },
  },
  errand_due: {
    taglish: {
      mama: { 1: { title: "{{errand}} today", body: "{{tawag}}, {{errand}} today ha. Wag kalimutan." } },
      plain: { title: "{{errand}} today", body: "Due today: {{errand}}." },
    },
    halo: {
      mama: { 1: { title: "{{errand}} ngunyan", body: "{{tawag}}, {{errand}} ngunyan ha. Dai mo pagkalingawan, ala eh." } },
      plain: { title: "{{errand}} today", body: "Due today: {{errand}}." },
    },
  },
  errand_overdue: {
    taglish: {
      mama: {
        1: { title: "Hindi pa done: {{errand}}", body: "{{tawag}}, hindi pa done yung {{errand}}. Gawin mo na." },
        2: { title: "{{errand}}, {{days}} days na", body: "{{tawag}}, {{days}} days na 'yang {{errand}}. Ano ba." },
        3: { title: "{{errand}}!!", body: "Ilang beses ko bang sasabihin? {{errand}} na, {{tawag}}." },
      },
      plain: { title: "Overdue: {{errand}}", body: "{{errand}} is {{days}} days overdue." },
    },
    halo: {
      mama: {
        1: { title: "Dai pa tapos: {{errand}}", body: "{{tawag}}, dai pa tapos an {{errand}}. Gibohon mo na ga." },
        2: { title: "{{errand}}, {{days}} aldaw na", body: "{{tawag}}, {{days}} aldaw na ini na {{errand}}. Ala eh!" },
        3: { title: "{{errand}}!!", body: "Ilang beses ko ga sasabihin? {{errand}} ngunyan na, {{tawag}}!" },
      },
      plain: { title: "Overdue: {{errand}}", body: "{{errand}} is {{days}} days overdue." },
    },
  },
  leave_requested: {
    taglish: {
      mama: { 1: { title: "Paalam ni {{helper}}", body: "{{tawag}}, nag-file si {{helper}} ng {{type}} for {{dates}}. Pa-check naman." } },
      plain: { title: "New leave request", body: "{{helper}}: {{type}}, {{dates}}." },
    },
    halo: {
      mama: { 1: { title: "Nagpaalam si {{helper}}", body: "{{tawag}}, si {{helper}} nag-file nin {{type}} for {{dates}}. Paki-check tabi." } },
      plain: { title: "New leave request", body: "{{helper}} filed {{type}} for {{dates}}." },
    },
  },
  leave_approved: {
    taglish: {
      mama: { 1: { title: "Approved yung leave mo", body: "{{tawag}}, approved na yung leave mo ({{dates}}). Ingat ka, ha." } },
      plain: { title: "Leave approved", body: "Approved: {{type}}, {{dates}}." },
    },
    halo: {
      mama: { 1: { title: "Approved an paalam mo", body: "{{tawag}}, approved na an paalam mo ({{dates}}). Mag-ingat ka, ala eh." } },
      plain: { title: "Leave approved", body: "Approved: {{type}}, {{dates}}." },
    },
  },
  leave_rejected: {
    taglish: {
      mama: { 1: { title: "Hindi muna pwede", body: "{{tawag}}, hindi muna pwede yung leave mo ({{dates}}). Usap tayo. {{note}}" } },
      plain: { title: "Leave not approved", body: "Not approved: {{type}}, {{dates}}. {{note}}" },
    },
    halo: {
      mama: { 1: { title: "Dai muna puwede", body: "{{tawag}}, dai muna puwede an paalam mo ({{dates}}). Mag-ulay kita. {{note}}" } },
      plain: { title: "Leave not approved", body: "Not approved: {{type}}, {{dates}}. {{note}}" },
    },
  },
  parcel_update: {
    taglish: {
      mama: { 1: { title: "May darating today!", body: "{{tawag}}, out for delivery na yung {{item}} ({{courier}}). {{cod}}" } },
      plain: { title: "Out for delivery", body: "{{item}} ({{courier}}) is out for delivery. {{cod}}" },
    },
    halo: {
      mama: { 1: { title: "May maabot ngunyan!", body: "{{tawag}}, out for delivery na an {{item}} ({{courier}}). {{cod}}" } },
      plain: { title: "Out for delivery", body: "{{item}} ({{courier}}) is out for delivery. {{cod}}" },
    },
  },
  parcel_delivered: {
    taglish: {
      mama: { 1: { title: "Dumating na", body: "{{tawag}}, dumating na yung {{item}}. Si {{by}} ang nag-receive." } },
      plain: { title: "Delivered", body: "{{item}} delivered. Received by {{by}}." },
    },
    halo: {
      mama: { 1: { title: "Nag-abot na", body: "{{tawag}}, nag-abot na an {{item}}. Si {{by}} an nag-receive." } },
      plain: { title: "Delivered", body: "{{item}} delivered. Received by {{by}}." },
    },
  },
  meal_cook: {
    taglish: {
      mama: { 1: { title: "Ikaw ang magluluto", body: "{{tawag}}, ikaw ang magluluto ng {{meal}} for {{slot}}. Kain na!" } },
      plain: { title: "Cooking: {{meal}}", body: "{{slot}}: {{meal}}." },
    },
    halo: {
      mama: { 1: { title: "Ika an maluluto", body: "{{tawag}}, ika an maluluto kan {{meal}} para sa {{slot}}. Kakan na!" } },
      plain: { title: "Cooking: {{meal}}", body: "{{slot}}: {{meal}}." },
    },
  },
};

export function renderTemplate(
  key: TemplateKey,
  user: Pick<User, "locale" | "plainMode" | "mamaCallsMe">,
  vars: Record<string, string | number | undefined>,
  level: 1 | 2 | 3 = 1,
): Variant {
  const voice = user.locale === "en" || user.locale === "tl" ? T[key][user.locale] : MIX[key][user.locale];
  const variant = user.plainMode ? voice.plain : (voice.mama[level] ?? voice.mama[2] ?? voice.mama[1]);
  const all = { ...vars, tawag: user.mamaCallsMe };
  return {
    title: fill(variant.title, all).trim(),
    body: fill(variant.body, all).replace(/\s+/g, " ").trim(),
  };
}

