import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthorizationService } from '../auth/authorization.service';
import { Team, TeamDocument } from '../schemas/team.schema';
import { User, UserDocument, UserRole, UserStatus } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(clerkUserId: string) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN, UserRole.MANAGER);
    return this.userModel.find().select('-__v').sort({ createdAt: -1 }).lean().exec();
  }

  async get(clerkUserId: string, id: string) {
    const requester = await this.authorization.requireActiveUser(clerkUserId);
    const user = await this.userModel.findById(id).select('-__v').lean().exec();
    if (!user) throw new NotFoundException('User not found');
    if (requester.role !== UserRole.ADMIN && requester.role !== UserRole.MANAGER && requester._id.toString() !== id) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(clerkUserId: string, id: string, patch: { role?: UserRole; teamId?: string | null; status?: UserStatus }) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const existing = await this.userModel.findById(id).exec();
    if (!existing) throw new NotFoundException('User not found');
    const role = patch.role ?? existing.role;
    const teamId = patch.teamId === undefined ? existing.teamId : patch.teamId;
    const effectiveStatus = patch.status ?? existing.status;
    if (patch.status && !Object.values(UserStatus).includes(patch.status)) throw new BadRequestException('Invalid user status');
    await this.validateAssignment(role, teamId, existing.id, effectiveStatus);
    existing.role = role;
    existing.teamId = role === UserRole.ADMIN || role === UserRole.MANAGER ? null : teamId;
    if (patch.status) existing.status = patch.status;
    return existing.save();
  }

  async assignToTeam(clerkUserId: string, id: string, patch: { role: UserRole; teamId: string }) {
    const requester = await this.authorization.requireRole(clerkUserId, UserRole.ADMIN, UserRole.MANAGER);
    if (patch.role !== UserRole.SALES && patch.role !== UserRole.TEAM_LEADER) {
      throw new BadRequestException('Only Sales and Team Leader users can be assigned from teams');
    }
    const team = await this.teamModel.findById(patch.teamId).exec();
    if (!team) throw new BadRequestException('Team not found');
    if (requester.role === UserRole.MANAGER && team.managerId !== requester._id.toString()) {
      throw new NotFoundException('Team not found');
    }
    const existing = await this.userModel.findById(id).exec();
    if (!existing) throw new NotFoundException('User not found');
    await this.validateAssignment(patch.role, patch.teamId, existing.id, existing.status);
    existing.role = patch.role;
    existing.teamId = patch.teamId;
    return existing.save();
  }

  async delete(clerkUserId: string, id: string) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const requester = await this.userModel.findOne({ clerkUserId }).exec();
    if (requester?._id.toString() === id) throw new BadRequestException('You cannot delete your own user');
    const user = await this.userModel.findByIdAndDelete(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return { deleted: true, id };
  }

  async disable(clerkUserId: string, id: string) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    user.status = UserStatus.DISABLED;
    return user.save();
  }

  async createFromInvitation(data: { clerkUserId: string; email: string; role: UserRole; teamId?: string | null }) {
    await this.validateAssignment(data.role, data.teamId, undefined, UserStatus.ACTIVE);
    const existing = await this.userModel.findOne({ clerkUserId: data.clerkUserId }).exec();
    if (existing) return existing;
    return new this.userModel({ ...data, status: UserStatus.ACTIVE, teamId: data.role === UserRole.ADMIN || data.role === UserRole.MANAGER ? null : data.teamId }).save();
  }

  private async validateAssignment(role: UserRole, teamId: string | null | undefined, currentUserId?: string, status = UserStatus.ACTIVE) {
    const teamRequired = role === UserRole.SALES || role === UserRole.TEAM_LEADER;
    if (teamRequired && !teamId) throw new BadRequestException(`${role} users must belong to a team`);
    if (!teamRequired && teamId) throw new BadRequestException(`${role} users cannot belong to a team`);
    if (!teamId) return;
    if (!(await this.teamModel.exists({ _id: teamId }))) throw new BadRequestException('Team not found');
    if (role === UserRole.TEAM_LEADER && status === UserStatus.ACTIVE) {
      const conflict = await this.userModel.findOne({ _id: { $ne: currentUserId }, teamId, role, status: UserStatus.ACTIVE }).exec();
      if (conflict) throw new ConflictException('This team already has an active Team Leader');
    }
  }
}
