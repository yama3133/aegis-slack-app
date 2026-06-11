import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ApprovalInput } from "./approvals.js";

const MODEL_ID = process.env.AEGIS_SUMMARY_MODEL ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const REGION = process.env.AEGIS_DEMO_REGION ?? "us-east-1";

const bedrock = new BedrockRuntimeClient({ region: REGION });

/**
 * One-sentence plain-language summary of the requested action, written for a
 * human approver. Best-effort: returns undefined on any failure.
 */
export async function summarizeAction(input: ApprovalInput): Promise<string | undefined> {
  try {
    const res = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [
          {
            text:
              "You write one-sentence plain-language summaries of AI-agent actions for human approvers in Slack. " +
              "State what will happen, to whom/what, and the key number if any. No preamble, no markdown headers.",
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                text: `Agent: ${input.agent}\nAction: ${input.action}\nRisk: ${input.risk}\nArguments: ${JSON.stringify(input.args)}\nAgent reasoning: ${input.reason ?? "-"}`,
              },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 150 },
      }),
    );
    const text = res.output?.message?.content?.find((b) => b.text)?.text?.trim();
    return text || undefined;
  } catch (e) {
    console.error("[summary] failed:", (e as Error).message);
    return undefined;
  }
}
