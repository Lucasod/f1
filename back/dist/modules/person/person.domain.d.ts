export declare enum PersonTaxIdError {
    BOTH_PROVIDED = "BOTH_PROVIDED",
    NEITHER_PROVIDED = "NEITHER_PROVIDED",
    INVALID_CPF_LENGTH = "INVALID_CPF_LENGTH",
    INVALID_CNPJ_LENGTH = "INVALID_CNPJ_LENGTH",
    INVALID_CPF_FORMAT = "INVALID_CPF_FORMAT",
    INVALID_CNPJ_FORMAT = "INVALID_CNPJ_FORMAT"
}
export interface PersonTaxIdResult {
    isValid: boolean;
    type?: 'CPF' | 'CNPJ';
    value?: string;
    error?: PersonTaxIdError;
}
export declare function validatePersonTaxId(cpf: string, cnpj: string): PersonTaxIdResult;
//# sourceMappingURL=person.domain.d.ts.map