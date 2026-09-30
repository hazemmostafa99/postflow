import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PhoneContact,
  PhoneContactSchema,
} from '../schemas/phone-contact.schema';
import { PhoneContactsController } from './phone-contacts.controller';
import { PhoneContactsService } from './phone-contacts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PhoneContact.name, schema: PhoneContactSchema },
    ]),
  ],
  providers: [PhoneContactsService],
  controllers: [PhoneContactsController],
})
export class PhoneContactsModule {}
