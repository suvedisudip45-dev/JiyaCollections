// CommonJS entry wrapper for cPanel Phusion Passenger ("Setup Node.js App").
// Loads the ES module server regardless of whether Passenger uses require().
import("./server.js").catch((error) => {
  console.error("Failed to start backend server:", error);
  process.exit(1);
});
