"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/fs01_marketplace',
    mongoDbName: process.env.MONGO_DB_NAME || 'fs01_marketplace',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    elasticsearchUrl: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h'
};
//# sourceMappingURL=index.js.map