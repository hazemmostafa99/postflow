import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Group, GroupDocument } from '../schemas/group.schema';
import {
  PublishingJob,
  PublishingJobDocument,
} from '../schemas/publishing-job.schema';
import {
  FacebookConnection,
  FacebookConnectionDocument,
  FacebookConnectionStatus,
} from '../schemas/facebook-connection.schema';

export interface SyncGroupDto {
  externalId: string;
  name: string;
  url: string;
  numericId?: string;
}

export interface ListGroupsOptions {
  search?: string;
  page?: number;
  limit?: number;
  connectionIds?: string[];
}

const UI_NAME_SUBSTRINGS = [
  'تعرف على المزيد',
  'learn more about this group',
  'about this group',
  'غير مقروءة',
  'مطلوب الموافقة',
  'approval required',
  'requires approval',
  'unread',
  'new post',
];

function normalizeGroupName(name: string): string {
  return (name ?? '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUiGroupName(name: string): boolean {
  const trimmed = normalizeGroupName(name);
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return UI_NAME_SUBSTRINGS.some((s) => lower.includes(s.toLowerCase()));
}

function canonicalizeGroupUrl(externalId: string, url?: string): string {
  if (externalId) {
    return `https://www.facebook.com/groups/${externalId}/`;
  }
  return url ?? '';
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    writeErrors?: Array<{ code?: unknown }>;
  };
  return (
    candidate.code === 11000 ||
    Boolean(candidate.writeErrors?.some((writeError) => writeError.code === 11000))
  );
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
    @InjectModel(FacebookConnection.name)
    private readonly connectionModel: Model<FacebookConnectionDocument>,
  ) {}

  private async assertVerifiedConnection(
    clerkUserId: string,
    extensionInstanceId?: string,
  ): Promise<FacebookConnectionDocument | null> {
    const normalizedInstanceId = extensionInstanceId?.trim();
    if (!normalizedInstanceId) return null;

    const connection = await this.connectionModel
      .findOne({ clerkUserId, extensionInstanceId: normalizedInstanceId })
      .lean()
      .exec();
    const verified = Boolean(
      connection?.status === FacebookConnectionStatus.CONNECTED &&
      connection.facebookSessionDetected &&
      connection.facebookUserId &&
      connection.detectedFacebookUserId &&
      connection.facebookUserId === connection.detectedFacebookUserId,
    );
    if (!verified) {
      throw new ForbiddenException(
        'Facebook identity must be verified before syncing groups.',
      );
    }
    return connection as FacebookConnectionDocument;
  }

  /**
   * Upsert a batch of groups for the authenticated user.
   * Called by the extension whenever new groups are discovered.
   */
  async syncGroups(
    clerkUserId: string,
    groups: SyncGroupDto[],
    extensionInstanceId?: string,
  ): Promise<{ synced: number; total?: number }> {
    const connection = await this.assertVerifiedConnection(
      clerkUserId,
      extensionInstanceId,
    );
    const connectionId = connection?._id;
    if (!groups.length) return { synced: 0 };

    const ops = groups
      .map((g) => {
        const url = canonicalizeGroupUrl(g.externalId, g.url);
        const cleanName = normalizeGroupName(g.name);
        const skipName = isUiGroupName(cleanName);
        if (skipName) return null;
        const filter = connectionId
          ? {
              clerkUserId,
              externalId: g.externalId,
              $or: [
                { facebookConnectionId: connectionId },
                { facebookConnectionId: { $exists: false } },
                { facebookConnectionId: null },
              ],
            }
          : {
              clerkUserId,
              externalId: g.externalId,
            };
        return {
          updateOne: {
            filter,
            update: {
              $set: {
                url,
                lastSeenAt: new Date(),
                status: 'ACTIVE',
                ...(skipName ? {} : { name: cleanName }),
                ...(connectionId ? { facebookConnectionId: connectionId } : {}),
              },
              $setOnInsert: {
                clerkUserId,
                externalId: g.externalId,
              },
            },
            upsert: true,
          },
        };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (!ops.length) return { synced: 0 };

    let result: { upsertedCount: number; modifiedCount: number };
    try {
      result = await this.groupModel.bulkWrite(ops);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'Group sync hit a legacy unique index. Run `npm run repair-indexes` from apps/api, then retry group sync.',
        );
      }
      throw error;
    }

    // Calculate total groups for this user to help with debugging mismatches
    const totalInDb = await this.groupModel.countDocuments({
      clerkUserId,
      ...(connectionId ? { facebookConnectionId: connectionId } : {}),
    });

    console.log(
      `[Backend] Synced ${result.upsertedCount + result.modifiedCount} groups for user ${clerkUserId}. Total DB count: ${totalInDb}`,
    );

    return {
      synced: result.upsertedCount + result.modifiedCount,
      total: totalInDb,
    };
  }

  /**
   * Return all groups belonging to the given user.
   */
  async getGroups(clerkUserId: string, connectionIds?: string[]) {
    const filter = this.getGroupFilter(clerkUserId, connectionIds);
    const groups = await this.groupModel
      .find(filter)
      .sort({ lastSeenAt: -1 })
      .lean()
      .exec();

    return groups.map((g) => ({ ...g, _id: g._id.toString() }));
  }

  /**
   * Search groups by name (case-insensitive).
   */
  async searchGroups(clerkUserId: string, query: string, connectionIds?: string[]) {
    const groups = await this.groupModel
      .find({
        ...this.getGroupFilter(clerkUserId, connectionIds),
        name: { $regex: query, $options: 'i' },
      })
      .sort({ lastSeenAt: -1 })
      .lean()
      .exec();

    return groups.map((g) => ({ ...g, _id: g._id.toString() }));
  }

  async listGroups(clerkUserId: string, options: ListGroupsOptions) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const search = options.search?.trim();
    const filter = {
      ...this.getGroupFilter(clerkUserId, options.connectionIds),
      ...(search ? { name: { $regex: search, $options: 'i' } } : {}),
    };

    const [groups, total] = await Promise.all([
      this.groupModel
        .find(filter)
        .sort({ name: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.groupModel.countDocuments(filter),
    ]);

    return {
      groups: groups.map((g) => ({ ...g, _id: g._id.toString() })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private getGroupFilter(clerkUserId: string, connectionIds?: string[]) {
    const uniqueConnectionIds = [...new Set(
      connectionIds?.map((id) => id.trim()).filter(Boolean) ?? [],
    )];
    if (uniqueConnectionIds.length === 0) return { clerkUserId };
    if (uniqueConnectionIds.some((id) => !Types.ObjectId.isValid(id))) {
      throw new ForbiddenException('Invalid Facebook connection ID.');
    }
    return {
      clerkUserId,
      facebookConnectionId: {
        $in: uniqueConnectionIds.map((id) => new Types.ObjectId(id)),
      },
    };
  }

  async deleteAllGroups(clerkUserId: string) {
    const groups = await this.groupModel
      .find({ clerkUserId })
      .select('_id')
      .lean()
      .exec();
    const groupIds = groups.map((group) => group._id);
    if (groupIds.length) {
      await this.jobModel.deleteMany().where('groupId').in(groupIds).exec();
    }
    await this.groupModel.deleteMany({ clerkUserId }).exec();
  }
}
