import type {PerformanceGrade} from '../../../packages/game-core/src';
import './performance-badge.css';

export const performanceGradeNames={none:'无牌',green:'绿牌',blue:'蓝牌',red:'红牌',gold:'金牌',rainbow:'彩牌'} as const;
export function PerformanceBadge({grade,correct}:{grade:PerformanceGrade;correct:number}){
 const label=`猜对 ${correct} 首，${performanceGradeNames[grade]}`;
 return <span className="rank-performance" data-grade={grade} role="img" aria-label={label} title={label}><strong className="rank-badge-count" style={{fontSize:Math.min(32,105/String(correct).length)}} aria-hidden="true">{correct}</strong><span className="performance-badge rank-badge-base" data-grade={grade} aria-hidden="true"/></span>;
}
