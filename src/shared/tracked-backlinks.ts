export type TrackedBacklinkStatus =
  | "unchecked"
  | "pending"
  | "found"
  | "not_found"
  | "unverified";
export type TrackedBacklink = {
  id: string;
  projectId: string;
  sourceUrl: string;
  targetUrl: string;
  acquiredOn: string | null;
  notes: string;
  paused: boolean;
  checking: boolean;
  status: TrackedBacklinkStatus;
  anchor: string | null;
  rel: string | null;
  lastCheckedAt: string | null;
  error: string | null;
  createdAt: string;
  latestChange?: {
    kind: "not_observed" | "recovered" | "attributes_changed";
    at: string;
  } | null;
};
export type TrackedBacklinkConfig = {
  scheduleInterval: "off" | "daily" | "weekly";
  monthlyCheckLimit: number;
  maxCostUsdPerCheck: number;
  nextCheckAt: string | null;
  lastSkipReason: string | null;
};
export type TrackedBacklinkHistory = {
  id: string;
  status: Exclude<TrackedBacklinkStatus, "unchecked">;
  sourceUrl: string;
  targetUrl: string;
  anchor: string | null;
  rel: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};
export type TrackedBacklinksOverview = {
  links: TrackedBacklink[];
  config: TrackedBacklinkConfig;
  usage: { month: string; checksUsed: number; monthlyCheckLimit: number };
  estimate: { costUsdPerCheck: number; costCreditsPerCheck: number } | null;
  estimateUnavailableReason: string | null;
  providerConfigured: boolean;
};
