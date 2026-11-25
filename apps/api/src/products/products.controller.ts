import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IfMatchVersion } from '../common/if-match';
import {
  type AuthUser,
  CurrentOrg,
  CurrentUser,
  type OrgContext,
  RequireOrg,
} from '../common/request-context';
import { ZodBody } from '../common/zod';
import {
  type CreateProductInput,
  createProductSchema,
  type SetEmployeeProductsInput,
  setEmployeeProductsSchema,
  type UpdateProductInput,
  updateProductSchema,
} from './products.schemas';
import { MAX_PRODUCT_IMAGE_BYTES, ProductsService } from './products.service';
import {
  type ProductOrderInput,
  productOrderSchema,
  type ProductTypeInput,
  productTypeSchema,
  type SetProductPriceInput,
  setProductPriceSchema,
} from './products.schemas';

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post('product-images')
  @HttpCode(201)
  @RequireOrg('products.manage')
  @UseInterceptors(
    // Larger files are cut off by the upload parser and answered with 413.
    FileInterceptor('file', { limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 } }),
  )
  uploadImage(
    @CurrentOrg() org: OrgContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.products.uploadImage(org, file);
  }

  @Get('products')
  @RequireOrg('products.manage')
  list(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.products.list(user, org);
  }

  @Get('products/:id')
  @RequireOrg('products.manage')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.get(user, org, id);
  }

  @Post('products')
  @RequireOrg('products.manage')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(createProductSchema) body: CreateProductInput,
  ) {
    return this.products.create(user, org, body);
  }

  @Patch('products/:id')
  @RequireOrg('products.manage')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @IfMatchVersion() version: number,
    @ZodBody(updateProductSchema) body: UpdateProductInput,
  ) {
    return this.products.update(user, org, id, version, body);
  }

  /** Any member may ask; the service allows an employee only their own list. */
  @Get('employees/:id/products')
  @RequireOrg()
  employeeProducts(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.employeeProducts(user, org, id);
  }

  /** F-001 FIN-1: price per unit in whole won; applies from now on. */
  @Put('products/:id/price')
  @RequireOrg('prices.manage')
  setPrice(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(setProductPriceSchema) body: SetProductPriceInput,
  ) {
    return this.products.setPrice(user, org, id, body.unitPrice);
  }

  @Get('products/:id/prices')
  @RequireOrg('prices.manage')
  prices(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.prices(user, org, id);
  }

  @Put('employees/:id/products')
  @RequireOrg('products.manage')
  setEmployeeProducts(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(setEmployeeProductsSchema) body: SetEmployeeProductsInput,
  ) {
    return this.products.setEmployeeProducts(user, org, id, body);
  }

  /** Decided 2026-11-30: product types (e.g. Meal, Bakery), made while adding or editing products. */
  @Get('product-types')
  @RequireOrg('products.manage')
  listTypes(@CurrentUser() user: AuthUser, @CurrentOrg() org: OrgContext) {
    return this.products.listTypes(user, org);
  }

  @Post('product-types')
  @RequireOrg('products.manage')
  createType(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(productTypeSchema) body: ProductTypeInput,
  ) {
    return this.products.createType(user, org, body);
  }

  @Patch('product-types/:id')
  @RequireOrg('products.manage')
  renameType(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(productTypeSchema) body: ProductTypeInput,
  ) {
    return this.products.renameType(user, org, id, body);
  }

  /** Decided 2026-11-30: the admin's custom product order (drag and drop on Products). */
  @Put('products/order')
  @RequireOrg('products.manage')
  setOrder(
    @CurrentUser() user: AuthUser,
    @CurrentOrg() org: OrgContext,
    @ZodBody(productOrderSchema) body: ProductOrderInput,
  ) {
    return this.products.setOrder(user, org, body);
  }
}
