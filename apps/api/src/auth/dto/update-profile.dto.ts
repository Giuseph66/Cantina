import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const CPF_PATTERN = /^\d{11}$/;
const PHONE_PATTERN = /^\d{10,15}$/;
const POSTAL_CODE_PATTERN = /^\d{8}$/;
const ADDRESS_NUMBER_PATTERN = /^[0-9A-Za-z\s\-\/]{1,10}$/;

export class UpdateProfileDto {
    @IsString()
    @Matches(CPF_PATTERN, { message: 'Informe um CPF válido com 11 dígitos' })
    cpf: string;

    @IsString()
    @Matches(PHONE_PATTERN, { message: 'Informe um celular válido com DDD' })
    phone: string;

    @IsOptional()
    @IsString()
    @Matches(POSTAL_CODE_PATTERN, { message: 'Informe um CEP válido com 8 dígitos' })
    postalCode?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10)
    @Matches(ADDRESS_NUMBER_PATTERN, { message: 'Informe o número do endereço' })
    addressNumber?: string;
}
