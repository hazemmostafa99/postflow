import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { isIndividualSalesUser } from '../sales-subscriptions/sales-subscription-policy';
import { SalesSubscriptionsService } from '../sales-subscriptions/sales-subscriptions.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly salesSubscriptions: SalesSubscriptionsService,
  ) {}

  @Get('me')
  async me(
    @Headers('x-clerk-user-id') clerkUserId: string,
    @Headers('x-clerk-user-email') email?: string,
    @Headers('x-clerk-user-first-name') firstName?: string,
    @Headers('x-clerk-user-last-name') lastName?: string,
  ) {
    if (!clerkUserId)
      throw new UnauthorizedException('x-clerk-user-id header is required');
    const user = await this.authorization.requireOrProvisionActiveUser(
      clerkUserId,
      email,
      { firstName, lastName },
    );
    const isIndividualSales = isIndividualSalesUser(user);
    const subscription = isIndividualSales
      ? await this.salesSubscriptions.ensureTrial(clerkUserId)
      : null;

    return {
      id: user._id.toString(),
      clerkUserId: user.clerkUserId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      teamId: user.teamId ?? null,
      accountType: isIndividualSales ? 'INDIVIDUAL_SALES' : 'COMPANY_MANAGED',
      subscription,
    };
  }
}
