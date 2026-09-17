import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User, UserSchema } from './schemas/user.schema';
import { ExtensionInstallation, ExtensionInstallationSchema } from './schemas/extension-installation.schema';
import { Group, GroupSchema } from './schemas/group.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { PublishingJob, PublishingJobSchema } from './schemas/publishing-job.schema';
import { ExtensionsModule } from './extensions/extensions.module';
import { GroupsModule } from './groups/groups.module';
import { PostsModule } from './posts/posts.module';
import { Team, TeamSchema } from './schemas/team.schema';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TeamsModule } from './teams/teams.module';
import { InvitationsModule } from './invitations/invitations.module';

const envFilePath = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
  resolve(__dirname, '..', '.env'),
  resolve(__dirname, '..', '..', '.env'),
].filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index);

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath, isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('DATABASE_URL'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ExtensionInstallation.name, schema: ExtensionInstallationSchema },
      { name: Group.name, schema: GroupSchema },
      { name: Post.name, schema: PostSchema },
      { name: PublishingJob.name, schema: PublishingJobSchema },
      { name: Team.name, schema: TeamSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    ExtensionsModule,
    GroupsModule,
    PostsModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    InvitationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
