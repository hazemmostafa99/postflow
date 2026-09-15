import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ExtensionInstallation, ExtensionInstallationDocument } from '../schemas/extension-installation.schema';

@Injectable()
export class ExtensionsService {
  constructor(
    @InjectModel(ExtensionInstallation.name)
    private readonly extensionModel: Model<ExtensionInstallationDocument>,
  ) {}

  /**
   * Register or retrieve an existing installation for the user.
   * Idempotent — safe to call on every extension startup.
   */
  async register(clerkUserId: string): Promise<ExtensionInstallationDocument> {
    const existing = await this.extensionModel.findOne({ clerkUserId }).exec();
    if (existing) {
      existing.status = 'ACTIVE';
      existing.lastHeartbeat = new Date();
      return existing.save();
    }
    const installation = new this.extensionModel({
      clerkUserId,
      status: 'ACTIVE',
      lastHeartbeat: new Date(),
    });
    return installation.save();
  }

  /**
   * Update the heartbeat timestamp to indicate the extension is alive.
   */
  async heartbeat(clerkUserId: string): Promise<ExtensionInstallationDocument> {
    const installation = await this.extensionModel
      .findOneAndUpdate(
        { clerkUserId },
        { lastHeartbeat: new Date(), status: 'ACTIVE' },
        { new: true },
      )
      .exec();

    if (!installation) {
      throw new NotFoundException('Extension installation not found. Please register first.');
    }
    return installation;
  }

  /**
   * Update the Facebook session status reported by the extension.
   */
  async updateSession(
    clerkUserId: string,
    sessionDetected: boolean,
  ): Promise<ExtensionInstallationDocument> {
    const installation = await this.extensionModel
      .findOneAndUpdate(
        { clerkUserId },
        {
          facebookSessionDetected: sessionDetected,
          lastHeartbeat: new Date(),
        },
        { new: true },
      )
      .exec();

    if (!installation) {
      throw new NotFoundException('Extension installation not found. Please register first.');
    }
    return installation;
  }
}
