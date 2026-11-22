process.env.NGX_ISOLATED_TESTS = "true";
process.env.MONGODB_URI = "unconfigured://tests-must-stub-the-database";
process.env.ADMIN_MONGODB_URI = "";
process.env.FLY_API_TOKEN = "";
process.env.AWS_ACCESS_KEY_ID = "";
process.env.AWS_SECRET_ACCESS_KEY = "";
process.env.AUTH_SECRET = "isolated-tests-signing-secret";
