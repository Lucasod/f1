import { apiClient } from './client';

export interface ContactInfo {
  id: string;
  type: 'email' | 'phone' | 'whatsapp';
  value: string;
  isPrimary: boolean;
}

export interface Address {
  id: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary: boolean;
}

export interface MainInfo {
  name: string;
  taxIdType: 'CPF' | 'CNPJ';
  taxIdValue: string;
}

export interface Person {
  id: string;
  name: string;
  mainInfo: MainInfo;
  contactInfos: ContactInfo[];
  addresses: Address[];
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNameInput {
  name: string;
}

export interface UpdateContactsInput {
  contacts: ContactInfo[];
}

export interface UpdateAddressesInput {
  addresses: Address[];
}

export interface AddAddressInput {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary: boolean;
}

export interface UpdateAddressInput {
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  isPrimary?: boolean;
}

export interface AddContactInput {
  type: 'email' | 'phone' | 'whatsapp';
  value: string;
  isPrimary: boolean;
}

export interface UpdateContactInput {
  type?: 'email' | 'phone' | 'whatsapp';
  value?: string;
  isPrimary?: boolean;
}

/**
 * Custom error class for person API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class PersonApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PersonApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new PersonApiException(
      errorData.message || `API error: ${response.status}`,
      response.status,
      errorData.error
    );
  }
  return response.json();
}

export const personApi = {
  /**
   * Get the current authenticated user's person profile
   */
  async getMe(): Promise<{ person: Person }> {
    const response = await apiClient.get('/api/v1/person/me');
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Update the person's name
   */
  async updateName(name: string): Promise<{ person: Person }> {
    const response = await apiClient.patch('/api/v1/person/me', { name });
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Update the person's contact information
   */
  async updateContacts(contacts: ContactInfo[]): Promise<{ person: Person }> {
    const response = await apiClient.patch('/api/v1/person/me/contacts', { contacts });
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Update the person's addresses
   */
  async updateAddresses(addresses: Address[]): Promise<{ person: Person }> {
    const response = await apiClient.patch('/api/v1/person/me/addresses', { addresses });
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Add a new address for the person
   */
  async addAddress(address: Omit<Address, 'id'>): Promise<{ person: Person }> {
    const response = await apiClient.post('/api/v1/person/me/addresses', address);
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Remove an address by ID
   */
  async removeAddress(addressId: string): Promise<{ person: Person }> {
    const response = await apiClient.delete(`/api/v1/person/me/addresses/${addressId}`);
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Update an existing address by ID
   */
  async updateAddress(addressId: string, updates: Partial<Address>): Promise<{ person: Person }> {
    const response = await apiClient.patch(`/api/v1/person/me/addresses/${addressId}`, updates);
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Add a new contact for the person
   */
  async addContact(contact: Omit<ContactInfo, 'id'>): Promise<{ person: Person }> {
    const response = await apiClient.post('/api/v1/person/me/contacts', contact);
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Remove a contact by ID
   */
  async removeContact(contactId: string): Promise<{ person: Person }> {
    const response = await apiClient.delete(`/api/v1/person/me/contacts/${contactId}`);
    return handleResponse<{ person: Person }>(response);
  },

  /**
   * Update an existing contact by ID
   */
  async updateContact(contactId: string, updates: Partial<ContactInfo>): Promise<{ person: Person }> {
    const response = await apiClient.patch(`/api/v1/person/me/contacts/${contactId}`, updates);
    return handleResponse<{ person: Person }>(response);
  },
};