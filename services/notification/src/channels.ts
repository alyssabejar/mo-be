import webpush from "web-push";

export interface OutgoingMessage {
  inboxId: string;
  title: string;
  body: string;
  subject: string;
  actions: string[];
}

export type SendResult = { ok: true } | { ok: false; retry: boolean; error: string; goneEndpoints?: string[] };

/** Web Push, active when VAPID keys are set. */
export function webPushChannel(env: NodeJS.ProcessEnv) {
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const configured = !!(pub && priv);
  if (configured) webpush.setVapidDetails(env.VAPID_SUBJECT ?? "mailto:admin@mamamo.app", pub!, priv!);
  return {
    configured,
    publicKey: pub,
    async send(subs: { endpoint: string; keys: { p256dh: string; auth: string } }[], msg: OutgoingMessage): Promise<SendResult> {
      if (!configured) return { ok: false, retry: false, error: "web push not configured (VAPID keys missing)" };
      if (!subs.length) return { ok: false, retry: false, error: "no push subscription for this user" };
      const gone: string[] = [];
      let delivered = 0;
      let lastError = "";
      for (const s of subs) {
        try {
          await webpush.sendNotification(s, JSON.stringify(msg), { TTL: 60 * 60 * 12 });
          delivered++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.endpoint);
          lastError = (err as Error).message;
        }
      }
      if (delivered) return { ok: true };
      return { ok: false, retry: gone.length < subs.length, error: lastError, goneEndpoints: gone };
    },
  };
}

/**
 * Slack is a defined channel, but its app (bot token, signing secret, user
 * links, interactive buttons) isn't set up yet, so deliveries are skipped.
 */
export function slackChannel(env: NodeJS.ProcessEnv) {
  const configured = !!(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET);
  return {
    configured,
    async send(): Promise<SendResult> {
      return { ok: false, retry: false, error: configured ? "slack delivery not implemented yet" : "slack not configured" };
    },
  };
}
