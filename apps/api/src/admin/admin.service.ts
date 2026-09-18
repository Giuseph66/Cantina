import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import {
    CreateCategoryDto,
    UpdateCategoryDto,
    CreateProductDto,
    UpdateProductDto,
    UpdateSettingsDto,
    UpdateOrderStatusDto,
    BulkStockUpdateDto,
} from './dto/admin.dto';
import { OrderStatus, StockMode } from '../common/enums';
import { UploadsService } from '../uploads/uploads.service';
import { AppSettings, AppSettingsService } from '../common/services/app-settings.service';
import { BackupsService } from '../backups/backups.service';

@Injectable()
export class AdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly uploadsService: UploadsService,
        private readonly appSettings: AppSettingsService,
        private readonly backupsService: BackupsService,
    ) { }

    // ─── Categories ────────────────────────────────────────────────────────────
    async createCategory(dto: CreateCategoryDto, actorId: string) {
        const cat = await this.prisma.category.create({ data: dto });
        await this.audit.log(actorId, 'CATEGORY_CREATED', 'Category', cat.id, { name: cat.name });
        return cat;
    }

    async updateCategory(id: string, dto: UpdateCategoryDto, actorId: string) {
        const cat = await this.prisma.category.update({ where: { id }, data: dto });
        await this.audit.log(actorId, 'CATEGORY_UPDATED', 'Category', id, dto as Record<string, unknown>);
        return cat;
    }

    async deleteCategory(id: string, actorId: string) {
        const cat = await this.prisma.category.delete({ where: { id } });
        await this.audit.log(actorId, 'CATEGORY_DELETED', 'Category', id, { name: cat.name });
        return cat;
    }

    async getCategories() {
        return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    }

    // ─── Products ──────────────────────────────────────────────────────────────
    async createProduct(dto: CreateProductDto, actorId: string) {
        const data = this.normalizeProductDto(dto);
        const product = await this.prisma.product.create({ data });
        await this.audit.log(actorId, 'PRODUCT_CREATED', 'Product', product.id, {
            name: product.name,
            priceCents: product.priceCents,
        });
        return product;
    }

    async updateProduct(id: string, dto: UpdateProductDto, actorId: string) {
        const data = this.normalizeProductDto(dto);
        const currentProduct = await this.prisma.product.findUnique({
            where: { id },
            select: { imageUrl: true },
        });

        const product = await this.prisma.product.update({ where: { id }, data });

        if (data.imageUrl && currentProduct?.imageUrl && currentProduct.imageUrl !== data.imageUrl) {
            this.uploadsService.deleteFileByUrl(currentProduct.imageUrl);
        }

        await this.audit.log(actorId, 'PRODUCT_UPDATED', 'Product', id, data as Record<string, unknown>);
        return product;
    }

    async deleteProduct(id: string, actorId: string) {
        const current = await this.prisma.product.findUnique({
            where: { id },
            select: { id: true, name: true, isActive: true, imageUrl: true },
        });

        if (!current) {
            throw new NotFoundException('Produto não encontrado.');
        }

        if (current.isActive) {
            const product = await this.prisma.product.update({
                where: { id },
                data: { isActive: false },
            });
            await this.audit.log(actorId, 'PRODUCT_DEACTIVATED', 'Product', id, { name: product.name });
            return product;
        }

        const relatedOrderItems = await this.prisma.orderItem.count({ where: { productId: id } });
        if (relatedOrderItems > 0) {
            throw new ConflictException('Produto inativo com histórico de pedidos não pode ser excluído definitivamente.');
        }

        const deleted = await this.prisma.product.delete({ where: { id } });

        if (deleted.imageUrl) {
            this.uploadsService.deleteFileByUrl(deleted.imageUrl);
        }

        await this.audit.log(actorId, 'PRODUCT_DELETED', 'Product', id, { name: deleted.name });
        return deleted;
    }

    async updateStockBulk(dto: BulkStockUpdateDto, actorId: string) {
        const results = await Promise.all(
            dto.items.map(async item => {
                return this.prisma.product.update({
                    where: { id: item.productId },
                    data: {
                        stockQty: dto.isAbsolute ? item.qty : { increment: item.qty }
                    },
                });
            })
        );
        await this.audit.log(actorId, 'PRODUCT_STOCK_BULK_UPDATED', 'Product', 'bulk', { 
            isAbsolute: dto.isAbsolute,
            count: dto.items.length 
        });
        return results;
    }

    async getProducts() {
        const products = await this.prisma.product.findMany({
            include: {
                category: true,
                _count: { select: { orderItems: true } },
            },
            orderBy: { name: 'asc' },
        });

        return products.map(product => ({
            id: product.id,
            name: product.name,
            description: product.description,
            priceCents: product.priceCents,
            categoryId: product.categoryId,
            imageUrl: this.uploadsService.normalizePublicUrl(product.imageUrl),
            isSpecialToday: product.isSpecialToday,
            weeklySpecialDay: product.weeklySpecialDay,
            isActive: product.isActive,
            stockMode: product.stockMode,
            stockQty: product.stockQty,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt,
            category: product.category,
            hasOrderHistory: product._count.orderItems > 0,
        }));
    }

    // ─── Orders ────────────────────────────────────────────────────────────────
    async getOrders(status?: OrderStatus, dateFrom?: string, dateTo?: string) {
        const where = {
            ...(status ? { status } : {}),
            ...this.buildOrdersDateFilter(dateFrom, dateTo),
        };

        return this.prisma.order.findMany({
            where,
            include: {
                user: { select: { id: true, name: true, email: true } },
                items: {
                    select: {
                        id: true,
                        productId: true,
                        productName: true,
                        qty: true,
                        unitPriceCents: true,
                        subtotalCents: true,
                        product: { select: { id: true, name: true, imageUrl: true } },
                    },
                },
                ticket: { select: { id: true, codeShort: true, consumedAt: true, expiresAt: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
    }

    async updateOrderStatus(id: string, dto: UpdateOrderStatusDto, actorId: string) {
        const current = await this.prisma.order.findUnique({
            where: { id },
            include: { items: true },
        });

        if (!current) {
            throw new NotFoundException('Pedido não encontrado.');
        }

        const isClosed = (status: OrderStatus) => status === OrderStatus.CANCELLED || status === OrderStatus.EXPIRED;
        const shouldRestock = isClosed(dto.status) && !isClosed(current.status as OrderStatus);

        const order = await this.prisma.$transaction(async (tx) => {
            if (shouldRestock) {
                for (const item of current.items) {
                    const product = await tx.product.findUnique({ where: { id: item.productId } });
                    if (product?.stockMode === StockMode.CONTROLLED) {
                        await tx.product.update({
                            where: { id: item.productId },
                            data: { stockQty: { increment: item.qty } },
                        });
                    }
                }
            }

            return tx.order.update({
                where: { id },
                data: { status: dto.status },
            });
        });

        await this.audit.log(actorId, 'ORDER_STATUS_UPDATED', 'Order', id, { status: dto.status, restocked: shouldRestock });
        return order;
    }

    // ─── Audit ─────────────────────────────────────────────────────────────────
    async getAuditLogs(limit = 100, offset = 0, action?: string) {
        const where = action ? { action } : {};
        const [logs, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset,
                include: {
                    actor: { select: { id: true, name: true, role: true } },
                },
            }),
            this.prisma.auditLog.count({ where }),
        ]);
        return {
            logs: logs.map(log => ({
                ...log,
                payloadJson: log.payloadJson ? JSON.parse(log.payloadJson as string) : {},
            })),
            total,
        };
    }

    // ─── Backups ───────────────────────────────────────────────────────────────
    async listBackups() {
        return this.backupsService.listBackups(30);
    }

    async runBackup(actorId: string) {
        const result = await this.backupsService.createBackup('manual');
        await this.audit.log(actorId, 'BACKUP_CREATED', 'Backup', result.id, result as Record<string, unknown>);
        return result;
    }

    getBackupProgress() {
        return this.backupsService.getOperationProgress();
    }

    async restoreBackup(backupId: string, actorId: string) {
        const result = await this.backupsService.restoreBackup(backupId);
        await this.audit.log(actorId, 'BACKUP_RESTORED', 'Backup', backupId, result as Record<string, unknown>);
        return result;
    }

    // ─── Settings ──────────────────────────────────────────────────────────────
    getSettings(): AppSettings {
        return this.appSettings.getSettings();
    }

    updateSettings(dto: UpdateSettingsDto, actorId: string) {
        const updated = this.appSettings.updateSettings(dto);
        void this.audit.log(actorId, 'SETTINGS_UPDATED', 'Settings', null, dto as Record<string, unknown>);
        return updated;
    }

    private normalizeProductDto<T extends CreateProductDto | UpdateProductDto>(dto: T): T {
        return {
            ...dto,
            imageUrl: this.uploadsService.normalizePublicUrl(dto.imageUrl) ?? undefined,
        };
    }

    private buildOrdersDateFilter(dateFrom?: string, dateTo?: string) {
        const from = this.parseDateBoundary(dateFrom, 'start');
        const to = this.parseDateBoundary(dateTo, 'end');

        if (!from && !to) {
            return {};
        }

        return {
            createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
            },
        };
    }

    private parseDateBoundary(value: string | undefined, mode: 'start' | 'end') {
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return null;
        }

        const [yearStr, monthStr, dayStr] = value.split('-');
        const year = Number.parseInt(yearStr, 10);
        const month = Number.parseInt(monthStr, 10);
        const day = Number.parseInt(dayStr, 10);

        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
            return null;
        }

        return mode === 'start'
            ? new Date(year, month - 1, day, 0, 0, 0, 0)
            : new Date(year, month - 1, day, 23, 59, 59, 999);
    }
}
