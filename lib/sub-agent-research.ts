import {
  generateText,
  streamText,
  generateObject,
  streamObject,
  wrapLanguageModel,
} from "ai";
import { openai } from "@/lib/openai";
import { traceable } from "langsmith/traceable";
import { wrapAISDK } from "langsmith/experimental/vercel";
import { Client } from "langsmith";

// LangSmith client for tracing
const langsmithClient = new Client();
const researchReplicas = [{ projectName: "vercel-researcher" }];

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

/**
 * Sub-agent that specializes in research and analysis tasks
 * This agent is called as a tool from the main agent
 * Traces are sent to both the main project and the 'vercel-researcher' project via replicas
 */
export const researchAgent = traceable(
  async (query: string): Promise<string> => {
    const result = await wrappedAISDK.generateText({
      model: openai("gpt-4o-mini"),
      system: `You are a focused researchanalyst.
- Provide structured findings with short sections: Key Insights, Supporting Evidence, References (real sources only if provided, otherwise describe the type of source).
- Highlight concrete facts, numbers, and tradeoffs relevant to the query.
- If the answer would be speculative, say what additional information is required.`,
      prompt: query,
    });

    return result.text;
  },
  { 
    name: "research_agent", 
    run_type: "llm",
    client: langsmithClient,
    project_name: "vercel-ai-agent-demo",
    replicas: researchReplicas
  }
);
