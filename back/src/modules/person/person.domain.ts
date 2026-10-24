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

function normalizeTaxId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validatePersonTaxId(cpf: string | null | undefined, cnpj: string | null | undefined): PersonTaxIdResult {
  const safeCpf = normalizeTaxId(cpf);
  const safeCnpj = normalizeTaxId(cnpj);
  const hasCpf = safeCpf.length > 0;
  const hasCnpj = safeCnpj.length > 0;

  if (hasCpf && hasCnpj) {
    return { isValid: false, error: PersonTaxIdError.BOTH_PROVIDED };
  }

  if (!hasCpf && !hasCnpj) {
    return { isValid: false, error: PersonTaxIdError.NEITHER_PROVIDED };
  }

  if (hasCpf) {
    if (!ONLY_DIGITS.test(safeCpf)) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_FORMAT };
    }
    if (safeCpf.length !== 11) {
      return { isValid: false, error: PersonTaxIdError.INVALID_CPF_LENGTH };
    }
    return { isValid: true, type: 'CPF', value: safeCpf };
  }

  if (!ONLY_DIGITS.test(safeCnpj)) {
    return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_FORMAT };
  }
  if (safeCnpj.length !== 14) {
    return { isValid: false, error: PersonTaxIdError.INVALID_CNPJ_LENGTH };
  }
  return { isValid: true, type: 'CNPJ', value: safeCnpj };
}