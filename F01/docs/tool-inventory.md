# Tool Inventory — FS-01 Marketplace

This document provides a comprehensive inventory of available tools for each agent type in the FS-01 Marketplace project. It categorizes tools by availability, authorization status, and operational boundaries.

---

## Orchestra Agent

| Designation | Status |
|------------|--------|
| AVAILABLE | Tools confirmed operational within authorized scope |
| UNAVAILABLE | Tools not accessible or outside scope |
| UNAUTHORIZED | Tools explicitly prohibited for this agent type |
| UNKNOWN | Tool status not determined |
| TEMPORARILY FAILED | Tool experiencing transient issues |
| DISABLED BY POLICY | Tool restricted by security policy |

### Orchestration Tools

| Tool ID | Name | Provider | Authorized Agents | Operations Allowed | Operations Prohibited | Scope | Permissions Required | Security Risks | Human Approval | Verification Method | Authorized Fallback |
|---------|------|----------|-------------------|--------------------|-----------------------|-------|----------------------|----------------|----------------|----------------------|---------------------|

---

## Developer Agent

| Designation | Status |
|------------|--------|
| AVAILABLE | Tools confirmed operational within authorized scope |
| UNAVAILABLE | Tools not accessible or outside scope |
| UNAUTHORIZED | Tools explicitly prohibited for this agent type |
| UNKNOWN | Tool status not determined |
| TEMPORARILY FAILED | Tool experiencing transient issues |
| DISABLED BY POLICY | Tool restricted by security policy |

### Developer Tools

| Tool ID | Name | Provider | Authorized Agents | Operations Allowed | Operations Prohibited | Scope | Permissions Required | Security Risks | Human Approval | Verification Method | Authorized Fallback |
|---------|------|----------|-------------------|--------------------|-----------------------|-------|----------------------|----------------|----------------|----------------------|---------------------|

---

## Reviewer Agent

| Designation | Status |
|------------|--------|
| AVAILABLE | Tools confirmed operational within authorized scope |
| UNAVAILABLE | Tools not accessible or outside scope |
| UNAUTHORIZED | Tools explicitly prohibited for this agent type |
| UNKNOWN | Tool status not determined |
| TEMPORARILY FAILED | Tool experiencing transient issues |
| DISABLED BY POLICY | Tool restricted by security policy |

### Reviewer Tools

| Tool ID | Name | Provider | Authorized Agents | Operations Allowed | Operations Prohibited | Scope | Permissions Required | Security Risks | Human Approval | Verification Method | Authorized Fallback |
|---------|------|----------|-------------------|--------------------|-----------------------|-------|----------------------|----------------|----------------|----------------------|---------------------|

---

## Cross-Agent Tool Summary

| Tool ID | Name | Provider | AVAILABLE Agents | UNAVAILABLE Agents | UNAUTHORIZED Agents | Notes |
|---------|------|----------|------------------|--------------------|---------------------|-------|
| T-001 | Task delegation | Orchestration | code-orchestrator | — | code-developer, code-reviewer | Primary orchestration mechanism |
| T-002 | File edit | code-developer | code-developer | code-reviewer | — | Subject to scope authorization |
| T-003 | Code review | code-reviewer | code-reviewer | code-developer | — | Independent review required |
| T-004 | Secret scanning | code-developer | code-developer | — | — | Uses scan-secrets.sh |
| T-005 | Browser automation | — | — | — | — | Not available in current scope |
| T-006 | Git operations | code-orchestrator | code-orchestrator, code-developer (read-only) | — | code-developer (mutating) | Read-only for inspection |
| T-007 | Test execution | code-developer | code-developer | — | — | Unit, integration, E2E |
| T-008 | Configuration read | code-developer | code-developer | — | — | Reads .env, config files (no secrets) |
| T-009 | Playwright tests | — | — | code-developer | — | E2E only in authorized scope |
| T-010 | Memory recall | code-developer | code-developer | — | — | Project memory queries |

---

## Authorization Matrix

| Designation | Meaning |
|-------------|---------|
| AVAILABLE | Tool is operational and accessible to the agent within its authorized scope |
| UNAVAILABLE | Tool exists but is not accessible or functional for this agent type |
| UNAUTHORIZED | Agent is explicitly prohibited from using this tool (scope violation) |
| UNKNOWN | Tool status has not been determined or verified |
| TEMPORARILY FAILED | Tool is experiencing transient issues; may become available later |
| DISABLED BY POLICY | Tool is restricted by security policy or compliance requirements; permanent restriction |

**Note:** This inventory reflects the current state as of 2026-11-11 and will be updated as tools are provisioned, retired, or re-authorized. All tool usage must respect the authorized_paths and forbidden_paths defined in the delegation contract.