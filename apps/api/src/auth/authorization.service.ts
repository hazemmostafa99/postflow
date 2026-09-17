import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invitation, InvitationDocument, InvitationStatus } from '../schemas/invitation.schema';
import { Team, TeamDocument } from '../schemas/team.schema';
import { User, UserDocument, UserRole, UserStatus } from '../schemas/user.schema';

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Invitation.name) private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
  ) {}

  async requireActiveUser(clerkUserId: string): Promise<UserDocument> {
    if (!clerkUserId) throw new UnauthorizedException('Clerk user ID is required');
    const user = await this.userModel.findOne({ clerkUserId }).exec();
    if (!user) throw new UnauthorizedException('PostFlow user is not provisioned');
    if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException('PostFlow user is disabled');
    return user;
  }

  async requireOrProvisionActiveUser(clerkUserId: string, email?: string): Promise<UserDocument> {
    if (!clerkUserId) throw new UnauthorizedException('Clerk user ID is required');
    const existing = await this.userModel.findOne({ clerkUserId }).exec();
    if (existing) {
      if (existing.status !== UserStatus.ACTIVE) throw new ForbiddenException('PostFlow user is disabled');
      return existing;
    }

    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) throw new UnauthorizedException('PostFlow user is not provisioned');

    const invitation = await this.invitationModel
      .findOne({ email: normalizedEmail, status: InvitationStatus.PENDING })
      .sort({ createdAt: -1 })
      .exec();
    if (!invitation) throw new UnauthorizedException('PostFlow user is not provisioned');
    if (invitation.expiresAt < new Date()) {
      invitation.status = InvitationStatus.EXPIRED;
      await invitation.save();
      throw new ForbiddenException('Invitation has expired');
    }

    await this.validateProvisioningAssignment(invitation.role, invitation.teamId);
    const emailOwner = await this.userModel.findOne({ email: normalizedEmail }).exec();
    if (emailOwner) throw new ConflictException('This email already belongs to a PostFlow user');

    const user = await new this.userModel({
      clerkUserId,
      email: normalizedEmail,
      role: invitation.role,
      status: UserStatus.ACTIVE,
      teamId: invitation.role === UserRole.ADMIN || invitation.role === UserRole.MANAGER ? null : invitation.teamId,
    }).save();

    invitation.status = InvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    invitation.acceptedClerkUserId = clerkUserId;
    await invitation.save();
    return user;
  }

  async requireRole(clerkUserId: string, ...roles: UserRole[]): Promise<UserDocument> {
    const user = await this.requireActiveUser(clerkUserId);
    if (!roles.includes(user.role)) throw new ForbiddenException('Insufficient permissions');
    return user;
  }

  assertTeamAccess(user: UserDocument, teamId: string): void {
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) return;
    if (user.teamId !== teamId) throw new ForbiddenException('This team is outside your access scope');
  }

  private async validateProvisioningAssignment(role: UserRole, teamId?: string | null) {
    const teamRequired = role === UserRole.SALES || role === UserRole.TEAM_LEADER;
    if (teamRequired && !teamId) throw new BadRequestException(`${role} users must belong to a team`);
    if (!teamRequired && teamId) throw new BadRequestException(`${role} users cannot belong to a team`);
    if (!teamId) return;
    if (!(await this.teamModel.exists({ _id: teamId }))) throw new BadRequestException('Team not found');
    if (role === UserRole.TEAM_LEADER) {
      const conflict = await this.userModel.findOne({ teamId, role, status: UserStatus.ACTIVE }).exec();
      if (conflict) throw new ConflictException('This team already has an active Team Leader');
    }
  }
}
