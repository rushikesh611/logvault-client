# LogVault Client

A lightweight, efficient client library for sending logs to LogVault service with batching, retry support, and multiple log levels.

## Features

- 📦 **Batched Logging**: Automatically batches logs to reduce network overhead
- 🔄 **Retry Logic**: Handles network failures gracefully
- ⏱️ **Configurable Timings**: Customize batch size and flush intervals
- 📝 **Multiple Log Levels**: Support for info, error, warn, and debug logs
- 🔍 **Request Tracking**: Automatic request ID generation
- 🚪 **Graceful Shutdown**: Clean up with proper flush on exit

## Installation

```bash
# Using npm
npm install @zerodowntime/logvault-client

# Using yarn
yarn add @zerodowntime/logvault-client

# Using pnpm
pnpm add @zerodowntime/logvault-client
```

## Quick Start

```javascript
// Import the client
import { LogVaultClient } from '@zerodowntime/logvault-client';

// Initialize with your API key and LogVault URL
const logger = new LogVaultClient(
  'YOUR_API_KEY',
  'https://your-logvault-service-url'
);

// Log messages with different levels
await logger.info('User logged in', { userId: '123' });
await logger.error('Database query failed', { error: 'Connection timeout' });
await logger.warn('High CPU usage detected', { cpuUsage: '85%' });
await logger.debug('Cache miss', { key: 'user:123' });

// Clean up before exit
process.on('SIGTERM', async () => {
  await logger.close();
  process.exit(0);
});
```

## Configuration Options

You can customize the client behavior with these options:

```javascript
const logger = new LogVaultClient(
  'YOUR_API_KEY', 
  'https://your-logvault-service-url',
  {
    batchSize: 50,         // Send logs in batches of 50 (default: 100)
    flushInterval: 10000,  // Flush every 10 seconds (default: 5000ms)
    requestTimeout: 3000   // HTTP request timeout in ms (default: 5000ms)
  }
);
```

## API Reference

### Constructor

```typescript
new LogVaultClient(apiKey: string, url: string, options?: LogVaultOptions)
```

- `apiKey`: Your LogVault API key
- `url`: Base URL of your LogVault service
- `options`: Optional configuration

### Methods

#### `log(level: string, message: string, metadata?: object): Promise<void>`

Send a log entry with custom level.

```javascript
await logger.log('notice', 'Custom log level', { data: 'value' });
```

#### `info(message: string, metadata?: object): Promise<void>`

Send an info level log entry.

```javascript
await logger.info('Operation successful', { operationId: '123' });
```

#### `error(message: string, metadata?: object): Promise<void>`

Send an error level log entry.

```javascript
try {
  // some operation
} catch (error) {
  await logger.error('Operation failed', { error: error.message });
}
```

#### `warn(message: string, metadata?: object): Promise<void>`

Send a warning level log entry.

```javascript
await logger.warn('API rate limit approaching', { remainingRequests: 10 });
```

#### `debug(message: string, metadata?: object): Promise<void>`

Send a debug level log entry.

```javascript
await logger.debug('Function executed', { executionTime: '45ms' });
```

#### `close(): Promise<void>`

Flush pending logs and close the client.

```javascript
await logger.close();
```

## Best Practices

1. **Include Request IDs**: Add request IDs to correlate logs from the same operation
   ```javascript
   const requestId = uuidv4();
   await logger.info('Request started', { requestId });
   await logger.info('Request completed', { requestId, duration: '120ms' });
   ```

2. **Structured Metadata**: Use structured metadata for better searchability
   ```javascript
   // Good
   await logger.info('User purchase', { 
     userId: '123', 
     productId: 'abc', 
     amount: 99.99 
   });
   
   // Avoid
   await logger.info('User 123 purchased product abc for $99.99');
   ```

3. **Graceful Shutdown**: Always close the logger before exit
   ```javascript
   process.on('SIGTERM', async () => {
     await logger.close();
     process.exit(0);
   });
   ```

## Integration Examples

### Express

```javascript
import express from 'express';
import { LogVaultClient } from '@zerodowntime/logvault-client';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const logger = new LogVaultClient('YOUR_API_KEY', 'https://your-logvault-url');

app.use((req, res, next) => {
  req.requestId = uuidv4();
  req.logger = logger;
  
  logger.info('Request received', {
    requestId: req.requestId,
    method: req.method,
    path: req.path
  });
  
  res.on('finish', () => {
    logger.info('Request completed', {
      requestId: req.requestId,
      statusCode: res.statusCode,
      responseTime: Date.now() - req._startTime
    });
  });
  
  next();
});

app.get('/api/users', async (req, res) => {
  try {
    // Your code here
    res.json({ users: [] });
  } catch (error) {
    req.logger.error('Failed to fetch users', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).send('Internal Server Error');
  }
});
```