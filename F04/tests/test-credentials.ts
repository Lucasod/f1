export interface TestCredentials {
  username: string;
  password: string;
}

export function getValidCredentials(): TestCredentials {
  const password = process.env.SECRET_TEST_PASS || 'testpass123';
  return { username: 'alice', password };
}

export function getInvalidCredentials(): TestCredentials {
  const password = process.env.INVALID_TEST_PASS || 'wrongpass';
  return { username: 'alice', password };
}
