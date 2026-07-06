# Book API
A REST API for managing books and user reviews, with full CRUD functionality, 
JWT authentication, ownership-based permissions, Redis caching with automatic 
fallback to PostgreSQL, and rate limiting to guard against abuse. CORS is 
configured to control exactly which frontends can talk to it. Built as a 
portfolio piece to demonstrate backend architecture and API design.

## Features
- Full CRUD functionality for books and users
- JWT authentication with bcrypt password hashing
- Rate limiting, with stricter limits for auth routes 
- Redis caching with automate fallback to PostgreSQL
- CORS restricted to a specific origin whitelist
- Structured logging with winston (daily log rotation)
- Swagger/OpenAPI documentation
- Ownership-based authorization
- Sending emails via Nodemailer
- Parameterized queries to prevent SQL injection

## Tech stack
Node.js, Express, PostgreSQL, Redis, JWT, bcrypt, express-rate-limit, Helmet, Swagger, cookie-parser, CORS, Winston, Nodemailer

## Getting started

### Prerequisites

Before running this project, ensure the following are installed:

- **[Node.js](https://nodejs.org/)** (v18 or higher) — required to run the server
- **[PostgreSQL](https://www.postgresql.org/download/)** — primary data store
- **[Redis](https://redis.io/docs/getting-started/installation/)** (optional) — used for caching. If unavailable, the application automatically falls back to querying PostgreSQL directly, with no loss of functionality.
- **npm** — included with Node.js installation

Verify installation by running:

```bash
node --version
npm --version
psql --version
redis-cli --version
```

If any command returns an error, that dependency is either not installed or not available in your system PATH.

## Installation

1. Clone the repository
```bash
   git clone https://github.com/yourusername/book-api.git
   cd book-api
```

2. Install dependencies
```bash
   npm install
```
   This installs all required packages listed in `package.json`, including Express, PostgreSQL and Redis clients, JWT/bcrypt for authentication, and supporting middleware. No manual downloads are necessary.

3. Configure environment variables
   Copy the example file and populate it with your own values:
```bash
   cp .env.example .env
```

4. Set up the database
   Run the SQL schema against your PostgreSQL instance:
```bash
   psql -U your_user -d your_database -f schema/schema.sql
```

5. Start the server
```bash
   npm start
```

   On successful startup, the console will display:
   
    {"level":"info","message":"Running at server http://localhost:6780"}

## API Documentation

Once the server is up and running, an interactive Swagger UI is available at:

http://localhost:6780/api-docs

This provides a live, browsable interface for every endpoint — including request/response schemas and the ability to execute real requests directly from the browser.

### A note on the "Authorize" button

You'll see a padlock icon 🔒 next to protected routes, and an "Authorize" button at the top of the page. Ignore it. It's decorative at this point — a bit like a doorbell wired to nothing, still very pretty, still fools everyone the first time.

This API uses **`httpOnly` cookie-based authentication**, not bearer tokens. That means:
- There's no token to copy-paste anywhere, because the server deliberately hides it from JavaScript (yes, even Swagger's own JavaScript) as a security measure.
- Once you log in, your browser silently holds onto a cookie and attaches it to every future request automatically — no manual step required, no button to click, no ritual to perform.

**To test authenticated routes:**
1. Register a user via `POST /register`.
2. Log in via `POST /login`. You won't get a visible token back — just a success message. This is intentional.
3. Skip the Authorize button entirely.
4. Execute any protected route (e.g. `POST /book`) directly. Your browser will already be carrying the cookie from step 2, and the request will succeed automatically.

If you log out, clear cookies, or the cookie expires (24h), protected routes will correctly reject you with a `401 No token` — which is your proof the whole thing is actually working, not just politely lying to you.

## API Reference

| Method | Endpoint             | Auth Required | Description                              |
|--------|----------------------|----------------|-------------------------------------------|
| POST   | `/register`          | No             | Create a new user account                 |
| POST   | `/login`             | No             | Log in (sets an `httpOnly` cookie)         |
| POST   | `/logout`            | No             | Log out (Clear the token cookie) |
| POST   | `/forgot_password`   | No             | Request a password reset email            |
| POST   | `/reset_password`    | No             | Reset password using a valid token        |
| GET    | `/book`              | No             | List books (supports `search`, `type`, `page`) |
| GET    | `/book/:id`          | No             | Get a single book                         |
| POST   | `/book`              | Yes            | Create a book                             |
| PUT    | `/book/:id`          | Yes (owner)    | Update a book                             |
| DELETE | `/book/:id`          | Yes (owner)    | Delete a book                             |
| GET    | `/reviews?book_id=`  | No             | Get reviews for a book                    |
| POST   | `/reviews`           | Yes            | Post a review                             |
| PUT    | `/reviews/:id`       | Yes (owner)    | Edit your own review                      |
| DELETE | `/reviews/:id`       | Yes (owner)    | Delete your own review                    |
| GET    | `/health`            | No             | Check server/DB/Redis status              |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Yes | PostgreSQL connection details |
| `JWT_SECRET` | Yes | Long random string used to sign tokens |
| `PORT`       | No  | Defaults to 6780 if omitted
| `REDIS_PORT` | No | Defaults to 6379 if omitted |
| `EMAIL_USER`, `EMAIL_PASS` | Yes (for password reset) | Gmail credentials for Nodemailer |
| `ALLOWED_ORIGINS` | Yes | Comma-separated list of frontend URLs allowed via CORS |
| `NODE_ENV` | Yes | `development` or `production` — controls cookie security behavior |

## Limitations

- No file upload support
- Reviews cannot support images
- No refresh token flow
- No payment method

## Notes

This repository is a demonstration/portfolio project showcasing backend architecture, 
authentication, and security practices. The sample data (books, reviews, users) exists 
for demo purposes only.

The codebase itself — auth, validation, rate limiting, caching — is written to 
production-quality standards and is intended to serve as a boilerplate for real 
client projects. Deploying THIS exact repository as-is (with placeholder data and 
`localhost` configuration) is not recommended without adapting it to your specific 
use case (database, domain, environment variables, etc).