import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PhoneContactsService } from './phone-contacts.service';

@Controller('api/phone-contacts')
export class PhoneContactsController {
  constructor(private readonly phoneContactsService: PhoneContactsService) {}

  /** Lists the signed-in user's saved leads with optional number search and pagination. */
  @Get()
  async list(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const normalizedUserId = clerkUserId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    return this.phoneContactsService.listPhoneContacts(normalizedUserId, {
      search,
      category,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Adds a phone contact manually from the dashboard. */
  @Post()
  async create(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Body() body: unknown,
  ) {
    const normalizedUserId = clerkUserId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    return this.phoneContactsService.createPhoneContact(normalizedUserId, body);
  }

  /** Updates a user-owned phone contact. */
  @Patch(':id')
  async update(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const normalizedUserId = clerkUserId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    return this.phoneContactsService.updatePhoneContact(
      normalizedUserId,
      id,
      body,
    );
  }

  /** Deletes a user-owned phone contact. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Param('id') id: string,
  ) {
    const normalizedUserId = clerkUserId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    await this.phoneContactsService.deletePhoneContact(normalizedUserId, id);
  }

  /** Accepts an explicit extension submission and syncs its numbers for the user. */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Body() body: unknown,
  ) {
    const normalizedUserId = clerkUserId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A phone sync request body is required.');
    }
    return this.phoneContactsService.syncPhoneNumbers(normalizedUserId, body);
  }
}
