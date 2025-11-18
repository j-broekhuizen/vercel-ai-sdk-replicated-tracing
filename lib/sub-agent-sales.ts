import {
  generateText,
  streamText,
  generateObject,
  streamObject,
  wrapLanguageModel,
} from "ai";
import { openai } from "@/lib/openai";
import { traceable } from "langsmith/traceable";
import { Client } from "langsmith";
import { wrapAISDK } from "langsmith/experimental/vercel";
import { z } from "zod";
import salesData from "./fake_sales_data.json";

type DealStage =
  | "prospecting"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed";

interface SalesRecord {
  company_name: string;
  description: string;
  deal_stage: DealStage;
}

interface SalesAgentInput {
  company?: string;
}

const langsmithClient = new Client();
const salesReplicas = [{ projectName: "vercel-sales-agent" }];
const normalizedSalesData = salesData as SalesRecord[];

const SALES_AGENT_SYSTEM_PROMPT = `
You are Sales Assistant, a revenue strategist.
- You have a lookupSalesData tool that returns JSON rows for deals.
- Always call the tool before answering so you work from real data.
- After the tool returns results, you MUST synthesize and provide a written response analyzing the data.
- Respond with expert insights about the company and the deals based on the tool results.
- If no data matches, explain which filters were used and suggest a follow-up action.
- IMPORTANT: After calling the tool, always provide a written summary and analysis - never stop after just calling the tool.
`;

const filterRecords = ({ company }: SalesAgentInput): SalesRecord[] => {
  const normalizedCompany = company?.trim().toLowerCase();

  let filtered = normalizedSalesData;
  if (normalizedCompany) {
    filtered = filtered.filter((record) =>
      record.company_name.toLowerCase().includes(normalizedCompany)
    );
  }
  return filtered;
};

const lookupSalesDataTool = {
  description:
    "Look up deals in the fake_sales_data.json file. Returns the matching records.",
  inputSchema: z.object({
    company: z
      .string()
      .describe("Company name to filter on")
      .optional(),
  }),
  execute: async ({ company }: SalesAgentInput = {}) => {
    const records = filterRecords({ company });
    return {
      count: records.length,
      records,
      stages: Array.from(new Set(records.map((record) => record.deal_stage))),
    };
  },
};

const salesTools = {
  lookupSalesData: lookupSalesDataTool,
};

const wrappedAISDK = wrapAISDK(
  {
    wrapLanguageModel,
    generateText,
    streamText,
    streamObject,
    generateObject,
  }
);

export const salesAgent = traceable(
  async ({ company }: SalesAgentInput = {}) => {
    const prompt = company 
      ? `Get sales pipeline information for ${company}`
      : "Get sales pipeline information";

    const result = await wrappedAISDK.generateText({
      model: openai("gpt-4o-mini"),
      system: SALES_AGENT_SYSTEM_PROMPT,
      prompt,
      tools: salesTools,
    });

    // generateText should automatically continue after tool calls
    // If it doesn't, check finishReason and continue manually
    if (result.finishReason === "tool-calls" && !result.text && result.toolCalls && result.toolResults) {
      // Use the response messages which are already in the correct ModelMessage format
      const responseMessages = result.response?.messages;
      if (responseMessages && Array.isArray(responseMessages)) {
        // The response messages should already include assistant message with tool calls
        // and tool result messages, so we can use them directly
        const continuedResult = await wrappedAISDK.generateText({
          model: openai("gpt-4o-mini"),
          messages: responseMessages as any,
          tools: salesTools,
        });

        return continuedResult.text || "";
      }

      // Fallback: construct messages manually if response.messages not available
      // This should rarely happen, but handle it just in case
      const messages: any[] = [
        { role: "system", content: SALES_AGENT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ];

      // Add assistant message with tool calls (simplified format)
      messages.push({
        role: "assistant",
        content: "",
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
        model: openai("gpt-4o-mini"),
        messages,
        tools: salesTools,
      });

      return continuedResult.text || "";
    }

    return result.text || "";
  },
  {
    name: "sales_agent",
    run_type: "tool",
    client: langsmithClient,
    project_name: "vercel-ai-agent-demo",
    replicas: salesReplicas,
  }
);
