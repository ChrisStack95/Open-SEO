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
  js: ReturnType<typeof import("./jsRendering").checkJsRendering>;
  llmTxt: ReturnType<typeof import("./llmTxt").checkLlmTxt>;
  robots: ReturnType<typeof import("./robotsCheck").checkRobots>;
  schema: ReturnType<typeof import("./schemaCheck").checkSchema>;
  pageMeta: ReturnType<typeof import("./pageMeta").checkPageMeta>;
  wellKnown: ReturnType<typeof import("./wellKnown").checkWellKnown>;
  botCrawl: BotCrawlResult[];
}
