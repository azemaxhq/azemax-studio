import type { AnalysisResult } from './codeAnalysisEngine';
import { namespacedKey } from './userStorage';

export interface AnalysisSnapshot {
    timestamp: number;
    fileId: string;
    fileName: string;
    analysis: AnalysisResult;
}

export interface TrendData {
    fileId: string;
    fileName: string;
    snapshots: AnalysisSnapshot[];
    trend: {
        improving: boolean;
        changeRate: number; // percentage change over time
        stability: number; // how stable the score is (0-100)
    };
}

class AnalysisHistoryManager {
    private get storageKey() { return namespacedKey('codeAnalysis_history'); }
    private maxSnapshotsPerFile = 50; // Keep last 50 analyses per file
    private maxAgeDays = 90; // Keep data for 90 days

    // Save a new analysis snapshot
    saveSnapshot(fileId: string, fileName: string, analysis: AnalysisResult): void {
        try {
            const history = this.getHistory();
            const snapshot: AnalysisSnapshot = {
                timestamp: Date.now(),
                fileId,
                fileName,
                analysis
            };

            // Add or update file history
            if (!history[fileId]) {
                history[fileId] = {
                    fileId,
                    fileName,
                    snapshots: [],
                    trend: {
                        improving: true,
                        changeRate: 0,
                        stability: 100
                    }
                };
            }

            // Add new snapshot
            history[fileId].snapshots.push(snapshot);

            // Clean old snapshots
            history[fileId].snapshots = this.cleanSnapshots(history[fileId].snapshots);

            // Update trend data
            history[fileId].trend = this.calculateTrend(history[fileId].snapshots);

            // Save to localStorage
            localStorage.setItem(this.storageKey, JSON.stringify(history));
        } catch (error) {
            console.error('[AnalysisHistory] Failed to save snapshot:', error);
        }
    }

    // Get all history or specific file history
    getHistory(fileId?: string): Record<string, TrendData> {
        try {
            const stored = localStorage.getItem(this.storageKey);
            const history = stored ? JSON.parse(stored) : {};
            
            if (fileId) {
                return { [fileId]: history[fileId] || null };
            }
            
            return history;
        } catch (error) {
            console.error('[AnalysisHistory] Failed to load history:', error);
            return {};
        }
    }

    // Get trend data for a specific file
    getTrendData(fileId: string): TrendData | null {
        const history = this.getHistory();
        return history[fileId] || null;
    }

    // Get recent snapshots for a file
    getRecentSnapshots(fileId: string, count: number = 10): AnalysisSnapshot[] {
        const trendData = this.getTrendData(fileId);
        if (!trendData) return [];
        
        return trendData.snapshots
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, count);
    }

    // Clean old snapshots based on limits
    private cleanSnapshots(snapshots: AnalysisSnapshot[]): AnalysisSnapshot[] {
        const now = Date.now();
        const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000;

        // Filter by age
        let filtered = snapshots.filter(s => now - s.timestamp < maxAge);

        // If still too many, keep only the most recent
        if (filtered.length > this.maxSnapshotsPerFile) {
            filtered = filtered
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, this.maxSnapshotsPerFile);
        }

        return filtered;
    }

    // Calculate trend metrics
    private calculateTrend(snapshots: AnalysisSnapshot[]): TrendData['trend'] {
        if (snapshots.length < 2) {
            return {
                improving: true,
                changeRate: 0,
                stability: 100
            };
        }

        // Sort by timestamp
        const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
        
        // Get scores over time
        const scores = sorted.map(s => s.analysis.codeAgeing);
        
        // Calculate trend (is it improving?)
        const recentScores = scores.slice(-5); // Last 5 snapshots
        const olderScores = scores.slice(0, -5); // Earlier snapshots
        
        const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const olderAvg = olderScores.length > 0 
            ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length 
            : recentAvg;

        const improving = recentAvg < olderAvg; // Lower score is better
        
        // Calculate change rate (percentage change)
        const changeRate = olderAvg > 0 ? ((olderAvg - recentAvg) / olderAvg) * 100 : 0;
        
        // Calculate stability (how much the scores vary)
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
        const standardDeviation = Math.sqrt(variance);
        const stability = Math.max(0, Math.min(100, 100 - (standardDeviation / mean) * 100));

        return {
            improving,
            changeRate: Math.round(changeRate * 10) / 10, // Round to 1 decimal
            stability: Math.round(stability)
        };
    }

    // Clear all history
    clearHistory(): void {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('[AnalysisHistory] Failed to clear history:', error);
        }
    }

    // Clear history for specific file
    clearFileHistory(fileId: string): void {
        try {
            const history = this.getHistory();
            delete history[fileId];
            localStorage.setItem(this.storageKey, JSON.stringify(history));
        } catch (error) {
            console.error('[AnalysisHistory] Failed to clear file history:', error);
        }
    }

    // Export history data
    exportHistory(): string {
        const history = this.getHistory();
        return JSON.stringify(history, null, 2);
    }

    // Import history data
    importHistory(data: string): boolean {
        try {
            const history = JSON.parse(data);
            localStorage.setItem(this.storageKey, JSON.stringify(history));
            return true;
        } catch (error) {
            console.error('[AnalysisHistory] Failed to import history:', error);
            return false;
        }
    }
}

// Singleton instance
export const analysisHistory = new AnalysisHistoryManager();
