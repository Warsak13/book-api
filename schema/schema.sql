-- ============================================
-- Book API — Database Schema
-- Run this once against a fresh PostgreSQL database
-- to create all required tables.
-- ============================================

-- Users table
-- Stores account credentials, email, and password reset state.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password TEXT NOT NULL,               -- bcrypt hash, never plaintext
    email VARCHAR(255) UNIQUE,
    reset_token TEXT,
    reset_expiretime TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Books table
-- Each book belongs to the user who created it (user_id).
CREATE TABLE IF NOT EXISTS book (
    id SERIAL PRIMARY KEY,
    book_name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (book_name, type)
);

-- Reviews table
-- Each review belongs to both a book and the user who wrote it.
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    rew_text TEXT NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    book_id INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Helpful indexes for common lookups/filters
CREATE INDEX IF NOT EXISTS idx_book_user_id ON book(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_book_id ON reviews(book_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);