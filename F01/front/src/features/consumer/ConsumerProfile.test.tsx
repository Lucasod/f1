import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConsumerProfile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ConsumerProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(personApi.getMe).mockResolvedValue({ person: profile });
    vi.mocked(personApi.updateName).mockResolvedValue({ person: { ...profile, name: 'Updated Consumer' } });
    vi.mocked(personApi.addAddress).mockResolvedValue({ person: profile });
    vi.mocked(personApi.addContact).mockResolvedValue({ person: profile });
    vi.mocked(authApi.changePassword).mockResolvedValue({ message: 'PASSWORD_CHANGED' });
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

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('New passwords do not match');
    expect(authApi.changePassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password changed successfully.');
    expect(vi.mocked(authApi.changePassword).mock.calls[0]?.[0]).toEqual({
      currentPassword: 'current-password',
      newPassword: 'new-password-123',
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
});
