/**
 * Performance profiling service for code execution analysis
 */

export interface PerformanceMetrics {
  executionTime: number;
  memoryUsage: {
    peak: number;
    average: number;
    final: number;
  };
  cpuUsage: {
    peak: number;
    average: number;
  };
  operations: {
    totalOperations: number;
    operationsPerSecond: number;
    bigOComplexity?: string;
  };
  ioStats: {
    bytesRead: number;
    bytesWritten: number;
    fileOperations: number;
  };
  errors: {
    count: number;
    types: string[];
  };
  warnings: {
    count: number;
    messages: string[];
  };
  timestamp: number;
  language: string;
  codeSize: {
    lines: number;
    characters: number;
    tokens?: number;
  };
  // Additional advanced metrics
  efficiency: {
    timePerOperation: number;
    memoryPerLine: number;
    cpuEfficiency: number;
  };
  quality: {
    codeQuality: number;
    maintainability: number;
    complexity: number;
  };
}

export interface PerformanceReport {
  metrics: PerformanceMetrics;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  recommendations: string[];
  bottlenecks: PerformanceBottleneck[];
  comparison: {
    previousRun?: PerformanceMetrics;
    improvement: number;
  };
}

export interface PerformanceBottleneck {
  type: 'memory' | 'cpu' | 'io' | 'algorithm' | 'error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  description: string;
  suggestion: string;
  impact: string;
}

/**
 * Analyze code performance based on execution metrics
 */
export const analyzePerformance = (
  code: string,
  language: string,
  executionTime: number,
  stdout: string,
  stderr: string,
  exitCode: number
): PerformanceReport => {
  const metrics = generateMetrics(code, language, executionTime, stdout, stderr, exitCode);
  const bottlenecks = identifyBottlenecks(metrics, code, language);
  const grade = calculatePerformanceGrade(metrics);
  const recommendations = generateRecommendations(metrics, bottlenecks, language);
  const score = calculateScore(metrics);

  return {
    metrics,
    grade,
    score,
    recommendations,
    bottlenecks,
    comparison: {
      improvement: 0 // Will be calculated when comparing with previous runs
    }
  };
};

/**
 * Generate performance metrics from execution data
 */
const generateMetrics = (
  code: string,
  language: string,
  executionTime: number,
  stdout: string,
  stderr: string,
  exitCode: number
): PerformanceMetrics => {
  const lines = code.split('\n').length;
  const characters = code.length;
  
  // Estimate memory usage based on language and code complexity
  const estimatedMemory = estimateMemoryUsage(code, language);
  
  // Estimate CPU usage based on execution time and complexity
  const estimatedCpu = estimateCpuUsage(executionTime, code, language);
  
  // Count operations from stdout patterns
  const operations = parseOperations(stdout, language);
  
  // Parse I/O from output
  const ioStats = parseIOStats(stdout, stderr);
  
  // Analyze errors and warnings
  const errors = parseErrors(stderr, exitCode);
  const warnings = parseWarnings(stderr, stdout);

  // Calculate efficiency metrics
  const timePerOperation = operations.totalOperations > 0 ? executionTime / operations.totalOperations : 0;
  const memoryPerLine = lines > 0 ? estimatedMemory.peak / lines : 0;
  const cpuEfficiency = executionTime > 0 ? (100 - estimatedCpu.peak) / executionTime : 0;

  // Calculate quality metrics
  const complexity = calculateComplexity(code, language);
  const codeQuality = calculateCodeQuality(code, language, errors.count, warnings.count);
  const maintainability = calculateMaintainability(code, lines, complexity);

  return {
    executionTime,
    memoryUsage: estimatedMemory,
    cpuUsage: estimatedCpu,
    operations,
    ioStats,
    errors,
    warnings,
    timestamp: Date.now(),
    language,
    codeSize: {
      lines,
      characters,
      tokens: estimateTokens(code)
    },
    efficiency: {
      timePerOperation,
      memoryPerLine,
      cpuEfficiency
    },
    quality: {
      codeQuality,
      maintainability,
      complexity
    }
  };
};

/**
 * Estimate memory usage based on code patterns
 */
const estimateMemoryUsage = (code: string, language: string): PerformanceMetrics['memoryUsage'] => {
  let memoryFactor = 1;
  
  // Language-specific memory patterns
  switch (language) {
    case 'python':
      memoryFactor = analyzePythonMemory(code);
      break;
    case 'javascript':
    case 'typescript':
      memoryFactor = analyzeJSMemory(code);
      break;
    case 'java':
      memoryFactor = analyzeJavaMemory(code);
      break;
    case 'cpp':
    case 'c':
      memoryFactor = analyzeCMemory(code);
      break;
    default:
      memoryFactor = 1;
  }
  
  const baseMemory = 10; // Base 10MB
  const peak = baseMemory * memoryFactor;
  const average = peak * 0.7;
  const final = peak * 0.3;
  
  return { peak, average, final };
};

/**
 * Analyze Python-specific memory patterns
 */
const analyzePythonMemory = (code: string): number => {
  let factor = 1;
  
  // Large data structures
  if (code.includes('list') || code.includes('dict')) factor *= 1.5;
  if (code.includes('numpy') || code.includes('pandas')) factor *= 2;
  if (code.includes('[]') && code.split('[]').length > 3) factor *= 1.3;
  
  // Memory-intensive operations
  if (code.includes('.append(') || code.includes('.extend(')) factor *= 1.2;
  if (code.includes('deepcopy')) factor *= 1.8;
  
  return factor;
};

/**
 * Analyze JavaScript/TypeScript memory patterns
 */
const analyzeJSMemory = (code: string): number => {
  let factor = 1;
  
  if (code.includes('Array(') || code.includes('[]')) factor *= 1.4;
  if (code.includes('Object.assign') || code.includes('spread')) factor *= 1.3;
  if (code.includes('map(') || code.includes('filter(')) factor *= 1.2;
  if (code.includes('Promise.all')) factor *= 1.5;
  
  return factor;
};

/**
 * Analyze Java memory patterns
 */
const analyzeJavaMemory = (code: string): number => {
  let factor = 1;
  
  if (code.includes('ArrayList') || code.includes('HashMap')) factor *= 1.6;
  if (code.includes('new ') && code.split('new ').length > 5) factor *= 1.4;
  if (code.includes('String(')) factor *= 1.2;
  
  return factor;
};

/**
 * Analyze C/C++ memory patterns
 */
const analyzeCMemory = (code: string): number => {
  let factor = 1;
  
  if (code.includes('malloc(') || code.includes('calloc(')) factor *= 2;
  if (code.includes('free(')) factor *= 0.8; // Good memory management
  if (code.includes('sizeof(')) factor *= 1.1;
  if (code.includes('struct') || code.includes('class')) factor *= 1.3;
  
  return factor;
};

/**
 * Estimate CPU usage based on execution time and code complexity
 */
const estimateCpuUsage = (executionTime: number, code: string, language: string): PerformanceMetrics['cpuUsage'] => {
  let complexityFactor = 1;
  
  // Analyze code complexity
  const loops = (code.match(/for\s*\(|while\s*\(/g) || []).length;
  const recursion = code.includes('function') && code.includes(code.match(/function\s+\w+\s*\(/)?.[0] || '');
  const nestedLoops = loops > 2 ? 1.5 : 1;
  
  complexityFactor *= (1 + loops * 0.2);
  complexityFactor *= nestedLoops;
  if (recursion) complexityFactor *= 1.3;
  
  // Language-specific CPU factors
  switch (language) {
    case 'python':
      complexityFactor *= 1.2; // Python is generally slower
      break;
    case 'javascript':
    case 'typescript':
      complexityFactor *= 1.1;
      break;
    case 'cpp':
    case 'c':
    case 'rust':
      complexityFactor *= 0.8; // Compiled languages are faster
      break;
  }
  
  const baseCpu = Math.min(95, executionTime * 10); // Base CPU estimation
  const peak = Math.min(100, baseCpu * complexityFactor);
  const average = peak * 0.6;
  
  return { peak, average };
};

/**
 * Parse operations from stdout
 */
const parseOperations = (stdout: string, _language: string): PerformanceMetrics['operations'] => {
  let totalOperations = 0;
  let operationsPerSecond = 0;
  
  // Try to extract operation counts from output
  const numbers = stdout.match(/\d+/g);
  if (numbers) {
    totalOperations = numbers.reduce((sum, num) => sum + parseInt(num), 0);
  }
  
  // Estimate operations based on common patterns
  if (stdout.includes('iterations') || stdout.includes('loops')) {
    const matches = stdout.match(/(\d+)\s*(?:iterations|loops|times)/);
    if (matches) {
      totalOperations = Math.max(totalOperations, parseInt(matches[1]));
    }
  }
  
  // Calculate operations per second (estimate)
  const estimatedTime = 1; // Assume 1 second if we can't determine
  operationsPerSecond = totalOperations / estimatedTime;
  
  // Determine Big O complexity based on patterns
  let bigOComplexity: string | undefined;
  if (totalOperations > 1000000) bigOComplexity = 'O(n²) or higher';
  else if (totalOperations > 10000) bigOComplexity = 'O(n log n)';
  else if (totalOperations > 100) bigOComplexity = 'O(n)';
  else bigOComplexity = 'O(1)';
  
  return {
    totalOperations,
    operationsPerSecond,
    bigOComplexity
  };
};

/**
 * Parse I/O statistics
 */
const parseIOStats = (stdout: string, stderr: string): PerformanceMetrics['ioStats'] => {
  const output = stdout + stderr;
  
  // Count file operations
  const fileOps = (output.match(/open|read|write|close/g) || []).length;
  
  // Estimate bytes (rough calculation)
  const bytesRead = output.length * 10; // Rough estimate
  const bytesWritten = stdout.length * 10;
  
  return {
    bytesRead,
    bytesWritten,
    fileOperations: fileOps
  };
};

/**
 * Parse errors from stderr
 */
const parseErrors = (stderr: string, exitCode: number): PerformanceMetrics['errors'] => {
  const errorTypes: string[] = [];
  let count = 0;
  
  if (exitCode !== 0) count++;
  
  // Common error patterns
  if (stderr.includes('Error:') || stderr.includes('error:')) {
    errorTypes.push('Runtime Error');
    count++;
  }
  
  if (stderr.includes('TypeError') || stderr.includes('type error')) {
    errorTypes.push('Type Error');
    count++;
  }
  
  if (stderr.includes('Memory') || stderr.includes('memory')) {
    errorTypes.push('Memory Error');
    count++;
  }
  
  if (stderr.includes('Stack') || stderr.includes('stack')) {
    errorTypes.push('Stack Error');
    count++;
  }
  
  return { count, types: errorTypes };
};

/**
 * Parse warnings from output
 */
const parseWarnings = (stderr: string, stdout: string): PerformanceMetrics['warnings'] => {
  const output = stderr + stdout;
  const messages: string[] = [];
  let count = 0;
  
  // Common warning patterns
  if (output.includes('Warning:') || output.includes('warning:')) {
    messages.push('General Warning');
    count++;
  }
  
  if (output.includes('deprecated')) {
    messages.push('Deprecated Usage');
    count++;
  }
  
  if (output.includes('slow') || output.includes('inefficient')) {
    messages.push('Performance Warning');
    count++;
  }
  
  return { count, messages };
};

type BottleneckRule = { test: (m: PerformanceMetrics, lang: string) => boolean; bottleneck: PerformanceBottleneck | ((m: PerformanceMetrics) => PerformanceBottleneck) };
const BOTTLENECK_RULES: BottleneckRule[] = [
  { test: (m) => m.memoryUsage.peak > 100, bottleneck: { type: 'memory', severity: 'high', description: 'High memory usage detected', suggestion: 'Consider optimizing data structures or implementing memory pooling', impact: 'May cause slowdowns on systems with limited RAM' } },
  { test: (m) => m.cpuUsage.peak > 80, bottleneck: { type: 'cpu', severity: 'medium', description: 'High CPU usage during execution', suggestion: 'Optimize algorithms or consider parallel processing', impact: 'Affects system responsiveness' } },
  { test: (m) => m.executionTime > 5, bottleneck: { type: 'algorithm', severity: 'medium', description: 'Slow execution detected', suggestion: 'Review algorithm efficiency and consider optimizations', impact: 'Poor user experience and resource utilization' } },
  { test: (m) => m.errors.count > 0, bottleneck: (m) => ({ type: 'error', severity: 'critical', description: `Execution failed with ${m.errors.count} error(s)`, suggestion: 'Fix errors before optimizing performance', impact: 'Prevents successful execution' }) },
  { test: (m, lang) => lang === 'python' && m.executionTime > 2, bottleneck: { type: 'algorithm', severity: 'medium', description: 'Python execution is slow', suggestion: 'Consider using NumPy for numerical operations or rewrite in a compiled language', impact: 'Significant performance improvement possible' } },
];

const identifyBottlenecks = (metrics: PerformanceMetrics, _code: string, language: string): PerformanceBottleneck[] => {
  const out: PerformanceBottleneck[] = [];
  for (const rule of BOTTLENECK_RULES) if (rule.test(metrics, language)) {
    out.push(typeof rule.bottleneck === 'function' ? (rule.bottleneck as (m: PerformanceMetrics) => PerformanceBottleneck)(metrics) : rule.bottleneck as PerformanceBottleneck);
  }
  return out;
};

const GRADE_THRESHOLDS: Array<{ limit: number; grade: PerformanceReport['grade'] }> = [
  { limit: 95, grade: 'A+' },
  { limit: 90, grade: 'A' },
  { limit: 80, grade: 'B' },
  { limit: 70, grade: 'C' },
  { limit: 60, grade: 'D' },
];

function penaltyFor(value: number, table: Array<{ limit: number; penalty: number }>): number {
  for (const row of table) if (value > row.limit) return row.penalty;
  return 0;
}

/**
 * Calculate performance grade (table-driven to reduce branching)
 */
const calculatePerformanceGrade = (metrics: PerformanceMetrics): PerformanceReport['grade'] => {
  let score = 100;
  score -= penaltyFor(metrics.executionTime, [{ limit: 10, penalty: 30 }, { limit: 5, penalty: 20 }, { limit: 2, penalty: 10 }, { limit: 1, penalty: 5 }]);
  score -= penaltyFor(metrics.memoryUsage.peak, [{ limit: 200, penalty: 25 }, { limit: 100, penalty: 15 }, { limit: 50, penalty: 8 }]);
  score -= penaltyFor(metrics.cpuUsage.peak, [{ limit: 90, penalty: 20 }, { limit: 70, penalty: 10 }]);
  score -= metrics.errors.count * 15;
  score -= metrics.warnings.count * 5;
  for (const row of GRADE_THRESHOLDS) if (score >= row.limit) return row.grade;
  return 'F';
};

/**
 * Calculate performance score (0-100)
 */
const calculateScore = (metrics: PerformanceMetrics): number => {
  let score = 100;
  
  // Time factor (0-40 points)
  const timeScore = Math.max(0, 40 - metrics.executionTime * 4);
  
  // Memory factor (0-30 points)
  const memoryScore = Math.max(0, 30 - metrics.memoryUsage.peak * 0.15);
  
  // CPU factor (0-20 points)
  const cpuScore = Math.max(0, 20 - metrics.cpuUsage.peak * 0.2);
  
  // Error/Warning factor (0-10 points)
  const errorScore = Math.max(0, 10 - metrics.errors.count * 5 - metrics.warnings.count * 2);
  
  score = Math.round(timeScore + memoryScore + cpuScore + errorScore);
  return score;
};

/**
 * Generate performance recommendations
 */
const generateRecommendations = (
  metrics: PerformanceMetrics,
  bottlenecks: PerformanceBottleneck[],
  language: string
): string[] => {
  const recommendations: string[] = [];
  
  // Time-based recommendations
  if (metrics.executionTime > 2) {
    recommendations.push('Consider optimizing algorithms for better time complexity');
    if (language === 'python') {
      recommendations.push('Use built-in functions and libraries like NumPy for better performance');
    }
  }
  
  // Memory-based recommendations
  if (metrics.memoryUsage.peak > 50) {
    recommendations.push('Implement memory-efficient data structures');
    recommendations.push('Consider using generators or lazy evaluation');
  }
  
  // CPU-based recommendations
  if (metrics.cpuUsage.peak > 70) {
    recommendations.push('Optimize hot paths and critical sections');
    recommendations.push('Consider parallel processing for independent tasks');
  }
  
  // Language-specific recommendations
  switch (language) {
    case 'python':
      recommendations.push('Use list comprehensions instead of loops');
      recommendations.push('Consider using @lru_cache for memoization');
      break;
    case 'javascript':
    case 'typescript':
      recommendations.push('Use Object.freeze() for immutable data');
      recommendations.push('Consider using Web Workers for heavy computations');
      break;
    case 'java':
      recommendations.push('Use StringBuilder for string concatenation');
      recommendations.push('Consider using primitive types where possible');
      break;
  }
  
  // Bottleneck-specific recommendations
  bottlenecks.forEach(bottleneck => {
    if (!recommendations.includes(bottleneck.suggestion)) {
      recommendations.push(bottleneck.suggestion);
    }
  });
  
  return recommendations.slice(0, 6); // Limit to 6 recommendations
};

/**
 * Estimate token count for code
 */
const estimateTokens = (code: string): number => {
  // Rough estimation: ~4 characters per token
  return Math.round(code.length / 4);
};

/**
 * Calculate code quality score based on various factors
 */
const calculateCodeQuality = (code: string, language: string, errorCount: number, warningCount: number): number => {
  let quality = 100;
  
  // Deduct for errors and warnings
  quality -= errorCount * 20;
  quality -= warningCount * 5;
  
  // Language-specific quality checks
  switch (language) {
    case 'javascript':
    case 'typescript':
      // Check for modern syntax
      if (code.includes('var')) quality -= 10;
      if (!code.includes('const') && !code.includes('let')) quality -= 5;
      break;
    case 'python':
      // Check for Python best practices
      if (code.includes('print(') && !code.includes('logging')) quality -= 5;
      break;
  }
  
  return Math.max(0, Math.min(100, quality));
};

/**
 * Calculate maintainability score
 */
const calculateMaintainability = (code: string, lines: number, complexity: number): number => {
  let maintainability = 100;
  
  // Function length penalty
  const functions = code.match(/function\s+\w+|def\s+\w+/g) || [];
  functions.forEach(func => {
    const funcLines = func.split('\n').length;
    if (funcLines > 50) maintainability -= 10;
    else if (funcLines > 20) maintainability -= 5;
  });
  
  // Complexity penalty
  maintainability -= complexity * 2;
  
  // Lines penalty
  if (lines > 1000) maintainability -= 20;
  else if (lines > 500) maintainability -= 10;
  
  return Math.max(0, Math.min(100, maintainability));
};

/**
 * Calculate code complexity
 */
const calculateComplexity = (code: string, language: string): number => {
  let complexity = 1; // Base complexity
  
  // Count control flow statements
  const controlStatements = code.match(/if|else|for|while|switch|case|try|catch/g) || [];
  complexity += controlStatements.length;
  
  // Count nested structures
  const nesting = code.match(/\{/g) || [];
  complexity += nesting.length * 0.5;
  
  // Language-specific complexity
  switch (language) {
    case 'javascript':
    case 'typescript': {
      const callbacks = code.match(/=>|function|callback/g) || [];
      complexity += callbacks.length * 2;
      break;
    }
    case 'python': {
      const decorators = code.match(/@/g) || [];
      complexity += decorators.length;
      break;
    }
  }
  
  return Math.round(complexity);
};

/**
 * Store and retrieve performance history
 */
export class PerformanceHistory {
  private static storageKey = 'performance_history';
  
  static save(report: PerformanceReport): void {
    try {
      const history = this.getHistory();
      history.push(report);
      
      // Keep only last 20 reports
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }
      
      localStorage.setItem(this.storageKey, JSON.stringify(history));
    } catch (error) {
      console.warn('Failed to save performance history:', error);
    }
  }
  
  static getHistory(): PerformanceReport[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('Failed to load performance history:', error);
      return [];
    }
  }
  
  static clear(): void {
    localStorage.removeItem(this.storageKey);
  }
  
  static getLatest(): PerformanceReport | null {
    const history = this.getHistory();
    return history.length > 0 ? history[history.length - 1] : null;
  }
  
  static getPrevious(): PerformanceReport | null {
    const history = this.getHistory();
    return history.length > 1 ? history[history.length - 2] : null;
  }
}

export default {
  analyzePerformance,
  PerformanceHistory,
  calculateScore
};
