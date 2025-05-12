import { LogVaultClient } from '../src';

// Mock UUID module
jest.mock('uuid', () => ({
    v4: () => 'mocked-uuid'
}));

// Mock fetch API
global.fetch = jest.fn();

// Mock timer functions
jest.useFakeTimers();
const setIntervalMock = jest.spyOn(global, 'setInterval');
const clearIntervalMock = jest.spyOn(global, 'clearInterval');

// Mock console methods
console.error = jest.fn();
console.warn = jest.fn();
console.log = jest.fn();

describe('LogVaultClient', () => {
    let client: LogVaultClient;
    const apiKey = 'test-api-key';
    const url = 'https://logvault.example.com';

    beforeEach(() => {
        jest.clearAllMocks();
        jest.clearAllTimers();
        // Reset the fetch mock
        (global.fetch as jest.Mock).mockReset();
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'source-123',
                name: 'test-source',
                userId: 'user-123'
            }),
        });
    });

    afterEach(async () => {
        if (client) {
            await client.close();
        }
    });

    describe('initialization', () => {
        test('should initialize with default options', () => {
            client = new LogVaultClient(apiKey, url);
            expect(client).toBeDefined();
            expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 5000);
            // Verify API validation was called
            expect(fetch).toHaveBeenCalledWith(
                `${url}/validate`,
                expect.objectContaining({
                    method: 'GET',
                    headers: { 'X-API-Key': apiKey }
                })
            );
        });

        test('should initialize with custom options', () => {
            client = new LogVaultClient(apiKey, url, {
                batchSize: 50,
                flushInterval: 10000,
                requestTimeout: 3000,
                defaultSource: 'custom-source'
            });
            expect(client).toBeDefined();
            expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 10000);
        });
        
        test('should handle API validation failure', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                text: async () => 'Invalid API key'
            });
            
            client = new LogVaultClient(apiKey, url);
            
            // Force sourceInfoPromise to resolve
            // @ts-ignore - accessing private property for testing
            await client['sourceInfoPromise'];
            
            expect(console.warn).toHaveBeenCalledWith(
                'Failed to fetch source info:',
                'Invalid API key'
            );
        });
    });

    describe('logging methods', () => {
        beforeEach(async () => {
            client = new LogVaultClient(apiKey, url, { batchSize: 10 });
            // Wait for source info to be loaded
            await Promise.resolve();
        });

        test('should add log entry to buffer with correct metadata', async () => {
            const now = new Date();
            jest.spyOn(global, 'Date').mockImplementation(() => now as any);
            
            await client.log('info', 'Test message', { key: 'value' });
            
            // Trigger flush manually to check buffer contents
            // @ts-ignore - accessing private method for testing
            await client['flush']();
            
            const expectedBody = JSON.stringify({
                logs: [{
                    timestamp: now.toISOString(),
                    source: 'test-source',
                    level: 'info',
                    message: 'Test message',
                    metadata: {
                        key: 'value',
                        requestId: 'mocked-uuid',
                        sourceId: 'source-123'
                    }
                }]
            });
            
            expect(fetch).toHaveBeenCalledWith(
                `${url}/logs`,
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: expectedBody
                })
            );
        });

        test('should flush buffer when it reaches batch size', async () => {
            // Configure client with small batch size
            client = new LogVaultClient(apiKey, url, { batchSize: 3 });
            // Allow source info to load
            await Promise.resolve();
            
            // Reset fetch mock after initialization
            (global.fetch as jest.Mock).mockReset();
            
            // Add logs to fill the batch
            await client.info('Log 1');
            await client.info('Log 2');
            
            // These logs shouldn't trigger a flush yet
            expect(fetch).not.toHaveBeenCalled();
            
            // This should trigger a flush
            await client.info('Log 3');
            
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledWith(
                `${url}/logs`,
                expect.any(Object)
            );
        });

        test('should use provided source over API source', async () => {
            await client.log('info', 'Message with source', {}, 'custom-source');
            
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'][0].source).toBe('custom-source');
        });
        
        test('should use metadata source if no explicit source provided', async () => {
            await client.log('info', 'Message with metadata source', { source: 'metadata-source' });
            
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'][0].source).toBe('metadata-source');
            // Source should be removed from metadata
            expect(client['buffer'][0].metadata?.source).toBeUndefined();
        });

        test('should use info level', async () => {
            await client.info('Info message');
            
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'][0].level).toBe('info');
            expect(client['buffer'][0].message).toBe('Info message');
        });

        test('should use error level', async () => {
            await client.error('Error message');
            
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'][0].level).toBe('error');
            expect(client['buffer'][0].message).toBe('Error message');
        });

        test('should use warn level', async () => {
            await client.warn('Warn message');
            
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'][0].level).toBe('warn');
            expect(client['buffer'][0].message).toBe('Warn message');
        });

        test('should use debug level', async () => {
            await client.debug('Debug message');
            
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'][0].level).toBe('debug');
            expect(client['buffer'][0].message).toBe('Debug message');
        });
        
        test('should return requestId', async () => {
            const requestId = await client.info('Info with request ID');
            expect(requestId).toBe('mocked-uuid');
        });
    });

    describe('flush behavior', () => {
        beforeEach(async () => {
            client = new LogVaultClient(apiKey, url, { flushInterval: 60000 });
            // Allow source info to load
            await Promise.resolve();
            // Reset fetch mock after initialization
            (global.fetch as jest.Mock).mockReset();
        });

        test('should flush logs on interval', async () => {
            await client.info('Test log');
            
            // No fetch call yet
            expect(fetch).not.toHaveBeenCalled();
            
            // Advance timer to trigger flush
            jest.advanceTimersByTime(60000);
            
            // Wait for promises to resolve
            await Promise.resolve();
            
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('should not make request if buffer is empty', async () => {
            // Advance timer without adding any logs
            jest.advanceTimersByTime(60000);
            
            // Wait for promises to resolve
            await Promise.resolve();
            
            expect(fetch).not.toHaveBeenCalled();
        });

        test('should handle network errors and retain logs', async () => {
            (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
            
            // Add a log
            await client.info('Test log');
            
            // @ts-ignore - accessing private method for testing
            await client['flush']();
            
            // Log should be back in the buffer
            // @ts-ignore - accessing private property for testing
            expect(client['buffer'].length).toBe(1);

            // Console.error should have been called with the error
            expect(console.error).toHaveBeenCalledWith(
                'Failed to send logs to LogVault:',
                expect.any(Error)
            );
        });

        test('should clean up timer when closed', async () => {
            await client.info('Test before close');
            await client.close();
            expect(clearIntervalMock).toHaveBeenCalled();
            // Should attempt to flush logs on close
            expect(fetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('timeout behavior', () => {
        beforeEach(() => {
            // Mock setTimeout and clearTimeout
            jest.spyOn(global, 'setTimeout').mockImplementation(() => 123 as any);
            jest.spyOn(global, 'clearTimeout');
        });
        
        test('should respect request timeout option', async () => {
            // Mock AbortController
            const mockAbort = jest.fn();
            const mockAbortController = {
                abort: mockAbort,
                signal: {}
            };
            
            // Replace the global AbortController with our mock
            global.AbortController = jest.fn(() => mockAbortController) as any;
            
            client = new LogVaultClient(apiKey, url, { requestTimeout: 1000 });
            
            // Wait for source info to load
            await Promise.resolve();
            
            // Add a log to the buffer
            await client.info('Test log');
            
            // Mock fetch to never resolve
            (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
            
            // Trigger flush manually
            // @ts-ignore - accessing private method for testing
            const flushPromise = client['flush']();
            
            // Call the timeout callback (the second argument to setTimeout)
            const setTimeoutMock = global.setTimeout as unknown as jest.Mock;
            const timeoutCallback = setTimeoutMock.mock.calls[0][0];
            timeoutCallback();
            
            // The abort method should have been called
            expect(mockAbort).toHaveBeenCalled();
        });
    });
});