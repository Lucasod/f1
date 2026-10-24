import { describe, it, expect } from 'vitest';
import { validatePersonTaxId, PersonTaxIdError } from './person.domain';

describe('Person Tax ID Validation (CPF XOR CNPJ)', () => {
  describe('validatePersonTaxId', () => {
    it('should reject when both CPF and CNPJ are provided', () => {
      const result = validatePersonTaxId('12345678901', '12345678000199');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.BOTH_PROVIDED);
    });

    it('should reject when neither CPF nor CNPJ is provided', () => {
      const result = validatePersonTaxId('', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.NEITHER_PROVIDED);
    });

    it('should reject when CPF is empty string and CNPJ is provided', () => {
      const result = validatePersonTaxId('', '12345678000199');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.type).toBe('CNPJ');
      expect(result.value).toBe('12345678000199');
    });

    it('should reject when CNPJ is empty string and CPF is provided', () => {
      const result = validatePersonTaxId('12345678901', '');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.type).toBe('CPF');
      expect(result.value).toBe('12345678901');
    });

    it('should accept valid CPF (11 digits)', () => {
      const result = validatePersonTaxId('12345678901', '');
      expect(result.isValid).toBe(true);
      expect(result.type).toBe('CPF');
      expect(result.value).toBe('12345678901');
    });

    it('should accept valid CNPJ (14 digits)', () => {
      const result = validatePersonTaxId('', '12345678000199');
      expect(result.isValid).toBe(true);
      expect(result.type).toBe('CNPJ');
      expect(result.value).toBe('12345678000199');
    });

    it('should reject CPF with wrong length', () => {
      const result = validatePersonTaxId('1234567890', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CPF_LENGTH);
    });

    it('should reject CNPJ with wrong length', () => {
      const result = validatePersonTaxId('', '1234567800019');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CNPJ_LENGTH);
    });

    it('should reject CPF with non-digits', () => {
      const result = validatePersonTaxId('123.456.789-01', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CPF_FORMAT);
    });

    it('should reject CNPJ with non-digits', () => {
      const result = validatePersonTaxId('', '12.345.678/0001-99');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CNPJ_FORMAT);
    });

    it('should tolerate undefined values without crashing', () => {
      expect(validatePersonTaxId(undefined, '12345678000199')).toMatchObject({
        isValid: true,
        type: 'CNPJ',
        value: '12345678000199'
      });
      expect(validatePersonTaxId('12345678901', undefined)).toMatchObject({
        isValid: true,
        type: 'CPF',
        value: '12345678901'
      });
      expect(validatePersonTaxId(undefined, undefined)).toMatchObject({
        isValid: false,
        error: PersonTaxIdError.NEITHER_PROVIDED
      });
    });
  });
});