"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const metrics_1 = require("../searcher/metrics");
const PORT = process.env.DASHBOARD_PORT ? Number(process.env.DASHBOARD_PORT) : 8787;
const INDEX = path_1.default.join(process.cwd(), "src", "dashboard", "static", "index.html");
const server = http_1.default.createServer((req, res) => {
    if (!req.url)
        return;
    if (req.url === "/" || req.url === "/index.html") {
        res.setHeader("Content-Type", "text/html");
        res.end(fs_1.default.readFileSync(INDEX));
        return;
    }
    if (req.url.startsWith("/metrics")) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify((0, metrics_1.readMetrics)()));
        return;
    }
    res.statusCode = 404;
    res.end("Not Found");
});
server.listen(PORT, () => {
    console.log(`EV Dashboard running: http://localhost:${PORT}`);
});
