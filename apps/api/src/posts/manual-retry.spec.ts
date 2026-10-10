jest.mock('@nestjs/mongoose', () => ({
  InjectModel: () => () => undefined,
  Prop: () => () => undefined,
  Schema: () => (target: unknown) => target,
  SchemaFactory: { createForClass: () => ({ index: jest.fn(), pre: jest.fn() }) },
}));

import { JobsController } from './jobs.controller';
import * as tikTokPolicy from './tiktok-publishing-policy';

describe('manual publishing retry', () => {
  afterEach(() => jest.restoreAllMocks());

  function harness(overrides: Record<string, unknown> = {}) {
    const post = { _id: { toString: () => 'post-1' }, clerkUserId: 'owner', status: 'PARTIAL_FAILURE', save: jest.fn() };
    const job: any = {
      _id: { toString: () => 'job-1' },
      platform: 'TIKTOK',
      targetType: 'TIKTOK_PHOTO',
      platformConnectionId: 'connection-1',
      postId: post,
      status: 'FAILED',
      attempts: 1,
      error: 'POST_CONTROL_UNAVAILABLE',
      ...overrides,
    };
    const connection = {
      _id: 'connection-1', platform: 'TIKTOK', status: 'CONNECTED', sessionDetected: true,
      externalUsername: 'creator', detectedExternalUsername: 'creator',
    };
    const update = jest.fn(() => ({ exec: async () => {
      if (job.status !== 'FAILED' || job.submittedAt || job.postUrl || job.submissionStatus) return null;
      Object.assign(job, { status: 'PENDING', error: undefined, submissionReason: undefined,
        startedAt: undefined, completedAt: undefined, scheduledFor: undefined });
      return job;
    } }));
    const find = jest.fn(() => ({
      where() { return this; }, equals() { return this; }, select() { return this; },
      lean() { return this; }, exec: async () => [{ status: job.status }],
    }));
    const model: any = {
      findById: () => ({ populate() { return this; }, exec: async () => job }),
      findOneAndUpdate: update,
      find,
    };
    const platformConnectionModel: any = {
      findOne: () => ({ exec: async () => connection }),
    };
    const controller = new JobsController(model, {} as never, {} as never, {} as never, platformConnectionModel);
    return { controller, job, post, update, find };
  }

  it('requeues a failed TikTok photo job after verifying its account', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const h = harness();
    const result = await h.controller.retryFailedJob('owner', 'job-1');
    expect(result).toMatchObject({ id: 'job-1', status: 'PENDING', attempts: 1 });
    expect(h.job.status).toBe('PENDING');
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', submittedAt: { $exists: false } }), expect.objectContaining({ $set: expect.objectContaining({ status: 'PENDING', manualRetryRequestedAt: expect.any(Date) }) }), { new: true });
    expect(h.post.status).toBe('PUBLISHING');
    expect(h.post.save).toHaveBeenCalled();
  });

  it('rejects a failed job that has any submission marker', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const h = harness({ submittedAt: new Date() });
    await expect(h.controller.retryFailedJob('owner', 'job-1')).rejects.toThrow('reconcile it');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('rejects an unverified account before changing the queue', async () => {
    jest.spyOn(tikTokPolicy, 'isTikTokPublishingEnabled').mockReturnValue(true);
    const h = harness();
    h.controller['platformConnectionModel'].findOne = () => ({ exec: async () => ({
      platform: 'TIKTOK', status: 'CONNECTED', sessionDetected: true,
      externalUsername: 'creator', detectedExternalUsername: 'different',
    }) });
    await expect(h.controller.retryFailedJob('owner', 'job-1')).rejects.toThrow('Reconnect and verify');
    expect(h.update).not.toHaveBeenCalled();
  });
});
