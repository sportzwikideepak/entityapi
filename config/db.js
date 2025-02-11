require("dotenv").config(); // Load environment variables
const mysql = require("mysql2"); // Import MySQL library

// Create a connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,         // Database host
  user: process.env.DB_USERNAME,     // Database username
  password: process.env.DB_PASSWORD, // Database password
  database: process.env.DB_DATABASE, // Database name
  port: process.env.DB_PORT || 3306, // Database port
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Error connecting to the database:", err.message); // Log error if connection fails
  } else {
    console.log("✅ Connected to the MySQL database!");
    connection.release(); // Release the connection back to the pool
  }
});

module.exports = pool.promise(); // Export the pool for async/await usage
