import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parseDigits, parsePhoneNumber } from 'libphonenumber-js/max';
import {
  PhoneContact,
  PhoneContactDocument,
  PhoneContactSource,
  PhoneContactSourceType,
} from '../schemas/phone-contact.schema';

const MAX_PHONE_SYNC_BATCH_SIZE = 500;

interface PhoneSyncRequest {
  numbers: unknown[];
  source: PhoneContactSource;
}

interface ListPhoneContactsOptions {
  search?: string;
  page?: number;
  limit?: number;
}

export interface PhoneSyncResult {
  submitted: number;
  valid: number;
  duplicates: number;
  invalid: number;
  added: number;
  alreadyExisted: number;
}

// Checks that untrusted request data is a plain object before reading its fields.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Converts one candidate to valid E.164 form; invalid input is not trusted or stored.
function normalizePhoneNumber(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    return undefined;
  }

  const normalizedInput = Array.from(value.normalize('NFKC'), (character) =>
    /\p{Nd}/u.test(character) ? parseDigits(character) : character,
  ).join('').trim().replace(/^00(?=\d)/, '+');

  try {
    const parsed = parsePhoneNumber(normalizedInput, {
      defaultCountry: 'EG',
      extract: false,
    });
    return parsed.isValid() ? parsed.number : undefined;
  } catch {
    return undefined;
  }
}

// Validates and canonicalizes source metadata while allowing only normal web URLs.
function normalizePhoneSource(value: unknown): PhoneContactSource {
  if (!isRecord(value)) {
    throw new BadRequestException('A source page is required.');
  }

  const sourceType = value.type;
  const sourceUrl = value.url;
  if (sourceType !== 'facebook' && sourceType !== 'generic') {
    throw new BadRequestException('Source type must be facebook or generic.');
  }
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim() || sourceUrl.length > 2048) {
    throw new BadRequestException('Source URL must be a valid web address.');
  }

  let url: URL;
  try {
    url = new URL(sourceUrl.trim());
  } catch {
    throw new BadRequestException('Source URL must be a valid web address.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new BadRequestException('Source URL must use HTTP or HTTPS.');
  }
  url.hash = '';

  return { type: sourceType as PhoneContactSourceType, url: url.href };
}

@Injectable()
export class PhoneContactsService {
  constructor(
    @InjectModel(PhoneContact.name)
    private readonly phoneContactModel: Model<PhoneContactDocument>,
  ) {}

  /** Lists only the caller's saved contacts, newest collected first. */
  async listPhoneContacts(
    clerkUserId: string,
    options: ListPhoneContactsOptions = {},
  ) {
    const requestedPage = Number.isSafeInteger(options.page) ? Math.floor(options.page!) : 1;
    const requestedLimit = Number.isSafeInteger(options.limit) ? Math.floor(options.limit!) : 20;
    const requestedPageNumber = Math.max(1, requestedPage);
    const limit = Math.min(100, Math.max(1, requestedLimit));
    const search = options.search?.trim().slice(0, 128);
    const escapedSearch = search?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      clerkUserId,
      ...(escapedSearch ? { normalizedNumber: { $regex: escapedSearch, $options: 'i' } } : {}),
    };

    const total = await this.phoneContactModel.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPageNumber, totalPages);
    const contacts = await this.phoneContactModel
      .find(filter)
      .select('_id normalizedNumber source createdAt lastSeenAt')
      .sort({ lastSeenAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec();

    return {
      contacts: contacts.map((contact) => ({ ...contact, _id: contact._id.toString() })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /** Validates, deduplicates, and idempotently stores one submitted phone batch. */
  async syncPhoneNumbers(
    clerkUserId: string,
    payload: unknown,
  ): Promise<PhoneSyncResult> {
    if (!isRecord(payload) || !Array.isArray(payload.numbers)) {
      throw new BadRequestException('Numbers must be provided as an array.');
    }
    if (payload.numbers.length > MAX_PHONE_SYNC_BATCH_SIZE) {
      throw new BadRequestException(
        `A sync batch may contain at most ${MAX_PHONE_SYNC_BATCH_SIZE} numbers.`,
      );
    }

    const source = normalizePhoneSource(payload.source);
    const uniqueNumbers = new Set<string>();
    let duplicates = 0;
    let invalid = 0;

    for (const candidate of payload.numbers) {
      const normalized = normalizePhoneNumber(candidate);
      if (!normalized) {
        invalid += 1;
      } else if (uniqueNumbers.has(normalized)) {
        duplicates += 1;
      } else {
        uniqueNumbers.add(normalized);
      }
    }

    const numbers = [...uniqueNumbers];
    let added = 0;
    if (numbers.length > 0) {
      const lastSeenAt = new Date();
      const operations = numbers.map((normalizedNumber) => ({
        updateOne: {
          filter: { clerkUserId, normalizedNumber },
          update: {
            $set: { source, lastSeenAt },
            $setOnInsert: { clerkUserId, normalizedNumber },
          },
          upsert: true,
        },
      }));
      const writeResult = await this.phoneContactModel.bulkWrite(operations, {
        ordered: false,
      });
      added = writeResult.upsertedCount;
    }

    return {
      submitted: payload.numbers.length,
      valid: numbers.length,
      duplicates,
      invalid,
      added,
      alreadyExisted: numbers.length - added,
    };
  }
}
