import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { BacklinkCostReadRepository } from "./BacklinkCostReadRepository";

let client: Client;
let testDb: ReturnType<typeof drizzle>;
vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
const now = 1_800_000_000_000;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  testDb = drizzle(client);
  await client.executeMultiple(
    "CREATE TABLE organization (id text PRIMARY KEY); INSERT INTO organization VALUES ('a'), ('b');",
  );
  await client.executeMultiple(
    readFileSync("drizzle/sqlite/0053_chubby_tyger_tiger.sql", "utf8"),
  );
});
afterAll(() => client.close());
beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  await client.execute("DELETE FROM data_refresh_claims");
});

describe("global OnPage billing quota", () => {
  it("admits one concurrent account cost read across organizations", async () => {
    const admitted = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        BacklinkCostReadRepository.claim(i % 2 ? "a" : "b"),
      ),
    );
    expect(admitted.filter(Boolean)).toHaveLength(1);
    const rows = await client.execute(
      "SELECT count(*) AS count FROM data_refresh_claims",
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("permits the next organization after 6.1 seconds without changing the FK owner", async () => {
    expect(await BacklinkCostReadRepository.claim("a")).toBe(true);
    vi.mocked(Date.now).mockReturnValue(now + 6099);
    expect(await BacklinkCostReadRepository.claim("b")).toBe(false);
    vi.mocked(Date.now).mockReturnValue(now + 6100);
    expect(await BacklinkCostReadRepository.claim("b")).toBe(true);
    const rows = await client.execute(
      "SELECT organization_id, next_attempt_at FROM data_refresh_claims",
    );
    expect(rows.rows[0]).toMatchObject({
      organization_id: "a",
      next_attempt_at: now + 12_200,
    });
  });

  it("leaves organization-scoped dashboard claims untouched", async () => {
    await client.execute({
      sql: "INSERT INTO data_refresh_claims VALUES (?, ?, ?, ?)",
      args: ["dashboard:a", "a", "dashboard-owner", now + 180_000],
    });
    await BacklinkCostReadRepository.claim("b");
    const rows = await client.execute(
      "SELECT token, next_attempt_at FROM data_refresh_claims WHERE key = 'dashboard:a'",
    );
    expect(rows.rows[0]).toMatchObject({
      token: "dashboard-owner",
      next_attempt_at: now + 180_000,
    });
  });
});
