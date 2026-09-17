import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthorizationService } from './authorization.service';
import { User, UserSchema } from '../schemas/user.schema';
import { Invitation, InvitationSchema } from '../schemas/invitation.schema';
import { Team, TeamSchema } from '../schemas/team.schema';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: Team.name, schema: TeamSchema },
    ]),
  ],
  providers: [AuthorizationService],
  controllers: [AuthController],
  exports: [AuthorizationService],
})
export class AuthModule {}
