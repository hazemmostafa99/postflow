import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthorizationService } from './authorization.service';
import { User, UserSchema } from '../schemas/user.schema';
import { AuthController } from './auth.controller';
import { SalesSubscriptionsModule } from '../sales-subscriptions/sales-subscriptions.module';

@Module({
  imports: [
    SalesSubscriptionsModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [AuthorizationService],
  controllers: [AuthController],
  exports: [AuthorizationService],
})
export class AuthModule {}
