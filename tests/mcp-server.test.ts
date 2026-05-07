import { MCPHttpServer, MAX_RECOVERY_ATTEMPTS, RECOVERY_BACKOFF_MS, retryWithBackoff } from '../src/mcp-server';
import { App } from 'obsidian';

// Mock the fs module to prevent file system operations in tests
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('MCPHttpServer', () => {
  let mockApp: App;

  beforeEach(() => {
    mockApp = new App();
    // Mock the vault adapter for the SecurePathValidator
    mockApp.vault = {
      ...mockApp.vault,
      adapter: {
        basePath: '/mock/vault/path'
      }
    } as any;
  });

  describe('instantiation', () => {
    test('should create server instance', () => {
      const server = new MCPHttpServer(mockApp, 3001);
      expect(server).toBeInstanceOf(MCPHttpServer);
      expect(server.getPort()).toBe(3001);
      expect(server.isServerRunning()).toBe(false);
    });

    test('should get correct port', () => {
      const server = new MCPHttpServer(mockApp, 4001);
      expect(server.getPort()).toBe(4001);
    });

    test('should have a start time', () => {
      const before = Date.now();
      const server = new MCPHttpServer(mockApp, 3001);
      const after = Date.now();
      expect(server.getStartTime()).toBeGreaterThanOrEqual(before);
      expect(server.getStartTime()).toBeLessThanOrEqual(after);
    });

    test('should expose session manager', () => {
      const server = new MCPHttpServer(mockApp, 3001);
      // Session manager is created during setupRoutes, which happens in constructor
      // It may or may not be available depending on initialization
      const sm = server.getSessionManager();
      // SessionManager should exist after construction
      expect(sm).toBeDefined();
    });
  });

  // Note: Full HTTP request/response tests require the server to be started,
  // which needs Express and network interfaces. The session recovery logic
  // is tested at the SessionManager level in session-manager.test.ts.
  // Integration tests for the full HTTP flow should be done manually
  // against a running Obsidian instance.

  describe('retryWithBackoff', () => {
    test('returns result on first attempt when fn succeeds immediately', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await retryWithBackoff(fn, {
        maxAttempts: 3,
        backoffMs: 10,
        shouldRetry: (r) => r !== 'ok'
      });
      expect(result).toEqual({ result: 'ok', attempts: 1 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries and succeeds on second attempt', async () => {
      const fn = jest.fn()
        .mockResolvedValueOnce('fail')
        .mockResolvedValue('ok');
      const result = await retryWithBackoff(fn, {
        maxAttempts: 3,
        backoffMs: 10,
        shouldRetry: (r) => r !== 'ok'
      });
      expect(result).toEqual({ result: 'ok', attempts: 2 });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('returns null after exhausting all attempts', async () => {
      const fn = jest.fn().mockResolvedValue('fail');
      const result = await retryWithBackoff(fn, {
        maxAttempts: MAX_RECOVERY_ATTEMPTS,
        backoffMs: 10,
        shouldRetry: (r) => r === 'fail'
      });
      expect(result).toBeNull();
      expect(fn).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS);
    });

    test('applies linear backoff between attempts', async () => {
      const timestamps: number[] = [];
      const fn = jest.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        return timestamps.length < 3 ? 'fail' : 'ok';
      });
      await retryWithBackoff(fn, {
        maxAttempts: 3,
        backoffMs: RECOVERY_BACKOFF_MS,
        shouldRetry: (r) => r !== 'ok'
      });
      // Second attempt should have ~500ms delay, third ~1000ms
      const gap1 = timestamps[1] - timestamps[0];
      const gap2 = timestamps[2] - timestamps[1];
      expect(gap1).toBeGreaterThanOrEqual(400);  // 500ms with some tolerance
      expect(gap2).toBeGreaterThanOrEqual(900);  // 1000ms with some tolerance
      expect(gap2).toBeGreaterThan(gap1);         // linear increase
    });
  });
});
