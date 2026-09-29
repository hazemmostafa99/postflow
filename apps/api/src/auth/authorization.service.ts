import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../schemas/user.schema';

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async requireActiveUser(clerkUserId: string): Promise<UserDocument> {
    if (!clerkUserId)
      throw new UnauthorizedException('Clerk user ID is required');
    const user = await this.userModel.findOne({ clerkUserId }).exec();
    if (!user)
      throw new UnauthorizedException('PostFlow user is not provisioned');
    if (user.status !== UserStatus.ACTIVE)
      throw new ForbiddenException('PostFlow user is disabled');
    return user;
  }

  async requireOrProvisionActiveUser(
    clerkUserId: string,
    email?: string,
    profile?: { firstName?: string; lastName?: string },
  ): Promise<UserDocument> {
    if (!clerkUserId)
      throw new UnauthorizedException('Clerk user ID is required');
    const normalizedProfile = normalizeUserProfile(profile);
    const existing = await this.userModel.findOne({ clerkUserId }).exec();
    if (existing) {
      if (existing.status !== UserStatus.ACTIVE)
        throw new ForbiddenException('PostFlow user is disabled');
      return this.updateProfile(existing, email, normalizedProfile);
    }

    const normalizedEmail = email?.trim().toLowerCase();
    if (normalizedEmail) {
      const emailOwner = await this.userModel
        .findOne({ email: normalizedEmail })
        .exec();
      if (emailOwner) {
        if (emailOwner.status !== UserStatus.ACTIVE)
          throw new ForbiddenException('PostFlow user is disabled');
        emailOwner.clerkUserId = clerkUserId;
        return this.updateProfile(emailOwner, email, normalizedProfile);
      }
    }

    return new this.userModel({
      clerkUserId,
      email: normalizedEmail,
      ...normalizedProfile,
      role: UserRole.SALES,
      status: UserStatus.ACTIVE,
      teamId: null,
    }).save();
  }

  async requireRole(
    clerkUserId: string,
    ...roles: UserRole[]
  ): Promise<UserDocument> {
    const user = await this.requireActiveUser(clerkUserId);
    if (!roles.includes(user.role))
      throw new ForbiddenException('Insufficient permissions');
    return user;
  }

  assertTeamAccess(user: UserDocument, teamId: string): void {
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) return;
    if (user.teamId !== teamId)
      throw new ForbiddenException('This team is outside your access scope');
  }

  private async updateProfile(
    user: UserDocument,
    email?: string,
    profile: { firstName?: string; lastName?: string } = {},
  ) {
    let changed = false;
    const normalizedEmail = email?.trim().toLowerCase();
    if (normalizedEmail && user.email !== normalizedEmail) {
      user.email = normalizedEmail;
      changed = true;
    }
    if (profile.firstName && user.firstName !== profile.firstName) {
      user.firstName = profile.firstName;
      changed = true;
    }
    if (profile.lastName && user.lastName !== profile.lastName) {
      user.lastName = profile.lastName;
      changed = true;
    }
    return changed ? user.save() : user;
  }
}

function normalizeUserProfile(profile?: { firstName?: string; lastName?: string }) {
  return {
    ...(profile?.firstName?.trim()
      ? { firstName: profile.firstName.trim() }
      : {}),
    ...(profile?.lastName?.trim() ? { lastName: profile.lastName.trim() } : {}),
  };
}
