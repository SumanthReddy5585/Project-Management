// Tests always use the dedicated test database. Refuse anything else.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://pm:pm_dev_pw@localhost:5432/pm_test';
process.env.NODE_ENV = 'test';
process.env.JOBS_ENABLED = 'false';
process.env.UPLOAD_DIR = process.env.TEST_UPLOAD_DIR || '/tmp/pm-test-uploads';
if (!/_test(\?|$)/.test(new URL(process.env.DATABASE_URL).pathname + '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a database whose name ends in _test');
}
