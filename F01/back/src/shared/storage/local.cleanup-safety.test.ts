import { expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { LocalStorageAdapter } from './local.adapter';

it('fails closed without scanning or deleting when references are an uncoordinated snapshot', async () => {
  const readdir = vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);
  const unlink = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
  try {
    const adapter = new LocalStorageAdapter('/unused-isolated-test-root', '/api/v1/uploads');
    await expect(adapter.cleanupOrphanedFiles(['https://previous.example/products/v/p/image.jpg']))
      .rejects.toThrow('Local orphan cleanup is unsafe');
    expect(readdir).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  } finally {
    readdir.mockRestore();
    unlink.mockRestore();
  }
});
