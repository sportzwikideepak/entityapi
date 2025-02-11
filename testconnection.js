const pool = require("./db"); // Import the database connection

async function testConnection() {
  try {
    // Run a simple query to test the connection
    const [rows] = await pool.query("SELECT 1 AS test");
    console.log("✅ Test query successful:", rows); // Log successful test results
  } catch (error) {
    console.error("❌ Error testing database connection:", error.message); // Log any errors
  }
}

testConnection(); // Execute the test function
