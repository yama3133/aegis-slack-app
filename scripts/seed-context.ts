import "dotenv/config";
import { WebClient } from "@slack/web-api";

const channel = process.argv[2] ?? process.env.AEGIS_DEFAULT_CHANNEL;
if (!channel) {
  console.error("usage: tsx scripts/seed-context.ts <channel-id>");
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const messages = [
  "Heads-up: ACME Corp reported a duplicate charge on order ORD-4413. Finance is investigating the billing discrepancy.",
  "Update on ORD-4413: duplicate charge of $1,200 confirmed. Per refund policy, partial refunds up to $800 do not need director sign-off; anything above does.",
  "Reminder for all agents and operators: production database tables must never be dropped without a migration freeze window and a verified backup.",
];

for (const text of messages) {
  const res = await client.chat.postMessage({ channel, text });
  console.log(`seeded ts=${res.ts}: ${text.slice(0, 60)}...`);
}
