import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExtensionsService } from './extensions.service';
import { ExtensionsController } from './extensions.controller';
import { ExtensionInstallation, ExtensionInstallationSchema } from '../schemas/extension-installation.schema';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExtensionInstallation.name, schema: ExtensionInstallationSchema },
      { name: User.name, schema: UserSchema },
    ])
  ],
  providers: [ExtensionsService],
  controllers: [ExtensionsController]
})
export class ExtensionsModule {}
