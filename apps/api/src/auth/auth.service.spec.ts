import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentMethod, Role } from '../common/enums';
import { AuditService } from '../common/services/audit.service';

describe('AuthService', () => {
    let service: AuthService;
    let prisma: any;

    const mockUser = {
        id: 'user-id-1',
        name: 'Admin',
        email: 'admin@cantina.local',
        passwordHash: '',
        googleSub: null,
        pictureUrl: null,
        emailVerified: true,
        cpf: null,
        phone: null,
        role: Role.ADMIN,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        mockUser.passwordHash = await bcrypt.hash('admin123', 10);

        const prismaMock: any = {
            user: {
                findUnique: jest.fn(),
                findUniqueOrThrow: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            order: {
                findFirst: jest.fn(),
            },
            $transaction: jest.fn(async (callback: any) => callback(prismaMock)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: PrismaService, useValue: prismaMock },
                { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock.jwt.token') } },
                { provide: ConfigService, useValue: { get: jest.fn((key: string) => key === 'GOOGLE_WEB_CLIENT_ID' ? 'google-client-id' : undefined) } },
                { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
            ],
        }).compile();

        service = module.get(AuthService);
        prisma = module.get(PrismaService);
        prisma.order.findFirst.mockResolvedValue(null);
    });

    it('deve retornar access_token com credenciais internas válidas', async () => {
        prisma.user.findUnique.mockResolvedValue(mockUser);

        const result = await service.login('admin@cantina.local', 'admin123');

        expect(result.access_token).toBe('mock.jwt.token');
        expect(result.user.email).toBe('admin@cantina.local');
        expect((result.user as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('deve lançar UnauthorizedException com usuário inexistente', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.login('nao@existe.com', 'qualquer')).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it('deve permitir cliente entrar com senha', async () => {
        const clientUser = {
            ...mockUser,
            role: Role.CLIENT,
            email: 'cliente@cantina.local',
            passwordHash: await bcrypt.hash('cliente123', 10),
        };
        prisma.user.findUnique.mockResolvedValue(clientUser);

        const result = await service.login('cliente@cantina.local', 'cliente123');
        expect(result.user.role).toBe(Role.CLIENT);
    });

    it('deve lançar ForbiddenException se usuário inativo', async () => {
        prisma.user.findUnique.mockResolvedValue({
            ...mockUser,
            isActive: false,
        });

        await expect(service.login('admin@cantina.local', 'admin123')).rejects.toThrow(
            ForbiddenException,
        );
    });

    it('getMe deve retornar usuário sem passwordHash', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue(mockUser);

        const result = await service.getMe(mockUser.id);
        expect(result.id).toBe(mockUser.id);
        expect((result as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('deve criar cliente manualmente no cadastro público', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.create.mockImplementation(async ({ data }: any) => ({
            id: 'client-created',
            name: data.name,
            email: data.email,
            passwordHash: data.passwordHash,
            googleSub: null,
            pictureUrl: null,
            emailVerified: false,
            cpf: null,
            phone: null,
            role: Role.CLIENT,
            isActive: true,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        const result = await service.registerClient('Cliente Manual', 'manual@cantina.local', 'manual123');

        expect(result.user.email).toBe('manual@cantina.local');
        expect(result.user.role).toBe(Role.CLIENT);
        expect(prisma.user.create).toHaveBeenCalled();
    });

    it('deve vincular login Google em cliente existente com mesmo e-mail', async () => {
        const clientUser = {
            ...mockUser,
            id: 'client-1',
            role: Role.CLIENT,
            email: 'cliente@cantina.local',
            passwordHash: null,
        };

        jest.spyOn(service as any, 'verifyGoogleCredential').mockResolvedValue({
            sub: 'google-sub-1',
            email: 'cliente@cantina.local',
            email_verified: true,
            iss: 'https://accounts.google.com',
            name: 'Cliente Google',
            picture: 'https://example.com/avatar.png',
        });

        prisma.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(clientUser);
        prisma.user.update.mockResolvedValue({
            ...clientUser,
            googleSub: 'google-sub-1',
            name: 'Cliente Google',
            pictureUrl: 'https://example.com/avatar.png',
            lastLoginAt: new Date(),
        });

        const result = await service.loginWithGoogle('credential');

        expect(result.user.id).toBe('client-1');
        expect(prisma.user.update).toHaveBeenCalled();
    });

    it('deve vincular login Google em usuário interno com mesmo e-mail', async () => {
        jest.spyOn(service as any, 'verifyGoogleCredential').mockResolvedValue({
            sub: 'google-sub-1',
            email: 'admin@cantina.local',
            email_verified: true,
            iss: 'https://accounts.google.com',
            name: 'Admin Google',
            picture: null,
        });

        prisma.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(mockUser);
        prisma.user.update.mockResolvedValue({
            ...mockUser,
            googleSub: 'google-sub-1',
            name: 'Admin Google',
            lastLoginAt: new Date(),
        });

        const result = await service.loginWithGoogle('credential');

        expect(result.user.id).toBe(mockUser.id);
        expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: mockUser.id },
            data: expect.objectContaining({ googleSub: 'google-sub-1' }),
        }));
    });

    it('deve permitir login Google posterior em usuário interno vinculado', async () => {
        const linkedAdmin = {
            ...mockUser,
            googleSub: 'google-sub-1',
        };

        jest.spyOn(service as any, 'verifyGoogleCredential').mockResolvedValue({
            sub: 'google-sub-1',
            email: 'admin@cantina.local',
            email_verified: true,
            iss: 'https://accounts.google.com',
            name: 'Admin Google',
            picture: null,
        });

        prisma.user.findUnique.mockResolvedValueOnce(linkedAdmin);
        prisma.user.update.mockResolvedValue({
            ...linkedAdmin,
            name: 'Admin Google',
            lastLoginAt: new Date(),
        });

        const result = await service.loginWithGoogle('credential');

        expect(result.user.id).toBe(mockUser.id);
        expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: mockUser.id },
        }));
    });

    it('deve falhar quando o e-mail já estiver vinculado a outro Google', async () => {
        jest.spyOn(service as any, 'verifyGoogleCredential').mockResolvedValue({
            sub: 'google-sub-2',
            email: 'cliente@cantina.local',
            email_verified: true,
            iss: 'https://accounts.google.com',
            name: 'Cliente Google',
            picture: null,
        });

        prisma.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                ...mockUser,
                id: 'client-2',
                role: Role.CLIENT,
                email: 'cliente@cantina.local',
                googleSub: 'google-sub-existing',
                passwordHash: null,
            });

        await expect(service.loginWithGoogle('credential')).rejects.toThrow(ConflictException);
    });

    it('deve permitir atualizar perfil antes do primeiro pagamento aprovado', async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: 'client-1',
            cpf: null,
            phone: null,
        });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.order.findFirst.mockResolvedValue(null);
        prisma.user.update.mockResolvedValue({
            ...mockUser,
            id: 'client-1',
            role: Role.CLIENT,
            cpf: '52998224725',
            phone: '65999999999',
        });

        const result = await service.updateProfile('client-1', {
            cpf: '52998224725',
            phone: '65999999999',
        });

        expect(result.cpf).toBe('52998224725');
        expect(prisma.user.update).toHaveBeenCalled();
    });

    it('deve rejeitar CPF com dígitos verificadores inválidos', async () => {
        await expect(service.updateProfile('client-1', {
            cpf: '12345678901',
            phone: '65999999999',
        })).rejects.toThrow(BadRequestException);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('deve bloquear troca de CPF após pagamento aprovado', async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: 'client-1',
            cpf: '52998224725',
            phone: '65999999999',
        });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.order.findFirst.mockResolvedValue({
            id: 'order-1',
            paymentMethod: PaymentMethod.PIX,
        });

        await expect(service.updateProfile('client-1', {
            cpf: '11144477735',
            phone: '65999999999',
        })).rejects.toThrow(ForbiddenException);
    });

    it('deve bloquear troca de celular após pagamento aprovado', async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: 'client-1',
            cpf: '52998224725',
            phone: '65999999999',
        });
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.order.findFirst.mockResolvedValue({
            id: 'order-1',
            paymentMethod: PaymentMethod.CARD,
        });

        await expect(service.updateProfile('client-1', {
            cpf: '52998224725',
            phone: '65111111111',
        })).rejects.toThrow(ForbiddenException);
    });
});
