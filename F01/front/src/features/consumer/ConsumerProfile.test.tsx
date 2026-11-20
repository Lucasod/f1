import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/app/providers/authStore';
import { authApi } from '@/shared/api/auth';
import { Person, personApi } from '@/shared/api/person';
import { ConsumerProfile } from './ConsumerProfile';

vi.mock('@/shared/api/person', () => ({
  personApi: {
    getMe: vi.fn(),
    updateName: vi.fn(),
    updateContacts: vi.fn(),
    updateAddresses: vi.fn(),
    addAddress: vi.fn(),
    removeAddress: vi.fn(),
    addContact: vi.fn(),
    removeContact: vi.fn(),
  },
}));

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    changePassword: vi.fn(),
  },
}));

const profile: Person = {
  id: 'consumer-1',
  name: 'Consumer Example',
  mainInfo: {
    name: 'Consumer Example',
    taxIdType: 'CPF',
    taxIdValue: '*******4725',
  },
  contactInfos: [{
    id: 'contact-1',
    type: 'email',
    value: 'consumer@example.com',
    isPrimary: true,
  }],
  addresses: [{
    id: 'address-1',
    street: 'Main Street',
    number: '12',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    isPrimary: true,
  }],
  roles: ['CONSUMER'],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

function renderProfile(options?: { queryClient?: QueryClient }) {
  const queryClient = options?.queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConsumerProfile />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const CURRENT_PASSWORD_FIXTURE = 'current-password';
const NEW_PASSWORD_FIXTURE = 'new-password-123';
const DIFFERENT_PASSWORD_FIXTURE = 'different-password';
describe('ConsumerProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'consumer-1', name: 'Consumer Example', email: 'consumer@example.com', roles: ['CONSUMER'] },
      accessToken: 'access',
      refreshToken: 'refresh',
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    vi.mocked(personApi.getMe).mockResolvedValue({ person: profile });
    vi.mocked(personApi.updateName).mockResolvedValue({ person: { ...profile, name: 'Updated Consumer' } });
    vi.mocked(personApi.addAddress).mockResolvedValue({ person: profile });
    vi.mocked(personApi.addContact).mockResolvedValue({ person: profile });
    vi.mocked(authApi.changePassword).mockResolvedValue({ message: 'PASSWORD_CHANGED' });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false, error: null });
  });

  it('displays the authenticated profile, masked tax ID, contacts, and delivery addresses', async () => {
    renderProfile();

    expect(await screen.findByText('Consumer Example')).toBeInTheDocument();
    expect(screen.getByDisplayValue('*******4725')).toBeInTheDocument();
    expect(screen.getByText('consumer@example.com')).toBeInTheDocument();
    expect(screen.getByText('Main Street, 12')).toBeInTheDocument();
    expect(personApi.getMe).toHaveBeenCalledOnce();
  });

  it('updates the displayed name through the authenticated profile API', async () => {
    renderProfile();
    await screen.findByText('Consumer Example');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('Consumer Example'), {
      target: { value: 'Updated Consumer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(personApi.updateName).toHaveBeenCalledWith('Updated Consumer');
    });
  });

  it('validates password confirmation and changes the password through the existing auth API', async () => {
    renderProfile();
    await screen.findByText('Consumer Example');

    let changePasswordButtons = screen.getAllByRole('button', { name: 'Change Password' });

    // Open the change password modal (first button is outside the modal)
    fireEvent.click(changePasswordButtons[0]);

    // Fill in the password fields inside the modal
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: CURRENT_PASSWORD_FIXTURE } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: NEW_PASSWORD_FIXTURE } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: DIFFERENT_PASSWORD_FIXTURE } });

    // Click Change Password inside the modal - should show validation error
    // (second button is inside the modal portal)
    changePasswordButtons = screen.getAllByRole('button', { name: 'Change Password' });
    await waitFor(() => expect(changePasswordButtons[1]).toBeInTheDocument());
    fireEvent.click(changePasswordButtons[1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('New passwords do not match');
    expect(authApi.changePassword).not.toHaveBeenCalled();

    // Change confirm password to match
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: NEW_PASSWORD_FIXTURE } });

// Click Change Password inside the modal - should succeed
    await waitFor(() => expect(changePasswordButtons[1]).toBeInTheDocument());
    fireEvent.click(changePasswordButtons[1]);

    expect(await screen.findByRole('status')).toHaveTextContent('Password changed successfully.');
    expect(vi.mocked(authApi.changePassword).mock.calls[0]?.[0]).toEqual({
      currentPassword: CURRENT_PASSWORD_FIXTURE,
      newPassword: NEW_PASSWORD_FIXTURE,
    });
  });

  it('adds a delivery address through the authenticated profile API', async () => {
    renderProfile();
    await screen.findByText('Consumer Example');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Address' })[0]);

    fireEvent.change(screen.getByLabelText('Street'), { target: { value: 'New Street' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Centro' } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Curitiba' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'PR' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Address' })[1]);

    await waitFor(() => {
      expect(personApi.addAddress).toHaveBeenCalledWith({
        street: 'New Street',
        number: '99',
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'PR',
        isPrimary: false,
      });
    });
  });

  it('adds validated contact information through the authenticated profile API', async () => {
    renderProfile();
    await screen.findByText('Consumer Example');
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }));
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: 'new-contact@example.com' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Contact' })[1]);

    await waitFor(() => {
      expect(personApi.addContact).toHaveBeenCalledWith({
        type: 'email',
        value: 'new-contact@example.com',
        isPrimary: false,
      });
    });
  });

  it('AC1: uses identity-scoped person query key and not the old identity-free key', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    renderProfile({ queryClient });

    await screen.findByText('Consumer Example');

    expect(queryClient.getQueryData(['person', 'me', 'consumer-1'])).toEqual({ person: profile });
    expect(queryClient.getQueryData(['person', 'me'])).toBeUndefined();
  });

  it('L-001: isolates person cache when authenticated identity switches', async () => {
    const personA = { ...profile, id: 'person-a', name: 'Person A' };
    const personB = { ...profile, id: 'person-b', name: 'Person B' };
    let resolvePersonB: ((response: { person: Person }) => void) | undefined;
    const pendingPersonB = new Promise<{ person: Person }>((resolve) => {
      resolvePersonB = resolve;
    });
    vi.mocked(personApi.getMe)
      .mockResolvedValueOnce({ person: personA })
      .mockReturnValueOnce(pendingPersonB);

    useAuthStore.setState({
      user: { id: 'person-a', name: 'Person A', email: 'a@example.com', roles: ['CONSUMER'] },
      accessToken: 'access',
      refreshToken: 'refresh',
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    renderProfile({ queryClient });

    await screen.findByText('Person A');
    expect(queryClient.getQueryData(['person', 'me', 'person-a'])).toEqual({ person: personA });

    act(() => {
      useAuthStore.setState((state) => ({
        ...state,
        user: { id: 'person-b', name: 'Person B', email: 'b@example.com', roles: ['CONSUMER'] },
      }));
    });

    await waitFor(() => expect(personApi.getMe).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryData(['person', 'me', 'person-a'])).toEqual({ person: personA });

    await act(async () => {
      resolvePersonB?.({ person: personB });
      await pendingPersonB;
    });

    await screen.findByText('Person B');
    expect(queryClient.getQueryData(['person', 'me', 'person-b'])).toEqual({ person: personB });
  });
});
