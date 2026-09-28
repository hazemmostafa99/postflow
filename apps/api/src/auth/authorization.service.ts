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
  ): Promise<UserDocument> {
    if (!clerkUserId)
      throw new UnauthorizedException('Clerk user ID is required');
    const existing = await this.userModel.findOne({ clerkUserId }).exec();
    if (existing) {
      if (existing.status !== UserStatus.ACTIVE)
        throw new ForbiddenException('PostFlow user is disabled');
      return existing;
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
        return emailOwner.save();
      }
    }

    return new this.userModel({
      clerkUserId,
      email: normalizedEmail,
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
}
