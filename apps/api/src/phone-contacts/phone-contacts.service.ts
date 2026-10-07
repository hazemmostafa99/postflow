import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parseDigits, parsePhoneNumber } from 'libphonenumber-js/max';
import {
  LEAD_QUALIFICATION_STATUSES,
  LeadQualificationStatus,
  MAX_LEAD_NOTES_LENGTH,
  PhoneContact,
  PhoneContactDocument,
  PhoneContactSource,
} from '../schemas/phone-contact.schema';

const MAX_PHONE_SYNC_BATCH_SIZE = 500;

interface ListPhoneContactsOptions {
  search?: string;
  category?: string;
  group?: string;
  qualificationStatus?: string;
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
  )
    .join('')
    .trim()
    .replace(/^00(?=\d)/, '+');

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

// Normalizes a user-facing category while keeping labels small and searchable.
function normalizeCategory(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Category must be text.');
  }
  const category = value.trim().replace(/\s+/g, ' ');
  if (!category) return undefined;
  if (category.length > 80) {
    throw new BadRequestException(
      'Category may contain at most 80 characters.',
    );
  }
  return category;
}

// Groups are optional free-text labels independent from the contact category.
// An explicit empty string clears an existing group.
export function normalizeGroup(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException('Group must be text.');
  }
  const group = value.trim().replace(/\s+/g, ' ');
  if (group.length > 80) {
    throw new BadRequestException('Group may contain at most 80 characters.');
  }
  return group;
}

// Accepts only the three supported board states; undefined means "not supplied".
export function normalizeQualificationStatus(
  value: unknown,
): LeadQualificationStatus | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    !LEAD_QUALIFICATION_STATUSES.includes(value as LeadQualificationStatus)
  ) {
    throw new BadRequestException(
      'Qualification status must be UNREVIEWED, QUALIFIED, or NOT_QUALIFIED.',
    );
  }
  return value as LeadQualificationStatus;
}

// Normalizes plain-text notes and enforces the shared length limit.
// An explicitly supplied empty string clears the stored notes.
export function normalizeNotes(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Notes must be text.');
  }
  const notes = value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (notes.length > MAX_LEAD_NOTES_LENGTH) {
    throw new BadRequestException(
      `Notes may contain at most ${MAX_LEAD_NOTES_LENGTH} characters.`,
    );
  }
  return notes;
}

// Contacts stored before qualification existed read as unreviewed, never rejected.
export function resolveQualificationStatus(
  value: unknown,
): LeadQualificationStatus {
  return LEAD_QUALIFICATION_STATUSES.includes(value as LeadQualificationStatus)
    ? (value as LeadQualificationStatus)
    : 'UNREVIEWED';
}

// Missing legacy notes read as an empty string instead of undefined.
export function resolveNotes(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Missing legacy groups read as ungrouped without altering their category.
export function resolveGroup(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Mongoose filter for one status; UNREVIEWED also matches legacy records that
// predate the qualificationStatus field so they are never silently rejected.
function buildStatusFilter(
  status: LeadQualificationStatus,
): Record<string, unknown> {
  if (status === 'UNREVIEWED') {
    return {
      $or: [
        { qualificationStatus: 'UNREVIEWED' },
        { qualificationStatus: { $exists: false } },
        { qualificationStatus: null },
        { qualificationStatus: '' },
      ],
    };
  }
  return { qualificationStatus: status };
}

function normalizeContactId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Phone contact was not found.');
  }
  return new Types.ObjectId(id);
}

function isDuplicateKeyError(error: unknown): boolean {
  return isRecord(error) && error.code === 11000;
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
  if (
    typeof sourceUrl !== 'string' ||
    !sourceUrl.trim() ||
    sourceUrl.length > 2048
  ) {
    throw new BadRequestException('Source URL must be a valid web address.');
  }

  let url: URL;
  try {
    url = new URL(sourceUrl.trim());
  } catch {
    throw new BadRequestException('Source URL must be a valid web address.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new BadRequestException('Source URL must use HTTP or HTTPS.');
  }
  url.hash = '';

  return { type: sourceType, url: url.href };
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
    const requestedPage = Number.isSafeInteger(options.page)
      ? Math.floor(options.page!)
      : 1;
    const requestedLimit = Number.isSafeInteger(options.limit)
      ? Math.floor(options.limit!)
      : 20;
    const requestedPageNumber = Math.max(1, requestedPage);
    const limit = Math.min(100, Math.max(1, requestedLimit));
    const search = options.search?.trim().slice(0, 128);
    const category = options.category?.trim().slice(0, 80);
    const group = options.group?.trim().slice(0, 80);
    const escapedSearch = search?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const categoryFilter =
      category === 'Uncategorized'
        ? {
            $or: [
              { category: 'Uncategorized' },
              { category: { $exists: false } },
              { category: '' },
            ],
          }
        : category
          ? { category }
          : undefined;
    const groupFilter =
      group === 'Ungrouped'
        ? {
            $or: [
              { group: 'Ungrouped' },
              { group: { $exists: false } },
              { group: null },
              { group: '' },
            ],
          }
        : group
          ? { group }
          : undefined;
    const qualificationStatus = normalizeQualificationStatus(
      options.qualificationStatus,
    );
    const statusFilter = qualificationStatus
      ? buildStatusFilter(qualificationStatus)
      : undefined;
    const baseFilters = [
      ...(escapedSearch
        ? [
            {
              $or: [
                { normalizedNumber: { $regex: escapedSearch, $options: 'i' } },
                { category: { $regex: escapedSearch, $options: 'i' } },
                { group: { $regex: escapedSearch, $options: 'i' } },
              ],
            },
          ]
        : []),
      ...(categoryFilter ? [categoryFilter] : []),
      ...(groupFilter ? [groupFilter] : []),
    ];
    const filter = {
      clerkUserId,
      ...(baseFilters.length || statusFilter
        ? { $and: [...baseFilters, ...(statusFilter ? [statusFilter] : [])] }
        : {}),
    };
    // Counts for each status reflect the active search/group filters so a
    // column can show its total even while a different column is paginated.
    const countFilterForStatus = (status: LeadQualificationStatus) => ({
      clerkUserId,
      ...(baseFilters.length
        ? { $and: [...baseFilters, buildStatusFilter(status)] }
        : buildStatusFilter(status)),
    });

    const [
      total,
      storedCategories,
      uncategorizedCount,
      storedGroups,
      ungroupedCount,
      unreviewed,
      qualified,
      notQualified,
    ] = await Promise.all([
      this.phoneContactModel.countDocuments(filter),
      this.phoneContactModel.distinct('category', { clerkUserId }).exec(),
      this.phoneContactModel.countDocuments({
        clerkUserId,
        $or: [
          { category: { $exists: false } },
          { category: '' },
          { category: 'Uncategorized' },
        ],
      }),
      this.phoneContactModel.distinct('group', { clerkUserId }).exec(),
      this.phoneContactModel.countDocuments({
        clerkUserId,
        $or: [
          { group: { $exists: false } },
          { group: null },
          { group: '' },
          { group: 'Ungrouped' },
        ],
      }),
      this.phoneContactModel.countDocuments(countFilterForStatus('UNREVIEWED')),
      this.phoneContactModel.countDocuments(countFilterForStatus('QUALIFIED')),
      this.phoneContactModel.countDocuments(
        countFilterForStatus('NOT_QUALIFIED'),
      ),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPageNumber, totalPages);
    const contacts = await this.phoneContactModel
      .find(filter)
      .select(
        '_id normalizedNumber category group qualificationStatus notes source createdAt lastSeenAt',
      )
      .sort({ lastSeenAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec();

    return {
      contacts: contacts.map((contact) => ({
        ...contact,
        _id: contact._id.toString(),
        qualificationStatus: resolveQualificationStatus(
          contact.qualificationStatus,
        ),
        notes: resolveNotes(contact.notes),
        group: resolveGroup(contact.group),
      })),
      categories: Array.from(
        new Set([
          ...storedCategories.filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value.trim()),
          ),
          ...(uncategorizedCount > 0 ? ['Uncategorized'] : []),
        ]),
      ).sort((left, right) => left.localeCompare(right)),
      groups: Array.from(
        new Set([
          ...storedGroups.filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value.trim()),
          ),
          ...(ungroupedCount > 0 ? ['Ungrouped'] : []),
        ]),
      ).sort((left, right) => left.localeCompare(right)),
      statusCounts: {
        UNREVIEWED: unreviewed,
        QUALIFIED: qualified,
        NOT_QUALIFIED: notQualified,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /** Creates one manually entered dashboard contact. */
  async createPhoneContact(clerkUserId: string, payload: unknown) {
    if (!isRecord(payload)) {
      throw new BadRequestException('A phone contact is required.');
    }
    const normalizedNumber = normalizePhoneNumber(payload.number);
    if (!normalizedNumber) {
      throw new BadRequestException('Enter a valid phone number.');
    }
    const category = normalizeCategory(payload.category) ?? 'Uncategorized';
    const group = normalizeGroup(payload.group) ?? '';
    const qualificationStatus =
      normalizeQualificationStatus(payload.qualificationStatus) ?? 'UNREVIEWED';
    const notes = normalizeNotes(payload.notes) ?? '';

    try {
      const contact = await this.phoneContactModel.create({
        clerkUserId,
        normalizedNumber,
        category,
        group,
        source: { type: 'manual' },
        lastSeenAt: new Date(),
        qualificationStatus,
        notes,
      });
      return {
        _id: contact._id.toString(),
        normalizedNumber: contact.normalizedNumber,
        category: contact.category,
        group: resolveGroup(contact.group),
        qualificationStatus: resolveQualificationStatus(
          contact.qualificationStatus,
        ),
        notes: resolveNotes(contact.notes),
        source: contact.source,
        lastSeenAt: contact.lastSeenAt,
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This phone number already exists.');
      }
      throw error;
    }
  }

  /** Partially updates one user-owned contact. */
  async updatePhoneContact(clerkUserId: string, id: string, payload: unknown) {
    if (!isRecord(payload)) {
      throw new BadRequestException('Phone contact changes are required.');
    }

    // Only fields present with a non-null value are treated as supplied, so a
    // status-only quick action cannot wipe unrelated lead fields.
    const supplied = (field: string) =>
      Object.prototype.hasOwnProperty.call(payload, field) &&
      payload[field] !== undefined &&
      payload[field] !== null;

    const updates: Record<string, unknown> = {};
    if (supplied('number')) {
      const normalizedNumber = normalizePhoneNumber(payload.number);
      if (!normalizedNumber) {
        throw new BadRequestException('Enter a valid phone number.');
      }
      updates.normalizedNumber = normalizedNumber;
    }
    if (supplied('category')) {
      updates.category = normalizeCategory(payload.category) ?? 'Uncategorized';
    }
    if (supplied('group')) {
      updates.group = normalizeGroup(payload.group) ?? '';
    }
    if (supplied('qualificationStatus')) {
      updates.qualificationStatus = normalizeQualificationStatus(
        payload.qualificationStatus,
      );
      if (!updates.qualificationStatus) {
        throw new BadRequestException(
          'Qualification status must be UNREVIEWED, QUALIFIED, or NOT_QUALIFIED.',
        );
      }
    }
    if (supplied('notes')) {
      updates.notes = normalizeNotes(payload.notes) ?? '';
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('Phone contact changes are required.');
    }

    try {
      const contact = await this.phoneContactModel
        .findOneAndUpdate(
          { _id: normalizeContactId(id), clerkUserId },
          { $set: updates },
          { new: true, runValidators: true },
        )
        .select(
          '_id normalizedNumber category group qualificationStatus notes source createdAt lastSeenAt',
        )
        .lean()
        .exec();
      if (!contact) throw new NotFoundException('Phone contact was not found.');
      return {
        ...contact,
        _id: contact._id.toString(),
        qualificationStatus: resolveQualificationStatus(
          contact.qualificationStatus,
        ),
        notes: resolveNotes(contact.notes),
        group: resolveGroup(contact.group),
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This phone number already exists.');
      }
      throw error;
    }
  }

  /** Deletes one contact without allowing cross-user access. */
  async deletePhoneContact(clerkUserId: string, id: string): Promise<void> {
    const result = await this.phoneContactModel.deleteOne({
      _id: normalizeContactId(id),
      clerkUserId,
    });
    if (!result.deletedCount) {
      throw new NotFoundException('Phone contact was not found.');
    }
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
    const category = normalizeCategory(payload.category);
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
            $set: { source, ...(category ? { category } : {}), lastSeenAt },
            $setOnInsert: {
              clerkUserId,
              normalizedNumber,
              ...(!category ? { category: 'Uncategorized' } : {}),
              group: '',
              // New sync leads start unreviewed and ungrouped; existing leads
              // keep their group, status, and notes because they are never
              // $set here.
              qualificationStatus: 'UNREVIEWED' as const,
              notes: '',
            },
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
