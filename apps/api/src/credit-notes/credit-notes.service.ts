import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, CreditNoteStatus, PaymentMethod, Role } from '../common/enums';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { BulkSettleCreditNotesDto, ListCreditNotesQueryDto, SearchCustomersQueryDto, SettleCreditNoteDto } from './dto/credit-note.dto';

@Injectable()
export class CreditNotesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) { }

    async list(query: ListCreditNotesQueryDto) {
        const notes = await this.prisma.creditNote.findMany({
            where: {
                ...(query.status ? { status: query.status } : {}),
                ...this.buildSearchWhere(query.search),
            },
            include: {
                order: {
                    select: {
                        id: true,
                        createdAt: true,
                        totalCents: true,
                        paidAt: true,
                        items: {
                            include: {
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        imageUrl: true,
                                    },
                                },
                            },
                        },
                    },
                },
                customerUser: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                createdBy: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                settledBy: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
            orderBy: [
                { status: 'asc' },
                { createdAt: 'desc' },
            ],
        });

        return notes.map((note) => ({
            ...note,
            isOverdue: note.status === CreditNoteStatus.OPEN && !!note.dueAt && note.dueAt.getTime() < Date.now(),
        }));
    }

    async getSummary() {
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const [openNotes, paidNotesToday] = await Promise.all([
            this.prisma.creditNote.findMany({
                where: { status: CreditNoteStatus.OPEN },
                select: { id: true, totalCents: true, paidCents: true, dueAt: true },
            }),
            this.prisma.creditNote.aggregate({
                _sum: { totalCents: true },
                _count: { _all: true },
                where: {
                    status: CreditNoteStatus.PAID,
                    settledAt: { gte: startOfDay },
                },
            }),
        ]);

        const overdueNotes = openNotes.filter((note) => note.dueAt && note.dueAt.getTime() < now.getTime());
        const openTotalCents = openNotes.reduce((sum, note) => sum + (note.totalCents - note.paidCents), 0);
        const overdueCents = overdueNotes.reduce((sum, note) => sum + (note.totalCents - note.paidCents), 0);

        return {
            openCount: openNotes.length,
            openTotalCents,
            overdueCount: overdueNotes.length,
            overdueCents,
            receivedTodayCount: paidNotesToday._count._all,
            receivedTodayCents: paidNotesToday._sum.totalCents ?? 0,
        };
    }

    async searchCustomers(query: SearchCustomersQueryDto) {
        const search = query.search?.trim();
        return this.prisma.user.findMany({
            where: {
                role: Role.CLIENT,
                isActive: true,
                ...(search
                    ? {
                        OR: [
                            { name: { contains: search } },
                            { email: { contains: search } },
                        ],
                    }
                    : {}),
            },
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
            },
            orderBy: { name: 'asc' },
            take: 20,
        });
    }

    async settle(noteId: string, actorUserId: string, dto: SettleCreditNoteDto) {
        const note = await this.prisma.creditNote.findUnique({
            where: { id: noteId },
            include: {
                order: {
                    select: {
                        id: true,
                        paidAt: true,
                        totalCents: true,
                    },
                },
            },
        });

        if (!note) {
            throw new NotFoundException('Notinha não encontrada');
        }

        if (note.status !== CreditNoteStatus.OPEN) {
            throw new BadRequestException('Essa notinha já foi quitada ou cancelada.');
        }

        const openSession = await this.prisma.cashSession.findFirst({
            where: {
                openedById: actorUserId,
                closedAt: null,
            },
            orderBy: { openedAt: 'desc' },
        });

        if (!openSession) {
            throw new BadRequestException('Abra o seu caixa antes de receber uma notinha.');
        }

        const settledAt = new Date();

        const result = await this.prisma.$transaction(async (tx) => {
            const settledNote = await tx.creditNote.update({
                where: { id: noteId },
                data: {
                    status: CreditNoteStatus.PAID,
                    settledAt,
                    settledById: actorUserId,
                    settledPaymentMethod: dto.paymentMethod,
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            totalCents: true,
                        },
                    },
                    customerUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    createdBy: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    settledBy: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            });

            await tx.order.update({
                where: { id: note.orderId },
                data: {
                    paidAt: note.order.paidAt ?? settledAt,
                },
            });

            await tx.cashMovement.create({
                data: {
                    cashSessionId: openSession.id,
                    type: CashMovementType.SALE,
                    amountCents: note.totalCents,
                    method: dto.paymentMethod,
                    referenceOrderId: note.orderId,
                },
            });

            return settledNote;
        });

        await this.audit.log(actorUserId, 'CREDIT_NOTE_SETTLED', 'CreditNote', noteId, {
            orderId: note.orderId,
            amountCents: note.totalCents,
            paymentMethod: dto.paymentMethod,
        });

        return result;
    }

    async bulkSettle(actorUserId: string, dto: BulkSettleCreditNotesDto) {
        if (!dto.noteIds || dto.noteIds.length === 0) {
            throw new BadRequestException('Nenhuma notinha selecionada.');
        }

        const openSession = await this.prisma.cashSession.findFirst({
            where: {
                openedById: actorUserId,
                closedAt: null,
            },
            orderBy: { openedAt: 'desc' },
        });

        if (!openSession) {
            throw new BadRequestException('Abra o seu caixa antes de receber notinhas.');
        }

        const notes = await this.prisma.creditNote.findMany({
            where: {
                id: { in: dto.noteIds },
                status: CreditNoteStatus.OPEN,
            },
            orderBy: { createdAt: 'asc' },
            include: {
                order: {
                    select: {
                        id: true,
                        paidAt: true,
                        totalCents: true,
                    },
                },
            },
        });

        if (notes.length === 0) {
            throw new BadRequestException('Nenhuma das notinhas selecionadas está aberta.');
        }

        let remainingAmount = dto.amountCents ?? notes.reduce((sum, n) => sum + (n.totalCents - n.paidCents), 0);
        const settledAt = new Date();

        const auditEntries: { entityId: string; payload: Record<string, unknown> }[] = [];

        const result = await this.prisma.$transaction(async (tx) => {
            const updatedNotes = [];
            let totalProcessedCents = 0;

            for (const note of notes) {
                if (remainingAmount <= 0) break;

                const amountNeeded = note.totalCents - note.paidCents;
                const amountToApply = Math.min(amountNeeded, remainingAmount);

                const newPaidCents = note.paidCents + amountToApply;
                const isFullyPaid = newPaidCents >= note.totalCents;

                const updatedNote = await tx.creditNote.update({
                    where: { id: note.id },
                    data: {
                        paidCents: newPaidCents,
                        ...(isFullyPaid ? {
                            status: CreditNoteStatus.PAID,
                            settledAt,
                            settledById: actorUserId,
                            settledPaymentMethod: dto.paymentMethod,
                        } : {})
                    },
                });

                if (isFullyPaid) {
                    await tx.order.update({
                        where: { id: note.orderId },
                        data: {
                            paidAt: note.order.paidAt ?? settledAt,
                        },
                    });
                }

                updatedNotes.push(updatedNote);

                await tx.cashMovement.create({
                    data: {
                        cashSessionId: openSession.id,
                        type: CashMovementType.SALE,
                        amountCents: amountToApply,
                        method: dto.paymentMethod,
                        referenceOrderId: note.orderId,
                    },
                });

                auditEntries.push({
                    entityId: note.id,
                    payload: {
                        orderId: note.orderId,
                        amountAppliedCents: amountToApply,
                        newPaidCents,
                        paymentMethod: dto.paymentMethod,
                        isFullyPaid,
                    },
                });

                remainingAmount -= amountToApply;
                totalProcessedCents += amountToApply;
            }

            return {
                processedCount: updatedNotes.length,
                totalProcessedCents,
                notes: updatedNotes,
            };
        });

        for (const entry of auditEntries) {
            await this.audit.log(actorUserId, 'CREDIT_NOTE_PARTIAL_SETTLED', 'CreditNote', entry.entityId, entry.payload);
        }

        return result;
    }

    private buildSearchWhere(search?: string): Prisma.CreditNoteWhereInput {
        const term = search?.trim();
        if (!term) {
            return {};
        }

        return {
            OR: [
                { orderId: { contains: term } },
                { customerName: { contains: term } },
                { customerPhone: { contains: term } },
                { customerUser: { is: { name: { contains: term } } } },
                { customerUser: { is: { email: { contains: term } } } },
                { createdBy: { is: { name: { contains: term } } } },
            ],
        };
    }
}
