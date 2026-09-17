import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthorizationService } from '../auth/authorization.service';
import { Invitation, InvitationDocument, InvitationStatus } from '../schemas/invitation.schema';
import { Team, TeamDocument } from '../schemas/team.schema';
import { UserRole } from '../schemas/user.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { ClerkInvitationsService } from './clerk-invitations.service';
import { UsersService } from '../users/users.service';

export interface CreateInvitationDto { email: string; role: UserRole; teamId?: string | null }

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly authorization: AuthorizationService,
    private readonly clerk: ClerkInvitationsService,
    private readonly users: UsersService,
  ) {}

  async list(clerkUserId: string) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN, UserRole.MANAGER);
    return this.invitationModel.find().sort({ createdAt: -1 }).lean().exec();
  }

  async create(clerkUserId: string, dto: CreateInvitationDto) {
    const inviter = await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const email = dto.email?.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('A valid email is required');
    if (!Object.values(UserRole).includes(dto.role)) throw new BadRequestException('Invalid role');
    if (dto.role === UserRole.ADMIN || dto.role === UserRole.MANAGER) {
      if (dto.teamId) throw new BadRequestException(`${dto.role} invitations cannot include a team`);
    } else if (!dto.teamId || !(await this.teamModel.exists({ _id: dto.teamId }))) {
      throw new BadRequestException('A valid team is required for this role');
    }
    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser?.status === 'ACTIVE') throw new ConflictException('This email already belongs to an active user');
    const pending = await this.invitationModel.findOne({ email, status: InvitationStatus.PENDING }).exec();
    if (pending) throw new ConflictException('There is already a pending invitation for this email');
    if (dto.role === UserRole.TEAM_LEADER) {
      const leaderInvite = await this.invitationModel.findOne({ teamId: dto.teamId, role: UserRole.TEAM_LEADER, status: InvitationStatus.PENDING }).exec();
      if (leaderInvite) throw new ConflictException('This team already has a pending Team Leader invitation');
    }
    const invitation = new this.invitationModel({ email, role: dto.role, teamId: dto.teamId ?? null, invitedByUserId: inviter._id.toString(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await invitation.save();
    try {
      const clerkInvitation = await this.clerk.create(email);
      invitation.clerkInvitationId = clerkInvitation.id;
      return await invitation.save();
    } catch (error) {
      await this.invitationModel.findByIdAndDelete(invitation.id).exec();
      throw error;
    }
  }

  async revoke(clerkUserId: string, id: string) {
    await this.authorization.requireRole(clerkUserId, UserRole.ADMIN);
    const invitation = await this.invitationModel.findById(id).exec();
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status === InvitationStatus.PENDING) {
      invitation.status = InvitationStatus.REVOKED;
      await invitation.save();
      if (invitation.clerkInvitationId) await this.clerk.revoke(invitation.clerkInvitationId);
    }
    return invitation;
  }

  async accept(data: { invitationId: string; clerkUserId: string; email: string }) {
    const invitation = await this.invitationModel.findById(data.invitationId).exec();
    if (!invitation || invitation.status !== InvitationStatus.PENDING) throw new BadRequestException('Invitation is not pending');
    if (invitation.expiresAt < new Date()) { invitation.status = InvitationStatus.EXPIRED; await invitation.save(); throw new BadRequestException('Invitation has expired'); }
    if (invitation.email !== data.email.trim().toLowerCase()) throw new BadRequestException('Invitation email does not match');
    const user = await this.users.createFromInvitation({ clerkUserId: data.clerkUserId, email: invitation.email, role: invitation.role, teamId: invitation.teamId });
    invitation.status = InvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    invitation.acceptedClerkUserId = data.clerkUserId;
    await invitation.save();
    return user;
  }
}
