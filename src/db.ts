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
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' || (process.env.NODE_ENV === 'production' && process.env.DB_HOST !== 'book_api_postgres')
        ? { rejectUnauthorized: false }
        : false
});

pool.on('error', (err) => {
    console.error(`Unexpected error on idle Postgres client: ${err.message}`);
});

export default pool;
export {pool}