import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Team, TeamSchema } from '../schemas/team.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Team.name, schema: TeamSchema }, { name: User.name, schema: UserSchema }])],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
