import dotenvx from '@dotenvx/dotenvx';
dotenvx.config({quiet: true});
import { Pool } from 'pg';

// Initialize environment variables
dotenvx.config();

// Create a typed PostgreSQL connection pool
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT as string, 10) : 5432,
    database: process.env.DB_NAME
});

export default pool;