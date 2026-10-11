jest.mock('@nestjs/mongoose', () => ({ InjectModel: () => () => undefined, Prop: () => () => undefined,
  Schema: () => (target: unknown) => target, SchemaFactory: { createForClass: () => ({ index: jest.fn(), pre: jest.fn() }) } }));
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JobsController } from './jobs.controller';

describe('TikTok manual reconciliation', () => {
  function harness(overrides: Record<string, unknown> = {}, duplicate = false) {
    const job: any = { _id: { toString: () => 'job-1' }, platform: 'TIKTOK', targetType: 'TIKTOK_VIDEO', status: 'SUCCESS',
      postId: { clerkUserId: 'owner' }, platformConnectionId: { externalUsername: 'creator' }, submissionStatus: 'UNKNOWN',
      save: jest.fn().mockResolvedValue(undefined), ...overrides };
    const first = { populate() { return this; }, exec: async () => job };
    const findOne = jest.fn(() => ({ select() { return this; }, lean() { return this; }, exec: async () => duplicate ? { _id: 'other' } : null }));
    return { job, findOne, controller: new JobsController({ findById: () => first, findOne } as never, {} as never, {} as never, {} as never) };
  }
  it('confirms an owned, account-matching permalink', async () => {
    const { controller, job } = harness();
    const result = await controller.reconcileTikTokJob('owner', 'job-1', { status: 'PUBLISHED', postUrl: 'https://www.tiktok.com/@creator/video/123?x=1' });
    expect(result).toMatchObject({ submissionStatus: 'PUBLISHED', postUrl: 'https://www.tiktok.com/@creator/video/123' });
    expect(job.save).toHaveBeenCalled();
  });
  it('records processing and unknown explanations without a permalink', async () => {
    const { controller, job } = harness();
    await controller.reconcileTikTokJob('owner', 'job-1', { status: 'PROCESSING', reason: 'TikTok still processing' });
    expect(job).toMatchObject({ submissionStatus: 'PROCESSING', submissionReason: 'TikTok still processing' });
    await controller.reconcileTikTokJob('owner', 'job-1', { status: 'UNKNOWN', reason: 'No attributable URL' });
    expect(job).toMatchObject({ submissionStatus: 'UNKNOWN', submissionReason: 'No attributable URL' });
  });
  it.each([
    [{ postUrl: 'https://www.tiktok.com/@other/video/123' }, 'connected account'],
    [{ postUrl: 'https://www.tiktok.com/@creator/video/abc' }, 'valid TikTok permalink'],
  ])('rejects unsafe permalink: %j', async (body, message) => {
    const { controller } = harness();
    await expect(controller.reconcileTikTokJob('owner', 'job-1', { status: 'PUBLISHED', ...body })).rejects.toThrow(message);
  });
  it('turns a duplicate permalink back into UNKNOWN', async () => {
    const { controller, job } = harness({}, true);
    await controller.reconcileTikTokJob('owner', 'job-1', { status: 'PUBLISHED', postUrl: 'https://www.tiktok.com/@creator/video/123' });
    expect(job).toMatchObject({ submissionStatus: 'UNKNOWN', postUrl: undefined });
  });
  it('rejects foreign and not-yet-terminal jobs', async () => {
    await expect(harness({ postId: { clerkUserId: 'other' } }).controller.reconcileTikTokJob('owner', 'job-1', { status: 'UNKNOWN' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(harness({ status: 'RUNNING' }).controller.reconcileTikTokJob('owner', 'job-1', { status: 'UNKNOWN' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not downgrade or replace an already confirmed publication', async () => {
    const { controller } = harness({ submissionStatus: 'PUBLISHED', postUrl: 'https://www.tiktok.com/@creator/video/123' });
    await expect(controller.reconcileTikTokJob('owner', 'job-1', { status: 'UNKNOWN' })).rejects.toThrow('cannot be downgraded');
    await expect(controller.reconcileTikTokJob('owner', 'job-1', { status: 'PUBLISHED', postUrl: 'https://www.tiktok.com/@creator/video/456' })).rejects.toThrow('cannot change');
  });
});
