import { validatePersonTaxId, PersonTaxIdError } from './src/modules/person/person.domain';

const testCases = [
  { type: 'CPF', value: '52998224725', label: 'Order Owner' },
  { type: 'CPF', value: '98765432100', label: 'Other Consumer' },
  { type: 'CNPJ', value: '11222333000100', label: 'Test Vendor' },
  { type: 'CNPJ', value: '11222333000299', label: 'Other Vendor' },
  { type: 'CNPJ', value: '11222333000262', label: 'Marketplace Admin' },
];

for (const tc of testCases) {
  const result = tc.type === 'CPF' 
    ? validatePersonTaxId(tc.value, undefined)
    : validatePersonTaxId(undefined, tc.value);
  console.log(`${tc.label} (${tc.type}): ${tc.value} -> ${result.isValid ? 'VALID' : 'INVALID: ' + result.error}`);
}
