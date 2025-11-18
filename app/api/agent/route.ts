import {
  generateText,
  streamText,
  generateObject,
  streamObject,
  wrapLanguageModel,
} from "ai";
import { openai } from "@/lib/openai";
import { tools } from "@/lib/tools";
import { traceable } from "langsmith/traceable";
import { wrapAISDK } from "langsmith/experimental/vercel";
import { Client } from "langsmith";

// Using Node.js runtime for LangSmith Client compatibility
export const runtime = "nodejs";

const langsmithClient = new Client();
const MAIN_AGENT_SYSTEM_PROMPT = `
    You are the primary orchestrator for a research + sales assistant.
    - Read the conversation carefully.
    - Decide whether to call tools: use querySalesAgent for pipeline data, and askResearchAgent for open-ended analysis.
    - Combine tool outputs into a concise answer with sections:
      1. Summary
      2. Tool Findings (list each tool and its key data)
      3. Next Steps (only if useful)
    - If you need more info, explain what tool call you plan to make.
`;

// Wrap AI SDK for automatic tracing
const wrappedAISDK = wrapAISDK(
  {
    wrapLanguageModel,
    generateText,
    streamText,
    streamObject,
    generateObject,
  },
  {
    project_name: "vercel-ai-agent-demo",
  }
);

const handleAgentRequest = traceable(
  async (messages: any[]) => {
    const conversation = [
      { role: "system", content: MAIN_AGENT_SYSTEM_PROMPT },
      ...(messages ?? []),
    ];

    const result = await wrappedAISDK.generateText({
      model: openai("gpt-4o"),
      messages: conversation,
      tools,
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      finishReason: result.finishReason,
    };
  },
  {
    name: "main_agent",
    run_type: "chain",
    client: langsmithClient,
  }
);

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await handleAgentRequest(messages);

  // Ensure traces are flushed before response
  await langsmithClient.awaitPendingTraceBatches();

  return Response.json(result);
}
