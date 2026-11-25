#!/usr/bin/env node
/**
 * Anna AI OS Executa v1.1 Plugin: HardwareGuard PCBA BOM & IPD Auditor
 * Reuses our deterministic hardware BOM/L4/IPD engine to ship directly on Anna Marketplace
 * (Anna AI App Builder Program — up to $5,000/month recurring grant per qualifying app).
 */

import readline from "node:readline";
import {
  auditBom,
  evaluateIpdGate,
  formatReviewMinutes,
  traceCrossBoardConnectors,
} from "./bundle/bomEngine.js";

const MANIFEST = {
  name: "hardwareguard-bom-auditor",
  display_name: "HardwareGuard BOM & IPD Auditor",
  version: "0.1.0",
  description:
    "Deterministic PCBA BOM auditing, cross-board connector voltage checks, and conservative IPD pilot/mass-production release gating.",
  author: "Xiangdong Li <lixd220@gmail.com>",
  homepage: "https://doaipm.com",
  icon: "🔧",
  tools: [
    {
      name: "audit_bom",
      description:
        "Audit a PCBA BOM CSV against optional schematic reference parts for value swaps, footprint mismatches (SMB vs SMA), derating (<1.25x), missing MPNs, and duplicates.",
      parameters: [
        { name: "bom_csv", type: "string", description: "Raw BOM CSV text", required: true },
        {
          name: "schematic_json",
          type: "string",
          description: "Optional JSON array of schematic parts [{designator,value,footprint}]",
          required: false,
        },
      ],
    },
    {
      name: "check_cross_board",
      description:
        "Verify mated connector pins between two PCBs for voltage domain conflicts (e.g. 5V vs 12V) and disconnected signals.",
      parameters: [
        {
          name: "connectors_json",
          type: "string",
          description: "JSON array of mated pin pairs",
          required: true,
        },
      ],
    },
    {
      name: "evaluate_ipd_gate",
      description:
        "Compute conservative PASS/CONDITIONAL/REJECT release verdict with owner routing and visible risk-accepted ledger.",
      parameters: [
        { name: "board_name", type: "string", description: "Board or product name", required: true },
        { name: "issues_json", type: "string", description: "JSON array of defect issues", required: true },
      ],
    },
  ],
};

function invokeTool(tool, args) {
  if (tool === "audit_bom") {
    const schematic = args.schematic_json ? JSON.parse(args.schematic_json) : [];
    const result = auditBom(args.bom_csv, schematic);
    return {
      success: true,
      data: {
        ...result,
        review_minutes_md: formatReviewMinutes("BOM Audit", result),
      },
    };
  }
  if (tool === "check_cross_board") {
    const connectors = JSON.parse(args.connectors_json || "[]");
    return { success: true, data: traceCrossBoardConnectors(connectors) };
  }
  if (tool === "evaluate_ipd_gate") {
    const issues = JSON.parse(args.issues_json || "[]");
    const gate = evaluateIpdGate(args.board_name || "Hardware Board", issues);
    return {
      success: true,
      data: {
        ...gate,
        review_minutes_md: formatReviewMinutes(gate.boardName, { gate, findings: issues }),
      },
    };
  }
  const err = new Error(`unknown tool: ${tool}`);
  err.code = -32601;
  throw err;
}

function send(id, payload) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...payload }) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return send(null, { error: { code: -32700, message: "parse error" } });
  }
  try {
    if (req.method === "describe") return send(req.id, { result: MANIFEST });
    if (req.method === "health") return send(req.id, { result: { status: "ready" } });
    if (req.method === "invoke") {
      const params = req.params || {};
      return send(req.id, { result: invokeTool(params.tool, params.arguments || {}) });
    }
    return send(req.id, { error: { code: -32601, message: `unknown method: ${req.method}` } });
  } catch (e) {
    return send(req.id, { error: { code: e.code ?? -32603, message: e.message } });
  }
});
