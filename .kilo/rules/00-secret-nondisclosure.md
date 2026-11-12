# 00-secret-nondisclosure — Permanent Secret Non-Disclosure Rule

This rule establishes the absolute requirement for all agents and delegated operations within the f1 project. It overrides all other considerations including debugging, testing, diagnostics, documentation, and agent handoffs.

## Absolute Prohibition

**NEVER DISCLOSE SECRET VALUES.**

Agents must never reproduce, quote, echo, print, transmit, summarize or expose authentication material of any kind. This prohibition applies without exception.

## Covered Secret Types

The prohibition applies to all of the following, whether encountered in code, configuration, logs, test fixtures, snapshots, or any other artifact:

- Passwords, passwd, pwd assignments (quoted or unquoted)
- API keys and restricted keys (sk_, rk_)
- Access keys (AKIA, ASIA)
- Private keys (PEM blocks: `-----BEGIN ... PRIVATE KEY-----`)
- Session tokens and session IDs
- Authorization headers (Bearer, Basic, Token schemes)
- Webhook secrets (whsec_)
- Connection strings with embedded credentials (URIs containing user:pass)
- Certificates (PEM blocks: `-----BEGIN CERTIFICATE-----`)
- Base64-encoded secrets and tokens
- GitHub personal access tokens (ghp_, ghos_, ggsr_, gou_)
- Slack tokens (xoxb_, xoxp_, xoxa_, xoxr_, xoxs_)

## Prohibited Actions

Without explicit human authorization, agents must never:

- Read, modify, delete, overwrite, or regenerate operational credential files
- Include secret values in final responses or intermediate commentary
- Include secret values in tool-call arguments under agent control
- Include secret values in tool outputs under agent control
- Include secret values in terminal output or error messages
- Include secret values in documentation, agent handoffs, or reviewer reports
- Include secret values in execution logs or context summaries
- Reproduce a secret merely to prove that a security vulnerability exists
- Quote or echo a secret even when reporting a finding or correction

## Compliance Requirements

- The rule must be loaded and enforced by Orchestra, Developer, Reviewer and all delegated agents.
- These requirements apply to every agent and delegated operation without exception.
- If a tool unexpectedly returns sensitive content, the agent must not repeat it or request the same content again.
- The rule must NOT contain procedures for replacing operational credential values.
- Reference the existing rules structure (.kilo/rules/ has universal-rules.md, project-rules.md, secrets-protection.md).

## Scope

This rule covers the entire f1 workspace including F01 and F04 directories, all git-tracked and untracked files, all environments (development, test, staging, production), and all agent execution contexts.

## Override

No exception, debugging session, test output, diagnostic report, or documentation update may weaken, bypass, or ignore this prohibition. In case of conflict, this rule takes precedence.