# Kilo Orchestration Infrastructure

Independent orchestration runtime for Kilo agents. This module provides the core orchestration capabilities including run record management, validation, and persistence.

## Structure

```
kilo-orchestration/
├── src/                    # Source code
│   ├── types.ts           # Type definitions (RunRecord, RunStatus, etc.)
│   ├── validation.ts      # Validation and factory functions
│   └── index.ts           # Public exports
├── tests/                 # Test files
│   └── orchestration.test.ts
├── dist/                  # Compiled output (generated)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Installation

```bash
cd kilo-orchestration
npm install
```

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm test` - Run tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

## Core Concepts

### RunRecord

Represents a single orchestration run with the following fields:

- `runId`: Unique identifier for the run
- `startedAt`: ISO 8601 timestamp when the run started
- `status`: Current status (`IN_PROGRESS`, `COMPLETED`, `BLOCKED`, `PAUSED`)
- `branch`: Git branch (optional)
- `baseCommit`: Base commit SHA (optional)
- `scope`: Description of authorized task scope (optional)
- `nextAction`: Next planned action (optional)
- `updatedAt`: ISO 8601 timestamp of last update

### RunStatus

Valid status values:
- `IN_PROGRESS` - Run is actively executing
- `COMPLETED` - Run finished successfully
- `BLOCKED` - Run is blocked awaiting external input
- `PAUSED` - Run is temporarily paused

## Usage

```typescript
import { createRunRecord, validateRunRecord, RunStatus } from 'kilo-orchestration';

// Create a new run record
const record = createRunRecord({
  runId: 'run-abc123',
  startedAt: new Date().toISOString(),
  status: 'IN_PROGRESS',
  branch: 'feature/new-feature',
  scope: 'Implement user authentication'
});

// Validate a record
const result = validateRunRecord(record);
if (!result.isValid) {
  console.error('Validation errors:', result.errors);
}
```

## Testing

Run all tests:
```bash
npm test
```

Run with coverage:
```bash
npm run test:coverage
```

## Integration with Kilo

This module is designed to be used by the Kilo `Code` agent for orchestration runtime management. It provides the core data structures and validation logic for run records, which are persisted to `docs/agent_runs/<run-id>.md` in the project root.

The module is intentionally independent from the Marketplace backend (`back/`) and frontend (`front/`) to maintain clear architectural boundaries.