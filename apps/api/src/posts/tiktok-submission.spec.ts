jest.mock('@nestjs/mongoose', () => ({ InjectModel: () => () => undefined, Prop: () => () => undefined,
  Schema: () => (target: unknown) => target, SchemaFactory: { createForClass: () => ({ index: jest.fn(), pre: jest.fn() }) } }));
import { JobsController } from './jobs.controller';
import * as policy from './tiktok-publishing-policy';

describe('TikTok single-use submission checkpoint', () => {
  afterEach(() => jest.restoreAllMocks());
  function harness(overrides: Record<string, unknown> = {}) {
    const job: any = { _id: 'job-1', platform: 'TIKTOK', platformConnectionId: 'connection-1', postId: { clerkUserId: 'owner' },
      status: 'RUNNING', claimedByExtensionInstanceId: 'extension-1', claimExpiresAt: new Date(Date.now() + 60000), ...overrides };
    const findOneAndUpdate = jest.fn((query: any, update: any) => ({ exec: async () => {
      if (job.status !== query.status || job.claimedByExtensionInstanceId !== query.claimedByExtensionInstanceId ||
        job.claimExpiresAt <= query.claimExpiresAt.$gt || job.submittedAt) return null;
      Object.assign(job, update.$set);
      return job;
    } }));
    const connection = { _id: 'connection-1', platform: 'TIKTOK', status: 'CONNECTED', sessionDetected: true,
      externalUsername: 'creator', detectedExternalUsername: 'creator' };
    const controller = new JobsController({ findById: () => ({ populate() { return this; }, exec: async () => job }), findOneAndUpdate } as never,
      {} as never, {} as never, { verifyWorkerIdentity: async () => ({ _id: 'installation-1', status: 'ACTIVE' }), assertInstallationActive() {} } as never,
      { findOne: () => ({ exec: async () => connection }) } as never);
    return { controller, job, findOneAndUpdate };
  }
  it('atomically grants one permission even for concurrent requests', async () => {
    jest.spyOn(policy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const { controller, job, findOneAndUpdate } = harness();
    const results = await Promise.all([controller.armTikTokSubmission('owner', 'extension-1', 'credential', 'job-1'),
      controller.armTikTokSubmission('owner', 'extension-1', 'credential', 'job-1')]);
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(job.submissionStatus).toBe('UNKNOWN');
    expect(job.submittedAt).toBeInstanceOf(Date);
    expect(findOneAndUpdate.mock.calls[0][0]).toMatchObject({ status: 'RUNNING', submittedAt: { $exists: false },
      submissionStatus: { $nin: ['UNKNOWN', 'PROCESSING', 'PUBLISHED'] } });
  });
  it.each([{ status: 'CANCEL_REQUESTED' }, { claimExpiresAt: new Date(0) }, { claimedByExtensionInstanceId: 'another-extension' }, { submittedAt: new Date() }])
    ('denies canceled, expired, foreign, or already armed claims: %j', async (override) => {
      jest.spyOn(policy, 'isTikTokPublishingEnabled').mockReturnValue(true);
      const { controller } = harness(override);
      expect(await controller.armTikTokSubmission('owner', 'extension-1', 'credential', 'job-1')).toEqual({ allowed: false });
    });
  it('rejects foreign owners and disabled execution before arming', async () => {
    const enabled = jest.spyOn(policy, 'isTikTokPublishingEnabled').mockReturnValue(false);
    const { controller, findOneAndUpdate } = harness();
    await expect(controller.armTikTokSubmission('owner', 'extension-1', 'credential', 'job-1')).rejects.toThrow('disabled');
    enabled.mockReturnValue(true);
    await expect(controller.armTikTokSubmission('other', 'extension-1', 'credential', 'job-1')).rejects.toThrow('owned TikTok job');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('exposes the persisted checkpoint in subsequent worker job checks', async () => {
    const { controller } = harness({ submittedAt: new Date(0), submissionStatus: 'UNKNOWN' });
    expect(await controller.getJob('owner', 'extension-1', 'job-1', 'credential')).toMatchObject({ submittedAt: new Date(0), submissionStatus: 'UNKNOWN' });
  });
});
