import type { checkJsRendering } from "./jsRendering";
import type { checkLlmTxt } from "./llmTxt";
import type { checkPageMeta } from "./pageMeta";
import type { checkRobots } from "./robotsCheck";
import type { checkSchema } from "./schemaCheck";
import type { checkWellKnown } from "./wellKnown";

export interface FetchedText {
  status: number;
  text: string;
  url: string;
  contentType?: string;
}

export interface BotCrawlResult {
  name: string;
  company: string;
  status?: number;
  robotsAllowed: boolean | null;
  noindex: boolean;
  title: string;
  loadTimeMs: number;
  contentLength: number;
  error?: string;
}

export interface AiAccessResults {
  url: string;
  overallScore: number;
  js: ReturnType<typeof checkJsRendering>;
  llmTxt: ReturnType<typeof checkLlmTxt>;
  robots: ReturnType<typeof checkRobots>;
  schema: ReturnType<typeof checkSchema>;
  pageMeta: ReturnType<typeof checkPageMeta>;
  wellKnown: ReturnType<typeof checkWellKnown>;
  botCrawl: BotCrawlResult[];
}
