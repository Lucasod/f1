export enum PersonTaxIdError {
  BOTH_PROVIDED = 'BOTH_PROVIDED',
  NEITHER_PROVIDED = 'NEITHER_PROVIDED',
  INVALID_CPF_LENGTH = 'INVALID_CPF_LENGTH',
  INVALID_CNPJ_LENGTH = 'INVALID_CNPJ_LENGTH',
  INVALID_CPF_FORMAT = 'INVALID_CPF_FORMAT',
  INVALID_CNPJ_FORMAT = 'INVALID_CNPJ_FORMAT',
  INVALID_CPF_CHECK_DIGITS = 'INVALID_CPF_CHECK_DIGITS',
  INVALID_CNPJ_CHECK_DIGITS = 'INVALID_CNPJ_CHECK_DIGITS',
  ALL_DIGITS_SAME = 'ALL_DIGITS_SAME'
}

export interface PersonTaxIdResult {
  isValid: boolean;
  type?: 'CPF' | 'CNPJ';
  value?: string;
  error?: PersonTaxIdError;
}

function normalizeTaxId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function allDigitsSame(value: string): boolean {
  return value.split('').every(d => d === value[0]);
}

function calculateCheckDigit(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += digits[i] * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function validateCpfCheckDigits(cpf: string): boolean {
  const digits = cpf.split('').map(Number);
  const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

  const check1 = calculateCheckDigit(digits, weights1);
  if (check1 !== digits[9]) return false;

  const check2 = calculateCheckDigit(digits, weights2);
  return check2 === digits[10];
}

function validateCnpjCheckDigits(cnpj: string): boolean {
  const digits = cnpj.split('').map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const check1 = calculateCheckDigit(digits, weights1);
  if (check1 !== digits[12]) return false;

  const check2 = calculateCheckDigit(digits, weights2);
  return check2 === digits[13];
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

export function validatePersonTaxId(cpf: string | null | undefined, cnpj: string | null | undefined): PersonTaxIdResult {
  const safeCpf = normalizeTaxId(cpf);
  const safeCnpj = normalizeTaxId(cnpj);

  if (safeCpf && safeCnpj) {
    return { isValid: false, error: PersonTaxIdError.BOTH_PROVIDED };
  }

  if (safeCpf) {
    if (safeCpf.length !== 11) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_LENGTH };
    }
    if (!isNumeric(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_FORMAT };
    }
    if (allDigitsSame(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.ALL_DIGITS_SAME };
    }
    if (!validateCpfCheckDigits(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_CHECK_DIGITS };
    }
    return { isValid: true, type: 'CPF', value: safeCpf };
  }

  if (safeCnpj) {
    if (safeCnpj.length !== 14) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_LENGTH };
    }
    if (!isNumeric(safeCnpj)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_FORMAT };
    }
    if (allDigitsSame(safeCnpj)) {
      return { isValid: false, error: PersonTaxIdError.ALL_DIGITS_SAME };
    }
    if (!validateCnpjCheckDigits(safeCnpj)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_CHECK_DIGITS };
    }
    return { isValid: true, type: 'CNPJ', value: safeCnpj };
  }

  return { isValid: false, error: PersonTaxIdError.NEITHER_PROVIDED };
}