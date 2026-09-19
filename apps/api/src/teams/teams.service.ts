import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthorizationService } from '../auth/authorization.service';
import { Team, TeamDocument } from '../schemas/team.schema';
import { User, UserDocument, UserRole, UserStatus } from '../schemas/user.schema';

@Injectable()
export class TeamsService {
  constructor(
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(clerkUserId: string) {
    const user = await this.authorization.requireActiveUser(clerkUserId);
    const filter = user.role === UserRole.ADMIN ? {} : user.role === UserRole.MANAGER ? { managerId: user._id.toString() } : { _id: user.teamId };
    const teams = await this.teamModel.find(filter).sort({ name: 1 }).exec();
    return Promise.all(teams.map((team) => this.decorate(team)));
  }

  async get(clerkUserId: string, id: string) {
    const user = await this.authorization.requireActiveUser(clerkUserId);
    this.authorization.assertTeamAccess(user, id);
    const team = await this.teamModel.findById(id).exec();
    if (!team) throw new NotFoundException('Team not found');
    return this.decorate(team);
  }

  async create(clerkUserId: string, name: string, managerId?: string | null) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const cleanName = name?.trim();
    if (!cleanName) throw new BadRequestException('Team name is required');
    await this.validateManager(managerId);
    try {
      return await new this.teamModel({ name: cleanName, managerId: managerId || null }).save();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('A team with this name already exists');
      throw error;
    }
  }

  async update(clerkUserId: string, id: string, body: { name?: string; managerId?: string | null }) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const patch: { name?: string; managerId?: string | null } = {};
    if (body.name !== undefined) {
      const cleanName = body.name?.trim();
      if (!cleanName) throw new BadRequestException('Team name is required');
      patch.name = cleanName;
    }
    if (body.managerId !== undefined) {
      await this.validateManager(body.managerId);
      patch.managerId = body.managerId || null;
    }
    const team = await this.teamModel.findByIdAndUpdate(id, patch, { returnDocument: 'after' }).exec();
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async removeMember(clerkUserId: string, teamId: string, userId: string) {
    const requester = await this.authorization.requireRole(clerkUserId, UserRole.ADMIN, UserRole.MANAGER);
    const team = await this.teamModel.findById(teamId).exec();
    if (!team) throw new NotFoundException('Team not found');
    if (requester.role === UserRole.MANAGER && team.managerId !== requester._id.toString()) {
      throw new NotFoundException('Team not found');
    }
    const user = await this.userModel.findOne({ _id: userId, teamId }).exec();
    if (!user) throw new NotFoundException('Team member not found');
    user.teamId = null;
    if (user.role === UserRole.TEAM_LEADER) user.role = UserRole.SALES;
    return user.save();
  }

  async delete(clerkUserId: string, id: string) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const team = await this.teamModel.findByIdAndDelete(id).exec();
    if (!team) throw new NotFoundException('Team not found');
    await this.userModel.updateMany(
      { teamId: id, role: UserRole.TEAM_LEADER },
      { $set: { role: UserRole.SALES } },
    ).exec();
    await this.userModel.updateMany(
      { teamId: id },
      { $set: { teamId: null } },
    ).exec();
    return { deleted: true, id };
  }

  private async decorate(team: TeamDocument) {
    const members = await this.userModel.find({ teamId: team._id.toString(), status: UserStatus.ACTIVE }).select('-__v').lean().exec();
    const manager = team.managerId ? await this.userModel.findById(team.managerId).select('-__v').lean().exec() : null;
    const data = team.toObject();
    return {
      ...data,
      _id: team._id.toString(),
      manager,
      teamLeader: members.find((member) => member.role === UserRole.TEAM_LEADER) ?? null,
      members,
      sales: members.filter((member) => member.role === UserRole.SALES),
      salesCount: members.filter((member) => member.role === UserRole.SALES).length,
    };
  }

  private async validateManager(managerId?: string | null) {
    if (!managerId) return;
    const manager = await this.userModel.findById(managerId).exec();
    if (!manager || manager.role !== UserRole.MANAGER || manager.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('A valid active Manager is required');
    }
  }
}
