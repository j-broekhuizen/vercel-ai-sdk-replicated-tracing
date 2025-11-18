import { z } from "zod";
import { researchAgent } from "./sub-agent-research";
import { salesAgent } from "./sub-agent-sales";
import { withRunTree } from "langsmith/traceable";

type RunTreeContext = Parameters<typeof withRunTree>[0];

const runAsIsolatedTrace = async <T>(fn: () => Promise<T>) => {
  // Passing `undefined` drops the parent ALS context so the wrapped traceable function
  // creates a new root run (allowing us to use custom replicas for this tool only).
  return withRunTree(undefined as unknown as RunTreeContext, fn);
};

const researchQuerySchema = z.object({
  query: z.string().describe("The research question or topic to investigate"),
});

const salesQuerySchema = z.object({
  company: z
    .string()
    .describe("Optional company name to filter on; leave empty for full summary")
    .optional(),
});

export const tools = {
  askResearchAgent: {
    description: "Delegate complex research or analysis questions to a specialized research agent. Use this when you need detailed information or in-depth analysis.",
    inputSchema: researchQuerySchema,
    execute: async ({ query }: { query: string }) => {
      const answer = await runAsIsolatedTrace(() => researchAgent(query));
      return { answer };
    },
  },
  querySalesAgent: {
    description: "Look up deals in the sales database. Use to gather pipeline info about public companies.",
    inputSchema: salesQuerySchema,
    execute: async ({
      company,
    }: {
      company?: string;
    }) => {
      const summary = await runAsIsolatedTrace(() =>
        salesAgent({ company })
      );
      return { summary };
    },
  },
};
