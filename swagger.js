// swagger.js
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Book Boilerplate API',
            version: '1.0.0',
            description: 'Books, reviews, and users',
        },
        servers: [{ url: 'http://localhost:6780' }],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'token'
                }
            }
        }
    },
    apis: ['./Book_API.js'],
};

module.exports = swaggerJsdoc(options);