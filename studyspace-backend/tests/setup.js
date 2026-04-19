// tests/setup.js
process.env.NODE_ENV     = 'test';
process.env.JWT_SECRET   = 'test-jwt-secret-at-least-32-chars-long!';
process.env.JWT_EXPIRES_IN = '1h';
process.env.DB_HOST      = process.env.DB_HOST  || 'localhost';
process.env.DB_PORT      = process.env.DB_PORT  || '5432';
process.env.DB_NAME      = process.env.TEST_DB_NAME || 'studyspace_test';
process.env.DB_USER      = process.env.DB_USER  || 'studyspace_user';
process.env.DB_PASSWORD  = process.env.DB_PASSWORD || '';
process.env.REDIS_HOST   = process.env.REDIS_HOST || 'localhost';
process.env.LOG_LEVEL    = 'error'; // suppress logs during tests
