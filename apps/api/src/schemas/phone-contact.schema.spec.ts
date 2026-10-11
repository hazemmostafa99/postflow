/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import 'reflect-metadata';

// The real @nestjs/mongoose ships ESM only, which Node 20 jest cannot
// require. Mock it with a minimal functional implementation so the schema
// is still built as a real mongoose Schema and exercised in-memory.
jest.mock('@nestjs/mongoose', () => {
  const mongoose = jest.requireActual('mongoose');

  const PROP_META = Symbol('phoneContactPropMeta');

  function Prop(options: Record<string, unknown> = {}) {
    return (target: object, propertyKey: string) => {
      const type =
        options.type ?? Reflect.getMetadata('design:type', target, propertyKey);
      const definition: Record<string, unknown> =
        (target.constructor as { [PROP_META]?: unknown })[PROP_META] ?? {};
      definition[propertyKey] = { ...options, type };
      Object.defineProperty(target.constructor, PROP_META, {
        value: definition,
        configurable: true,
      });
    };
  }

  function Schema(options?: Record<string, unknown>) {
    return (target: { __schemaOptions?: unknown }) => {
      target.__schemaOptions = options;
    };
  }

  const SchemaFactory = {
    createForClass(target: {
      [PROP_META]: Record<string, unknown> | undefined;
      __schemaOptions: Record<string, unknown> | undefined;
    }) {
      return new mongoose.Schema(
        target[PROP_META] ?? {},
        target.__schemaOptions,
      );
    },
  };

  return { Prop, Schema, SchemaFactory };
});

import mongoose from 'mongoose';
import {
  LEAD_QUALIFICATION_STATUSES,
  PhoneContactSchema,
} from './phone-contact.schema';

const PhoneContactModel = mongoose.model(
  'PhoneContactSchemaSpec',
  PhoneContactSchema,
);

const baseContact = {
  clerkUserId: 'user-1',
  normalizedNumber: '+201001234567',
  source: { type: 'manual' as const },
};

type SchemaIndexEntry = readonly [
  Record<string, number>,
  Record<string, unknown>,
];

describe('PhoneContact schema', () => {
  it('defaults new contacts to unreviewed with empty notes and group', async () => {
    const contact = new PhoneContactModel(baseContact);

    expect(contact.qualificationStatus).toBe('UNREVIEWED');
    expect(contact.notes).toBe('');
    expect(contact.group).toBe('');
    await expect(contact.validate()).resolves.toBeUndefined();
  });

  it('supports exactly the three board qualification states', async () => {
    for (const status of LEAD_QUALIFICATION_STATUSES) {
      const contact = new PhoneContactModel({
        ...baseContact,
        qualificationStatus: status,
      });
      expect(contact.qualificationStatus).toBe(status);
      await expect(contact.validate()).resolves.toBeUndefined();
    }
  });

  it('rejects an unsupported qualification status', async () => {
    const contact = new PhoneContactModel({
      ...baseContact,
      qualificationStatus: 'PENDING',
    });

    await expect(contact.validate()).rejects.toMatchObject({
      errors: expect.objectContaining({
        qualificationStatus: expect.anything(),
      }),
    });
  });

  it('accepts notes up to 2000 characters but rejects longer notes', async () => {
    const withinLimit = new PhoneContactModel({
      ...baseContact,
      notes: 'x'.repeat(2000),
    });
    const overLimit = new PhoneContactModel({
      ...baseContact,
      notes: 'x'.repeat(2001),
    });

    await expect(withinLimit.validate()).resolves.toBeUndefined();
    await expect(overLimit.validate()).rejects.toMatchObject({
      errors: expect.objectContaining({
        notes: expect.anything(),
      }),
    });
  });

  it('keeps the unique owner/number index', () => {
    const indexes =
      PhoneContactSchema.indexes() as unknown as SchemaIndexEntry[];
    const uniqueOwnerNumberIndex = indexes.find(
      ([keys]) => keys.normalizedNumber !== undefined,
    );

    expect(uniqueOwnerNumberIndex?.[0]).toEqual({
      clerkUserId: 1,
      normalizedNumber: 1,
    });
    expect(uniqueOwnerNumberIndex?.[1]).toMatchObject({ unique: true });
  });

  it('adds an owner/status/time index for board queries', () => {
    const indexes =
      PhoneContactSchema.indexes() as unknown as SchemaIndexEntry[];

    expect(indexes.map(([keys]) => keys)).toContainEqual({
      clerkUserId: 1,
      qualificationStatus: 1,
      lastSeenAt: -1,
    });
    expect(indexes.map(([keys]) => keys)).toContainEqual({
      clerkUserId: 1,
      group: 1,
      qualificationStatus: 1,
      lastSeenAt: -1,
    });
  });
});
