export const AI_BOTS = {
  OpenAI: {
    GPTBot:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
    "ChatGPT-User":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "OAI-SearchBot": "OAI-SearchBot/1.0; +https://openai.com/searchbot",
  },
  Anthropic: {
    ClaudeBot:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "Claude-User":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  },
  Google: {
    "Google-Extended": "Mozilla/5.0 (compatible; Google-Extended)",
    Googlebot:
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  Perplexity: {
    PerplexityBot:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "Perplexity-User":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  },
  "Other AI": {
    CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    Bytespider:
      "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "Meta-ExternalAgent":
      "Mozilla/5.0 (compatible; Meta-ExternalAgent/1.0; +https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    Amazonbot:
      "Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
    "Applebot-Extended":
      "Mozilla/5.0 (Applebot-Extended/0.3; +http://www.apple.com/go/applebot)",
    "Cohere-ai": "Mozilla/5.0 (compatible; cohere-ai)",
  },
} as const;

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const SENSITIVE_PATHS = [
  "/admin",
  "/administrator",
  "/wp-admin",
  "/wp-login.php",
  "/account",
  "/my-account",
  "/user",
  "/profile",
  "/checkout",
  "/cart",
  "/payment",
  "/api",
  "/api/v1",
  "/graphql",
  "/staging",
  "/preview",
  "/dev",
  "/test",
  "/cms",
  "/backend",
  "/dashboard",
  "/panel",
  "/config",
  "/env",
  "/.env",
  "/debug",
  "/phpmyadmin",
  "/adminer",
  "/database",
] as const;
