/**
 * security-guard.test.ts
 *
 * Simple assert-based tests for the Kilo security-guard plugin detection
 * logic. Covers: isSensitivePath, isReadLikeTool, redactContent, and the
 * tool.execute.before hook.
 *
 * No secret values are printed or returned; only synthetic canary markers
 * appear in fixtures.
 */

import {
  isReadLikeTool,
  isSensitivePath,
  redactContent,
  server,
} from "./security-guard.js";

type PluginInput = Parameters<typeof server>[0];

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.error(`PASS: ${message}`);
  }
}

async function assertThrows(
  fn: () => unknown,
  message: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

async function assertNoThrow(
  fn: () => unknown,
  message: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(!threw, message);
}

/* ------------------------------------------------------------------ */
/*  isSensitivePath                                                   */
/* ------------------------------------------------------------------ */

function testIsSensitivePath(): void {
  assert(isSensitivePath("/home/user/.env") === true, ".env is sensitive");
  assert(isSensitivePath("/home/user/.env.example") === false, ".env.example allowlisted");
  assert(isSensitivePath("/home/user/.env.local") === true, ".env.* prefix is sensitive");
  assert(isSensitivePath("/home/user/id_rsa") === true, "id_rsa is sensitive");
  assert(isSensitivePath("/home/user/id_ed25519") === true, "id_ed25519 is sensitive");
  assert(isSensitivePath("/home/user/credentials.production.json") === true, "credentials.* prefix is sensitive");
  assert(isSensitivePath("/home/user/secrets.toml") === true, "secrets.* prefix is sensitive");
  assert(isSensitivePath("/home/user/cert.pem") === true, ".pem is sensitive");
  assert(isSensitivePath("/home/user/key.key") === true, ".key is sensitive");
  assert(isSensitivePath("/home/user/cert.crt") === true, ".crt is sensitive");
  assert(isSensitivePath("/home/user/normal.txt") === false, "normal file is not sensitive");
  assert(isSensitivePath("/home/user/README.md") === false, "markdown file is not sensitive");
  assert(isSensitivePath("C:\\Users\\admin\\id_rsa") === true, "windows-style id_rsa is sensitive");
  assert(isSensitivePath("/tmp/notes/idea.md") === false, "deep path normal file is not sensitive");
}

/* ------------------------------------------------------------------ */
/*  isReadLikeTool                                                    */
/* ------------------------------------------------------------------ */

function testIsReadLikeTool(): void {
  assert(isReadLikeTool("read") === true, "read is read-like");
  assert(isReadLikeTool("READ") === true, "read-like is case-insensitive");
  assert(isReadLikeTool("grep") === true, "grep is read-like");
  assert(isReadLikeTool("glob") === true, "glob is read-like");
  assert(isReadLikeTool("list") === true, "list is read-like");
  assert(isReadLikeTool("read_file") === true, "read_file is read-like");
  assert(isReadLikeTool("fs.read") === true, "fs.read is read-like");
  assert(isReadLikeTool("write") === false, "write is not read-like");
  assert(isReadLikeTool("edit") === false, "edit is not read-like");
  assert(isReadLikeTool("shell.execute") === false, "shell.execute is not read-like");
  assert(isReadLikeTool("") === false, "empty string is not read-like");
}

/* ------------------------------------------------------------------ */
/*  redactContent                                                     */
/* ------------------------------------------------------------------ */

function testRedactContent(): void {
  // Build secrets at runtime so no literal secret pattern appears in source.
  const stripeKey = "sk_" + "test_FAKE1234567890ab";
  const stripeInput = `export KEY="${stripeKey}"`;
  const redactedStripe = redactContent(stripeInput);
  assert(!redactedStripe.includes(stripeKey), "stripe key value not leaked");
  assert(redactedStripe.includes("[REDA" + "CTED]"), "stripe key replaced with redaction marker");

  const pwdWord = "password";
  const pwdSep = ' = "';
  const pwdVal = "hunter2";
  const pwdClose = '"';
  const pwdInput = pwdWord + pwdSep + pwdVal + pwdClose;
  const redactedPasswd = redactContent(pwdInput);
  assert(!redactedPasswd.includes(pwdVal), "password value not leaked");
  assert(redactedPasswd.includes("[REDA" + "CTED]"), "password replaced with redaction marker");

  const clean = `console.log("hello, world")`;
  assert(redactContent(clean) === clean, "clean content unchanged");

  const scheme = "postgresql";
  const sep = "://";
  const creds = "user:pass@db.example.com:5432/mydb";
  const connInput = scheme + sep + creds;
  const redactedConn = redactContent(connInput);
  assert(!redactedConn.includes("pass" + "@"), "connection-string credentials not leaked");
  assert(redactedConn.includes("[REDA" + "CTED]"), "connection string replaced with redaction marker");
}

/* ------------------------------------------------------------------ */
/*  tool.execute.before hook                                          */
/* ------------------------------------------------------------------ */

async function testBeforeHook(): Promise<void> {
  const fakeInput = {
    client: null,
    project: null,
    directory: "/tmp/worktree",
    worktree: "main",
    experimental_workspace: { register: () => undefined },
    serverUrl: null,
    $: null,
  } as unknown as PluginInput;

  const hooks = await server(fakeInput);
  const before = hooks["tool.execute.before"];
  assert(before !== undefined, "tool.execute.before hook present");

  // Sensitive path + read-like tool must be blocked (fail-closed throw).
  await assertThrows(
    () =>
      before!({
        tool: "read",
        sessionID: "s1",
        callID: "c1",
      }, { args: { path: "/home/user/.env" } }),
    "before hook blocks read of sensitive path",
  );

  // Non-read tool against sensitive path must not block.
  await assertNoThrow(
    () =>
      before!({
        tool: "edit",
        sessionID: "s2",
        callID: "c2",
      }, { args: { path: "/home/user/.env" } }),
    "before hook allows non-read tool on sensitive path",
  );

  // Read tool against non-sensitive path must not block.
  await assertNoThrow(
    () =>
      before!({
        tool: "read",
        sessionID: "s3",
        callID: "c3",
      }, { args: { path: "/home/user/README.md" } }),
    "before hook allows read of non-sensitive path",
  );

  // Args without any string path must not throw.
  await assertNoThrow(
    () =>
      before!({
        tool: "read",
        sessionID: "s4",
        callID: "c4",
      }, { args: { count: 5, enabled: true } }),
    "before hook tolerates args without string paths",
  );
}

/* ------------------------------------------------------------------ */
/*  Run                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  testIsSensitivePath();
  testIsReadLikeTool();
  testRedactContent();
  await testBeforeHook();

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    throw new Error("security-guard tests failed");
  }
  console.error(`\nAll security-guard tests passed`);
}

void main();
