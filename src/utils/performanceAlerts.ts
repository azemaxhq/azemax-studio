/**
 * Performance alerts and notifications system
 */

import { type PerformanceReport } from './performanceService';

export interface PerformanceAlert {
  id: string;
  type: 'improvement' | 'regression' | 'warning' | 'achievement';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: number;
  metrics: {
    current: number;
    previous: number;
    change: number;
  };
  category: 'execution' | 'memory' | 'cpu' | 'quality' | 'efficiency';
}

export interface PerformanceThresholds {
  executionTime: {
    warning: number; // ms
    critical: number; // ms
  };
  memoryUsage: {
    warning: number; // MB
    critical: number; // MB
  };
  cpuUsage: {
    warning: number; // %
    critical: number; // %
  };
  quality: {
    warning: number; // score
    critical: number; // score
  };
}

export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  executionTime: {
    warning: 2000, // 2 seconds
    critical: 10000 // 10 seconds
  },
  memoryUsage: {
    warning: 100, // 100MB
    critical: 500 // 500MB
  },
  cpuUsage: {
    warning: 80, // 80%
    critical: 95 // 95%
  },
  quality: {
    warning: 60, // score below 60
    critical: 40 // score below 40
  }
};

/**
 * Generate performance alerts based on current and previous metrics
 */
export const generatePerformanceAlerts = (
  currentReport: PerformanceReport,
  previousReport?: PerformanceReport,
  thresholds: PerformanceThresholds = DEFAULT_THRESHOLDS
): PerformanceAlert[] => {
  const alerts: PerformanceAlert[] = [];
  const { metrics } = currentReport;

  // Execution time alerts
  if (metrics.executionTime > thresholds.executionTime.critical) {
    alerts.push({
      id: `exec-critical-${Date.now()}`,
      type: 'warning',
      severity: 'critical',
      title: 'Critical Execution Time',
      message: `Execution time (${formatTime(metrics.executionTime)}) exceeds critical threshold of ${formatTime(thresholds.executionTime.critical)}`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.executionTime,
        previous: previousReport?.metrics.executionTime || 0,
        change: previousReport ? metrics.executionTime - previousReport.metrics.executionTime : 0
      },
      category: 'execution'
    });
  } else if (metrics.executionTime > thresholds.executionTime.warning) {
    alerts.push({
      id: `exec-warning-${Date.now()}`,
      type: 'warning',
      severity: 'medium',
      title: 'High Execution Time',
      message: `Execution time (${formatTime(metrics.executionTime)}) exceeds warning threshold of ${formatTime(thresholds.executionTime.warning)}`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.executionTime,
        previous: previousReport?.metrics.executionTime || 0,
        change: previousReport ? metrics.executionTime - previousReport.metrics.executionTime : 0
      },
      category: 'execution'
    });
  }

  // Memory usage alerts
  if (metrics.memoryUsage.peak > thresholds.memoryUsage.critical) {
    alerts.push({
      id: `mem-critical-${Date.now()}`,
      type: 'warning',
      severity: 'critical',
      title: 'Critical Memory Usage',
      message: `Memory usage (${formatMemory(metrics.memoryUsage.peak)}) exceeds critical threshold of ${formatMemory(thresholds.memoryUsage.critical)}`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.memoryUsage.peak,
        previous: previousReport?.metrics.memoryUsage.peak || 0,
        change: previousReport ? metrics.memoryUsage.peak - previousReport.metrics.memoryUsage.peak : 0
      },
      category: 'memory'
    });
  } else if (metrics.memoryUsage.peak > thresholds.memoryUsage.warning) {
    alerts.push({
      id: `mem-warning-${Date.now()}`,
      type: 'warning',
      severity: 'medium',
      title: 'High Memory Usage',
      message: `Memory usage (${formatMemory(metrics.memoryUsage.peak)}) exceeds warning threshold of ${formatMemory(thresholds.memoryUsage.warning)}`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.memoryUsage.peak,
        previous: previousReport?.metrics.memoryUsage.peak || 0,
        change: previousReport ? metrics.memoryUsage.peak - previousReport.metrics.memoryUsage.peak : 0
      },
      category: 'memory'
    });
  }

  // CPU usage alerts
  if (metrics.cpuUsage.peak > thresholds.cpuUsage.critical) {
    alerts.push({
      id: `cpu-critical-${Date.now()}`,
      type: 'warning',
      severity: 'critical',
      title: 'Critical CPU Usage',
      message: `CPU usage (${metrics.cpuUsage.peak.toFixed(1)}%) exceeds critical threshold of ${thresholds.cpuUsage.critical}%`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.cpuUsage.peak,
        previous: previousReport?.metrics.cpuUsage.peak || 0,
        change: previousReport ? metrics.cpuUsage.peak - previousReport.metrics.cpuUsage.peak : 0
      },
      category: 'cpu'
    });
  } else if (metrics.cpuUsage.peak > thresholds.cpuUsage.warning) {
    alerts.push({
      id: `cpu-warning-${Date.now()}`,
      type: 'warning',
      severity: 'medium',
      title: 'High CPU Usage',
      message: `CPU usage (${metrics.cpuUsage.peak.toFixed(1)}%) exceeds warning threshold of ${thresholds.cpuUsage.warning}%`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.cpuUsage.peak,
        previous: previousReport?.metrics.cpuUsage.peak || 0,
        change: previousReport ? metrics.cpuUsage.peak - previousReport.metrics.cpuUsage.peak : 0
      },
      category: 'cpu'
    });
  }

  // Code quality alerts
  if (metrics.quality.codeQuality < thresholds.quality.critical) {
    alerts.push({
      id: `quality-critical-${Date.now()}`,
      type: 'warning',
      severity: 'critical',
      title: 'Critical Code Quality',
      message: `Code quality score (${metrics.quality.codeQuality}/100) below critical threshold of ${thresholds.quality.critical}`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.quality.codeQuality,
        previous: previousReport?.metrics.quality.codeQuality || 0,
        change: previousReport ? metrics.quality.codeQuality - previousReport.metrics.quality.codeQuality : 0
      },
      category: 'quality'
    });
  } else if (metrics.quality.codeQuality < thresholds.quality.warning) {
    alerts.push({
      id: `quality-warning-${Date.now()}`,
      type: 'warning',
      severity: 'medium',
      title: 'Low Code Quality',
      message: `Code quality score (${metrics.quality.codeQuality}/100) below warning threshold of ${thresholds.quality.warning}`,
      timestamp: Date.now(),
      metrics: {
        current: metrics.quality.codeQuality,
        previous: previousReport?.metrics.quality.codeQuality || 0,
        change: previousReport ? metrics.quality.codeQuality - previousReport.metrics.quality.codeQuality : 0
      },
      category: 'quality'
    });
  }

  // Performance regression alerts (if previous report exists)
  if (previousReport) {
    const regressionThreshold = 20; // 20% regression triggers alert
    
    if (currentReport.comparison.improvement < -regressionThreshold) {
      alerts.push({
        id: `regression-${Date.now()}`,
        type: 'regression',
        severity: 'high',
        title: 'Performance Regression Detected',
        message: `Performance has regressed by ${Math.abs(currentReport.comparison.improvement).toFixed(1)}% compared to previous run`,
        timestamp: Date.now(),
        metrics: {
          current: currentReport.score,
          previous: previousReport.score,
          change: currentReport.score - previousReport.score
        },
        category: 'execution'
      });
    }

    // Significant improvement alerts
    if (currentReport.comparison.improvement > regressionThreshold) {
      alerts.push({
        id: `improvement-${Date.now()}`,
        type: 'improvement',
        severity: 'low',
        title: 'Performance Improvement Achieved',
        message: `Performance has improved by ${currentReport.comparison.improvement.toFixed(1)}% compared to previous run`,
        timestamp: Date.now(),
        metrics: {
          current: currentReport.score,
          previous: previousReport.score,
          change: currentReport.score - previousReport.score
        },
        category: 'execution'
      });
    }
  }

  // Achievement alerts
  if (currentReport.grade === 'A+') {
    alerts.push({
      id: `achievement-a-plus-${Date.now()}`,
      type: 'achievement',
      severity: 'low',
      title: 'Excellent Performance!',
      message: 'Achieved A+ grade with outstanding performance metrics',
      timestamp: Date.now(),
      metrics: {
        current: currentReport.score,
        previous: previousReport?.score || 0,
        change: previousReport ? currentReport.score - previousReport.score : 0
      },
      category: 'quality'
    });
  }

  return alerts;
};

/**
 * Format time for display
 */
const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
};

/**
 * Format memory for display
 */
const formatMemory = (mb: number): string => {
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
};

/**
 * Performance alert manager class
 */
export class PerformanceAlertManager {
  private static alerts: PerformanceAlert[] = [];
  private static maxAlerts = 50;
  private static storageKey = 'performance_alerts';

  /**
   * Add new alerts
   */
  static addAlerts(alerts: PerformanceAlert[]): void {
    this.alerts = [...this.alerts, ...alerts].slice(-this.maxAlerts);
    this.saveAlerts();
  }

  /**
   * Get all alerts
   */
  static getAlerts(): PerformanceAlert[] {
    return this.alerts;
  }

  /**
   * Get alerts by severity
   */
  static getAlertsBySeverity(severity: PerformanceAlert['severity']): PerformanceAlert[] {
    return this.alerts.filter(alert => alert.severity === severity);
  }

  /**
   * Get alerts by type
   */
  static getAlertsByType(type: PerformanceAlert['type']): PerformanceAlert[] {
    return this.alerts.filter(alert => alert.type === type);
  }

  /**
   * Clear all alerts
   */
  static clearAlerts(): void {
    this.alerts = [];
    this.saveAlerts();
  }

  /**
   * Clear alerts older than specified time
   */
  static clearOldAlerts(olderThanMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoff);
    this.saveAlerts();
  }

  /**
   * Save alerts to localStorage
   */
  private static saveAlerts(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.alerts));
    } catch (error) {
      console.warn('Failed to save performance alerts:', error);
    }
  }

  /**
   * Load alerts from localStorage
   */
  static loadAlerts(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Defensive: stored data is untrusted. A non-array payload must not
        // leave `alerts` in a state where getAlerts().filter() crashes, and a
        // huge payload is capped to the same bound as live additions.
        if (Array.isArray(parsed)) {
          this.alerts = parsed
            .filter((a): a is PerformanceAlert => !!a && typeof a === 'object' && typeof (a as PerformanceAlert).id === 'string')
            .slice(-this.maxAlerts);
        } else {
          this.alerts = [];
        }
      }
    } catch (error) {
      console.warn('Failed to load performance alerts:', error);
      this.alerts = [];
    }
  }

  /**
   * Get alert count by severity
   */
  static getAlertCount(): Record<PerformanceAlert['severity'], number> {
    return this.alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<PerformanceAlert['severity'], number>);
  }
}

// Initialize alerts on load
PerformanceAlertManager.loadAlerts();
