import { describe, expect, it } from "vitest";
import { scoreSearchQuery, searchTokens } from "../src/search.js";

describe("search helpers", () => {
  it("tokenizes camelCase, separators, and plural variants", () => {
    const tokens = searchTokens("usaspending.v2__search__spending_by_transaction search_transactions");
    expect(tokens).toContain("spending");
    expect(tokens).toContain("transactions");
    expect(tokens).toContain("transaction");
    expect(tokens).toContain("search");
  });

  it("matches natural-language transaction queries against representative metadata", () => {
    const score = scoreSearchQuery("investigate large contract transaction obligations", [
      "v2__search__spending_by_transaction",
      "Returns transaction rows for a filtered USAspending advanced-search scope.",
      "transactions",
      "transaction_obligation",
      "contract_screen",
      "usaspending.v2__search__spending_by_transaction",
    ]);
    expect(score).toBeGreaterThan(0);
  });

  it("matches singular queries against plural metadata", () => {
    const score = scoreSearchQuery("transaction detail", [
      "v2__search__spending_by_transaction",
      "transactions",
      "detail",
      "usaspending.v2__search__spending_by_transaction",
    ]);
    expect(score).toBeGreaterThan(0);
  });

  it("returns zero when there is no overlap", () => {
    const score = scoreSearchQuery("weather forecast", [
      "v2__search__spending_by_transaction",
      "transactions",
      "transaction_obligation",
      "contract_screen",
    ]);
    expect(score).toBe(0);
  });
});
