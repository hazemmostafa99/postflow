import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Group, GroupDocument } from '../schemas/group.schema';
import { PublishingJob, PublishingJobDocument } from '../schemas/publishing-job.schema';

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
}

const UI_NAME_SUBSTRINGS = [
  'تعرف على المزيد',
  'learn more about this group',
  'about this group',
];

function isUiGroupName(name: string): boolean {
  const trimmed = name?.trim() ?? '';
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

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    @InjectModel(PublishingJob.name)
    private readonly jobModel: Model<PublishingJobDocument>,
  ) {}

  /**
   * Upsert a batch of groups for the authenticated user.
   * Called by the extension whenever new groups are discovered.
   */
  async syncGroups(clerkUserId: string, groups: SyncGroupDto[]): Promise<{ synced: number; total?: number }> {
    if (!groups.length) return { synced: 0 };

    const ops = groups.map((g) => {
      const url = canonicalizeGroupUrl(g.externalId, g.url);
      const skipName = isUiGroupName(g.name);
      return {
        updateOne: {
          filter: { clerkUserId, externalId: g.externalId },
          update: {
            $set: {
              url,
              lastSeenAt: new Date(),
              status: 'ACTIVE',
            },
            $setOnInsert: {
              clerkUserId,
              externalId: g.externalId,
              name: skipName ? g.externalId : g.name,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await this.groupModel.bulkWrite(ops);
    
    // Calculate total groups for this user to help with debugging mismatches
    const totalInDb = await this.groupModel.countDocuments({ clerkUserId });
    
    console.log(`[Backend] Synced ${result.upsertedCount + result.modifiedCount} groups for user ${clerkUserId}. Total DB count: ${totalInDb}`);

    return { 
      synced: result.upsertedCount + result.modifiedCount,
      total: totalInDb 
    };
  }

  /**
   * Return all groups belonging to the given user.
   */
  async getGroups(clerkUserId: string) {
    const groups = await this.groupModel
      .find({ clerkUserId })
      .sort({ lastSeenAt: -1 })
      .lean()
      .exec();
      
    return groups.map((g) => ({ ...g, _id: g._id.toString() }));
  }

  /**
   * Search groups by name (case-insensitive).
   */
  async searchGroups(clerkUserId: string, query: string) {
    const groups = await this.groupModel
      .find({
        clerkUserId,
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
      clerkUserId,
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

  async deleteAllGroups(clerkUserId: string) {
    const groups = await this.groupModel.find({ clerkUserId }).select('_id').lean().exec();
    const groupIds = groups.map((group) => group._id);
    if (groupIds.length) {
      await this.jobModel.deleteMany({ groupId: { $in: groupIds } } as any).exec();
    }
    await this.groupModel.deleteMany({ clerkUserId }).exec();
  }
}
