import { validateCnpjCheckDigits, validatePersonTaxId } from './src/modules/person/person.domain';

function calculateCheckDigit(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += digits[i] * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function generateValidCnpj(base12: string): string {
  const digits = base12.split('').map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  
  const check1 = calculateCheckDigit(digits, weights1);
  const digitsWithFirst = [...digits, check1];
  const check2 = calculateCheckDigit(digitsWithFirst, weights2);
  
  return base12 + check1.toString() + check2.toString();
}

// Test with the base numbers from the invalid CNPJs
const base1 = '112223330001';
const base2 = '112223330002';

const validCnpj1 = generateValidCnpj(base1);
const validCnpj2 = generateValidCnpj(base2);

console.log(`Base: ${base1} -> Valid CNPJ: ${validCnpj1}`);
console.log(`Base: ${base2} -> Valid CNPJ: ${validCnpj2}`);

// Verify they're valid
const result1 = validatePersonTaxId(undefined, validCnpj1);
const result2 = validatePersonTaxId(undefined, validCnpj2);
console.log(`Valid CNPJ 1: ${result1.isValid ? 'VALID' : 'INVALID: ' + result1.error}`);
console.log(`Valid CNPJ 2: ${result2.isValid ? 'VALID' : 'INVALID: ' + result2.error}`);

// Also verify they're distinct
console.log(`Are they distinct? ${validCnpj1 !== validCnpj2}`);
