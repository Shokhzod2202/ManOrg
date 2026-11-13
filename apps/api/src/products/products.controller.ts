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
}
