import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const normalizedUserId = clerkUserId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('x-clerk-user-id header is required');
    }
    return this.phoneContactsService.listPhoneContacts(normalizedUserId, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
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
