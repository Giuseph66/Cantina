import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Role } from '../common/enums';
import { isValidCpf } from '../common/utils/cpf';

type SafeUser = Omit<User, 'passwordHash' | 'googleSub'>;

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }

    async create(dto: CreateUserDto): Promise<SafeUser> {
        const email = this.normalizeEmail(dto.email);
        const existing = await this.prisma.user.findUnique({ where: { email } });

        if (existing) {
            throw new ConflictException('Email já cadastrado');
        }

        const passwordHash = await this.resolvePasswordHash(dto.role, dto.password);

        const user = await this.prisma.user.create({
            data: {
                name: dto.name.trim(),
                email,
                passwordHash,
                cpf: this.normalizeCpf(dto.cpf),
                phone: this.normalizePhone(dto.phone),
                emailVerified: dto.role !== Role.CLIENT,
                role: dto.role,
            },
        });

        return this.serializeUser(user);
    }

    async deactivate(id: string): Promise<SafeUser> {
        const user = await this.prisma.user.findUnique({ where: { id } });

        if (!user) {
            throw new NotFoundException(`Usuário ${id} não encontrado`);
        }

        const updated = await this.prisma.user.update({
            where: { id },
            data: { isActive: false },
        });

        return this.serializeUser(updated);
    }

    async update(id: string, dto: { name?: string; email?: string; role?: string; password?: string; cpf?: string; phone?: string }): Promise<SafeUser> {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw new NotFoundException(`Usuário ${id} não encontrado`);

        const nextEmail = dto.email ? this.normalizeEmail(dto.email) : user.email;
        if (nextEmail !== user.email) {
            const existing = await this.prisma.user.findUnique({ where: { email: nextEmail } });
            if (existing) throw new ConflictException('Email já cadastrado');
        }

        const nextRole = dto.role ?? user.role;
        const passwordHash = dto.password
            ? await bcrypt.hash(dto.password, 12)
            : await this.resolvePasswordHash(nextRole, undefined, user.passwordHash ?? null);

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                name: dto.name?.trim() || undefined,
                email: nextEmail,
                role: nextRole,
                passwordHash,
                cpf: dto.cpf !== undefined ? this.normalizeCpf(dto.cpf) : undefined,
                phone: dto.phone !== undefined ? this.normalizePhone(dto.phone) : undefined,
            },
        });

        return this.serializeUser(updated);
    }

    async activate(id: string): Promise<SafeUser> {
        const user = await this.prisma.user.findUnique({ where: { id } });

        if (!user) {
            throw new NotFoundException(`Usuário ${id} não encontrado`);
        }

        const updated = await this.prisma.user.update({
            where: { id },
            data: { isActive: true },
        });

        return this.serializeUser(updated);
    }

    async findAll(): Promise<SafeUser[]> {
        const users = await this.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return users.map((user) => this.serializeUser(user));
    }

    private async resolvePasswordHash(role: string, password?: string, currentPasswordHash: string | null = null) {
        if (password) {
            return bcrypt.hash(password, 12);
        }

        if (role === Role.CLIENT) {
            return currentPasswordHash;
        }

        if (currentPasswordHash) {
            return currentPasswordHash;
        }

        throw new BadRequestException('Senha é obrigatória para usuários internos.');
    }

    private serializeUser(user: User): SafeUser {
        const { passwordHash: _omitPasswordHash, googleSub: _omitGoogleSub, ...safeUser } = user;
        return safeUser;
    }

    private normalizeEmail(email: string) {
        return email.trim().toLowerCase();
    }

    private normalizeCpf(value?: string | null) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        const normalized = value.replace(/\D/g, '');
        if (!normalized) return null;
        if (!isValidCpf(normalized)) throw new BadRequestException('CPF inválido');
        return normalized;
    }

    private normalizePhone(value?: string | null) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        const normalized = value.replace(/\D/g, '');
        return normalized || null;
    }
}
