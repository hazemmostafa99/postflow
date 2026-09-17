import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Invitation, InvitationSchema } from '../schemas/invitation.schema';
import { Team, TeamSchema } from '../schemas/team.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { ClerkInvitationsService } from './clerk-invitations.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [AuthModule, UsersModule, MongooseModule.forFeature([
    { name: Invitation.name, schema: InvitationSchema },
    { name: Team.name, schema: TeamSchema },
    { name: User.name, schema: UserSchema },
  ])],
  controllers: [InvitationsController],
  providers: [ClerkInvitationsService, InvitationsService],
})
export class InvitationsModule {}
