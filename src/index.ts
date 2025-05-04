import { v4 as uuidv4 } from 'uuid';

export interface LogEntry {
    timestamp?: string;
    level: string;
    message: string;
    metadata?: Record<string, any>;
}

export interface LogVaultOptions {
    batchSize?: number;
    flushInterval?: number;
    requestTimeout?: number;
}

export class LogVaultClient {
    private buffer: LogEntry[] = [];
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly apiKey: string,
        private readonly url: string,
        private readonly options: {
            batchSize?: number;
            flushInterval?: number;
            requestTimeout?: number;
        } = {}
    ) {
        this.options = {
            batchSize: 100,
            flushInterval: 5000,
            requestTimeout: 5000,
            ...options
        };
        this.startTimer();
    }

    private startTimer() {
        this.timer = setInterval(() => {
            this.flush();
        }, this.options.flushInterval);
    }

    private async flush() {
        if (this.buffer.length === 0) return;

        const logsToSend = [...this.buffer];
        this.buffer = [];

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.options.requestTimeout);

            await fetch(`${this.url}/logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify({ logs: logsToSend }),
                signal: controller.signal
            });

            clearTimeout(timeout);
        } catch (error) {
            // Put logs back in buffer for retry
            this.buffer = [...logsToSend, ...this.buffer].slice(0, 1000);
            console.error('Failed to send logs to LogVault:', error);
        }
    }

    async log(level: string, message: string, metadata: Record<string, any> = {}) {
        const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            metadata: {
                ...metadata,
                requestId: metadata.requestId || uuidv4()
            }
        };

        this.buffer.push(logEntry);

        if (this.buffer.length >= this.options.batchSize!) {
            await this.flush();
        }
    }

    async info(message: string, metadata: Record<string, any> = {}) {
        return this.log('info', message, metadata);
    }

    async error(message: string, metadata: Record<string, any> = {}) {
        return this.log('error', message, metadata);
    }

    async warn(message: string, metadata: Record<string, any> = {}) {
        return this.log('warn', message, metadata);
    }

    async debug(message: string, metadata: Record<string, any> = {}) {
        return this.log('debug', message, metadata);
    }

    async close() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        return this.flush();
    }
}