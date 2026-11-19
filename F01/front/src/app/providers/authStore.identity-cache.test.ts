import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from './queryClient';
import { useAuthStore } from './authStore';
import { authApi } from '@/shared/api/auth';

vi.mock('@/shared/api/auth', () => ({
  authApi: { login: vi.fn(), register: vi.fn(), refreshToken: vi.fn() },
}));
vi.mock('@/shared/api/cart', () => ({
  cartApi: { mergeGuestCart: vi.fn(), clearGuestCartId: vi.fn() },
}));

describe('authentication identity changes', () => {
  const responseFor = (id: string) => ({
    person: { id, name: id, email: `${id}@example.test`, roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
    tokens: { accessToken: crypto.randomUUID(), refreshToken: crypto.randomUUID() },
  });
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const login = async (id: string) => {
    const response = responseFor(id);
    vi.mocked(authApi.login).mockResolvedValueOnce(response);
    await useAuthStore.getState().login(response.person.email, crypto.randomUUID());
    return response;
  };
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['login', 'register'] as const)('%s removes data cached for the previous identity', async (action) => {
    const previousUser = { id: 'previous', name: 'Previous', email: 'previous@example.test', roles: ['CONSUMER'] as const };
    useAuthStore.setState({ user: { ...previousUser, roles: [...previousUser.roles] }, isAuthenticated: true });
    queryClient.setQueryData(['admin', 'reviews'], { owner: previousUser.id });
    const response = {
      person: { id: 'next', name: 'Next', email: 'next@example.test', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
      tokens: { accessToken: crypto.randomUUID(), refreshToken: crypto.randomUUID() },
    };
    if (action === 'login') {
      vi.mocked(authApi.login).mockResolvedValueOnce(response);
      await useAuthStore.getState().login(response.person.email, crypto.randomUUID());
    } else {
      vi.mocked(authApi.register).mockResolvedValueOnce(response);
      await useAuthStore.getState().register({ name: 'Next', email: response.person.email, taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' });
    }
    expect(useAuthStore.getState().user?.id).toBe('next');
    expect(queryClient.getQueryData(['admin', 'reviews'])).toBeUndefined();
  });

  it.each(['login', 'register'] as const)('%s publishes identity only after updating client credentials', async (action) => {
    await login('previous');
    const next = responseFor('next');
    let synchronized = false;
    const unsubscribe = useAuthStore.subscribe(state => {
      if (state.user?.id === 'next') synchronized = localStorage.getItem('accessToken') === next.tokens.accessToken;
    });
    if (action === 'login') {
      vi.mocked(authApi.login).mockResolvedValueOnce(next);
      await useAuthStore.getState().login(next.person.email, crypto.randomUUID());
    } else {
      vi.mocked(authApi.register).mockResolvedValueOnce(next);
      await useAuthStore.getState().register({ name: 'Next', email: next.person.email, taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' });
    }
    unsubscribe();
    expect(synchronized).toBe(true);
  });

  it.each(['success', 'failure'] as const)('ignores stale refresh %s after account switch', async outcome => {
    await login('previous');
    const pending = deferred<Awaited<ReturnType<typeof authApi.refreshToken>>>();
    vi.mocked(authApi.refreshToken).mockReturnValueOnce(pending.promise);
    const refresh = useAuthStore.getState().refreshAccessToken().catch(() => undefined);
    const next = await login('next');
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'next' });
    if (outcome === 'success') pending.resolve({ tokens: responseFor('previous').tokens });
    else pending.reject(new Error('STALE_FAILURE'));
    await refresh;
    expect(useAuthStore.getState().user?.id).toBe('next');
    expect(useAuthStore.getState().accessToken === next.tokens.accessToken).toBe(true);
    expect(localStorage.getItem('accessToken') === next.tokens.accessToken).toBe(true);
    expect(queryClient.getQueryData(['admin', 'reviews'])).toEqual({ owner: 'next' });
  });

  it.each(['success', 'failure'] as const)('ignores stale refresh %s after logout', async outcome => {
    await login('previous');
    const pending = deferred<Awaited<ReturnType<typeof authApi.refreshToken>>>();
    vi.mocked(authApi.refreshToken).mockReturnValueOnce(pending.promise);
    const refresh = useAuthStore.getState().refreshAccessToken().catch(() => undefined);
    useAuthStore.getState().logout();
    if (outcome === 'success') pending.resolve({ tokens: responseFor('previous').tokens });
    else pending.reject(new Error('STALE_FAILURE'));
    await refresh;
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken === null).toBe(true);
    expect(localStorage.getItem('accessToken') === null).toBe(true);
  });

  it.each(['login', 'register'] as const)('ignores pending %s after logout', async action => {
    const pending = deferred<Awaited<ReturnType<typeof authApi.login>>>();
    const next = responseFor('next');
    let attempt: Promise<unknown>;
    if (action === 'login') {
      vi.mocked(authApi.login).mockReturnValueOnce(pending.promise);
      attempt = useAuthStore.getState().login(next.person.email, crypto.randomUUID());
    } else {
      vi.mocked(authApi.register).mockReturnValueOnce(pending.promise);
      attempt = useAuthStore.getState().register({ name: 'Next', email: next.person.email, taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' });
    }
    useAuthStore.getState().logout();
    pending.resolve(next);
    await attempt.catch(() => undefined);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(localStorage.getItem('accessToken') === null).toBe(true);
  });

  it.each(['login', 'register'] as const)('preserves an existing session after failed %s', async action => {
    const previous = await login('previous');
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'previous' });
    const failure = new Error('INVALID_CREDENTIALS');
    if (action === 'login') {
      vi.mocked(authApi.login).mockRejectedValueOnce(failure);
      await expect(useAuthStore.getState().login('next@example.test', crypto.randomUUID())).rejects.toThrow('INVALID_CREDENTIALS');
    } else {
      vi.mocked(authApi.register).mockRejectedValueOnce(failure);
      await expect(useAuthStore.getState().register({ name: 'Next', email: 'next@example.test', taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' })).rejects.toThrow('INVALID_CREDENTIALS');
    }
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.id).toBe('previous');
    expect(state.accessToken === previous.tokens.accessToken).toBe(true);
    expect(localStorage.getItem('accessToken') === previous.tokens.accessToken).toBe(true);
    expect(state.error).toBe('INVALID_CREDENTIALS');
    expect(queryClient.getQueryData(['admin', 'reviews'])).toEqual({ owner: 'previous' });
  });

  it.each(['success', 'failure'] as const)('ignores an older login %s after a newer login', async outcome => {
    const pending = deferred<Awaited<ReturnType<typeof authApi.login>>>();
    vi.mocked(authApi.login).mockReturnValueOnce(pending.promise);
    const oldAttempt = useAuthStore.getState().login('previous@example.test', crypto.randomUUID()).catch(() => undefined);
    const next = await login('next');
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'next' });
    if (outcome === 'success') pending.resolve(responseFor('previous'));
    else pending.reject(new Error('STALE_FAILURE'));
    await oldAttempt;
    expect(useAuthStore.getState().user?.id).toBe('next');
    expect(useAuthStore.getState().accessToken === next.tokens.accessToken).toBe(true);
    expect(useAuthStore.getState().error).toBeNull();
    expect(queryClient.getQueryData(['admin', 'reviews'])).toEqual({ owner: 'next' });
  });

  it('prevents an older concurrent refresh from overwriting a newer refresh', async () => {
    await login('previous');
    const pending = deferred<Awaited<ReturnType<typeof authApi.refreshToken>>>();
    vi.mocked(authApi.refreshToken).mockReturnValueOnce(pending.promise);
    const oldRefresh = useAuthStore.getState().refreshAccessToken().catch(() => undefined);
    const next = responseFor('previous');
    vi.mocked(authApi.refreshToken).mockResolvedValueOnce({ tokens: next.tokens });
    await useAuthStore.getState().refreshAccessToken();
    pending.resolve({ tokens: responseFor('previous').tokens });
    await oldRefresh;
    expect(useAuthStore.getState().accessToken === next.tokens.accessToken).toBe(true);
    expect(localStorage.getItem('accessToken') === next.tokens.accessToken).toBe(true);
  });

  it.each(['login', 'register'] as const)('ignores refresh started during %s after the new session is published', async action => {
    await login('previous');
    const pendingAuth = deferred<Awaited<ReturnType<typeof authApi.login>>>();
    const pendingRefresh = deferred<Awaited<ReturnType<typeof authApi.refreshToken>>>();
    const next = responseFor('next');
    let attempt: Promise<unknown>;
    if (action === 'login') {
      vi.mocked(authApi.login).mockReturnValueOnce(pendingAuth.promise);
      attempt = useAuthStore.getState().login(next.person.email, crypto.randomUUID());
    } else {
      vi.mocked(authApi.register).mockReturnValueOnce(pendingAuth.promise);
      attempt = useAuthStore.getState().register({ name: 'Next', email: next.person.email, taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' });
    }
    vi.mocked(authApi.refreshToken).mockReturnValueOnce(pendingRefresh.promise);
    const refresh = useAuthStore.getState().refreshAccessToken().catch(() => undefined);
    pendingAuth.resolve(next);
    await attempt;
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'next' });
    pendingRefresh.resolve({ tokens: responseFor('previous').tokens });
    await refresh;
    expect(useAuthStore.getState().user?.id).toBe('next');
    expect(useAuthStore.getState().accessToken === next.tokens.accessToken).toBe(true);
    expect(localStorage.getItem('accessToken') === next.tokens.accessToken).toBe(true);
    expect(queryClient.getQueryData(['admin', 'reviews'])).toEqual({ owner: 'next' });
  });

  it.each(['login', 'register'] as const)('ignores failed refresh started during %s after publication', async action => {
    await login('previous');
    const pendingAuth = deferred<Awaited<ReturnType<typeof authApi.login>>>();
    const pendingRefresh = deferred<Awaited<ReturnType<typeof authApi.refreshToken>>>();
    const next = responseFor('next');
    let attempt: Promise<unknown>;
    if (action === 'login') {
      vi.mocked(authApi.login).mockReturnValueOnce(pendingAuth.promise);
      attempt = useAuthStore.getState().login(next.person.email, crypto.randomUUID());
    } else {
      vi.mocked(authApi.register).mockReturnValueOnce(pendingAuth.promise);
      attempt = useAuthStore.getState().register({ name: 'Next', email: next.person.email, taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' });
    }
    vi.mocked(authApi.refreshToken).mockReturnValueOnce(pendingRefresh.promise);
    const refresh = useAuthStore.getState().refreshAccessToken().catch(() => undefined);
    pendingAuth.resolve(next);
    await attempt;
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'next' });
    pendingRefresh.reject(new Error('STALE_FAILURE'));
    await refresh;
    expect(useAuthStore.getState().user?.id).toBe('next');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(queryClient.getQueryData(['admin', 'reviews'])).toEqual({ owner: 'next' });
  });

  it('invalidates local session and cache on another tab changing auth storage', async () => {
    await login('previous');
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'previous' });
    localStorage.setItem('auth-storage', JSON.stringify({ state: { user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false, error: null }, version: 0 }));
    // StorageEvent doesn't fire in same tab; manually trigger persist rehydration
    useAuthStore.persist.rehydrate();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(queryClient.getQueryData(['admin', 'reviews'])).toBeUndefined();
  });

  it('fails closed when persisting a new session fails partway through', async () => {
    await login('previous');
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'previous' });
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'refreshToken') throw new Error('STORAGE_FAILURE');
      return original.call(this, key, value);
    });
    vi.mocked(authApi.login).mockResolvedValueOnce(responseFor('next'));
    await useAuthStore.getState().login('next@example.test', crypto.randomUUID()).catch(() => undefined);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(queryClient.getQueryData(['admin', 'reviews'])).toBeUndefined();
  });

  it('fails closed if persisting the loading state throws before the request', async () => {
    await login('previous');
    queryClient.setQueryData(['admin', 'reviews'], { owner: 'previous' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('STORAGE_FAILURE'); });
    await useAuthStore.getState().login('next@example.test', crypto.randomUUID()).catch(() => undefined);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(queryClient.getQueryData(['admin', 'reviews'])).toBeUndefined();
  });

  it.each(['login', 'register'] as const)('old refresh failure does not abort pending %s', async action => {
    await login('previous');
    const pending = deferred<Awaited<ReturnType<typeof authApi.login>>>();
    const next = responseFor('next');
    let attempt: Promise<unknown>;
    if (action === 'login') {
      vi.mocked(authApi.login).mockReturnValueOnce(pending.promise);
      attempt = useAuthStore.getState().login(next.person.email, crypto.randomUUID());
    } else {
      vi.mocked(authApi.register).mockReturnValueOnce(pending.promise);
      attempt = useAuthStore.getState().register({ name: 'Next', email: next.person.email, taxIdType: 'CPF', taxIdValue: '00000000000', password: crypto.randomUUID(), role: 'CONSUMER' });
    }
    vi.mocked(authApi.refreshToken).mockRejectedValueOnce(new Error('REFRESH_FAILURE'));
    await useAuthStore.getState().refreshAccessToken().catch(() => undefined);
    pending.resolve(next);
    await attempt.catch(() => undefined);
    expect(useAuthStore.getState().user?.id).toBe('next');
  });
});
