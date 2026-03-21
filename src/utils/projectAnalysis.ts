import type { AnalysisResult } from './codeAnalysisEngine';
import { analyzeCode } from './codeAnalysisEngine';
import type { TrendData } from './analysisHistory';
import { analysisHistory } from './analysisHistory';

export interface ProjectAnalysisResult {
    projectId: string;
    projectName: string;
    totalFiles: number;
    analyzedFiles: number;
    overallHealthScore: number;
    overallCodeAgeing: number;
    fileResults: FileAnalysisResult[];
    summary: {
        bestFiles: FileAnalysisResult[];
        worstFiles: FileAnalysisResult[];
        mostComplexFiles: FileAnalysisResult[];
    };
    aggregatedMetrics: {
        averageComplexity: string;
        averageMaintainability: number;
        totalHotspots: number;
        totalSignals: number;
        languageDistribution: Record<string, number>;
        categoryBreakdown: {
            syntax: number;
            patterns: number;
            structure: number;
            style: number;
            security: number;
        };
    };
}

export interface FileAnalysisResult {
    fileId: string;
    fileName: string;
    filePath: string;
    language: string;
    linesOfCode: number;
    analysis: AnalysisResult;
    trendData?: TrendData;
}

class ProjectAnalyzer {
    private getLanguageFromExtension(fileName: string): string {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const map: Record<string, string> = {
            ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
            py: 'python', java: 'java', c: 'c', cpp: 'cpp', go: 'go',
            rs: 'rust', rb: 'ruby', php: 'php', css: 'css', html: 'html',
            json: 'json', md: 'markdown', sh: 'shell', yml: 'yaml', yaml: 'yaml',
        };
        return map[ext] || 'plaintext';
    }

    async analyzeFile(fileId: string, fileName: string, content: string): Promise<FileAnalysisResult> {
        const language = this.getLanguageFromExtension(fileName);
        const analysis = analyzeCode(content, language);
        const trendData = analysisHistory.getTrendData(fileId);
        
        return {
            fileId,
            fileName,
            filePath: fileName, // In a real implementation, this would be the full path
            language,
            linesOfCode: content.split('\n').length,
            analysis,
            trendData: trendData || undefined
        };
    }

    async analyzeProject(
        files: Array<{ id: string; name: string; content: string }>,
        projectName: string = 'Project'
    ): Promise<ProjectAnalysisResult> {
        const startTime = Date.now();
        const fileResults: FileAnalysisResult[] = [];
        
        // Analyze files in batches to avoid blocking
        const batchSize = 5;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            const batchPromises = batch.map(file => 
                this.analyzeFile(file.id, file.name, file.content)
            );
            const batchResults = await Promise.all(batchPromises);
            fileResults.push(...batchResults);
            
            // Small delay to prevent UI blocking
            if (i + batchSize < files.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Calculate aggregated metrics
        const totalHealthScore = fileResults.reduce((sum, file) => sum + file.analysis.healthScore, 0) / fileResults.length;
        const totalCodeAgeing = fileResults.reduce((sum, file) => sum + file.analysis.codeAgeing, 0) / fileResults.length;
        
        // Language distribution
        const languageDistribution: Record<string, number> = {};
        fileResults.forEach(file => {
            languageDistribution[file.language] = (languageDistribution[file.language] || 0) + 1;
        });

        // Category breakdown
        const categoryBreakdown = {
            syntax: 0,
            patterns: 0,
            structure: 0,
            style: 0,
            security: 0
        };
        fileResults.forEach(file => {
            Object.entries(file.analysis.ageingDetails.categoryScores).forEach(([category, score]) => {
                categoryBreakdown[category as keyof typeof categoryBreakdown] += score;
            });
        });
        
        // Average out category scores
        Object.keys(categoryBreakdown).forEach(key => {
            categoryBreakdown[key as keyof typeof categoryBreakdown] = 
                Math.round(categoryBreakdown[key as keyof typeof categoryBreakdown] / fileResults.length);
        });

        // Complexity distribution
        const complexityCounts = {
            Low: fileResults.filter(f => f.analysis.complexity === 'Low').length,
            Medium: fileResults.filter(f => f.analysis.complexity === 'Medium').length,
            High: fileResults.filter(f => f.analysis.complexity === 'High').length
        };
        const averageComplexity = 
            complexityCounts.High > complexityCounts.Low ? 'High' :
            complexityCounts.Medium > complexityCounts.Low ? 'Medium' : 'Low';

        const averageMaintainability = fileResults.reduce((sum, file) => sum + file.analysis.maintainability, 0) / fileResults.length;

        // Sort files for summaries
        const sortedByHealth = [...fileResults].sort((a, b) => b.analysis.healthScore - a.analysis.healthScore);
        const sortedByAgeing = [...fileResults].sort((a, b) => b.analysis.codeAgeing - a.analysis.codeAgeing);
        const sortedByComplexity = [...fileResults].sort((a, b) => {
            const complexityOrder = { High: 3, Medium: 2, Low: 1 };
            return complexityOrder[b.analysis.complexity] - complexityOrder[a.analysis.complexity];
        });

        const endTime = Date.now();
        console.log(`Project analysis completed in ${endTime - startTime}ms for ${files.length} files`);

        return {
            projectId: `project_${Date.now()}`,
            projectName,
            totalFiles: files.length,
            analyzedFiles: fileResults.length,
            overallHealthScore: Math.round(totalHealthScore),
            overallCodeAgeing: Math.round(totalCodeAgeing),
            fileResults,
            summary: {
                bestFiles: sortedByHealth.slice(0, 5),
                worstFiles: sortedByAgeing.slice(0, 5),
                mostComplexFiles: sortedByComplexity.slice(0, 5)
            },
            aggregatedMetrics: {
                averageComplexity,
                averageMaintainability: Math.round(averageMaintainability),
                totalHotspots: fileResults.reduce((sum, file) => sum + file.analysis.ageingDetails.hotspots.length, 0),
                totalSignals: fileResults.reduce((sum, file) => sum + file.analysis.ageingDetails.signals.length, 0),
                languageDistribution,
                categoryBreakdown
            }
        };
    }

    // Export project analysis results
    exportAnalysisResults(analysis: ProjectAnalysisResult): string {
        const exportData = {
            metadata: {
                exportedAt: new Date().toISOString(),
                projectName: analysis.projectName,
                totalFiles: analysis.totalFiles,
                analyzedFiles: analysis.analyzedFiles
            },
            summary: {
                overallHealthScore: analysis.overallHealthScore,
                overallCodeAgeing: analysis.overallCodeAgeing
            },
            aggregatedMetrics: analysis.aggregatedMetrics,
            topIssues: {
                worstFiles: analysis.summary.worstFiles.map(f => ({
                    fileName: f.fileName,
                    healthScore: f.analysis.healthScore,
                    codeAgeing: f.analysis.codeAgeing
                }))
            },
            fileDetails: analysis.fileResults.map(f => ({
                fileName: f.fileName,
                language: f.language,
                linesOfCode: f.linesOfCode,
                healthScore: f.analysis.healthScore,
                codeAgeing: f.analysis.codeAgeing,
                complexity: f.analysis.complexity,
                maintainability: f.analysis.maintainability,
                signalsCount: f.analysis.ageingDetails.signals.length,
                hotspotsCount: f.analysis.ageingDetails.hotspots.length,
                grade: f.analysis.ageingDetails.grade
            }))
        };

        return JSON.stringify(exportData, null, 2);
    }

    // Generate a markdown report
    generateMarkdownReport(analysis: ProjectAnalysisResult): string {
        const { projectName, overallHealthScore, overallCodeAgeing, summary, aggregatedMetrics } = analysis;
        
        return `# Code Analysis Report: ${projectName}

Generated on: ${new Date().toLocaleDateString()}

## Executive Summary

- **Overall Health Score**: ${overallHealthScore}/100
- **Code Ageing**: ${overallCodeAgeing}% (${analysis.fileResults[0]?.analysis.ageingDetails.grade || 'N/A'})
- **Files Analyzed**: ${analysis.analyzedFiles}/${analysis.totalFiles}

## Project Metrics

### Health & Quality
- Average Maintainability: ${aggregatedMetrics.averageMaintainability}/100
- Average Complexity: ${aggregatedMetrics.averageComplexity}
- Total Hotspots: ${aggregatedMetrics.totalHotspots}
- Total Signals: ${aggregatedMetrics.totalSignals}

### Category Breakdown
${Object.entries(aggregatedMetrics.categoryBreakdown).map(([category, score]) => 
    `- **${category.charAt(0).toUpperCase() + category.slice(1)}**: ${score}%`
).join('\n')}

## Language Distribution

${Object.entries(aggregatedMetrics.languageDistribution)
    .sort(([,a], [,b]) => b - a)
    .map(([lang, count]) => `- **${lang}**: ${count} files (${Math.round(count/analysis.totalFiles*100)}%)`)
    .join('\n')}

## Top Issues

### Files Needing Immediate Attention (${summary.worstFiles.length})

${summary.worstFiles.map((file, index) => 
    `${index + 1}. **${file.fileName}** (Health: ${file.analysis.healthScore}, Ageing: ${file.analysis.codeAgeing}%, Grade: ${file.analysis.ageingDetails.grade})`
).join('\n')}

## Recommendations

1. **Priority 1 - Critical**: Focus on files with health score below 50
2. **Priority 2 - High**: Improve code with high ageing percentages
3. **Priority 3 - Medium**: Refactor files with medium complexity issues
4. **Priority 4 - Low**: Address style and pattern issues

---
*Report generated by AI Code Editor*
`;
    }
}

// Singleton instance
export const projectAnalyzer = new ProjectAnalyzer();
