// scripts/strategy-scan.ts
import "dotenv/config";
import { runStrategyLoop, runStrategyScanOnce } from "../src/searcher/strategy";

const mode = (process.argv[2] || "loop").toLowerCase();
if (mode === "once") {
  runStrategyScanOnce().then(() => process.exit(0), () => process.exit(1));
} else {
  runStrategyLoop(); // keep alive
}
