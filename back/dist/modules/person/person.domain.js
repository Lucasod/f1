"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonTaxIdError = void 0;
exports.validatePersonTaxId = validatePersonTaxId;
var PersonTaxIdError;
(function (PersonTaxIdError) {
    PersonTaxIdError["BOTH_PROVIDED"] = "BOTH_PROVIDED";
    PersonTaxIdError["NEITHER_PROVIDED"] = "NEITHER_PROVIDED";
    PersonTaxIdError["INVALID_CPF_LENGTH"] = "INVALID_CPF_LENGTH";
    PersonTaxIdError["INVALID_CNPJ_LENGTH"] = "INVALID_CNPJ_LENGTH";
    PersonTaxIdError["INVALID_CPF_FORMAT"] = "INVALID_CPF_FORMAT";
    PersonTaxIdError["INVALID_CNPJ_FORMAT"] = "INVALID_CNPJ_FORMAT";
})(PersonTaxIdError || (exports.PersonTaxIdError = PersonTaxIdError = {}));
const ONLY_DIGITS = /^\d+$/;
function validatePersonTaxId(cpf, cnpj) {
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
//# sourceMappingURL=person.domain.js.map