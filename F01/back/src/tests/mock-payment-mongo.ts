import type { ClientSession, Db } from 'mongodb';

// Runs transaction callbacks for in-memory fixtures without emulating MongoDB rollback.
export const mockPaymentMongo = {
  client: {
    startSession: () => {
      const session = {
        withTransaction: async (run: (session: ClientSession) => Promise<unknown>) =>
          run(session as unknown as ClientSession),
        endSession: async () => {}
      };
      return session;
    }
  }
} as unknown as Db;
