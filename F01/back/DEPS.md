# Dependency Workarounds

## ioredis-mock (v8.13.1)

**Problem:** Upstream ioredis-mock has a peer dependency on `@types/ioredis-mock` which was removed in the package. This causes peer dependency conflicts with ioredis@6 (the version used in this project).

**Upstream Issue:** [ioredis-mock PR #1500](https://github.com/ioredis/ioredis-mock/pull/1500) - not yet merged/published.

**Fork Relationship:** The patched tarball was created from the `chore/ioredis-6` branch of the [kibertoad/ioredis-mock fork](https://github.com/kibertoad/ioredis-mock/tree/chore/ioredis-6). This branch was created specifically to address the peer dependency issue by:
- Removing the `@types/ioredis-mock` peer dependency
- Updating peerDependencies to allow ioredis@6 (`"ioredis": "^5 || ^6"`)

**Workaround:** A patched version of ioredis-mock v8.13.1 has been created that:
- Removes the `@types/ioredis-mock` peer dependency
- Maintains compatibility with ioredis@6

**Implementation:**
1. The patched tarball is committed to `deps/ioredis-mock-8.13.1.tgz`
2. `package.json` references it via: `"ioredis-mock": "file:./deps/ioredis-mock-8.13.1.tgz"`
3. `@types/ioredis-mock` has been removed from devDependencies

**To Update:** When upstream PR #1500 is merged and published:
1. Remove `deps/ioredis-mock-8.13.1.tgz`
2. Update `package.json` to use: `"ioredis-mock": "^8.13.1"` (or newer)
3. Run `npm install` to fetch from npm registry

**Verification:**
- All 19 Redis cart repository tests pass
- All 548 backend tests pass
- Build passes
- Clean `npm ci` works reproducibly