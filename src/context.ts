import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { WebClient } from "@slack/web-api";
import type { RelatedMessage } from "./types.js";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const TOKEN_FILE = DATA_DIR + "action-token.json";

/**
 * assistant.search.context (Real-time Search API) needs an action_token when
 * called with a bot token. Action tokens arrive on message / app_mention
 * events; we cache the latest one so approval requests (which originate
 * outside any Slack event) can still search.
 */
export function cacheActionToken(token: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ token, at: new Date().toISOString() }));
}

export function getActionToken(): string | undefined {
  if (!existsSync(TOKEN_FILE)) return undefined;
  try {
    return (JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as { token: string }).token;
  } catch {
    return undefined;
  }
}

interface RtsMessage {
  content?: string;
  permalink?: string;
  author_name?: string;
}

/** Search workspace context via the Real-time Search API. Best-effort. */
export async function searchContext(client: WebClient, query: string): Promise<RelatedMessage[]> {
  const actionToken = getActionToken();
  if (!actionToken) {
    console.error("[rts] no cached action_token; skipping context search");
    return [];
  }
  const res = (await client.apiCall("assistant.search.context", {
    query,
    action_token: actionToken,
    content_types: ["messages"],
    include_bots: true,
    limit: 5,
  })) as { results?: { messages?: RtsMessage[] } };

  const messages = res.results?.messages ?? [];
  return messages
    .filter((m) => m.content)
    .slice(0, 3)
    .map((m) => ({
      content: (m.content ?? "").replace(/\s+/g, " ").slice(0, 140),
      permalink: m.permalink,
      author: m.author_name,
    }));
}
