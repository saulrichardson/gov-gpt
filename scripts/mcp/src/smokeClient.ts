import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      (timer as any).unref?.();
    }),
  ]);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const repoRoot = join(__dirname, "..", "..", "..");
  const serverBin = join(repoRoot, "scripts", "mcp", "bin", "stdio-server");

  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid SMOKE_TIMEOUT_MS: expected positive number, got '${process.env.SMOKE_TIMEOUT_MS}'`);
  }

  const smokeSlug = process.env.SMOKE_SLUG || "v2__search__spending_by_transaction";
  const callApi =
    process.env.SMOKE_CALL_API === "1" ||
    String(process.env.SMOKE_CALL_API || "").toLowerCase() === "true";

  const startedAt = new Date().toISOString();

  const transport = new StdioClientTransport({
    command: serverBin,
    args: [],
    cwd: repoRoot,
    stderr: "pipe",
  });

  let serverStderr = "";
  transport.stderr?.on("data", (chunk: any) => {
    serverStderr += String(chunk?.toString?.() ?? chunk);
  });

  const client = new Client(
    { name: "gov-gpt-smoke-client", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await withTimeout(
      client.connect(transport),
      timeoutMs,
      `timeout connecting to MCP server after ${timeoutMs}ms; stderr=${serverStderr}`
    );

    const toolsRes = await withTimeout(
      client.listTools(),
      timeoutMs,
      `timeout listing tools after ${timeoutMs}ms; stderr=${serverStderr}`
    );
    const toolNames = (toolsRes.tools || []).map((t) => t.name);

    for (const name of [
      "usaspending.findEndpoints",
      "usaspending.findConcepts",
      "usaspending.findWorkflows",
      "usaspending.getEndpointSchema",
      "usaspending.getEndpointSemantics",
      "usaspending.getAnalysisPacket",
      "usaspending.getRequestTemplate",
      "usaspending.validateRequest",
      "usaspending.explainValidationError",
      "usaspending.callEndpoint",
      "usaspending.getEvidence",
      "usaspending.getUsageGuide",
      "usaspending.listRequestFields",
    ]) {
      assert(toolNames.includes(name), `missing tool: ${name}`);
    }
    assert(
      !toolNames.some((name) => /^usaspending\.v2__/.test(name)),
      "semantic-only server must not expose per-endpoint raw wrapper tools"
    );

    const findRes = await withTimeout(
      client.callTool({
        name: "usaspending.findEndpoints",
        arguments: { query: smokeSlug, limit: 5 },
      }),
      timeoutMs,
      `timeout calling usaspending.findEndpoints after ${timeoutMs}ms; stderr=${serverStderr}`
    );
    const findStructured = (findRes as any)?.structuredContent as any;
    assert(findStructured && Array.isArray(findStructured.results), "findEndpoints returned no structured results");
    assert(
      findStructured.results.some((item: any) => item.slug === smokeSlug),
      `findEndpoints did not surface ${smokeSlug}`
    );

    const semanticRes = await withTimeout(
      client.callTool({
        name: "usaspending.getEndpointSemantics",
        arguments: { slug: smokeSlug },
      }),
      timeoutMs,
      `timeout calling usaspending.getEndpointSemantics after ${timeoutMs}ms; stderr=${serverStderr}`
    );
    const semantics = (semanticRes as any)?.structuredContent as any;
    assert(semantics && semantics.slug === smokeSlug, `getEndpointSemantics returned unexpected payload for ${smokeSlug}`);

    const packetRes = await withTimeout(
      client.callTool({
        name: "usaspending.getAnalysisPacket",
        arguments: { slug: smokeSlug, includeUsageGuide: false },
      }),
      timeoutMs,
      `timeout calling usaspending.getAnalysisPacket after ${timeoutMs}ms; stderr=${serverStderr}`
    );
    const packet = (packetRes as any)?.structuredContent as any;
    assert(packet && packet.slug === smokeSlug, `getAnalysisPacket returned unexpected payload for ${smokeSlug}`);
    assert(
      Array.isArray(packet.requestConstruction?.templates) && packet.requestConstruction.templates.length > 0,
      "getAnalysisPacket did not include request templates"
    );
    assert(
      Array.isArray(packet.responseInterpretation?.interpretationWarnings),
      "getAnalysisPacket did not include interpretation warnings"
    );

    const validationRes = await withTimeout(
      client.callTool({
        name: "usaspending.validateRequest",
        arguments: {
          slug: smokeSlug,
          request: {
            filters: { award_type_codes: ["A", "B", "C", "D"] },
            fields: ["Award ID"],
          },
        },
      }),
      timeoutMs,
      `timeout calling usaspending.validateRequest after ${timeoutMs}ms; stderr=${serverStderr}`
    );
    const validation = (validationRes as any)?.structuredContent as any;
    assert(validation && validation.valid === false, "validateRequest did not reject missing required transaction sort");

    let apiStatus: number | null = null;
    if (callApi) {
      const templateRes = await withTimeout(
        client.callTool({
          name: "usaspending.getRequestTemplate",
          arguments: { slug: smokeSlug, useCase: "bounded contract transaction screen" },
        }),
        timeoutMs,
        `timeout calling usaspending.getRequestTemplate after ${timeoutMs}ms; stderr=${serverStderr}`
      );
      const templatePayload = (templateRes as any)?.structuredContent as any;
      const request = templatePayload?.templates?.[0]?.request;
      assert(request, `getRequestTemplate returned no request template for ${smokeSlug}`);

      const apiRes = await withTimeout(
        client.callTool({ name: "usaspending.callEndpoint", arguments: { slug: smokeSlug, request } }),
        Math.max(timeoutMs, 15_000),
        `timeout calling semantic endpoint ${smokeSlug}; stderr=${serverStderr}`
      );
      const result = (apiRes as any)?.structuredContent as any;
      apiStatus = typeof result?.status === "number" ? result.status : null;
      assert(typeof apiStatus === "number", `semantic call returned unexpected payload: ${JSON.stringify(result).slice(0, 400)}`);
      assert(apiStatus >= 200 && apiStatus < 500, `semantic call returned unexpected status=${apiStatus}`);
    }

    console.log(
      JSON.stringify(
        {
          event: "mcp_smoke_client_passed",
          startedAt,
          finishedAt: new Date().toISOString(),
          server: serverBin,
          toolCount: toolNames.length,
          smokeSlug,
          calledApi: callApi,
          apiStatus,
        },
        null,
        2
      )
    );
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
}

main().catch((err) => {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[MCP_SMOKE_CLIENT_FAILED] ${detail}`);
  process.exit(1);
});
