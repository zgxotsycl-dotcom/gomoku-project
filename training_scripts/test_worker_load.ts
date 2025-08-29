console.log("Attempting to load the game worker...");
try {
    const worker = new Worker(new URL("./game_worker.ts", import.meta.url).href, { type: "module" });
    console.log("Worker script loaded successfully. Terminating worker.");
    worker.terminate();
} catch (e) {
    console.error("Failed to load worker:", e);
}
