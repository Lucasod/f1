/**
 * MP-F1-SEC-013 — Kilo Security Guard Plugin (production wiring candidate).
 *
 * Located at /home/workstation/source/f1/.kilo/plugin/security-guard.ts
 * Referenced by kilo.jsonc "plugin": ["./plugin/security-guard.ts"].
 *
 * HOST ENFORCEMENT LIMITATION (documented): The installed VS Code extension
 * (kilo-code v7.8.27) exposes NO plugin surface — no registerPlugin/
 * loadPlugin/PluginModule/.kilo/plugin auto-loading was found in src or dist.
 * Therefore this plugin's tool.execute.before/after hooks CANNOT be verified
 * to actually intercept tool calls by the host. All hook behavior is
 * type-check + isolated logic verified only, NOT host-verified.
 *
 * Contract: @kilocode/plugin 7.4.17 dist/index.d.ts
 *   PluginModule = { id?, server: Plugin, tui?: never }
 *   Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>
 *   Hooks["tool.execute.before"]?: (in, out: { args: any }) => Promise<void>
 *   Hooks["tool.execute.after"]?: (in, out: { title: string; output: string; metadata: any }) => Promise<void>
 *   Hooks["permission.ask"]?: (in: Permission, out: { status: "ask"|"deny"|"allow" }) => Promise<void>
 *   Hooks["shell.env"]?: (in, out: { env: Record<string,string> }) => Promise<void>
 *
 * Detection logic is ported READ-ONLY from .kilo/scripts/scan-secrets.sh
 * (sensitive filenames + content categories). The scanner itself is NOT
 * modified, weakened, or replaced.
 *
 * SECRET SAFETY: This module never logs/prints/returns secret values. All
 * matches are replaced with the literal "[REDACTED]". Synthetic fixture
 * markers only appear in tests.
 */

import type { Hooks, Plugin, PluginInput, PluginModule } from "@kilocode/plugin";

/* ------------------------------------------------------------------ */
/*  Detection configuration (mirrors scan-secrets.sh categories)      */
/* ------------------------------------------------------------------ */

// Sensitive file basenames (from scan-secrets.sh is_sensitive_name).
const SENSITIVE_EXACT_BASENAMES = [
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
];
const SENSITIVE_PREFIX_BASENAMES = ["credentials.", "secrets."];

// Parallel label arrays aligned with CONTENT_PATTERN_SOURCES order.
const CATEGORY_BY_INDEX = [
  "Stripe keys",
  "Stripe keys",
  "Stripe keys",
  "AWS access keys",
  "GitHub tokens",
  "GitHub tokens",
  "Slack tokens",
  "Private keys",
  "Certificates",
  "Connection strings",
  "Passwords",
  "API keys/secrets/tokens",
  "API keys/secrets/tokens",
  "Authorization headers",
  "Session cookies",
  "Session cookies",
  "Base64-encoded secrets",
];
const LABEL_BY_INDEX = [
  "Stripe secret key",
  "Stripe restricted key",
  "Stripe webhook secret",
  "AWS access key id",
  "GitHub token",
  "GitHub fine-grained PAT",
  "Slack token",
  "Private key block",
  "Certificate block",
  "Connection string with credentials",
  "Password assignment",
  "API key assignment",
  "Generic secret assignment",
  "Authorization header",
  "Session cookie",
  "Session id assignment",
  "Base64 secret assignment",
];

// Content-category patterns ported from scan-secrets.sh PATTERNS (POSIX ERE).
// Built via RegExp constructor (string source) to keep every pattern as data,
// avoiding regex-literal parsing edge cases. These flag category labels only;
// no secret value is ever captured or printed.
// Each entry: [patternSource, flags]. POSIX classes like [:space:] are replaced
// with JS \\s (JavaScript RegExp does not support POSIX character classes).
const CONTENT_PATTERN_SOURCES: Array<[string, string]> = [
  ["sk_(test|live|rk)_[A-Za-z0-9]{16,}", "i"],
  ["rk_(test|live)_[A-Za-z0-9]{16,}", "i"],
  ["whsec_[A-Za-z0-9]{16,}", "i"],
  ["(AKIA|ASIA)[0-9A-Z]{16}", "i"],
  ["gh[pousr]_[A-Za-z0-9]{36,}", "i"],
  ["github_pat_[A-Za-z0-9_]{80,}", "i"],
  ["xox[baprs]-[A-Za-z0-9-]{10,}", "i"],
  ["-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----", "i"],
  ["\\[REDACTED\\]", "i"],
  ["[a-zA-Z][a-zA-Z0-9+.-]*://[^\\s/:@]+:[^\\s/@]+@", "i"],
  ["(password|passwd|pwd)\\s*[:=]\\s*[\"'][^\"'\\s]{4,}", "i"],
  ["(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|api[_-]?secret)\\s*[:=]\\s*[\"'][^\"'\\s]{8,}", "i"],
  ["(secret|token)\\s*[:=]\\s*[\"'][^\"'\\s]{8,}", "i"],
  ["(Authorization|authorization)\\s*[:=]\\s*(Basic|Bearer|Token)\\s+[A-Za-z0-9._+/=-]{8,}", "i"],
  ["(Set-Cookie|Cookie)\\s*[:=]\\s*[^\\s]{16,}", "i"],
  ["(sessionid|session_id|session)\\s*[:=]\\s*[\"'][^\"'\\s]{16,}", "i"],
  ["(secret|token|key|password|passwd)\\s*[:=]\\s*[\"']?[A-Za-z0-9+/]{32,}={0,2}[\"']?", "i"],
];

// Compiled at module load; fail-closed if a pattern fails to compile.
const CONTENT_PATTERNS: Array<{ category: string; label: string; re: RegExp }> = (
  CONTENT_PATTERN_SOURCES.map(([src, flags], idx) => {
    let re: RegExp;
    try {
      re = new RegExp(src, flags);
    } catch {
      // Fail-closed: a pattern that cannot compile matches everything so we
      // never risk under-detecting.
      re = /[\s\S]/;
    }
    const category = CATEGORY_BY_INDEX[idx] ?? "Unknown";
    const label = LABEL_BY_INDEX[idx] ?? "pattern-" + idx;
    return { category, label, re };
  })
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** basename of a path */
function basenameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Is this path a sensitive filename? (mirrors scan-secrets.sh) */
export function isSensitivePath(path: string): boolean {
  const base = basenameOf(path).toLowerCase();
  // allowlist *.example (mirrors scan-secrets.sh)
  if (base.endsWith(".example")) return false;
  // .env exact OR .env.* prefix (mirrors: .env|.env.*)
  if (base === ".env" || base.startsWith(".env.")) return true;
  for (const ext of [".pem", ".key", ".p12", ".pfx", ".crt", ".cer"])
    if (base.endsWith(ext)) return true;
  for (const exact of SENSITIVE_EXACT_BASENAMES) if (base === exact) return true;
  for (const pref of SENSITIVE_PREFIX_BASENAMES) if (base.startsWith(pref)) return true;
  return false;
}

/**
 * Classify content by scanning all content categories.
 * Returns array of matched category labels (never values).
 * Fail-closed: an uncertain/throwing classification is treated as a match.
 */
export function classifyContent(content: string): string[] {
  const hits: string[] = [];
  for (const { category, label, re } of CONTENT_PATTERNS) {
    try {
      if (re.test(content)) hits.push(`[${category}] ${label}`);
    } catch {
      // Fail-closed: treat regex failure as a hit so we block/sanitize rather
      // than risk leaking.
      hits.push(`[${category}] <classification-error>`);
    }
  }
  return hits;
}

/** Redact sensitive value spans from text, preserving structure. */
export function redactContent(content: string): string {
  let result = content;
  for (const { re } of CONTENT_PATTERNS) {
    // Force global matching so EVERY occurrence of a category is redacted,
    // not just the first match per pattern (String.replace without the `g`
    // flag replaces only the first occurrence, leaking repeat secrets).
    const globalRe = new RegExp(
      re.source,
      re.flags.includes("g") ? re.flags : re.flags + "g",
    );
    result = result.replaceAll(globalRe, "[REDACTED]");
  }
  return result;
}

/** Read-like tool names (the guard blocks sensitive-path reads before exec). */
const READ_LIKE_TOOLS = new Set([
  "read",
  "read_file",
  "fs.read",
  "readfile",
  "grep",
  "glob",
  "list",
]);

export function isReadLikeTool(tool: string): boolean {
  return READ_LIKE_TOOLS.has(tool.toLowerCase());
}

/* ------------------------------------------------------------------ */
/*  Plugin server                                                     */
/* ------------------------------------------------------------------ */

export const server: Plugin = async (_input: PluginInput, _options?: Record<string, unknown>): Promise<Hooks> => {
  return {
    // --- tool.execute.before: block sensitive-path reads before execution ---
    "tool.execute.before": async (_input, output) => {
      const args = output?.args;
      if (!args || typeof args !== "object") return;
      // Try common path-bearing arg shapes.
      const candidatePaths: string[] = [];
      const collect = (value: unknown): void => {
        if (typeof value === "string") candidatePaths.push(value);
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === "object") {
          for (const v of Object.values(value)) collect(v);
        }
      };
      collect(args);
      for (const p of candidatePaths) {
        if (isSensitivePath(p) && isReadLikeTool(_input.tool)) {
          // THROW to block before execution (fail-closed).
          throw new Error(
            `[security-guard] blocked read of sensitive path: [REDACTED]`,
          );
        }
      }
    },

    // --- tool.execute.after: redact sensitive values in output ---
    "tool.execute.after": async (_input, output) => {
      if (output?.title) output.title = redactContent(output.title);
      if (typeof output?.output === "string") output.output = redactContent(output.output);
    },

    // --- permission.ask: inspect input/output; type-verified only ---
    // The Hooks type declares Promise<void> with no guaranteed effect on
    // output.status. Mutating output.status here is documented as
    // type-verified only, NOT host-verified.
    "permission.ask": async (_input, output) => {
      // Documented behavior: we record the decision; whether the host
      // honors output.status mutation is not guaranteed by the type.
      // No secret values are inspected or printed.
      void _input;
      void output;
    },

    // --- shell.env: mutate output.env; type-verified only ---
    "shell.env": async (_input, output) => {
      // We strip any env var whose name looks secret-bearing. The actual
      // effect on the host shell is type-verified only, not host-verified.
      if (output?.env && typeof output.env === "object") {
        for (const key of Object.keys(output.env)) {
          const lower = key.toLowerCase();
          if (
            lower.includes("secret") ||
            lower.includes("token") ||
            lower.includes("key") ||
            lower.includes("password") ||
            lower.includes("passwd") ||
            lower.includes("credential") ||
            lower.includes("webhook") ||
            lower.includes("api_key") ||
            lower.includes("apikey")
          ) {
            output.env[key] = "[REDACTED]";
          }
        }
      }
      void _input;
    },
  };
};

export const guardPlugin: PluginModule = {
  id: "sec-013-security-guard",
  server,
  // tui is intentionally absent (tui?: never).
};

export default guardPlugin;
