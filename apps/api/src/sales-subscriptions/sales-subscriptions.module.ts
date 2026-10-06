import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SalesSubscription,
  SalesSubscriptionSchema,
} from '../schemas/sales-subscription.schema';
import { SalesSubscriptionsService } from './sales-subscriptions.service';
import { SalesSubscriptionAccessGuard } from './sales-subscription-access.guard';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SalesSubscription.name, schema: SalesSubscriptionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [SalesSubscriptionsService, SalesSubscriptionAccessGuard],
  exports: [SalesSubscriptionsService, SalesSubscriptionAccessGuard],
})
export class SalesSubscriptionsModule {}
