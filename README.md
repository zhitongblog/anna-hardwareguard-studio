# HardwareGuard BOM Studio — Anna AI OS App

A complete, cross-device **PCBA BOM Auditor, Cross-Board L4 Voltage Checker & Conservative IPD Release-Gate App** built natively for **Anna AI OS** (`anna.storage` + `anna.llm.complete`).

## Features
- **Deterministic PCBA BOM Audit Engine** (`bundle/bomEngine.js`):
  - Duplicate designator detection
  - Missing MPN & unapproved / EOL component gating
  - Voltage derating margin validation (`< 1.25x` bus peak)
  - Schematic-vs-BOM value swap & footprint mismatch checks (e.g., `SMB` vs `SMA`)
  - Missing schematic part detection
- **Cross-Board L4 Connector Verification**: Flags mated PCB voltage domain conflicts (e.g., 5V vs 12V) and disconnected signals.
- **Conservative IPD Release Gate (`PASS` / `CONDITIONAL` / `REJECT`)**: Routes defects by owner (`Hardware Engineering`, `Procurement / Component Eng`, `Firmware Engineering`) and tracks risk-accepted waivers in a visible ledger without hiding critical risks.
- **AI-Native Core (Zero API Keys via `anna.llm.complete`)**:
  - **✨ AI ECO Plan**: Generates grouped engineering remediation steps & DVT bench verification criteria.
  - **📋 AI Sign-Off Memo**: Drafts factory SMT & executive IPD gate sign-off memos.
- **Cross-Device Persistence**: Saves board inputs and waiver ledgers per user in Anna Persistent Storage (`anna.storage`).

## Validate & Publish
```bash
anna-app validate --strict
node --test test.mjs
anna-app login --host https://anna.partners
anna-app account set-handle <your-handle>
anna-app apps publish
anna-app apps submit-review
```

## License
Apache-2.0
