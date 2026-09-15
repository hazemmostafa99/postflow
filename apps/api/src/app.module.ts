import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    ]),
    ExtensionsModule,
    GroupsModule,
    PostsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
