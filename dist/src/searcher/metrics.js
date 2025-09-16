"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMetric = recordMetric;
exports.readMetrics = readMetrics;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const METRICS_FILE = path_1.default.join(DATA_DIR, "metrics.json");
function recordMetric(m) {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR);
    let arr = [];
    if (fs_1.default.existsSync(METRICS_FILE)) {
        try {
            arr = JSON.parse(fs_1.default.readFileSync(METRICS_FILE, "utf-8"));
        }
        catch { }
    }
    arr.push(m);
    fs_1.default.writeFileSync(METRICS_FILE, JSON.stringify(arr.slice(-2000), null, 2));
}
function readMetrics() {
    if (!fs_1.default.existsSync(METRICS_FILE))
        return [];
    try {
        return JSON.parse(fs_1.default.readFileSync(METRICS_FILE, "utf-8"));
    }
    catch {
        return [];
    }
}
