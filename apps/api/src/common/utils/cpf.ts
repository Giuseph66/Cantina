export function isValidCpf(value?: string | null) {
    const cpf = (value ?? '').replace(/\D/g, '');

    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

    const calculateDigit = (digits: string, factor: number) => {
        const total = [...digits].reduce((sum, digit, index) => sum + Number(digit) * (factor - index), 0);
        const remainder = total % 11;
        return remainder < 2 ? 0 : 11 - remainder;
    };

    return calculateDigit(cpf.slice(0, 9), 10) === Number(cpf[9])
        && calculateDigit(cpf.slice(0, 10), 11) === Number(cpf[10]);
}
