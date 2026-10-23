export enum PersonTaxIdError {
  BOTH_PROVIDED = 'BOTH_PROVIDED',
  NEITHER_PROVIDED = 'NEITHER_PROVIDED',
  INVALID_CPF_LENGTH = 'INVALID_CPF_LENGTH',
  INVALID_CNPJ_LENGTH = 'INVALID_CNPJ_LENGTH',
  INVALID_CPF_FORMAT = 'INVALID_CPF_FORMAT',
  INVALID_CNPJ_FORMAT = 'INVALID_CNPJ_FORMAT'
}

export interface PersonTaxIdResult {
  isValid: boolean;
  type?: 'CPF' | 'CNPJ';
  value?: string;
  error?: PersonTaxIdError;
}

const ONLY_DIGITS = /^\d+$/;

export function validatePersonTaxId(cpf: string, cnpj: string): PersonTaxIdResult {
  const hasCpf = cpf.trim().length > 0;
  const hasCnpj = cnpj.trim().length > 0;

  if (hasCpf && hasCnpj) {
    return { isValid: false, error: PersonTaxIdError.BOTH_PROVIDED };
  }

  if (!hasCpf && !hasCnpj) {
    return { isValid: false, error: PersonTaxIdError.NEITHER_PROVIDED };
  }

  if (hasCpf) {
    const cleanCpf = cpf.trim();
    if (!ONLY_DIGITS.test(cleanCpf)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_FORMAT };
    }
    if (cleanCpf.length !== 11) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_LENGTH };
    }
    return { isValid: true, type: 'CPF', value: cleanCpf };
  }

  const cleanCnpj = cnpj.trim();
  if (!ONLY_DIGITS.test(cleanCnpj)) {
    return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_FORMAT };
  }
  if (cleanCnpj.length !== 14) {
    return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_LENGTH };
  }
  return { isValid: true, type: 'CNPJ', value: cleanCnpj };
}