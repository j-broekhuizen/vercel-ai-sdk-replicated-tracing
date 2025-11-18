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
  }
);

const handleAgentRequest = traceable(
  async (messages: any[]) => {
    let conversation: any[] = [
      { role: "system", content: MAIN_AGENT_SYSTEM_PROMPT },
      ...(messages ?? []),
    ];

    const result = await wrappedAISDK.generateText({
      model: openai("gpt-4o"),
      messages: conversation,
      tools,
    });

    // If tool was called but no text generated, continue with tool results
    if (result.finishReason === "tool-calls" && !result.text && result.toolCalls && result.toolResults) {
      // Use the response messages which are already in the correct ModelMessage format
      const responseMessages = result.response?.messages;
      if (responseMessages && Array.isArray(responseMessages)) {
        // The response messages should already include assistant message with tool calls
        // and tool result messages, so we can use them directly
        const continuedResult = await wrappedAISDK.generateText({
          model: openai("gpt-4o"),
          messages: responseMessages as any,
          tools,
        });

        return {
          text: continuedResult.text || result.text || "",
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          finishReason: continuedResult.finishReason || result.finishReason,
        };
      }

      // Fallback: construct messages manually if response.messages not available
      // This should rarely happen, but handle it just in case
      const messages: any[] = [...conversation];

      // Add assistant message with tool calls (simplified format)
      messages.push({
        role: "assistant",
        content: result.text || "",
        toolCalls: result.toolCalls,
      });

      // Add tool results
      for (const toolResult of result.toolResults) {
        const resultValue = "result" in toolResult ? toolResult.result : toolResult;
        messages.push({
          role: "tool",
          toolCallId: toolResult.toolCallId,
          content: typeof resultValue === "string" ? resultValue : JSON.stringify(resultValue),
        });
      }

      const continuedResult = await wrappedAISDK.generateText({
        model: openai("gpt-4o"),
        messages,
        tools,
      });

      return {
        text: continuedResult.text || result.text || "",
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        finishReason: continuedResult.finishReason || result.finishReason,
      };
    }

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
    project_name: "vercel-ai-agent-demo",
  }
);

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await handleAgentRequest(messages);

  // Ensure traces are flushed before response
  await langsmithClient.awaitPendingTraceBatches();

  return Response.json(result);
}
