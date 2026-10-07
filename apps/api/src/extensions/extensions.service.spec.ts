import { Test, TestingModule } from '@nestjs/testing';
import {
  ExtensionsService,
  normalizeExtensionName,
  normalizeExtensionNameKey,
} from './extensions.service';

describe('ExtensionsService', () => {
  let service: ExtensionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExtensionsService],
    }).compile();

    service = module.get<ExtensionsService>(ExtensionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('normalizes extension names for display and uniqueness checks', () => {
    expect(normalizeExtensionName('  Office   PC  ')).toBe('Office PC');
    expect(normalizeExtensionNameKey('  OFFICE   pc  ')).toBe('office pc');
  });
});
