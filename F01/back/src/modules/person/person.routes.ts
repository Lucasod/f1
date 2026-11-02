import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { PersonService } from './person.service';
import { PersonRepository } from './person.domain';
import { authMiddleware, AuthenticatedRequest, requireAnyRole } from '../auth/auth.middleware';
import { PersonRole } from './person.domain';
import { PersonError } from './person.domain';

const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export interface PersonRoutesConfig {
  authService: AuthService;
  personService: PersonService;
  personRepo: PersonRepository;
}

export function createPersonRoutes({ authService, personService, personRepo }: PersonRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);
  const requireConsumerOrVendor = requireAnyRole([PersonRole.CONSUMER, PersonRole.VENDOR, PersonRole.ADMIN]);

  // GET /api/v1/person/me - get current user's person profile
  router.get('/me', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      return res.json({ person: personToResponse(person) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/person/me - update name
  router.patch('/me', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body;

      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: PersonError.NAME_REQUIRED, message: 'Name is required' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.updateName(personId, name);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.NAME_REQUIRED:
            return res.status(400).json({ error: PersonError.NAME_REQUIRED, message: 'Name is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/person/me/contacts - update all contacts
  router.patch('/me/contacts', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { contacts } = req.body;

      if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: PersonError.EMAIL_REQUIRED, message: 'At least one contact is required' });
      }

      // Validate at least one email
      const hasEmail = contacts.some((c: any) => c.type === 'email');
      if (!hasEmail) {
        return res.status(400).json({ error: PersonError.EMAIL_REQUIRED, message: 'At least one email contact is required' });
      }

      // Validate email formats
      for (const contact of contacts) {
        if (contact.type === 'email' && !validateEmail(contact.value)) {
          return res.status(400).json({ error: PersonError.INVALID_EMAIL_FORMAT, message: 'Invalid email format' });
        }
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.updateContactInfos(personId, contacts);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.EMAIL_REQUIRED:
            return res.status(400).json({ error: PersonError.EMAIL_REQUIRED, message: 'At least one email contact is required' });
          case PersonError.INVALID_EMAIL_FORMAT:
            return res.status(400).json({ error: PersonError.INVALID_EMAIL_FORMAT, message: 'Invalid email format' });
          case PersonError.EMAIL_ALREADY_EXISTS:
            return res.status(409).json({ error: PersonError.EMAIL_ALREADY_EXISTS, message: 'Email already belongs to another person' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /api/v1/person/me/contacts - add contact
  router.post('/me/contacts', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { type, value, isPrimary } = req.body;

      if (!type || !value) {
        return res.status(400).json({ error: 'CONTACT_FIELDS_REQUIRED', message: 'Type and value are required' });
      }

      if (!['email', 'phone', 'whatsapp'].includes(type)) {
        return res.status(400).json({ error: 'INVALID_CONTACT_TYPE', message: 'Invalid contact type' });
      }

      if (type === 'email' && !validateEmail(value)) {
        return res.status(400).json({ error: PersonError.INVALID_EMAIL_FORMAT, message: 'Invalid email format' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.addContact(personId, {
        type,
        value: value.trim(),
        isPrimary: !!isPrimary
      });

      return res.status(201).json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.INVALID_EMAIL_FORMAT:
            return res.status(400).json({ error: PersonError.INVALID_EMAIL_FORMAT, message: 'Invalid email format' });
          case PersonError.EMAIL_ALREADY_EXISTS:
            return res.status(409).json({ error: PersonError.EMAIL_ALREADY_EXISTS, message: 'Email already belongs to another person' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // DELETE /api/v1/person/me/contacts/:contactId - remove contact
  router.delete('/me/contacts/:contactId', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const contactId = Array.isArray(req.params.contactId) ? req.params.contactId[0] : req.params.contactId;

      if (!contactId || contactId.trim().length === 0) {
        return res.status(400).json({ error: 'CONTACT_ID_REQUIRED', message: 'Contact ID is required' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.removeContact(personId, contactId);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.CONTACT_NOT_FOUND:
            return res.status(404).json({ error: PersonError.CONTACT_NOT_FOUND, message: 'Contact not found' });
          case PersonError.EMAIL_REQUIRED:
            return res.status(400).json({ error: PersonError.EMAIL_REQUIRED, message: 'At least one email contact is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/person/me/contacts/:contactId - update contact
  router.patch('/me/contacts/:contactId', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const contactId = Array.isArray(req.params.contactId) ? req.params.contactId[0] : req.params.contactId;
      const updates = req.body;

      if (!contactId || contactId.trim().length === 0) {
        return res.status(400).json({ error: 'CONTACT_ID_REQUIRED', message: 'Contact ID is required' });
      }

      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'NO_UPDATES_PROVIDED', message: 'At least one field to update is required' });
      }

      // Don't allow changing the ID
      const { id, ...safeUpdates } = updates;

      // Validate email format if updating email
      if (safeUpdates.type === 'email' && safeUpdates.value && !validateEmail(safeUpdates.value)) {
        return res.status(400).json({ error: PersonError.INVALID_EMAIL_FORMAT, message: 'Invalid email format' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.updateContact(personId, contactId, safeUpdates);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.CONTACT_NOT_FOUND:
            return res.status(404).json({ error: PersonError.CONTACT_NOT_FOUND, message: 'Contact not found' });
          case PersonError.INVALID_EMAIL_FORMAT:
            return res.status(400).json({ error: PersonError.INVALID_EMAIL_FORMAT, message: 'Invalid email format' });
          case PersonError.EMAIL_REQUIRED:
            return res.status(400).json({ error: PersonError.EMAIL_REQUIRED, message: 'At least one email contact is required' });
          case PersonError.EMAIL_ALREADY_EXISTS:
            return res.status(409).json({ error: PersonError.EMAIL_ALREADY_EXISTS, message: 'Email already belongs to another person' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/person/me/addresses - update all addresses
  router.patch('/me/addresses', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { addresses } = req.body;

      if (!Array.isArray(addresses)) {
        return res.status(400).json({ error: 'INVALID_ADDRESSES', message: 'Addresses must be an array' });
      }

      // Validate Brazilian states if addresses have state
      for (const address of addresses) {
        if (address.state && !BRAZILIAN_STATES.includes(address.state.toUpperCase())) {
          return res.status(400).json({ error: 'INVALID_STATE', message: 'Invalid Brazilian state' });
        }
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.updateAddresses(personId, addresses);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // POST /api/v1/person/me/addresses - add address
  router.post('/me/addresses', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { street, number, neighborhood, city, state, isPrimary } = req.body;

      if (!street || !number || !neighborhood || !city || !state) {
        return res.status(400).json({ error: 'ADDRESS_FIELDS_REQUIRED', message: 'All address fields are required' });
      }

      // Validate Brazilian state
      if (!BRAZILIAN_STATES.includes(state.toUpperCase())) {
        return res.status(400).json({ error: 'INVALID_STATE', message: 'Invalid Brazilian state' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.addAddress(personId, {
        street: street.trim(),
        number: number.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim().toUpperCase(),
        isPrimary
      });

      return res.status(201).json({ person: personToResponse(updated) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // DELETE /api/v1/person/me/addresses/:addressId - remove address
  router.delete('/me/addresses/:addressId', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const addressId = Array.isArray(req.params.addressId) ? req.params.addressId[0] : req.params.addressId;

      if (!addressId || addressId.trim().length === 0) {
        return res.status(400).json({ error: 'ADDRESS_ID_REQUIRED', message: 'Address ID is required' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.removeAddress(personId, addressId);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.ADDRESS_NOT_FOUND:
            return res.status(404).json({ error: PersonError.ADDRESS_NOT_FOUND, message: 'Address not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/person/me/addresses/:addressId - update address
  router.patch('/me/addresses/:addressId', authMw as RequestHandler, requireConsumerOrVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const addressId = Array.isArray(req.params.addressId) ? req.params.addressId[0] : req.params.addressId;
      const updates = req.body;

      if (!addressId || addressId.trim().length === 0) {
        return res.status(400).json({ error: 'ADDRESS_ID_REQUIRED', message: 'Address ID is required' });
      }

      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'NO_UPDATES_PROVIDED', message: 'At least one field to update is required' });
      }

      // Don't allow changing the ID
      const { id, ...safeUpdates } = updates;

      // Validate Brazilian state if updating state
      if (safeUpdates.state && !BRAZILIAN_STATES.includes(safeUpdates.state.toUpperCase())) {
        return res.status(400).json({ error: 'INVALID_STATE', message: 'Invalid Brazilian state' });
      }

      const personId = req.user.sub;
      const person = await personService.getPersonById(personId);

      if (!person) {
        return res.status(404).json({ error: PersonError.PERSON_NOT_FOUND, message: 'Person not found' });
      }

      const updated = await personService.updateAddress(personId, addressId, safeUpdates);

      return res.json({ person: personToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PersonError.ADDRESS_NOT_FOUND:
            return res.status(404).json({ error: PersonError.ADDRESS_NOT_FOUND, message: 'Address not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskTaxId(taxIdValue: string): string {
  // Show only last 4 digits, mask the rest
  if (taxIdValue.length <= 4) {
    return '*'.repeat(taxIdValue.length);
  }
  const lastFour = taxIdValue.slice(-4);
  const maskedLength = taxIdValue.length - 4;
  return '*'.repeat(maskedLength) + lastFour;
}

function personToResponse(person: any) {
  return {
    id: person.id,
    name: person.name,
    mainInfo: {
      name: person.mainInfo.name,
      taxIdType: person.mainInfo.taxIdType,
      taxIdValue: maskTaxId(person.mainInfo.taxIdValue)
    },
    contactInfos: person.contactInfos,
    addresses: person.addresses,
    roles: person.roles,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt
  };
}