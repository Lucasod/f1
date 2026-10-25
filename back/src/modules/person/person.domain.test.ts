import { describe, it, expect } from 'vitest';
import { validatePersonTaxId, PersonTaxIdError } from './person.domain';

// Valid CPF: 52998224725 (check digits calculated correctly)
// Valid CNPJ: 11222333000181 (check digits calculated correctly)

describe('Person Tax ID Validation (CPF XOR CNPJ)', () => {
  describe('validatePersonTaxId', () => {
    it('should reject when both CPF and CNPJ are provided', () => {
      const result = validatePersonTaxId('52998224725', '11222333000181');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.BOTH_PROVIDED);
    });

    it('should reject when neither CPF nor CNPJ is provided', () => {
      const result = validatePersonTaxId('', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.NEITHER_PROVIDED);
    });

    it('should reject when CPF is empty string and CNPJ is provided', () => {
      const result = validatePersonTaxId('', '11222333000181');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.type).toBe('CNPJ');
      expect(result.value).toBe('11222333000181');
    });

    it('should reject when CNPJ is empty string and CPF is provided', () => {
      const result = validatePersonTaxId('52998224725', '');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.type).toBe('CPF');
      expect(result.value).toBe('52998224725');
    });

    it('should accept valid CPF (11 digits with correct check digits)', () => {
      const result = validatePersonTaxId('52998224725', '');
      expect(result.isValid).toBe(true);
      expect(result.type).toBe('CPF');
      expect(result.value).toBe('52998224725');
    });

    it('should accept valid CNPJ (14 digits with correct check digits)', () => {
      const result = validatePersonTaxId('', '11222333000181');
      expect(result.isValid).toBe(true);
      expect(result.type).toBe('CNPJ');
      expect(result.value).toBe('11222333000181');
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

    it('should reject CPF with non-numeric characters', () => {
      const result = validatePersonTaxId('1234567890a', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CPF_FORMAT);
    });

    it('should reject CNPJ with non-numeric characters', () => {
      const result = validatePersonTaxId('', '1234567800019a');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CNPJ_FORMAT);
    });

    it('should reject CPF with invalid first check digit', () => {
      const result = validatePersonTaxId('52998224735', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CPF_CHECK_DIGITS);
    });

    it('should reject CPF with invalid second check digit', () => {
      const result = validatePersonTaxId('52998224720', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CPF_CHECK_DIGITS);
    });

    it('should reject CNPJ with invalid first check digit', () => {
      const result = validatePersonTaxId('', '11222333000171');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CNPJ_CHECK_DIGITS);
    });

    it('should reject CNPJ with invalid second check digit', () => {
      const result = validatePersonTaxId('', '11222333000180');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.INVALID_CNPJ_CHECK_DIGITS);
    });

    it('should reject CPF with all digits same', () => {
      const result = validatePersonTaxId('11111111111', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.ALL_DIGITS_SAME);
    });

    it('should reject CNPJ with all digits same', () => {
      const result = validatePersonTaxId('', '11111111111111');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.ALL_DIGITS_SAME);
    });

    it('should reject CPF 00000000000 (all zeros)', () => {
      const result = validatePersonTaxId('00000000000', '');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.ALL_DIGITS_SAME);
    });

    it('should reject CNPJ 00000000000000 (all zeros)', () => {
      const result = validatePersonTaxId('', '00000000000000');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(PersonTaxIdError.ALL_DIGITS_SAME);
    });

    it('should tolerate undefined values without crashing', () => {
      expect(validatePersonTaxId(undefined, '11222333000181')).toMatchObject({
        isValid: true,
        type: 'CNPJ',
        value: '11222333000181'
      });
      expect(validatePersonTaxId('52998224725', undefined)).toMatchObject({
        isValid: true,
        type: 'CPF',
        value: '52998224725'
      });
      expect(validatePersonTaxId(undefined, undefined)).toMatchObject({
        isValid: false,
        error: PersonTaxIdError.NEITHER_PROVIDED
      });
    });
  });
});