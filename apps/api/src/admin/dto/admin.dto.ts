import {
    IsString, IsInt, IsBoolean, IsOptional, IsEnum, IsNumber, IsUUID, Min, Max, MaxLength, Matches, IsIn,
    ValidateNested, IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StockMode, OrderStatus } from '../../common/enums';
import type { TicketValidityMode } from '../../common/services/app-settings.service';

const PRODUCT_IMAGE_URL_PATTERN = /^(https?:\/\/\S+|\/uploads\/\S+)$/;

export class UpdateOrderStatusDto {
    @IsEnum(OrderStatus)
    status: OrderStatus;
}

export class CreateCategoryDto {
    @IsString()
    @MaxLength(100)
    name: string;

    @IsInt()
    @IsOptional()
    sortOrder?: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}

export class UpdateCategoryDto {
    @IsString()
    @MaxLength(100)
    @IsOptional()
    name?: string;

    @IsInt()
    @IsOptional()
    sortOrder?: number;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}

export class CreateProductDto {
    @IsString()
    @MaxLength(200)
    name: string;

    @IsString()
    @MaxLength(1000)
    @IsOptional()
    description?: string;

    @IsInt()
    @Min(1)
    priceCents: number;

    @IsUUID()
    categoryId: string;

    @MaxLength(2048)
    @Matches(PRODUCT_IMAGE_URL_PATTERN)
    @IsOptional()
    imageUrl?: string;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @IsEnum(StockMode)
    @IsOptional()
    stockMode?: StockMode;

    @IsInt()
    @IsOptional()
    stockQty?: number;

    @IsBoolean()
    @IsOptional()
    isSpecialToday?: boolean;

    @IsInt()
    @Min(0)
    @Max(6)
    @IsOptional()
    weeklySpecialDay?: number | null;
}

export class UpdateProductDto {
    @IsString()
    @MaxLength(200)
    @IsOptional()
    name?: string;

    @IsString()
    @MaxLength(1000)
    @IsOptional()
    description?: string;

    @IsInt()
    @Min(1)
    @IsOptional()
    priceCents?: number;

    @IsUUID()
    @IsOptional()
    categoryId?: string;

    @MaxLength(2048)
    @Matches(PRODUCT_IMAGE_URL_PATTERN)
    @IsOptional()
    imageUrl?: string;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @IsEnum(StockMode)
    @IsOptional()
    stockMode?: StockMode;

    @IsNumber()
    @IsOptional()
    stockQty?: number;

    @IsBoolean()
    @IsOptional()
    isSpecialToday?: boolean;

    @IsInt()
    @Min(0)
    @Max(6)
    @IsOptional()
    weeklySpecialDay?: number | null;
}

export class UpdateSettingsDto {
    @IsInt()
    @Min(1)
    @Max(1440)
    @IsOptional()
    ticketWindowMinutes?: number;

    @IsIn(['DURATION', 'UNTIL_TIME'])
    @IsOptional()
    ticketValidityMode?: TicketValidityMode;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    @IsOptional()
    ticketValidUntilTime?: string | null;

    @IsString()
    @MaxLength(500)
    @IsOptional()
    bannerMessage?: string;

    @IsString()
    @MaxLength(5)
    @IsOptional()
    openTime?: string; // HH:mm

    @IsString()
    @MaxLength(5)
    @IsOptional()
    closeTime?: string; // HH:mm

    @IsBoolean()
    @IsOptional()
    allowReconfirmPickup?: boolean;

    @IsBoolean()
    @IsOptional()
    allowOnPickupPayment?: boolean;

    @IsString()
    @MaxLength(200)
    @IsOptional()
    pixKey?: string;

    @IsBoolean()
    @IsOptional()
    allowCredit?: boolean;

    @IsString()
    @MaxLength(1000)
    @IsOptional()
    notificationEmails?: string;
}
export class BulkStockItemDto {
    @IsUUID()
    productId: string;

    @IsInt()
    qty: number;
}

export class BulkStockUpdateDto {
    @IsOptional()
    @IsBoolean()
    isAbsolute?: boolean;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BulkStockItemDto)
    items: BulkStockItemDto[];
}
