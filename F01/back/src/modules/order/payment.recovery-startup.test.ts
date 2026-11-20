import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('payment recovery startup gate', () => {
  it('does not run recovery at startup before durable finalization is available', () => {
    const startup = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    expect(startup).not.toMatch(/\bpaymentService\s*\.\s*recoverPendingPayments\s*\(/);
  });
});
