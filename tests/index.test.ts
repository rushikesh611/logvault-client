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

// Mock console.error
console.error = jest.fn();

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
            json: async () => ({}),
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
        });

        test('should initialize with custom options', () => {
            client = new LogVaultClient(apiKey, url, {
                batchSize: 50,
                flushInterval: 10000,
                requestTimeout: 3000
            });
            expect(client).toBeDefined();
            expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 10000);
        });
    });

    describe('logging methods', () => {
        beforeEach(() => {
            client = new LogVaultClient(apiKey, url, { batchSize: 10 });
        });

        test('should add log entry to buffer', async () => {
            const now = new Date();
            jest.spyOn(global, 'Date').mockImplementation(() => now as any);
            
            await client.log('info', 'Test message', { key: 'value' });
            
            // Trigger flush manually to check buffer contents
            // @ts-ignore - accessing private method for testing
            await client['flush']();
            
            expect(fetch).toHaveBeenCalledWith(
                `${url}/logs`,
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: expect.stringContaining('Test message')
                })
            );
        });

        test('should flush buffer when it reaches batch size', async () => {
            // Configure client with small batch size
            client = new LogVaultClient(apiKey, url, { batchSize: 3 });
            
            // Add logs to fill the batch
            await client.info('Log 1');
            await client.info('Log 2');
            
            // These logs shouldn't trigger a flush yet
            expect(fetch).not.toHaveBeenCalled();
            
            // This should trigger a flush
            await client.info('Log 3');
            
            expect(fetch).toHaveBeenCalledTimes(1);
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
    });

    describe('flush behavior', () => {
        beforeEach(() => {
            client = new LogVaultClient(apiKey, url, { flushInterval: 60000 });
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
        });
    });

    test('should respect request timeout option', async () => {
        const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
        client = new LogVaultClient(apiKey, url, { requestTimeout: 1000 });
        
        // Add a log to trigger a flush
        await client.info('Test log');
        
        // Mock fetch to not resolve
        (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
        
        // Manually call flush
        // @ts-ignore - accessing private method for testing
        const flushPromise = client['flush']();
        
        // Advance timers to trigger the timeout
        jest.advanceTimersByTime(1001);
        
        await Promise.resolve(); // Allow any pending promises to resolve
        expect(abortSpy).toHaveBeenCalled();
    });
});