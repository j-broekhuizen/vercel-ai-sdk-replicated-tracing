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
  },
  {
    project_name: "vercel-ai-agent-demo",
    replicas: salesReplicas,
  }
);

const buildPromptFromFilters = ({ company }: SalesAgentInput) => {
  const parts = ["Create a sales pipeline summary using the data tool."];
  if (company) {
    parts.push(`Company focus: ${company}.`);
  } else {
    parts.push("Company focus: not specified.");
  }
  parts.push(
    "Use the lookupSalesData tool once with the requested filters, then craft your answer."
  );
  return parts.join("\n");
};

export const salesAgent = traceable(
  async ({ company }: SalesAgentInput = {}) => {
    const result = await wrappedAISDK.generateText({
      model: openai("gpt-4o-mini"),
      system: SALES_AGENT_SYSTEM_PROMPT,
      prompt: buildPromptFromFilters({ company }),
      tools: salesTools,
    });

    return result.text;
  },
  {
    name: "sales_agent",
    run_type: "tool",
    client: langsmithClient,
    project_name: "vercel-ai-agent-demo",
    replicas: salesReplicas,
  }
);
