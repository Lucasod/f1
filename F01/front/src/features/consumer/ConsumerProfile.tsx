import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { personApi, Person, ContactInfo, Address, PersonApiException } from '@/shared/api/person';
import { useAuthStore } from '@/app/providers/authStore';
import { authApi } from '@/shared/api/auth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

/**
 * Get contact type label
 */
function getContactTypeLabel(type: ContactInfo['type']): string {
  const labels: Record<ContactInfo['type'], string> = {
    email: 'E-mail',
    phone: 'Phone',
    whatsapp: 'WhatsApp',
  };
  return labels[type] || type;
}

/**
 * Get contact type icon
 */
function getContactTypeIcon(type: ContactInfo['type']): React.ReactNode {
  switch (type) {
    case 'email':
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case 'phone':
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.472.099-.174.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.085 2.875 1.253 3.074.149.172 2.096 3.213 5.077 4.488.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.402h-.004a9.87 9.87 0 01-5.031-1.378 9.86 9.86 0 01-1.379-5.031c0-.003 0-.005 0-.008h.003C7.33 7.581 10.77 4.158 15.037.89a9.878 9.878 0 013.53.273c1.877.347 3.424 1.547 4.454 3.327 1.03 1.779 1.494 3.64 1.494 3.847 0 .198-.099.413-.298.571-.198.149-.52.224-.867.324-.472.099-1.076.173-1.549.173-.473 0-.944-.026-1.393-.174" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Get role badge variant
 */
function getRoleVariant(role: string): 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const roleVariants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
    consumer: 'default',
    vendor: 'success',
    admin: 'error',
    support: 'info',
  };
  return roleVariants[role] || 'neutral';
}

interface AddressFormData {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary: boolean;
}

interface ContactFormData {
  type: 'email' | 'phone' | 'whatsapp';
  value: string;
  isPrimary: boolean;
}

const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export function ConsumerProfile() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const personQueryKey = ['person', 'me', user?.id ?? 'anonymous'] as const;

  // Fetch person profile
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<{ person: Person }, Error>({
    queryKey: personQueryKey,
    queryFn: () => personApi.getMe(),
    staleTime: 5 * 60 * 1000,
  });

  const person = data?.person;

  // Mutations
  const updateNameMutation = useMutation({
    mutationFn: (name: string) => personApi.updateName(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personQueryKey });
    },
  });

  const updateContactsMutation = useMutation({
    mutationFn: (contacts: ContactInfo[]) => personApi.updateContacts(contacts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personQueryKey });
    },
  });

  const addAddressMutation = useMutation({
    mutationFn: (address: Omit<Address, 'id'>) => personApi.addAddress(address),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personQueryKey });
      setShowAddAddressForm(false);
      setNewAddressForm({
        street: '',
        number: '',
        neighborhood: '',
        city: '',
        state: '',
        isPrimary: false,
      });
    },
  });

  const addContactMutation = useMutation({
    mutationFn: (contact: Omit<ContactInfo, 'id'>) => personApi.addContact(contact),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personQueryKey });
      setShowAddContactForm(false);
      setNewContactForm({ type: 'email', value: '', isPrimary: false });
    },
  });

  const removeContactMutation = useMutation({
    mutationFn: (contactId: string) => personApi.removeContact(contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personQueryKey });
    },
  });

  // Local state for editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState('');

  const [showAddAddressForm, setShowAddAddressForm] = useState(false);
  const [newAddressForm, setNewAddressForm] = useState<AddressFormData>({
    street: '',
    number: '',
    neighborhood: '',
    city: '',
    state: '',
    isPrimary: false,
  });
  const [addressErrors, setAddressErrors] = useState<Partial<AddressFormData>>({});

  const [showAddContactForm, setShowAddContactForm] = useState(false);
  const [newContactForm, setNewContactForm] = useState<ContactFormData>({
    type: 'email',
    value: '',
    isPrimary: false,
  });
  const [contactErrors, setContactErrors] = useState<Partial<ContactFormData>>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
      setPasswordSuccess(true);
    },
    onError: () => setPasswordSuccess(false),
  });

  // Handlers
  const handleNameEditStart = useCallback(() => {
    if (person) {
      setEditName(person.name);
      setIsEditingName(true);
      setNameError('');
    }
  }, [person]);

  const handleNameSave = useCallback(async () => {
    if (!editName.trim()) {
      setNameError('Name is required');
      return;
    }
    if (editName.length < 2) {
      setNameError('Name must be at least 2 characters');
      return;
    }
    setNameError('');
    await updateNameMutation.mutateAsync(editName);
    setIsEditingName(false);
  }, [editName, updateNameMutation]);

  const handleNameCancel = useCallback(() => {
    setEditName(person?.name || '');
    setIsEditingName(false);
    setNameError('');
  }, [person]);

  const handleChangePassword = useCallback(() => {
    setPasswordSuccess(false);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    setPasswordError('');
    changePasswordMutation.mutate({ currentPassword, newPassword });
  }, [currentPassword, newPassword, confirmPassword, changePasswordMutation]);

  const validateAddressForm = useCallback((): boolean => {
    const errors: Partial<AddressFormData> = {};
    if (!newAddressForm.street.trim()) errors.street = 'Street is required';
    if (!newAddressForm.number.trim()) errors.number = 'Number is required';
    if (!newAddressForm.neighborhood.trim()) errors.neighborhood = 'Neighborhood is required';
    if (!newAddressForm.city.trim()) errors.city = 'City is required';
    if (!newAddressForm.state.trim()) errors.state = 'State is required';
    setAddressErrors(errors);
    return Object.keys(errors).length === 0;
  }, [newAddressForm]);

  const handleAddAddress = useCallback(async () => {
    if (!validateAddressForm()) return;
    await addAddressMutation.mutateAsync(newAddressForm);
  }, [newAddressForm, validateAddressForm, addAddressMutation]);

  const validateContactForm = useCallback((): boolean => {
    const errors: Partial<ContactFormData> = {};
    if (!newContactForm.value.trim()) errors.value = 'Value is required';
    if (newContactForm.type === 'email' && newContactForm.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newContactForm.value)) {
      errors.value = 'Invalid email format';
    }
    if (newContactForm.type === 'phone' && newContactForm.value.trim() && !/^\+?[\d\s\-()]{10,}$/.test(newContactForm.value)) {
      errors.value = 'Invalid phone format';
    }
    setContactErrors(errors);
    return Object.keys(errors).length === 0;
  }, [newContactForm]);

  const handleAddContact = useCallback(async () => {
    if (!validateContactForm()) return;
    await addContactMutation.mutateAsync(newContactForm);
  }, [newContactForm, validateContactForm, addContactMutation]);

  const handleRemoveContact = useCallback(async (contactId: string) => {
    if (!window.confirm('Are you sure you want to remove this contact?')) return;
    await removeContactMutation.mutateAsync(contactId);
  }, [removeContactMutation]);

  // Handle primary contact/address changes
  const handlePrimaryContactChange = useCallback(async (contactId: string) => {
    if (!person) return;
    const updatedContacts = person.contactInfos.map((contact) => ({
      ...contact,
      isPrimary: contact.id === contactId,
    }));
    await updateContactsMutation.mutateAsync(updatedContacts);
  }, [person, updateContactsMutation]);

  // Loading state
  if (isLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <div className="flex items-center justify-center min-h-[400px]" role="status" aria-live="polite">
          <Spinner size="lg" label="Loading profile..." />
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    let errorMessage = 'Error loading profile';
    if (error instanceof PersonApiException) {
      if (error.status === 401) {
        navigate('/login');
        return null;
      }
      if (error.status === 403) {
        navigate('/access-denied');
        return null;
      }
      if (error.status === 404) {
        errorMessage = 'Profile not found';
      } else {
        errorMessage = error.message || 'Error loading profile';
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <ErrorAlert
          title="Error Loading Profile"
          message={errorMessage}
          action={{ label: 'Try Again', onClick: () => refetch() }}
        />
      </main>
    );
  }

  // No person data
  if (!person) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <EmptyState
          title="Profile not found"
          description="Unable to load your profile information."
          icon={EmptyStateIcons.profile}
          action={{ label: 'Try Again', onClick: () => refetch() }}
        />
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-500 mt-1 text-xl font-medium">Manage your personal information</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/dashboard">
            <Button variant="outline" leftIcon={<span aria-hidden="true">←</span>}>
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        {/* Profile Info Card */}
        <Card variant="bordered" padding="lg">
          <CardHeader>
            <CardTitle as="h2">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              {isEditingName ? (
                <div className="flex gap-3">
                  <Input
                    id="edit-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleNameSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleNameSave();
                      if (e.key === 'Escape') handleNameCancel();
                    }}
                    autoFocus
                    error={nameError}
                    required
                  />
                  <div className="flex gap-2 items-end">
                    <Button size="sm" onClick={handleNameSave} variant="primary" disabled={updateNameMutation.isPending}>
                      Save
                    </Button>
                    <Button size="sm" onClick={handleNameCancel} variant="ghost" disabled={updateNameMutation.isPending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <p className="text-lg font-medium text-gray-900">{person.name}</p>
                  <Button variant="ghost" size="sm" onClick={handleNameEditStart}>
                    Edit
                  </Button>
                </div>
              )}
            </div>

            {/* Tax ID (CPF/CNPJ) - Read Only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID (CPF/CNPJ)</label>
              <div className="flex items-center gap-3">
                <Input
                  id="tax-id"
                  value={person.mainInfo.taxIdValue}
                  readOnly
                  className="bg-gray-50 cursor-not-allowed"
                  aria-describedby="tax-id-hint"
                />
                <span id="tax-id-hint" className="text-xs text-gray-500">
                  This value cannot be changed
                </span>
              </div>
            </div>

            {/* Roles */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Roles</label>
              <div className="flex flex-wrap gap-2">
                {person.roles.length > 0 ? (
                  person.roles.map((role, index) => (
                    <Badge
                      key={index}
                      variant={getRoleVariant(role)}
                      size="md"
                      dot
                    >
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="neutral" size="md">
                    No roles assigned
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Addresses Card */}
        <Card variant="bordered" padding="lg">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle as="h2">Addresses</CardTitle>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAddAddressForm(true)}
              leftIcon={<span aria-hidden="true">+</span>}
            >
              Add Address
            </Button>
          </CardHeader>
          <CardContent>
            {showAddAddressForm && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
                <h4 className="font-medium text-gray-900">Add New Address</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Input
                    id="address-street"
                    label="Street"
                    required
                    value={newAddressForm.street}
                    onChange={(e) => setNewAddressForm({ ...newAddressForm, street: e.target.value })}
                    error={addressErrors.street}
                    placeholder="Rua das Flores"
                  />
                  <Input
                    id="address-number"
                    label="Number"
                    required
                    value={newAddressForm.number}
                    onChange={(e) => setNewAddressForm({ ...newAddressForm, number: e.target.value })}
                    error={addressErrors.number}
                    placeholder="123"
                  />
                  <Input
                    id="address-neighborhood"
                    label="Neighborhood"
                    required
                    value={newAddressForm.neighborhood}
                    onChange={(e) => setNewAddressForm({ ...newAddressForm, neighborhood: e.target.value })}
                    error={addressErrors.neighborhood}
                    placeholder="Centro"
                  />
                  <Input
                    id="address-city"
                    label="City"
                    required
                    value={newAddressForm.city}
                    onChange={(e) => setNewAddressForm({ ...newAddressForm, city: e.target.value })}
                    error={addressErrors.city}
                    placeholder="City"
                  />
                  <Select
                    id="address-state"
                    label="State"
                    required
                    options={BRAZILIAN_STATES.map((s) => ({ value: s, label: s }))}
                    placeholder="Select state"
                    value={newAddressForm.state}
                    onChange={(e) => setNewAddressForm({ ...newAddressForm, state: e.target.value })}
                    error={addressErrors.state}
                  />
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer w-full">
                      <input
                        type="checkbox"
                        checked={newAddressForm.isPrimary}
                        onChange={(e) => setNewAddressForm({ ...newAddressForm, isPrimary: e.target.checked })}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Set as primary</span>
                    </label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAddAddressForm(false)} disabled={addAddressMutation.isPending}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleAddAddress} disabled={addAddressMutation.isPending} isLoading={addAddressMutation.isPending} loadingText="Adding...">
                    Add Address
                  </Button>
                </div>
              </div>
            )}

            {person.addresses.length === 0 && !showAddAddressForm ? (
              <EmptyState
                title="No addresses yet"
                description="Add your delivery addresses for faster checkout."
                icon={EmptyStateIcons.profile}
                action={{ label: 'Add Address', onClick: () => setShowAddAddressForm(true) }}
              />
            ) : (
              <div className="space-y-3">
                {person.addresses.map((address) => (
                  <div key={address.id} className="flex flex-col sm:flex-row sm:items-start gap-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-gray-900">{address.street}, {address.number}</p>
                      {address.isPrimary && (
                        <Badge variant="success" size="sm" dot>
                          Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{address.neighborhood}</p>
                    <p className="text-sm text-gray-600">{address.city} - {address.state}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          variant="primary"
          onClick={() => setShowChangePasswordModal(true)}
          className="mb-4"
        >
          Change Password
        </Button>

        <Modal
          isOpen={showChangePasswordModal}
          onClose={() => {
            setShowChangePasswordModal(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setPasswordError('');
            setPasswordSuccess(false);
          }}
          title="Change Password"
          description="Update your account password"
          size="sm"
          closeOnEscape
          closeOnOverlayClick
        >
          <Card variant="bordered" padding="lg">
            <CardHeader>
              <CardTitle as="h2">Change Password</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {changePasswordMutation.isError && (
                <ErrorAlert
                  title="Unable to change password"
                  message={changePasswordMutation.error instanceof Error
                    ? changePasswordMutation.error.message
                    : 'Please verify your current password and try again.'}
                />
              )}
              {passwordSuccess && <p role="status" className="text-sm text-green-700">Password changed successfully.</p>}
              <Input
                id="current-password"
                label="Current password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <Input
                id="new-password"
                label="New password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              <Input
                id="confirm-password"
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              {passwordError && <p role="alert" className="text-sm text-red-600">{passwordError}</p>}
              <Button
                variant="primary"
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending}
                isLoading={changePasswordMutation.isPending}
                loadingText="Changing..."
              >
                Change Password
              </Button>
            </CardContent>
          </Card>
        </Modal>

        {/* Contacts Card */}
        <Card variant="bordered" padding="lg">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle as="h2">Contact Information</CardTitle>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAddContactForm(true)}
              leftIcon={<span aria-hidden="true">+</span>}
            >
              Add Contact
            </Button>
          </CardHeader>
          <CardContent>
            {showAddContactForm && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg space-y-4">
                <h4 className="font-medium text-gray-900">Add New Contact</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Select
                    id="contact-type"
                    label="Type"
                    required
                    options={[
                      { value: 'email', label: 'E-mail' },
                      { value: 'phone', label: 'Phone' },
                      { value: 'whatsapp', label: 'WhatsApp' },
                    ]}
                    value={newContactForm.type}
                    onChange={(e) => setNewContactForm({ ...newContactForm, type: e.target.value as ContactFormData['type'] })}
                    error={contactErrors.type}
                  />
                  <Input
                    id="contact-value"
                    label="Value"
                    type={newContactForm.type === 'email' ? 'email' : 'tel'}
                    placeholder={newContactForm.type === 'email' ? 'example@domain.com' : newContactForm.type === 'phone' ? '+55 11 99999-9999' : '+55 11 99999-9999'}
                    value={newContactForm.value}
                    onChange={(e) => setNewContactForm({ ...newContactForm, value: e.target.value })}
                    error={contactErrors.value}
                    required
                  />
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newContactForm.isPrimary}
                        onChange={(e) => setNewContactForm({ ...newContactForm, isPrimary: e.target.checked })}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Set as primary</span>
                    </label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAddContactForm(false)} disabled={addContactMutation.isPending}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleAddContact} disabled={addContactMutation.isPending} isLoading={addContactMutation.isPending} loadingText="Adding...">
                    Add Contact
                  </Button>
                </div>
              </div>
            )}

            {person.contactInfos.length === 0 && !showAddContactForm ? (
              <EmptyState
                title="No contacts yet"
                description="Add your email, phone, or WhatsApp to stay connected."
                icon={
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                }
                action={{ label: 'Add Contact', onClick: () => setShowAddContactForm(true) }}
              />
            ) : (
              <div className="space-y-3">
                {person.contactInfos.map((contact) => (
                  <div key={contact.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="p-2 bg-white rounded-lg border border-gray-200 text-gray-600" aria-hidden="true">
                        {getContactTypeIcon(contact.type)}
                      </span>
                      <div>
                        <p className="font-medium text-gray-900">{getContactTypeLabel(contact.type)}</p>
                        <p className="text-sm text-gray-600">{contact.value}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-1 sm:flex-none">
                      {contact.isPrimary && (
                        <Badge variant="success" size="sm" dot>
                          Primary
                        </Badge>
                      )}
                      {!contact.isPrimary && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePrimaryContactChange(contact.id)}
                          disabled={updateContactsMutation.isPending}
                        >
                          Set Primary
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveContact(contact.id)}
                        className="text-red-600 hover:text-red-900 hover:bg-red-50"
                        disabled={removeContactMutation.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>


      </div>
    </main>
  );
}