import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import {
  auditBom,
  evaluateIpdGate,
  formatReviewMinutes,
  traceCrossBoardConnectors,
} from "./bomEngine.js";

const STORAGE_KEY = "hardwareguard/workspace-v1";
const LOCAL_KEY = "hardwareguard:workspace:v1";

const SAMPLES = {
  powerbank: {
    boardName: "PB-2026-RevC Mainboard",
    bomCsv: [
      "designator,value,footprint,mpn,status,voltagerating,busvoltage",
      "U1,IP5356,QFN32,INJOINIC-IP5356,APPROVED,20,12",
      "C12,22uF,0805,GRM21BR61A226ME44,APPROVED,10,12",
      "D1,SMBJ15A,SMA,LITTELFUSE-SMBJ15A,APPROVED,15,12",
      "R4,4.7k,0402,RC0402FR-074K7L,APPROVED,50,5",
      "Q2,AO3400A,SOT23,TBD,UNAPPROVED_ALT,30,12",
    ].join("\n"),
    schematicJson: JSON.stringify(
      [
        { designator: "D1", value: "SMBJ15A", footprint: "SMB" },
        { designator: "R4", value: "10k", footprint: "0402" },
        { designator: "U2", value: "INA219", footprint: "SOT23-8" },
      ],
      null,
      2
    ),
    connectorsJson: "[]",
  },
  clean: {
    boardName: "SensorNode-RevB Production",
    bomCsv: [
      "designator,value,footprint,mpn,status,voltagerating,busvoltage",
      "U1,STM32G030F6P6,TSSOP20,STM32G030F6P6,APPROVED,3.6,3.3",
      "C1,10uF,0603,CL10A106KP8NNNC,APPROVED,10,3.3",
      "R1,10k,0402,RC0402FR-0710KL,APPROVED,50,3.3",
    ].join("\n"),
    schematicJson: JSON.stringify(
      [
        { designator: "U1", value: "STM32G030F6P6", footprint: "TSSOP20" },
        { designator: "C1", value: "10uF", footprint: "0603" },
        { designator: "R1", value: "10k", footprint: "0402" },
      ],
      null,
      2
    ),
    connectorsJson: JSON.stringify(
      [
        { connector: "J1", pin: 1, boardA_net: "VCC_3V3", boardA_voltage: 3.3, boardB_net: "VDD_3V3", boardB_voltage: 3.3 },
      ],
      null,
      2
    ),
  },
  crossboard: {
    boardName: "DockStation Dual-PCB Assembly",
    bomCsv: [
      "designator,value,footprint,mpn,status,voltagerating,busvoltage",
      "J1,Header-2x5,HDR-2.54,MOLEX-90131,APPROVED,250,12",
      "C3,47uF,1206,GRM31CR61E476ME44,APPROVED,25,12",
    ].join("\n"),
    schematicJson: "[]",
    connectorsJson: JSON.stringify(
      [
        { connector: "J1", pin: 1, boardA_net: "VBUS_5V", boardA_voltage: 5, boardB_net: "VIN_12V", boardB_voltage: 12 },
        { connector: "J1", pin: 2, boardA_net: "I2C_SDA", boardA_voltage: 3.3, boardB_net: "NC", boardB_voltage: 0 },
      ],
      null,
      2
    ),
  },
};

let anna = null;
let currentFindings = [];
let acceptedIds = new Set();
let lastGate = null;

function extractLlmText(resp) {
  if (!resp) return "";
  if (typeof resp.content === "string") return resp.content;
  if (resp.content && typeof resp.content.text === "string") return resp.content.text;
  if (typeof resp.text === "string") return resp.text;
  return JSON.stringify(resp, null, 2);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getWorkspacePayload() {
  return {
    boardName: document.getElementById("board-name").value,
    bomCsv: document.getElementById("bom-input").value,
    schematicJson: document.getElementById("sch-input").value,
    connectorsJson: document.getElementById("conn-input").value,
    acceptedIds: [...acceptedIds],
  };
}

async function persistWorkspace() {
  const data = getWorkspacePayload();
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
  if (!anna?.storage?.set) return;
  try {
    await anna.storage.set({ key: STORAGE_KEY, value: data });
  } catch (e) {
    console.warn("APS storage.set failed:", e);
  }
}

async function loadWorkspace() {
  let saved = null;
  if (anna?.storage?.get) {
    try {
      const res = await anna.storage.get({ key: STORAGE_KEY });
      if (res?.exists && res.value && typeof res.value === "object") {
        saved = res.value;
      }
    } catch (e) {
      console.warn("APS storage.get failed:", e);
    }
  }
  if (!saved) {
    try {
      saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    } catch {
      saved = null;
    }
  }
  if (saved && saved.bomCsv) {
    document.getElementById("board-name").value = saved.boardName || "Hardware Board";
    document.getElementById("bom-input").value = saved.bomCsv;
    document.getElementById("sch-input").value = saved.schematicJson || "[]";
    document.getElementById("conn-input").value = saved.connectorsJson || "[]";
    acceptedIds = new Set(Array.isArray(saved.acceptedIds) ? saved.acceptedIds : []);
  } else {
    loadSample("powerbank");
  }
}

function loadSample(key) {
  const s = SAMPLES[key] || SAMPLES.powerbank;
  document.getElementById("board-name").value = s.boardName;
  document.getElementById("bom-input").value = s.bomCsv;
  document.getElementById("sch-input").value = s.schematicJson;
  document.getElementById("conn-input").value = s.connectorsJson;
  acceptedIds = new Set();
  runAudit();
}

function runAudit() {
  const outBox = document.getElementById("output-box");
  const boardName = document.getElementById("board-name").value.trim() || "Hardware Board";
  const bomCsv = document.getElementById("bom-input").value;

  let sch = [];
  let conns = [];
  try {
    const rawSch = document.getElementById("sch-input").value.trim();
    sch = rawSch ? JSON.parse(rawSch) : [];
  } catch (e) {
    outBox.textContent = "Invalid Schematic JSON: " + e.message;
    return;
  }
  try {
    const rawConn = document.getElementById("conn-input").value.trim();
    conns = rawConn ? JSON.parse(rawConn) : [];
  } catch (e) {
    outBox.textContent = "Invalid Connectors JSON: " + e.message;
    return;
  }

  const bomRes = auditBom(bomCsv, sch);
  const connRes = traceCrossBoardConnectors(conns);
  currentFindings = [...bomRes.findings, ...connRes.findings].map((f) => ({
    ...f,
    riskAccepted: acceptedIds.has(f.id),
  }));
  lastGate = evaluateIpdGate(boardName, currentFindings);

  renderGate();
  renderFindings();
  persistWorkspace();
}

function renderGate() {
  const card = document.getElementById("gate-card");
  const verdictEl = document.getElementById("gate-verdict");
  const metricsEl = document.getElementById("gate-metrics");
  const banner = document.getElementById("risk-banner");
  const ownerEl = document.getElementById("owner-summary");

  card.className = "gate-card " + lastGate.verdict.toLowerCase();
  verdictEl.textContent = lastGate.verdict;
  const b = lastGate.breakdown;
  metricsEl.innerHTML = [
    `<span class="metric-pill">Critical: <strong>${b.critical}</strong></span>`,
    `<span class="metric-pill">High: <strong>${b.high}</strong></span>`,
    `<span class="metric-pill">Medium: <strong>${b.medium}</strong></span>`,
    `<span class="metric-pill">Waived: <strong>${lastGate.acceptedRiskCount}</strong></span>`,
  ].join("");

  if (lastGate.warningBanner) {
    banner.textContent = "⚠ " + lastGate.warningBanner;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  const owners = Object.entries(lastGate.ownerWorkload || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  ownerEl.textContent = owners ? `Owners: ${owners}` : "Zero open defects";
}

function renderFindings() {
  const list = document.getElementById("findings-list");
  list.innerHTML = "";
  if (!currentFindings.length) {
    list.innerHTML = `<div class="finding" style="border-left-color:var(--green)"><span>✓ All deterministic BOM &amp; cross-board checks passed with zero findings.</span><span class="sev-tag">PASS</span></div>`;
    return;
  }
  for (const f of currentFindings) {
    const row = document.createElement("div");
    row.className = `finding ${f.severity} ${f.riskAccepted ? "accepted" : ""}`;
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(f.id)}</strong> · <span class="muted">${escapeHtml(f.layer)} / ${escapeHtml(f.owner)}</span></div>
        <div style="margin-top:3px;">${escapeHtml(f.summary)}</div>
      </div>
      <span class="sev-tag">${f.riskAccepted ? "RISK-ACCEPTED" : escapeHtml(f.severity)}</span>
    `;
    row.onclick = () => {
      if (acceptedIds.has(f.id)) acceptedIds.delete(f.id);
      else acceptedIds.add(f.id);
      runAudit();
    };
    list.appendChild(row);
  }
}

async function callHostLlm(systemPrompt, userPrompt) {
  const outBox = document.getElementById("output-box");
  if (!anna?.llm?.complete) {
    outBox.textContent =
      "Connect inside Anna AI OS to run zero-API-key AI Engineering Remediation & Sign-Off Memo generation.\n\n" +
      formatReviewMinutes(lastGate?.boardName || "Board", { gate: lastGate, findings: currentFindings });
    return;
  }
  outBox.textContent = "Generating AI engineering analysis via Anna Host LLM…";
  try {
    const resp = await anna.llm.complete({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1400,
      temperature: 0.2,
    });
    outBox.textContent = extractLlmText(resp);
  } catch (e) {
    outBox.textContent = "LLM request failed: " + (e?.message || String(e));
  }
}

async function main() {
  const badge = document.getElementById("host-badge");
  try {
    anna = await AnnaAppRuntime.connect();
    await anna.window.set_title({ title: "HardwareGuard BOM Studio" });
    badge.textContent = "Anna OS Connected";
  } catch {
    badge.textContent = "Local Preview";
  }

  await loadWorkspace();
  runAudit();

  document.getElementById("sample-select").addEventListener("change", (e) => {
    loadSample(e.target.value);
  });
  document.getElementById("btn-audit").addEventListener("click", runAudit);
  document.getElementById("btn-export").addEventListener("click", () => {
    document.getElementById("output-box").textContent = formatReviewMinutes(
      lastGate?.boardName || "Hardware Board",
      { gate: lastGate, findings: currentFindings }
    );
  });

  document.getElementById("btn-ai-plan").addEventListener("click", async () => {
    const minutes = formatReviewMinutes(lastGate?.boardName || "Hardware Board", {
      gate: lastGate,
      findings: currentFindings,
    });
    await callHostLlm(
      "You are a Principal Hardware & Manufacturing NPI Engineer. Given deterministic PCBA BOM/L4 audit findings, write a concrete ECO remediation plan grouped by owner (Hardware Eng, Procurement, Firmware), specifying exact component derating/footprint criteria and DVT bench verification steps. Never dismiss Critical/High defects.",
      minutes
    );
  });

  document.getElementById("btn-ai-memo").addEventListener("click", async () => {
    const minutes = formatReviewMinutes(lastGate?.boardName || "Hardware Board", {
      gate: lastGate,
      findings: currentFindings,
    });
    await callHostLlm(
      "You are a Hardware Engineering Director preparing a crisp IPD Pilot/Mass-Production Gate sign-off memo for factory SMT & executive stakeholders. Summarize the gate verdict, blocking risks, any risk-accepted waivers (highlight them prominently), and required sign-off conditions.",
      minutes
    );
  });
}

main();
