import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { PaymentMethod, Role } from '../common/enums';
import { AuditService } from '../common/services/audit.service';
import { isValidCpf } from '../common/utils/cpf';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { UpdateProfileDto } from './dto/update-profile.dto';

type SafeUser = Omit<User, 'passwordHash' | 'googleSub'> & {
    isProfileComplete: boolean;
};

type AuthResult = {
    access_token: string;
    user: SafeUser;
};

@Injectable()
export class AuthService {
    private readonly googleClient = new OAuth2Client();

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly audit: AuditService,
    ) { }

    getPublicConfig() {
        const googleClientId = this.getGoogleClientId();
        return {
            googleClientId,
            googleEnabled: !!googleClientId,
        };
    }

    async registerClient(name: string, email: string, password: string): Promise<AuthResult> {
        const normalizedEmail = this.normalizeEmail(email);
        const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (existing) {
            throw new ConflictException('Email já cadastrado');
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await this.prisma.user.create({
            data: {
                name: this.normalizeDisplayName(name),
                email: normalizedEmail,
                passwordHash,
                role: Role.CLIENT,
                emailVerified: false,
            },
        });

        await this.audit.log(user.id, 'AUTH_REGISTER', 'User', user.id, { email: user.email });

        const access_token = this.signUserToken(user);
        return { access_token, user: this.serializeUser(user) };
    }

    async login(email: string, password: string): Promise<AuthResult> {
        const normalizedEmail = this.normalizeEmail(email);
        const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (!user) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        if (!user.isActive) {
            throw new ForbiddenException('Usuário desativado. Entre em contato com o administrador.');
        }

        if (!user.passwordHash) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        const access_token = this.signUserToken(user);
        return { access_token, user: this.serializeUser(user) };
    }

    async loginWithGoogle(credential: string): Promise<AuthResult> {
        const googleClientId = this.getGoogleClientId();
        if (!googleClientId) {
            throw new InternalServerErrorException('Login com Google não configurado no servidor.');
        }

        const payload = await this.verifyGoogleCredential(credential, googleClientId);
        const googleSub = payload.sub;
        const normalizedEmail = this.normalizeEmail(payload.email);
        const now = new Date();

        let auditAction = 'AUTH_GOOGLE_LOGIN';
        let conflictLogPayload: Record<string, unknown> | null = null;

        let user: User;
        try {
            user = await this.prisma.$transaction(async (tx) => {
                const existingByGoogleSub = await tx.user.findUnique({ where: { googleSub } });

                if (existingByGoogleSub) {
                    if (!existingByGoogleSub.isActive) {
                        throw new ForbiddenException('Usuário desativado. Entre em contato com o administrador.');
                    }

                    const conflictingEmailUser =
                        existingByGoogleSub.email !== normalizedEmail
                            ? await tx.user.findUnique({ where: { email: normalizedEmail } })
                            : null;

                    if (conflictingEmailUser && conflictingEmailUser.id !== existingByGoogleSub.id) {
                        conflictLogPayload = {
                            reason: 'email_taken_by_other_user',
                            email: normalizedEmail,
                            targetUserId: conflictingEmailUser.id,
                        };
                        throw new ConflictException('Este e-mail já está vinculado a outra conta.');
                    }

                    return tx.user.update({
                        where: { id: existingByGoogleSub.id },
                        data: {
                            email: normalizedEmail,
                            name: this.normalizeDisplayName(payload.name),
                            pictureUrl: payload.picture ?? null,
                            emailVerified: true,
                            lastLoginAt: now,
                        },
                    });
                }

                const existingByEmail = await tx.user.findUnique({ where: { email: normalizedEmail } });
                if (existingByEmail) {
                    if (existingByEmail.googleSub && existingByEmail.googleSub !== googleSub) {
                        conflictLogPayload = {
                            reason: 'email_already_linked_to_other_google_account',
                            email: normalizedEmail,
                            targetUserId: existingByEmail.id,
                        };
                        throw new ConflictException('Este e-mail já está vinculado a outra conta Google.');
                    }

                    if (!existingByEmail.isActive) {
                        throw new ForbiddenException('Usuário desativado. Entre em contato com o administrador.');
                    }

                    auditAction = 'AUTH_GOOGLE_LINKED';
                    return tx.user.update({
                        where: { id: existingByEmail.id },
                        data: {
                            googleSub,
                            name: this.normalizeDisplayName(payload.name, existingByEmail.name),
                            pictureUrl: payload.picture ?? null,
                            emailVerified: true,
                            lastLoginAt: now,
                        },
                    });
                }

                auditAction = 'AUTH_GOOGLE_CREATED';
                return tx.user.create({
                    data: {
                        name: this.normalizeDisplayName(payload.name),
                        email: normalizedEmail,
                        googleSub,
                        pictureUrl: payload.picture ?? null,
                        emailVerified: true,
                        role: Role.CLIENT,
                        lastLoginAt: now,
                    },
                });
            });
        } catch (error) {
            if (conflictLogPayload) {
                await this.audit.log(null, 'AUTH_GOOGLE_LINK_CONFLICT', 'User', null, conflictLogPayload);
            }
            throw error;
        }

        await this.audit.log(user.id, auditAction, 'User', user.id, {
            email: user.email,
        });

        const access_token = this.signUserToken(user);
        return { access_token, user: this.serializeUser(user) };
    }

    async getMe(userId: string): Promise<SafeUser> {
        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
        });
        return this.serializeUser(user);
    }

    async updateProfile(userId: string, dto: UpdateProfileDto): Promise<SafeUser> {
        const cpf = this.normalizeCpf(dto.cpf);
        const phone = this.normalizePhone(dto.phone);

        if (!isValidCpf(cpf)) {
            throw new BadRequestException('Informe um CPF válido.');
        }

        if (phone.length < 10 || phone.length > 15) {
            throw new BadRequestException('Informe um celular válido com DDD');
        }

        const currentUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, cpf: true, phone: true },
        });

        if (!currentUser) {
            throw new UnauthorizedException('Usuário não encontrado');
        }

        const conflictingCpfUser = await this.prisma.user.findFirst({
            where: {
                cpf,
                NOT: { id: userId },
            },
            select: { id: true },
        });

        if (conflictingCpfUser) {
            throw new ConflictException('Este CPF já está vinculado a outra conta.');
        }

        const hasApprovedOnlinePayment = await this.prisma.order.findFirst({
            where: {
                userId,
                paidAt: { not: null },
                paymentMethod: { in: [PaymentMethod.PIX, PaymentMethod.CARD] },
            },
            select: { id: true },
        });

        if (hasApprovedOnlinePayment) {
            if (currentUser.cpf && currentUser.cpf !== cpf) {
                throw new ForbiddenException('O CPF não pode ser alterado após o primeiro pagamento aprovado.');
            }

            if (currentUser.phone && currentUser.phone !== phone) {
                throw new ForbiddenException('O celular não pode ser alterado após o primeiro pagamento aprovado.');
            }
        }

        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: { cpf, phone },
        });

        await this.audit.log(userId, 'AUTH_PROFILE_UPDATED', 'User', userId, {
            cpfChanged: currentUser.cpf !== cpf,
            phoneChanged: currentUser.phone !== phone,
        });

        return this.serializeUser(updated);
    }

    private signUserToken(user: Pick<User, 'id' | 'email' | 'role'>) {
        return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    }

    private serializeUser(user: User): SafeUser {
        const { passwordHash: _omitPasswordHash, googleSub: _omitGoogleSub, ...safeUser } = user;
        return {
            ...safeUser,
            cpf: safeUser.cpf ?? null,
            phone: safeUser.phone ?? null,
            pictureUrl: safeUser.pictureUrl ?? null,
            lastLoginAt: safeUser.lastLoginAt ?? null,
            isProfileComplete: this.isProfileComplete(safeUser),
        };
    }

    private isProfileComplete(user: Pick<User, 'cpf' | 'phone'>) {
        return isValidCpf(user.cpf) && !!user.phone;
    }

    private getGoogleClientId() {
        const clientId = this.configService.get<string>('GOOGLE_WEB_CLIENT_ID')?.trim();
        return clientId || null;
    }

    private async verifyGoogleCredential(credential: string, googleClientId: string): Promise<TokenPayload & { sub: string; email: string }> {
        const idToken = credential.trim();
        if (!idToken) {
            throw new BadRequestException('Token do Google não informado.');
        }

        const ticket = await this.googleClient.verifyIdToken({
            idToken,
            audience: googleClientId,
        }).catch(() => {
            throw new UnauthorizedException('Falha ao validar autenticação com Google.');
        });

        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email || payload.email_verified !== true) {
            throw new UnauthorizedException('Conta Google inválida ou e-mail não verificado.');
        }

        if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss ?? '')) {
            throw new UnauthorizedException('Emissor do token Google inválido.');
        }

        return payload as TokenPayload & { sub: string; email: string };
    }

    private normalizeEmail(email?: string | null) {
        const normalized = (email ?? '').trim().toLowerCase();
        if (!normalized) {
            throw new BadRequestException('E-mail inválido.');
        }
        return normalized;
    }

    private normalizeDisplayName(name?: string | null, fallback = 'Cliente') {
        const normalized = (name ?? '').trim();
        return normalized || fallback;
    }

    private normalizeCpf(value: string) {
        return value.replace(/\D/g, '');
    }

    private normalizePhone(value: string) {
        return value.replace(/\D/g, '');
    }
}
