import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runPluginLines(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "plugin.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`exit ${code}: ${err}`));
      const lines = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      resolve(lines);
    });
    for (const r of requests) {
      child.stdin.write(JSON.stringify(r) + "\n");
    }
    child.stdin.end();
  });
}

test("Anna Executa v1.1 stdio protocol: describe, health, and invoke audit_bom", async () => {
  const bomCsv = fs.readFileSync(
    path.join(__dirname, "../hardwareguard-mcp/fixtures/sample_pcba_bom.csv"),
    "utf8"
  );
  const schJson = fs.readFileSync(
    path.join(__dirname, "../hardwareguard-mcp/fixtures/sample_schematic.json"),
    "utf8"
  );

  const resps = await runPluginLines([
    { jsonrpc: "2.0", id: 1, method: "describe" },
    { jsonrpc: "2.0", id: 2, method: "health" },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "invoke",
      params: { tool: "audit_bom", arguments: { bom_csv: bomCsv, schematic_json: schJson } },
    },
  ]);

  assert.equal(resps.length, 3);
  assert.equal(resps[0].result.name, "hardwareguard-bom-auditor");
  assert.equal(resps[1].result.status, "ready");
  assert.equal(resps[2].result.success, true);
  assert.equal(resps[2].result.data.gate.verdict, "REJECT");
  assert.match(resps[2].result.data.review_minutes_md, /BOM-FP-D1/);
});
