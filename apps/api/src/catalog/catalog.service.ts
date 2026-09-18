import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class CatalogService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly uploadsService: UploadsService,
    ) { }

    async getCategories() {
        return this.prisma.category.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
    }

    async getProducts(filters: { categoryId?: string; search?: string }) {
        const products = await this.prisma.product.findMany({
            where: {
                isActive: true,
                ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
                ...(filters.search
                    ? { name: { contains: filters.search } }
                    : {}),
            },
            include: { category: true },
            orderBy: [
                { isSpecialToday: 'desc' },
                { name: 'asc' },
            ],
        });

        const today = new Date().getDay();

        return products
            .map(product => {
                const isWeeklySpecialToday = product.weeklySpecialDay === today;
                const isWeeklySpecialPending = product.weeklySpecialDay !== null && !isWeeklySpecialToday;

                return {
                    ...product,
                    imageUrl: this.uploadsService.normalizePublicUrl(product.imageUrl),
                    isWeeklySpecialToday,
                    isWeeklySpecialPending,
                };
            })
            .sort((a, b) => {
                if (a.isWeeklySpecialPending !== b.isWeeklySpecialPending) {
                    return a.isWeeklySpecialPending ? 1 : -1;
                }
                return 0;
            });
    }

    async getProductById(id: string) {
        const product = await this.prisma.product.findFirst({
            where: { id, isActive: true },
            include: { category: true },
        });

        if (!product) return product;

        return {
            ...product,
            imageUrl: this.uploadsService.normalizePublicUrl(product.imageUrl),
        };
    }
}
