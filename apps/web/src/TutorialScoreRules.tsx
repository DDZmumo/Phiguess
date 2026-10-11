import {SONG_MAX_SCORE,scoreAnswer,performanceBadgeTotals} from '../../../packages/game-core/src';
import {tutorialScoreSlides} from './tutorial-model';
import {PerformanceBadge} from './PerformanceBadge';

export function TutorialScoreRules({page}:{page:number}){
 return <section className="tutorial-score-rules" aria-label="计分规则" data-score-page={page}>
  <h2>{tutorialScoreSlides[page]!.title}</h2>
  {page===0&&<dl className="tutorial-score-maximums">{Object.entries(SONG_MAX_SCORE).map(([level,score])=><div key={level}><dt>{level.toUpperCase()}</dt><dd>{score} 分</dd></div>)}</dl>}
  {page===1&&<><p>前 1/6 限时保留全部时间分，之后随耗时线性扣分，最多扣满分的 50%。</p><p>AT 固定 30 秒，前 5 秒不扣时间分。</p></>}
  {page===2&&<><p>每次答错扣满分的 10%，最多扣 50%。</p><p>超时、跳过或未猜出，单首得分为 0。</p></>}
  {page===3&&<><p>单首得分 = 满分 ×（1 − 时间扣分比例 − 答错扣分比例），最后四舍五入。</p><p>HD 限时 30 秒，17.5 秒答对且答错过 1 次：1000 ×（1 − 25% − 10%）= {scoreAnswer('hd',17500,30000,1)} 分。</p></>}
  {page===4&&<><p>提示不额外扣分，第 3 条只降低题图一档。</p><p>即使题图变简单，仍按开局难度的满分计分。</p></>}
  {page===5&&<><p>得分率 = 答对曲目的总分 ÷ 这些曲目的理论满分。未猜出曲目不计入分母。</p><p>答对 2 首 HD、共得 1900 分：1900 ÷ 2000 = 95%。</p><div className="tutorial-score-badges"><figure><PerformanceBadge grade={performanceBadgeTotals(1900,2,'hd').grade} correct={2}/><figcaption>金牌 · 数字 2 表示答对 2 首</figcaption></figure></div></>}
  {page===6&&<><div className="tutorial-score-badges">{(['rainbow','gold','red','blue','green'] as const).map((grade,i)=><figure key={grade}><PerformanceBadge grade={grade} correct={2}/><figcaption>{['100% 彩','≥95% 金','≥90% 红','≥80% 蓝','≥70% 绿'][i]}</figcaption></figure>)}</div><p>低于 70%，或未答对任何曲目，都没有成绩牌。</p></>}
 </section>;
}
