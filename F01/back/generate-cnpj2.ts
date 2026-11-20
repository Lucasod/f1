import { validatePersonTaxId } from './src/modules/person/person.domain';

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

// Use different bases to ensure distinct CNPJs
const bases = [
  '112223330001', // Test Vendor
  '112223330003', // Other Vendor (changed from 0002 to 0003 to avoid collision with admin)
];

const adminCnpj = '11222333000262';

for (const base of bases) {
  const validCnpj = generateValidCnpj(base);
  const result = validatePersonTaxId(undefined, validCnpj);
  console.log(`Base: ${base} -> Valid CNPJ: ${validCnpj} -> ${result.isValid ? 'VALID' : 'INVALID'}`);
  console.log(`  Distinct from admin? ${validCnpj !== adminCnpj}`);
}
