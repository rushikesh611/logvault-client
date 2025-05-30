import { v4 as uuidv4 } from 'uuid';

export interface LogEntry {
    timestamp?: string;
    source: string;
    level: string;
    message: string;
    metadata?: Record<string, any>;
}

export interface LogVaultOptions {
    batchSize?: number;
    flushInterval?: number;
    requestTimeout?: number;
    defaultSource?: string;  // Fallback source name if API validation fails
}

interface SourceInfo {
    id: string;
    name: string;
    userId: string;
}

export class LogVaultClient {
    private buffer: LogEntry[] = [];
    private timer: NodeJS.Timeout | null = null;
    private sourceInfo: SourceInfo | null = null;
    private sourceInfoPromise: Promise<SourceInfo | null> | null = null;

    constructor(
        private readonly apiKey: string,
        private readonly url: string,
        private readonly options: {
            batchSize?: number;
            flushInterval?: number;
            requestTimeout?: number;
            defaultSource?: string;
        } = {}
    ) {
        this.options = {
            batchSize: 100,
            flushInterval: 5000,
            requestTimeout: 5000,
            defaultSource: 'default-client',
            ...options
        };
        // Initialize source info
        this.initializeSourceInfo();
        this.startTimer();
    }

    private async initializeSourceInfo(): Promise<SourceInfo | null> {
        if (this.sourceInfoPromise) return this.sourceInfoPromise;

        this.sourceInfoPromise = new Promise(async (resolve) => {
            try {
                const response = await fetch(`${this.url}/validate`, {
                    method: 'GET',
                    headers: {
                        'X-API-Key': this.apiKey
                    }
                });

                if (response.ok) {
                    const sourceInfo = await response.json() as SourceInfo;
                    this.sourceInfo = sourceInfo;
                    console.log('LogVault client initialized with source:', sourceInfo.name);
                    resolve(sourceInfo);
                } else {
                    console.warn('Failed to fetch source info:', await response.text());
                    resolve(null);
                }
            } catch (error) {
                console.error('Error fetching source info:', error);
                resolve(null);
            }
        });

        return this.sourceInfoPromise;
    }

    private getSourceName(): string {
        // Return source name from API or fall back to default
        return this.sourceInfo?.name || this.options.defaultSource || 'unknown-source';
    }

    private startTimer() {
        this.timer = setInterval(() => {
            this.flush();
        }, this.options.flushInterval);
    }

    private async flush() {
        if (this.buffer.length === 0) return;

        // Make sure we have source info before sending logs
        if (!this.sourceInfo) {
            await this.initializeSourceInfo();
        }

        const logsToSend = [...this.buffer];
        this.buffer = [];

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.options.requestTimeout);

            const response = await fetch(`${this.url}/logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify({ logs: logsToSend }),
                signal: controller.signal
            });

            clearTimeout(timeout);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LogVault API error (${response.status}): ${errorText}`);
            }
        } catch (error) {
            // Put logs back in buffer for retry
            this.buffer = [...logsToSend, ...this.buffer].slice(0, 1000);
            console.error('Failed to send logs to LogVault:', error);
        }
    }

    async log(level: string, message: string, metadata: Record<string, any> = {}, source?: string) {
        // Wait for source info if not already available
        if (!this.sourceInfo && !this.sourceInfoPromise) {
            await this.initializeSourceInfo();
        }

        const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            // Priority: 1. Explicit source, 2. Metadata source, 3. API source, 4. Default
            source: source || metadata.source || this.getSourceName(),
            level,
            message,
            metadata: {
                ...metadata,
                requestId: metadata.requestId || uuidv4()
            }
        };

        // Remove source from metadata if it was provided there to avoid duplication
        if (metadata.source && logEntry.metadata) {
            delete logEntry.metadata.source;
        }

        // Add source ID from API validation if available
        if (this.sourceInfo?.id && logEntry.metadata) {
            logEntry.metadata.sourceId = this.sourceInfo.id;
        }

        this.buffer.push(logEntry);

        if (this.buffer.length >= this.options.batchSize!) {
            await this.flush();
        }

        return logEntry.metadata!.requestId;
    }

    async info(message: string, metadata: Record<string, any> = {}, source?: string) {
        return this.log('info', message, metadata, source);
    }

    async error(message: string, metadata: Record<string, any> = {}, source?: string) {
        return this.log('error', message, metadata, source);
    }

    async warn(message: string, metadata: Record<string, any> = {}, source?: string) {
        return this.log('warn', message, metadata, source);
    }

    async debug(message: string, metadata: Record<string, any> = {}, source?: string) {
        return this.log('debug', message, metadata, source);
    }

    async close() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        return this.flush();
    }
}